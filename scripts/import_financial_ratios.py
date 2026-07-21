"""Build a targeted BCE/INPI financial-ratio index for Guadeloupe companies.

The official dataset contains more than six million rows. This importer only
queries active, publishable SIRENs already present in the territorial company
index. It keeps complete, simplified and consolidated statements separate and
preserves source confidentiality flags without deriving a credit score.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import date, datetime, timezone
import gzip
from hashlib import sha256
import json
import math
from pathlib import Path
import re
import sqlite3
import time
from typing import Iterable

import requests

try:
    from scripts.import_public_grants import compact_text
except ModuleNotFoundError:  # Direct execution with scripts/ as sys.path[0].
    from import_public_grants import compact_text  # type: ignore[no-redef]


ROOT = Path(__file__).resolve().parents[1]
DATASET_ID = "63cb2e29b22886911440440d"
DATASET_SLUG = "ratios_inpi_bce"
DATASET_URL = "https://www.data.gouv.fr/datasets/ratios-financiers-bce-inpi"
DATA_GOUV_API = f"https://www.data.gouv.fr/api/1/datasets/{DATASET_ID}/"
ODS_DATASET_API = f"https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/{DATASET_SLUG}"
ODS_RECORDS_API = f"{ODS_DATASET_API}/records"
LICENSE_NAME = "Licence Ouverte 2.0"
LICENSE_URL = "https://www.etalab.gouv.fr/licence-ouverte-open-licence/"
USER_AGENT = "guadeloupe-entreprises-financial-ratios/0.1 (+public open-data reuse)"
DEFAULT_COMPANY_DB = ROOT / "data/guadeloupe-enterprises.sqlite"
DEFAULT_CACHE_DIR = ROOT / "data/imports/financial-ratios"
DEFAULT_OUTPUT = ROOT / "data/financial-ratios.sqlite"
DEFAULT_CHUNK_SIZE = 150

AMOUNT_FIELDS = (
    "chiffre_d_affaires", "marge_brute", "ebe", "ebit", "resultat_net",
)
RATIO_FIELDS = (
    "taux_d_endettement", "ratio_de_liquidite", "ratio_de_vetuste",
    "autonomie_financiere", "poids_bfr_exploitation_sur_ca",
    "couverture_des_interets", "caf_sur_ca", "capacite_de_remboursement",
    "marge_ebe", "resultat_courant_avant_impots_sur_ca",
    "poids_bfr_exploitation_sur_ca_jours", "rotation_des_stocks_jours",
    "credit_clients_jours", "credit_fournisseurs_jours",
)
METRIC_FIELDS = AMOUNT_FIELDS + RATIO_FIELDS
PERCENT_FIELDS = {
    "taux_d_endettement", "ratio_de_liquidite", "ratio_de_vetuste",
    "autonomie_financiere", "poids_bfr_exploitation_sur_ca",
    "caf_sur_ca", "marge_ebe", "resultat_courant_avant_impots_sur_ca",
}
DAY_FIELDS = {
    "poids_bfr_exploitation_sur_ca_jours", "rotation_des_stocks_jours",
    "credit_clients_jours", "credit_fournisseurs_jours",
}


@dataclass(frozen=True)
class CompanyTarget:
    siren: str
    legal_name: str


def normalized_siren(value: object) -> str | None:
    digits = re.sub(r"\D", "", compact_text(value, 64) or "")
    return digits if len(digits) == 9 else None


def parse_number(value: object) -> int | float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(str(value).strip().replace(" ", "").replace(",", "."))
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return int(number) if number.is_integer() else number


def normalized_closing_date(value: object) -> str | None:
    raw = compact_text(value, 40)
    if not raw:
        return None
    candidate = raw[:10]
    try:
        return date.fromisoformat(candidate).isoformat()
    except ValueError:
        return None


def load_company_targets(path: Path) -> dict[str, CompanyTarget]:
    connection = sqlite3.connect(path)
    rows = connection.execute(
        """SELECT siren, legal_name FROM companies
           WHERE administrative_status = 'A' AND diffusion_status <> 'P'"""
    ).fetchall()
    connection.close()
    return {
        str(siren): CompanyTarget(str(siren), str(legal_name or ""))
        for siren, legal_name in rows if re.fullmatch(r"\d{9}", str(siren))
    }


def extract_formula(description: str | None, statement_type: str) -> str | None:
    if not description:
        return None
    if statement_type == "C/K":
        pattern = r"formule(?: bilan)?\s*C/K\s*:\s*(.+?)(?=\s+-\s+formule(?: bilan)?\s+S\s*:|[\r\n]|$)"
    elif statement_type == "S":
        pattern = r"formule(?: bilan)?\s*S\s*:\s*(.+?)(?=[\r\n]|$)"
    else:
        raise ValueError("Type de formule inconnu")
    match = re.search(pattern, description, flags=re.IGNORECASE)
    return compact_text(match.group(1), 2_000) if match else None


def metric_unit(field_name: str) -> str:
    if field_name in AMOUNT_FIELDS:
        return "EUR"
    if field_name in PERCENT_FIELDS:
        return "percent"
    if field_name in DAY_FIELDS:
        return "days"
    return "ratio"


def source_metadata(session: requests.Session) -> tuple[dict[str, object], list[dict[str, object]]]:
    data_gouv_response = session.get(DATA_GOUV_API, timeout=45)
    data_gouv_response.raise_for_status()
    data_gouv = data_gouv_response.json()
    if str(data_gouv.get("license") or "").lower() not in {"fr-lo", "lov2"}:
        raise RuntimeError("Licence ouverte BCE/INPI non confirmée")

    ods_response = session.get(ODS_DATASET_API, timeout=45)
    ods_response.raise_for_status()
    ods = ods_response.json()
    fields = ods.get("fields") or []
    available_fields = {item.get("name") for item in fields if isinstance(item, dict)}
    required = {"siren", "date_cloture_exercice", "type_bilan", "confidentiality", *METRIC_FIELDS}
    if not required.issubset(available_fields):
        raise RuntimeError(f"Champs BCE/INPI manquants: {sorted(required - available_fields)}")
    default_meta = (ods.get("metas") or {}).get("default") or {}
    license_value = str(default_meta.get("license") or "")
    if "ouverte" not in license_value.casefold():
        raise RuntimeError("Licence ouverte du portail BCE non confirmée")
    metadata = {
        "dataset_id": str(data_gouv.get("id") or DATASET_ID),
        "dataset_slug": DATASET_SLUG,
        "title": compact_text(default_meta.get("title") or data_gouv.get("title"), 500),
        "description": compact_text(default_meta.get("description"), 4_000),
        "publisher": compact_text(default_meta.get("publisher"), 200),
        "records_count": int(default_meta.get("records_count") or 0),
        "source_updated_at": str(default_meta.get("modified") or data_gouv.get("last_update") or ""),
        "data_processed_at": str(default_meta.get("data_processed") or ""),
        "dataset_url": DATASET_URL,
        "api_url": ODS_DATASET_API,
        "license_name": LICENSE_NAME,
        "license_url": LICENSE_URL,
    }
    definitions = []
    for field in fields:
        if not isinstance(field, dict) or field.get("name") not in METRIC_FIELDS:
            continue
        field_name = str(field["name"])
        description = compact_text(field.get("description"), 4_000)
        definitions.append({
            "field_name": field_name,
            "label": compact_text(field.get("label"), 300) or field_name,
            "value_type": compact_text(field.get("type"), 50) or "unknown",
            "unit": metric_unit(field_name),
            "description": description,
            "formula_ck": extract_formula(description, "C/K"),
            "formula_s": extract_formula(description, "S"),
        })
    if len(definitions) != len(METRIC_FIELDS):
        raise RuntimeError("Définitions des métriques BCE/INPI incomplètes")
    return metadata, definitions


def chunks(values: list[str], size: int) -> Iterable[list[str]]:
    for start in range(0, len(values), size):
        yield values[start:start + size]


def request_json_with_retry(
    session: requests.Session,
    params: dict[str, object],
    attempts: int = 6,
) -> tuple[dict[str, object], int]:
    retries = 0
    for attempt in range(attempts):
        response = session.get(ODS_RECORDS_API, params=params, timeout=(20, 90))
        if response.status_code == 200:
            return response.json(), retries
        if response.status_code not in {429, 500, 502, 503, 504} or attempt == attempts - 1:
            response.raise_for_status()
        retries += 1
        retry_after = response.headers.get("Retry-After")
        time.sleep(float(retry_after) if retry_after and retry_after.isdigit() else 0.5 * (2 ** attempt))
    raise RuntimeError("API BCE/INPI indisponible")


def query_siren_chunk(sirens: list[str]) -> tuple[list[dict[str, object]], int, int]:
    if not sirens or any(not re.fullmatch(r"\d{9}", siren) for siren in sirens):
        raise ValueError("Lot de SIREN invalide")
    where = f'siren IN ({",".join(json.dumps(siren) for siren in sirens)})'
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    records: list[dict[str, object]] = []
    calls = retries = offset = 0
    while True:
        payload, page_retries = request_json_with_retry(
            session, {"where": where, "limit": 100, "offset": offset},
        )
        calls += 1
        retries += page_retries
        page = payload.get("results") or []
        if not isinstance(page, list):
            raise ValueError("Réponse BCE/INPI invalide")
        records.extend(item for item in page if isinstance(item, dict))
        total = int(payload.get("total_count") or 0)
        offset += len(page)
        if not page or offset >= total:
            break
        if calls > 250:
            raise RuntimeError("Pagination BCE/INPI excessive")
    session.close()
    return records, calls, retries


def fetch_chunk(
    sirens: list[str], metadata: dict[str, object], cache_dir: Path, refresh: bool,
) -> tuple[list[dict[str, object]], dict[str, int]]:
    source_version = sha256(str(metadata["source_updated_at"]).encode()).hexdigest()[:12]
    siren_digest = sha256("\n".join(sirens).encode()).hexdigest()
    cache_path = cache_dir / "chunks" / f"{source_version}-{siren_digest[:24]}.json.gz"
    signature = {
        "source_updated_at": metadata["source_updated_at"],
        "siren_sha256": siren_digest,
        "siren_count": len(sirens),
    }
    if not refresh and cache_path.exists():
        try:
            with gzip.open(cache_path, "rt", encoding="utf-8") as source:
                cached = json.load(source)
            if cached.get("signature") == signature and isinstance(cached.get("records"), list):
                return cached["records"], {"calls": 0, "retries": 0, "cache_hit": 1, "downloaded": 0}
        except (OSError, json.JSONDecodeError, EOFError):
            pass
    records, calls, retries = query_siren_chunk(sirens)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    partial = cache_path.with_suffix(cache_path.suffix + ".part")
    with gzip.open(partial, "wt", encoding="utf-8") as output:
        json.dump({"signature": signature, "records": records}, output, ensure_ascii=False)
    partial.replace(cache_path)
    return records, {"calls": calls, "retries": retries, "cache_hit": 0, "downloaded": 1}


def fetch_records(
    sirens: Iterable[str], metadata: dict[str, object], cache_dir: Path,
    refresh: bool, workers: int, chunk_size: int,
) -> tuple[list[dict[str, object]], dict[str, int]]:
    batches = list(chunks(sorted(set(sirens)), chunk_size))
    records: list[dict[str, object]] = []
    stats = {"chunk_count": len(batches), "calls": 0, "retries": 0, "cache_hits": 0, "downloaded_chunks": 0}
    with ThreadPoolExecutor(max_workers=max(1, min(workers, 24))) as executor:
        futures = {
            executor.submit(fetch_chunk, batch, metadata, cache_dir, refresh): index
            for index, batch in enumerate(batches)
        }
        ordered: dict[int, list[dict[str, object]]] = {}
        for future in as_completed(futures):
            batch_records, batch_stats = future.result()
            ordered[futures[future]] = batch_records
            stats["calls"] += batch_stats["calls"]
            stats["retries"] += batch_stats["retries"]
            stats["cache_hits"] += batch_stats["cache_hit"]
            stats["downloaded_chunks"] += batch_stats["downloaded"]
        for index in range(len(batches)):
            records.extend(ordered[index])
    return records, stats


def exercise_fingerprint(item: dict[str, object]) -> str:
    stable = (item.get("siren"), item.get("closing_date"), item.get("statement_type"))
    return sha256("|".join(str(value or "") for value in stable).encode()).hexdigest()


def parse_records(
    records: Iterable[dict[str, object]], targets: set[str], source_updated_at: str,
) -> tuple[list[dict[str, object]], dict[str, int]]:
    source_date = normalized_closing_date(source_updated_at)
    if not source_date:
        raise ValueError("Date de mise à jour BCE/INPI invalide")
    stats = {
        "source_rows": 0, "matched_rows": 0, "invalid_siren_rows": 0,
        "out_of_scope_rows": 0, "invalid_date_rows": 0, "invalid_type_rows": 0,
        "duplicate_rows": 0, "conflicting_rows": 0, "future_closing_date_rows": 0,
    }
    exercises: dict[str, dict[str, object]] = {}
    for record in records:
        stats["source_rows"] += 1
        siren = normalized_siren(record.get("siren"))
        if not siren:
            stats["invalid_siren_rows"] += 1
            continue
        if siren not in targets:
            stats["out_of_scope_rows"] += 1
            continue
        closing_date = normalized_closing_date(record.get("date_cloture_exercice"))
        if not closing_date:
            stats["invalid_date_rows"] += 1
            continue
        statement_type = (compact_text(record.get("type_bilan"), 10) or "").upper()
        if statement_type not in {"C", "K", "S"}:
            stats["invalid_type_rows"] += 1
            continue
        confidentiality = compact_text(record.get("confidentiality"), 200) or "Non précisé"
        is_partially_confidential = confidentiality.casefold().startswith("partiellement confidentiel")
        item: dict[str, object] = {
            "siren": siren,
            "closing_date": closing_date,
            "statement_type": statement_type,
            "confidentiality": confidentiality,
            "is_partially_confidential": is_partially_confidential,
            "date_quality": "future_closing_date" if closing_date > source_date else "published",
        }
        for field in METRIC_FIELDS:
            item[field] = parse_number(record.get(field))
        item["metric_count"] = sum(item[field] is not None for field in METRIC_FIELDS)
        item["fingerprint"] = exercise_fingerprint(item)
        fingerprint = str(item["fingerprint"])
        existing = exercises.get(fingerprint)
        if existing is not None:
            stats["duplicate_rows"] += 1
            if any(existing.get(field) != item.get(field) for field in (*METRIC_FIELDS, "confidentiality")):
                stats["conflicting_rows"] += 1
                if int(item["metric_count"]) > int(existing["metric_count"]):
                    exercises[fingerprint] = item
            continue
        exercises[fingerprint] = item
        stats["matched_rows"] += 1
        if item["date_quality"] == "future_closing_date":
            stats["future_closing_date_rows"] += 1
    return list(exercises.values()), stats


def build_index(
    output: Path, exercises: list[dict[str, object]], definitions: list[dict[str, object]],
    metadata: dict[str, object], pipeline_stats: dict[str, object],
) -> dict[str, object]:
    partial = output.with_suffix(output.suffix + ".part")
    partial.unlink(missing_ok=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(partial)
    metric_columns = ",\n".join(
        f"{field} {'INTEGER' if field in AMOUNT_FIELDS else 'REAL'}" for field in METRIC_FIELDS
    )
    connection.executescript(f"""
      CREATE TABLE financial_exercises (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fingerprint TEXT NOT NULL UNIQUE,
        siren TEXT NOT NULL,
        closing_date TEXT NOT NULL,
        statement_type TEXT NOT NULL CHECK(statement_type IN ('C','K','S')),
        confidentiality TEXT NOT NULL,
        is_partially_confidential INTEGER NOT NULL,
        date_quality TEXT NOT NULL CHECK(date_quality IN ('published','future_closing_date')),
        metric_count INTEGER NOT NULL,
        {metric_columns},
        source_updated_at TEXT NOT NULL,
        dataset_url TEXT NOT NULL,
        api_url TEXT NOT NULL,
        license_name TEXT NOT NULL,
        license_url TEXT NOT NULL,
        imported_at TEXT NOT NULL
      );
      CREATE TABLE financial_metric_definitions (
        field_name TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        value_type TEXT NOT NULL,
        unit TEXT NOT NULL,
        description TEXT,
        formula_ck TEXT,
        formula_s TEXT
      );
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX financial_siren_date_idx ON financial_exercises(siren, closing_date DESC, statement_type);
      CREATE INDEX financial_quality_idx ON financial_exercises(date_quality, confidentiality);
      CREATE INDEX financial_statement_type_idx ON financial_exercises(statement_type, closing_date DESC);
    """)
    imported_at = datetime.now(timezone.utc).isoformat()
    base_columns = (
        "fingerprint", "siren", "closing_date", "statement_type", "confidentiality",
        "is_partially_confidential", "date_quality", "metric_count", *METRIC_FIELDS,
    )
    extras = (
        metadata["source_updated_at"], metadata["dataset_url"], metadata["api_url"],
        metadata["license_name"], metadata["license_url"], imported_at,
    )
    placeholders = ",".join("?" for _ in range(len(base_columns) + len(extras)))
    connection.executemany(
        f"INSERT OR IGNORE INTO financial_exercises ({','.join(base_columns)},source_updated_at,dataset_url,api_url,license_name,license_url,imported_at) VALUES ({placeholders})",
        [tuple(int(value) if isinstance(value, bool) else value for value in (item.get(column) for column in base_columns)) + extras for item in exercises],
    )
    definition_columns = ("field_name", "label", "value_type", "unit", "description", "formula_ck", "formula_s")
    connection.executemany(
        f"INSERT INTO financial_metric_definitions ({','.join(definition_columns)}) VALUES ({','.join('?' for _ in definition_columns)})",
        [tuple(item.get(column) for column in definition_columns) for item in definitions],
    )
    aggregate = connection.execute(
        """SELECT COUNT(*), COUNT(DISTINCT siren),
                  SUM(statement_type='C'), SUM(statement_type='S'), SUM(statement_type='K'),
                  SUM(is_partially_confidential=1), SUM(date_quality='future_closing_date'),
                  MIN(CASE WHEN date_quality='published' THEN closing_date END),
                  MAX(CASE WHEN date_quality='published' THEN closing_date END)
           FROM financial_exercises"""
    ).fetchone()
    coverage = {
        field: int(connection.execute(f"SELECT COUNT(*) FROM financial_exercises WHERE {field} IS NOT NULL").fetchone()[0])
        for field in METRIC_FIELDS
    }
    report = {
        "source_row_count": metadata["records_count"],
        "queried_company_count": pipeline_stats["queried_company_count"],
        "company_count": int(aggregate[1] or 0),
        "exercise_count": int(aggregate[0] or 0),
        "complete_statement_count": int(aggregate[2] or 0),
        "simplified_statement_count": int(aggregate[3] or 0),
        "consolidated_statement_count": int(aggregate[4] or 0),
        "partially_confidential_count": int(aggregate[5] or 0),
        "future_closing_date_count": int(aggregate[6] or 0),
        "earliest_valid_closing_date": aggregate[7],
        "latest_valid_closing_date": aggregate[8],
        "metric_coverage": coverage,
        "source_updated_at": metadata["source_updated_at"],
        "imported_at": imported_at,
        "contains_personal_data": False,
        "produces_credit_score": False,
        "statement_types_are_blended": False,
        "scope": "national_legal_unit",
    }
    metadata_rows = {
        "source": "Ratios financiers BCE/INPI (RNCS/INPI, traitement DNUM)",
        **metadata, **report, "pipeline": pipeline_stats,
    }
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
    parser.add_argument("--workers", type=int, default=16)
    parser.add_argument("--chunk-size", type=int, default=DEFAULT_CHUNK_SIZE)
    args = parser.parse_args()
    if not 1 <= args.chunk_size <= 180:
        parser.error("--chunk-size doit être compris entre 1 et 180")

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    metadata, definitions = source_metadata(session)
    session.close()
    targets = load_company_targets(args.company_db)
    raw_records, query_stats = fetch_records(
        targets, metadata, args.cache_dir, args.refresh, args.workers, args.chunk_size,
    )
    exercises, parse_stats = parse_records(raw_records, set(targets), str(metadata["source_updated_at"]))
    pipeline_stats: dict[str, object] = {
        "queried_company_count": len(targets),
        "query": query_stats,
        "parse": parse_stats,
    }
    report = build_index(args.output, exercises, definitions, metadata, pipeline_stats)
    report["pipeline"] = pipeline_stats
    report_path = args.output.with_suffix(".report.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
