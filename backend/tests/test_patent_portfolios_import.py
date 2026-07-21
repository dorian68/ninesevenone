import sqlite3

from scripts.import_patent_portfolios import (
    build_index,
    build_portfolio_items,
    family_abstract,
    family_title,
    load_company_targets,
    normalized_identifier,
    normalized_siren,
    parse_applicant_csv,
    source_boolean,
)


def company_database(path):
    connection = sqlite3.connect(path)
    connection.execute(
        """CREATE TABLE companies (
          siren TEXT, legal_name TEXT, diffusion_status TEXT, administrative_status TEXT
        )"""
    )
    connection.executemany("INSERT INTO companies VALUES (?,?,?,?)", [
        ("123456789", "ENTREPRISE INNOVANTE", "O", "A"),
        ("987654321", "ENTREPRISE RESTREINTE", "P", "A"),
    ])
    connection.commit()
    connection.close()


def source_metadata():
    return {
        key: {
            "source_updated_at": "2026-05-11T14:00:00Z",
            "page_url": f"https://www.data.gouv.fr/datasets/{key}",
        }
        for key in ("applicants", "applications", "families", "technologies")
    }


def test_patent_identifiers_and_source_booleans():
    assert normalized_siren("123 456 789") == "123456789"
    assert normalized_siren("123") is None
    assert normalized_identifier("EP202401234A") == "EP202401234A"
    assert normalized_identifier("12345", digits_only=True) == "12345"
    assert normalized_identifier("12-A", digits_only=True) is None
    assert source_boolean("vrai") is True
    assert source_boolean("faux") is False
    assert source_boolean("") is None


def test_applicant_parser_uses_exact_siren_and_excludes_restricted(tmp_path):
    company_db = tmp_path / "companies.sqlite"
    company_database(company_db)
    targets = load_company_targets(company_db)
    csv_path = tmp_path / "applicants.csv"
    csv_path.write_text(
        "key_appln_nr;nr_famille_docdb;nom_demandeur;code_pays;siren;Paysage_id;key_appln_nr_person\n"
        "FR202400001A;10001;Entreprise Innovante;FR;123456789;x1;person-key-not-kept\n"
        "FR202400001A;10001;Entreprise Innovante;FR;123456789;x1;duplicate\n"
        "FR202400002A;10002;Entreprise Restreinte;FR;987654321;x2;restricted\n"
        "FR202400003A;10003;Entreprise Homonyme;FR;111111111;x3;other\n",
        encoding="utf-8",
    )
    rows, stats = parse_applicant_csv(csv_path, targets)
    assert len(rows) == 1
    assert rows[0]["siren"] == "123456789"
    assert rows[0]["family_docdb"] == "10001"
    assert "key_appln_nr_person" not in rows[0]
    assert stats["matched_rows"] == 2
    assert stats["deduplicated_rows"] == 1
    assert stats["restricted_rows"] == 1


def test_portfolio_builder_prefers_french_metadata_and_keeps_scope():
    applicants = [{
        "fingerprint": "a" * 64,
        "source_row_number": 2,
        "siren": "123456789",
        "application_key": "FR202400001A",
        "family_docdb": "10001",
        "applicant_name": "Entreprise Innovante",
        "country_code": "FR",
        "scope": "national_legal_unit",
    }]
    application_records = [{
        "key_appln_nr": "FR202400001A", "date_demande": "2024-01-10",
        "autorite_demande": "FR", "nr_publication_demande": "3123456",
        "date_publication_demande": "2025-07-10", "date_octroi": None,
        "demande_priorite": "vrai", "titre_demande": "Titre de demande",
    }]
    family_records = [{
        "nr_famille_docdb": "10001", "nr_famille_inpadoc": "20001",
        "date_premiere_demande": "2024-01-10", "date_premiere_publication": "2025-07-10",
        "demande_oeb": "faux", "demande_internationale": "vrai", "octroye": "faux",
        "titre_francais": "Innovation documentée", "titre_anglais": "Documented innovation",
        "resume_francais": "Résumé public et factuel.", "resume_anglais": "Public abstract.",
    }]
    technologies = [{"nr_famille_docdb": "10001", "niveau": "section", "code": "C", "libelle": "CHEMISTRY"}]
    families, applications, technology_rows, stats = build_portfolio_items(
        applicants, application_records, family_records, technologies,
    )
    assert family_title(family_records[0]) == "Innovation documentée"
    assert family_abstract(family_records[0]) == "Résumé public et factuel."
    assert families[0]["scope"] == "national_legal_unit"
    assert families[0]["international_application"] is True
    assert families[0]["display_title"] == "Innovation documentée"
    assert applications[0]["priority_claim"] is True
    assert technology_rows[0]["code"] == "C"
    assert stats["missing_family_records"] == 0


def test_atomic_index_contains_no_inventor_or_person_fields(tmp_path):
    applicants = [{
        "fingerprint": "a" * 64, "source_row_number": 2, "siren": "123456789",
        "application_key": "FR202400001A", "family_docdb": "10001",
        "applicant_name": "Entreprise Innovante", "country_code": "FR",
        "scope": "national_legal_unit",
    }]
    families, applications, technologies, portfolio_stats = build_portfolio_items(
        applicants,
        [{"key_appln_nr": "FR202400001A", "date_demande": "2024-01-10", "date_octroi": "2026-01-10"}],
        [{
            "nr_famille_docdb": "10001", "date_premiere_demande": "2024-01-10",
            "date_premiere_publication": "2025-07-10", "octroye": "vrai",
            "demande_internationale": "faux", "titre_francais": "Innovation documentée",
            "resume_francais": "Résumé public.",
        }],
        [{"nr_famille_docdb": "10001", "niveau": "section", "code": "C", "libelle": "CHEMISTRY"}],
    )
    output = tmp_path / "patents.sqlite"
    report = build_index(
        output, families, applications, technologies, source_metadata(),
        {
            "applicants": {"rows_read": 1, "matched_rows": 1, "restricted_rows": 0},
            "portfolio": portfolio_stats,
        },
    )
    connection = sqlite3.connect(output)
    columns = {
        row[1]
        for table in ("patent_families", "patent_applications", "patent_technologies")
        for row in connection.execute(f"PRAGMA table_info({table})")
    }
    assert connection.execute("SELECT COUNT(*) FROM patent_families").fetchone()[0] == 1
    assert connection.execute("SELECT granted FROM patent_families").fetchone()[0] == 1
    connection.close()
    assert report["family_count"] == 1
    assert report["contains_inventor_records"] is False
    assert not {"inventor", "inventor_name", "person_name", "email", "telephone"} & columns
