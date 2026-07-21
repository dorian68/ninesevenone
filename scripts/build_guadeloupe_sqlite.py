"""Build the local indexed Guadeloupe establishment store.

The latest filtered INSEE establishment stock is authoritative when available.
The ODS SIRENE/BAN export supplies missing public names and coordinates.
Personal names from sole proprietorships are deliberately not persisted.
"""

from __future__ import annotations

import argparse
import csv
import json
import sqlite3
import urllib.parse
import urllib.request
from collections import Counter
from datetime import date
from pathlib import Path

import pyarrow.parquet as pq


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "data/imports/opendatasoft-guadeloupe-active.csv"
DEFAULT_OFFICIAL_INPUT = ROOT / "data/imports/sirene-guadeloupe-establishments.csv"
DEFAULT_LEGAL_UNITS = ROOT / "data/imports/sirene-guadeloupe-unites-legales.parquet"
DEFAULT_OUTPUT = ROOT / "data/guadeloupe-enterprises.sqlite"
EXPORT_FIELDS = [
    "siren", "siret", "denominationunitelegale", "nomunitelegale",
    "prenomusuelunitelegale", "enseigne1etablissement",
    "activiteprincipaleetablissement", "libellecommuneetablissement",
    "codecommuneetablissement", "codepostaletablissement",
    "adresseetablissement", "geolocetablissement",
]
GUADELOUPE_COMMUNES = {
    "97101": "LES ABYMES", "97102": "ANSE-BERTRAND", "97103": "BAIE-MAHAULT",
    "97104": "BAILLIF", "97105": "BASSE-TERRE", "97106": "BOUILLANTE",
    "97107": "CAPESTERRE-BELLE-EAU", "97108": "CAPESTERRE-DE-MARIE-GALANTE",
    "97109": "GOURBEYRE", "97110": "LA DÉSIRADE", "97111": "DESHAIES",
    "97112": "GRAND-BOURG", "97113": "LE GOSIER", "97114": "GOYAVE",
    "97115": "LAMENTIN", "97116": "MORNE-À-L'EAU", "97117": "LE MOULE",
    "97118": "PETIT-BOURG", "97119": "PETIT-CANAL", "97120": "POINTE-À-PITRE",
    "97121": "POINTE-NOIRE", "97122": "PORT-LOUIS", "97124": "SAINT-CLAUDE",
    "97125": "SAINT-FRANÇOIS", "97126": "SAINT-LOUIS", "97128": "SAINTE-ANNE",
    "97129": "SAINTE-ROSE", "97130": "TERRE-DE-BAS", "97131": "TERRE-DE-HAUT",
    "97132": "TROIS-RIVIÈRES", "97133": "VIEUX-FORT", "97134": "VIEUX-HABITANTS",
}


def export_url() -> str:
    query = urllib.parse.urlencode({
        "select": ",".join(EXPORT_FIELDS),
        "where": 'codedepartementetablissement="971" AND etatadministratifetablissement="Actif"',
        "use_labels": "false",
        "delimiter": ";",
    })
    return "https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/economicref-france-sirene-v3/exports/csv?" + query


def download_source(target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(target.suffix + ".part")
    request = urllib.request.Request(export_url(), headers={"User-Agent": "guadeloupe-entreprises-import/0.1"})
    print("Téléchargement de l'extrait actif département 971", flush=True)
    with urllib.request.urlopen(request, timeout=180) as response, partial.open("wb") as output:
        downloaded = 0
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
            downloaded += len(chunk)
            print(f"{downloaded / 1024**2:.1f} Mio reçus", flush=True)
    partial.replace(target)


def sector_from_naf(code: str) -> str:
    try:
        division = int(code[:2])
    except (TypeError, ValueError):
        return "Autres activités"
    if division <= 3:
        return "Agriculture et pêche"
    if division <= 39:
        return "Industrie et énergie"
    if division <= 43:
        return "Construction"
    if division <= 47:
        return "Commerce"
    if division <= 53:
        return "Transport et logistique"
    if division <= 56:
        return "Hébergement et restauration"
    if division <= 63:
        return "Information et communication"
    if division <= 66:
        return "Finance et assurance"
    if division == 68:
        return "Immobilier"
    if division <= 75:
        return "Services professionnels"
    if division <= 82:
        return "Services administratifs et support"
    if division == 84:
        return "Administration publique"
    if division == 85:
        return "Enseignement"
    if division <= 88:
        return "Santé et action sociale"
    if division <= 93:
        return "Culture, loisirs et sport"
    return "Services de proximité"


def parse_coordinates(raw: str) -> tuple[float | None, float | None]:
    if not raw:
        return None, None
    try:
        latitude_raw, longitude_raw = raw.split(",", 1)
        latitude = float(latitude_raw.strip())
        longitude = float(longitude_raw.strip())
    except (TypeError, ValueError):
        return None, None
    if not (-62.2 <= longitude <= -60.6 and 15.5 <= latitude <= 16.8):
        return None, None
    return latitude, longitude


def display_name(row: dict[str, str]) -> tuple[str, str | None]:
    legal_name = (row.get("denominationunitelegale") or "").strip()
    trade_name = (row.get("enseigne1etablissement") or "").strip() or None
    # Do not republish a sole proprietor's surname or given name as a map label.
    return legal_name or trade_name or "Entreprise individuelle", trade_name


def load_ods_enrichment(input_path: Path) -> dict[str, tuple[str, str | None, float | None, float | None]]:
    enrichment: dict[str, tuple[str, str | None, float | None, float | None]] = {}
    if not input_path.exists():
        return enrichment
    with input_path.open("r", encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source, delimiter=";"):
            siret = (row.get("siret") or "").strip()
            if len(siret) != 14:
                continue
            legal_name, trade_name = display_name(row)
            latitude, longitude = parse_coordinates(row.get("geolocetablissement") or "")
            enrichment[siret] = (legal_name, trade_name, latitude, longitude)
    return enrichment


def official_address(row: dict[str, str]) -> str | None:
    parts = [
        row.get("complementAdresseEtablissement"),
        row.get("numeroVoieEtablissement"),
        row.get("typeVoieEtablissement"),
        row.get("libelleVoieEtablissement"),
    ]
    value = " ".join(part.strip() for part in parts if part and part.strip())
    return value or None


def load_legal_units(path: Path) -> dict[str, dict[str, object]]:
    if not path.exists():
        return {}
    return {
        str(row["siren"]): row
        for row in pq.read_table(path).to_pylist()
        if row.get("siren")
    }


def legal_unit_name(row: dict[str, object]) -> str:
    value = str(row.get("legal_name") or "").strip()
    return value or "Entreprise individuelle"


def legal_unit_usual_name(row: dict[str, object]) -> str | None:
    return next((
        value
        for key in ("usual_name_1", "usual_name_2", "usual_name_3")
        if (value := str(row.get(key) or "").strip())
    ), None)


def initialise(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        PRAGMA temp_store=MEMORY;
        CREATE TABLE companies (
          siren TEXT PRIMARY KEY,
          legal_name TEXT NOT NULL,
          usual_name TEXT,
          acronym TEXT,
          legal_category TEXT,
          creation_date TEXT,
          administrative_status TEXT,
          diffusion_status TEXT,
          company_category TEXT,
          company_category_year INTEGER,
          workforce_band TEXT,
          workforce_year INTEGER,
          primary_activity TEXT,
          head_office_nic TEXT,
          association_id TEXT,
          social_economy TEXT,
          mission_company TEXT,
          employer TEXT,
          period_start_date TEXT,
          last_processed_at TEXT,
          period_count INTEGER,
          source TEXT NOT NULL,
          source_reference_date TEXT NOT NULL
        );
        CREATE TABLE establishments (
          id INTEGER PRIMARY KEY,
          siren TEXT NOT NULL,
          siret TEXT NOT NULL UNIQUE,
          legal_name TEXT NOT NULL,
          trade_name TEXT,
          naf_code TEXT,
          sector TEXT NOT NULL,
          commune TEXT NOT NULL,
          commune_code TEXT NOT NULL,
          postal_code TEXT,
          address TEXT,
          address_id TEXT,
          latitude REAL,
          longitude REAL,
          creation_date TEXT,
          workforce_band TEXT,
          workforce_year INTEGER,
          is_head_office INTEGER NOT NULL DEFAULT 0,
          employer TEXT,
          administrative_status TEXT,
          diffusion_status TEXT,
          last_processed_at TEXT,
          period_count INTEGER,
          geocoding_precision TEXT,
          geocoding_source TEXT,
          description TEXT NOT NULL,
          source TEXT NOT NULL,
          source_reference_date TEXT NOT NULL
        );
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE VIRTUAL TABLE establishment_search USING fts5(
          legal_name, trade_name, siren, siret, naf_code, sector, commune, address,
          content='establishments', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
        );
        CREATE VIRTUAL TABLE establishment_spatial USING rtree(
          id, min_longitude, max_longitude, min_latitude, max_latitude
        );
        """
    )


def build(
    input_path: Path,
    output_path: Path,
    enrichment_path: Path = DEFAULT_INPUT,
    legal_units_path: Path = DEFAULT_LEGAL_UNITS,
) -> dict[str, object]:
    partial_path = output_path.with_suffix(output_path.suffix + ".part")
    partial_path.unlink(missing_ok=True)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(partial_path)
    initialise(connection)
    counts: Counter[str] = Counter()
    sirens: set[str] = set()
    communes: set[str] = set()
    sectors: set[str] = set()
    official = input_path.name == DEFAULT_OFFICIAL_INPUT.name
    enrichment = load_ods_enrichment(enrichment_path) if official else {}
    legal_units = load_legal_units(legal_units_path) if official else {}
    source_name = "Stocks SIRENE Etablissement et UniteLegale INSEE, enrichis par ODS SIRENE/BAN"
    reference_date = "2026-07-01"
    delimiter = "," if official else ";"

    if legal_units:
        connection.executemany(
            """
            INSERT INTO companies (
              siren, legal_name, usual_name, acronym, legal_category, creation_date,
              administrative_status, diffusion_status, company_category, company_category_year,
              workforce_band, workforce_year, primary_activity, head_office_nic,
              association_id, social_economy, mission_company, employer, period_start_date,
              last_processed_at, period_count, source, source_reference_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    siren, legal_unit_name(row), legal_unit_usual_name(row), row.get("acronym"), row.get("legal_category"),
                    row.get("creation_date"), row.get("administrative_status"), row.get("diffusion_status"),
                    row.get("company_category"), row.get("company_category_year"), row.get("workforce_band"),
                    row.get("workforce_year"), row.get("primary_activity"), row.get("head_office_nic"),
                    row.get("association_id"), row.get("social_economy"), row.get("mission_company"),
                    row.get("employer"), row.get("period_start_date"), row.get("last_processed_at"),
                    row.get("period_count"),
                    "StockUniteLegale SIRENE INSEE/data.gouv.fr", reference_date,
                )
                for siren, row in legal_units.items()
            ],
        )
        counts["legal_units"] = len(legal_units)

    with input_path.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source, delimiter=delimiter)
        for row in reader:
            commune_code = (row.get("codeCommuneEtablissement") or row.get("codecommuneetablissement") or "").strip()
            raw_commune = (row.get("libelleCommuneEtablissement") or row.get("libellecommuneetablissement") or "").upper().replace("-", " ")
            if commune_code not in GUADELOUPE_COMMUNES or "SAINT MARTIN" in raw_commune or "SAINT BART" in raw_commune:
                counts["excluded_outside_scope"] += 1
                continue
            siren = (row.get("siren") or "").strip()
            siret = (row.get("siret") or "").strip()
            if len(siren) != 9 or len(siret) != 14:
                counts["excluded_invalid_identifier"] += 1
                continue
            if official:
                legal_unit = legal_units.get(siren)
                privacy_restricted = bool(
                    (legal_unit and legal_unit.get("diffusion_status") == "P")
                    or row.get("statutDiffusionEtablissement") == "P"
                )
                enriched = None if privacy_restricted else enrichment.get(siret)
                official_trade_name = next((row.get(key, "").strip() for key in (
                    "enseigne1Etablissement", "enseigne2Etablissement", "enseigne3Etablissement",
                    "denominationUsuelleEtablissement"
                ) if row.get(key, "").strip()), None)
                legal_name = legal_unit_name(legal_unit) if legal_unit else (enriched[0] if enriched else official_trade_name or "Établissement SIRENE")
                trade_name = official_trade_name or (enriched[1] if enriched else None)
                if privacy_restricted:
                    counts["privacy_restricted_establishments"] += 1
            else:
                legal_name, trade_name = display_name(row)
            naf_code = (row.get("activitePrincipaleEtablissement") or row.get("activiteprincipaleetablissement") or "").strip()
            sector = sector_from_naf(naf_code)
            commune = GUADELOUPE_COMMUNES[commune_code]
            postal_code = (row.get("codePostalEtablissement") or row.get("codepostaletablissement") or "").strip() or None
            address = official_address(row) if official else (row.get("adresseetablissement") or "").strip() or None
            if official:
                latitude, longitude = parse_coordinates(f"{row.get('latitude', '')},{row.get('longitude', '')}")
                geocoding_precision = (row.get("geocodingPrecision") or "").strip() or None
                geocoding_source = (row.get("geocodingSource") or "").strip() or None
                if latitude is None and enriched:
                    latitude, longitude = enriched[2], enriched[3]
                    if latitude is not None:
                        counts["coordinates_enriched"] += 1
                        geocoding_precision = "address_coordinate"
                        geocoding_source = "ODS SIRENE/BAN 2026-04"
            else:
                latitude, longitude = parse_coordinates(row.get("geolocetablissement") or "")
                geocoding_precision = "published_coordinate" if latitude is not None else None
                geocoding_source = "OpenDataSoft SIRENE V3 consolidée"
            is_head_office = (row.get("etablissementSiege") or "").strip().lower() in {"true", "1", "o", "oui"}
            employer = (row.get("caractereEmployeurEtablissement") or "").strip() or None
            workforce_band = (row.get("trancheEffectifsEtablissement") or "").strip() or None
            workforce_year_value = (row.get("anneeEffectifsEtablissement") or "").strip()
            workforce_year = int(workforce_year_value) if workforce_year_value.isdigit() else None
            period_count_value = (row.get("nombrePeriodesEtablissement") or "").strip()
            period_count = int(period_count_value) if period_count_value.isdigit() else None
            description = f"Établissement enregistré dans le secteur « {sector} » (code NAF {naf_code or 'non renseigné'})."
            cursor = connection.execute(
                """
                INSERT INTO establishments (
                  siren, siret, legal_name, trade_name, naf_code, sector, commune,
                  commune_code, postal_code, address, address_id, latitude, longitude,
                  creation_date, workforce_band, workforce_year, is_head_office, employer,
                  administrative_status, diffusion_status, last_processed_at, period_count,
                  geocoding_precision, geocoding_source,
                  description, source, source_reference_date
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    siren, siret, legal_name, trade_name, naf_code, sector, commune,
                    commune_code, postal_code, address,
                    (row.get("identifiantAdresseEtablissement") or "").strip() or None,
                    latitude, longitude, (row.get("dateCreationEtablissement") or "").strip() or None,
                    workforce_band, workforce_year, int(is_head_office), employer,
                    (row.get("etatAdministratifEtablissement") or "").strip() or None,
                    (row.get("statutDiffusionEtablissement") or "").strip() or None,
                    (row.get("dateDernierTraitementEtablissement") or "").strip() or None,
                    period_count, geocoding_precision, geocoding_source,
                    description, source_name if official else "OpenDataSoft SIRENE V3 consolidée - France",
                    reference_date if official else "2026-04",
                ),
            )
            row_id = cursor.lastrowid
            connection.execute(
                "INSERT INTO establishment_search(rowid, legal_name, trade_name, siren, siret, naf_code, sector, commune, address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (row_id, legal_name, trade_name, siren, siret, naf_code, sector, commune, address),
            )
            if latitude is not None and longitude is not None:
                connection.execute(
                    "INSERT INTO establishment_spatial VALUES (?, ?, ?, ?, ?)",
                    (row_id, longitude, longitude, latitude, latitude),
                )
                counts["geolocated"] += 1
            counts["establishments"] += 1
            if is_head_office:
                counts["head_offices"] += 1
            if employer == "O":
                counts["employer_establishments"] += 1
            if workforce_band and workforce_band != "NN":
                counts["known_workforce_establishments"] += 1
            sirens.add(siren)
            communes.add(commune_code)
            sectors.add(sector)
            if counts["establishments"] % 10_000 == 0:
                connection.commit()
                print(f"{counts['establishments']:,} établissements indexés", flush=True)

    metadata = {
        "source": source_name if official else "OpenDataSoft SIRENE V3 consolidée - France",
        "source_url": "https://www.data.gouv.fr/datasets/base-sirene-des-entreprises-et-de-leurs-etablissements-siren-siret" if official else "https://public.opendatasoft.com/explore/dataset/economicref-france-sirene-v3/",
        "source_reference_date": reference_date if official else "2026-04",
        "retrieved_at": date.today().isoformat(),
        "establishment_count": str(counts["establishments"]),
        "company_count": str(len(sirens)),
        "legal_unit_count": str(counts["legal_units"]),
        "geolocated_count": str(counts["geolocated"]),
        "commune_count": str(len(communes)),
        "sector_count": str(len(sectors)),
        "coverage_notice": "Unités légales et établissements actifs des stocks INSEE 2026-07 dans les 32 communes 971; seules les coordonnées manquantes non restreintes sont enrichies depuis ODS SIRENE/BAN 2026-04.",
    }
    connection.executemany("INSERT INTO metadata(key, value) VALUES (?, ?)", metadata.items())
    connection.execute("CREATE INDEX establishment_commune_idx ON establishments(commune_code)")
    connection.execute("CREATE INDEX establishment_sector_idx ON establishments(sector)")
    connection.execute("CREATE INDEX establishment_siren_idx ON establishments(siren)")
    connection.commit()
    connection.execute("ANALYZE")
    connection.close()
    partial_path.replace(output_path)

    report: dict[str, object] = {**metadata, **counts, "database": str(output_path)}
    output_path.with_suffix(".report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--official-input", type=Path, default=DEFAULT_OFFICIAL_INPUT)
    parser.add_argument("--legal-units", type=Path, default=DEFAULT_LEGAL_UNITS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--refresh", action="store_true", help="Retélécharger l'export OpenDataSoft avant reconstruction")
    args = parser.parse_args()
    if args.refresh or not args.input.exists():
        download_source(args.input)
    primary_input = args.official_input if args.official_input.exists() else args.input
    print(json.dumps(build(primary_input, args.output, args.input, args.legal_units), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
