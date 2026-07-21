"""Extract factual public website metadata for exact OSM/SIREN links.

The crawler fetches one public homepage per OSM website reference, follows
RFC 9309 robots rules, blocks non-public network targets, and stores only
derived metadata. Raw HTML and email addresses are never persisted.
"""

from __future__ import annotations

import argparse
import hashlib
import html as html_module
import ipaddress
import json
import os
import re
import socket
import sqlite3
import threading
import time
import urllib.parse
import urllib.robotparser
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from collections.abc import Callable
from typing import Any

import requests
from bs4 import BeautifulSoup


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "data/osm-business-profiles.sqlite"
DEFAULT_RNA_INPUT = ROOT / "data/rna-association-profiles.sqlite"
DEFAULT_OUTPUT = ROOT / "data/website-enrichments.sqlite"
DEFAULT_USER_AGENT = "Mozilla/5.0 (compatible; GuadeloupeBI/0.2; +http://localhost:3000/about-data)"
PRODUCT_TOKEN = "GuadeloupeBI"
MAX_HTML_BYTES = 1_048_576
MAX_ROBOTS_BYTES = 524_288
PLATFORM_DOMAINS = {
    "facebook.com", "instagram.com", "linkedin.com", "tiktok.com", "twitter.com",
    "x.com", "youtube.com", "youtu.be", "wa.me", "whatsapp.com", "linktr.ee",
    "pagesjaunes.fr", "tripadvisor.com", "booking.com", "google.com", "google.fr",
}
SERVICE_SECTION_PATTERN = re.compile(
    r"(?:service|prestation|solution|offre|expertise|activité|activite|savoir-faire|catalogue)", re.I
)
GENERIC_HEADINGS = {
    "accueil", "contact", "à propos", "a propos", "qui sommes-nous", "en savoir plus",
    "nos partenaires", "actualités", "actualites", "mentions légales", "menu",
    "service", "services", "nos services", "prestations", "nos prestations", "nos métiers",
    "nos metiers", "nos expertises", "nos top prestations", "qu’offrons-nous?", "qu'offrons-nous?",
    "plus", "appelez-nous !", "appelez-nous", "bienvenue",
}
EDITORIAL_CONTAINER_PATTERN = re.compile(r"(?:^|[-_ ])(?:post|article|news|actualit|blog|event|agenda)(?:$|[-_ ])", re.I)
SOCIAL_HOSTS = {
    "facebook.com": "facebook", "instagram.com": "instagram", "linkedin.com": "linkedin",
    "youtube.com": "youtube", "tiktok.com": "tiktok", "twitter.com": "x", "x.com": "x",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def clean_text(value: Any, limit: int = 600) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = re.sub(r"\s+", " ", html_module.unescape(value)).strip()
    if not cleaned:
        return None
    if len(cleaned) <= limit:
        return cleaned
    shortened = cleaned[: limit - 1].rsplit(" ", 1)[0].rstrip(" ,;:-")
    return shortened + "…"


def clean_description(value: Any, title: str | None = None) -> str | None:
    cleaned = clean_text(value, 600)
    if not cleaned or len(cleaned) < 30:
        return None
    lowered = cleaned.casefold().strip(" .|-")
    if title and lowered == title.casefold().strip(" .|-"):
        return None
    if any(token in cleaned for token in ("{", "}", "@media")):
        return None
    if sum(cleaned.lower().count(token) for token in ("display:", "font-size:", "font-weight:", "line-height:", "color:")) >= 2:
        return None
    if lowered in {"bienvenue sur notre site", "page d'accueil", "accueil du site"}:
        return None
    words = cleaned.split()
    return cleaned if len(words) <= 25 else " ".join(words[:25]).rstrip(" ,;:-") + "…"


def canonicalize_url(raw: str) -> str:
    value = raw.strip()
    if not re.match(r"^https?://", value, re.I):
        value = "https://" + value
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        raise ValueError("unsupported_url")
    if parsed.username or parsed.password:
        raise ValueError("userinfo_forbidden")
    try:
        port = parsed.port
    except ValueError as error:
        raise ValueError("invalid_port") from error
    if port and port not in {80, 443}:
        raise ValueError("nonstandard_port")
    hostname = parsed.hostname.encode("idna").decode("ascii").lower().rstrip(".")
    netloc = hostname if not port else f"{hostname}:{port}"
    path = parsed.path or "/"
    return urllib.parse.urlunsplit((parsed.scheme.lower(), netloc, path, parsed.query, ""))


def registrable_platform(hostname: str) -> str | None:
    host = hostname.lower().removeprefix("www.")
    return next((domain for domain in PLATFORM_DOMAINS if host == domain or host.endswith("." + domain)), None)


def validate_public_target(url: str) -> None:
    parsed = urllib.parse.urlsplit(url)
    hostname = parsed.hostname
    if not hostname:
        raise ValueError("missing_hostname")
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(hostname, parsed.port or 443, type=socket.SOCK_STREAM)}
    except socket.gaierror as error:
        raise ValueError("dns_error") from error
    if not addresses:
        raise ValueError("dns_empty")
    if any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise ValueError("non_public_target")


class DomainLimiter:
    def __init__(self, delay: float) -> None:
        self.delay = delay
        self.lock = threading.Lock()
        self.last_request: dict[str, float] = {}

    def wait(self, url: str) -> None:
        host = urllib.parse.urlsplit(url).hostname or ""
        with self.lock:
            now = time.monotonic()
            scheduled = max(now, self.last_request.get(host, 0.0) + self.delay)
            self.last_request[host] = scheduled
        wait_for = scheduled - now
        if wait_for > 0:
            time.sleep(wait_for)


def fetch_limited(
    session: requests.Session,
    url: str,
    limiter: DomainLimiter,
    max_bytes: int,
    timeout: float,
    max_redirects: int = 5,
    on_redirect: Callable[[str], None] | None = None,
) -> tuple[requests.Response, bytes, str]:
    current = canonicalize_url(url)
    for redirect_index in range(max_redirects + 1):
        validate_public_target(current)
        limiter.wait(current)
        response = session.get(current, stream=True, allow_redirects=False, timeout=(4, timeout))
        if response.is_redirect or response.is_permanent_redirect:
            location = response.headers.get("Location")
            response.close()
            if not location or redirect_index >= max_redirects:
                raise ValueError("redirect_limit")
            current = canonicalize_url(urllib.parse.urljoin(current, location))
            if on_redirect:
                on_redirect(current)
            continue
        payload = bytearray()
        for chunk in response.iter_content(16_384):
            payload.extend(chunk)
            if len(payload) > max_bytes:
                response.close()
                raise ValueError("response_too_large")
        return response, bytes(payload), current
    raise ValueError("redirect_limit")


def robots_decision(
    session: requests.Session,
    page_url: str,
    limiter: DomainLimiter,
    timeout: float,
) -> tuple[bool, str, str | None]:
    parsed = urllib.parse.urlsplit(page_url)
    robots_url = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "/robots.txt", "", ""))
    try:
        response, payload, final_url = fetch_limited(session, robots_url, limiter, MAX_ROBOTS_BYTES, timeout)
    except (requests.RequestException, ValueError) as error:
        return False, "unreachable", clean_text(str(error), 180)
    if 400 <= response.status_code < 500:
        return True, "unavailable", None
    if response.status_code >= 500:
        return False, "unreachable", f"HTTP {response.status_code}"
    if not response.ok:
        return False, "unreachable", f"HTTP {response.status_code}"
    parser = urllib.robotparser.RobotFileParser()
    parser.set_url(final_url)
    parser.parse(payload.decode("utf-8", errors="replace").splitlines())
    allowed = parser.can_fetch(PRODUCT_TOKEN, page_url)
    return allowed, "allowed" if allowed else "disallowed", None


def jsonld_nodes(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [node for item in value for node in jsonld_nodes(item)]
    if not isinstance(value, dict):
        return []
    nodes = [value]
    graph = value.get("@graph")
    if isinstance(graph, (list, dict)):
        nodes.extend(jsonld_nodes(graph))
    return nodes


def jsonld_types(node: dict[str, Any]) -> set[str]:
    raw = node.get("@type")
    if isinstance(raw, str):
        return {raw}
    if isinstance(raw, list):
        return {value for value in raw if isinstance(value, str)}
    return set()


def service_candidates_from_jsonld(node: Any, source: str = "jsonld") -> list[dict[str, str]]:
    candidates: list[dict[str, str]] = []
    if isinstance(node, list):
        for item in node:
            candidates.extend(service_candidates_from_jsonld(item, source))
        return candidates
    if not isinstance(node, dict):
        return candidates
    types = jsonld_types(node)
    if types.intersection({"Service", "Product", "Offer", "OfferCatalog"}):
        name = clean_text(node.get("serviceType") or node.get("name"), 160)
        if name:
            candidates.append({"name": name, "source": source, "confidence": "0.90"})
    for key in ("hasOfferCatalog", "makesOffer", "itemListElement", "itemOffered", "offers"):
        if key in node:
            candidates.extend(service_candidates_from_jsonld(node[key], source))
    return candidates


def valid_service_name(name: str | None) -> bool:
    if not name or not 3 <= len(name) <= 160:
        return False
    lowered = name.casefold().strip(" .:!?|-")
    if lowered in GENERIC_HEADINGS:
        return False
    if re.fullmatch(r"(?:nos?\s+)?(?:services?|prestations?|offres?|expertises?|métiers|metiers)(?:\s+en\s+.+)?", lowered):
        return False
    return True


def is_service_container(element: Any) -> bool:
    identity = " ".join([str(element.get("id", "")), *[str(value) for value in element.get("class", [])]])
    return bool(SERVICE_SECTION_PATTERN.search(identity)) and not bool(EDITORIAL_CONTAINER_PATTERN.search(identity))


def extract_page(html: bytes, final_url: str, headers: dict[str, str]) -> dict[str, object]:
    soup = BeautifulSoup(html, "html.parser")
    robots_tokens = " ".join(
        element.get("content", "") for element in soup.select('meta[name="robots" i], meta[name="googlebot" i]')
    ).lower()
    robots_tokens += " " + headers.get("X-Robots-Tag", "").lower()
    restricted = "nosnippet" in robots_tokens or "noindex" in robots_tokens
    title = clean_text(soup.title.get_text(" ", strip=True), 240) if soup.title else None
    canonical = None
    canonical_tag = soup.select_one('link[rel~="canonical" i]')
    if canonical_tag and canonical_tag.get("href"):
        try:
            canonical = canonicalize_url(urllib.parse.urljoin(final_url, canonical_tag["href"]))
        except ValueError:
            canonical = None
    meta_description = None
    meta = soup.select_one('meta[name="description" i]')
    if meta:
        meta_description = clean_description(meta.get("content"), title)
    og_description = None
    og = soup.select_one('meta[property="og:description" i]')
    if og:
        og_description = clean_description(og.get("content"), title)

    nodes: list[dict[str, Any]] = []
    for script in soup.select('script[type="application/ld+json" i]'):
        try:
            nodes.extend(jsonld_nodes(json.loads(script.string or script.get_text())))
        except (json.JSONDecodeError, TypeError, RecursionError):
            continue
    organization_types = {
        "Organization", "Corporation", "LocalBusiness", "Store", "Restaurant",
        "ProfessionalService", "FoodEstablishment", "MedicalBusiness",
    }
    jsonld_description = next(
        (clean_description(node.get("description"), title) for node in nodes if jsonld_types(node).intersection(organization_types) and clean_description(node.get("description"), title)),
        None,
    )
    structured_types = sorted({item for node in nodes for item in jsonld_types(node)})
    services = [candidate for node in nodes for candidate in service_candidates_from_jsonld(node)]

    for container in soup.find_all(is_service_container):
        for heading in container.select("h2, h3, h4"):
            name = clean_text(heading.get_text(" ", strip=True), 160)
            if valid_service_name(name):
                services.append({"name": name, "source": "service_section_heading", "confidence": "0.65"})

    unique_services: dict[str, dict[str, str]] = {}
    for service in services:
        key = service["name"].casefold()
        if valid_service_name(service["name"]):
            existing = unique_services.get(key)
            if not existing or float(service["confidence"]) > float(existing["confidence"]):
                unique_services[key] = service

    social_links: dict[str, str] = {}
    for node in nodes:
        same_as = node.get("sameAs")
        values = [same_as] if isinstance(same_as, str) else same_as if isinstance(same_as, list) else []
        for raw in values:
            if not isinstance(raw, str):
                continue
            try:
                url = canonicalize_url(raw)
            except ValueError:
                continue
            host = (urllib.parse.urlsplit(url).hostname or "").lower().removeprefix("www.")
            platform = next((label for domain, label in SOCIAL_HOSTS.items() if host == domain or host.endswith("." + domain)), None)
            if platform:
                social_links[platform] = url

    description = jsonld_description or meta_description or og_description
    description_source = "jsonld" if jsonld_description else "meta_description" if meta_description else "open_graph" if og_description else None
    if restricted:
        description = None
        description_source = None
        unique_services = {}
        social_links = {}
    return {
        "title": title,
        "canonical_url": canonical,
        "description": description,
        "description_source": description_source,
        "services_json": json.dumps(list(unique_services.values())[:30], ensure_ascii=False),
        "social_json": json.dumps(social_links, ensure_ascii=False, sort_keys=True),
        "structured_types_json": json.dumps(structured_types[:40], ensure_ascii=False),
        "language": clean_text(soup.html.get("lang"), 20) if soup.html else None,
        "meta_robots_restricted": int(restricted),
    }


def website_sources(input_db: Path, rna_db: Path | None = None) -> list[dict[str, str]]:
    unique: dict[tuple[str, str, str], dict[str, str]] = {}

    def add_rows(rows: list[sqlite3.Row], source_origin: str) -> None:
        for row in rows:
            raw_website = str(row["website"] or "").strip()
            if not raw_website:
                continue
            try:
                url = canonicalize_url(raw_website)
            except ValueError:
                url = raw_website
            siren = str(row["siren"] or "").strip()
            siret = str(row["siret"] or "").strip()
            key = (siren, siret, url)
            existing = unique.get(key)
            if existing:
                origins = existing["source_origin"].split(" + ")
                if source_origin not in origins:
                    origins.append(source_origin)
                    existing["source_origin"] = " + ".join(origins)
                existing["source_reference_date"] = max(
                    existing["source_reference_date"], str(row["source_reference_date"] or "")
                )
                continue
            unique[key] = {
                "siren": siren,
                "siret": siret,
                "name": str(row["name"] or row["title"] or ""),
                "input_url": url,
                "source_reference_date": str(row["source_reference_date"] or ""),
                "source_origin": source_origin,
            }

    connection = sqlite3.connect(input_db)
    connection.row_factory = sqlite3.Row
    osm_rows = connection.execute(
        """SELECT siren, siret, name, website, source_reference_date, NULL AS title
           FROM osm_business_profiles
           WHERE website IS NOT NULL AND trim(website) <> ''
           ORDER BY siren, siret, website"""
    ).fetchall()
    connection.close()
    add_rows(osm_rows, "OpenStreetMap")

    if rna_db and rna_db.exists():
        connection = sqlite3.connect(rna_db)
        connection.row_factory = sqlite3.Row
        rna_rows = connection.execute(
            """SELECT siren, COALESCE(siret, '') AS siret, NULL AS name, title, website, source_reference_date
               FROM association_profiles
               WHERE website IS NOT NULL
                 AND trim(website) <> ''
                 AND website_publication_authorized = 1
               ORDER BY siren, siret, website"""
        ).fetchall()
        connection.close()
        add_rows(rna_rows, "RNA · publication autorisée")

    return list(unique.values())


def crawl_source(source: dict[str, str], limiter: DomainLimiter, timeout: float, user_agent: str) -> dict[str, object]:
    result: dict[str, object] = {
        **source, "final_url": None, "hostname": None, "robots_status": "not_checked",
        "fetch_status": "pending", "http_status": None, "title": None,
        "canonical_url": None, "description": None, "description_source": None,
        "services_json": "[]", "social_json": "{}", "structured_types_json": "[]",
        "language": None, "meta_robots_restricted": 0, "content_hash": None,
        "last_modified": None, "fetched_at": utc_now(), "error_detail": None,
    }
    try:
        url = canonicalize_url(source["input_url"])
        hostname = urllib.parse.urlsplit(url).hostname or ""
        result["hostname"] = hostname
        if registrable_platform(hostname):
            result["fetch_status"] = "skipped_platform"
            return result
        validate_public_target(url)
    except ValueError as error:
        result["fetch_status"] = "invalid_or_unsafe_url"
        result["error_detail"] = clean_text(str(error), 180)
        return result

    session = requests.Session()
    session.headers.update({"User-Agent": user_agent, "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1"})
    allowed, robots_status, robots_error = robots_decision(session, url, limiter, timeout)
    result["robots_status"] = robots_status
    if not allowed:
        result["fetch_status"] = "robots_disallowed" if robots_status == "disallowed" else "robots_unreachable"
        result["error_detail"] = robots_error
        return result
    try:
        checked_origins = {urllib.parse.urlsplit(url).netloc}

        def check_redirect(target_url: str) -> None:
            target_origin = urllib.parse.urlsplit(target_url).netloc
            if target_origin in checked_origins:
                return
            redirect_allowed, redirect_status, redirect_error = robots_decision(session, target_url, limiter, timeout)
            result["robots_status"] = redirect_status
            if not redirect_allowed:
                raise PermissionError(redirect_error or redirect_status)
            checked_origins.add(target_origin)

        response, html, final_url = fetch_limited(
            session, url, limiter, MAX_HTML_BYTES, timeout, on_redirect=check_redirect
        )
        result["http_status"] = response.status_code
        result["final_url"] = final_url
        result["hostname"] = urllib.parse.urlsplit(final_url).hostname
        result["last_modified"] = clean_text(response.headers.get("Last-Modified"), 120)
        if registrable_platform(result["hostname"] or ""):
            result["fetch_status"] = "redirected_platform"
            return result
        if not response.ok:
            result["fetch_status"] = "http_error"
            result["error_detail"] = f"HTTP {response.status_code}"
            return result
        content_type = response.headers.get("Content-Type", "").lower()
        if "html" not in content_type:
            result["fetch_status"] = "non_html"
            result["error_detail"] = clean_text(content_type, 120)
            return result
        extracted = extract_page(html, final_url, dict(response.headers))
        result.update(extracted)
        result["content_hash"] = hashlib.sha256(html).hexdigest()
        result["fetch_status"] = "meta_robots_restricted" if extracted["meta_robots_restricted"] else "ok"
        return result
    except PermissionError as error:
        result["fetch_status"] = "robots_disallowed"
        result["error_detail"] = clean_text(str(error), 180)
        return result
    except (requests.RequestException, ValueError) as error:
        result["fetch_status"] = "fetch_error"
        result["error_detail"] = clean_text(str(error), 180)
        return result


def initialise_database(output: Path, refresh: bool) -> sqlite3.Connection:
    output.parent.mkdir(parents=True, exist_ok=True)
    if refresh:
        output.unlink(missing_ok=True)
    connection = sqlite3.connect(output)
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS website_enrichments (
          siren TEXT NOT NULL,
          siret TEXT NOT NULL DEFAULT '',
          source_name TEXT,
          source_origin TEXT NOT NULL DEFAULT 'OpenStreetMap',
          input_url TEXT NOT NULL,
          final_url TEXT,
          hostname TEXT,
          source_reference_date TEXT,
          robots_status TEXT NOT NULL,
          fetch_status TEXT NOT NULL,
          http_status INTEGER,
          title TEXT,
          canonical_url TEXT,
          description TEXT,
          description_source TEXT,
          services_json TEXT NOT NULL DEFAULT '[]',
          social_json TEXT NOT NULL DEFAULT '{}',
          structured_types_json TEXT NOT NULL DEFAULT '[]',
          language TEXT,
          meta_robots_restricted INTEGER NOT NULL DEFAULT 0,
          content_hash TEXT,
          last_modified TEXT,
          fetched_at TEXT NOT NULL,
          error_detail TEXT,
          PRIMARY KEY (siren, siret, input_url)
        );
        CREATE INDEX IF NOT EXISTS idx_website_enrichments_siren ON website_enrichments (siren);
        CREATE INDEX IF NOT EXISTS idx_website_enrichments_status ON website_enrichments (fetch_status);
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        """
    )
    columns = {str(row[1]) for row in connection.execute("PRAGMA table_info(website_enrichments)")}
    if "source_origin" not in columns:
        connection.execute(
            "ALTER TABLE website_enrichments ADD COLUMN source_origin TEXT NOT NULL DEFAULT 'OpenStreetMap'"
        )
        connection.commit()
    return connection


def upsert_result(connection: sqlite3.Connection, result: dict[str, object]) -> None:
    columns = [
        "siren", "siret", "source_name", "input_url", "source_origin", "final_url", "hostname",
        "source_reference_date", "robots_status", "fetch_status", "http_status", "title",
        "canonical_url", "description", "description_source", "services_json", "social_json",
        "structured_types_json", "language", "meta_robots_restricted", "content_hash",
        "last_modified", "fetched_at", "error_detail",
    ]
    payload = {**result, "source_name": result.get("name")}
    placeholders = ",".join("?" for _ in columns)
    updates = ",".join(f"{column}=excluded.{column}" for column in columns[4:])
    connection.execute(
        f"INSERT INTO website_enrichments ({','.join(columns)}) VALUES ({placeholders}) "
        f"ON CONFLICT(siren,siret,input_url) DO UPDATE SET {updates}",
        tuple(payload.get(column) for column in columns),
    )
    connection.commit()


def write_metadata(connection: sqlite3.Connection) -> dict[str, object]:
    stats = connection.execute(
        """SELECT count(*) total,
                  count(DISTINCT siren) companies,
                  sum(fetch_status='ok') fetched,
                  sum(description IS NOT NULL) descriptions,
                  sum(services_json <> '[]') with_services,
                  sum(fetch_status='robots_disallowed') robots_disallowed,
                  sum(fetch_status='robots_unreachable') robots_unreachable,
                  sum(fetch_status IN ('skipped_platform','redirected_platform')) skipped_platforms,
                  sum(fetch_status IN ('fetch_error','http_error','invalid_or_unsafe_url','non_html')) errors,
                  sum(source_origin LIKE '%OpenStreetMap%') osm_rows,
                  sum(source_origin LIKE '%RNA%') rna_rows
           FROM website_enrichments"""
    ).fetchone()
    keys = ["total", "companies", "fetched", "descriptions", "with_services", "robots_disallowed", "robots_unreachable", "skipped_platforms", "errors", "osm_rows", "rna_rows"]
    report = dict(zip(keys, (int(value or 0) for value in stats), strict=True))
    metadata = {
        "source": "Sites publics rattachés dans OpenStreetMap",
        "methodology": "Homepage uniquement; RFC 9309; SIREN/SIRET exact; URLs OSM et URLs RNA dont la publication est autorisée; aucun HTML brut ni email",
        "generated_at": utc_now(),
        **{key: str(value) for key, value in report.items()},
    }
    connection.executemany(
        "INSERT INTO metadata (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        metadata.items(),
    )
    connection.commit()
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--rna-input", type=Path, default=DEFAULT_RNA_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--delay", type=float, default=1.0)
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--max-sites", type=int, default=0)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    if not args.input.exists():
        raise FileNotFoundError(args.input)
    user_agent = os.environ.get("WEBSITE_CRAWLER_USER_AGENT", DEFAULT_USER_AGENT)
    sources = website_sources(args.input, args.rna_input)
    if args.max_sites > 0:
        sources = sources[: args.max_sites]
    connection = initialise_database(args.output, args.refresh)
    if not args.refresh:
        existing = {
            tuple(row) for row in connection.execute("SELECT siren,siret,input_url FROM website_enrichments")
        }
        sources = [source for source in sources if (source["siren"], source["siret"], source["input_url"]) not in existing]
    limiter = DomainLimiter(max(0.1, args.delay))
    completed = 0
    with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 8))) as executor:
        futures = {executor.submit(crawl_source, source, limiter, args.timeout, user_agent): source for source in sources}
        for future in as_completed(futures):
            result = future.result()
            upsert_result(connection, result)
            completed += 1
            print(f"[{completed}/{len(sources)}] {result['fetch_status']} {result['input_url']}", flush=True)
    report = write_metadata(connection)
    connection.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
