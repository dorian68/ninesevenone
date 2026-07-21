import sqlite3

from scripts.import_ademe_financial_aids import aid_fingerprint, build_index, parse_aids


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


def test_ademe_parser_matches_only_exact_sirets_and_scopes_them(tmp_path):
    company_db = tmp_path / "companies.sqlite"
    company_database(company_db)
    source = tmp_path / "ademe.csv"
    source.write_text(
        "Nom de l attribuant,idAttribuant,dateConvention,referenceDecision,nomBeneficiaire,idBeneficiaire,objet,dispositifAide,montant,nature,conditionsVersement,datesPeriodeVersement,idRAE,notificationUE\n"
        "ADEME,38529030900454,2026-04-03,DEC-A,ENTREPRISE ACTIVE,12345678900010,Projet solaire,Fonds chaleur,25000,aide en numéraire,Unique,2026-05-01_2027-05-01,,false\n"
        "ADEME,38529030900454,2025-01-02,DEC-H,ENTREPRISE HISTORIQUE,98765432199999,Projet recyclage,Économie circulaire,12000,aide remboursable,Échelonné,2025-02-01_2028-01-01,,true\n"
        "ADEME,38529030900454,2025-01-02,DEC-X,AUTRE ENTREPRISE,11111111100011,Autre projet,,5000,aide en numéraire,Unique,2025-02-01,,false\n",
        encoding="utf-8",
    )
    aids, stats = parse_aids(source, company_db)
    assert stats["rows_read"] == 3
    assert stats["rows_matched"] == 2
    assert stats["active_siret_matches"] == 1
    assert stats["company_siret_matches"] == 1
    assert aids[0]["match_scope"] == "active_local_establishment"
    assert aids[1]["match_scope"] == "company_historical_establishment"
    assert aids[0]["amount"] == 25000
    assert aids[0]["eu_notification"] == 0


def test_ademe_fingerprint_is_stable_and_index_is_atomic(tmp_path):
    aid = {
        "source_row_number": 2,
        "siren": "123456789",
        "siret": "12345678900010",
        "match_scope": "active_local_establishment",
        "match_confidence": 1.0,
        "awarding_authority": "ADEME",
        "awarding_authority_siret": "38529030900454",
        "convention_date": "2026-04-03",
        "decision_reference": "DEC-A",
        "beneficiary_name": "ENTREPRISE ACTIVE",
        "purpose": "Projet solaire",
        "aid_scheme": "Fonds chaleur",
        "amount": 25000.0,
        "nature": "aide en numéraire",
        "payment_conditions": "Unique",
        "payment_period": "2026-05-01_2027-05-01",
        "rae_id": None,
        "eu_notification": 0,
    }
    aid["fingerprint"] = aid_fingerprint(aid)
    assert aid["fingerprint"] == aid_fingerprint(dict(aid))
    output = tmp_path / "ademe.sqlite"
    report = build_index([aid, aid], output, {
        "title": "Les aides financières de l'ADEME",
        "source_count": 2,
        "source_updated_at": "2026-07-18T07:00:20Z",
        "license_name": "Licence Ouverte / Open Licence",
        "license_url": "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
    }, {
        "rows_read": 2,
        "rows_with_valid_siret": 2,
        "rows_matched": 2,
        "active_siret_matches": 2,
        "company_siret_matches": 0,
        "invalid_rows": 0,
    }, False)
    connection = sqlite3.connect(output)
    count = connection.execute("SELECT COUNT(*) FROM ademe_financial_aids").fetchone()[0]
    columns = {row[1] for row in connection.execute("PRAGMA table_info(ademe_financial_aids)")}
    connection.close()
    assert count == 1
    assert report["matched_companies"] == 1
    assert report["active_local_committed_amount"] == 25000
    assert not {"email", "telephone", "director"} & columns
