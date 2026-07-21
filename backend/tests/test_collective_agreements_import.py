import io
import json
import sqlite3
import tarfile

from scripts.import_collective_agreements import (
    build_index,
    idcc_status,
    kali_catalog,
    load_establishment_targets,
    normalized_idcc,
    parse_idcc_resource,
    parse_siro_resource,
    siro_reference_month,
)


def company_database(path):
    connection = sqlite3.connect(path)
    connection.execute(
        """CREATE TABLE establishments (
          siren TEXT, siret TEXT, commune TEXT, is_head_office INTEGER,
          employer TEXT, diffusion_status TEXT
        )"""
    )
    connection.executemany("INSERT INTO establishments VALUES (?,?,?,?,?,?)", [
        ("123456789", "12345678900010", "BAIE-MAHAULT", 1, "O", "O"),
        ("123456789", "12345678900028", "LES ABYMES", 0, "O", "O"),
        ("987654321", "98765432100019", "LE GOSIER", 1, "O", "P"),
    ])
    connection.commit()
    connection.close()


def resource(identifier, title, url="https://example.test/source.csv"):
    return {
        "id": identifier, "title": title, "url": url,
        "last_modified": "2026-07-16T10:23:14+02:00",
    }


def metadata():
    base = {
        "source_updated_at": "2026-07-16T10:23:14+02:00",
        "license_name": "Licence Ouverte 2.0",
        "license_url": "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
    }
    return {
        "idcc": {**base, "resource": resource("idcc-resource", "SIRET IDCC")},
        "siro": {**base, "resource": resource("siro-resource", "SIRO_202604.csv")},
        "kali": {
            "version": "3.479.0", "source_updated_at": "2026-07-18T13:47:11Z",
            "license_name": "Apache-2.0", "project_url": "https://github.com/SocialGouv/kali-data",
        },
    }


def kali_archive(path):
    payload = {
        "type": "convention collective",
        "data": {
            "num": 1486, "id": "KALICONT000005635534",
            "title": "Convention collective nationale des bureaux d'études techniques",
            "shortTitle": "Bureaux d'études techniques",
            "categorisation": ["Conseil"],
        },
        "children": [{
            "type": "section",
            "data": {"title": "Texte de base : Convention", "etat": "VIGUEUR_ETEN"},
        }],
    }
    raw = json.dumps(payload).encode("utf-8")
    with tarfile.open(path, "w:gz") as archive:
        info = tarfile.TarInfo("package/data/KALICONT000005635534.json")
        info.size = len(raw)
        archive.addfile(info, io.BytesIO(raw))


def test_idcc_normalization_and_escape_semantics():
    assert normalized_idcc("18  ") == "0018"
    assert normalized_idcc("1486") == "1486"
    assert normalized_idcc("ABCDE") is None
    assert idcc_status("1486") == "declared_code"
    assert idcc_status("9999") == "no_collective_agreement"
    assert idcc_status("9998") == "agreement_not_known"
    assert idcc_status(None) == "missing"
    assert siro_reference_month("SIRO_202604.csv") == "2026-04"


def test_kali_catalog_keeps_metadata_without_article_content(tmp_path):
    archive = tmp_path / "kali.tgz"
    kali_archive(archive)
    catalog, stats = kali_catalog(archive, metadata()["kali"])
    assert stats["catalog_count"] == 1
    assert catalog[0]["idcc"] == "1486"
    assert catalog[0]["short_title"] == "Bureaux d'études techniques"
    assert catalog[0]["base_text_status"] == "VIGUEUR_ETEN"
    assert "children" not in catalog[0]
    assert "article" not in catalog[0]


def test_parsers_keep_multiple_idcc_and_exclude_restricted_sirets(tmp_path):
    company_db = tmp_path / "companies.sqlite"
    company_database(company_db)
    targets = load_establishment_targets(company_db)
    idcc_csv = tmp_path / "idcc.csv"
    idcc_csv.write_text(
        "MOIS,SIRET,IDCC,DATE_MAJ\n"
        "2026-05,12345678900010,1486  ,2026/06/29\n"
        "2026-05,12345678900010,9999  ,2026/06/29\n"
        "2026-05,98765432100019,1516  ,2026/06/29\n",
        encoding="utf-8",
    )
    siro_csv = tmp_path / "siro.csv"
    siro_csv.write_text(
        "SIRET|IDCC|OPCO_PROPRIETAIRE|OPCO_GESTION\n"
        "12345678900010|1486|ATLAS|AKTO\n"
        "12345678900028|||\n"
        "98765432100019|1516|AKTO|\n",
        encoding="utf-8",
    )
    agreements, idcc_stats = parse_idcc_resource(idcc_csv, resource("idcc", "SIRET IDCC"), targets)
    assignments, siro_stats = parse_siro_resource(siro_csv, resource("siro", "SIRO_202604.csv"), targets)
    assert len(agreements) == 2
    assert {item["idcc"] for item in agreements} == {"1486", "9999"}
    assert idcc_stats["restricted_rows"] == 1
    assert len(assignments) == 2
    assert assignments[0]["owner_opco"] == "ATLAS"
    assert assignments[0]["managing_opco"] == "AKTO"
    assert assignments[1]["assignment_status"] == "declaration_anomaly"
    assert siro_stats["restricted_rows"] == 1


def test_atomic_index_deduplicates_and_reports_cross_source_differences(tmp_path):
    company_db = tmp_path / "companies.sqlite"
    company_database(company_db)
    targets = load_establishment_targets(company_db)
    idcc_csv = tmp_path / "idcc.csv"
    idcc_csv.write_text(
        "MOIS,SIRET,IDCC,DATE_MAJ\n2026-05,12345678900010,1486,2026/06/29\n",
        encoding="utf-8",
    )
    siro_csv = tmp_path / "siro.csv"
    siro_csv.write_text(
        "SIRET|IDCC|OPCO_PROPRIETAIRE|OPCO_GESTION\n12345678900010|1516|AKTO|\n",
        encoding="utf-8",
    )
    agreements, idcc_stats = parse_idcc_resource(idcc_csv, resource("idcc", "SIRET IDCC"), targets)
    assignments, siro_stats = parse_siro_resource(siro_csv, resource("siro", "SIRO_202604.csv"), targets)
    archive = tmp_path / "kali.tgz"
    kali_archive(archive)
    catalog, catalog_stats = kali_catalog(archive, metadata()["kali"])
    output = tmp_path / "agreements.sqlite"
    report = build_index(
        agreements + agreements, assignments + assignments, catalog,
        output, metadata(), {"idcc": idcc_stats, "siro": siro_stats, "catalog": catalog_stats}, 3,
    )
    connection = sqlite3.connect(output)
    assert connection.execute("SELECT COUNT(*) FROM establishment_collective_agreements").fetchone()[0] == 1
    assert connection.execute("SELECT COUNT(*) FROM establishment_opco_assignments").fetchone()[0] == 1
    columns = {row[1] for row in connection.execute("PRAGMA table_info(establishment_opco_assignments)")}
    connection.close()
    assert report["cross_source_idcc_difference_count"] == 1
    assert report["agreements_with_kali_title"] == 1
    assert not {"employee_name", "salary", "email", "telephone"} & columns
