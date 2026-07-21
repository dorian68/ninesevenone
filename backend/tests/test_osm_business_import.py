import sqlite3
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.import_osm_business_profiles import address, category, identifiers, public_email, write_database


def test_identifiers_keep_only_exact_administrative_references():
    assert identifiers({"ref:FR:SIRET": "49292021000019"}) == [("492920210", "49292021000019")]
    assert identifiers({"ref:FR:SIREN": "492920210"}) == [("492920210", "")]
    assert identifiers({"ref:FR:SIRET": "4929202100001"}) == []


def test_siret_takes_priority_over_redundant_siren():
    assert identifiers({
        "ref:FR:SIRET": "49292021000019",
        "ref:FR:SIREN": "492920210",
    }) == [("492920210", "49292021000019")]


def test_osm_tags_are_normalized_without_inventing_values():
    tags = {
        "shop": "clothes",
        "addr:housenumber": "12",
        "addr:street": "Rue du Port",
        "addr:city": "Basse-Terre",
    }
    assert category(tags) == ("shop", "clothes")
    assert address(tags) == "12 Rue du Port Basse-Terre"


def test_public_email_keeps_generic_mailboxes_and_rejects_named_mailboxes():
    assert public_email({"contact:email": "Contact@Example.gp"}) == "contact@example.gp"
    assert public_email({"email": "marie.dupont@example.gp"}) is None
    assert public_email({"contact:email": "named@example.gp, info@example.gp"}) == "info@example.gp"


def test_database_records_provenance_and_coverage(tmp_path):
    output = tmp_path / "osm.sqlite"
    row = {
        "element_type": "node", "osm_id": 1, "siren": "492920210",
        "siret": "49292021000019", "name": "Point publié", "brand": None,
        "operator_name": None, "category_key": "shop", "category_value": "clothes",
        "website": "https://example.com", "phone": None, "opening_hours": None,
        "wheelchair": None, "internet_access": None, "address": None,
        "description": None, "latitude": 15.99, "longitude": -61.73,
        "services_json": "{}", "social_json": "{}", "tags_json": "{}",
    }
    report = write_database([row], output, "2026-07-17")
    connection = sqlite3.connect(output)
    stored = connection.execute("SELECT siren, siret, source_reference_date FROM osm_business_profiles").fetchone()
    assert stored == ("492920210", "49292021000019", "2026-07-17")
    assert report["license"] == "ODbL 1.0"
    assert report["records"] == "1"
