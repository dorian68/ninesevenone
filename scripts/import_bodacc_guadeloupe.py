"""Index public BODACC announcements for Guadeloupe.

The source is queried by department, then only announcements whose registry
contains an exact SIREN from the local SIRENE stock are retained. Raw BODACC
payloads are never written: personal names, addresses from legal-person
blocks and free-form legal descriptions are deliberately discarded.

The default window starts in 2020 to keep a normal refresh bounded. Use
``--all-history`` for the complete public department history.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
COMPANY_DB = ROOT / "data" / "guadeloupe-enterprises.sqlite"
OUTPUT_DB = ROOT / "data" / "bodacc-guadeloupe.sqlite"
API_BASE = "https://www.bodacc.fr/api/explore/v2.1/catalog/datasets/annonces-commerciales/records"
SOURCE = "BODACC / DILA"
SOURCE_URL = "https://www.bodacc.fr/api-console/explore/v2.1/"
DEPARTMENT_CODE = "971"
DEFAULT_SINCE = "2020-01-01"
USER_AGENT = "Guadeloupe-Entreprises-BI/0.4 (+https://www.bodacc.fr/)"
SELECT_FIELDS = ",".join(
    (
        "id",
        "dateparution",
        "numeroannonce",
        "typeavis",
        "typeavis_lib",
        "familleavis",
        "familleavis_lib",
        "numerodepartement",
        "tribunal",
        "ville",
        "registre",
        "cp",
        "listepersonnes",
        "listeetablissements",
        "url_complete",
    )
)


def clean_text(value: Any, limit: int = 1_200) -> str | None:
    if not isinstance(value, str):
        return None
    value = " ".join(value.split()).strip()
    return value[:limit] or None


def valid_siren(value: Any) -> str | None:
    raw = "".join(str(value or "").split())
    return raw if re.fullmatch(r"\d{9}", raw) else None


def sirens_from_registry(value: Any) -> set[str]:
    """Return only 9-digit identifiers from BODACC's registry array."""

    values = value if isinstance(value, list) else [value]
    output: set[str] = set()
    for item in values:
        if not isinstance(item, str):
            continue
        for candidate in re.findall(r"(?<!\d)\d{3}\s?\d{3}\s?\d{3}(?!\d)", item):
            siren = valid_siren(candidate)
            if siren:
                output.add(siren)
    return output


def parse_json_object(value: Any) -> dict[str, Any]:
    if not isinstance(value, str):
        return value if isinstance(value, dict) else {}
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def object_list(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        return [value]
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    return []


def number_value(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = value.strip().replace(" ", "").replace(",", ".")
        try:
            return float(cleaned) if cleaned else None
        except ValueError:
            return None
    return None


def parse_bodacc_record(row: dict[str, Any], local_sirens: set[str], retrieved_at: str) -> list[dict[str, Any]]:
    """Flatten one announcement into one safe row per local SIREN."""

    event_id = clean_text(row.get("id"), 120)
    if not event_id:
        return []
    matched_sirens = sorted(sirens_from_registry(row.get("registre")) & local_sirens)
    if not matched_sirens:
        return []

    people_block = parse_json_object(row.get("listepersonnes"))
    corporate_people = [
        item for item in object_list(people_block.get("personne"))
        if clean_text(item.get("typePersonne")) == "pm"
    ]
    corporate_person = corporate_people[0] if corporate_people else {}
    capital = parse_json_object(corporate_person.get("capital"))

    establishment_block = parse_json_object(row.get("listeetablissements"))
    activities = []
    for establishment in object_list(establishment_block.get("etablissement")):
        activity = clean_text(establishment.get("activite"), 1_500)
        if activity and activity not in activities:
            activities.append(activity)
    activity_text = " ; ".join(activities[:3]) or None

    common = {
        "event_id": event_id,
        "publication_date": clean_text(row.get("dateparution"), 40),
        "announcement_number": int(number_value(row.get("numeroannonce")) or 0),
        "announcement_type": clean_text(row.get("typeavis"), 80),
        "announcement_type_label": clean_text(row.get("typeavis_lib"), 180),
        "family": clean_text(row.get("familleavis"), 80),
        "family_label": clean_text(row.get("familleavis_lib"), 180) or "Annonce commerciale",
        "department_code": clean_text(row.get("numerodepartement"), 10) or DEPARTMENT_CODE,
        "tribunal": clean_text(row.get("tribunal"), 240),
        "city": clean_text(row.get("ville"), 240),
        "postal_codes": clean_text(row.get("cp"), 80),
        "legal_form": clean_text(corporate_person.get("formeJuridique"), 180),
        "capital": number_value(capital.get("montantCapital")),
        "capital_currency": clean_text(capital.get("devise"), 12) or "EUR",
        "activity_text": activity_text,
        "source_url": clean_text(row.get("url_complete"), 1_000),
        "retrieved_at": retrieved_at,
    }
    return [{"siren": siren, **common} for siren in matched_sirens]


def source_sirens(path: Path) -> set[str]:
    connection = sqlite3.connect(path)
    try:
        rows = connection.execute("SELECT siren FROM companies WHERE length(siren) = 9").fetchall()
    finally:
        connection.close()
    return {siren for (siren,) in rows if valid_siren(siren)}


def initialise(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
        CREATE TABLE IF NOT EXISTS bodacc_events (
          siren TEXT NOT NULL,
          event_id TEXT NOT NULL,
          publication_date TEXT,
          announcement_number INTEGER NOT NULL DEFAULT 0,
          announcement_type TEXT,
          announcement_type_label TEXT,
          family TEXT,
          family_label TEXT NOT NULL,
          department_code TEXT NOT NULL,
          tribunal TEXT,
          city TEXT,
          postal_codes TEXT,
          legal_form TEXT,
          capital REAL,
          capital_currency TEXT NOT NULL DEFAULT 'EUR',
          activity_text TEXT,
          source_url TEXT,
          retrieved_at TEXT NOT NULL,
          PRIMARY KEY (siren, event_id)
        );
        CREATE INDEX IF NOT EXISTS bodacc_events_siren_date_idx ON bodacc_events(siren, publication_date DESC);
        CREATE INDEX IF NOT EXISTS bodacc_events_family_idx ON bodacc_events(family, publication_date DESC);
        CREATE VIRTUAL TABLE IF NOT EXISTS bodacc_search USING fts5(
          siren UNINDEXED,
          event_id UNINDEXED,
          family_label,
          activity_text,
          city,
          tribunal,
          tokenize='unicode61 remove_diacritics 2'
        );
        CREATE TABLE IF NOT EXISTS import_runs (
          id INTEGER PRIMARY KEY,
          query_signature TEXT NOT NULL,
          status TEXT NOT NULL,
          next_offset INTEGER NOT NULL DEFAULT 0,
          records_read INTEGER NOT NULL DEFAULT 0,
          matched_rows INTEGER NOT NULL DEFAULT 0,
          source_total_count INTEGER,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          error TEXT
        );
        CREATE TABLE IF NOT EXISTS metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        """
    )


def index_metadata(connection: sqlite3.Connection, values: dict[str, Any]) -> None:
    connection.executemany(
        "INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [(key, str(value)) for key, value in values.items()],
    )


def rebuild_search(connection: sqlite3.Connection) -> None:
    connection.execute("DELETE FROM bodacc_search")
    connection.execute(
        """
        INSERT INTO bodacc_search(siren,event_id,family_label,activity_text,city,tribunal)
        SELECT siren,event_id,family_label,COALESCE(activity_text,''),COALESCE(city,''),COALESCE(tribunal,'')
        FROM bodacc_events
        """
    )


def request_payload(url: str, retries: int = 5) -> Any:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = json.loads(response.read().decode("utf-8"))
            return payload
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == retries - 1:
                raise
            retry_after = error.headers.get("Retry-After")
            wait = float(retry_after) if retry_after and retry_after.replace(".", "", 1).isdigit() else 2 ** (attempt + 1)
            time.sleep(wait)
        except (OSError, ValueError, json.JSONDecodeError):
            if attempt == retries - 1:
                raise
            time.sleep(2 ** (attempt + 1))
    raise RuntimeError("BODACC request failed")


def request_json(url: str, retries: int = 5) -> dict[str, Any]:
    payload = request_payload(url, retries)
    if not isinstance(payload, dict):
        raise ValueError("Réponse BODACC inattendue")
    return payload


def request_json_rows(url: str, retries: int = 5) -> list[dict[str, Any]]:
    payload = request_payload(url, retries)
    if not isinstance(payload, list):
        raise ValueError("Export BODACC inattendu")
    return [row for row in payload if isinstance(row, dict)]


def build_where(since: str | None) -> str:
    clauses = [f'numerodepartement="{DEPARTMENT_CODE}"']
    if since:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", since):
            raise ValueError("--since doit être au format YYYY-MM-DD")
        clauses.append(f'dateparution >= "{since}"')
    return " AND ".join(clauses)


def insert_event_rows(connection: sqlite3.Connection, raw_rows: list[dict[str, Any]], local_sirens: set[str], retrieved_at: str) -> int:
    page_rows: list[tuple[Any, ...]] = []
    for raw in raw_rows:
        parsed_rows = parse_bodacc_record(raw, local_sirens, retrieved_at)
        page_rows.extend(
            (
                row["siren"], row["event_id"], row["publication_date"], row["announcement_number"],
                row["announcement_type"], row["announcement_type_label"], row["family"], row["family_label"],
                row["department_code"], row["tribunal"], row["city"], row["postal_codes"], row["legal_form"],
                row["capital"], row["capital_currency"], row["activity_text"], row["source_url"], row["retrieved_at"],
            )
            for row in parsed_rows
        )
    connection.executemany(
        """
        INSERT INTO bodacc_events(
          siren,event_id,publication_date,announcement_number,announcement_type,announcement_type_label,
          family,family_label,department_code,tribunal,city,postal_codes,legal_form,capital,capital_currency,
          activity_text,source_url,retrieved_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(siren,event_id) DO UPDATE SET
          publication_date=excluded.publication_date,
          announcement_number=excluded.announcement_number,
          announcement_type=excluded.announcement_type,
          announcement_type_label=excluded.announcement_type_label,
          family=excluded.family,
          family_label=excluded.family_label,
          department_code=excluded.department_code,
          tribunal=excluded.tribunal,
          city=excluded.city,
          postal_codes=excluded.postal_codes,
          legal_form=excluded.legal_form,
          capital=excluded.capital,
          capital_currency=excluded.capital_currency,
          activity_text=excluded.activity_text,
          source_url=excluded.source_url,
          retrieved_at=excluded.retrieved_at
        """,
        page_rows,
    )
    return len(page_rows)


def import_records(
    output: Path,
    local_sirens: set[str],
    since: str | None,
    page_size: int,
    delay: float,
    max_records: int | None,
    max_pages: int | None,
    resume: bool,
    use_export: bool,
) -> dict[str, Any]:
    output.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(output)
    initialise(connection)
    retrieved_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    where = build_where(since)
    signature = json.dumps({"where": where, "select": SELECT_FIELDS}, sort_keys=True)
    offset = 0
    records_read = 0
    matched_rows = 0
    source_total_count: int | None = None
    if resume:
        state = connection.execute(
            "SELECT status, query_signature, next_offset, records_read, matched_rows, source_total_count FROM import_runs WHERE status = 'running' ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if state and state[1] == signature:
            offset = int(state[2])
            records_read = int(state[3])
            matched_rows = int(state[4])
            source_total_count = int(state[5]) if state[5] is not None else None

    run_cursor = connection.execute(
        "INSERT INTO import_runs(query_signature,status,next_offset,records_read,matched_rows,source_total_count,started_at) VALUES (?, 'running', ?, ?, ?, ?, ?)",
        (signature, offset, records_read, matched_rows, source_total_count, retrieved_at),
    )
    run_id = run_cursor.lastrowid
    index_metadata(connection, {
        "source": SOURCE,
        "source_url": SOURCE_URL,
        "department_code": DEPARTMENT_CODE,
        "query_where": where,
        "query_signature": signature,
        "retrieved_at": retrieved_at,
        "status": "running",
    })
    connection.commit()

    try:
        if use_export:
            params = urllib.parse.urlencode({"where": where, "select": SELECT_FIELDS})
            export_rows = request_json_rows(f"{API_BASE.rsplit('/records', 1)[0]}/exports/json?{params}")
            source_total_count = len(export_rows)
            if max_records is not None:
                export_rows = export_rows[:max_records]
            for start in range(0, len(export_rows), 1_000):
                chunk = export_rows[start:start + 1_000]
                matched_rows += insert_event_rows(connection, chunk, local_sirens, retrieved_at)
                records_read += len(chunk)
                offset = records_read
                connection.execute(
                    "UPDATE import_runs SET next_offset=?,records_read=?,matched_rows=?,source_total_count=? WHERE id=?",
                    (offset, records_read, matched_rows, source_total_count, run_id),
                )
                index_metadata(connection, {
                    "status": "running",
                    "next_offset": offset,
                    "records_read": records_read,
                    "matched_rows": matched_rows,
                    "source_total_count": source_total_count,
                    "transport": "export",
                })
                connection.commit()
        else:
            page = 0
            while True:
                if max_pages is not None and page >= max_pages:
                    break
                remaining = max_records - records_read if max_records is not None else page_size
                if max_records is not None and remaining <= 0:
                    break
                limit = min(page_size, remaining) if max_records is not None else page_size
                params = urllib.parse.urlencode({
                    "where": where,
                    "select": SELECT_FIELDS,
                    "order_by": "dateparution desc,id desc",
                    "limit": str(limit),
                    "offset": str(offset),
                })
                payload = request_json(f"{API_BASE}?{params}")
                if source_total_count is None:
                    source_total_count = int(payload.get("total_count") or 0)
                rows = payload.get("results") if isinstance(payload.get("results"), list) else []
                if not rows:
                    break
                page_matched_rows = insert_event_rows(
                    connection,
                    [raw for raw in rows if isinstance(raw, dict)],
                    local_sirens,
                    retrieved_at,
                )
                records_read += len(rows)
                matched_rows += page_matched_rows
                offset += len(rows)
                page += 1
                connection.execute(
                    "UPDATE import_runs SET next_offset=?,records_read=?,matched_rows=?,source_total_count=? WHERE id=?",
                    (offset, records_read, matched_rows, source_total_count, run_id),
                )
                index_metadata(connection, {
                    "status": "running",
                    "next_offset": offset,
                    "records_read": records_read,
                    "matched_rows": matched_rows,
                    "source_total_count": source_total_count or 0,
                })
                connection.commit()
                if len(rows) < limit:
                    break
                if delay > 0:
                    time.sleep(delay)
    except Exception as error:
        message = str(error)[:500]
        connection.execute("UPDATE import_runs SET status='error',error=? WHERE id=?", (message, run_id))
        index_metadata(connection, {"status": "error", "error": message})
        connection.commit()
        connection.close()
        raise

    finished_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    rebuild_search(connection)
    connection.execute("UPDATE import_runs SET status='complete',finished_at=? WHERE id=?", (finished_at, run_id))
    index_metadata(connection, {
        "status": "complete",
        "finished_at": finished_at,
        "records_read": records_read,
        "matched_rows": matched_rows,
        "source_total_count": source_total_count or 0,
        "indexed_siren_count": connection.execute("SELECT COUNT(DISTINCT siren) FROM bodacc_events").fetchone()[0],
        "indexed_event_count": connection.execute("SELECT COUNT(*) FROM bodacc_events").fetchone()[0],
    })
    connection.commit()
    connection.close()
    return {
        "status": "complete",
        "where": where,
        "source_total_count": source_total_count or 0,
        "records_read": records_read,
        "matched_rows": matched_rows,
        "indexed_siren_count": len(local_sirens),
        "retrieved_at": retrieved_at,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--company-db", type=Path, default=COMPANY_DB)
    parser.add_argument("--output", type=Path, default=OUTPUT_DB)
    parser.add_argument("--since", default=DEFAULT_SINCE, help="date minimale YYYY-MM-DD; par défaut 2020-01-01")
    parser.add_argument("--all-history", action="store_true", help="inclut tout l'historique BODACC disponible")
    parser.add_argument("--page-size", type=int, default=100)
    parser.add_argument("--delay", type=float, default=0.05)
    parser.add_argument("--limit", type=int, default=None, help="limite de lignes source pour un import contrôlé")
    parser.add_argument("--max-pages", type=int, default=None)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--export", action="store_true", help="utilise l'export JSON sans plafond plutôt que la pagination records")
    args = parser.parse_args()
    if not 1 <= args.page_size <= 100:
        raise SystemExit("--page-size doit être compris entre 1 et 100")
    local_sirens = source_sirens(args.company_db)
    since = None if args.all_history else args.since
    stats = import_records(args.output, local_sirens, since, args.page_size, args.delay, args.limit, args.max_pages, args.resume, args.export)
    print(json.dumps(stats, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
