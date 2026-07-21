import sqlite3

from scripts.import_bodacc_guadeloupe import initialise, parse_bodacc_record, rebuild_search, sirens_from_registry


def test_registry_parser_keeps_exact_sirens_only():
    assert sirens_from_registry(["123 456 789", "123456789", "RCS 987 654 321"]) == {"123456789", "987654321"}
    assert sirens_from_registry(["12345678", "1234567890", None]) == set()


def test_bodacc_parser_drops_raw_legal_people_and_keeps_public_activity():
    rows = parse_bodacc_record(
        {
            "id": "A202600000001",
            "dateparution": "2026-07-19",
            "numeroannonce": 12,
            "typeavis": "annonce",
            "typeavis_lib": "Avis initial",
            "familleavis": "modifications",
            "familleavis_lib": "Modifications diverses",
            "numerodepartement": "971",
            "tribunal": "Greffe de Pointe-a-Pitre",
            "ville": "Baie-Mahault",
            "registre": ["123 456 789", "123456789"],
            "cp": "97122",
            "listepersonnes": '{"personne": {"typePersonne": "pm", "denomination": "SOCIETE TEST", "formeJuridique": "SAS", "capital": {"montantCapital": "1500", "devise": "EUR"}, "administration": "NOM A NE PAS STOCKER"}}',
            "listeetablissements": '{"etablissement": {"activite": "Conseil en systèmes et logiciels informatiques"}}',
            "url_complete": "https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:A202600000001",
        },
        {"123456789"},
        "2026-07-19T00:00:00Z",
    )
    assert len(rows) == 1
    row = rows[0]
    assert row["siren"] == "123456789"
    assert row["legal_form"] == "SAS"
    assert row["capital"] == 1500.0
    assert row["activity_text"] == "Conseil en systèmes et logiciels informatiques"
    assert "denomination" not in row
    assert "administration" not in row


def test_bodacc_schema_has_no_raw_payload_or_person_columns(tmp_path):
    connection = sqlite3.connect(tmp_path / "bodacc.sqlite")
    initialise(connection)
    columns = {row[1] for row in connection.execute("PRAGMA table_info(bodacc_events)")}
    assert {"siren", "event_id", "family_label", "activity_text", "source_url"} <= columns
    assert not {"listepersonnes", "listeetablissements", "commercant", "person_name", "birth_date"} & columns
    connection.close()


def test_bodacc_search_index_is_rebuilt_from_public_activity(tmp_path):
    connection = sqlite3.connect(tmp_path / "bodacc.sqlite")
    initialise(connection)
    connection.execute(
        """
        INSERT INTO bodacc_events(siren,event_id,publication_date,family_label,department_code,activity_text,retrieved_at)
        VALUES ('123456789','A1','2026-07-19','Ventes et cessions','971','Production de logiciels','2026-07-19T00:00:00Z')
        """
    )
    rebuild_search(connection)
    assert connection.execute("SELECT count(*) FROM bodacc_search WHERE bodacc_search MATCH 'logiciels*'").fetchone()[0] == 1
    connection.close()
