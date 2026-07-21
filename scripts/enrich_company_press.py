"""Cache bounded public press signals for explicitly selected companies.

Only article metadata is retained. The script never stores article bodies and
does not pretend that a missing result means that a company has no press.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import re
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
COMPANY_DB = ROOT / "data" / "guadeloupe-enterprises.sqlite"
OUTPUT_DB = ROOT / "data" / "press-signals.sqlite"
GDELT_API = "https://api.gdeltproject.org/api/v2/doc/doc"
GOOGLE_NEWS_RSS = "https://news.google.com/rss/search"
SOURCE = "GDELT et Google News RSS"
SOURCE_URL = "https://api.gdeltproject.org/"
USER_AGENT = "Guadeloupe-Entreprises-BI/0.3 (+https://api.gdeltproject.org/)"
DEFAULT_REQUEST_TIMEOUT = 6.0
GDELT_COOLDOWN_SECONDS = 60.0
gdelt_cooldown_until = 0.0


class ProviderUnavailable(RuntimeError):
    """A provider is temporarily unavailable; another provider may still succeed."""


def clean_text(value: Any, limit: int = 500) -> str | None:
    if not isinstance(value, str):
        return None
    value = " ".join(value.split()).strip()
    return value[:limit] or None


def valid_siren(value: Any) -> str | None:
    raw = "".join(str(value or "").split())
    return raw if re.fullmatch(r"\d{9}", raw) else None


def safe_url(value: Any) -> str | None:
    raw = clean_text(value, 1000)
    if not raw:
        return None
    try:
        parsed = urllib.parse.urlsplit(raw)
    except ValueError:
        return None
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
        return None
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))


def request_bytes(url: str, timeout: float = DEFAULT_REQUEST_TIMEOUT) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json, application/rss+xml, application/xml"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def query_name(company_name: str) -> str:
    return re.sub(r"[\"()]", " ", company_name).replace("\n", " ").strip()[:100]


def gdelt_mentions(company_name: str, timeout: float = DEFAULT_REQUEST_TIMEOUT) -> list[dict[str, Any]]:
    global gdelt_cooldown_until
    if time.monotonic() < gdelt_cooldown_until:
        raise ProviderUnavailable("GDELT en cooldown après une réponse 429")
    url = urllib.parse.urlencode({
        "query": f'"{query_name(company_name)}" Guadeloupe',
        "mode": "artlist",
        "maxrecords": "20",
        "format": "json",
        "sort": "datedesc",
        "timespan": "3months",
    })
    try:
        payload = json.loads(request_bytes(f"{GDELT_API}?{url}", timeout).decode("utf-8"))
    except urllib.error.HTTPError as error:
        if error.code == 429:
            gdelt_cooldown_until = time.monotonic() + GDELT_COOLDOWN_SECONDS
        raise
    rows = payload.get("articles") if isinstance(payload, dict) else []
    if not isinstance(rows, list):
        return []
    return [
        {
            "title": clean_text(row.get("title"), 500),
            "url": safe_url(row.get("url")),
            "domain": clean_text(row.get("domain"), 180),
            "published_at": clean_text(row.get("seendate"), 80),
            "language": clean_text(row.get("language"), 80),
            "source_country": clean_text(row.get("sourcecountry"), 80),
            "source": "GDELT",
            "confidence": 0.65,
        }
        for row in rows
        if isinstance(row, dict) and safe_url(row.get("url"))
    ]


def google_news_mentions(company_name: str, timeout: float = DEFAULT_REQUEST_TIMEOUT) -> list[dict[str, Any]]:
    url = urllib.parse.urlencode({
        "q": f'"{query_name(company_name)}" Guadeloupe',
        "hl": "fr",
        "gl": "FR",
        "ceid": "FR:fr",
    })
    root = ET.fromstring(request_bytes(f"{GOOGLE_NEWS_RSS}?{url}", timeout).decode("utf-8", errors="replace"))
    rows = root.findall("./channel/item")[:20]
    output = []
    for row in rows:
        title = clean_text(row.findtext("title"), 500)
        article_url = safe_url(row.findtext("link"))
        source_node = row.find("source")
        domain = clean_text(source_node.text if source_node is not None else None, 180)
        if title and article_url:
            output.append({
                "title": title,
                "url": article_url,
                "domain": domain,
                "published_at": clean_text(row.findtext("pubDate"), 120),
                "language": "français",
                "source_country": "France",
                "source": "Google News RSS",
                "confidence": 0.58,
            })
    return output


def initialise(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
        CREATE TABLE IF NOT EXISTS press_mentions (
          id INTEGER PRIMARY KEY,
          siren TEXT NOT NULL,
          title TEXT NOT NULL,
          url TEXT NOT NULL,
          domain TEXT,
          published_at TEXT,
          language TEXT,
          source_country TEXT,
          source TEXT NOT NULL,
          confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
          query_name TEXT NOT NULL,
          retrieved_at TEXT NOT NULL,
          UNIQUE(siren, url, source)
        );
        CREATE INDEX IF NOT EXISTS press_mentions_siren_date_idx ON press_mentions(siren, published_at DESC);
        CREATE INDEX IF NOT EXISTS press_mentions_source_idx ON press_mentions(source, published_at DESC);
        CREATE TABLE IF NOT EXISTS fetch_log (
          siren TEXT PRIMARY KEY,
          company_name TEXT NOT NULL,
          status TEXT NOT NULL,
          mention_count INTEGER NOT NULL DEFAULT 0,
          provider_status TEXT NOT NULL DEFAULT '{}',
          fetched_at TEXT NOT NULL,
          error TEXT
        );
        CREATE TABLE IF NOT EXISTS metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        """
    )


def load_targets(
    company_db: Path,
    requested: list[str],
    limit: int | None,
    priority: bool = False,
    offset: int = 0,
) -> list[tuple[str, str]]:
    if offset < 0:
        raise ValueError("--offset doit être supérieur ou égal à zéro")
    connection = sqlite3.connect(company_db)
    try:
        if requested:
            placeholders = ",".join("?" for _ in requested)
            rows = connection.execute(
                f"SELECT siren, COALESCE(NULLIF(TRIM(usual_name), ''), legal_name) FROM companies WHERE siren IN ({placeholders}) ORDER BY siren",
                requested,
            ).fetchall()
        else:
            if limit is None:
                raise ValueError("Fournir --siren ou --limit pour éviter une collecte média non bornée")
            if priority:
                rows = connection.execute(
                    """
                    SELECT siren, COALESCE(NULLIF(TRIM(usual_name), ''), legal_name)
                    FROM companies
                    WHERE administrative_status = 'A'
                    ORDER BY
                      CASE workforce_band
                        WHEN '53' THEN 0 WHEN '52' THEN 1 WHEN '51' THEN 2
                        WHEN '42' THEN 3 WHEN '41' THEN 4 WHEN '32' THEN 5
                        WHEN '31' THEN 6 WHEN '22' THEN 7 WHEN '21' THEN 8
                        WHEN '12' THEN 9 WHEN '11' THEN 10 WHEN '03' THEN 11
                        WHEN '02' THEN 12 WHEN '01' THEN 13 WHEN '00' THEN 14
                        ELSE 15
                      END,
                      CASE
                        WHEN legal_name IN ('Entreprise individuelle', 'Société créée de fait') THEN 1
                        ELSE 0
                      END,
                      LENGTH(COALESCE(NULLIF(TRIM(usual_name), ''), legal_name)) DESC,
                      siren
                    LIMIT ? OFFSET ?
                    """,
                    (limit, offset),
                ).fetchall()
            else:
                rows = connection.execute(
                    "SELECT siren, COALESCE(NULLIF(TRIM(usual_name), ''), legal_name) FROM companies WHERE administrative_status = 'A' ORDER BY siren LIMIT ? OFFSET ?",
                    (limit, offset),
                ).fetchall()
    finally:
        connection.close()
    return [(str(siren), str(name)) for siren, name in rows if valid_siren(siren) and clean_text(name)]


def index_targets(
    output: Path,
    targets: list[tuple[str, str]],
    delay: float,
    resume: bool,
    selection: str = "explicit",
    offset: int = 0,
    request_timeout: float = DEFAULT_REQUEST_TIMEOUT,
) -> dict[str, int]:
    output.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(output)
    initialise(connection)
    done = {row[0] for row in connection.execute("SELECT siren FROM fetch_log WHERE status IN ('ok', 'empty', 'partial')")} if resume else set()
    retrieved_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    stats = {"requested": len(targets), "skipped": 0, "processed": 0, "ok": 0, "empty": 0, "partial": 0, "error": 0, "mentions": 0}
    provider_fetchers = {
        "gdelt": lambda company_name: gdelt_mentions(company_name, request_timeout),
        "google_news": lambda company_name: google_news_mentions(company_name, request_timeout),
    }
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="press-provider") as provider_pool:
      for index, (siren, company_name) in enumerate(targets):
        if siren in done:
            stats["skipped"] += 1
            continue
        provider_status: dict[str, str] = {}
        rows: list[dict[str, Any]] = []
        errors: list[str] = []
        futures = {
            provider_pool.submit(fetcher, company_name): provider
            for provider, fetcher in provider_fetchers.items()
        }
        for future in as_completed(futures):
            provider = futures[future]
            try:
                fetched = future.result()
                provider_status[provider] = "ok"
                rows.extend(fetched)
            except (OSError, ValueError, ET.ParseError, json.JSONDecodeError, ProviderUnavailable) as error:
                provider_status[provider] = "unavailable" if isinstance(error, ProviderUnavailable) else "error"
                errors.append(f"{provider}: {str(error)[:220]}")
        deduplicated: dict[tuple[str, str], dict[str, Any]] = {}
        for row in rows:
            key = (str(row["url"]), str(row["source"]))
            deduplicated.setdefault(key, row)
        connection.execute("DELETE FROM press_mentions WHERE siren = ?", (siren,))
        connection.executemany(
            """
            INSERT INTO press_mentions(siren,title,url,domain,published_at,language,source_country,source,confidence,query_name,retrieved_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(siren,url,source) DO UPDATE SET title=excluded.title, domain=excluded.domain,
              published_at=excluded.published_at, language=excluded.language, source_country=excluded.source_country,
              confidence=excluded.confidence, query_name=excluded.query_name, retrieved_at=excluded.retrieved_at
            """,
            [
                (siren, row["title"], row["url"], row["domain"], row["published_at"], row["language"], row["source_country"], row["source"], row["confidence"], company_name, retrieved_at)
                for row in deduplicated.values()
            ],
        )
        if len(provider_status) == 2 and all(value == "ok" for value in provider_status.values()):
            status = "ok" if deduplicated else "empty"
        elif deduplicated:
            status = "partial"
        else:
            status = "error"
        connection.execute(
            """
            INSERT INTO fetch_log(siren,company_name,status,mention_count,provider_status,fetched_at,error)
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(siren) DO UPDATE SET company_name=excluded.company_name, status=excluded.status,
              mention_count=excluded.mention_count, provider_status=excluded.provider_status,
              fetched_at=excluded.fetched_at, error=excluded.error
            """,
            (siren, company_name, status, len(deduplicated), json.dumps(provider_status, ensure_ascii=False, sort_keys=True), retrieved_at, "; ".join(errors) or None),
        )
        stats["processed"] += 1
        stats[status] += 1
        stats["mentions"] += len(deduplicated)
        if index % 10 == 0:
            connection.commit()
        if delay > 0:
            time.sleep(delay)
    connection.execute("INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ("source", SOURCE))
    connection.execute("INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ("source_url", SOURCE_URL))
    connection.execute("INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ("retrieved_at", retrieved_at))
    connection.execute("INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ("methodology", "Recherche exacte sur nom publié + Guadeloupe, deux fournisseurs, métadonnées uniquement, cache borné et non exhaustif."))
    connection.execute("INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ("target_selection", selection))
    connection.execute("INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ("target_offset", str(offset)))
    connection.execute("INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ("target_count", str(len(targets))))
    connection.execute("INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ("request_timeout_seconds", str(request_timeout)))
    connection.commit()
    connection.close()
    return stats


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--company-db", type=Path, default=COMPANY_DB)
    parser.add_argument("--output", type=Path, default=OUTPUT_DB)
    parser.add_argument("--siren", action="append", default=[])
    parser.add_argument("--limit", type=int, default=None, help="limite explicite si aucun SIREN n'est fourni")
    parser.add_argument("--priority", action="store_true", help="cible d'abord les entreprises actives avec les plus grandes tranches d'effectif")
    parser.add_argument("--offset", type=int, default=0, help="décalage dans la sélection bornée; utile pour planifier les batches")
    parser.add_argument("--timeout", type=float, default=DEFAULT_REQUEST_TIMEOUT, help="timeout de chaque fournisseur en secondes")
    parser.add_argument("--delay", type=float, default=0.5)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    sirens = sorted({siren for value in args.siren for siren in value.split(",") if valid_siren(siren)})
    if args.siren and (args.priority or args.offset):
        parser.error("--priority et --offset sont réservés à une sélection sans --siren")
    targets = load_targets(args.company_db, sirens, args.limit, args.priority, args.offset)
    selection = "explicit" if sirens else ("priority" if args.priority else "siren_order")
    if args.timeout <= 0:
        parser.error("--timeout doit être positif")
    print(json.dumps(index_targets(args.output, targets, args.delay, args.resume, selection, args.offset, args.timeout), ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
