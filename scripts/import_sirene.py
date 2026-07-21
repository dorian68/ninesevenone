"""Import SIRENE rows into the production database.

This file intentionally contains only the resumable command skeleton. Real imports must
be run with an authorized source export or API token and must persist DataImportRun
metrics before publication.
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", type=Path, required=True)
    parser.add_argument("--department", default="971")
    args = parser.parse_args()

    rows_read = 0
    rows_in_scope = 0
    with args.csv.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            rows_read += 1
            code_commune = row.get("codeCommuneEtablissement") or ""
            if code_commune.startswith(args.department):
                rows_in_scope += 1

    print({"rows_read": rows_read, "rows_in_scope": rows_in_scope, "status": "dry_run"})


if __name__ == "__main__":
    main()
