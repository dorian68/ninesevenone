"""Build an exact RNA enrichment index for Guadeloupe legal units.

Only association-level public fields are selected. Personal, management-address,
email and phone fields present in the national file are deliberately excluded.
"""

from __future__ import annotations

import argparse
from collections import Counter
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import duckdb
import pyarrow as pa
import requests


ROOT = Path(__file__).resolve().parents[1]
DATASET_API = "https://www.data.gouv.fr/api/1/datasets/rna-agrege-a-lechelle-nationale/"
DATASET_PAGE = "https://www.data.gouv.fr/datasets/rna-agrege-a-lechelle-nationale"
DEFAULT_COMPANY_DB = ROOT / "data/guadeloupe-enterprises.sqlite"
DEFAULT_SOURCE_FILE = ROOT / "data/imports/rna-waldec.parquet"
DEFAULT_OUTPUT = ROOT / "data/rna-association-profiles.sqlite"
USER_AGENT = "guadeloupe-entreprises-rna-import/0.1"


def compact_text(value: object, limit: int = 5_000) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = re.sub(r"\s+", " ", value).strip()
    if not cleaned:
        return None
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[:limit].rsplit(" ", 1)[0].rstrip(" ,;:-") + "…"


def normalized_date(value: object) -> str | None:
    text = compact_text(value, 32)
    if not text or text.startswith("0001-01-01"):
        return None
    match = re.match(r"^(\d{4}-\d{2}-\d{2})", text)
    return match.group(1) if match else None


def public_website(value: object, publication_flag: object) -> str | None:
    allowed = str(publication_flag or "").strip().upper() in {"1", "O", "OUI", "Y", "YES", "TRUE"}
    raw = compact_text(value, 500)
    if not allowed or not raw:
        return None
    candidate = raw if re.match(r"^https?://", raw, flags=re.IGNORECASE) else f"https://{raw}"
    try:
        parsed = urlsplit(candidate)
    except ValueError:
        return None
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        return None
    return urlunsplit((parsed.scheme.lower(), parsed.netloc, parsed.path or "", parsed.query, ""))


def latest_waldec_resource() -> dict[str, object]:
    response = requests.get(DATASET_API, headers={"User-Agent": USER_AGENT}, timeout=30)
    response.raise_for_status()
    dataset = response.json()
    candidates = [
        resource for resource in dataset.get("resources", [])
        if resource.get("format") == "parquet" and "waldec" in str(resource.get("title", "")).lower()
    ]
    if not candidates:
        raise RuntimeError("Aucune ressource WALDEC parquet publiée")
    resource = max(candidates, key=lambda item: str(item.get("last_modified") or ""))
    return {
        "dataset_id": dataset.get("id"),
        "dataset_title": dataset.get("title"),
        "dataset_last_modified": dataset.get("last_modified"),
        "license": dataset.get("license"),
        "resource_id": resource.get("id"),
        "resource_title": resource.get("title"),
        "resource_url": resource.get("url"),
        "resource_size": resource.get("filesize"),
        "resource_last_modified": resource.get("last_modified"),
    }


def download(resource: dict[str, object], target: Path) -> None:
    url = str(resource["resource_url"])
    expected = int(resource.get("resource_size") or 0)
    if target.exists() and expected and target.stat().st_size == expected:
        print(f"Parquet RNA déjà présent: {target}", flush=True)
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(target.suffix + ".part")
    downloaded = partial.stat().st_size if partial.exists() else 0
    headers = {"User-Agent": USER_AGENT}
    if downloaded:
        headers["Range"] = f"bytes={downloaded}-"
    with requests.get(url, headers=headers, stream=True, timeout=(30, 180)) as response:
        if downloaded and response.status_code != 206:
            downloaded = 0
            partial.unlink(missing_ok=True)
        response.raise_for_status()
        mode = "ab" if downloaded else "wb"
        next_report = downloaded + 32 * 1024 * 1024
        with partial.open(mode) as output:
            for chunk in response.iter_content(1024 * 1024):
                if not chunk:
                    continue
                output.write(chunk)
                downloaded += len(chunk)
                if downloaded >= next_report:
                    print(f"RNA téléchargé: {downloaded / 1024**2:.1f} Mio", flush=True)
                    next_report = downloaded + 32 * 1024 * 1024
    if expected and downloaded != expected:
        raise IOError(f"Taille RNA inattendue: {downloaded} octets au lieu de {expected}")
    partial.replace(target)


def target_associations(company_db: Path) -> list[tuple[str, str]]:
    connection = sqlite3.connect(company_db)
    rows = connection.execute(
        "SELECT siren, association_id FROM companies WHERE association_id IS NOT NULL ORDER BY association_id"
    ).fetchall()
    connection.close()
    return [
        (str(siren), normalized)
        for siren, rna_id in rows
        if re.fullmatch(r"W[A-Z0-9]{9}", normalized := str(rna_id).strip().upper())
    ]


def extract_rows(source_file: Path, targets: list[tuple[str, str]]) -> list[dict[str, object]]:
    target_table = pa.table({
        "siren": pa.array([row[0] for row in targets], type=pa.string()),
        "id": pa.array([row[1] for row in targets], type=pa.string()),
    })
    connection = duckdb.connect()
    connection.register("target_associations", target_table)
    query = """
      SELECT
        target.siren,
        rna.id AS rna_id,
        rna.id_ex AS former_id,
        rna.siret,
        rna.rup_mi AS public_utility_id,
        rna.date_creat AS creation_date,
        rna.date_decla AS declaration_date,
        rna.date_publi AS publication_date,
        rna.date_disso AS dissolution_date,
        rna.nature AS nature_code,
        rna.groupement AS group_type,
        rna.titre AS title,
        rna.titre_court AS short_title,
        rna.objet AS purpose,
        rna.objet_social1 AS purpose_code_1,
        rna.objet_social2 AS purpose_code_2,
        rna.siteweb AS website,
        rna.publiweb AS website_publication_flag,
        rna.position AS position_code,
        rna.maj_time AS updated_at
      FROM read_parquet(?) rna
      INNER JOIN target_associations target USING (id)
    """
    rows = connection.execute(query, [str(source_file)]).to_arrow_table().to_pylist()
    connection.close()
    return rows


def identifier_status(siren: str, siret: str | None) -> tuple[str, float]:
    if not siret:
        return "rna_exact_no_siret", 0.95
    if re.fullmatch(r"\d{14}", siret) and siret.startswith(siren):
        return "rna_exact_siret_match", 1.0
    return "rna_exact_siret_mismatch", 0.8


def build_index(rows: list[dict[str, object]], output: Path, resource: dict[str, object], target_count: int) -> dict[str, object]:
    partial = output.with_suffix(output.suffix + ".part")
    partial.unlink(missing_ok=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(partial)
    connection.executescript("""
      CREATE TABLE association_profiles (
        rna_id TEXT NOT NULL,
        siren TEXT NOT NULL,
        former_id TEXT,
        siret TEXT,
        identifier_status TEXT NOT NULL,
        match_confidence REAL NOT NULL,
        public_utility_id TEXT,
        creation_date TEXT,
        declaration_date TEXT,
        publication_date TEXT,
        dissolution_date TEXT,
        nature_code TEXT,
        group_type TEXT,
        title TEXT,
        short_title TEXT,
        purpose TEXT,
        purpose_code_1 TEXT,
        purpose_code_2 TEXT,
        website TEXT,
        website_publication_authorized INTEGER NOT NULL,
        position_code TEXT,
        updated_at TEXT,
        source_reference_date TEXT NOT NULL,
        source_url TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        PRIMARY KEY (siren, rna_id)
      );
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX association_profiles_siren_idx ON association_profiles(siren);
      CREATE INDEX association_profiles_rna_idx ON association_profiles(rna_id);
      CREATE INDEX association_profiles_position_idx ON association_profiles(position_code);
      CREATE INDEX association_profiles_purpose_1_idx ON association_profiles(purpose_code_1);
    """)
    imported_at = datetime.now(timezone.utc).isoformat()
    resource_modified = str(resource.get("resource_last_modified") or "")
    reference_date = resource_modified[:10] if re.match(r"^\d{4}-\d{2}-\d{2}", resource_modified) else "date non renseignée"
    counts = {
        "matched": 0,
        "purposes": 0,
        "websites": 0,
        "public_utility": 0,
        "dissolved_positions": 0,
        "dissolution_dates": 0,
        "status_conflicts": 0,
        "siret_matches": 0,
        "siret_mismatches": 0,
        "rna_shared_across_sirens": sum(1 for value in Counter(str(row.get("rna_id")) for row in rows).values() if value > 1),
    }
    for row in rows:
        siren = str(row.get("siren") or "")
        siret = compact_text(row.get("siret"), 14)
        match_status, confidence = identifier_status(siren, siret)
        website = public_website(row.get("website"), row.get("website_publication_flag"))
        purpose = compact_text(row.get("purpose"))
        public_utility_id = compact_text(row.get("public_utility_id"), 32)
        position = compact_text(row.get("position_code"), 4)
        connection.execute(
            """INSERT INTO association_profiles (
              rna_id, siren, former_id, siret, identifier_status, match_confidence,
              public_utility_id, creation_date, declaration_date, publication_date,
              dissolution_date, nature_code, group_type, title, short_title, purpose,
              purpose_code_1, purpose_code_2, website, website_publication_authorized,
              position_code, updated_at, source_reference_date, source_url, imported_at
            ) VALUES (
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )""",
            (
                row.get("rna_id"), siren, compact_text(row.get("former_id"), 32), siret,
                match_status, confidence, public_utility_id,
                normalized_date(row.get("creation_date")), normalized_date(row.get("declaration_date")),
                normalized_date(row.get("publication_date")), normalized_date(row.get("dissolution_date")),
                compact_text(row.get("nature_code"), 4), compact_text(row.get("group_type"), 4),
                compact_text(row.get("title"), 500), compact_text(row.get("short_title"), 100), purpose,
                compact_text(row.get("purpose_code_1"), 16), compact_text(row.get("purpose_code_2"), 16),
                website, int(website is not None), position, compact_text(row.get("updated_at"), 64),
                reference_date, DATASET_PAGE, imported_at,
            ),
        )
        counts["matched"] += 1
        counts["purposes"] += int(purpose is not None)
        counts["websites"] += int(website is not None)
        counts["public_utility"] += int(public_utility_id is not None)
        dissolution_date = normalized_date(row.get("dissolution_date"))
        counts["dissolved_positions"] += int(position == "D")
        counts["dissolution_dates"] += int(dissolution_date is not None)
        counts["status_conflicts"] += int(position == "A" and dissolution_date is not None)
        counts["siret_matches"] += int(match_status == "rna_exact_siret_match")
        counts["siret_mismatches"] += int(match_status == "rna_exact_siret_mismatch")

    metadata = {
        "source": "Répertoire national des associations - Ministère de l'Intérieur",
        "source_url": DATASET_PAGE,
        "source_reference_date": reference_date,
        "resource_id": str(resource.get("resource_id") or ""),
        "resource_url": str(resource.get("resource_url") or ""),
        "resource_last_modified": str(resource.get("resource_last_modified") or ""),
        "license": "Licence Ouverte 2.0",
        "imported_at": imported_at,
        "target_count": str(target_count),
        **{key: str(value) for key, value in counts.items()},
        "personal_fields_selected": "false",
    }
    connection.executemany("INSERT INTO metadata(key, value) VALUES (?, ?)", metadata.items())
    connection.commit()
    connection.execute("ANALYZE")
    connection.close()
    partial.replace(output)
    report: dict[str, object] = {**metadata, **counts, "unmatched": target_count - counts["matched"], "database": str(output)}
    output.with_suffix(".report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--company-db", type=Path, default=DEFAULT_COMPANY_DB)
    parser.add_argument("--source-file", type=Path, default=DEFAULT_SOURCE_FILE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--skip-download", action="store_true")
    args = parser.parse_args()
    resource = latest_waldec_resource()
    if not args.skip_download:
        download(resource, args.source_file)
    if not args.source_file.exists():
        raise SystemExit(f"Source RNA absente: {args.source_file}")
    targets = target_associations(args.company_db)
    rows = extract_rows(args.source_file, targets)
    print(json.dumps(build_index(rows, args.output, resource, len(targets)), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
