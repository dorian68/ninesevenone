"""Build an exact, non-personal ICPE intelligence index for Guadeloupe.

The official Géorisques API is queried at department level. Only rows carrying
an exact SIRET whose active legal unit is public in the territorial SIRENE stock
are retained. Public report links are indexed, but documents and source names
are never downloaded or copied.
"""

from __future__ import annotations

import argparse
from datetime import date, datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import sqlite3
from urllib.parse import urljoin, urlparse

import requests

try:
    from scripts.import_public_grants import compact_text
except ModuleNotFoundError:  # Direct execution with scripts/ as sys.path[0].
    from import_public_grants import compact_text  # type: ignore[no-redef]


ROOT = Path(__file__).resolve().parents[1]
OPENAPI_URL = "https://www.georisques.gouv.fr/api/v3/api-docs/georisques-api-v1"
API_URL = "https://www.georisques.gouv.fr/api/v1/installations_classees"
SOURCE_PAGE = "https://www.georisques.gouv.fr/donnees/bases-de-donnees/installations-industrielles"
DETAIL_BASE_URL = "https://www.georisques.gouv.fr/risques/installations/donnees/details/"
LICENSE_NAME = "Licence Ouverte 2.0"
LICENSE_URL = "https://github.com/etalab/licence-ouverte/blob/master/LO.md"
DEPARTMENT = "971"
DEFAULT_COMPANY_DB = ROOT / "data/guadeloupe-enterprises.sqlite"
DEFAULT_CACHE_DIR = ROOT / "data/imports/georisques-icpe"
DEFAULT_OUTPUT = ROOT / "data/georisques-icpe.sqlite"
USER_AGENT = "guadeloupe-entreprises-icpe/0.1 (+public open-data reuse)"
ALLOWED_HOSTS = {"georisques.gouv.fr", "www.georisques.gouv.fr"}


def source_metadata(session: requests.Session) -> dict[str, object]:
    response = session.get(OPENAPI_URL, timeout=45)
    response.raise_for_status()
    payload = response.json()
    endpoint = payload.get("paths", {}).get("/api/v1/installations_classees", {}).get("get", {})
    parameters = {item.get("name") for item in endpoint.get("parameters", []) if isinstance(item, dict)}
    schema = payload.get("components", {}).get("schemas", {}).get("InstallationClasseeModel", {})
    properties = set(schema.get("properties", {}))
    required_parameters = {"departement", "page", "page_size"}
    required_properties = {"codeAIOT", "siret", "regime", "inspections", "rubriques", "date_maj"}
    if not required_parameters.issubset(parameters) or not required_properties.issubset(properties):
        raise RuntimeError("Contrat OpenAPI Géorisques ICPE incompatible")
    return {
        "api_title": compact_text(payload.get("info", {}).get("title"), 300),
        "api_version": compact_text(payload.get("info", {}).get("version"), 50),
        "openapi_url": OPENAPI_URL,
        "api_url": API_URL,
        "source_url": SOURCE_PAGE,
        "license_name": LICENSE_NAME,
        "license_url": LICENSE_URL,
        "department": DEPARTMENT,
    }


def fetch_payload(
    session: requests.Session, cache_dir: Path, refresh: bool,
) -> tuple[dict[str, object], dict[str, object]]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_date = date.today().isoformat()
    target = cache_dir / f"icpe-{DEPARTMENT}-{cache_date}.json"
    if not refresh and target.exists():
        payload = json.loads(target.read_text(encoding="utf-8"))
        validate_payload(payload)
        return payload, {"cache_hit": True, "api_calls": 0, "cache_path": str(target)}
    response = session.get(
        API_URL,
        params={"departement": DEPARTMENT, "page_size": 1_000, "page": 1},
        timeout=(20, 120),
    )
    response.raise_for_status()
    payload = response.json()
    validate_payload(payload)
    if int(payload.get("total_pages") or 0) != 1:
        raise RuntimeError("Pagination ICPE inattendue pour le département 971")
    partial = target.with_suffix(".json.part")
    partial.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    partial.replace(target)
    return payload, {"cache_hit": False, "api_calls": 1, "cache_path": str(target)}


def validate_payload(payload: object) -> None:
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        raise ValueError("Réponse ICPE invalide")
    if int(payload.get("response_code") or 200) != 200:
        raise ValueError(f"Réponse ICPE en erreur: {payload.get('message')}")
    if int(payload.get("results") or -1) != len(payload["data"]):
        raise ValueError("Décompte ICPE incohérent")


def normalized_siret(value: object) -> str | None:
    raw = compact_text(value, 32)
    return raw if raw and re.fullmatch(r"\d{14}", raw) else None


def normalized_date(value: object) -> str | None:
    raw = compact_text(value, 64)
    if not raw:
        return None
    match = re.match(r"^(\d{4}-\d{2}-\d{2})", raw)
    if not match:
        return None
    try:
        date.fromisoformat(match.group(1))
    except ValueError:
        return None
    return match.group(1)


def normalized_source_timestamp(value: object) -> str | None:
    raw = compact_text(value, 64)
    if not raw:
        return None
    match = re.fullmatch(r"(\d{4}-\d{2}-\d{2})/(\d{2})-(\d{2})-(\d{2})", raw)
    if match:
        return f"{match.group(1)}T{match.group(2)}:{match.group(3)}:{match.group(4)}Z"
    return raw


def safe_document_url(value: object) -> str | None:
    raw = compact_text(value, 2_000)
    if not raw:
        return None
    absolute = urljoin("https://www.georisques.gouv.fr", raw)
    parsed = urlparse(absolute)
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
        return None
    return absolute


def load_targets(company_db: Path) -> tuple[set[str], dict[str, tuple[str, str]]]:
    connection = sqlite3.connect(company_db)
    company_sirens = {
        row[0] for row in connection.execute(
            "SELECT siren FROM companies WHERE administrative_status='A' AND diffusion_status!='N'"
        )
    }
    establishments = {
        row[0]: (row[1] or "", row[2] or "")
        for row in connection.execute(
            "SELECT siret, administrative_status, diffusion_status FROM establishments"
        )
    }
    connection.close()
    return company_sirens, establishments


def installation_fingerprint(item: dict[str, object]) -> str:
    return sha256(f"{item['aiot_code']}|{item['siret']}".encode()).hexdigest()


def document_fingerprint(aiot_code: str, category: str, item: dict[str, object]) -> str:
    stable = (aiot_code, category, item.get("document_date"), item.get("document_type"), item.get("document_url"))
    return sha256("|".join(str(value or "") for value in stable).encode()).hexdigest()


def parse_payload(
    payload: dict[str, object], company_db: Path,
) -> tuple[list[dict[str, object]], dict[str, int]]:
    company_sirens, establishments = load_targets(company_db)
    stats = {
        "source_rows": 0, "invalid_siret_rows": 0, "out_of_scope_rows": 0,
        "matched_rows": 0, "active_siret_matches": 0, "historical_siret_matches": 0,
        "duplicate_aiot_rows": 0, "invalid_document_urls": 0,
        "inspection_count": 0, "rubric_count": 0, "other_document_count": 0,
    }
    installations: dict[str, dict[str, object]] = {}
    for raw in payload["data"]:
        stats["source_rows"] += 1
        if not isinstance(raw, dict):
            stats["invalid_siret_rows"] += 1
            continue
        siret = normalized_siret(raw.get("siret"))
        if not siret:
            stats["invalid_siret_rows"] += 1
            continue
        siren = siret[:9]
        if siren not in company_sirens:
            stats["out_of_scope_rows"] += 1
            continue
        status, diffusion = establishments.get(siret, ("", ""))
        match_scope = "exact_active_siret" if status == "A" and diffusion != "N" else "exact_company_historical_siret"
        aiot_code = compact_text(raw.get("codeAIOT"), 32)
        if not aiot_code or not re.fullmatch(r"\d{10}", aiot_code):
            stats["out_of_scope_rows"] += 1
            continue
        inspections = []
        for source in raw.get("inspections") or []:
            if not isinstance(source, dict):
                continue
            document = source.get("fichierInspection") if isinstance(source.get("fichierInspection"), dict) else {}
            url = safe_document_url(document.get("urlFichier"))
            if document.get("urlFichier") and not url:
                stats["invalid_document_urls"] += 1
            item = {
                "inspection_date": normalized_date(source.get("dateInspection")),
                "document_date": normalized_date(document.get("dateFichier")),
                "document_type": compact_text(document.get("typeFichier"), 300),
                "document_url": url,
            }
            item["fingerprint"] = document_fingerprint(aiot_code, "inspection", item)
            inspections.append(item)
        rubrics = []
        for source in raw.get("rubriques") or []:
            if not isinstance(source, dict):
                continue
            number = compact_text(source.get("numeroRubrique"), 32)
            if not number:
                continue
            rubrics.append({
                "rubric_number": number,
                "nature": compact_text(source.get("nature"), 2_000),
                "paragraph": compact_text(source.get("alinea"), 300),
                "authorized_regime": compact_text(source.get("regimeAutoriseAlinea"), 300),
                "total_quantity": compact_text(source.get("quantiteTotale"), 500),
                "unit": compact_text(source.get("unite"), 200),
                "reason_date": normalized_date(source.get("dateMotif")),
            })
        documents = []
        for source in raw.get("documentsHorsInspection") or []:
            if not isinstance(source, dict):
                continue
            url = safe_document_url(source.get("urlFichier"))
            if source.get("urlFichier") and not url:
                stats["invalid_document_urls"] += 1
            item = {
                "document_date": normalized_date(source.get("dateFichier")),
                "document_type": compact_text(source.get("typeFichier"), 300),
                "document_url": url,
            }
            item["fingerprint"] = document_fingerprint(aiot_code, "administrative", item)
            documents.append(item)
        source_updated_at = normalized_source_timestamp(raw.get("date_maj"))
        item: dict[str, object] = {
            "aiot_code": aiot_code,
            "siren": siren,
            "siret": siret,
            "match_scope": match_scope,
            "address_line_1": compact_text(raw.get("adresse1"), 500),
            "address_line_2": compact_text(raw.get("adresse2"), 500),
            "address_line_3": compact_text(raw.get("adresse3"), 500),
            "postal_code": compact_text(raw.get("codePostal"), 20),
            "commune_code": compact_text(raw.get("codeInsee"), 20),
            "commune": compact_text(raw.get("commune"), 300),
            "naf_division": compact_text(raw.get("codeNaf"), 10),
            "longitude": raw.get("longitude") if isinstance(raw.get("longitude"), (int, float)) else None,
            "latitude": raw.get("latitude") if isinstance(raw.get("latitude"), (int, float)) else None,
            "has_cattle": bool(raw.get("bovins")),
            "has_pigs": bool(raw.get("porcs")),
            "has_poultry": bool(raw.get("volailles")),
            "is_quarry": bool(raw.get("carriere")),
            "is_wind_farm": bool(raw.get("eolienne")),
            "is_industry": bool(raw.get("industrie")),
            "national_priority": bool(raw.get("prioriteNationale")),
            "seveso_status": compact_text(raw.get("statutSeveso"), 100),
            "ied": bool(raw.get("ied")),
            "activity_status": compact_text(raw.get("etatActivite"), 300),
            "inspection_service": compact_text(raw.get("serviceAIOT"), 300),
            "regime": compact_text(raw.get("regime"), 300),
            "source_updated_at": source_updated_at,
            "detail_url": f"{DETAIL_BASE_URL}{aiot_code}",
            "inspections": inspections,
            "rubrics": rubrics,
            "documents": documents,
        }
        item["fingerprint"] = installation_fingerprint(item)
        existing = installations.get(aiot_code)
        if existing is not None:
            stats["duplicate_aiot_rows"] += 1
            if str(item.get("source_updated_at") or "") > str(existing.get("source_updated_at") or ""):
                installations[aiot_code] = item
            continue
        installations[aiot_code] = item
        stats["matched_rows"] += 1
        stats["active_siret_matches" if match_scope == "exact_active_siret" else "historical_siret_matches"] += 1
        stats["inspection_count"] += len(inspections)
        stats["rubric_count"] += len(rubrics)
        stats["other_document_count"] += len(documents)
    return list(installations.values()), stats


def build_index(
    output: Path, installations: list[dict[str, object]], metadata: dict[str, object],
    pipeline: dict[str, object],
) -> dict[str, object]:
    output.parent.mkdir(parents=True, exist_ok=True)
    partial = output.with_suffix(output.suffix + ".part")
    partial.unlink(missing_ok=True)
    connection = sqlite3.connect(partial)
    connection.executescript("""
      PRAGMA foreign_keys=ON;
      CREATE TABLE icpe_installations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, fingerprint TEXT NOT NULL UNIQUE,
        aiot_code TEXT NOT NULL UNIQUE, siren TEXT NOT NULL, siret TEXT NOT NULL,
        match_scope TEXT NOT NULL CHECK(match_scope IN ('exact_active_siret','exact_company_historical_siret')),
        address_line_1 TEXT, address_line_2 TEXT, address_line_3 TEXT,
        postal_code TEXT, commune_code TEXT, commune TEXT, naf_division TEXT,
        longitude REAL, latitude REAL, has_cattle INTEGER NOT NULL, has_pigs INTEGER NOT NULL,
        has_poultry INTEGER NOT NULL, is_quarry INTEGER NOT NULL, is_wind_farm INTEGER NOT NULL,
        is_industry INTEGER NOT NULL, national_priority INTEGER NOT NULL, seveso_status TEXT,
        ied INTEGER NOT NULL, activity_status TEXT, inspection_service TEXT, regime TEXT,
        source_updated_at TEXT, detail_url TEXT NOT NULL, dataset_url TEXT NOT NULL,
        license_name TEXT NOT NULL, license_url TEXT NOT NULL, imported_at TEXT NOT NULL
      );
      CREATE TABLE icpe_inspections (
        id INTEGER PRIMARY KEY AUTOINCREMENT, installation_id INTEGER NOT NULL REFERENCES icpe_installations(id) ON DELETE CASCADE,
        fingerprint TEXT NOT NULL UNIQUE, inspection_date TEXT, document_date TEXT,
        document_type TEXT, document_url TEXT
      );
      CREATE TABLE icpe_rubrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT, installation_id INTEGER NOT NULL REFERENCES icpe_installations(id) ON DELETE CASCADE,
        rubric_number TEXT NOT NULL, nature TEXT, paragraph TEXT, authorized_regime TEXT,
        total_quantity TEXT, unit TEXT, reason_date TEXT
      );
      CREATE TABLE icpe_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT, installation_id INTEGER NOT NULL REFERENCES icpe_installations(id) ON DELETE CASCADE,
        fingerprint TEXT NOT NULL UNIQUE, document_date TEXT, document_type TEXT, document_url TEXT
      );
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX icpe_siren_idx ON icpe_installations(siren, source_updated_at DESC);
      CREATE INDEX icpe_siret_idx ON icpe_installations(siret);
      CREATE INDEX icpe_inspection_date_idx ON icpe_inspections(installation_id, inspection_date DESC);
      CREATE INDEX icpe_rubric_idx ON icpe_rubrics(installation_id, rubric_number);
      CREATE INDEX icpe_document_date_idx ON icpe_documents(installation_id, document_date DESC);
    """)
    imported_at = datetime.now(timezone.utc).isoformat()
    bool_fields = {"has_cattle", "has_pigs", "has_poultry", "is_quarry", "is_wind_farm", "is_industry", "national_priority", "ied"}
    fields = (
        "fingerprint", "aiot_code", "siren", "siret", "match_scope", "address_line_1",
        "address_line_2", "address_line_3", "postal_code", "commune_code", "commune",
        "naf_division", "longitude", "latitude", "has_cattle", "has_pigs", "has_poultry",
        "is_quarry", "is_wind_farm", "is_industry", "national_priority", "seveso_status",
        "ied", "activity_status", "inspection_service", "regime", "source_updated_at", "detail_url",
    )
    for item in installations:
        values = [int(bool(item.get(field))) if field in bool_fields else item.get(field) for field in fields]
        cursor = connection.execute(
            f"INSERT INTO icpe_installations ({','.join(fields)},dataset_url,license_name,license_url,imported_at) VALUES ({','.join('?' for _ in range(len(fields)+4))})",
            (*values, metadata["source_url"], metadata["license_name"], metadata["license_url"], imported_at),
        )
        installation_id = int(cursor.lastrowid)
        connection.executemany(
            "INSERT OR IGNORE INTO icpe_inspections(installation_id,fingerprint,inspection_date,document_date,document_type,document_url) VALUES (?,?,?,?,?,?)",
            [(installation_id, row["fingerprint"], row["inspection_date"], row["document_date"], row["document_type"], row["document_url"]) for row in item["inspections"]],
        )
        connection.executemany(
            "INSERT INTO icpe_rubrics(installation_id,rubric_number,nature,paragraph,authorized_regime,total_quantity,unit,reason_date) VALUES (?,?,?,?,?,?,?,?)",
            [(installation_id, row["rubric_number"], row["nature"], row["paragraph"], row["authorized_regime"], row["total_quantity"], row["unit"], row["reason_date"]) for row in item["rubrics"]],
        )
        connection.executemany(
            "INSERT OR IGNORE INTO icpe_documents(installation_id,fingerprint,document_date,document_type,document_url) VALUES (?,?,?,?,?)",
            [(installation_id, row["fingerprint"], row["document_date"], row["document_type"], row["document_url"]) for row in item["documents"]],
        )
    aggregate = connection.execute("""
      SELECT COUNT(*), COUNT(DISTINCT siren), SUM(match_scope='exact_active_siret'),
        SUM(regime='Autorisation'), SUM(regime='Enregistrement'),
        SUM(COALESCE(seveso_status,'') LIKE 'Seveso%'), SUM(ied=1), SUM(national_priority=1),
        MIN(source_updated_at), MAX(source_updated_at)
      FROM icpe_installations
    """).fetchone()
    report = {
        "installation_count": int(aggregate[0] or 0), "company_count": int(aggregate[1] or 0),
        "active_siret_count": int(aggregate[2] or 0), "authorization_count": int(aggregate[3] or 0),
        "registration_count": int(aggregate[4] or 0), "seveso_count": int(aggregate[5] or 0),
        "ied_count": int(aggregate[6] or 0), "national_priority_count": int(aggregate[7] or 0),
        "earliest_source_update": aggregate[8], "latest_source_update": aggregate[9],
        "inspection_count": int(connection.execute("SELECT COUNT(*) FROM icpe_inspections").fetchone()[0]),
        "rubric_count": int(connection.execute("SELECT COUNT(*) FROM icpe_rubrics").fetchone()[0]),
        "other_document_count": int(connection.execute("SELECT COUNT(*) FROM icpe_documents").fetchone()[0]),
        "contains_source_person_names": False, "downloads_documents": False,
        "scope": "exact_siret_or_legal_unit_historical_siret", "imported_at": imported_at,
    }
    metadata_rows = {"source": "Géorisques ICPE", **metadata, **report, "pipeline": pipeline}
    connection.executemany(
        "INSERT INTO metadata(key,value) VALUES (?,?)",
        [(key, json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list, bool)) else str(value or "")) for key, value in metadata_rows.items()],
    )
    connection.commit()
    connection.execute("ANALYZE")
    connection.close()
    if output.exists():
        output.unlink()
    partial.replace(output)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--company-db", type=Path, default=DEFAULT_COMPANY_DB)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    metadata = source_metadata(session)
    payload, fetch_stats = fetch_payload(session, args.cache_dir, args.refresh)
    installations, parse_stats = parse_payload(payload, args.company_db)
    report = build_index(args.output, installations, metadata, {"fetch": fetch_stats, "parse": parse_stats})
    report_path = args.output.with_suffix(".report.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
