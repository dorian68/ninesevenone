import sqlite3

from scripts.import_public_officers_guadeloupe import (
    initialise,
    parse_annuaire_profile,
    parse_department_page,
    parse_officers,
    rebuild_search,
)


def test_parser_keeps_public_identity_and_role_only():
    rows = parse_officers({
        "siren": "123456789",
        "date_mise_a_jour_rne": "2026-07-18T10:00:00",
        "dirigeants": [
            {
                "nom": "DUPONT",
                "prenoms": "JEAN",
                "date_de_naissance": "1970-01",
                "annee_de_naissance": "1970",
                "nationalite": "Française",
                "qualite": "Gérant",
                "type_dirigeant": "personne physique",
            },
            {
                "siren": "987654321",
                "denomination": "AUDIT TEST",
                "qualite": "Commissaire aux comptes",
                "type_dirigeant": "personne morale",
            },
        ],
    }, "2026-07-19T00:00:00Z")
    assert len(rows) == 2
    assert rows[0]["display_name"] == "JEAN DUPONT"
    assert rows[0]["role"] == "Gérant"
    assert "date_de_naissance" not in rows[0]
    assert "nationalite" not in rows[0]
    assert rows[1]["related_siren"] == "987654321"


def test_index_search_rebuild_has_no_personal_columns(tmp_path):
    target = tmp_path / "officers.sqlite"
    connection = sqlite3.connect(target)
    initialise(connection)
    rows = parse_officers({
        "siren": "123456789",
        "dirigeants": [{"nom": "DUPONT", "prenoms": "JEAN", "qualite": "Gérant", "type_dirigeant": "personne physique"}],
    }, "2026-07-19T00:00:00Z")
    connection.executemany(
        """
        INSERT INTO officers(officer_key,siren,officer_type,display_name,family_name,given_names,search_name,role,
          related_siren,source_updated_at,retrieved_at,source,source_url)
        VALUES (:officer_key,:siren,:officer_type,:display_name,:family_name,:given_names,:search_name,:role,
          :related_siren,:source_updated_at,:retrieved_at,:source,:source_url)
        """, rows)
    rebuild_search(connection)
    assert connection.execute("SELECT count(*) FROM officer_search WHERE officer_search MATCH 'dupont*'").fetchone()[0] == 1
    columns = {row[1] for row in connection.execute("PRAGMA table_info(officers)")}
    assert not {"date_de_naissance", "annee_de_naissance", "nationalite", "email", "telephone", "address"} & columns
    connection.close()


def test_annuaire_profile_keeps_safe_aggregates_and_drops_nested_people():
    profile = parse_annuaire_profile({
        "siren": "123456789",
        "categorie_entreprise": "PME",
        "tranche_effectif_salarie": "12",
        "annee_tranche_effectif_salarie": "2023",
        "activite_principale_naf25": "62.10Z",
        "nombre_etablissements": 3,
        "nombre_etablissements_ouverts": 2,
        "date_mise_a_jour": "2026-07-18T10:00:00",
        "complements": {
            "est_qualiopi": True,
            "convention_collective_renseignee": True,
            "liste_idcc": ["1486"],
            "collectivite_territoriale": {"elus": [{"nom": "A NE PAS STOCKER"}]},
            "est_association": False,
        },
        "finances": {"2024": {"ca": 1234, "resultat_net": -12}},
        "dirigeants": [{"nom": "A NE PAS STOCKER", "date_de_naissance": "1970-01"}],
    }, "2026-07-19T00:00:00Z")
    assert profile is not None
    assert profile["company_category"] == "PME"
    assert profile["establishment_count"] == 3
    assert profile["financials"] == [{"year": "2024", "revenue": 1234.0, "net_income": -12.0}]
    assert profile["agreements"] == ["1486"]
    assert {item["label_key"] for item in profile["labels"]} == {"est_qualiopi"}
    assert "elus" not in profile
    assert "dirigeants" not in profile


def test_initialise_adds_profile_tables_and_resume_marker(tmp_path):
    target = tmp_path / "officers.sqlite"
    connection = sqlite3.connect(target)
    initialise(connection)
    tables = {
        row[0]
        for row in connection.execute("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual table')")
    }
    assert {"annuaire_profiles", "annuaire_financials", "annuaire_labels", "annuaire_agreements"} <= tables
    columns = {row[1] for row in connection.execute("PRAGMA table_info(fetch_log)")}
    assert "profile_status" in columns
    connection.close()


def test_department_page_keeps_exact_local_sirens_and_reports_api_cap():
    parsed = parse_department_page({
        "total_results": 10000,
        "total_pages": 400,
        "results": [
            {"siren": "123456789", "nom_complet": "LOCAL"},
            {"siren": "987654321", "nom_complet": "HORS STOCK"},
            {"siren": "123456789", "nom_complet": "DOUBLON"},
        ],
    }, {"123456789"})
    assert parsed["rows_read"] == 3
    assert parsed["matched_rows"] == 1
    assert parsed["total_results"] == 10000
    assert parsed["total_pages"] == 400
    assert [item["siren"] for item in parsed["results"]] == ["123456789"]
