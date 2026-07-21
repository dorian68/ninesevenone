import csv
import sqlite3

import pyarrow as pa
import pyarrow.parquet as pq

from scripts.build_guadeloupe_sqlite import build


def test_build_preserves_official_company_and_establishment_signals(tmp_path):
    establishments = tmp_path / "sirene-guadeloupe-establishments.csv"
    row = {
        "siren": "123456789",
        "siret": "12345678900011",
        "codeCommuneEtablissement": "97103",
        "libelleCommuneEtablissement": "BAIE-MAHAULT",
        "codePostalEtablissement": "97122",
        "numeroVoieEtablissement": "10",
        "typeVoieEtablissement": "RUE",
        "libelleVoieEtablissement": "DE LA DONNEE",
        "identifiantAdresseEtablissement": "97103_TEST_00010",
        "activitePrincipaleEtablissement": "62.01Z",
        "dateCreationEtablissement": "2022-05-10",
        "trancheEffectifsEtablissement": "11",
        "anneeEffectifsEtablissement": "2023",
        "etablissementSiege": "true",
        "caractereEmployeurEtablissement": "O",
        "etatAdministratifEtablissement": "A",
        "statutDiffusionEtablissement": "O",
        "dateDernierTraitementEtablissement": "2026-06-10T09:30:00",
        "nombrePeriodesEtablissement": "3",
        "latitude": "16.2400000",
        "longitude": "-61.5600000",
        "geocodingPrecision": "official_coordinate",
        "geocodingSource": "INSEE Sirene UTM20N",
    }
    with establishments.open("w", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=list(row))
        writer.writeheader()
        writer.writerow(row)

    legal_units = tmp_path / "legal-units.parquet"
    pq.write_table(pa.Table.from_pylist([{
        "siren": "123456789",
        "legal_name": "ENTREPRISE DE TEST",
        "usual_name_1": "SIGNAL TEST",
        "acronym": "ST",
        "legal_category": "5710",
        "creation_date": "2022-05-10",
        "administrative_status": "A",
        "diffusion_status": "O",
        "company_category": "PME",
        "company_category_year": 2023,
        "workforce_band": "11",
        "workforce_year": 2023,
        "primary_activity": "62.01Z",
        "head_office_nic": "00011",
        "association_id": "W9R1000001",
        "social_economy": "O",
        "mission_company": "O",
        "employer": None,
        "period_start_date": "2024-01-01",
        "last_processed_at": "2026-06-11 10:30:00",
        "period_count": 4,
    }]), legal_units)

    database = tmp_path / "result.sqlite"
    report = build(
        establishments,
        database,
        enrichment_path=tmp_path / "missing.csv",
        legal_units_path=legal_units,
    )

    connection = sqlite3.connect(database)
    connection.row_factory = sqlite3.Row
    company = dict(connection.execute("SELECT * FROM companies").fetchone())
    establishment = dict(connection.execute("SELECT * FROM establishments").fetchone())
    connection.close()

    assert company["usual_name"] == "SIGNAL TEST"
    assert company["social_economy"] == "O"
    assert company["mission_company"] == "O"
    assert company["association_id"] == "W9R1000001"
    assert company["company_category_year"] == 2023
    assert company["period_count"] == 4
    assert establishment["is_head_office"] == 1
    assert establishment["employer"] == "O"
    assert establishment["workforce_year"] == 2023
    assert establishment["period_count"] == 3
    assert establishment["geocoding_precision"] == "official_coordinate"
    assert report["head_offices"] == 1
    assert report["employer_establishments"] == 1
