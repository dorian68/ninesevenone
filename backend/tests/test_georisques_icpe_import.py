import sqlite3

from scripts.import_georisques_icpe import (
    build_index,
    normalized_siret,
    parse_payload,
    safe_document_url,
)


def company_db(path):
    db = sqlite3.connect(path)
    db.executescript("""
      CREATE TABLE companies (
        siren TEXT PRIMARY KEY, administrative_status TEXT, diffusion_status TEXT
      );
      CREATE TABLE establishments (
        siret TEXT PRIMARY KEY, administrative_status TEXT, diffusion_status TEXT
      );
      INSERT INTO companies VALUES ('123456789','A','O'), ('999999999','A','N');
      INSERT INTO establishments VALUES ('12345678900011','A','O'), ('12345678900029','F','O');
    """)
    db.commit()
    db.close()


def metadata():
    return {
        "api_title": "Services API Géorisques V1",
        "api_version": "1.12.2",
        "openapi_url": "https://www.georisques.gouv.fr/api/v3/api-docs/georisques-api-v1",
        "api_url": "https://www.georisques.gouv.fr/api/v1/installations_classees",
        "source_url": "https://www.georisques.gouv.fr/donnees/bases-de-donnees/installations-industrielles",
        "license_name": "Licence Ouverte 2.0",
        "license_url": "https://github.com/etalab/licence-ouverte/blob/master/LO.md",
        "department": "971",
    }


def source_row(siret="12345678900011", aiot="0006900001"):
    return {
        "raisonSociale": "Jean Dupont",
        "codeAIOT": aiot,
        "siret": siret,
        "adresse1": "Zone industrielle",
        "codePostal": "97122",
        "codeInsee": "97103",
        "commune": "Baie-Mahault",
        "regime": "Autorisation",
        "etatActivite": "En exploitation avec titre",
        "statutSeveso": "Non Seveso",
        "ied": True,
        "prioriteNationale": False,
        "date_maj": "2026-07-17/19-32-59",
        "inspections": [{
            "dateInspection": "2026-04-12T00:00:00Z",
            "fichierInspection": {
                "nomFichier": "rapport-nom-inspecteur.pdf",
                "typeFichier": "Rapport d'inspection",
                "dateFichier": "2026-04-13T00:00:00Z",
                "urlFichier": "/webappReport/ws/installations/inspection/public-id",
            },
        }],
        "rubriques": [{
            "numeroRubrique": "2910",
            "nature": "Installation de combustion",
            "alinea": "A-2",
            "regimeAutoriseAlinea": "Autorisation",
            "quantiteTotale": "12.5",
            "unite": "MW",
            "dateMotif": "2025-02-01",
        }],
        "documentsHorsInspection": [{
            "nomFichier": "arrete-prefectoral.pdf",
            "typeFichier": "Arrêté préfectoral",
            "dateFichier": "2025-02-02T00:00:00Z",
            "urlFichier": "https://www.georisques.gouv.fr/webappReport/ws/installations/document/public-id",
        }],
    }


def test_identifier_and_document_url_are_strict():
    assert normalized_siret("12345678900011") == "12345678900011"
    assert normalized_siret("123 456 789 00011") is None
    assert safe_document_url("/public/report") == "https://www.georisques.gouv.fr/public/report"
    assert safe_document_url("https://evil.example/report") is None


def test_parser_joins_exact_identifiers_and_drops_person_names(tmp_path):
    target = tmp_path / "companies.sqlite"
    company_db(target)
    payload = {
        "data": [source_row(), source_row("12345678900029", "0006900002"), source_row("99999999900011", "0006900003"), source_row("", "0006900004")]
    }
    rows, stats = parse_payload(payload, target)
    assert len(rows) == 2
    assert stats["active_siret_matches"] == 1
    assert stats["historical_siret_matches"] == 1
    assert stats["invalid_siret_rows"] == 1
    assert stats["out_of_scope_rows"] == 1
    assert rows[0]["source_updated_at"] == "2026-07-17T19:32:59Z"
    assert rows[0]["inspections"][0]["document_url"].startswith("https://www.georisques.gouv.fr/")
    assert "raisonSociale" not in rows[0]
    assert "source_name" not in rows[0]
    assert "nomFichier" not in rows[0]["inspections"][0]


def test_atomic_index_has_regulatory_details_without_person_columns(tmp_path):
    target = tmp_path / "companies.sqlite"
    company_db(target)
    rows, stats = parse_payload({"data": [source_row()]}, target)
    output = tmp_path / "icpe.sqlite"
    report = build_index(output, rows, metadata(), {"fetch": {}, "parse": stats})
    db = sqlite3.connect(output)
    columns = {row[1] for row in db.execute("PRAGMA table_info(icpe_installations)")}
    assert db.execute("SELECT COUNT(*) FROM icpe_installations").fetchone()[0] == 1
    assert db.execute("SELECT COUNT(*) FROM icpe_inspections").fetchone()[0] == 1
    assert db.execute("SELECT COUNT(*) FROM icpe_rubrics").fetchone()[0] == 1
    assert db.execute("SELECT COUNT(*) FROM icpe_documents").fetchone()[0] == 1
    assert db.execute("SELECT nature FROM icpe_rubrics").fetchone()[0] == "Installation de combustion"
    db.close()
    assert report["contains_source_person_names"] is False
    assert report["downloads_documents"] is False
    assert not {"source_name", "person_name", "email", "phone", "birth_date"} & columns
