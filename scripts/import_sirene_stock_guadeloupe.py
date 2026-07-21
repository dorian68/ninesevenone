"""Filter the official full Sirene StockEtablissement CSV for Guadeloupe.

This is the exhaustive path. It expects the official StockEtablissement ZIP from
data.gouv.fr/Insee, around 2.85 GB as of 2026-07-01. It does not geocode: rows
without WGS84 coordinates must then pass through the geocoding queue.
"""

from __future__ import annotations

import argparse
import csv
import json
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

try:
    from pyproj import Transformer
except ImportError as exc:  # pragma: no cover - explicit operator error
    raise SystemExit("pyproj est requis: installez le backend avec `pip install -e backend`.") from exc


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_URL = "https://www.data.gouv.fr/api/1/datasets/r/0651fb76-bcf3-4f6a-a38d-bc04fa708576"
IMPORT_DIR = ROOT / "data/imports"

KEEP_COLUMNS = [
    "siren",
    "nic",
    "siret",
    "dateCreationEtablissement",
    "trancheEffectifsEtablissement",
    "anneeEffectifsEtablissement",
    "etablissementSiege",
    "complementAdresseEtablissement",
    "numeroVoieEtablissement",
    "typeVoieEtablissement",
    "libelleVoieEtablissement",
    "codePostalEtablissement",
    "libelleCommuneEtablissement",
    "codeCommuneEtablissement",
    "identifiantAdresseEtablissement",
    "coordonneeLambertAbscisseEtablissement",
    "coordonneeLambertOrdonneeEtablissement",
    "etatAdministratifEtablissement",
    "statutDiffusionEtablissement",
    "enseigne1Etablissement",
    "enseigne2Etablissement",
    "enseigne3Etablissement",
    "denominationUsuelleEtablissement",
    "activitePrincipaleEtablissement",
    "nomenclatureActivitePrincipaleEtablissement",
    "caractereEmployeurEtablissement",
    "dateDernierTraitementEtablissement",
    "nombrePeriodesEtablissement",
    "latitude",
    "longitude",
    "geocodingPrecision",
    "geocodingSource",
]
GUADELOUPE_COMMUNE_CODES = {
    *(f"971{code:02d}" for code in range(1, 23)),
    *(f"971{code:02d}" for code in range(24, 27)),
    *(f"971{code:02d}" for code in range(28, 35)),
}


def download(url: str, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.stat().st_size > 0:
        print(f"Archive déjà présente: {target}")
        return
    partial = target.with_suffix(target.suffix + ".part")
    downloaded = partial.stat().st_size if partial.exists() else 0
    headers = {"User-Agent": "guadeloupe-entreprises-import/0.1"}
    if downloaded:
        headers["Range"] = f"bytes={downloaded}-"
    request = urllib.request.Request(url, headers=headers)
    print(f"Téléchargement {url} (reprise à {downloaded:,} octets)")
    with urllib.request.urlopen(request, timeout=120) as response:
        if downloaded and response.status != 206:
            downloaded = 0
            partial.unlink(missing_ok=True)
        remaining = int(response.headers.get("Content-Length", "0"))
        total = downloaded + remaining
        next_report = downloaded + 128 * 1024 * 1024
        with partial.open("ab" if downloaded else "wb") as output:
            while chunk := response.read(8 * 1024 * 1024):
                output.write(chunk)
                downloaded += len(chunk)
                if downloaded >= next_report or downloaded == total:
                    percent = (downloaded / total * 100) if total else 0
                    print(f"Téléchargé: {downloaded / 1024**3:.2f} Gio / {total / 1024**3:.2f} Gio ({percent:.1f} %)", flush=True)
                    next_report = downloaded + 128 * 1024 * 1024
    partial.replace(target)


def filter_zip(zip_path: Path, out_csv: Path, active_only: bool) -> dict[str, int | str]:
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    partial_out = out_csv.with_suffix(out_csv.suffix + ".part")
    rows_read = 0
    rows_kept = 0
    rows_geocoded = 0
    transformer = Transformer.from_crs("EPSG:32620", "EPSG:4326", always_xy=True)
    with zipfile.ZipFile(zip_path) as archive:
        csv_name = next(name for name in archive.namelist() if name.lower().endswith(".csv"))
        with archive.open(csv_name) as raw, partial_out.open("w", encoding="utf-8", newline="") as output:
            reader = csv.DictReader((line.decode("utf-8") for line in raw))
            writer = csv.DictWriter(output, fieldnames=KEEP_COLUMNS, extrasaction="ignore")
            writer.writeheader()
            for row in reader:
                rows_read += 1
                code_commune = row.get("codeCommuneEtablissement") or ""
                commune_label = (row.get("libelleCommuneEtablissement") or "").upper().replace("-", " ")
                if code_commune not in GUADELOUPE_COMMUNE_CODES or "SAINT MARTIN" in commune_label or "SAINT BART" in commune_label:
                    continue
                if active_only and row.get("etatAdministratifEtablissement") != "A":
                    continue
                output_row = {column: row.get(column, "") for column in KEEP_COLUMNS}
                x = row.get("coordonneeLambertAbscisseEtablissement") or ""
                y = row.get("coordonneeLambertOrdonneeEtablissement") or ""
                if x and y:
                    try:
                        longitude, latitude = transformer.transform(float(x), float(y))
                        if -62.2 <= longitude <= -60.6 and 15.5 <= latitude <= 16.8:
                            output_row.update({
                                "latitude": f"{latitude:.7f}",
                                "longitude": f"{longitude:.7f}",
                                "geocodingPrecision": "official_coordinate",
                                "geocodingSource": "INSEE Sirene UTM20N",
                            })
                            rows_geocoded += 1
                    except ValueError:
                        pass
                writer.writerow(output_row)
                rows_kept += 1
                if rows_kept % 10000 == 0:
                    print(f"{rows_kept} établissements 971 conservés")
    partial_out.replace(out_csv)
    return {
        "source": "StockEtablissement Sirene data.gouv.fr/Insee",
        "referenceDate": "2026-07-01",
        "retrievedAt": date.today().isoformat(),
        "rowsRead": rows_read,
        "rowsKept": rows_kept,
        "rowsGeocoded": rows_geocoded,
        "output": str(out_csv),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--zip", type=Path, default=IMPORT_DIR / "stock-stocketablissement-csv.zip")
    parser.add_argument("--out", type=Path, default=IMPORT_DIR / "sirene-guadeloupe-establishments.csv")
    parser.add_argument("--include-closed", action="store_true")
    parser.add_argument("--skip-download", action="store_true")
    args = parser.parse_args()

    if not args.skip_download:
        download(args.url, args.zip)
    report = filter_zip(args.zip, args.out, active_only=not args.include_closed)
    report_path = args.out.with_suffix(".report.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
