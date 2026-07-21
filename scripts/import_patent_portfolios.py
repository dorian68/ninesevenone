"""Build an exact-SIREN patent portfolio index for Guadeloupe companies.

The applicant dataset is scanned locally to discover exact SIREN matches. Only
the matching application keys and DOCDB families are then queried from the
companion official datasets. Inventors and natural-person applicants are never
imported. A patent is attached to the national legal unit, not inferred to have
originated from its Guadeloupe establishment.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
from dataclasses import dataclass
from datetime import datetime, timezone
import gzip
from hashlib import sha256
import json
from pathlib import Path
import re
import sqlite3
import time
from typing import Iterable

import requests

try:
    from scripts.import_public_grants import compact_text, normalize_header, normalized_date
except ModuleNotFoundError:  # Direct execution with scripts/ as sys.path[0].
    from import_public_grants import compact_text, normalize_header, normalized_date  # type: ignore[no-redef]


ROOT = Path(__file__).resolve().parents[1]
DATA_GOUV_API = "https://www.data.gouv.fr/api/1/datasets"
ESR_API = "https://data.enseignementsup-recherche.gouv.fr/api/explore/v2.1/catalog/datasets"
LICENSE_NAME = "Licence Ouverte 2.0"
LICENSE_URL = "https://www.etalab.gouv.fr/licence-ouverte-open-licence/"
USER_AGENT = "guadeloupe-entreprises-patent-portfolios/0.1 (+public open-data reuse)"
MAX_APPLICANT_CSV_BYTES = 120 * 1024 * 1024
DEFAULT_COMPANY_DB = ROOT / "data/guadeloupe-enterprises.sqlite"
DEFAULT_CACHE_DIR = ROOT / "data/imports/patent-portfolios"
DEFAULT_OUTPUT = ROOT / "data/patent-portfolios.sqlite"

SOURCES = {
    "applicants": {
        "dataset_id": "63b4ebd006676a13059dde9a",
        "slug": "deposants-des-brevets",
        "page_url": "https://www.data.gouv.fr/datasets/deposants-des-brevets-1",
        "resource_title": "deposants-des-brevets.csv",
    },
    "applications": {
        "dataset_id": "63b4ebd1faf1a9d68d9dde9b",
        "slug": "demandes-de-brevets",
        "page_url": "https://www.data.gouv.fr/datasets/demandes-de-brevets-1",
        "resource_title": "demandes-de-brevets.csv",
    },
    "families": {
        "dataset_id": "636c694a64890a2128f64c86",
        "slug": "fr-esr-familles-brevets",
        "page_url": "https://www.data.gouv.fr/datasets/familles-de-brevets",
        "resource_title": "fr-esr-familles-brevets.csv",
    },
    "technologies": {
        "dataset_id": "636c694f2caac75716f64c85",
        "slug": "fr-esr-technologies-brevets",
        "page_url": "https://www.data.gouv.fr/datasets/technologies-des-familles-de-brevets",
        "resource_title": "fr-esr-technologies-brevets.csv",
    },
}


@dataclass(frozen=True)
class CompanyTarget:
    siren: str
    legal_name: str
    publishable: bool
    active: bool


def normalized_siren(value: object) -> str | None:
    digits = re.sub(r"\D", "", compact_text(value, 64) or "")
    return digits if len(digits) == 9 else None


def normalized_identifier(value: object, *, digits_only: bool = False) -> str | None:
    raw = compact_text(value, 100)
    if not raw:
        return None
    pattern = r"\d{1,30}" if digits_only else r"[A-Za-z0-9._-]{1,100}"
    return raw if re.fullmatch(pattern, raw) else None


def source_boolean(value: object) -> bool | None:
    normalized = (compact_text(value, 20) or "").casefold()
    if normalized in {"vrai", "true", "oui", "1"}:
        return True
    if normalized in {"faux", "false", "non", "0"}:
        return False
    return None


def load_company_targets(path: Path) -> dict[str, CompanyTarget]:
    connection = sqlite3.connect(path)
    rows = connection.execute(
        "SELECT siren, legal_name, diffusion_status, administrative_status FROM companies"
    ).fetchall()
    connection.close()
    return {
        str(siren): CompanyTarget(
            siren=str(siren), legal_name=str(legal_name or ""),
            publishable=diffusion_status != "P", active=administrative_status == "A",
        )
        for siren, legal_name, diffusion_status, administrative_status in rows
        if re.fullmatch(r"\d{9}", str(siren))
    }


def dataset_metadata(session: requests.Session, source: dict[str, str]) -> dict[str, object]:
    response = session.get(f"{DATA_GOUV_API}/{source['dataset_id']}/", timeout=45)
    response.raise_for_status()
    payload = response.json()
    if str(payload.get("license") or "").lower() not in {"fr-lo", "lov2"}:
        raise RuntimeError(f"Licence ouverte non confirmée pour {payload.get('title')}")
    resource = next(
        (
            item for item in payload.get("resources", [])
            if isinstance(item, dict)
            and str(item.get("title") or "").casefold() == source["resource_title"].casefold()
        ),
        None,
    )
    if resource is None:
        raise RuntimeError(f"Ressource {source['resource_title']} introuvable")
    return {
        "dataset_id": str(payload.get("id") or source["dataset_id"]),
        "title": compact_text(payload.get("title"), 500),
        "page_url": source["page_url"],
        "slug": source["slug"],
        "source_updated_at": str(payload.get("last_update") or payload.get("last_modified") or ""),
        "license_name": LICENSE_NAME,
        "license_url": LICENSE_URL,
        "resource": {
            "id": str(resource.get("id") or ""),
            "title": compact_text(resource.get("title"), 500),
            "url": str(resource.get("url") or ""),
            "last_modified": str(resource.get("last_modified") or ""),
        },
    }


def download_applicant_csv(
    session: requests.Session,
    metadata: dict[str, object],
    cache_dir: Path,
    refresh: bool,
) -> tuple[Path, bool]:
    resource = metadata["resource"]
    target = cache_dir / f"{resource['id']}.csv"
    sidecar = target.with_suffix(".metadata.json")
    signature = {
        "url": resource["url"],
        "source_updated_at": metadata["source_updated_at"],
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
    with session.get(str(resource["url"]), stream=True, timeout=(30, 300)) as response:
        response.raise_for_status()
        with partial.open("wb") as output:
            for chunk in response.iter_content(256 * 1024):
                if not chunk:
                    continue
                downloaded += len(chunk)
                if downloaded > MAX_APPLICANT_CSV_BYTES:
                    partial.unlink(missing_ok=True)
                    raise ValueError("Export des déposants de brevets trop volumineux")
                output.write(chunk)
    with partial.open("rb") as source_file:
        prefix = source_file.read(300).lstrip().lower()
        if prefix.startswith((b"<!doctype html", b"<html")) or b"key_appln_nr" not in prefix:
            partial.unlink(missing_ok=True)
            raise ValueError("La ressource déposants ne ressemble pas au CSV attendu")
    partial.replace(target)
    sidecar.write_text(json.dumps(signature, ensure_ascii=False, indent=2), encoding="utf-8")
    return target, True


def applicant_fingerprint(item: dict[str, object]) -> str:
    stable = (item.get("siren"), item.get("application_key"))
    return sha256("|".join(str(value or "") for value in stable).encode("utf-8")).hexdigest()


def parse_applicant_csv(
    path: Path,
    targets: dict[str, CompanyTarget],
) -> tuple[list[dict[str, object]], dict[str, object]]:
    stats: dict[str, object] = {
        "rows_read": 0, "valid_siren_rows": 0, "invalid_siren_rows": 0,
        "matched_rows": 0, "restricted_rows": 0, "inactive_company_rows": 0,
        "invalid_application_rows": 0, "invalid_family_rows": 0,
    }
    matches: dict[str, dict[str, object]] = {}
    with path.open("r", encoding="utf-8-sig", newline="") as source_file:
        reader = csv.DictReader(source_file, delimiter=";")
        positions = {normalize_header(value): value for value in reader.fieldnames or []}
        required = {"keyapplnnr", "nrfamilledocdb", "nomdemandeur", "codepays", "siren"}
        if not required.issubset(positions):
            raise ValueError(f"Colonnes déposants manquantes: {sorted(required - positions.keys())}")
        for row_number, row in enumerate(reader, start=2):
            stats["rows_read"] = int(stats["rows_read"]) + 1
            siren = normalized_siren(row.get(positions["siren"]))
            if not siren:
                stats["invalid_siren_rows"] = int(stats["invalid_siren_rows"]) + 1
                continue
            stats["valid_siren_rows"] = int(stats["valid_siren_rows"]) + 1
            target = targets.get(siren)
            if target is None:
                continue
            if not target.publishable:
                stats["restricted_rows"] = int(stats["restricted_rows"]) + 1
                continue
            if not target.active:
                stats["inactive_company_rows"] = int(stats["inactive_company_rows"]) + 1
            application_key = normalized_identifier(row.get(positions["keyapplnnr"]))
            family_docdb = normalized_identifier(row.get(positions["nrfamilledocdb"]), digits_only=True)
            if not application_key:
                stats["invalid_application_rows"] = int(stats["invalid_application_rows"]) + 1
                continue
            if not family_docdb:
                stats["invalid_family_rows"] = int(stats["invalid_family_rows"]) + 1
                continue
            item: dict[str, object] = {
                "source_row_number": row_number,
                "siren": siren,
                "application_key": application_key,
                "family_docdb": family_docdb,
                "applicant_name": compact_text(row.get(positions["nomdemandeur"]), 500),
                "country_code": compact_text(row.get(positions["codepays"]), 10),
                "scope": "national_legal_unit",
            }
            item["fingerprint"] = applicant_fingerprint(item)
            matches.setdefault(str(item["fingerprint"]), item)
            stats["matched_rows"] = int(stats["matched_rows"]) + 1
    stats["deduplicated_rows"] = len(matches)
    return list(matches.values()), stats


def chunks(values: list[str], size: int) -> Iterable[list[str]]:
    for start in range(0, len(values), size):
        yield values[start:start + size]


def request_json_with_retry(url: str, params: dict[str, object], attempts: int = 5) -> tuple[dict[str, object], int]:
    retries = 0
    for attempt in range(attempts):
        response = requests.get(url, params=params, headers={"User-Agent": USER_AGENT}, timeout=(20, 90))
        if response.status_code == 200:
            return response.json(), retries
        if response.status_code not in {429, 500, 502, 503, 504} or attempt == attempts - 1:
            response.raise_for_status()
        retries += 1
        retry_after = response.headers.get("Retry-After")
        time.sleep(float(retry_after) if retry_after and retry_after.isdigit() else 0.6 * (2 ** attempt))
    raise RuntimeError("Requête API ESR sans réponse")


def query_record_chunk(dataset_slug: str, field: str, values: list[str]) -> tuple[list[dict[str, object]], int, int]:
    safe_values = [value for value in values if re.fullmatch(r"[A-Za-z0-9._-]{1,100}", value)]
    if len(safe_values) != len(values):
        raise ValueError("Valeur de filtre API invalide")
    where = f'{field} IN ({",".join(json.dumps(value) for value in safe_values)})'
    url = f"{ESR_API}/{dataset_slug}/records"
    offset = 0
    records: list[dict[str, object]] = []
    calls = 0
    retries = 0
    while True:
        payload, request_retries = request_json_with_retry(
            url, {"where": where, "limit": 100, "offset": offset},
        )
        calls += 1
        retries += request_retries
        page = payload.get("results") or []
        if not isinstance(page, list):
            raise ValueError(f"Réponse ESR invalide pour {dataset_slug}")
        records.extend(item for item in page if isinstance(item, dict))
        total = int(payload.get("total_count") or 0)
        offset += len(page)
        if not page or offset >= total:
            break
        if calls > 500:
            raise RuntimeError(f"Pagination excessive pour {dataset_slug}")
    return records, calls, retries


def fetch_records_for_values(
    dataset_meta: dict[str, object],
    field: str,
    values: Iterable[str],
    cache_dir: Path,
    refresh: bool,
    workers: int,
) -> tuple[list[dict[str, object]], dict[str, object]]:
    unique_values = sorted(set(values))
    digest = sha256("\n".join(unique_values).encode("utf-8")).hexdigest()
    cache_path = cache_dir / f"{dataset_meta['slug']}-local-{digest[:20]}.json.gz"
    signature = {
        "dataset_id": dataset_meta["dataset_id"], "source_updated_at": dataset_meta["source_updated_at"],
        "field": field, "values_sha256": digest, "value_count": len(unique_values),
    }
    if not refresh and cache_path.exists():
        try:
            with gzip.open(cache_path, "rt", encoding="utf-8") as source_file:
                cached = json.load(source_file)
            if cached.get("signature") == signature and isinstance(cached.get("records"), list):
                return cached["records"], {
                    "value_count": len(unique_values), "record_count": len(cached["records"]),
                    "api_calls": 0, "api_retries": 0, "cache_reused": True,
                }
        except (OSError, json.JSONDecodeError):
            pass
    if not unique_values:
        return [], {"value_count": 0, "record_count": 0, "api_calls": 0, "api_retries": 0, "cache_reused": False}
    cache_dir.mkdir(parents=True, exist_ok=True)
    grouped = list(chunks(unique_values, 60))
    all_records: list[dict[str, object]] = []
    api_calls = 0
    api_retries = 0
    with ThreadPoolExecutor(max_workers=max(1, min(workers, 16))) as executor:
        futures = {
            executor.submit(query_record_chunk, str(dataset_meta["slug"]), field, group): group
            for group in grouped
        }
        for future in as_completed(futures):
            records, calls, retries = future.result()
            all_records.extend(records)
            api_calls += calls
            api_retries += retries
    unique_records = list({json.dumps(item, ensure_ascii=False, sort_keys=True): item for item in all_records}.values())
    unique_records.sort(key=lambda item: json.dumps(item, ensure_ascii=False, sort_keys=True))
    partial = cache_path.with_suffix(cache_path.suffix + ".part")
    with gzip.open(partial, "wt", encoding="utf-8") as output:
        json.dump({"signature": signature, "records": unique_records}, output, ensure_ascii=False)
    partial.replace(cache_path)
    return unique_records, {
        "value_count": len(unique_values), "record_count": len(unique_records),
        "api_calls": api_calls, "api_retries": api_retries, "cache_reused": False,
    }


def normalized_record_list(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if item is not None]
    return [str(value)] if value is not None else []


def family_title(record: dict[str, object]) -> str | None:
    return compact_text(
        record.get("titre_francais") or record.get("titre_langue_originale") or record.get("titre_anglais"),
        1_000,
    )


def family_abstract(record: dict[str, object]) -> str | None:
    return compact_text(
        record.get("resume_francais") or record.get("resume_langue_originale") or record.get("resume_anglais"),
        4_000,
    )


def build_portfolio_items(
    applicant_rows: list[dict[str, object]],
    application_records: list[dict[str, object]],
    family_records: list[dict[str, object]],
    technology_records: list[dict[str, object]],
) -> tuple[list[dict[str, object]], list[dict[str, object]], list[dict[str, object]], dict[str, object]]:
    application_by_key = {
        str(item["key_appln_nr"]): item for item in application_records
        if normalized_identifier(item.get("key_appln_nr"))
    }
    family_by_id = {
        str(item["nr_famille_docdb"]): item for item in family_records
        if normalized_identifier(item.get("nr_famille_docdb"), digits_only=True)
    }
    technologies_by_family: dict[str, list[dict[str, object]]] = {}
    for item in technology_records:
        family_id = normalized_identifier(item.get("nr_famille_docdb"), digits_only=True)
        if family_id:
            technologies_by_family.setdefault(family_id, []).append(item)

    grouped: dict[tuple[str, str], list[dict[str, object]]] = {}
    for row in applicant_rows:
        grouped.setdefault((str(row["siren"]), str(row["family_docdb"])), []).append(row)

    families: list[dict[str, object]] = []
    applications: list[dict[str, object]] = []
    technologies: list[dict[str, object]] = []
    missing_application_records = 0
    for row in applicant_rows:
        detail = application_by_key.get(str(row["application_key"]))
        missing_application_records += int(detail is None)
        item = {
            **row,
            "application_date": normalized_date(detail.get("date_demande")) if detail else None,
            "application_authority": compact_text(detail.get("autorite_demande"), 20) if detail else None,
            "ip_domain": compact_text(detail.get("domaine_pi"), 20) if detail else None,
            "publication_number": compact_text(detail.get("nr_publication_demande"), 100) if detail else None,
            "pct_number": compact_text(detail.get("nr_demande_pct"), 100) if detail else None,
            "publication_type": compact_text(detail.get("type_publication"), 30) if detail else None,
            "priority_claim": source_boolean(detail.get("demande_priorite")) if detail else None,
            "publication_date": normalized_date(detail.get("date_publication_demande")) if detail else None,
            "grant_date": normalized_date(detail.get("date_octroi")) if detail else None,
            "application_title_language": compact_text(detail.get("langue_titre_demande"), 20) if detail else None,
            "application_title": compact_text(detail.get("titre_demande"), 1_000) if detail else None,
        }
        applications.append(item)

    missing_family_records = 0
    for (siren, family_id), rows in grouped.items():
        detail = family_by_id.get(family_id)
        missing_family_records += int(detail is None)
        application_keys = sorted({str(row["application_key"]) for row in rows})
        applicant_names = sorted({str(row["applicant_name"]) for row in rows if row.get("applicant_name")})
        family_technologies = technologies_by_family.get(family_id, [])
        item: dict[str, object] = {
            "fingerprint": sha256(f"{siren}|{family_id}".encode("utf-8")).hexdigest(),
            "siren": siren,
            "family_docdb": family_id,
            "family_inpadoc": compact_text(detail.get("nr_famille_inpadoc"), 100) if detail else None,
            "applicant_names_json": json.dumps(applicant_names, ensure_ascii=False),
            "application_count": len(application_keys),
            "application_keys_json": json.dumps(application_keys, ensure_ascii=False),
            "first_publication_date": normalized_date(detail.get("date_premiere_publication")) if detail else None,
            "first_application_date": normalized_date(detail.get("date_premiere_demande")) if detail else None,
            "epo_application": source_boolean(detail.get("demande_oeb")) if detail else None,
            "international_application": source_boolean(detail.get("demande_internationale")) if detail else None,
            "granted": source_boolean(detail.get("octroye")) if detail else None,
            "first_grant_date": normalized_date(detail.get("date_premier_octroi")) if detail else None,
            "title_fr": compact_text(detail.get("titre_francais"), 1_000) if detail else None,
            "title_en": compact_text(detail.get("titre_anglais"), 1_000) if detail else None,
            "title_original": compact_text(detail.get("titre_langue_originale"), 1_000) if detail else None,
            "title_original_language": compact_text(detail.get("langue_originale_titre"), 20) if detail else None,
            "display_title": family_title(detail) if detail else None,
            "abstract_fr": compact_text(detail.get("resume_francais"), 4_000) if detail else None,
            "abstract_en": compact_text(detail.get("resume_anglais"), 4_000) if detail else None,
            "abstract_original": compact_text(detail.get("resume_langue_originale"), 4_000) if detail else None,
            "abstract_original_language": compact_text(detail.get("langue_originale_resume"), 20) if detail else None,
            "display_abstract": family_abstract(detail) if detail else None,
            "technology_count": len({(str(tech.get("niveau")), str(tech.get("code"))) for tech in family_technologies}),
            "scanr_url": f"https://scanr.enseignementsup-recherche.gouv.fr/patents/{family_id}",
            "scope": "national_legal_unit",
        }
        families.append(item)
        for tech in family_technologies:
            level = compact_text(tech.get("niveau"), 50)
            code = compact_text(tech.get("code"), 30)
            if not level or not code:
                continue
            technologies.append({
                "fingerprint": sha256(f"{siren}|{family_id}|{level}|{code}".encode("utf-8")).hexdigest(),
                "siren": siren, "family_docdb": family_id, "level": level, "code": code,
                "label": compact_text(tech.get("libelle"), 1_000),
            })
    stats = {
        "missing_application_records": missing_application_records,
        "missing_family_records": missing_family_records,
        "family_count": len(families), "application_count": len(applications),
        "technology_count": len({item["fingerprint"] for item in technologies}),
    }
    return families, applications, technologies, stats


def build_index(
    output: Path,
    families: list[dict[str, object]],
    applications: list[dict[str, object]],
    technologies: list[dict[str, object]],
    metadata: dict[str, dict[str, object]],
    stats: dict[str, object],
) -> dict[str, object]:
    partial = output.with_suffix(output.suffix + ".part")
    partial.unlink(missing_ok=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(partial)
    connection.executescript("""
      CREATE TABLE patent_families (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fingerprint TEXT NOT NULL UNIQUE,
        siren TEXT NOT NULL,
        family_docdb TEXT NOT NULL,
        family_inpadoc TEXT,
        applicant_names_json TEXT NOT NULL,
        application_count INTEGER NOT NULL,
        application_keys_json TEXT NOT NULL,
        first_publication_date TEXT,
        first_application_date TEXT,
        epo_application INTEGER,
        international_application INTEGER,
        granted INTEGER,
        first_grant_date TEXT,
        title_fr TEXT,
        title_en TEXT,
        title_original TEXT,
        title_original_language TEXT,
        display_title TEXT,
        abstract_fr TEXT,
        abstract_en TEXT,
        abstract_original TEXT,
        abstract_original_language TEXT,
        display_abstract TEXT,
        technology_count INTEGER NOT NULL,
        scanr_url TEXT NOT NULL,
        scope TEXT NOT NULL,
        source_updated_at TEXT NOT NULL,
        dataset_url TEXT NOT NULL,
        license_name TEXT NOT NULL,
        license_url TEXT NOT NULL,
        imported_at TEXT NOT NULL
      );
      CREATE TABLE patent_applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fingerprint TEXT NOT NULL UNIQUE,
        source_row_number INTEGER NOT NULL,
        siren TEXT NOT NULL,
        application_key TEXT NOT NULL,
        family_docdb TEXT NOT NULL,
        applicant_name TEXT,
        country_code TEXT,
        scope TEXT NOT NULL,
        application_date TEXT,
        application_authority TEXT,
        ip_domain TEXT,
        publication_number TEXT,
        pct_number TEXT,
        publication_type TEXT,
        priority_claim INTEGER,
        publication_date TEXT,
        grant_date TEXT,
        application_title_language TEXT,
        application_title TEXT,
        source_updated_at TEXT NOT NULL,
        dataset_url TEXT NOT NULL,
        license_name TEXT NOT NULL,
        license_url TEXT NOT NULL,
        imported_at TEXT NOT NULL
      );
      CREATE TABLE patent_technologies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fingerprint TEXT NOT NULL UNIQUE,
        siren TEXT NOT NULL,
        family_docdb TEXT NOT NULL,
        level TEXT NOT NULL,
        code TEXT NOT NULL,
        label TEXT,
        source_updated_at TEXT NOT NULL,
        dataset_url TEXT NOT NULL,
        license_name TEXT NOT NULL,
        license_url TEXT NOT NULL,
        imported_at TEXT NOT NULL
      );
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX patent_families_siren_idx ON patent_families(siren, first_application_date DESC);
      CREATE INDEX patent_families_docdb_idx ON patent_families(family_docdb);
      CREATE INDEX patent_families_granted_idx ON patent_families(granted, first_grant_date DESC);
      CREATE INDEX patent_applications_siren_idx ON patent_applications(siren, application_date DESC);
      CREATE INDEX patent_applications_family_idx ON patent_applications(family_docdb);
      CREATE INDEX patent_technologies_siren_idx ON patent_technologies(siren, level, code);
      CREATE INDEX patent_technologies_family_idx ON patent_technologies(family_docdb, level);
    """)
    imported_at = datetime.now(timezone.utc).isoformat()
    family_meta = metadata["families"]
    application_meta = metadata["applications"]
    technology_meta = metadata["technologies"]
    family_columns = (
        "fingerprint", "siren", "family_docdb", "family_inpadoc", "applicant_names_json",
        "application_count", "application_keys_json", "first_publication_date", "first_application_date",
        "epo_application", "international_application", "granted", "first_grant_date", "title_fr", "title_en",
        "title_original", "title_original_language", "display_title", "abstract_fr", "abstract_en",
        "abstract_original", "abstract_original_language", "display_abstract", "technology_count", "scanr_url", "scope",
    )
    connection.executemany(
        f"INSERT OR IGNORE INTO patent_families ({','.join(family_columns)},source_updated_at,dataset_url,license_name,license_url,imported_at) VALUES ({','.join('?' for _ in range(len(family_columns)+5))})",
        [tuple(int(value) if isinstance(value, bool) else value for value in (item.get(column) for column in family_columns)) + (
            family_meta["source_updated_at"], family_meta["page_url"], LICENSE_NAME, LICENSE_URL, imported_at,
        ) for item in families],
    )
    application_columns = (
        "fingerprint", "source_row_number", "siren", "application_key", "family_docdb", "applicant_name",
        "country_code", "scope", "application_date", "application_authority", "ip_domain", "publication_number",
        "pct_number", "publication_type", "priority_claim", "publication_date", "grant_date",
        "application_title_language", "application_title",
    )
    connection.executemany(
        f"INSERT OR IGNORE INTO patent_applications ({','.join(application_columns)},source_updated_at,dataset_url,license_name,license_url,imported_at) VALUES ({','.join('?' for _ in range(len(application_columns)+5))})",
        [tuple(int(value) if isinstance(value, bool) else value for value in (item.get(column) for column in application_columns)) + (
            application_meta["source_updated_at"], application_meta["page_url"], LICENSE_NAME, LICENSE_URL, imported_at,
        ) for item in applications],
    )
    technology_columns = ("fingerprint", "siren", "family_docdb", "level", "code", "label")
    connection.executemany(
        f"INSERT OR IGNORE INTO patent_technologies ({','.join(technology_columns)},source_updated_at,dataset_url,license_name,license_url,imported_at) VALUES ({','.join('?' for _ in range(len(technology_columns)+5))})",
        [tuple(item.get(column) for column in technology_columns) + (
            technology_meta["source_updated_at"], technology_meta["page_url"], LICENSE_NAME, LICENSE_URL, imported_at,
        ) for item in technologies],
    )
    aggregate = connection.execute("""
      SELECT COUNT(*), COUNT(DISTINCT siren), SUM(granted = 1), SUM(international_application = 1),
        SUM(display_title IS NOT NULL), SUM(display_abstract IS NOT NULL), MIN(first_application_date),
        MAX(first_application_date)
      FROM patent_families
    """).fetchone()
    application_aggregate = connection.execute(
        "SELECT COUNT(*), COUNT(DISTINCT application_authority) FROM patent_applications"
    ).fetchone()
    technology_aggregate = connection.execute(
        "SELECT COUNT(*), COUNT(DISTINCT CASE WHEN level = 'section' THEN code END) FROM patent_technologies"
    ).fetchone()
    report = {
        "source_applicant_rows": stats["applicants"]["rows_read"],
        "matched_applicant_rows": stats["applicants"]["matched_rows"],
        "restricted_rows_excluded": stats["applicants"]["restricted_rows"],
        "company_count": int(aggregate[1] or 0),
        "family_count": int(aggregate[0] or 0),
        "application_count": int(application_aggregate[0] or 0),
        "application_authority_count": int(application_aggregate[1] or 0),
        "granted_family_count": int(aggregate[2] or 0),
        "international_family_count": int(aggregate[3] or 0),
        "titled_family_count": int(aggregate[4] or 0),
        "abstract_family_count": int(aggregate[5] or 0),
        "earliest_application_date": aggregate[6],
        "latest_application_date": aggregate[7],
        "technology_count": int(technology_aggregate[0] or 0),
        "technology_section_count": int(technology_aggregate[1] or 0),
        "missing_application_records": stats["portfolio"]["missing_application_records"],
        "missing_family_records": stats["portfolio"]["missing_family_records"],
        "contains_inventor_records": False,
        "contains_natural_person_applicants": False,
        "join_uses_names": False,
        "scope": "national_legal_unit",
        "imported_at": imported_at,
    }
    metadata_rows = {
        "source": "MESRE/PATSTAT patent applicants, applications, families and technologies",
        **{key: value for key, value in report.items()},
    }
    for source_name, source_meta in metadata.items():
        metadata_rows[f"{source_name}_source_url"] = source_meta["page_url"]
        metadata_rows[f"{source_name}_source_updated_at"] = source_meta["source_updated_at"]
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
    parser.add_argument("--workers", type=int, default=10)
    args = parser.parse_args()

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    metadata = {name: dataset_metadata(session, source) for name, source in SOURCES.items()}
    applicant_path, applicant_downloaded = download_applicant_csv(
        session, metadata["applicants"], args.cache_dir, args.refresh,
    )
    targets = load_company_targets(args.company_db)
    applicant_rows, applicant_stats = parse_applicant_csv(applicant_path, targets)
    application_keys = {str(item["application_key"]) for item in applicant_rows}
    family_ids = {str(item["family_docdb"]) for item in applicant_rows}
    application_records, application_query_stats = fetch_records_for_values(
        metadata["applications"], "key_appln_nr", application_keys, args.cache_dir, args.refresh, args.workers,
    )
    family_records, family_query_stats = fetch_records_for_values(
        metadata["families"], "nr_famille_docdb", family_ids, args.cache_dir, args.refresh, args.workers,
    )
    technology_records, technology_query_stats = fetch_records_for_values(
        metadata["technologies"], "nr_famille_docdb", family_ids, args.cache_dir, args.refresh, args.workers,
    )
    families, applications, technologies, portfolio_stats = build_portfolio_items(
        applicant_rows, application_records, family_records, technology_records,
    )
    stats = {
        "applicants": applicant_stats,
        "applications_api": application_query_stats,
        "families_api": family_query_stats,
        "technologies_api": technology_query_stats,
        "portfolio": portfolio_stats,
        "applicant_csv_downloaded": applicant_downloaded,
    }
    report = build_index(args.output, families, applications, technologies, metadata, stats)
    report["pipeline"] = stats
    report_path = args.output.with_suffix(".report.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
