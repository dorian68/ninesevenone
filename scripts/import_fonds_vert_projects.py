"""Build an exact local index of funded Fonds vert projects.

Only official CSV resources carrying a beneficiary SIREN or SIRET are joined.
Names are retained for display but are never used as matching keys.
"""

from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
from hashlib import sha256
import io
import json
from pathlib import Path
import re
import sqlite3

import requests

try:
    from scripts.import_public_grants import (
        compact_text,
        load_targets,
        normalize_header,
        parse_number,
    )
except ModuleNotFoundError:  # Direct execution with scripts/ as sys.path[0].
    from import_public_grants import (  # type: ignore[no-redef]
        compact_text,
        load_targets,
        normalize_header,
        parse_number,
    )


ROOT = Path(__file__).resolve().parents[1]
DATASET_ID = "fonds-vert-liste-des-projets-subventionnes"
DATASET_API = f"https://www.data.gouv.fr/api/1/datasets/{DATASET_ID}/"
DATASET_URL = f"https://www.data.gouv.fr/datasets/{DATASET_ID}"
LICENSE_NAME = "Licence Ouverte 2.0"
LICENSE_URL = "https://www.etalab.gouv.fr/licence-ouverte-open-licence/"
DEFAULT_COMPANY_DB = ROOT / "data/guadeloupe-enterprises.sqlite"
DEFAULT_CACHE_DIR = ROOT / "data/imports/fonds-vert"
DEFAULT_OUTPUT = ROOT / "data/fonds-vert-projects.sqlite"
USER_AGENT = "guadeloupe-entreprises-fonds-vert/0.1 (+public open-data reuse)"
MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024
RESOURCE_TITLE = re.compile(r"^fonds-vert-(2023|2024|2025)-export\.csv$", re.I)


def source_metadata(session: requests.Session) -> dict[str, object]:
    response = session.get(DATASET_API, timeout=30)
    response.raise_for_status()
    payload = response.json()
    resources = []
    excluded = []
    for raw in payload.get("resources", []):
        if not isinstance(raw, dict) or str(raw.get("format") or "").lower() != "csv":
            continue
        title = str(raw.get("title") or "")
        target = resources if RESOURCE_TITLE.fullmatch(title) else excluded
        target.append({
            "id": str(raw.get("id") or ""),
            "title": title,
            "url": str(raw.get("url") or ""),
            "last_modified": str(raw.get("last_modified") or ""),
            "filesize": int(raw.get("filesize") or 0),
            "checksum": raw.get("checksum"),
        })
    if not resources:
        raise RuntimeError("Aucune ressource Fonds vert identifiable")
    return {
        "dataset_id": str(payload.get("id") or DATASET_ID),
        "title": compact_text(payload.get("title"), 500),
        "source_updated_at": str(payload.get("last_update") or payload.get("last_modified") or ""),
        "license_code": str(payload.get("license") or ""),
        "license_name": LICENSE_NAME,
        "license_url": LICENSE_URL,
        "resources": resources,
        "excluded_csv_resources": excluded,
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
        "filesize": resource.get("filesize"),
        "checksum": resource.get("checksum"),
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
                        raise ValueError(f"La ressource {resource_id} renvoie du HTML")
                downloaded += len(chunk)
                if downloaded > MAX_DOWNLOAD_BYTES:
                    partial.unlink(missing_ok=True)
                    raise ValueError(f"Ressource Fonds vert trop volumineuse: {resource_id}")
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


def project_fingerprint(project: dict[str, object]) -> str:
    stable = [
        project.get("year"), project.get("beneficiary_identifier"),
        project.get("project_name"), f"{float(project.get('committed_amount') or 0):.2f}",
        project.get("dossier_number"), project.get("commitment_number"),
        project.get("commune_code"), project.get("scheme"),
    ]
    return sha256("|".join(str(value or "").casefold() for value in stable).encode("utf-8")).hexdigest()


def project_location_scope(department_code: str | None, commune_code: str | None) -> str:
    department = re.sub(r"\s+", "", department_code or "").upper()
    commune = re.sub(r"\s+", "", commune_code or "").upper()
    if department == "971" or commune.startswith("971"):
        return "guadeloupe"
    if department or commune:
        return "outside_guadeloupe"
    return "unknown"


def normalized_business_identifier(value: object) -> tuple[str | None, str | None]:
    raw = compact_text(value, 64)
    if not raw:
        return None, None
    # The 2023 export mixes SIREN, SIRET and spreadsheet-style `123456789.0` values.
    cleaned = re.sub(r"\.0$", "", raw.strip())
    digits = re.sub(r"\D", "", cleaned)
    if len(digits) == 14:
        return digits[:9], digits
    if len(digits) == 9:
        return digits, None
    return None, None


def source_text(value: object, limit: int = 1_000) -> str | None:
    result = compact_text(value, limit)
    if not result or normalize_header(result) in {"null", "none", "nan", "nr", "nonrenseigne"}:
        return None
    return result


def parse_resource(
    path: Path,
    resource: dict[str, object],
    company_db: Path,
) -> tuple[list[dict[str, object]], dict[str, object]]:
    targets = load_targets(company_db)
    title = str(resource["title"])
    year_match = RESOURCE_TITLE.fullmatch(title)
    if not year_match:
        raise ValueError(f"Titre Fonds vert non pris en charge: {title}")
    year = int(year_match.group(1))
    text, encoding = decoded_csv(path)
    sample = "\n".join(text.splitlines()[:10])
    delimiter = csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    reader = csv.DictReader(io.StringIO(text, newline=""), delimiter=delimiter)
    normalized_headers = {normalize_header(value) for value in reader.fieldnames or []}
    identifier_header = "siren" if year == 2023 else "siretbeneficiaire"
    required = {identifier_header, "nomduprojet", "montantengage"}
    if not required.issubset(normalized_headers):
        raise ValueError(f"Colonnes Fonds vert manquantes pour {year}: {sorted(required - normalized_headers)}")

    stats: dict[str, object] = {
        "resource_id": resource["id"], "resource_title": title, "year": year,
        "encoding": encoding, "delimiter": delimiter, "rows_read": 0,
        "rows_with_valid_identifier": 0, "rows_matched": 0,
        "active_local_siret_matches": 0, "company_establishment_matches": 0,
        "exact_siren_matches": 0, "local_project_matches": 0, "invalid_rows": 0,
    }
    projects: list[dict[str, object]] = []
    for row_number, raw_row in enumerate(reader, start=2):
        stats["rows_read"] = int(stats["rows_read"]) + 1
        row = {normalize_header(key): value for key, value in raw_row.items() if key is not None}
        siren, siret = normalized_business_identifier(
            row.get("siretbeneficiaire") or row.get("siren")
        )
        if not siren:
            stats["invalid_rows"] = int(stats["invalid_rows"]) + 1
            continue
        stats["rows_with_valid_identifier"] = int(stats["rows_with_valid_identifier"]) + 1
        if siren not in targets.company_sirens:
            continue
        amount = parse_number(row.get("montantengage"))
        project_name = source_text(row.get("nomduprojet"), 2_000)
        beneficiary_name = source_text(
            row.get("raisonsocialebeneficiaire") or row.get("nombeneficiaireprincipal"), 500
        )
        if amount is None or not project_name or not beneficiary_name:
            stats["invalid_rows"] = int(stats["invalid_rows"]) + 1
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
        department_code = source_text(row.get("codedepartement"), 20)
        commune_code = source_text(row.get("codecommune"), 20)
        location_scope = project_location_scope(department_code, commune_code)
        if location_scope == "guadeloupe":
            stats["local_project_matches"] = int(stats["local_project_matches"]) + 1
        project: dict[str, object] = {
            "source_row_number": row_number,
            "year": year,
            "siren": siren,
            "siret": siret,
            "beneficiary_identifier": siret or siren,
            "identifier_type": "siret" if siret else "siren",
            "match_scope": match_scope,
            "match_confidence": confidence,
            "project_location_scope": location_scope,
            "project_name": project_name,
            "project_summary": source_text(row.get("resumeduprojet"), 4_000),
            "committed_amount": amount,
            "beneficiary_name": beneficiary_name,
            "beneficiary_legal_form": source_text(row.get("formejuridiquebeneficiaire"), 300),
            "dossier_number": source_text(row.get("numerodossierds"), 100),
            "commitment_number": source_text(row.get("numeroej"), 100),
            "operator_number": source_text(row.get("numerooperateur"), 100),
            "operator": source_text(row.get("operateur"), 300),
            "scheme": source_text(row.get("demarche") or row.get("nomdemarcheds"), 1_000),
            "axis": source_text(row.get("axe"), 300),
            "region": source_text(row.get("nomregion"), 200),
            "department": source_text(row.get("nomdepartement"), 200),
            "department_code": department_code,
            "commune": source_text(row.get("nomcommune"), 200),
            "commune_code": commune_code,
            "resource_id": resource["id"],
            "resource_title": title,
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
    resource_stats: list[dict[str, object]],
    download_count: int,
) -> dict[str, object]:
    partial = output.with_suffix(output.suffix + ".part")
    partial.unlink(missing_ok=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(partial)
    connection.executescript("""
      CREATE TABLE fonds_vert_projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fingerprint TEXT NOT NULL UNIQUE,
        source_row_number INTEGER NOT NULL,
        year INTEGER NOT NULL,
        siren TEXT NOT NULL,
        siret TEXT,
        beneficiary_identifier TEXT NOT NULL,
        identifier_type TEXT NOT NULL,
        match_scope TEXT NOT NULL,
        match_confidence REAL NOT NULL,
        project_location_scope TEXT NOT NULL,
        project_name TEXT NOT NULL,
        project_summary TEXT,
        committed_amount REAL NOT NULL,
        beneficiary_name TEXT NOT NULL,
        beneficiary_legal_form TEXT,
        dossier_number TEXT,
        commitment_number TEXT,
        operator_number TEXT,
        operator TEXT,
        scheme TEXT,
        axis TEXT,
        region TEXT,
        department TEXT,
        department_code TEXT,
        commune TEXT,
        commune_code TEXT,
        resource_id TEXT NOT NULL,
        resource_title TEXT NOT NULL,
        resource_url TEXT NOT NULL,
        resource_last_modified TEXT,
        source_updated_at TEXT NOT NULL,
        dataset_url TEXT NOT NULL,
        license_name TEXT NOT NULL,
        license_url TEXT NOT NULL,
        imported_at TEXT NOT NULL
      );
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX fonds_vert_projects_siren_year_idx ON fonds_vert_projects(siren, year DESC);
      CREATE INDEX fonds_vert_projects_siret_idx ON fonds_vert_projects(siret);
      CREATE INDEX fonds_vert_projects_location_idx ON fonds_vert_projects(project_location_scope, commune_code);
      CREATE INDEX fonds_vert_projects_scheme_idx ON fonds_vert_projects(scheme);
    """)
    imported_at = datetime.now(timezone.utc).isoformat()
    source_updated_at = str(metadata.get("source_updated_at") or "")
    columns = (
        "fingerprint", "source_row_number", "year", "siren", "siret",
        "beneficiary_identifier", "identifier_type", "match_scope", "match_confidence",
        "project_location_scope", "project_name", "project_summary", "committed_amount",
        "beneficiary_name", "beneficiary_legal_form", "dossier_number", "commitment_number",
        "operator_number", "operator", "scheme", "axis", "region", "department",
        "department_code", "commune", "commune_code", "resource_id", "resource_title",
        "resource_url", "resource_last_modified",
    )
    placeholders = ",".join("?" for _ in range(len(columns) + 5))
    for project in projects:
        connection.execute(
            f"INSERT OR IGNORE INTO fonds_vert_projects ({','.join(columns)}, source_updated_at, dataset_url, license_name, license_url, imported_at) VALUES ({placeholders})",
            tuple(project.get(column) for column in columns)
            + (source_updated_at, DATASET_URL, metadata["license_name"], metadata["license_url"], imported_at),
        )
    aggregate = connection.execute(
        """SELECT COUNT(*), COUNT(DISTINCT siren), SUM(committed_amount),
                  SUM(project_location_scope = 'guadeloupe'),
                  SUM(CASE WHEN project_location_scope = 'guadeloupe' THEN committed_amount ELSE 0 END),
                  SUM(project_location_scope = 'outside_guadeloupe'),
                  SUM(CASE WHEN project_location_scope = 'outside_guadeloupe' THEN committed_amount ELSE 0 END),
                  SUM(project_location_scope = 'unknown'),
                  SUM(match_scope = 'active_local_establishment'),
                  SUM(CASE WHEN match_scope = 'active_local_establishment' THEN committed_amount ELSE 0 END),
                  MIN(year), MAX(year), COUNT(DISTINCT resource_id), COUNT(DISTINCT scheme)
           FROM fonds_vert_projects"""
    ).fetchone()
    report = {
        "source": metadata.get("title"),
        "source_url": DATASET_URL,
        "source_updated_at": source_updated_at,
        "license": metadata.get("license_name"),
        "license_url": metadata.get("license_url"),
        "imported_at": imported_at,
        "downloaded_resource_count": download_count,
        "cached_resource_count": len(resource_stats) - download_count,
        "imported_resource_count": len(resource_stats),
        "excluded_csv_resource_count": len(metadata.get("excluded_csv_resources", [])),
        "source_rows": sum(int(item["rows_read"]) for item in resource_stats),
        "rows_with_valid_identifier": sum(int(item["rows_with_valid_identifier"]) for item in resource_stats),
        "rows_matched": sum(int(item["rows_matched"]) for item in resource_stats),
        "unique_projects": aggregate[0],
        "matched_companies": aggregate[1],
        "total_committed_amount": aggregate[2] or 0,
        "guadeloupe_project_count": aggregate[3] or 0,
        "guadeloupe_committed_amount": aggregate[4] or 0,
        "outside_guadeloupe_project_count": aggregate[5] or 0,
        "outside_guadeloupe_committed_amount": aggregate[6] or 0,
        "unknown_location_project_count": aggregate[7] or 0,
        "active_local_establishment_count": aggregate[8] or 0,
        "active_local_establishment_amount": aggregate[9] or 0,
        "earliest_year": aggregate[10],
        "latest_year": aggregate[11],
        "resource_count": aggregate[12],
        "scheme_count": aggregate[13],
        "resource_stats": resource_stats,
        "amount_is_payment_proof": False,
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
    projects: list[dict[str, object]] = []
    resource_stats: list[dict[str, object]] = []
    download_count = 0
    for resource in metadata["resources"]:
        if args.skip_download:
            path = args.cache_dir / f"{resource['id']}.csv"
            if not path.exists():
                raise SystemExit(f"Ressource Fonds vert absente du cache: {path}")
            downloaded = False
        else:
            path, downloaded = download_resource(session, resource, args.cache_dir, args.refresh)
        download_count += int(downloaded)
        parsed, stats = parse_resource(path, resource, args.company_db)
        projects.extend(parsed)
        resource_stats.append(stats)
    print(json.dumps(build_index(projects, args.output, metadata, resource_stats, download_count), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
