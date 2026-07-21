"""Import detailed BCE/INPI tax-return cells for territorial companies.

The national parquet is a government reuse of non-confidential INPI annual
accounts. It contains only a SIREN, closing date, statement type,
confidentiality status and a map of numeric tax-form cells. The importer scans
the remote parquet once with DuckDB, caches the exact territorial subset and
publishes an auditable SQLite index. No PDF, person or contact is imported.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone
from hashlib import sha256
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import time
from typing import Iterable
from urllib.parse import urlparse

import duckdb
import requests

try:
    from scripts.import_financial_ratios import load_company_targets, normalized_closing_date, normalized_siren
    from scripts.import_public_grants import compact_text
except ModuleNotFoundError:  # Direct execution with scripts/ as sys.path[0].
    from import_financial_ratios import load_company_targets, normalized_closing_date, normalized_siren  # type: ignore[no-redef]
    from import_public_grants import compact_text  # type: ignore[no-redef]


ROOT = Path(__file__).resolve().parents[1]
DATASET_ID = "6587efa36e80ab61d5792fdd"
DATASET_SLUG = "donnees-financieres-detaillees-des-entreprises-format-parquet"
DATASET_URL = f"https://www.data.gouv.fr/datasets/{DATASET_SLUG}"
DATASET_API = f"https://www.data.gouv.fr/api/1/datasets/{DATASET_ID}/"
RESOURCE_TITLE = "export-detail-bilan.parquet"
LICENSE_NAME = "Licence Ouverte 2.0"
LICENSE_URL = "https://www.etalab.gouv.fr/licence-ouverte-open-licence/"
FULL_FORM_URL = "https://www.impots.gouv.fr/formulaire/2050-liasse/liasse-fiscale-du-regime-reel-normal-en-matiere-de-bic-et-dis"
SIMPLIFIED_FORM_URL = "https://www.impots.gouv.fr/formulaire/2033-sd/liasse-bicsi-regime-rsi-tableaux-ndeg-2033-sd-2033-g-sd"
DEFAULT_COMPANY_DB = ROOT / "data/guadeloupe-enterprises.sqlite"
DEFAULT_CACHE_DIR = ROOT / "data/imports/detailed-financial-statements"
DEFAULT_OUTPUT = ROOT / "data/detailed-financial-statements.sqlite"
USER_AGENT = "guadeloupe-entreprises-detailed-financials/0.1 (+public open-data reuse)"
SATURATED_INT32_VALUES = {-2_147_483_648, 2_147_483_647}

DERIVED_FIELDS = (
    "balance_sheet_total", "equity", "provisions", "financial_debt", "total_debt",
    "fixed_assets_gross", "fixed_assets_net", "current_assets_gross", "current_assets_net",
    "inventory_gross", "inventory_net", "trade_receivables_gross", "trade_receivables_net",
    "cash_and_securities_net", "trade_payables", "tax_social_debt", "capital", "revenue",
    "operating_result", "current_pre_tax_result", "net_income", "personnel_costs",
    "external_purchases", "taxes",
)

METRIC_DEFINITIONS = {
    "balance_sheet_total": ("Total du bilan", "EE", "180"),
    "equity": ("Capitaux propres et autres fonds propres", "DL+DO", "142"),
    "provisions": ("Provisions pour risques et charges", "DR", "154"),
    "financial_debt": ("Emprunts et dettes financières", "DS+DT+DU+DV", "156"),
    "total_debt": ("Total des dettes", "EC", "176"),
    "fixed_assets_gross": ("Actif immobilisé brut", "BJ", "044"),
    "fixed_assets_net": ("Actif immobilisé net", "BJ-BK", "044-048"),
    "current_assets_gross": ("Actif circulant brut", "CJ", "096"),
    "current_assets_net": ("Actif circulant net", "CJ-CK", "096-098"),
    "inventory_gross": ("Stocks bruts", "BL+BN+BP+BR+BT", "050+060"),
    "inventory_net": ("Stocks nets", "BL+BN+BP+BR+BT-BM-BO-BQ-BS-BU", "050+060-052-062"),
    "trade_receivables_gross": ("Créances clients brutes", "BX", "068"),
    "trade_receivables_net": ("Créances clients nettes", "BX-BY", "068-070"),
    "cash_and_securities_net": ("Disponibilités et valeurs mobilières nettes", "CD-CE+CF-CG", "080-082+084-086"),
    "trade_payables": ("Dettes fournisseurs", "DX", "166"),
    "tax_social_debt": ("Dettes fiscales et sociales", "DY", "172"),
    "capital": ("Capital social ou individuel", "DA", "120"),
    "revenue": ("Chiffre d'affaires net", "FL", "210+214+218"),
    "operating_result": ("Résultat d'exploitation", "GG", "270"),
    "current_pre_tax_result": ("Résultat courant avant impôts", "GW", "270+280-294"),
    "net_income": ("Résultat net", "HN ou DI", "310"),
    "personnel_costs": ("Salaires et charges sociales", "FY+FZ", "250+252"),
    "external_purchases": ("Autres achats et charges externes", "FW", "242"),
    "taxes": ("Impôts et taxes d'exploitation", "FX", "244"),
}


def source_metadata(session: requests.Session) -> dict[str, object]:
    response = session.get(DATASET_API, timeout=45)
    response.raise_for_status()
    payload = response.json()
    if str(payload.get("license") or "").lower() not in {"lov2", "fr-lo"}:
        raise RuntimeError("Licence ouverte du détail financier non confirmée")
    resource = next(
        (item for item in payload.get("resources", []) if isinstance(item, dict)
         and str(item.get("title") or "").casefold() == RESOURCE_TITLE.casefold()
         and str(item.get("format") or "").casefold() == "parquet"),
        None,
    )
    if resource is None:
        raise RuntimeError("Parquet financier détaillé introuvable")
    resource_url = str(resource.get("url") or "")
    parsed = urlparse(resource_url)
    if parsed.scheme != "https" or parsed.hostname != "static.data.gouv.fr":
        raise RuntimeError("Hôte de ressource financière non autorisé")
    return {
        "dataset_id": str(payload.get("id") or DATASET_ID),
        "title": compact_text(payload.get("title"), 500),
        "source_updated_at": str(payload.get("last_update") or payload.get("last_modified") or ""),
        "dataset_url": DATASET_URL,
        "license_name": LICENSE_NAME,
        "license_url": LICENSE_URL,
        "resource_id": str(resource.get("id") or ""),
        "resource_title": str(resource.get("title") or RESOURCE_TITLE),
        "resource_url": resource_url,
        "resource_size": int(resource.get("filesize") or 0),
        "resource_last_modified": str(resource.get("last_modified") or ""),
    }


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def load_httpfs(connection: duckdb.DuckDBPyConnection) -> None:
    try:
        connection.execute("LOAD httpfs")
    except duckdb.Error:
        connection.execute("INSTALL httpfs")
        connection.execute("LOAD httpfs")


def valid_parquet_file(path: Path, expected_size: int) -> bool:
    if not path.exists() or path.stat().st_size != expected_size or expected_size < 8:
        return False
    with path.open("rb") as source:
        prefix = source.read(4)
        source.seek(-4, 2)
        suffix = source.read(4)
    return prefix == b"PAR1" and suffix == b"PAR1"


def download_source_resource(
    metadata: dict[str, object], cache_dir: Path, refresh: bool,
) -> tuple[Path, dict[str, object]]:
    source_dir = cache_dir / "source"
    source_dir.mkdir(parents=True, exist_ok=True)
    target = source_dir / f"{metadata['resource_id']}.parquet"
    partial = target.with_suffix(".parquet.part")
    sidecar = target.with_suffix(".metadata.json")
    expected_size = int(metadata["resource_size"])
    signature = {
        "resource_id": metadata["resource_id"],
        "resource_last_modified": metadata["resource_last_modified"],
        "resource_url": metadata["resource_url"],
        "resource_size": expected_size,
    }
    if not refresh and valid_parquet_file(target, expected_size) and sidecar.exists():
        try:
            if json.loads(sidecar.read_text(encoding="utf-8")) == signature:
                return target, {"downloaded": False, "resumed": False, "bytes": expected_size}
        except (OSError, json.JSONDecodeError):
            pass
    if refresh:
        partial.unlink(missing_ok=True)
    if target.exists() and not valid_parquet_file(target, expected_size):
        target.unlink()
    partial.unlink(missing_ok=True)
    segment_dir = source_dir / f"{metadata['resource_id']}.segments"
    segment_dir.mkdir(parents=True, exist_ok=True)
    segment_count = 48
    max_workers = max(1, min(4, int(os.getenv("DETAILED_FINANCIAL_DOWNLOAD_WORKERS", "4"))))
    segment_size = math.ceil(expected_size / segment_count)
    ranges = [
        (index, index * segment_size, min(expected_size - 1, (index + 1) * segment_size - 1))
        for index in range(segment_count) if index * segment_size < expected_size
    ]
    resumed_bytes = sum(
        min((segment_dir / f"{index:02d}.part").stat().st_size, end - start + 1)
        if (segment_dir / f"{index:02d}.part").exists() else 0
        for index, start, end in ranges
    )

    def download_segment(index: int, start: int, end: int) -> tuple[int, int]:
        segment = segment_dir / f"{index:02d}.part"
        expected_segment_size = end - start + 1
        if segment.exists() and segment.stat().st_size > expected_segment_size:
            segment.unlink()
        attempts = 0
        while (segment.stat().st_size if segment.exists() else 0) < expected_segment_size:
            current = segment.stat().st_size if segment.exists() else 0
            range_start = start + current
            session = requests.Session()
            session.headers.update({"User-Agent": USER_AGENT})
            try:
                with session.get(
                    str(metadata["resource_url"]),
                    headers={"Range": f"bytes={range_start}-{end}"},
                    stream=True,
                    timeout=(30, 180),
                ) as response:
                    response.raise_for_status()
                    content_range = response.headers.get("Content-Range") or ""
                    if response.status_code != 206 or not content_range.startswith(f"bytes {range_start}-{end}/"):
                        raise ValueError(f"Plage HTTP invalide pour le segment {index}: {content_range}")
                    with segment.open("ab") as output:
                        for chunk in response.iter_content(4 * 1024 * 1024):
                            if chunk:
                                output.write(chunk)
                attempts = 0
            except (requests.RequestException, ValueError):
                attempts += 1
                if attempts >= 6:
                    session.close()
                    raise
                time.sleep(min(20, 1.5 * (2 ** (attempts - 1))))
            finally:
                session.close()
        if segment.stat().st_size != expected_segment_size:
            raise ValueError(f"Taille invalide pour le segment {index}")
        return index, expected_segment_size

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(download_segment, *item) for item in ranges]
        for future in as_completed(futures):
            index, segment_bytes = future.result()
            print(
                f"Segment {index + 1}/{len(ranges)} téléchargé "
                f"({segment_bytes / (1024 * 1024):.1f} Mio)",
                flush=True,
            )

    with partial.open("wb") as output:
        for index, start, end in ranges:
            segment = segment_dir / f"{index:02d}.part"
            with segment.open("rb") as source:
                while chunk := source.read(16 * 1024 * 1024):
                    output.write(chunk)
            segment.unlink()
    segment_dir.rmdir()
    if partial.stat().st_size != expected_size:
        raise ValueError("Taille du parquet détaillé téléchargé invalide")
    partial.replace(target)
    if not valid_parquet_file(target, expected_size):
        target.unlink(missing_ok=True)
        raise ValueError("Signature du parquet détaillé invalide")
    sidecar.write_text(json.dumps(signature, ensure_ascii=False, indent=2), encoding="utf-8")
    return target, {
        "downloaded": True,
        "resumed": resumed_bytes > 0,
        "resumed_from_bytes": resumed_bytes,
        "segment_count": len(ranges),
        "max_workers": max_workers,
        "bytes": expected_size,
    }
def extract_target_subset(
    targets: Iterable[str], metadata: dict[str, object], cache_dir: Path, refresh: bool,
) -> tuple[Path, dict[str, object]]:
    target_values = sorted(set(targets))
    target_hash = sha256("\n".join(target_values).encode()).hexdigest()
    version_hash = sha256(
        f"{metadata['resource_id']}|{metadata['resource_last_modified']}|{target_hash}".encode()
    ).hexdigest()
    target = cache_dir / f"{metadata['resource_id']}-{version_hash[:20]}-guadeloupe.parquet"
    sidecar = target.with_suffix(".metadata.json")
    signature = {
        "resource_id": metadata["resource_id"],
        "resource_last_modified": metadata["resource_last_modified"],
        "target_sha256": target_hash,
        "target_count": len(target_values),
    }
    if not refresh and target.exists() and sidecar.exists():
        try:
            if json.loads(sidecar.read_text(encoding="utf-8")) == signature and target.stat().st_size > 0:
                return target, {"cache_hit": True, "target_count": len(target_values), "duration_seconds": 0.0}
        except (OSError, json.JSONDecodeError):
            pass

    cache_dir.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(".parquet.part")
    partial.unlink(missing_ok=True)
    source_cache, download_stats = download_source_resource(metadata, cache_dir, refresh=False)
    source_path = str(source_cache)
    started = time.monotonic()

    def scan(source: str) -> tuple[duckdb.DuckDBPyConnection, int]:
        current = duckdb.connect()
        current.execute("SET preserve_insertion_order=false")
        current.execute("CREATE TEMP TABLE target_sirens(siren VARCHAR PRIMARY KEY)")
        current.executemany("INSERT INTO target_sirens VALUES (?)", [(value,) for value in target_values])
        current.execute(
            """CREATE TEMP TABLE matched_statements AS
               SELECT source.siren, source.date_cloture_exercice, source.type_bilan,
                      source.confidentiality, source.liasse
               FROM read_parquet(?) AS source
               INNER JOIN target_sirens AS target USING (siren)""",
            [source],
        )
        return current, int(current.execute("SELECT COUNT(*) FROM matched_statements").fetchone()[0])

    connection, matched_rows = scan(source_path)
    connection.execute(
        f"COPY matched_statements TO {sql_literal(str(partial))} (FORMAT PARQUET, COMPRESSION ZSTD)"
    )
    connection.close()
    partial.replace(target)
    sidecar.write_text(json.dumps(signature, ensure_ascii=False, indent=2), encoding="utf-8")
    return target, {
        "cache_hit": False,
        "target_count": len(target_values),
        "matched_source_rows": matched_rows,
        "source_access_mode": "local_resumable_parquet",
        "source_download": download_stats,
        "duration_seconds": round(time.monotonic() - started, 3),
    }


def normalized_cells(value: object) -> dict[str, int]:
    if not isinstance(value, dict):
        return {}
    result: dict[str, int] = {}
    for raw_code, raw_value in value.items():
        code = compact_text(raw_code, 16)
        if not code or not re.fullmatch(r"[0-9A-Za-zÀ-ÖØ-öø-ÿ-]{1,16}", code):
            continue
        if isinstance(raw_value, bool):
            continue
        try:
            number = float(raw_value)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(number) or not number.is_integer():
            continue
        integer = int(number)
        if integer in SATURATED_INT32_VALUES:
            continue
        result[code.upper()] = integer
    return result


def cell(cells: dict[str, int], code: str) -> int | None:
    return cells.get(code)


def sum_cells(cells: dict[str, int], codes: Iterable[str]) -> int | None:
    values = [cells[code] for code in codes if code in cells]
    return sum(values) if values else None


def difference(left: int | None, right: int | None) -> int | None:
    if left is None:
        return None
    return left - (right or 0)


def derive_metrics(statement_type: str, cells: dict[str, int]) -> dict[str, int | None]:
    if statement_type in {"C", "K"}:
        inventory_gross = sum_cells(cells, ("BL", "BN", "BP", "BR", "BT"))
        inventory_provisions = sum_cells(cells, ("BM", "BO", "BQ", "BS", "BU"))
        cash_gross = sum_cells(cells, ("CD", "CF"))
        cash_provisions = sum_cells(cells, ("CE", "CG"))
        return {
            "balance_sheet_total": cell(cells, "EE"),
            "equity": sum_cells(cells, ("DL", "DO")),
            "provisions": cell(cells, "DR"),
            "financial_debt": sum_cells(cells, ("DS", "DT", "DU", "DV")),
            "total_debt": cell(cells, "EC"),
            "fixed_assets_gross": cell(cells, "BJ"),
            "fixed_assets_net": difference(cell(cells, "BJ"), cell(cells, "BK")),
            "current_assets_gross": cell(cells, "CJ"),
            "current_assets_net": difference(cell(cells, "CJ"), cell(cells, "CK")),
            "inventory_gross": inventory_gross,
            "inventory_net": difference(inventory_gross, inventory_provisions),
            "trade_receivables_gross": cell(cells, "BX"),
            "trade_receivables_net": difference(cell(cells, "BX"), cell(cells, "BY")),
            "cash_and_securities_net": difference(cash_gross, cash_provisions),
            "trade_payables": cell(cells, "DX"),
            "tax_social_debt": cell(cells, "DY"),
            "capital": cell(cells, "DA"),
            "revenue": cell(cells, "FL"),
            "operating_result": cell(cells, "GG"),
            "current_pre_tax_result": cell(cells, "GW"),
            "net_income": cell(cells, "HN") if cell(cells, "HN") is not None else cell(cells, "DI"),
            "personnel_costs": sum_cells(cells, ("FY", "FZ")),
            "external_purchases": cell(cells, "FW"),
            "taxes": cell(cells, "FX"),
        }
    if statement_type == "S":
        inventory_gross = sum_cells(cells, ("050", "060"))
        inventory_provisions = sum_cells(cells, ("052", "062"))
        cash_gross = sum_cells(cells, ("080", "084"))
        cash_provisions = sum_cells(cells, ("082", "086"))
        revenue = sum_cells(cells, ("210", "214", "218"))
        current_result_parts = sum_cells(cells, ("270", "280"))
        return {
            "balance_sheet_total": cell(cells, "180"),
            "equity": cell(cells, "142"),
            "provisions": cell(cells, "154"),
            "financial_debt": cell(cells, "156"),
            "total_debt": cell(cells, "176"),
            "fixed_assets_gross": cell(cells, "044"),
            "fixed_assets_net": difference(cell(cells, "044"), cell(cells, "048")),
            "current_assets_gross": cell(cells, "096"),
            "current_assets_net": difference(cell(cells, "096"), cell(cells, "098")),
            "inventory_gross": inventory_gross,
            "inventory_net": difference(inventory_gross, inventory_provisions),
            "trade_receivables_gross": cell(cells, "068"),
            "trade_receivables_net": difference(cell(cells, "068"), cell(cells, "070")),
            "cash_and_securities_net": difference(cash_gross, cash_provisions),
            "trade_payables": cell(cells, "166"),
            "tax_social_debt": cell(cells, "172"),
            "capital": cell(cells, "120"),
            "revenue": revenue,
            "operating_result": cell(cells, "270"),
            "current_pre_tax_result": None if current_result_parts is None else current_result_parts - (cell(cells, "294") or 0),
            "net_income": cell(cells, "310"),
            "personnel_costs": sum_cells(cells, ("250", "252")),
            "external_purchases": cell(cells, "242"),
            "taxes": cell(cells, "244"),
        }
    raise ValueError("Type de bilan non pris en charge")


def statement_fingerprint(item: dict[str, object]) -> str:
    stable = (item.get("siren"), item.get("closing_date"), item.get("statement_type"))
    return sha256("|".join(str(value or "") for value in stable).encode()).hexdigest()


def parse_subset(path: Path, source_updated_at: str) -> tuple[list[dict[str, object]], dict[str, int]]:
    source_date = normalized_closing_date(source_updated_at)
    if not source_date:
        raise ValueError("Date de source détaillée invalide")
    connection = duckdb.connect()
    rows = connection.execute(
        "SELECT siren, date_cloture_exercice, type_bilan, confidentiality, liasse FROM read_parquet(?)",
        [str(path)],
    ).fetchall()
    connection.close()
    stats = {
        "source_rows": len(rows), "invalid_rows": 0, "duplicate_rows": 0,
        "conflicting_rows": 0, "future_closing_date_rows": 0, "raw_cell_count": 0,
        "saturated_int32_cell_count": 0,
    }
    statements: dict[str, dict[str, object]] = {}
    for raw_siren, raw_date, raw_type, raw_confidentiality, raw_cells in rows:
        siren = normalized_siren(raw_siren)
        closing_date = normalized_closing_date(raw_date.isoformat() if isinstance(raw_date, date) else raw_date)
        statement_type = (compact_text(raw_type, 10) or "").upper()
        if isinstance(raw_cells, dict):
            stats["saturated_int32_cell_count"] += sum(
                isinstance(value, (int, float)) and not isinstance(value, bool)
                and math.isfinite(float(value)) and float(value).is_integer()
                and int(value) in SATURATED_INT32_VALUES
                for value in raw_cells.values()
            )
        cells = normalized_cells(raw_cells)
        if not siren or not closing_date or statement_type not in {"C", "K", "S"} or not cells:
            stats["invalid_rows"] += 1
            continue
        confidentiality = compact_text(raw_confidentiality, 200) or "Non précisé"
        item: dict[str, object] = {
            "siren": siren,
            "closing_date": closing_date,
            "statement_type": statement_type,
            "confidentiality": confidentiality,
            "is_partially_confidential": confidentiality.casefold().startswith("partiellement confidentiel"),
            "date_quality": "future_closing_date" if closing_date > source_date else "published",
            "cell_count": len(cells),
            "liasse_json": json.dumps(cells, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
            **derive_metrics(statement_type, cells),
        }
        item["derived_metric_count"] = sum(item[field] is not None for field in DERIVED_FIELDS)
        item["fingerprint"] = statement_fingerprint(item)
        fingerprint = str(item["fingerprint"])
        existing = statements.get(fingerprint)
        if existing is not None:
            stats["duplicate_rows"] += 1
            if existing["liasse_json"] != item["liasse_json"]:
                stats["conflicting_rows"] += 1
                if int(item["cell_count"]) > int(existing["cell_count"]):
                    statements[fingerprint] = item
            continue
        statements[fingerprint] = item
        stats["raw_cell_count"] += len(cells)
        if item["date_quality"] == "future_closing_date":
            stats["future_closing_date_rows"] += 1
    return list(statements.values()), stats


def build_index(
    output: Path, statements: list[dict[str, object]], metadata: dict[str, object],
    pipeline_stats: dict[str, object],
) -> dict[str, object]:
    partial = output.with_suffix(output.suffix + ".part")
    partial.unlink(missing_ok=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(partial)
    derived_columns = ",\n".join(f"{field} INTEGER" for field in DERIVED_FIELDS)
    connection.executescript(f"""
      CREATE TABLE detailed_financial_statements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fingerprint TEXT NOT NULL UNIQUE,
        siren TEXT NOT NULL,
        closing_date TEXT NOT NULL,
        statement_type TEXT NOT NULL CHECK(statement_type IN ('C','K','S')),
        confidentiality TEXT NOT NULL,
        is_partially_confidential INTEGER NOT NULL,
        date_quality TEXT NOT NULL CHECK(date_quality IN ('published','future_closing_date')),
        cell_count INTEGER NOT NULL,
        derived_metric_count INTEGER NOT NULL,
        liasse_json TEXT NOT NULL,
        {derived_columns},
        source_updated_at TEXT NOT NULL,
        dataset_url TEXT NOT NULL,
        resource_url TEXT NOT NULL,
        license_name TEXT NOT NULL,
        license_url TEXT NOT NULL,
        imported_at TEXT NOT NULL
      );
      CREATE TABLE detailed_financial_metric_definitions (
        field_name TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        complete_codes TEXT NOT NULL,
        simplified_codes TEXT NOT NULL,
        full_form_url TEXT NOT NULL,
        simplified_form_url TEXT NOT NULL
      );
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX detailed_financial_siren_date_idx ON detailed_financial_statements(siren, closing_date DESC, statement_type);
      CREATE INDEX detailed_financial_quality_idx ON detailed_financial_statements(date_quality, confidentiality);
    """)
    imported_at = datetime.now(timezone.utc).isoformat()
    columns = (
        "fingerprint", "siren", "closing_date", "statement_type", "confidentiality",
        "is_partially_confidential", "date_quality", "cell_count", "derived_metric_count",
        "liasse_json", *DERIVED_FIELDS,
    )
    extras = (
        metadata["source_updated_at"], metadata["dataset_url"], metadata["resource_url"],
        metadata["license_name"], metadata["license_url"], imported_at,
    )
    connection.executemany(
        f"INSERT OR IGNORE INTO detailed_financial_statements ({','.join(columns)},source_updated_at,dataset_url,resource_url,license_name,license_url,imported_at) VALUES ({','.join('?' for _ in range(len(columns)+len(extras)))})",
        [tuple(int(value) if isinstance(value, bool) else value for value in (item.get(column) for column in columns)) + extras for item in statements],
    )
    connection.executemany(
        "INSERT INTO detailed_financial_metric_definitions VALUES (?,?,?,?,?,?)",
        [(field, label, complete, simplified, FULL_FORM_URL, SIMPLIFIED_FORM_URL)
         for field, (label, complete, simplified) in METRIC_DEFINITIONS.items()],
    )
    aggregate = connection.execute(
        """SELECT COUNT(*), COUNT(DISTINCT siren), SUM(statement_type='C'),
                  SUM(statement_type='S'), SUM(statement_type='K'),
                  SUM(is_partially_confidential=1), SUM(cell_count),
                  MIN(CASE WHEN date_quality='published' THEN closing_date END),
                  MAX(CASE WHEN date_quality='published' THEN closing_date END)
           FROM detailed_financial_statements"""
    ).fetchone()
    coverage = {
        field: int(connection.execute(f"SELECT COUNT(*) FROM detailed_financial_statements WHERE {field} IS NOT NULL").fetchone()[0])
        for field in DERIVED_FIELDS
    }
    report = {
        "company_count": int(aggregate[1] or 0),
        "statement_count": int(aggregate[0] or 0),
        "complete_statement_count": int(aggregate[2] or 0),
        "simplified_statement_count": int(aggregate[3] or 0),
        "consolidated_statement_count": int(aggregate[4] or 0),
        "partially_confidential_count": int(aggregate[5] or 0),
        "raw_cell_count": int(aggregate[6] or 0),
        "earliest_valid_closing_date": aggregate[7],
        "latest_valid_closing_date": aggregate[8],
        "derived_metric_coverage": coverage,
        "contains_personal_data": False,
        "contains_documents": False,
        "scope": "national_legal_unit",
        "source_updated_at": metadata["source_updated_at"],
        "imported_at": imported_at,
    }
    metadata_rows = {
        "source": "Signaux Faibles detailed BCE/INPI financial statements",
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
    args = parser.parse_args()

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    metadata = source_metadata(session)
    session.close()
    targets = load_company_targets(args.company_db)
    subset_path, extract_stats = extract_target_subset(targets, metadata, args.cache_dir, args.refresh)
    statements, parse_stats = parse_subset(subset_path, str(metadata["source_updated_at"]))
    pipeline_stats = {"extract": extract_stats, "parse": parse_stats}
    report = build_index(args.output, statements, metadata, pipeline_stats)
    report["pipeline"] = pipeline_stats
    report_path = args.output.with_suffix(".report.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
