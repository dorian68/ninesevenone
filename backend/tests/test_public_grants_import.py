import sqlite3

from scripts.import_public_grants import (
    TargetIndex,
    build_index,
    normalize_header,
    normalized_date,
    parse_number,
    parse_resource,
    resolve_match,
)


def targets():
    return TargetIndex(
        company_sirens={"123456789", "987654321"},
        active_sirets={"12345678900010"},
        rna_to_sirens={"W9G2001932": {"123456789"}, "W971000002": {"123456789", "987654321"}},
    )


def test_grant_normalization_handles_public_csv_variants():
    assert normalize_header("nomBénéficiaire ") == "nombeneficiaire"
    assert parse_number("23 450,75 €") == 23450.75
    assert parse_number("1,234.50") == 1234.5
    assert normalized_date("18/07/2026") == "2026-07-18"
    assert normalized_date("2026-02-31") is None


def test_grant_matching_is_exact_and_rejects_conflicts():
    index = targets()
    assert resolve_match("12345678900010", None, index) == ("123456789", "exact_active_siret", 1.0)
    assert resolve_match("12345678999999", None, index) == ("123456789", "exact_company_siret", 0.98)
    assert resolve_match(None, "W9G2001932", index) == ("123456789", "exact_unambiguous_rna", 0.95)
    assert resolve_match(None, "W971000002", index) is None
    assert resolve_match("98765432100010", "W9G2001932", index) is None


def test_parse_grant_resource_requires_structured_identifiers(tmp_path):
    source = tmp_path / "grants.csv"
    source.write_text(
        "nomAttribuant;idAttribuant;dateConvention;referenceDecision;nomBénéficiaire;idBeneficiaire;rnaBeneficiaire;objet;montant;nature;conditionsVersement;datesPeriodeVersement;notificationUE;pourcentageSubvention\n"
        "Région Test;11111111100011;2026-06-03;DEC-42;Association Test;12345678900010;W9G2001932;Programme culturel;25 000,00;numéraire;unique;2026-07-01/2026-12-31;non;100\n",
        encoding="utf-8",
    )
    item = {
        "dataset": {"id": "dataset-test", "title": "Subventions test", "license": "lov2"},
        "resource": {
            "id": "resource-test",
            "title": "Conventions 2026",
            "url": "https://example.test/grants.csv",
            "last_modified": "2026-07-01T10:00:00+00:00",
        },
    }
    grants, stats = parse_resource(source, item, targets())
    assert stats["rows_read"] == 1
    assert stats["rows_matched"] == 1
    assert grants[0]["siren"] == "123456789"
    assert grants[0]["match_method"] == "exact_active_siret_rna"
    assert grants[0]["amount"] == 25000
    assert grants[0]["purpose"] == "Programme culturel"


def test_grant_index_keeps_provenance_and_deduplicates(tmp_path):
    output = tmp_path / "public-grants.sqlite"
    grant = {
        "fingerprint": "fingerprint-test",
        "siren": "123456789",
        "siret": "12345678900010",
        "rna_id": "W9G2001932",
        "match_method": "exact_active_siret_rna",
        "match_confidence": 1.0,
        "beneficiary_name": "ASSOCIATION TEST",
        "awarding_authority": "RÉGION TEST",
        "awarding_authority_siret": "11111111100011",
        "convention_date": "2026-06-03",
        "decision_reference": "DEC-42",
        "purpose": "Programme culturel",
        "amount": 25000.0,
        "nature": "numéraire",
        "payment_conditions": "unique",
        "payment_period": "2026-07-01/2026-12-31",
        "rae_id": None,
        "eu_notification": 0,
        "subsidy_percentage": 100.0,
        "aid_scheme": None,
        "source_reference_date": "2026-07-01",
        "dataset_id": "dataset-test",
        "dataset_title": "Subventions test",
        "dataset_url": "https://www.data.gouv.fr/datasets/dataset-test/",
        "resource_id": "resource-test",
        "resource_title": "Conventions 2026",
        "resource_url": "https://example.test/grants.csv",
        "source_row_number": 2,
        "source_last_modified": "2026-07-01T10:00:00+00:00",
        "license_code": "lov2",
        "license_name": "Licence Ouverte 2.0",
        "license_url": "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
    }
    run = {
        "resource_id": "resource-test",
        "dataset_id": "dataset-test",
        "dataset_title": "Subventions test",
        "resource_url": "https://example.test/grants.csv",
        "license_code": "lov2",
        "status": "imported",
        "detail": None,
        "rows_read": 1,
        "rows_matched": 1,
    }
    report = build_index([grant, grant], [run], output, {"catalog_dataset_count": 1})
    connection = sqlite3.connect(output)
    grant_count = connection.execute("SELECT COUNT(*) FROM public_grants").fetchone()[0]
    occurrence_count = connection.execute("SELECT COUNT(*) FROM grant_occurrences").fetchone()[0]
    columns = {row[1] for row in connection.execute("PRAGMA table_info(public_grants)")}
    connection.close()
    assert grant_count == 1
    assert occurrence_count == 1
    assert report["matched_companies"] == 1
    assert report["amount_is_payment_proof"] is False
    assert not {"email", "telephone", "director", "address"} & columns
