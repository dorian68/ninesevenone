"""Build an exact local index of ADEME financial-aid commitments.

The open dataset covers non-confidential grants and repayable aids committed by
ADEME since 2021. Matching is restricted to exact beneficiary SIRET values.
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
        normalized_date,
        normalized_digits,
        parse_boolean,
        parse_number,
    )
except ModuleNotFoundError:  # Direct execution with scripts/ as sys.path[0].
    from import_public_grants import (  # type: ignore[no-redef]
        compact_text,
        load_targets,
        normalized_date,
        normalized_digits,
        parse_boolean,
        parse_number,
    )


ROOT = Path(__file__).resolve().parents[1]
DATASET_ID = "les-aides-financieres-de-l'ademe"
API_BASE = "https://data.ademe.fr/data-fair/api/v1/datasets/les-aides-financieres-de-l%27ademe"
DATASET_PAGE = "https://data.ademe.fr/datasets/les-aides-financieres-de-l'ademe"
DATA_GOUV_PAGE = "https://www.data.gouv.fr/datasets/les-aides-financieres-de-lademe-1"
DEFAULT_COMPANY_DB = ROOT / "data/guadeloupe-enterprises.sqlite"
DEFAULT_SOURCE = ROOT / "data/imports/ademe-financial-aids.csv"
DEFAULT_OUTPUT = ROOT / "data/ademe-financial-aids.sqlite"
USER_AGENT = "guadeloupe-entreprises-ademe-aids/0.1 (+public open-data reuse)"
MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024


def source_metadata(session: requests.Session) -> dict[str, object]:
    response = session.get(API_BASE, timeout=30)
    response.raise_for_status()
    payload = response.json()
    license_value = payload.get("license") if isinstance(payload.get("license"), dict) else {}
    return {
        "dataset_id": str(payload.get("id") or DATASET_ID),
        "title": compact_text(payload.get("title"), 500),
        "description": compact_text(payload.get("description"), 2_000),
        "source_count": int(payload.get("count") or 0),
        "source_updated_at": str(payload.get("dataUpdatedAt") or payload.get("updatedAt") or ""),
        "license_name": str(license_value.get("title") or "Licence Ouverte 2.0"),
        "license_url": str(license_value.get("href") or "https://www.etalab.gouv.fr/licence-ouverte-open-licence/"),
    }


def download_csv(
    session: requests.Session,
    target: Path,
    metadata: dict[str, object],
    refresh: bool,
) -> bool:
    sidecar = target.with_suffix(".metadata.json")
    if not refresh and target.exists() and sidecar.exists():
        try:
            cached = json.loads(sidecar.read_text(encoding="utf-8"))
            if cached.get("source_updated_at") == metadata.get("source_updated_at") and target.stat().st_size > 0:
                return False
        except (OSError, json.JSONDecodeError):
            pass
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(".csv.part")
    partial.unlink(missing_ok=True)
    downloaded = 0
    with session.get(f"{API_BASE}/convert", stream=True, timeout=(30, 120)) as response:
        response.raise_for_status()
        if "text/csv" not in response.headers.get("Content-Type", "").lower():
            raise ValueError("L'export ADEME n'est pas un CSV")
        with partial.open("wb") as output:
            for chunk in response.iter_content(256 * 1024):
                if not chunk:
                    continue
                downloaded += len(chunk)
                if downloaded > MAX_DOWNLOAD_BYTES:
                    partial.unlink(missing_ok=True)
                    raise ValueError("Export ADEME supérieur à la limite de sécurité")
                output.write(chunk)
    partial.replace(target)
    sidecar.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    return True


def aid_fingerprint(aid: dict[str, object]) -> str:
    stable = [
        aid.get("siret"), aid.get("decision_reference"), aid.get("convention_date"),
        aid.get("purpose"), f"{float(aid.get('amount') or 0):.2f}",
        aid.get("payment_period"), aid.get("aid_scheme"),
    ]
    return sha256("|".join(str(value or "").casefold() for value in stable).encode("utf-8")).hexdigest()


def parse_aids(source: Path, company_db: Path) -> tuple[list[dict[str, object]], dict[str, int]]:
    targets = load_targets(company_db)
    text = source.read_text(encoding="utf-8-sig")
    reader = csv.DictReader(io.StringIO(text, newline=""))
    required = {"idBeneficiaire", "nomBeneficiaire", "objet", "montant", "referenceDecision"}
    if not required.issubset(set(reader.fieldnames or [])):
        raise ValueError(f"Colonnes ADEME manquantes: {sorted(required - set(reader.fieldnames or []))}")
    aids: list[dict[str, object]] = []
    stats = {"rows_read": 0, "rows_with_valid_siret": 0, "rows_matched": 0, "active_siret_matches": 0, "company_siret_matches": 0, "invalid_rows": 0}
    for row_number, row in enumerate(reader, start=2):
        stats["rows_read"] += 1
        siret = normalized_digits(row.get("idBeneficiaire"), 14)
        if not siret:
            stats["invalid_rows"] += 1
            continue
        stats["rows_with_valid_siret"] += 1
        siren = siret[:9]
        if siren not in targets.company_sirens:
            continue
        amount = parse_number(row.get("montant"))
        purpose = compact_text(row.get("objet"), 2_000)
        beneficiary_name = compact_text(row.get("nomBeneficiaire"), 500)
        if amount is None or not purpose or not beneficiary_name:
            stats["invalid_rows"] += 1
            continue
        active = siret in targets.active_sirets
        aid = {
            "source_row_number": row_number,
            "siren": siren,
            "siret": siret,
            "match_scope": "active_local_establishment" if active else "company_historical_establishment",
            "match_confidence": 1.0 if active else 0.98,
            "awarding_authority": compact_text(row.get("Nom de l attribuant"), 500),
            "awarding_authority_siret": normalized_digits(row.get("idAttribuant"), 14),
            "convention_date": normalized_date(row.get("dateConvention")),
            "decision_reference": compact_text(row.get("referenceDecision"), 300),
            "beneficiary_name": beneficiary_name,
            "purpose": purpose,
            "aid_scheme": compact_text(row.get("dispositifAide"), 1_000),
            "amount": amount,
            "nature": compact_text(row.get("nature"), 200),
            "payment_conditions": compact_text(row.get("conditionsVersement"), 500),
            "payment_period": compact_text(row.get("datesPeriodeVersement"), 300),
            "rae_id": compact_text(row.get("idRAE"), 100),
            "eu_notification": parse_boolean(row.get("notificationUE")),
        }
        aid["fingerprint"] = aid_fingerprint(aid)
        aids.append(aid)
        stats["rows_matched"] += 1
        stats["active_siret_matches" if active else "company_siret_matches"] += 1
    return aids, stats


def build_index(
    aids: list[dict[str, object]],
    output: Path,
    metadata: dict[str, object],
    stats: dict[str, int],
    downloaded: bool,
) -> dict[str, object]:
    partial = output.with_suffix(output.suffix + ".part")
    partial.unlink(missing_ok=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(partial)
    connection.executescript("""
      CREATE TABLE ademe_financial_aids (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fingerprint TEXT NOT NULL UNIQUE,
        source_row_number INTEGER NOT NULL,
        siren TEXT NOT NULL,
        siret TEXT NOT NULL,
        match_scope TEXT NOT NULL,
        match_confidence REAL NOT NULL,
        awarding_authority TEXT,
        awarding_authority_siret TEXT,
        convention_date TEXT,
        decision_reference TEXT,
        beneficiary_name TEXT NOT NULL,
        purpose TEXT NOT NULL,
        aid_scheme TEXT,
        amount REAL NOT NULL,
        nature TEXT,
        payment_conditions TEXT,
        payment_period TEXT,
        rae_id TEXT,
        eu_notification INTEGER,
        source_updated_at TEXT NOT NULL,
        source_url TEXT NOT NULL,
        data_gouv_url TEXT NOT NULL,
        license_name TEXT NOT NULL,
        license_url TEXT NOT NULL,
        imported_at TEXT NOT NULL
      );
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX ademe_financial_aids_siren_date_idx ON ademe_financial_aids(siren, convention_date DESC);
      CREATE INDEX ademe_financial_aids_siret_idx ON ademe_financial_aids(siret);
      CREATE INDEX ademe_financial_aids_scheme_idx ON ademe_financial_aids(aid_scheme);
    """)
    imported_at = datetime.now(timezone.utc).isoformat()
    source_updated_at = str(metadata.get("source_updated_at") or "")
    for aid in aids:
        connection.execute(
            """INSERT OR IGNORE INTO ademe_financial_aids (
              fingerprint, source_row_number, siren, siret, match_scope, match_confidence,
              awarding_authority, awarding_authority_siret, convention_date, decision_reference,
              beneficiary_name, purpose, aid_scheme, amount, nature, payment_conditions,
              payment_period, rae_id, eu_notification, source_updated_at, source_url,
              data_gouv_url, license_name, license_url, imported_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            tuple(aid.get(key) for key in (
                "fingerprint", "source_row_number", "siren", "siret", "match_scope", "match_confidence",
                "awarding_authority", "awarding_authority_siret", "convention_date", "decision_reference",
                "beneficiary_name", "purpose", "aid_scheme", "amount", "nature", "payment_conditions",
                "payment_period", "rae_id", "eu_notification",
            )) + (source_updated_at, DATASET_PAGE, DATA_GOUV_PAGE, metadata["license_name"], metadata["license_url"], imported_at),
        )
    aggregate = connection.execute(
        """SELECT COUNT(*), COUNT(DISTINCT siren), SUM(amount),
                  SUM(match_scope = 'active_local_establishment'),
                  SUM(CASE WHEN match_scope = 'active_local_establishment' THEN amount ELSE 0 END),
                  SUM(match_scope = 'company_historical_establishment'),
                  MIN(convention_date), MAX(convention_date), COUNT(DISTINCT aid_scheme)
           FROM ademe_financial_aids"""
    ).fetchone()
    report = {
        "source": metadata.get("title"),
        "source_url": DATASET_PAGE,
        "data_gouv_url": DATA_GOUV_PAGE,
        "source_updated_at": source_updated_at,
        "source_row_count": metadata.get("source_count"),
        "license": metadata.get("license_name"),
        "license_url": metadata.get("license_url"),
        "imported_at": imported_at,
        "downloaded": downloaded,
        **stats,
        "unique_aids": aggregate[0],
        "matched_companies": aggregate[1],
        "total_committed_amount": aggregate[2] or 0,
        "active_local_aid_count": aggregate[3] or 0,
        "active_local_committed_amount": aggregate[4] or 0,
        "historical_or_other_establishment_count": aggregate[5] or 0,
        "earliest_convention_date": aggregate[6],
        "latest_convention_date": aggregate[7],
        "aid_scheme_count": aggregate[8],
        "amount_is_payment_proof": False,
        "database": str(output),
    }
    connection.executemany(
        "INSERT INTO metadata(key, value) VALUES (?, ?)",
        ((key, json.dumps(value, ensure_ascii=False) if isinstance(value, bool) else str(value or "")) for key, value in report.items() if key != "database"),
    )
    connection.commit()
    connection.execute("ANALYZE")
    connection.close()
    partial.replace(output)
    output.with_suffix(".report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--company-db", type=Path, default=DEFAULT_COMPANY_DB)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--skip-download", action="store_true")
    args = parser.parse_args()

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json,text/csv;q=0.9"})
    metadata = source_metadata(session)
    if args.skip_download:
        if not args.source.exists():
            raise SystemExit(f"Export ADEME absent: {args.source}")
        downloaded = False
    else:
        downloaded = download_csv(session, args.source, metadata, args.refresh)
    aids, stats = parse_aids(args.source, args.company_db)
    print(json.dumps(build_index(aids, args.output, metadata, stats, downloaded), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
