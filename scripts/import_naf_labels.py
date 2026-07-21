"""Download and normalize the official INSEE NAF rev. 2 short-code labels."""

from __future__ import annotations

import argparse
import json
import re
from io import BytesIO
from pathlib import Path
from urllib.request import Request, urlopen

import pandas as pd


SOURCE_URL = "https://www.insee.fr/fr/statistiques/fichier/2120875/int_courts_naf_rev_2.xls"
SOURCE_REFERENCE_DATE = "2021-03-08"
CODE_PATTERN = re.compile(r"^\d{2}\.\d{2}[A-Z]$")


def normalize_code(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip().upper()


def build_payload(content: bytes) -> dict[str, object]:
    frame = pd.read_excel(BytesIO(content), sheet_name=0, header=0, engine="xlrd")
    labels: dict[str, str] = {}
    columns = {str(column).strip(): column for column in frame.columns}
    code_column = columns["Code"]
    label_column = columns["Intitulés de la  NAF rév. 2, version finale"]
    for _, row in frame.iterrows():
        code = normalize_code(row.get(code_column))
        label = str(row.get(label_column) or "").strip()
        if CODE_PATTERN.fullmatch(code) and label:
            labels[code] = label
    return {
        "version": "NAF rév. 2 (2008)",
        "source": "INSEE",
        "source_url": SOURCE_URL,
        "source_reference_date": SOURCE_REFERENCE_DATE,
        "label_count": len(labels),
        "labels": dict(sorted(labels.items())),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("data/naf-rev2-labels.json"))
    args = parser.parse_args()

    request = Request(SOURCE_URL, headers={"User-Agent": "Guadeloupe-Entreprises-BI/0.3"})
    with urlopen(request, timeout=30) as response:
        payload = build_payload(response.read())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{payload['label_count']} labels NAF écrits dans {args.output}")


if __name__ == "__main__":
    main()
