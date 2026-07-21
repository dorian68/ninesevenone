import re
import unicodedata


def normalize_address(value: str) -> str:
    compact = " ".join(value.strip().split())
    compact = unicodedata.normalize("NFKC", compact)
    compact = re.sub(r"\bSTE\b", "SAINTE", compact, flags=re.IGNORECASE)
    compact = re.sub(r"\bST\b", "SAINT", compact, flags=re.IGNORECASE)
    return compact.upper()
