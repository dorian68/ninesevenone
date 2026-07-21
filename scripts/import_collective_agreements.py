"""Build a local SIRET-to-IDCC and SIRET-to-OPCO business index.

The two DSN-derived sources keep their own reference months. Only active,
publishable SIRENE establishments are retained. KALI metadata is reduced to
agreement titles and identifiers; no article content is copied.
"""

from __future__ import annotations

import argparse
import base64
import csv
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256, sha512
import json
from pathlib import Path
import re
import sqlite3
import tarfile

import requests

try:
    from scripts.import_public_grants import compact_text, normalize_header, normalized_date
except ModuleNotFoundError:  # Direct execution with scripts/ as sys.path[0].
    from import_public_grants import compact_text, normalize_header, normalized_date  # type: ignore[no-redef]


ROOT = Path(__file__).resolve().parents[1]
IDCC_DATASET_ID = "liste-des-conventions-collectives-par-entreprise-siret"
IDCC_DATASET_URL = f"https://www.data.gouv.fr/datasets/{IDCC_DATASET_ID}"
SIRO_DATASET_ID = "table-siret-opco"
SIRO_DATASET_URL = f"https://www.data.gouv.fr/datasets/{SIRO_DATASET_ID}"
NPM_PACKAGE = "@socialgouv/kali-data"
NPM_REGISTRY_URL = "https://registry.npmjs.org/@socialgouv%2Fkali-data"
KALI_PROJECT_URL = "https://github.com/SocialGouv/kali-data"
LICENSE_NAME = "Licence Ouverte 2.0"
LICENSE_URL = "https://www.etalab.gouv.fr/licence-ouverte-open-licence/"
KALI_LICENSE_NAME = "Apache-2.0"
DEFAULT_COMPANY_DB = ROOT / "data/guadeloupe-enterprises.sqlite"
DEFAULT_CACHE_DIR = ROOT / "data/imports/collective-agreements"
DEFAULT_OUTPUT = ROOT / "data/collective-agreements.sqlite"
USER_AGENT = "guadeloupe-entreprises-collective-agreements/0.1 (+public open-data reuse)"
MAX_CSV_BYTES = 130 * 1024 * 1024
MAX_TARBALL_BYTES = 50 * 1024 * 1024

IDCC_SPECIAL_STATUSES = {
    "5100": "status_unspecified",
    "5501": "company_agreement_unspecified",
    "9998": "agreement_not_known",
    "9999": "no_collective_agreement",
}


@dataclass(frozen=True)
class EstablishmentTarget:
    siren: str
    siret: str
    commune: str
    is_head_office: bool
    employer: bool | None
    publishable: bool


def load_establishment_targets(company_db: Path) -> dict[str, EstablishmentTarget]:
    connection = sqlite3.connect(company_db)
    rows = connection.execute(
        "SELECT siren, siret, commune, is_head_office, employer, diffusion_status FROM establishments"
    ).fetchall()
    connection.close()
    return {
        str(siret): EstablishmentTarget(
            siren=str(siren), siret=str(siret), commune=str(commune or ""),
            is_head_office=bool(is_head_office),
            employer=True if employer == "O" else False if employer == "N" else None,
            publishable=diffusion_status != "P",
        )
        for siren, siret, commune, is_head_office, employer, diffusion_status in rows
        if re.fullmatch(r"\d{9}", str(siren)) and re.fullmatch(r"\d{14}", str(siret))
    }


def dataset_metadata(session: requests.Session, dataset_id: str, resource_selector) -> dict[str, object]:
    response = session.get(f"https://www.data.gouv.fr/api/1/datasets/{dataset_id}/", timeout=30)
    response.raise_for_status()
    payload = response.json()
    if str(payload.get("license") or "").lower() not in {"fr-lo", "lov2"}:
        raise RuntimeError(f"Licence ouverte non confirmée pour {dataset_id}")
    resource = next(
        (item for item in payload.get("resources", []) if isinstance(item, dict) and resource_selector(item)),
        None,
    )
    if resource is None:
        raise RuntimeError(f"Ressource principale introuvable pour {dataset_id}")
    return {
        "dataset_id": str(payload.get("id") or dataset_id),
        "title": compact_text(payload.get("title"), 500),
        "source_updated_at": str(payload.get("last_update") or payload.get("last_modified") or ""),
        "license_name": LICENSE_NAME,
        "license_url": LICENSE_URL,
        "resource": {
            "id": str(resource.get("id") or ""),
            "title": compact_text(resource.get("title"), 500),
            "url": str(resource.get("url") or ""),
            "last_modified": str(resource.get("last_modified") or ""),
            "filesize": int(resource.get("filesize") or 0),
        },
    }


def idcc_metadata(session: requests.Session) -> dict[str, object]:
    return dataset_metadata(
        session,
        IDCC_DATASET_ID,
        lambda item: str(item.get("format") or "").lower() == "csv",
    )


def siro_metadata(session: requests.Session) -> dict[str, object]:
    return dataset_metadata(
        session,
        SIRO_DATASET_ID,
        lambda item: str(item.get("format") or "").lower() == "csv"
        and str(item.get("title") or "").upper().startswith("SIRO_"),
    )


def kali_metadata(session: requests.Session) -> dict[str, object]:
    response = session.get(NPM_REGISTRY_URL, timeout=60)
    response.raise_for_status()
    payload = response.json()
    version = str((payload.get("dist-tags") or {}).get("latest") or "")
    package = (payload.get("versions") or {}).get(version) or {}
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise RuntimeError("Version kali-data invalide")
    if package.get("name") != NPM_PACKAGE or package.get("license") != KALI_LICENSE_NAME:
        raise RuntimeError("Identité ou licence du paquet kali-data invalide")
    dist = package.get("dist") or {}
    return {
        "package": NPM_PACKAGE,
        "version": version,
        "source_updated_at": str((payload.get("time") or {}).get(version) or (payload.get("time") or {}).get("modified") or ""),
        "license_name": KALI_LICENSE_NAME,
        "project_url": KALI_PROJECT_URL,
        "resource": {
            "id": f"{NPM_PACKAGE}@{version}",
            "title": f"{NPM_PACKAGE} {version}",
            "url": str(dist.get("tarball") or ""),
            "integrity": str(dist.get("integrity") or ""),
        },
    }


def download_csv(
    session: requests.Session,
    resource: dict[str, object],
    cache_dir: Path,
    refresh: bool,
) -> tuple[Path, bool]:
    target = cache_dir / f"{resource['id']}.csv"
    sidecar = cache_dir / f"{resource['id']}.metadata.json"
    signature = {"url": resource.get("url"), "last_modified": resource.get("last_modified")}
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
    with session.get(str(resource["url"]), stream=True, timeout=(30, 240)) as response:
        response.raise_for_status()
        with partial.open("wb") as output:
            for chunk in response.iter_content(256 * 1024):
                if not chunk:
                    continue
                if not prefix:
                    prefix = chunk[:512].lstrip().lower()
                    if prefix.startswith((b"<!doctype html", b"<html")):
                        raise ValueError("La ressource CSV renvoie du HTML")
                downloaded += len(chunk)
                if downloaded > MAX_CSV_BYTES:
                    partial.unlink(missing_ok=True)
                    raise ValueError("Ressource CSV trop volumineuse")
                output.write(chunk)
    partial.replace(target)
    sidecar.write_text(json.dumps(signature, ensure_ascii=False, indent=2), encoding="utf-8")
    return target, True


def download_kali(
    session: requests.Session,
    metadata: dict[str, object],
    cache_dir: Path,
    refresh: bool,
) -> tuple[Path, bool]:
    version = str(metadata["version"])
    resource = metadata["resource"]
    target = cache_dir / f"socialgouv-kali-data-{version}.tgz"
    if not refresh and target.exists() and target.stat().st_size > 0:
        verify_integrity(target, str(resource.get("integrity") or ""))
        return target, False
    cache_dir.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(".tgz.part")
    partial.unlink(missing_ok=True)
    downloaded = 0
    prefix = b""
    with session.get(str(resource["url"]), stream=True, timeout=(30, 240)) as response:
        response.raise_for_status()
        with partial.open("wb") as output:
            for chunk in response.iter_content(256 * 1024):
                if not chunk:
                    continue
                if not prefix:
                    prefix = chunk[:2]
                    if prefix != b"\x1f\x8b":
                        raise ValueError("Le paquet kali-data n'est pas une archive gzip")
                downloaded += len(chunk)
                if downloaded > MAX_TARBALL_BYTES:
                    partial.unlink(missing_ok=True)
                    raise ValueError("Paquet kali-data trop volumineux")
                output.write(chunk)
    verify_integrity(partial, str(resource.get("integrity") or ""))
    partial.replace(target)
    return target, True


def verify_integrity(path: Path, integrity: str) -> None:
    if not integrity.startswith("sha512-"):
        raise ValueError("Intégrité SHA-512 kali-data absente")
    expected = integrity.removeprefix("sha512-")
    actual = base64.b64encode(sha512(path.read_bytes()).digest()).decode("ascii")
    if actual != expected:
        raise ValueError("Intégrité SHA-512 kali-data invalide")


def normalized_siret(value: object) -> str | None:
    digits = re.sub(r"\D", "", compact_text(value, 64) or "")
    return digits if len(digits) == 14 else None


def normalized_idcc(value: object, allow_empty: bool = False) -> str | None:
    raw = compact_text(value, 32)
    if not raw:
        return None if allow_empty else None
    digits = re.sub(r"\s", "", raw)
    if not re.fullmatch(r"\d{1,4}", digits):
        return None
    return digits.zfill(4)


def idcc_status(idcc: str | None) -> str:
    if idcc is None:
        return "missing"
    return IDCC_SPECIAL_STATUSES.get(idcc, "declared_code")


def source_month(value: object) -> str | None:
    raw = compact_text(value, 20)
    return raw if raw and re.fullmatch(r"20\d{2}-(0[1-9]|1[0-2])", raw) else None


def kali_catalog(path: Path, metadata: dict[str, object]) -> tuple[list[dict[str, object]], dict[str, object]]:
    catalog: dict[str, dict[str, object]] = {}
    duplicate_codes = 0
    with tarfile.open(path, "r:gz") as archive:
        names = [
            name for name in archive.getnames()
            if name.startswith("package/data/KALICONT") and name.endswith(".json")
        ]
        for name in names:
            member = archive.getmember(name)
            if member.size > 20 * 1024 * 1024:
                raise ValueError(f"Fichier KALI excessif: {name}")
            source = archive.extractfile(member)
            if source is None:
                continue
            payload = json.load(source)
            root = payload.get("data") if isinstance(payload, dict) else None
            if not isinstance(root, dict):
                continue
            idcc = normalized_idcc(root.get("num"))
            kali_id = compact_text(root.get("id"), 100)
            if not idcc or idcc == "0000" or not kali_id or not kali_id.startswith("KALICONT"):
                continue
            base_statuses = []
            for child in payload.get("children", []):
                if not isinstance(child, dict) or child.get("type") != "section":
                    continue
                data = child.get("data") or {}
                if str(data.get("title") or "").startswith("Texte de base") and data.get("etat"):
                    base_statuses.append(str(data["etat"]))
            item = {
                "idcc": idcc,
                "kali_id": kali_id,
                "title": compact_text(root.get("title"), 1_000),
                "short_title": compact_text(root.get("shortTitle"), 500),
                "categories_json": json.dumps(root.get("categorisation") or [], ensure_ascii=False),
                "base_text_status": sorted(set(base_statuses))[0] if base_statuses else None,
                "legifrance_url": f"https://www.legifrance.gouv.fr/liste/idcc?facetteIdcc={int(idcc)}",
                "package_version": metadata["version"],
                "package_updated_at": metadata["source_updated_at"],
                "package_license": metadata["license_name"],
                "package_url": metadata["project_url"],
            }
            if idcc in catalog:
                duplicate_codes += 1
                continue
            catalog[idcc] = item
    return list(catalog.values()), {
        "archive_member_count": len(names),
        "catalog_count": len(catalog),
        "duplicate_idcc_count": duplicate_codes,
    }


def agreement_fingerprint(item: dict[str, object]) -> str:
    stable = (item.get("siret"), item.get("idcc"), item.get("reference_month"))
    return sha256("|".join(str(value or "") for value in stable).encode("utf-8")).hexdigest()


def parse_idcc_resource(
    path: Path,
    resource: dict[str, object],
    targets: dict[str, EstablishmentTarget],
) -> tuple[list[dict[str, object]], dict[str, object]]:
    stats: dict[str, object] = {
        "rows_read": 0, "valid_siret_rows": 0, "invalid_siret_rows": 0,
        "matched_rows": 0, "restricted_rows": 0, "invalid_idcc_rows": 0,
        "substantive_idcc_rows": 0, "escape_code_rows": 0, "employer_rows": 0,
    }
    agreements: list[dict[str, object]] = []
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source, delimiter=",")
        positions = {normalize_header(value): value for value in reader.fieldnames or []}
        required = {"mois", "siret", "idcc", "datemaj"}
        if not required.issubset(positions):
            raise ValueError(f"Colonnes SIRET-IDCC manquantes: {sorted(required - positions.keys())}")
        for row_number, row in enumerate(reader, start=2):
            stats["rows_read"] = int(stats["rows_read"]) + 1
            siret = normalized_siret(row.get(positions["siret"]))
            if not siret:
                stats["invalid_siret_rows"] = int(stats["invalid_siret_rows"]) + 1
                continue
            stats["valid_siret_rows"] = int(stats["valid_siret_rows"]) + 1
            target = targets.get(siret)
            if not target:
                continue
            if not target.publishable:
                stats["restricted_rows"] = int(stats["restricted_rows"]) + 1
                continue
            idcc = normalized_idcc(row.get(positions["idcc"]))
            if not idcc:
                stats["invalid_idcc_rows"] = int(stats["invalid_idcc_rows"]) + 1
                continue
            status = idcc_status(idcc)
            reference_month = source_month(row.get(positions["mois"]))
            if not reference_month:
                raise ValueError(f"Mois SIRET-IDCC invalide à la ligne {row_number}")
            item: dict[str, object] = {
                "source_row_number": row_number,
                "siren": target.siren,
                "siret": siret,
                "commune": target.commune,
                "is_head_office": target.is_head_office,
                "employer": target.employer,
                "idcc": idcc,
                "idcc_status": status,
                "reference_month": reference_month,
                "source_update_date": normalized_date(row.get(positions["datemaj"])),
                "resource_id": resource["id"],
                "resource_title": resource["title"],
                "resource_url": resource["url"],
                "resource_last_modified": resource.get("last_modified") or None,
            }
            item["fingerprint"] = agreement_fingerprint(item)
            agreements.append(item)
            stats["matched_rows"] = int(stats["matched_rows"]) + 1
            stats["employer_rows"] = int(stats["employer_rows"]) + int(target.employer is True)
            counter = "substantive_idcc_rows" if status == "declared_code" else "escape_code_rows"
            stats[counter] = int(stats[counter]) + 1
    return agreements, stats


def opco_fingerprint(item: dict[str, object]) -> str:
    stable = (item.get("siret"), item.get("reference_month"))
    return sha256("|".join(str(value or "") for value in stable).encode("utf-8")).hexdigest()


def siro_reference_month(resource_title: object) -> str | None:
    match = re.search(r"SIRO[_-]?(20\d{2})(0[1-9]|1[0-2])", str(resource_title or ""), re.IGNORECASE)
    return f"{match.group(1)}-{match.group(2)}" if match else None


def parse_siro_resource(
    path: Path,
    resource: dict[str, object],
    targets: dict[str, EstablishmentTarget],
) -> tuple[list[dict[str, object]], dict[str, object]]:
    reference_month = siro_reference_month(resource.get("title"))
    if not reference_month:
        raise ValueError("Millésime SIRO introuvable dans le titre de ressource")
    stats: dict[str, object] = {
        "rows_read": 0, "valid_siret_rows": 0, "invalid_siret_rows": 0,
        "matched_rows": 0, "restricted_rows": 0, "assigned_rows": 0,
        "anomaly_rows": 0, "missing_idcc_rows": 0, "escape_code_rows": 0,
        "employer_rows": 0,
    }
    assignments: list[dict[str, object]] = []
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source, delimiter="|")
        positions = {normalize_header(value): value for value in reader.fieldnames or []}
        required = {"siret", "idcc", "opcoproprietaire", "opcogestion"}
        if not required.issubset(positions):
            raise ValueError(f"Colonnes SIRO manquantes: {sorted(required - positions.keys())}")
        for row_number, row in enumerate(reader, start=2):
            stats["rows_read"] = int(stats["rows_read"]) + 1
            siret = normalized_siret(row.get(positions["siret"]))
            if not siret:
                stats["invalid_siret_rows"] = int(stats["invalid_siret_rows"]) + 1
                continue
            stats["valid_siret_rows"] = int(stats["valid_siret_rows"]) + 1
            target = targets.get(siret)
            if not target:
                continue
            if not target.publishable:
                stats["restricted_rows"] = int(stats["restricted_rows"]) + 1
                continue
            idcc = normalized_idcc(row.get(positions["idcc"]), allow_empty=True)
            owner = compact_text(row.get(positions["opcoproprietaire"]), 150)
            manager = compact_text(row.get(positions["opcogestion"]), 150)
            assignment_status = "assigned" if owner or manager else "declaration_anomaly"
            item: dict[str, object] = {
                "source_row_number": row_number,
                "siren": target.siren,
                "siret": siret,
                "commune": target.commune,
                "is_head_office": target.is_head_office,
                "employer": target.employer,
                "idcc": idcc,
                "idcc_status": idcc_status(idcc),
                "owner_opco": owner,
                "managing_opco": manager,
                "assignment_status": assignment_status,
                "reference_month": reference_month,
                "resource_id": resource["id"],
                "resource_title": resource["title"],
                "resource_url": resource["url"],
                "resource_last_modified": resource.get("last_modified") or None,
            }
            item["fingerprint"] = opco_fingerprint(item)
            assignments.append(item)
            stats["matched_rows"] = int(stats["matched_rows"]) + 1
            stats["employer_rows"] = int(stats["employer_rows"]) + int(target.employer is True)
            status_counter = "assigned_rows" if assignment_status == "assigned" else "anomaly_rows"
            stats[status_counter] = int(stats[status_counter]) + 1
            stats["missing_idcc_rows"] = int(stats["missing_idcc_rows"]) + int(idcc is None)
            stats["escape_code_rows"] = int(stats["escape_code_rows"]) + int(idcc_status(idcc) not in {"declared_code", "missing"})
    return assignments, stats


def build_index(
    agreements: list[dict[str, object]],
    assignments: list[dict[str, object]],
    catalog: list[dict[str, object]],
    output: Path,
    metadata: dict[str, object],
    stats: dict[str, object],
    downloaded_count: int,
) -> dict[str, object]:
    partial = output.with_suffix(output.suffix + ".part")
    partial.unlink(missing_ok=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(partial)
    connection.executescript("""
      CREATE TABLE agreement_catalog (
        idcc TEXT PRIMARY KEY,
        kali_id TEXT NOT NULL,
        title TEXT,
        short_title TEXT,
        categories_json TEXT NOT NULL,
        base_text_status TEXT,
        legifrance_url TEXT NOT NULL,
        package_version TEXT NOT NULL,
        package_updated_at TEXT,
        package_license TEXT NOT NULL,
        package_url TEXT NOT NULL
      );
      CREATE TABLE establishment_collective_agreements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fingerprint TEXT NOT NULL UNIQUE,
        source_row_number INTEGER NOT NULL,
        siren TEXT NOT NULL,
        siret TEXT NOT NULL,
        commune TEXT,
        is_head_office INTEGER NOT NULL,
        employer INTEGER,
        idcc TEXT NOT NULL,
        idcc_status TEXT NOT NULL,
        reference_month TEXT NOT NULL,
        source_update_date TEXT,
        resource_id TEXT NOT NULL,
        resource_title TEXT NOT NULL,
        resource_url TEXT NOT NULL,
        resource_last_modified TEXT,
        dataset_url TEXT NOT NULL,
        source_updated_at TEXT NOT NULL,
        license_name TEXT NOT NULL,
        license_url TEXT NOT NULL,
        imported_at TEXT NOT NULL
      );
      CREATE TABLE establishment_opco_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fingerprint TEXT NOT NULL UNIQUE,
        source_row_number INTEGER NOT NULL,
        siren TEXT NOT NULL,
        siret TEXT NOT NULL,
        commune TEXT,
        is_head_office INTEGER NOT NULL,
        employer INTEGER,
        idcc TEXT,
        idcc_status TEXT NOT NULL,
        owner_opco TEXT,
        managing_opco TEXT,
        assignment_status TEXT NOT NULL,
        reference_month TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        resource_title TEXT NOT NULL,
        resource_url TEXT NOT NULL,
        resource_last_modified TEXT,
        dataset_url TEXT NOT NULL,
        source_updated_at TEXT NOT NULL,
        license_name TEXT NOT NULL,
        license_url TEXT NOT NULL,
        imported_at TEXT NOT NULL
      );
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX collective_agreements_siren_idx ON establishment_collective_agreements(siren, siret, idcc);
      CREATE INDEX collective_agreements_siret_idx ON establishment_collective_agreements(siret, reference_month DESC);
      CREATE INDEX collective_agreements_idcc_idx ON establishment_collective_agreements(idcc, reference_month DESC);
      CREATE INDEX opco_assignments_siren_idx ON establishment_opco_assignments(siren, siret);
      CREATE INDEX opco_assignments_owner_idx ON establishment_opco_assignments(owner_opco, managing_opco);
      CREATE INDEX opco_assignments_status_idx ON establishment_opco_assignments(assignment_status, reference_month DESC);
    """)
    imported_at = datetime.now(timezone.utc).isoformat()
    connection.executemany(
        """INSERT OR IGNORE INTO agreement_catalog
           (idcc,kali_id,title,short_title,categories_json,base_text_status,legifrance_url,
            package_version,package_updated_at,package_license,package_url)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        [tuple(item.get(column) for column in (
            "idcc", "kali_id", "title", "short_title", "categories_json", "base_text_status",
            "legifrance_url", "package_version", "package_updated_at", "package_license", "package_url",
        )) for item in catalog],
    )
    idcc_meta = metadata["idcc"]
    idcc_resource = idcc_meta["resource"]
    agreement_columns = (
        "fingerprint", "source_row_number", "siren", "siret", "commune", "is_head_office", "employer",
        "idcc", "idcc_status", "reference_month", "source_update_date", "resource_id", "resource_title",
        "resource_url", "resource_last_modified",
    )
    for item in agreements:
        values = tuple(int(value) if isinstance(value, bool) else value for value in (item.get(column) for column in agreement_columns))
        connection.execute(
            f"INSERT OR IGNORE INTO establishment_collective_agreements ({','.join(agreement_columns)},dataset_url,source_updated_at,license_name,license_url,imported_at) VALUES ({','.join('?' for _ in range(len(agreement_columns)+5))})",
            values + (IDCC_DATASET_URL, idcc_meta["source_updated_at"], idcc_meta["license_name"], idcc_meta["license_url"], imported_at),
        )
    siro_meta = metadata["siro"]
    assignment_columns = (
        "fingerprint", "source_row_number", "siren", "siret", "commune", "is_head_office", "employer",
        "idcc", "idcc_status", "owner_opco", "managing_opco", "assignment_status", "reference_month",
        "resource_id", "resource_title", "resource_url", "resource_last_modified",
    )
    for item in assignments:
        values = tuple(int(value) if isinstance(value, bool) else value for value in (item.get(column) for column in assignment_columns))
        connection.execute(
            f"INSERT OR IGNORE INTO establishment_opco_assignments ({','.join(assignment_columns)},dataset_url,source_updated_at,license_name,license_url,imported_at) VALUES ({','.join('?' for _ in range(len(assignment_columns)+5))})",
            values + (SIRO_DATASET_URL, siro_meta["source_updated_at"], siro_meta["license_name"], siro_meta["license_url"], imported_at),
        )
    aggregate = connection.execute("""
      SELECT
        (SELECT COUNT(*) FROM establishment_collective_agreements),
        (SELECT COUNT(DISTINCT siren) FROM establishment_collective_agreements),
        (SELECT COUNT(DISTINCT siret) FROM establishment_collective_agreements),
        (SELECT COUNT(*) FROM establishment_collective_agreements WHERE idcc_status = 'declared_code'),
        (SELECT COUNT(*) FROM establishment_collective_agreements WHERE idcc_status != 'declared_code'),
        (SELECT COUNT(DISTINCT idcc) FROM establishment_collective_agreements),
        (SELECT COUNT(*) FROM establishment_opco_assignments),
        (SELECT COUNT(DISTINCT siren) FROM establishment_opco_assignments),
        (SELECT COUNT(*) FROM establishment_opco_assignments WHERE assignment_status = 'assigned'),
        (SELECT COUNT(*) FROM establishment_opco_assignments WHERE assignment_status = 'declaration_anomaly'),
        (SELECT COUNT(DISTINCT COALESCE(managing_opco, owner_opco)) FROM establishment_opco_assignments WHERE COALESCE(managing_opco, owner_opco) IS NOT NULL),
        (SELECT COUNT(*) FROM agreement_catalog),
        (SELECT COUNT(*) FROM establishment_collective_agreements a JOIN agreement_catalog c USING(idcc)),
        (SELECT COUNT(*) FROM establishment_opco_assignments o WHERE o.idcc IS NOT NULL
          AND EXISTS (SELECT 1 FROM establishment_collective_agreements a WHERE a.siret=o.siret)
          AND NOT EXISTS (SELECT 1 FROM establishment_collective_agreements a WHERE a.siret=o.siret AND a.idcc=o.idcc)),
        (SELECT COUNT(*) FROM establishment_opco_assignments o WHERE NOT EXISTS (
          SELECT 1 FROM establishment_collective_agreements a WHERE a.siret=o.siret
        )),
        (SELECT COUNT(DISTINCT a.siret) FROM establishment_collective_agreements a WHERE NOT EXISTS (
          SELECT 1 FROM establishment_opco_assignments o WHERE o.siret=a.siret
        )),
        (SELECT COUNT(DISTINCT siren) FROM (
          SELECT siren FROM establishment_collective_agreements UNION SELECT siren FROM establishment_opco_assignments
        ))
    """).fetchone()
    multi_establishments = connection.execute(
        "SELECT COUNT(*) FROM (SELECT siret FROM establishment_collective_agreements GROUP BY siret HAVING COUNT(DISTINCT idcc) > 1)"
    ).fetchone()[0]
    report = {
        "source": "Conventions collectives SIRET-IDCC et table SIRO SIRET-OPCO",
        "idcc_source_url": IDCC_DATASET_URL,
        "siro_source_url": SIRO_DATASET_URL,
        "kali_source_url": KALI_PROJECT_URL,
        "idcc_source_updated_at": idcc_meta["source_updated_at"],
        "siro_source_updated_at": siro_meta["source_updated_at"],
        "kali_source_updated_at": metadata["kali"]["source_updated_at"],
        "kali_version": metadata["kali"]["version"],
        "imported_at": imported_at,
        "downloaded_resource_count": downloaded_count,
        "cached_resource_count": 3 - downloaded_count,
        "idcc_source_rows": stats["idcc"]["rows_read"],
        "siro_source_rows": stats["siro"]["rows_read"],
        "agreement_count": aggregate[0],
        "agreement_company_count": aggregate[1],
        "agreement_establishment_count": aggregate[2],
        "substantive_agreement_count": aggregate[3],
        "escape_agreement_count": aggregate[4],
        "distinct_idcc_count": aggregate[5],
        "multi_idcc_establishment_count": multi_establishments,
        "opco_assignment_count": aggregate[6],
        "opco_company_count": aggregate[7],
        "assigned_opco_count": aggregate[8],
        "opco_anomaly_count": aggregate[9],
        "effective_opco_count": aggregate[10],
        "kali_catalog_count": aggregate[11],
        "agreements_with_kali_title": aggregate[12],
        "cross_source_idcc_difference_count": aggregate[13],
        "siro_only_establishment_count": aggregate[14],
        "idcc_only_establishment_count": aggregate[15],
        "covered_company_count": aggregate[16],
        "restricted_idcc_rows_excluded": stats["idcc"]["restricted_rows"],
        "restricted_siro_rows_excluded": stats["siro"]["restricted_rows"],
        "contains_employee_records": False,
        "contains_personal_names": False,
        "contains_contacts": False,
        "join_uses_names": False,
        "resource_stats": stats,
        "database": str(output),
    }
    for key, value in report.items():
        if key in {"database", "resource_stats"}:
            continue
        encoded = json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list, bool)) else str(value or "")
        connection.execute("INSERT INTO metadata(key,value) VALUES (?,?)", (key, encoded))
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
    session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json,text/csv;q=0.9,application/gzip;q=0.8"})
    metadata = {"idcc": idcc_metadata(session), "siro": siro_metadata(session), "kali": kali_metadata(session)}
    idcc_resource = metadata["idcc"]["resource"]
    siro_resource = metadata["siro"]["resource"]
    kali_resource = metadata["kali"]["resource"]
    if args.skip_download:
        idcc_path = args.cache_dir / f"{idcc_resource['id']}.csv"
        siro_path = args.cache_dir / f"{siro_resource['id']}.csv"
        kali_path = args.cache_dir / f"socialgouv-kali-data-{metadata['kali']['version']}.tgz"
        missing = [str(path) for path in (idcc_path, siro_path, kali_path) if not path.exists()]
        if missing:
            raise SystemExit(f"Ressources absentes du cache: {missing}")
        verify_integrity(kali_path, str(kali_resource.get("integrity") or ""))
        downloaded_count = 0
    else:
        idcc_path, idcc_downloaded = download_csv(session, idcc_resource, args.cache_dir, args.refresh)
        siro_path, siro_downloaded = download_csv(session, siro_resource, args.cache_dir, args.refresh)
        kali_path, kali_downloaded = download_kali(session, metadata["kali"], args.cache_dir, args.refresh)
        downloaded_count = sum((idcc_downloaded, siro_downloaded, kali_downloaded))
    targets = load_establishment_targets(args.company_db)
    catalog, catalog_stats = kali_catalog(kali_path, metadata["kali"])
    agreements, idcc_stats = parse_idcc_resource(idcc_path, idcc_resource, targets)
    assignments, siro_stats = parse_siro_resource(siro_path, siro_resource, targets)
    stats = {"idcc": idcc_stats, "siro": siro_stats, "catalog": catalog_stats}
    print(json.dumps(build_index(agreements, assignments, catalog, args.output, metadata, stats, downloaded_count), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
