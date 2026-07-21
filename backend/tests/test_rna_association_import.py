import sqlite3

from scripts.import_rna_association_profiles import (
    build_index,
    identifier_status,
    normalized_date,
    public_website,
    target_associations,
)


def test_rna_public_website_requires_publication_authorization():
    assert public_website("association.example", "1") == "https://association.example"
    assert public_website("https://association.example/a#contact", "O") == "https://association.example/a"
    assert public_website("association.example", "0") is None
    assert public_website("mailto:contact@association.example", "1") is None


def test_rna_dates_and_identifier_match_are_conservative():
    assert normalized_date("2026-07-01 10:30:00") == "2026-07-01"
    assert normalized_date("0001-01-01") is None
    assert identifier_status("123456789", "12345678900010") == ("rna_exact_siret_match", 1.0)
    assert identifier_status("123456789", None) == ("rna_exact_no_siret", 0.95)
    assert identifier_status("123456789", "98765432100010") == ("rna_exact_siret_mismatch", 0.8)


def test_rna_targets_accept_overseas_alphanumeric_identifiers(tmp_path):
    company_db = tmp_path / "companies.sqlite"
    connection = sqlite3.connect(company_db)
    connection.execute("CREATE TABLE companies (siren TEXT, association_id TEXT)")
    connection.executemany("INSERT INTO companies VALUES (?, ?)", [
        ("111111111", "W9G2001932"),
        ("222222222", "W751080001"),
        ("333333333", "INVALID"),
    ])
    connection.commit()
    connection.close()
    assert target_associations(company_db) == [
        ("222222222", "W751080001"),
        ("111111111", "W9G2001932"),
    ]


def test_rna_index_contains_only_association_level_public_fields(tmp_path):
    output = tmp_path / "rna.sqlite"
    report = build_index([{
        "siren": "123456789",
        "rna_id": "W971000001",
        "former_id": "971P000001",
        "siret": "12345678900010",
        "public_utility_id": None,
        "creation_date": "2020-01-02",
        "declaration_date": "2026-02-03",
        "publication_date": "2020-01-10",
        "dissolution_date": None,
        "nature_code": "D",
        "group_type": "S",
        "title": "ASSOCIATION DE TEST",
        "short_title": "TEST",
        "purpose": "Développer des actions culturelles ouvertes au public.",
        "purpose_code_1": "006000",
        "purpose_code_2": None,
        "website": "association.example",
        "website_publication_flag": "1",
        "position_code": "A",
        "updated_at": "2026-02-03 10:00:00",
    }], output, {
        "resource_id": "resource-test",
        "resource_url": "https://example.test/waldec.parquet",
        "resource_title": "Données Waldec au 01 juillet 2026 (format parquet)",
        "resource_last_modified": "2026-07-01T13:32:45+02:00",
    }, 1)

    connection = sqlite3.connect(output)
    connection.row_factory = sqlite3.Row
    profile = dict(connection.execute("SELECT * FROM association_profiles").fetchone())
    columns = {row[1] for row in connection.execute("PRAGMA table_info(association_profiles)")}
    connection.close()

    assert profile["rna_id"] == "W971000001"
    assert profile["purpose"].startswith("Développer")
    assert profile["website"] == "https://association.example"
    assert profile["identifier_status"] == "rna_exact_siret_match"
    assert report["matched"] == 1
    assert report["purposes"] == 1
    assert report["rna_shared_across_sirens"] == 0
    assert not {"email", "telephone", "dir_civilite", "adrg_declarant"} & columns
