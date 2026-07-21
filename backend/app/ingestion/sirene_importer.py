from dataclasses import dataclass


GUADELOUPE_DEPARTMENT_CODES = {"971"}


@dataclass(frozen=True)
class SireneRow:
    siren: str
    siret: str
    denomination: str
    code_commune: str
    code_postal: str | None
    code_naf: str | None


def is_in_scope(row: SireneRow, department_codes: set[str] | None = None) -> bool:
    codes = department_codes or GUADELOUPE_DEPARTMENT_CODES
    return any(row.code_commune.startswith(code) for code in codes)


class SireneImporter:
    """Idempotent importer skeleton. Real runs stream source rows and upsert by SIREN/SIRET."""

    def __init__(self, department_codes: set[str] | None = None) -> None:
        self.department_codes = department_codes or GUADELOUPE_DEPARTMENT_CODES

    def filter_rows(self, rows: list[SireneRow]) -> list[SireneRow]:
        return [row for row in rows if is_in_scope(row, self.department_codes)]
