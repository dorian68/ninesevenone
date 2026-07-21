import sqlite3

from scripts.import_fonds_vert_projects import (
    build_index,
    normalized_business_identifier,
    parse_resource,
    project_fingerprint,
    source_text,
)


def company_database(path):
    connection = sqlite3.connect(path)
    connection.execute("CREATE TABLE companies (siren TEXT, association_id TEXT)")
    connection.execute("CREATE TABLE establishments (siret TEXT)")
    connection.executemany("INSERT INTO companies VALUES (?, ?)", [
        ("123456789", None),
        ("987654321", None),
    ])
    connection.execute("INSERT INTO establishments VALUES ('12345678900010')")
    connection.commit()
    connection.close()


def resource(year, path):
    return {
        "id": f"resource-{year}",
        "title": f"fonds-vert-{year}-export.csv",
        "url": f"https://example.test/{path.name}",
        "last_modified": "2026-06-22T08:56:24Z",
    }


def test_identifier_normalization_accepts_siren_siret_and_spreadsheet_values():
    assert normalized_business_identifier("123456789") == ("123456789", None)
    assert normalized_business_identifier("123456789.0") == ("123456789", None)
    assert normalized_business_identifier("12345678900010") == ("123456789", "12345678900010")
    assert normalized_business_identifier("#") == (None, None)
    assert source_text("NULL") is None


def test_fonds_vert_parser_uses_only_exact_identifiers_and_scopes_projects(tmp_path):
    company_db = tmp_path / "companies.sqlite"
    company_database(company_db)
    source = tmp_path / "fonds-vert-2025.csv"
    source.write_text(
        "nom_du_projet,resume_du_projet,montant_engage,numero_dossier_ds,numero_ej,numero_operateur,operateur,demarche,nom_region,nom_departement,code_departement,siret_beneficiaire,raison_sociale_beneficiaire,forme_juridique_beneficiaire,code_commune,nom_commune\n"
        "Rénovation solaire,Travaux confirmés,25000,D-1,EJ-1,,État,Rénovation,Guadeloupe,Guadeloupe,971,12345678900010,ENTREPRISE ACTIVE,SAS,97105,Baie-Mahault\n"
        "Projet national,,12000,D-2,EJ-2,,État,Adaptation,Île-de-France,Paris,75,98765432199999,ENTREPRISE MULTISITE,SAS,75056,Paris\n"
        "Nom identique sans preuve,,5000,D-3,EJ-3,,État,Adaptation,Guadeloupe,Guadeloupe,971,,ENTREPRISE ACTIVE,SAS,97105,Baie-Mahault\n",
        encoding="utf-8",
    )
    projects, stats = parse_resource(source, resource(2025, source), company_db)
    assert stats["rows_read"] == 3
    assert stats["rows_matched"] == 2
    assert stats["active_local_siret_matches"] == 1
    assert stats["company_establishment_matches"] == 1
    assert projects[0]["project_location_scope"] == "guadeloupe"
    assert projects[0]["match_scope"] == "active_local_establishment"
    assert projects[1]["project_location_scope"] == "outside_guadeloupe"
    assert projects[1]["match_scope"] == "company_other_establishment"


def test_2023_siren_match_and_atomic_deduplicated_index(tmp_path):
    company_db = tmp_path / "companies.sqlite"
    company_database(company_db)
    source = tmp_path / "fonds-vert-2023.csv"
    source.write_text(
        "nom_region,code_departement,nom_departement,code_commune,nom_commune,axe,numero_demarche_ds,nom_demarche_ds,numero_dossier_ds,nom_du_projet,nom_beneficiaire_principal,siren,montant_engage\n"
        "Guadeloupe,971,Guadeloupe,97105,BAIE-MAHAULT,Axe 2,100,Prévention,D-2023,Projet résilience,ENTREPRISE ACTIVE,123456789.0,48000\n",
        encoding="utf-8",
    )
    projects, stats = parse_resource(source, resource(2023, source), company_db)
    assert stats["exact_siren_matches"] == 1
    assert projects[0]["match_scope"] == "exact_legal_unit"
    assert projects[0]["committed_amount"] == 48000
    assert projects[0]["fingerprint"] == project_fingerprint(dict(projects[0]))

    output = tmp_path / "fonds-vert.sqlite"
    metadata = {
        "title": "Fonds Vert - Liste des projets subventionnés",
        "source_updated_at": "2026-06-22T08:56:24Z",
        "license_name": "Licence Ouverte 2.0",
        "license_url": "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
        "excluded_csv_resources": [{"title": "fonds-vert-p113-2024-export.csv"}],
    }
    report = build_index(projects + projects, output, metadata, [stats], 1)
    connection = sqlite3.connect(output)
    count = connection.execute("SELECT COUNT(*) FROM fonds_vert_projects").fetchone()[0]
    columns = {row[1] for row in connection.execute("PRAGMA table_info(fonds_vert_projects)")}
    connection.close()
    assert count == 1
    assert report["guadeloupe_project_count"] == 1
    assert report["guadeloupe_committed_amount"] == 48000
    assert not {"email", "telephone", "director"} & columns
