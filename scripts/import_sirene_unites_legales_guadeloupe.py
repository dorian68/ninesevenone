"""Extract Guadeloupe legal units from the official monthly SIRENE parquet.

Only SIRENs referenced by the filtered Guadeloupe establishment stock are read.
Personal names are intentionally excluded from the selected columns.
"""

from __future__ import annotations

import argparse
import csv
import json
import threading
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ESTABLISHMENTS = ROOT / "data/imports/sirene-guadeloupe-establishments.csv"
DEFAULT_OUTPUT = ROOT / "data/imports/sirene-guadeloupe-unites-legales.parquet"
DEFAULT_SOURCE_FILE = ROOT / "data/imports/stock-unite-legale.parquet"
DEFAULT_URL = "https://www.data.gouv.fr/api/1/datasets/r/350182c9-148a-46e0-8389-76c2ec1374a3"
REFERENCE_DATE = "2026-07-01"


def read_target_sirens(path: Path) -> list[str]:
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        sirens = {
            value
            for row in csv.DictReader(source)
            if len(value := (row.get("siren") or "").strip()) == 9
        }
    return sorted(sirens)


def download_parallel(url: str, target: Path, workers: int = 12, chunk_size: int = 16 * 1024 * 1024) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    head = urllib.request.urlopen(urllib.request.Request(
        url, method="HEAD", headers={"User-Agent": "guadeloupe-entreprises-import/0.1"}
    ), timeout=60)
    total_size = int(head.headers["Content-Length"])
    resolved_url = head.geturl()
    if target.exists() and target.stat().st_size == total_size:
        print(f"Parquet déjà présent: {target}", flush=True)
        return

    parts_dir = target.with_suffix(target.suffix + ".parts")
    parts_dir.mkdir(exist_ok=True)
    ranges = [
        (index, start, min(start + chunk_size, total_size) - 1)
        for index, start in enumerate(range(0, total_size, chunk_size))
    ]
    completed_bytes = sum(
        part.stat().st_size
        for index, start, end in ranges
        if (part := parts_dir / f"{index:04d}.part").exists() and part.stat().st_size == end - start + 1
    )
    progress_lock = threading.Lock()

    def fetch_part(index: int, start: int, end: int) -> int:
        nonlocal completed_bytes
        part = parts_dir / f"{index:04d}.part"
        expected = end - start + 1
        if part.exists() and part.stat().st_size == expected:
            return expected
        part.unlink(missing_ok=True)
        request = urllib.request.Request(
            resolved_url,
            headers={
                "Range": f"bytes={start}-{end}",
                "User-Agent": "guadeloupe-entreprises-import/0.1",
            },
        )
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request, timeout=180) as response, part.open("wb") as output:
                    while chunk := response.read(1024 * 1024):
                        output.write(chunk)
                if part.stat().st_size != expected:
                    raise IOError(f"segment {index}: {part.stat().st_size} octets au lieu de {expected}")
                with progress_lock:
                    completed_bytes += expected
                    print(f"Téléchargé: {completed_bytes / 1024**2:.1f} / {total_size / 1024**2:.1f} Mio", flush=True)
                return expected
            except Exception:
                part.unlink(missing_ok=True)
                if attempt == 2:
                    raise
        return 0

    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        futures = [executor.submit(fetch_part, *item) for item in ranges]
        for future in as_completed(futures):
            future.result()

    partial = target.with_suffix(target.suffix + ".part")
    with partial.open("wb") as output:
        for index, start, end in ranges:
            part = parts_dir / f"{index:04d}.part"
            with part.open("rb") as source:
                while chunk := source.read(8 * 1024 * 1024):
                    output.write(chunk)
    if partial.stat().st_size != total_size:
        raise IOError("Le parquet assemblé a une taille inattendue")
    partial.replace(target)
    for part in parts_dir.iterdir():
        part.unlink()
    parts_dir.rmdir()


def extract(source_path: Path, source_url: str, establishments_path: Path, output_path: Path) -> dict[str, object]:
    sirens = read_target_sirens(establishments_path)
    targets = pa.table({"siren": pa.array(sirens, type=pa.string())})
    connection = duckdb.connect()
    connection.register("target_sirens", targets)
    query = """
        SELECT
          ul.siren,
          ul.statutDiffusionUniteLegale AS diffusion_status,
          CAST(ul.dateCreationUniteLegale AS VARCHAR) AS creation_date,
          ul.sigleUniteLegale AS acronym,
          ul.trancheEffectifsUniteLegale AS workforce_band,
          ul.anneeEffectifsUniteLegale AS workforce_year,
          ul.categorieEntreprise AS company_category,
          ul.anneeCategorieEntreprise AS company_category_year,
          CAST(ul.dateDebut AS VARCHAR) AS period_start_date,
          CAST(ul.dateDernierTraitementUniteLegale AS VARCHAR) AS last_processed_at,
          ul.nombrePeriodesUniteLegale AS period_count,
          ul.etatAdministratifUniteLegale AS administrative_status,
          ul.denominationUniteLegale AS legal_name,
          ul.denominationUsuelle1UniteLegale AS usual_name_1,
          ul.denominationUsuelle2UniteLegale AS usual_name_2,
          ul.denominationUsuelle3UniteLegale AS usual_name_3,
          CAST(ul.categorieJuridiqueUniteLegale AS VARCHAR) AS legal_category,
          ul.activitePrincipaleUniteLegale AS primary_activity,
          ul.nicSiegeUniteLegale AS head_office_nic,
          ul.identifiantAssociationUniteLegale AS association_id,
          ul.economieSocialeSolidaireUniteLegale AS social_economy,
          ul.societeMissionUniteLegale AS mission_company,
          ul.caractereEmployeurUniteLegale AS employer
        FROM read_parquet(?) ul
        SEMI JOIN target_sirens target ON target.siren = ul.siren
    """
    result = connection.execute(query, [str(source_path)]).to_arrow_table()
    connection.close()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    partial_path = output_path.with_suffix(output_path.suffix + ".part")
    partial_path.unlink(missing_ok=True)
    pq.write_table(result, partial_path, compression="zstd")
    partial_path.replace(output_path)

    extracted = result.num_rows
    report = {
        "source": "StockUniteLegale SIRENE INSEE/data.gouv.fr",
        "source_url": source_url,
        "reference_date": REFERENCE_DATE,
        "retrieved_at": date.today().isoformat(),
        "target_sirens": len(sirens),
        "extracted_legal_units": extracted,
        "unmatched_sirens": len(sirens) - extracted,
        "personal_names_selected": False,
        "output": str(output_path),
    }
    output_path.with_suffix(".report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-url", default=DEFAULT_URL)
    parser.add_argument("--source-file", type=Path, default=DEFAULT_SOURCE_FILE)
    parser.add_argument("--workers", type=int, default=12)
    parser.add_argument("--establishments", type=Path, default=DEFAULT_ESTABLISHMENTS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    download_parallel(args.source_url, args.source_file, workers=args.workers)
    print(json.dumps(
        extract(args.source_file, args.source_url, args.establishments, args.output),
        ensure_ascii=False,
        indent=2,
    ))


if __name__ == "__main__":
    main()
