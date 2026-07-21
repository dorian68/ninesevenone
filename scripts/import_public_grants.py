"""Index open SCDL public-grant conventions for Guadeloupe companies.

The importer only consumes datasets carrying an explicit open licence and only
links beneficiaries through exact SIRET or unambiguous exact RNA identifiers.
Published amounts represent awarded conventions, not proof of payment.
"""

from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import io
import json
from pathlib import Path
import re
import sqlite3
import unicodedata
from urllib.parse import urlencode

import requests


ROOT = Path(__file__).resolve().parents[1]
DATASETS_API = "https://www.data.gouv.fr/api/1/datasets/"
SCHEMA_PAGE = "https://schema.data.gouv.fr/scdl/subventions/"
DEFAULT_COMPANY_DB = ROOT / "data/guadeloupe-enterprises.sqlite"
DEFAULT_CACHE = ROOT / "data/imports/public-grants"
DEFAULT_OUTPUT = ROOT / "data/public-grants.sqlite"
USER_AGENT = "guadeloupe-entreprises-public-grants/0.1 (+public open-data reuse)"
MAX_RESOURCE_BYTES = 50 * 1024 * 1024

OPEN_LICENSES = {
    "lov2": ("Licence Ouverte 2.0", "https://www.etalab.gouv.fr/licence-ouverte-open-licence/"),
    "fr-lo": ("Licence Ouverte", "https://www.etalab.gouv.fr/licence-ouverte-open-licence/"),
    "odc-odbl": ("ODbL 1.0", "https://opendatacommons.org/licenses/odbl/1-0/"),
}

HEADER_ALIASES = {
    "awarding_authority": {"nomattribuant"},
    "awarding_authority_siret": {"idattribuant"},
    "convention_date": {"dateconvention", "datedeconvention", "datedecision"},
    "decision_reference": {"referencedecision", "referencedeliberation"},
    "beneficiary_name": {"nombeneficiaire", "nombenecifiaire", "nombeneficiere"},
    "beneficiary_siret": {"idbeneficiaire"},
    "beneficiary_rna": {"rnabeneficiaire"},
    "purpose": {"objet"},
    "amount": {"montant"},
    "nature": {"nature"},
    "payment_conditions": {"conditionsversement"},
    "payment_period": {"datesperiodeversement", "dateperiodeversement"},
    "rae_id": {"idrae"},
    "eu_notification": {"notificationue"},
    "subsidy_percentage": {"pourcentagesubvention"},
    "aid_scheme": {"dispositifaide"},
}


@dataclass(frozen=True)
class TargetIndex:
    company_sirens: set[str]
    active_sirets: set[str]
    rna_to_sirens: dict[str, set[str]]


def compact_text(value: object, limit: int = 1_000) -> str | None:
    if value is None:
        return None
    cleaned = re.sub(r"\s+", " ", str(value)).strip(" \t\r\n\ufeff")
    if not cleaned:
        return None
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[:limit].rsplit(" ", 1)[0].rstrip(" ,;:-") + "…"


def normalize_header(value: object) -> str:
    text = unicodedata.normalize("NFD", str(value or ""))
    ascii_text = "".join(character for character in text if unicodedata.category(character) != "Mn")
    return re.sub(r"[^a-z0-9]", "", ascii_text.lower().replace("\ufeff", ""))


def normalized_digits(value: object, length: int) -> str | None:
    raw = compact_text(value, 64)
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    return digits if len(digits) == length else None


def normalized_rna(value: object) -> str | None:
    raw = compact_text(value, 32)
    if not raw:
        return None
    candidate = re.sub(r"[^A-Z0-9]", "", raw.upper())
    return candidate if re.fullmatch(r"W[A-Z0-9]{9}", candidate) else None


def normalized_date(value: object) -> str | None:
    raw = compact_text(value, 64)
    if not raw:
        return None
    iso = re.match(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})", raw)
    european = re.match(r"^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})", raw)
    if iso:
        year, month, day = map(int, iso.groups())
    elif european:
        day, month, year = map(int, european.groups())
    else:
        return None
    try:
        return datetime(year, month, day).date().isoformat()
    except ValueError:
        return None


def parse_number(value: object) -> float | None:
    raw = compact_text(value, 100)
    if not raw:
        return None
    normalized = raw.replace("\u202f", "").replace("\xa0", "").replace("€", "").replace(" ", "")
    if "," in normalized and "." in normalized:
        if normalized.rfind(",") > normalized.rfind("."):
            normalized = normalized.replace(".", "").replace(",", ".")
        else:
            normalized = normalized.replace(",", "")
    elif "," in normalized:
        normalized = normalized.replace(",", ".")
    normalized = re.sub(r"[^0-9.+-]", "", normalized)
    try:
        result = float(normalized)
    except ValueError:
        return None
    return result if result >= 0 and result < 10**13 else None


def parse_boolean(value: object) -> int | None:
    raw = normalize_header(value)
    if raw in {"true", "vrai", "oui", "o", "1"}:
        return 1
    if raw in {"false", "faux", "non", "n", "0"}:
        return 0
    return None


def fetch_catalog(session: requests.Session) -> tuple[list[dict[str, object]], int]:
    page = 1
    datasets: list[dict[str, object]] = []
    total = 0
    while True:
        response = session.get(
            DATASETS_API,
            params={"schema": "scdl/subventions", "page_size": 100, "page": page},
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        batch = payload.get("data", [])
        if not isinstance(batch, list):
            raise RuntimeError("Réponse catalogue data.gouv.fr invalide")
        datasets.extend(item for item in batch if isinstance(item, dict))
        total = int(payload.get("total") or len(datasets))
        if len(datasets) >= total or not batch:
            return datasets, total
        page += 1


def open_csv_resources(datasets: list[dict[str, object]]) -> tuple[list[dict[str, object]], dict[str, int]]:
    resources: list[dict[str, object]] = []
    skipped_unspecified = 0
    for dataset in datasets:
        license_code = str(dataset.get("license") or "")
        for resource in dataset.get("resources", []):
            if not isinstance(resource, dict) or str(resource.get("format") or "").lower() != "csv":
                continue
            if license_code not in OPEN_LICENSES:
                skipped_unspecified += 1
                continue
            resources.append({"dataset": dataset, "resource": resource})
    return resources, {"csv_without_explicit_open_license": skipped_unspecified}


def load_targets(company_db: Path) -> TargetIndex:
    connection = sqlite3.connect(company_db)
    company_rows = connection.execute("SELECT siren, association_id FROM companies").fetchall()
    siret_rows = connection.execute("SELECT siret FROM establishments").fetchall()
    connection.close()
    company_sirens = {str(row[0]) for row in company_rows if re.fullmatch(r"\d{9}", str(row[0]))}
    active_sirets = {str(row[0]) for row in siret_rows if re.fullmatch(r"\d{14}", str(row[0]))}
    rna_to_sirens: dict[str, set[str]] = {}
    for siren, rna in company_rows:
        normalized = normalized_rna(rna)
        if normalized and str(siren) in company_sirens:
            rna_to_sirens.setdefault(normalized, set()).add(str(siren))
    return TargetIndex(company_sirens, active_sirets, rna_to_sirens)


def resolve_match(siret: str | None, rna: str | None, targets: TargetIndex) -> tuple[str, str, float] | None:
    siret_siren = siret[:9] if siret and siret[:9] in targets.company_sirens else None
    rna_sirens = targets.rna_to_sirens.get(rna, set()) if rna else set()
    if siret and not siret_siren and rna_sirens:
        return None
    if siret_siren:
        if rna_sirens and siret_siren not in rna_sirens:
            return None
        if rna_sirens:
            method = "exact_active_siret_rna" if siret in targets.active_sirets else "exact_company_siret_rna"
            return siret_siren, method, 1.0
        if siret in targets.active_sirets:
            return siret_siren, "exact_active_siret", 1.0
        return siret_siren, "exact_company_siret", 0.98
    if len(rna_sirens) == 1:
        return next(iter(rna_sirens)), "exact_unambiguous_rna", 0.95
    return None


def decode_csv(path: Path) -> tuple[str, str]:
    raw = path.read_bytes()
    if b"<html" in raw[:1_000].lower() or b"<!doctype html" in raw[:1_000].lower():
        raise ValueError("La ressource CSV contient une page HTML")
    for encoding in ("utf-8-sig", "cp1252", "latin1"):
        try:
            return raw.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    raise ValueError("Encodage CSV non pris en charge")


def csv_dialect(text: str) -> csv.Dialect:
    try:
        return csv.Sniffer().sniff(text[:20_000], delimiters=",;\t|")
    except csv.Error:
        return csv.excel


def canonical_columns(fieldnames: list[str]) -> dict[str, str]:
    normalized = {normalize_header(field): field for field in fieldnames if field is not None}
    columns: dict[str, str] = {}
    for canonical, aliases in HEADER_ALIASES.items():
        for alias in aliases:
            if alias in normalized:
                columns[canonical] = normalized[alias]
                break
    return columns


def download_resource(
    session: requests.Session,
    resource: dict[str, object],
    cache_dir: Path,
    refresh: bool,
) -> tuple[Path, bool]:
    resource_id = str(resource.get("id") or "")
    url = str(resource.get("url") or "")
    if not resource_id or not re.match(r"^https?://", url):
        raise ValueError("URL de ressource absente ou invalide")
    expected = int(resource.get("filesize") or 0)
    if expected > MAX_RESOURCE_BYTES:
        raise ValueError(f"Ressource trop volumineuse ({expected} octets)")
    cache_dir.mkdir(parents=True, exist_ok=True)
    target = cache_dir / f"{resource_id}.csv"
    if not refresh and target.exists() and target.stat().st_size > 0 and (not expected or target.stat().st_size == expected):
        return target, False
    partial = target.with_suffix(".csv.part")
    partial.unlink(missing_ok=True)
    with session.get(url, stream=True, timeout=(30, 90)) as response:
        response.raise_for_status()
        content_type = response.headers.get("Content-Type", "").lower()
        if "text/html" in content_type:
            raise ValueError("La ressource annoncée CSV est une page HTML")
        downloaded = 0
        with partial.open("wb") as output:
            for chunk in response.iter_content(256 * 1024):
                if not chunk:
                    continue
                downloaded += len(chunk)
                if downloaded > MAX_RESOURCE_BYTES:
                    raise ValueError("Ressource supérieure à la limite de sécurité")
                output.write(chunk)
    if expected and partial.stat().st_size != expected:
        partial.unlink(missing_ok=True)
        raise IOError(f"Taille inattendue: {partial.stat().st_size if partial.exists() else 0} au lieu de {expected}")
    partial.replace(target)
    return target, True


def grant_fingerprint(grant: dict[str, object]) -> str:
    stable = [
        grant.get("siren"), grant.get("siret"), grant.get("rna_id"),
        grant.get("awarding_authority_siret"), grant.get("awarding_authority"),
        grant.get("convention_date"), grant.get("decision_reference"), grant.get("purpose"),
        f"{float(grant.get('amount') or 0):.2f}", grant.get("nature"), grant.get("payment_period"),
    ]
    return sha256("|".join(str(value or "").casefold() for value in stable).encode("utf-8")).hexdigest()


def parse_resource(
    path: Path,
    item: dict[str, object],
    targets: TargetIndex,
) -> tuple[list[dict[str, object]], dict[str, object]]:
    dataset = item["dataset"]
    resource = item["resource"]
    text, encoding = decode_csv(path)
    dialect = csv_dialect(text)
    reader = csv.DictReader(io.StringIO(text, newline=""), dialect=dialect)
    fieldnames = [str(value) for value in (reader.fieldnames or [])]
    columns = canonical_columns(fieldnames)
    if not {"beneficiary_siret", "beneficiary_rna"} & columns.keys():
        raise ValueError("Aucun identifiant bénéficiaire SIRET/RNA reconnu")
    if not {"purpose", "amount", "beneficiary_name"}.issubset(columns):
        raise ValueError("Schéma incomplet: bénéficiaire, objet ou montant absent")
    license_code = str(dataset.get("license") or "")
    license_name, license_url = OPEN_LICENSES[license_code]
    source_modified = compact_text(resource.get("last_modified"), 64)
    source_reference_date = normalized_date(source_modified)
    grants: list[dict[str, object]] = []
    stats: dict[str, object] = {
        "rows_read": 0,
        "rows_with_identifier": 0,
        "rows_matched": 0,
        "rows_unmatched": 0,
        "identifier_conflicts_or_ambiguities": 0,
        "encoding": encoding,
        "delimiter": dialect.delimiter,
        "columns": sorted(columns),
    }
    for row_number, row in enumerate(reader, start=2):
        stats["rows_read"] = int(stats["rows_read"]) + 1
        value = lambda key: row.get(columns[key]) if key in columns else None
        siret = normalized_digits(value("beneficiary_siret"), 14)
        rna = normalized_rna(value("beneficiary_rna"))
        if not siret and not rna:
            continue
        stats["rows_with_identifier"] = int(stats["rows_with_identifier"]) + 1
        match = resolve_match(siret, rna, targets)
        if not match:
            has_local_siret = bool(siret and siret[:9] in targets.company_sirens)
            has_local_rna = bool(rna and targets.rna_to_sirens.get(rna))
            if has_local_siret or has_local_rna:
                stats["identifier_conflicts_or_ambiguities"] = int(stats["identifier_conflicts_or_ambiguities"]) + 1
            else:
                stats["rows_unmatched"] = int(stats["rows_unmatched"]) + 1
            continue
        siren, match_method, confidence = match
        purpose = compact_text(value("purpose"), 2_000)
        beneficiary_name = compact_text(value("beneficiary_name"), 500)
        amount = parse_number(value("amount"))
        if not purpose or not beneficiary_name or amount is None:
            continue
        grant = {
            "siren": siren,
            "siret": siret,
            "rna_id": rna,
            "match_method": match_method,
            "match_confidence": confidence,
            "beneficiary_name": beneficiary_name,
            "awarding_authority": compact_text(value("awarding_authority"), 500),
            "awarding_authority_siret": normalized_digits(value("awarding_authority_siret"), 14),
            "convention_date": normalized_date(value("convention_date")),
            "decision_reference": compact_text(value("decision_reference"), 300),
            "purpose": purpose,
            "amount": amount,
            "nature": compact_text(value("nature"), 200),
            "payment_conditions": compact_text(value("payment_conditions"), 1_000),
            "payment_period": compact_text(value("payment_period"), 300),
            "rae_id": compact_text(value("rae_id"), 100),
            "eu_notification": parse_boolean(value("eu_notification")),
            "subsidy_percentage": parse_number(value("subsidy_percentage")),
            "aid_scheme": compact_text(value("aid_scheme"), 500),
            "dataset_id": str(dataset.get("id") or ""),
            "dataset_title": compact_text(dataset.get("title"), 500),
            "dataset_url": str(dataset.get("page") or f"https://www.data.gouv.fr/datasets/{dataset.get('id')}/"),
            "resource_id": str(resource.get("id") or ""),
            "resource_title": compact_text(resource.get("title"), 500),
            "resource_url": str(resource.get("url") or ""),
            "source_row_number": row_number,
            "source_last_modified": source_modified,
            "source_reference_date": source_reference_date,
            "license_code": license_code,
            "license_name": license_name,
            "license_url": license_url,
        }
        grant["fingerprint"] = grant_fingerprint(grant)
        grants.append(grant)
        stats["rows_matched"] = int(stats["rows_matched"]) + 1
    return grants, stats


def build_index(
    grants: list[dict[str, object]],
    resource_runs: list[dict[str, object]],
    output: Path,
    context: dict[str, object],
) -> dict[str, object]:
    partial = output.with_suffix(output.suffix + ".part")
    partial.unlink(missing_ok=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(partial)
    connection.execute("PRAGMA journal_mode=DELETE")
    connection.executescript("""
      CREATE TABLE public_grants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fingerprint TEXT NOT NULL UNIQUE,
        siren TEXT NOT NULL,
        siret TEXT,
        rna_id TEXT,
        match_method TEXT NOT NULL,
        match_confidence REAL NOT NULL,
        beneficiary_name TEXT NOT NULL,
        awarding_authority TEXT,
        awarding_authority_siret TEXT,
        convention_date TEXT,
        decision_reference TEXT,
        purpose TEXT NOT NULL,
        amount REAL NOT NULL,
        nature TEXT,
        payment_conditions TEXT,
        payment_period TEXT,
        rae_id TEXT,
        eu_notification INTEGER,
        subsidy_percentage REAL,
        aid_scheme TEXT,
        source_reference_date TEXT,
        imported_at TEXT NOT NULL
      );
      CREATE TABLE grant_occurrences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        grant_id INTEGER NOT NULL REFERENCES public_grants(id) ON DELETE CASCADE,
        dataset_id TEXT NOT NULL,
        dataset_title TEXT,
        dataset_url TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        resource_title TEXT,
        resource_url TEXT NOT NULL,
        source_row_number INTEGER NOT NULL,
        source_last_modified TEXT,
        license_code TEXT NOT NULL,
        license_name TEXT NOT NULL,
        license_url TEXT NOT NULL,
        UNIQUE (grant_id, resource_id, source_row_number)
      );
      CREATE TABLE resource_imports (
        resource_id TEXT PRIMARY KEY,
        dataset_id TEXT,
        dataset_title TEXT,
        resource_url TEXT,
        license_code TEXT,
        status TEXT NOT NULL,
        detail TEXT,
        rows_read INTEGER NOT NULL DEFAULT 0,
        rows_matched INTEGER NOT NULL DEFAULT 0,
        imported_at TEXT NOT NULL
      );
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX public_grants_siren_date_idx ON public_grants(siren, convention_date DESC);
      CREATE INDEX public_grants_siret_idx ON public_grants(siret);
      CREATE INDEX public_grants_rna_idx ON public_grants(rna_id);
      CREATE INDEX public_grants_authority_idx ON public_grants(awarding_authority_siret);
      CREATE INDEX grant_occurrences_resource_idx ON grant_occurrences(resource_id);
    """)
    imported_at = datetime.now(timezone.utc).isoformat()
    unique_grants = 0
    occurrences = 0
    for grant in grants:
        connection.execute(
            """INSERT OR IGNORE INTO public_grants (
              fingerprint, siren, siret, rna_id, match_method, match_confidence,
              beneficiary_name, awarding_authority, awarding_authority_siret,
              convention_date, decision_reference, purpose, amount, nature,
              payment_conditions, payment_period, rae_id, eu_notification,
              subsidy_percentage, aid_scheme, source_reference_date, imported_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            tuple(grant.get(key) for key in (
                "fingerprint", "siren", "siret", "rna_id", "match_method", "match_confidence",
                "beneficiary_name", "awarding_authority", "awarding_authority_siret",
                "convention_date", "decision_reference", "purpose", "amount", "nature",
                "payment_conditions", "payment_period", "rae_id", "eu_notification",
                "subsidy_percentage", "aid_scheme", "source_reference_date",
            )) + (imported_at,),
        )
        grant_id = connection.execute("SELECT id FROM public_grants WHERE fingerprint = ?", (grant["fingerprint"],)).fetchone()[0]
        inserted = connection.execute(
            """INSERT OR IGNORE INTO grant_occurrences (
              grant_id, dataset_id, dataset_title, dataset_url, resource_id,
              resource_title, resource_url, source_row_number, source_last_modified,
              license_code, license_name, license_url
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (grant_id,) + tuple(grant.get(key) for key in (
                "dataset_id", "dataset_title", "dataset_url", "resource_id", "resource_title",
                "resource_url", "source_row_number", "source_last_modified", "license_code",
                "license_name", "license_url",
            )),
        ).rowcount
        occurrences += inserted
    unique_grants = connection.execute("SELECT COUNT(*) FROM public_grants").fetchone()[0]
    for run in resource_runs:
        connection.execute(
            """INSERT INTO resource_imports (
              resource_id, dataset_id, dataset_title, resource_url, license_code,
              status, detail, rows_read, rows_matched, imported_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?)""",
            tuple(run.get(key) for key in (
                "resource_id", "dataset_id", "dataset_title", "resource_url", "license_code",
                "status", "detail", "rows_read", "rows_matched",
            )) + (imported_at,),
        )
    aggregate = connection.execute(
        """SELECT COUNT(DISTINCT siren), COALESCE(SUM(amount), 0),
                  MIN(convention_date), MAX(convention_date),
                  SUM(match_method = 'exact_active_siret'),
                  SUM(match_method = 'exact_company_siret'),
                  SUM(match_method = 'exact_unambiguous_rna'),
                  SUM(match_method = 'exact_active_siret_rna'),
                  SUM(match_method = 'exact_company_siret_rna')
           FROM public_grants"""
    ).fetchone()
    report = {
        **context,
        "source": "Données essentielles des conventions de subvention SCDL publiées sur data.gouv.fr",
        "schema_url": SCHEMA_PAGE,
        "imported_at": imported_at,
        "unique_grants": unique_grants,
        "source_occurrences": occurrences,
        "deduplicated_occurrences": max(0, occurrences - unique_grants),
        "matched_companies": aggregate[0],
        "total_awarded_amount": aggregate[1],
        "earliest_convention_date": aggregate[2],
        "latest_convention_date": aggregate[3],
        "exact_active_siret": aggregate[4] or 0,
        "exact_company_siret": aggregate[5] or 0,
        "exact_unambiguous_rna": aggregate[6] or 0,
        "exact_active_siret_rna": aggregate[7] or 0,
        "exact_company_siret_rna": aggregate[8] or 0,
        "database": str(output),
        "absence_is_conclusive": False,
        "amount_is_payment_proof": False,
    }
    metadata = {
        key: json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list, bool)) else str(value or "")
        for key, value in report.items()
        if key != "database"
    }
    connection.executemany("INSERT INTO metadata(key, value) VALUES (?, ?)", metadata.items())
    connection.commit()
    connection.execute("ANALYZE")
    connection.close()
    partial.replace(output)
    output.with_suffix(".report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--company-db", type=Path, default=DEFAULT_COMPANY_DB)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--skip-download", action="store_true")
    args = parser.parse_args()

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept": "text/csv,application/json;q=0.9,*/*;q=0.5"})
    datasets, catalog_total = fetch_catalog(session)
    resources, skipped = open_csv_resources(datasets)
    targets = load_targets(args.company_db)
    all_grants: list[dict[str, object]] = []
    runs: list[dict[str, object]] = []
    downloaded = 0
    cached = 0
    for index, item in enumerate(resources, start=1):
        dataset = item["dataset"]
        resource = item["resource"]
        resource_id = str(resource.get("id") or f"missing-{index}")
        run: dict[str, object] = {
            "resource_id": resource_id,
            "dataset_id": str(dataset.get("id") or ""),
            "dataset_title": compact_text(dataset.get("title"), 500),
            "resource_url": str(resource.get("url") or ""),
            "license_code": str(dataset.get("license") or ""),
            "status": "pending",
            "detail": None,
            "rows_read": 0,
            "rows_matched": 0,
        }
        try:
            if args.skip_download:
                path = args.cache_dir / f"{resource_id}.csv"
                if not path.exists():
                    raise FileNotFoundError("Ressource absente du cache local")
                was_downloaded = False
            else:
                path, was_downloaded = download_resource(session, resource, args.cache_dir, args.refresh)
            downloaded += int(was_downloaded)
            cached += int(not was_downloaded)
            grants, stats = parse_resource(path, item, targets)
            all_grants.extend(grants)
            run.update({
                "status": "imported",
                "detail": json.dumps({key: stats[key] for key in ("encoding", "delimiter", "columns")}, ensure_ascii=False),
                "rows_read": stats["rows_read"],
                "rows_matched": stats["rows_matched"],
                "rows_with_identifier": stats["rows_with_identifier"],
                "rows_unmatched": stats["rows_unmatched"],
                "identifier_conflicts_or_ambiguities": stats["identifier_conflicts_or_ambiguities"],
            })
        except Exception as error:  # Each public resource is independently recoverable.
            run.update({"status": "skipped", "detail": f"{type(error).__name__}: {str(error)[:500]}"})
        runs.append(run)
        print(f"[{index}/{len(resources)}] {run['status']} · {run['dataset_title']} · {run['rows_matched']} correspondance(s)", flush=True)

    status_counts: dict[str, int] = {}
    for run in runs:
        status = str(run["status"])
        status_counts[status] = status_counts.get(status, 0) + 1
    context = {
        "catalog_dataset_count": catalog_total,
        "open_dataset_count": sum(1 for dataset in datasets if dataset.get("license") in OPEN_LICENSES),
        "open_csv_resource_count": len(resources),
        "resource_statuses": status_counts,
        "resources_downloaded": downloaded,
        "resources_from_cache": cached,
        "rows_read": sum(int(run.get("rows_read") or 0) for run in runs),
        "rows_with_identifier": sum(int(run.get("rows_with_identifier") or 0) for run in runs),
        "rows_matched_before_deduplication": len(all_grants),
        "rows_unmatched": sum(int(run.get("rows_unmatched") or 0) for run in runs),
        "identifier_conflicts_or_ambiguities": sum(int(run.get("identifier_conflicts_or_ambiguities") or 0) for run in runs),
        "target_company_count": len(targets.company_sirens),
        "target_active_siret_count": len(targets.active_sirets),
        "target_rna_count": len(targets.rna_to_sirens),
        **skipped,
    }
    print(json.dumps(build_index(all_grants, runs, args.output, context), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
