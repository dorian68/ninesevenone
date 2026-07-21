import sqlite3

from scripts.import_france_relance_industrial_projects import (
    build_index,
    normalized_business_identifier,
    parse_coordinates,
    parse_resource,
    project_location_scope,
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


def resource():
    return {
        "id": "74e3474f-c954-43c8-814d-d1efa49f08fd",
        "title": "plan-de-relance.csv",
        "url": "https://example.test/plan-de-relance.csv",
        "last_modified": "2022-04-08T17:07:56Z",
    }


def metadata():
    return {
        "title": "Plan de relance - Projets industriels",
        "source_updated_at": "2022-04-08T17:07:56Z",
        "license_name": "Licence Ouverte 2.0",
        "license_url": "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
    }


def test_identifier_location_and_coordinate_normalization():
    assert normalized_business_identifier("123456789") == ("123456789", None)
    assert normalized_business_identifier("12345678900010") == ("123456789", "12345678900010")
    assert normalized_business_identifier("inconnu") == (None, None)
    assert project_location_scope("971", "97122") == "guadeloupe"
    assert project_location_scope("75", "75001") == "outside_guadeloupe"
    assert parse_coordinates("16.241, -61.535") == (16.241, -61.535)
    assert parse_coordinates("hors format") == (None, None)


def test_parser_joins_only_exact_identifiers_and_keeps_project_semantics(tmp_path):
    company_db = tmp_path / "companies.sqlite"
    company_database(company_db)
    source = tmp_path / "relance.csv"
    source.write_text(
        "entreprise;type_entreprise;siren;volet_relance;mesure;nom_departement;nom_commune;code_postal;coordonnees_gps;description_projet;mesure_light;mise_a_jour;filiere;tonnes_equivalent_co2_pour_les_projets_decarbonation;code_departement;nom_region\n"
        "ENTREPRISE LOCALE;PME;12345678900010;Verdissement;Décarbonation;GUADELOUPE;BAIE-MAHAULT;97122;16.2, -61.5;\"Projet &amp; production\";Décarbonation;2022-03-21;Chimie;42.5;971.0;GUADELOUPE\n"
        "ENTREPRISE NATIONALE;ETI;987654321;Compétitivité;Relocalisation;PARIS;PARIS;75001;48.8, 2.3;;Relocalisation;2021-03-02;Industrie;;75.0;ILE-DE-FRANCE\n"
        "NOM IDENTIQUE;PME;;Compétitivité;Relocalisation;GUADELOUPE;ABYMES;97139;;;Relocalisation;2021-03-02;Industrie;;971.0;GUADELOUPE\n",
        encoding="utf-8",
    )
    projects, stats = parse_resource(source, resource(), company_db)
    assert stats["rows_read"] == 3
    assert stats["rows_matched"] == 2
    assert stats["invalid_identifier_rows"] == 1
    assert projects[0]["match_scope"] == "active_local_establishment"
    assert projects[0]["project_location_scope"] == "guadeloupe"
    assert projects[0]["project_description"] == "Projet & production"
    assert projects[0]["expected_co2_tonnes"] == 42.5
    assert projects[1]["match_scope"] == "exact_legal_unit"
    assert projects[1]["project_location_scope"] == "outside_guadeloupe"


def test_atomic_index_deduplicates_and_never_invents_amounts_or_personal_fields(tmp_path):
    company_db = tmp_path / "companies.sqlite"
    company_database(company_db)
    source = tmp_path / "relance.csv"
    source.write_text(
        "entreprise;type_entreprise;siren;volet_relance;mesure;nom_departement;nom_commune;code_postal;coordonnees_gps;description_projet;mesure_light;mise_a_jour;filiere;tonnes_equivalent_co2_pour_les_projets_decarbonation;code_departement;nom_region\n"
        "ENTREPRISE LOCALE;PME;123456789;Verdissement;Décarbonation;GUADELOUPE;BAIE-MAHAULT;97122;16.2, -61.5;Projet public;Décarbonation;2022-03-21;Chimie;;971.0;GUADELOUPE\n",
        encoding="utf-8",
    )
    projects, stats = parse_resource(source, resource(), company_db)
    output = tmp_path / "france-relance.sqlite"
    report = build_index(projects + projects, output, metadata(), stats, True)
    connection = sqlite3.connect(output)
    count = connection.execute("SELECT COUNT(*) FROM france_relance_industrial_projects").fetchone()[0]
    columns = {row[1] for row in connection.execute("PRAGMA table_info(france_relance_industrial_projects)")}
    connection.close()
    assert count == 1
    assert report["guadeloupe_project_count"] == 1
    assert report["individual_amounts_available"] is False
    assert not {"amount", "email", "telephone", "director"} & columns
