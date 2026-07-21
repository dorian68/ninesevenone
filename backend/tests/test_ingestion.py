from app.ingestion.address import normalize_address
from app.ingestion.sirene_importer import SireneRow, is_in_scope


def test_normalize_address_expands_saint():
    assert normalize_address("  12 rue st john perse ") == "12 RUE SAINT JOHN PERSE"


def test_scope_filters_guadeloupe_department():
    row = SireneRow("971000001", "97100000100011", "DEMO", "97105", "97100", "6202A")
    assert is_in_scope(row)
