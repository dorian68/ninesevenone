import sqlite3

from scripts.enrich_company_press import initialise, load_targets, safe_url


def test_press_parser_accepts_public_http_urls_only():
    assert safe_url("https://news.example.test/article?id=1") == "https://news.example.test/article?id=1"
    assert safe_url("javascript:alert(1)") is None
    assert safe_url("https://user:secret@example.test/article") is None


def test_press_cache_schema_has_no_article_body_column(tmp_path):
    target = tmp_path / "press.sqlite"
    connection = sqlite3.connect(target)
    initialise(connection)
    columns = {row[1] for row in connection.execute("PRAGMA table_info(press_mentions)")}
    assert {"title", "url", "domain", "published_at", "source", "confidence", "retrieved_at"} <= columns
    assert not {"body", "content", "html", "excerpt"} & columns
    connection.close()


def test_press_priority_targets_are_bounded_and_use_public_usual_name(tmp_path):
    company_db = tmp_path / "companies.sqlite"
    connection = sqlite3.connect(company_db)
    connection.execute(
        "CREATE TABLE companies(siren TEXT PRIMARY KEY, legal_name TEXT NOT NULL, usual_name TEXT, administrative_status TEXT, workforce_band TEXT)"
    )
    connection.executemany(
        "INSERT INTO companies(siren,legal_name,usual_name,administrative_status,workforce_band) VALUES (?,?,?,?,?)",
        [
            ("100000001", "PETITE STRUCTURE", "Marque locale", "A", "01"),
            ("100000002", "GRANDE STRUCTURE", "Grand groupe", "A", "53"),
            ("100000003", "FERMEE", "Fermée", "C", "53"),
        ],
    )
    connection.commit()
    connection.close()

    targets = load_targets(company_db, [], 1, priority=True)
    assert targets == [("100000002", "Grand groupe")]
    assert load_targets(company_db, [], 1, priority=True, offset=1) == [("100000001", "Marque locale")]
