import sqlite3

from scripts.import_training_organizations import (
    build_index,
    normalized_business_identifier,
    normalized_previous_activity_numbers,
    parse_boolean,
    parse_resource,
    training_location_scope,
)


HEADER = (
    "numeroDeclarationActivite;numerosDeclarationActivitePrecedent;denomination;siren;siretEtablissementDeclarant;"
    "adressePhysiqueOrganismeFormation.voie;adressePhysiqueOrganismeFormation.codePostal;adressePhysiqueOrganismeFormation.ville;adressePhysiqueOrganismeFormation.codeRegion;"
    "certifications.actionsDeFormation;certifications.bilansDeCompetences;certifications.VAE;certifications.actionsDeFormationParApprentissage;"
    "organismeEtrangerRepresente.denomination;organismeEtrangerRepresente.voie;organismeEtrangerRepresente.codePostal;organismeEtrangerRepresente.ville;organismeEtrangerRepresente.pays;"
    "informationsDeclarees.dateDerniereDeclaration;informationsDeclarees.debutExercice;informationsDeclarees.finExercice;"
    "informationsDeclarees.specialitesDeFormation.codeSpecialite1;informationsDeclarees.specialitesDeFormation.libelleSpecialite1;"
    "informationsDeclarees.specialitesDeFormation.codeSpecialite2;informationsDeclarees.specialitesDeFormation.libelleSpecialite2;"
    "informationsDeclarees.specialitesDeFormation.codeSpecialite3;informationsDeclarees.specialitesDeFormation.libelleSpecialite3;"
    "informationsDeclarees.nbStagiaires;informationsDeclarees.nbStagiairesConfiesParUnAutreOF;informationsDeclarees.effectifFormateurs;\n"
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
        "id": "resource-training",
        "title": "Liste publique des Organismes de Formation (format CSV)",
        "url": "https://example.test/training.csv",
        "last_modified": "2026-07-18T15:18:30Z",
    }


def metadata():
    return {
        "title": "Liste Publique des Organismes de Formation",
        "source_updated_at": "2026-07-18T15:24:26Z",
        "license_name": "Licence Ouverte",
        "license_url": "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
    }


def test_training_identifier_boolean_and_location_normalization():
    assert normalized_business_identifier("123456789", "12345678900010") == ("123456789", "12345678900010")
    assert normalized_business_identifier("", "98765432100019") == ("987654321", "98765432100019")
    assert normalized_business_identifier("123456789", "98765432100019") == (None, None)
    assert parse_boolean("true") is True
    assert parse_boolean("false") is False
    assert parse_boolean("") is None
    assert normalized_previous_activity_numbers("01971234567, 11751234567, 11751234567", "01971234567") == "11751234567"
    assert normalized_previous_activity_numbers("01971234567", "01971234567") is None
    assert training_location_scope("97122", "01") == "guadeloupe"
    assert training_location_scope("75001", "11") == "outside_guadeloupe"


def test_parser_keeps_declared_services_and_aggregates_without_personal_fields(tmp_path):
    company_db = tmp_path / "companies.sqlite"
    company_database(company_db)
    source = tmp_path / "training.csv"
    source.write_text(
        HEADER
        + '01971234567;;"NOM PERSONNEL EXCLU";123456789;12345678900010;"RUE PRIVEE EXCLUE";97122;BAIE-MAHAULT;01;true;false;true;false;;;;;;18/05/2026;01/01/2025;31/12/2025;314;Comptabilité, gestion;315;Ressources humaines;;;120;8;4;\n'
        + '11751234567;;"AUTRE NOM EXCLU";987654321;98765432199999;"RUE EXCLUE";75001;PARIS;11;;;;true;;;;;;01/04/2026;01/01/2025;31/12/2025;326;Informatique;;;;;45;0;2;\n'
        + '01979999999;;"NOM IDENTIQUE";;;"RUE";97139;ABYMES;01;true;;;;;;;;01/04/2026;01/01/2025;31/12/2025;310;Commerce;;;;;10;0;1;\n',
        encoding="utf-8",
    )
    profiles, stats = parse_resource(source, resource(), company_db)
    assert stats["rows_read"] == 3
    assert stats["rows_matched"] == 2
    assert stats["invalid_identifier_rows"] == 1
    assert stats["qualiopi_matches"] == 2
    assert profiles[0]["match_scope"] == "active_local_establishment"
    assert profiles[0]["registration_location_scope"] == "guadeloupe"
    assert profiles[0]["specialty_label_1"] == "Comptabilité, gestion"
    assert profiles[0]["trainee_count"] == 120
    assert profiles[1]["match_scope"] == "company_other_establishment"
    assert "denomination" not in profiles[0]
    assert "street_address" not in profiles[0]


def test_atomic_index_deduplicates_and_contains_no_names_contacts_or_street(tmp_path):
    company_db = tmp_path / "companies.sqlite"
    company_database(company_db)
    source = tmp_path / "training.csv"
    source.write_text(
        HEADER
        + '01971234567;;"NOM EXCLU";123456789;12345678900010;"RUE EXCLUE";97122;BAIE-MAHAULT;01;true;false;false;false;;;;;;18/05/2026;01/01/2025;31/12/2025;314;Comptabilité, gestion;;;;;120;8;4;\n',
        encoding="utf-8",
    )
    profiles, stats = parse_resource(source, resource(), company_db)
    output = tmp_path / "training.sqlite"
    report = build_index(profiles + profiles, output, metadata(), stats, True)
    connection = sqlite3.connect(output)
    count = connection.execute("SELECT COUNT(*) FROM training_organization_profiles").fetchone()[0]
    columns = {row[1] for row in connection.execute("PRAGMA table_info(training_organization_profiles)")}
    connection.close()
    assert count == 1
    assert report["quality_certified_profile_count"] == 1
    assert report["contains_personal_names"] is False
    assert not {"denomination", "name", "street_address", "email", "telephone", "foreign_organization"} & columns
