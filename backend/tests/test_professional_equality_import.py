import sqlite3

from openpyxl import Workbook

from scripts.import_professional_equality_index import (
    build_index,
    constituent_sirens,
    parse_resource,
    parse_score,
    split_naf,
)


HEADERS = [
    "Année", "Structure", "Tranche d'effectifs", "SIREN", "Raison Sociale", "Nom UES",
    "Entreprises UES (SIREN)", "Région", "Département", "Pays", "Code NAF",
    "Note Ecart rémunération", "Note Ecart taux d'augmentation (hors promotion)",
    "Note Ecart taux de promotion", "Note Ecart taux d'augmentation",
    "Note Retour congé maternité", "Note Hautes rémunérations", "Note Index",
]


def company_database(path):
    connection = sqlite3.connect(path)
    connection.execute("CREATE TABLE companies (siren TEXT, association_id TEXT)")
    connection.execute("CREATE TABLE establishments (siret TEXT)")
    connection.executemany("INSERT INTO companies VALUES (?, NULL)", [("123456789",), ("987654321",)])
    connection.commit()
    connection.close()


def workbook(path):
    book = Workbook()
    sheet = book.active
    sheet.title = "Données publiques Index Egapro"
    sheet.append(HEADERS)
    sheet.append([
        2025, "Entreprise", "50 à 250", "123456789", "NOM SOURCE EXCLU", None, None,
        "Guadeloupe", "Guadeloupe", "FRANCE", "62.02A - Conseil en systèmes et logiciels informatiques",
        38, None, None, 31, "NC", 10, 88,
    ])
    sheet.append([
        2025, "Unité Economique et Sociale (UES)", "251 à 999", "111111111", "NOM DECLARANT EXCLU", "UES SERVICES",
        "ENTREPRISE A (987654321), ENTREPRISE B (222222222)", "Île-de-France", "Paris", "FRANCE",
        "70.10Z - Activités des sièges sociaux", 37, 20, 15, None, 15, 10, 97,
    ])
    book.save(path)


def resource():
    return {
        "id": "resource-equality", "title": "Index Egalité Professionnelle F/H",
        "url": "https://example.test/index.xlsx", "last_modified": "2026-07-18T02:02:48+02:00",
    }


def metadata():
    return {
        "title": "Index Egalité Professionnelle F/H des entreprises de 50 salariés ou plus",
        "source_updated_at": "2026-07-18T02:02:48+02:00", "license_name": "Licence Ouverte 2.0",
        "license_url": "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
    }


def test_equality_normalization_distinguishes_scores_nc_and_absent_values():
    assert constituent_sirens("A (123456789), B 987654321") == {"123456789", "987654321"}
    assert parse_score(38, 40) == (38, "calculated")
    assert parse_score("NC", 40) == (None, "not_calculable")
    assert parse_score(None, 40) == (None, "not_applicable")
    assert parse_score(41, 40) == (None, "invalid")
    assert split_naf("62.02A - Conseil en systèmes et logiciels informatiques") == (
        "62.02A", "Conseil en systèmes et logiciels informatiques",
    )


def test_parser_matches_direct_siren_and_explicit_ues_members_only(tmp_path):
    company_db = tmp_path / "companies.sqlite"
    company_database(company_db)
    source = tmp_path / "index.xlsx"
    workbook(source)
    profiles, stats = parse_resource(source, resource(), company_db)
    assert stats["rows_read"] == 2
    assert stats["matched_source_rows"] == 2
    assert stats["direct_declarant_links"] == 1
    assert stats["ues_member_links"] == 1
    assert profiles[0]["siren"] == "123456789"
    assert profiles[0]["match_scope"] == "exact_declarant"
    assert profiles[0]["maternity_return_status"] == "not_calculable"
    assert profiles[1]["siren"] == "987654321"
    assert profiles[1]["declaring_siren"] == "111111111"
    assert profiles[1]["match_scope"] == "ues_member"
    assert profiles[1]["ues_name"] == "UES SERVICES"
    assert profiles[1]["ues_member_count"] == 2
    assert "legal_name" not in profiles[0]
    assert "source_legal_name" not in profiles[0]


def test_atomic_index_deduplicates_and_stores_only_aggregate_results(tmp_path):
    company_db = tmp_path / "companies.sqlite"
    company_database(company_db)
    source = tmp_path / "index.xlsx"
    workbook(source)
    profiles, stats = parse_resource(source, resource(), company_db)
    output = tmp_path / "equality.sqlite"
    report = build_index(profiles + profiles, output, metadata(), stats, True)
    connection = sqlite3.connect(output)
    count = connection.execute("SELECT COUNT(*) FROM professional_equality_declarations").fetchone()[0]
    columns = {row[1] for row in connection.execute("PRAGMA table_info(professional_equality_declarations)")}
    connection.close()
    assert count == 2
    assert report["matched_companies"] == 2
    assert report["calculable_index_count"] == 2
    assert report["contains_employee_records"] is False
    assert not {"reason_sociale", "legal_name", "employee_name", "salary", "email", "telephone"} & columns
