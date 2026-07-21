"""Build an exact local index of France Relance industrial projects.

The official dataset publishes project descriptions and exact SIREN/SIRET values,
but no individual aid amount. Names are retained for display and never used to join.
"""

from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
from hashlib import sha256
import html
import io
import json
from pathlib import Path
import re
import sqlite3

import requests

try:
    from scripts.import_public_grants import compact_text, load_targets, normalize_header, parse_number
except ModuleNotFoundError:  # Direct execution with scripts/ as sys.path[0].
    from import_public_grants import compact_text, load_targets, normalize_header, parse_number  # type: ignore[no-redef]


ROOT = Path(__file__).resolve().parents[1]
DATASET_ID = "plan-de-relance-projets-industriels-liste-geolocalisation-et-description-synthetique-des-projets"
DATASET_API = f"https://www.data.gouv.fr/api/1/datasets/{DATASET_ID}/"
DATASET_URL = f"https://www.data.gouv.fr/datasets/{DATASET_ID}"
PORTAL_URL = "https://data.economie.gouv.fr/explore/dataset/plan-de-relance/"
EXPORT_URL = (
    "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/"
    "plan-de-relance/exports/csv?use_labels=false&delimiter=%2C"
)
LICENSE_NAME = "Licence Ouverte 2.0"
LICENSE_URL = "https://www.etalab.gouv.fr/licence-ouverte-open-licence/"
DEFAULT_COMPANY_DB = ROOT / "data/guadeloupe-enterprises.sqlite"
DEFAULT_CACHE_DIR = ROOT / "data/imports/france-relance-industrial"
DEFAULT_OUTPUT = ROOT / "data/france-relance-industrial-projects.sqlite"
USER_AGENT = "guadeloupe-entreprises-france-relance/0.1 (+public open-data reuse)"
MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024


def source_metadata(session: requests.Session) -> dict[str, object]:
    response = session.get(DATASET_API, timeout=30)
    response.raise_for_status()
    payload = response.json()
    resource = next(
        (
            item for item in payload.get("resources", [])
            if isinstance(item, dict)
            and str(item.get("format") or "").lower() == "csv"
            and str(item.get("title") or "").lower() == "plan-de-relance.csv"
        ),
        None,
    )
    if resource is None:
        raise RuntimeError("Ressource CSV France Relance introuvable")
    if str(payload.get("license") or "").lower() != "lov2":
        raise RuntimeError("Licence ouverte France Relance non confirmée")
    return {
        "dataset_id": str(payload.get("id") or DATASET_ID),
        "title": compact_text(payload.get("title"), 500),
        "source_updated_at": str(payload.get("last_update") or payload.get("last_modified") or ""),
        "license_code": str(payload.get("license") or ""),
        "license_name": LICENSE_NAME,
        "license_url": LICENSE_URL,
        "resource": {
            "id": str(resource.get("id") or ""),
            "title": str(resource.get("title") or "plan-de-relance.csv"),
            "url": EXPORT_URL,
            "catalog_url": str(resource.get("url") or EXPORT_URL),
            "last_modified": str(resource.get("last_modified") or ""),
        },
    }


def download_resource(
    session: requests.Session,
    resource: dict[str, object],
    cache_dir: Path,
    refresh: bool,
) -> tuple[Path, bool]:
    resource_id = str(resource["id"])
    target = cache_dir / f"{resource_id}.csv"
    sidecar = cache_dir / f"{resource_id}.metadata.json"
    signature = {
        "url": resource.get("url"),
        "last_modified": resource.get("last_modified"),
    }
    if not refresh and target.exists() and sidecar.exists():
        try:
            if json.loads(sidecar.read_text(encoding="utf-8")) == signature and target.stat().st_size > 0:
                return target, False
        except (OSError, json.JSONDecodeError):
            pass
    cache_dir.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(".csv.part")
    partial.unlink(missing_ok=True)
    downloaded = 0
    prefix = b""
    with session.get(str(resource["url"]), stream=True, timeout=(30, 120)) as response:
        response.raise_for_status()
        with partial.open("wb") as output:
            for chunk in response.iter_content(256 * 1024):
                if not chunk:
                    continue
                if not prefix:
                    prefix = chunk[:512].lstrip().lower()
                    if prefix.startswith((b"<!doctype html", b"<html")):
                        raise ValueError("La ressource France Relance renvoie du HTML")
                downloaded += len(chunk)
                if downloaded > MAX_DOWNLOAD_BYTES:
                    partial.unlink(missing_ok=True)
                    raise ValueError("Ressource France Relance trop volumineuse")
                output.write(chunk)
    partial.replace(target)
    sidecar.write_text(json.dumps(signature, ensure_ascii=False, indent=2), encoding="utf-8")
    return target, True


def decoded_csv(path: Path) -> tuple[str, str]:
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "cp1252", "latin1"):
        try:
            return raw.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    raise ValueError(f"Encodage CSV non reconnu: {path}")


def source_text(value: object, limit: int = 4_000) -> str | None:
    result = compact_text(html.unescape(str(value)) if value is not None else None, limit)
    if not result or normalize_header(result) in {"null", "none", "nan", "nr", "nonrenseigne"}:
        return None
    return result


def normalized_business_identifier(value: object) -> tuple[str | None, str | None]:
    raw = source_text(value, 64)
    if not raw:
        return None, None
    digits = re.sub(r"\D", "", re.sub(r"\.0$", "", raw.strip()))
    if len(digits) == 14:
        return digits[:9], digits
    if len(digits) == 9:
        return digits, None
    return None, None


def normalized_department_code(value: object) -> str | None:
    raw = source_text(value, 20)
    if not raw:
        return None
    return re.sub(r"\.0$", "", raw.strip()).upper()


def project_location_scope(department_code: str | None, postal_code: str | None) -> str:
    if department_code == "971" or (postal_code or "").startswith("971"):
        return "guadeloupe"
    if department_code or postal_code:
        return "outside_guadeloupe"
    return "unknown"


def parse_coordinates(value: object) -> tuple[float | None, float | None]:
    raw = source_text(value, 100)
    if not raw:
        return None, None
    parts = [part.strip() for part in raw.split(",")]
    if len(parts) != 2:
        return None, None
    try:
        latitude, longitude = float(parts[0]), float(parts[1])
    except ValueError:
        return None, None
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return None, None
    return latitude, longitude


def project_fingerprint(project: dict[str, object]) -> str:
    stable = (
        project.get("siren"), project.get("siret"), project.get("beneficiary_name"),
        project.get("measure"), project.get("measure_label"), project.get("project_description"),
        project.get("update_date"), project.get("department_code"), project.get("commune"),
    )
    return sha256("|".join(str(value or "").casefold() for value in stable).encode("utf-8")).hexdigest()


def parse_resource(
    path: Path,
    resource: dict[str, object],
    company_db: Path,
) -> tuple[list[dict[str, object]], dict[str, object]]:
    targets = load_targets(company_db)
    text, encoding = decoded_csv(path)
    sample = "\n".join(text.splitlines()[:10])
    delimiter = csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    reader = csv.DictReader(io.StringIO(text, newline=""), delimiter=delimiter)
    headers = {normalize_header(value) for value in reader.fieldnames or []}
    required = {"entreprise", "siren", "mesure", "codedepartement", "miseajour"}
    if not required.issubset(headers):
        raise ValueError(f"Colonnes France Relance manquantes: {sorted(required - headers)}")
    stats: dict[str, object] = {
        "resource_id": resource["id"], "resource_title": resource["title"],
        "encoding": encoding, "delimiter": delimiter, "rows_read": 0, "rows_with_valid_identifier": 0,
        "rows_matched": 0, "invalid_identifier_rows": 0, "active_local_siret_matches": 0,
        "company_establishment_matches": 0, "exact_siren_matches": 0,
        "guadeloupe_project_matches": 0, "outside_guadeloupe_matches": 0,
        "unknown_location_matches": 0, "matches_with_description": 0,
    }
    projects: list[dict[str, object]] = []
    for row_number, raw_row in enumerate(reader, start=2):
        stats["rows_read"] = int(stats["rows_read"]) + 1
        row = {normalize_header(key): value for key, value in raw_row.items() if key is not None}
        siren, siret = normalized_business_identifier(row.get("siren"))
        if not siren:
            stats["invalid_identifier_rows"] = int(stats["invalid_identifier_rows"]) + 1
            continue
        stats["rows_with_valid_identifier"] = int(stats["rows_with_valid_identifier"]) + 1
        if siren not in targets.company_sirens:
            continue
        beneficiary_name = source_text(row.get("entreprise"), 500)
        measure = source_text(row.get("mesure"), 1_000)
        if not beneficiary_name or not measure:
            continue
        if siret in targets.active_sirets:
            match_scope, confidence = "active_local_establishment", 1.0
            stats["active_local_siret_matches"] = int(stats["active_local_siret_matches"]) + 1
        elif siret:
            match_scope, confidence = "company_other_establishment", 0.98
            stats["company_establishment_matches"] = int(stats["company_establishment_matches"]) + 1
        else:
            match_scope, confidence = "exact_legal_unit", 0.99
            stats["exact_siren_matches"] = int(stats["exact_siren_matches"]) + 1
        department_code = normalized_department_code(row.get("codedepartement"))
        postal_code = source_text(row.get("codepostal"), 20)
        location_scope = project_location_scope(department_code, postal_code)
        location_stat = {
            "guadeloupe": "guadeloupe_project_matches",
            "outside_guadeloupe": "outside_guadeloupe_matches",
            "unknown": "unknown_location_matches",
        }[location_scope]
        stats[location_stat] = int(stats[location_stat]) + 1
        description = source_text(row.get("descriptionprojet"), 12_000)
        if description:
            stats["matches_with_description"] = int(stats["matches_with_description"]) + 1
        latitude, longitude = parse_coordinates(row.get("coordonneesgps"))
        project: dict[str, object] = {
            "source_row_number": row_number,
            "siren": siren,
            "siret": siret,
            "beneficiary_identifier": siret or siren,
            "identifier_type": "siret" if siret else "siren",
            "match_scope": match_scope,
            "match_confidence": confidence,
            "project_location_scope": location_scope,
            "beneficiary_name": beneficiary_name,
            "company_type": source_text(row.get("typeentreprise"), 100),
            "recovery_axis": source_text(row.get("voletrelance"), 300),
            "measure": measure,
            "measure_label": source_text(row.get("mesurelight"), 500),
            "project_description": description,
            "sector": source_text(row.get("filiere"), 300),
            "expected_co2_tonnes": parse_number(row.get("tonnesequivalentco2pourlesprojetsdecarbonation")),
            "update_date": source_text(row.get("miseajour"), 30),
            "region": source_text(row.get("nomregion"), 200),
            "department": source_text(row.get("nomdepartement"), 200),
            "department_code": department_code,
            "commune": source_text(row.get("nomcommune"), 200),
            "postal_code": postal_code,
            "latitude": latitude,
            "longitude": longitude,
            "resource_id": resource["id"],
            "resource_title": resource["title"],
            "resource_url": resource["url"],
            "resource_last_modified": resource.get("last_modified") or None,
        }
        project["fingerprint"] = project_fingerprint(project)
        projects.append(project)
        stats["rows_matched"] = int(stats["rows_matched"]) + 1
    return projects, stats


def build_index(
    projects: list[dict[str, object]],
    output: Path,
    metadata: dict[str, object],
    stats: dict[str, object],
    downloaded: bool,
) -> dict[str, object]:
    partial = output.with_suffix(output.suffix + ".part")
    partial.unlink(missing_ok=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(partial)
    connection.executescript("""
      CREATE TABLE france_relance_industrial_projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fingerprint TEXT NOT NULL UNIQUE,
        source_row_number INTEGER NOT NULL,
        siren TEXT NOT NULL,
        siret TEXT,
        beneficiary_identifier TEXT NOT NULL,
        identifier_type TEXT NOT NULL,
        match_scope TEXT NOT NULL,
        match_confidence REAL NOT NULL,
        project_location_scope TEXT NOT NULL,
        beneficiary_name TEXT NOT NULL,
        company_type TEXT,
        recovery_axis TEXT,
        measure TEXT NOT NULL,
        measure_label TEXT,
        project_description TEXT,
        sector TEXT,
        expected_co2_tonnes REAL,
        update_date TEXT,
        region TEXT,
        department TEXT,
        department_code TEXT,
        commune TEXT,
        postal_code TEXT,
        latitude REAL,
        longitude REAL,
        resource_id TEXT NOT NULL,
        resource_title TEXT NOT NULL,
        resource_url TEXT NOT NULL,
        resource_last_modified TEXT,
        source_updated_at TEXT NOT NULL,
        dataset_url TEXT NOT NULL,
        portal_url TEXT NOT NULL,
        license_name TEXT NOT NULL,
        license_url TEXT NOT NULL,
        imported_at TEXT NOT NULL
      );
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX france_relance_projects_siren_date_idx ON france_relance_industrial_projects(siren, update_date DESC);
      CREATE INDEX france_relance_projects_siret_idx ON france_relance_industrial_projects(siret);
      CREATE INDEX france_relance_projects_location_idx ON france_relance_industrial_projects(project_location_scope, department_code);
      CREATE INDEX france_relance_projects_measure_idx ON france_relance_industrial_projects(measure);
      CREATE INDEX france_relance_projects_sector_idx ON france_relance_industrial_projects(sector);
    """)
    imported_at = datetime.now(timezone.utc).isoformat()
    source_updated_at = str(metadata.get("source_updated_at") or "")
    columns = (
        "fingerprint", "source_row_number", "siren", "siret", "beneficiary_identifier",
        "identifier_type", "match_scope", "match_confidence", "project_location_scope",
        "beneficiary_name", "company_type", "recovery_axis", "measure", "measure_label",
        "project_description", "sector", "expected_co2_tonnes", "update_date", "region",
        "department", "department_code", "commune", "postal_code", "latitude", "longitude",
        "resource_id", "resource_title", "resource_url", "resource_last_modified",
    )
    placeholders = ",".join("?" for _ in range(len(columns) + 6))
    for project in projects:
        connection.execute(
            f"INSERT OR IGNORE INTO france_relance_industrial_projects ({','.join(columns)}, source_updated_at, dataset_url, portal_url, license_name, license_url, imported_at) VALUES ({placeholders})",
            tuple(project.get(column) for column in columns)
            + (source_updated_at, DATASET_URL, PORTAL_URL, metadata["license_name"], metadata["license_url"], imported_at),
        )
    aggregate = connection.execute(
        """SELECT COUNT(*), COUNT(DISTINCT siren),
                  SUM(project_location_scope = 'guadeloupe'),
                  SUM(project_location_scope = 'outside_guadeloupe'),
                  SUM(project_location_scope = 'unknown'),
                  SUM(match_scope = 'active_local_establishment'),
                  SUM(project_description IS NOT NULL),
                  SUM(expected_co2_tonnes IS NOT NULL),
                  COUNT(DISTINCT measure), COUNT(DISTINCT sector),
                  MIN(update_date), MAX(update_date)
           FROM france_relance_industrial_projects"""
    ).fetchone()
    report = {
        "source": metadata.get("title"),
        "source_url": DATASET_URL,
        "portal_url": PORTAL_URL,
        "source_updated_at": source_updated_at,
        "license": metadata.get("license_name"),
        "license_url": metadata.get("license_url"),
        "imported_at": imported_at,
        "downloaded_resource_count": int(downloaded),
        "cached_resource_count": int(not downloaded),
        "source_rows": int(stats["rows_read"]),
        "rows_with_valid_identifier": int(stats["rows_with_valid_identifier"]),
        "invalid_identifier_rows": int(stats["invalid_identifier_rows"]),
        "rows_matched": int(stats["rows_matched"]),
        "unique_projects": aggregate[0],
        "matched_companies": aggregate[1],
        "guadeloupe_project_count": aggregate[2] or 0,
        "outside_guadeloupe_project_count": aggregate[3] or 0,
        "unknown_location_project_count": aggregate[4] or 0,
        "active_local_establishment_count": aggregate[5] or 0,
        "projects_with_description": aggregate[6] or 0,
        "projects_with_co2_metric": aggregate[7] or 0,
        "measure_count": aggregate[8] or 0,
        "sector_count": aggregate[9] or 0,
        "earliest_update_date": aggregate[10],
        "latest_update_date": aggregate[11],
        "resource_stats": stats,
        "individual_amounts_available": False,
        "join_uses_names": False,
        "database": str(output),
    }
    for key, value in report.items():
        if key in {"database", "resource_stats"}:
            continue
        encoded = json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list, bool)) else str(value or "")
        connection.execute("INSERT INTO metadata(key, value) VALUES (?, ?)", (key, encoded))
    connection.commit()
    connection.execute("ANALYZE")
    connection.close()
    partial.replace(output)
    output.with_suffix(".report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--company-db", type=Path, default=DEFAULT_COMPANY_DB)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--skip-download", action="store_true")
    args = parser.parse_args()

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json,text/csv;q=0.9"})
    metadata = source_metadata(session)
    resource = metadata["resource"]
    if args.skip_download:
        path = args.cache_dir / f"{resource['id']}.csv"
        if not path.exists():
            raise SystemExit(f"Ressource France Relance absente du cache: {path}")
        downloaded = False
    else:
        path, downloaded = download_resource(session, resource, args.cache_dir, args.refresh)
    projects, stats = parse_resource(path, resource, args.company_db)
    print(json.dumps(build_index(projects, args.output, metadata, stats, downloaded), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
