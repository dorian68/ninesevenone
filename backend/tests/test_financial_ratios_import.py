import sqlite3

from scripts.import_financial_ratios import (
    build_index,
    extract_formula,
    load_company_targets,
    normalized_closing_date,
    normalized_siren,
    parse_number,
    parse_records,
)


def company_database(path):
    connection = sqlite3.connect(path)
    connection.execute(
        """CREATE TABLE companies (
          siren TEXT, legal_name TEXT, diffusion_status TEXT, administrative_status TEXT
        )"""
    )
    connection.executemany("INSERT INTO companies VALUES (?,?,?,?)", [
        ("123456789", "ENTREPRISE PUBLIABLE", "O", "A"),
        ("987654321", "ENTREPRISE RESTREINTE", "P", "A"),
        ("111111111", "ENTREPRISE FERMEE", "O", "C"),
    ])
    connection.commit()
    connection.close()


def metadata():
    return {
        "records_count": 6542232,
        "source_updated_at": "2026-06-01T15:27:20+00:00",
        "dataset_url": "https://www.data.gouv.fr/datasets/ratios-financiers-bce-inpi",
        "api_url": "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/ratios_inpi_bce",
        "license_name": "Licence Ouverte 2.0",
        "license_url": "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
    }


def definitions():
    from scripts.import_financial_ratios import METRIC_FIELDS, metric_unit
    return [{
        "field_name": field,
        "label": field,
        "value_type": "int" if metric_unit(field) == "EUR" else "double",
        "unit": metric_unit(field),
        "description": "Définition officielle",
        "formula_ck": "FL",
        "formula_s": "210+214+218",
    } for field in METRIC_FIELDS]


def test_normalizers_and_official_formula_extraction():
    description = "- Revenu total\n- formule bilan C/K: FL\n- formule bilan S: 210+214+218"
    assert normalized_siren("123 456 789") == "123456789"
    assert normalized_siren("123") is None
    assert normalized_closing_date("2024-12-31T00:00:00+00:00") == "2024-12-31"
    assert normalized_closing_date("2024-13-40") is None
    assert parse_number("1 234,50") == 1234.5
    assert parse_number("NaN") is None
    assert extract_formula(description, "C/K") == "FL"
    assert extract_formula(description, "S") == "210+214+218"
    compacted = "- Revenu total - formule bilan C/K: FL - formule bilan S: 210+214+218"
    assert extract_formula(compacted, "C/K") == "FL"
    assert extract_formula(compacted, "S") == "210+214+218"


def test_targets_exclude_restricted_and_inactive_companies(tmp_path):
    path = tmp_path / "companies.sqlite"
    company_database(path)
    targets = load_company_targets(path)
    assert set(targets) == {"123456789"}


def test_parser_keeps_statement_types_separate_and_flags_confidentiality_and_future_dates():
    base = {
        "siren": "123456789", "date_cloture_exercice": "2024-12-31",
        "confidentiality": "Public", "chiffre_d_affaires": 1000,
        "ebe": 100, "resultat_net": 50,
    }
    records = [
        {**base, "type_bilan": "C"},
        {**base, "type_bilan": "K", "chiffre_d_affaires": 2000},
        {**base, "type_bilan": "S", "confidentiality": "Partiellement confidentiel", "chiffre_d_affaires": 0},
        {**base, "type_bilan": "C", "date_cloture_exercice": "2027-12-31"},
        {**base, "siren": "987654321", "type_bilan": "C"},
    ]
    exercises, stats = parse_records(records, {"123456789"}, "2026-06-01T15:27:20+00:00")
    assert len(exercises) == 4
    assert {item["statement_type"] for item in exercises if item["closing_date"] == "2024-12-31"} == {"C", "K", "S"}
    simplified = next(item for item in exercises if item["statement_type"] == "S")
    assert simplified["is_partially_confidential"] is True
    assert simplified["chiffre_d_affaires"] == 0  # Raw published value is preserved for audit.
    assert next(item for item in exercises if item["closing_date"] == "2027-12-31")["date_quality"] == "future_closing_date"
    assert stats["out_of_scope_rows"] == 1
    assert stats["future_closing_date_rows"] == 1


def test_atomic_index_has_definitions_and_no_personal_or_scoring_fields(tmp_path):
    records = [{
        "siren": "123456789", "date_cloture_exercice": "2024-12-31", "type_bilan": "C",
        "confidentiality": "Public", "chiffre_d_affaires": 1000, "marge_brute": 400,
        "ebe": 100, "ebit": 80, "resultat_net": 50, "taux_d_endettement": 20.5,
    }]
    exercises, parse_stats = parse_records(records, {"123456789"}, metadata()["source_updated_at"])
    output = tmp_path / "financial.sqlite"
    report = build_index(
        output, exercises, definitions(), metadata(),
        {"queried_company_count": 1, "query": {}, "parse": parse_stats},
    )
    connection = sqlite3.connect(output)
    columns = {row[1] for row in connection.execute("PRAGMA table_info(financial_exercises)")}
    assert connection.execute("SELECT COUNT(*) FROM financial_exercises").fetchone()[0] == 1
    assert connection.execute("SELECT COUNT(*) FROM financial_metric_definitions").fetchone()[0] == len(definitions())
    connection.close()
    assert report["company_count"] == 1
    assert report["produces_credit_score"] is False
    assert not {"email", "telephone", "director", "credit_score", "solvency_score"} & columns
