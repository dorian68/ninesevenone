"""Index the official public list of training organizations by exact SIREN/SIRET.

Only professional identifiers, current published quality categories, declared
training specialties and aggregate BPF activity are retained. Names, street
addresses, contacts and represented foreign organizations are excluded.
"""

from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
from hashlib import sha256
import io
import json
from pathlib import Path
import re
import sqlite3

import requests

try:
    from scripts.import_public_grants import compact_text, load_targets, normalize_header
except ModuleNotFoundError:  # Direct execution with scripts/ as sys.path[0].
    from import_public_grants import compact_text, load_targets, normalize_header  # type: ignore[no-redef]


ROOT = Path(__file__).resolve().parents[1]
DATASET_ID = "liste-publique-des-organismes-de-formation-l-6351-7-1-du-code-du-travail"
DATASET_API = f"https://www.data.gouv.fr/api/1/datasets/{DATASET_ID}/"
DATASET_URL = f"https://www.data.gouv.fr/datasets/{DATASET_ID}"
LICENSE_NAME = "Licence Ouverte"
LICENSE_URL = "https://www.etalab.gouv.fr/licence-ouverte-open-licence/"
DEFAULT_COMPANY_DB = ROOT / "data/guadeloupe-enterprises.sqlite"
DEFAULT_CACHE_DIR = ROOT / "data/imports/training-organizations"
DEFAULT_OUTPUT = ROOT / "data/training-organizations.sqlite"
USER_AGENT = "guadeloupe-entreprises-training-organizations/0.1 (+public open-data reuse)"
MAX_DOWNLOAD_BYTES = 80 * 1024 * 1024
RESOURCE_TITLE = "Liste publique des Organismes de Formation (format CSV)"


def source_metadata(session: requests.Session) -> dict[str, object]:
    response = session.get(DATASET_API, timeout=30)
    response.raise_for_status()
    payload = response.json()
    resource = next(
        (
            item for item in payload.get("resources", [])
            if isinstance(item, dict)
            and str(item.get("title") or "") == RESOURCE_TITLE
            and str(item.get("format") or "").lower() == "csv"
        ),
        None,
    )
    if resource is None:
        raise RuntimeError("Ressource CSV de la Liste publique OF introuvable")
    if str(payload.get("license") or "").lower() not in {"fr-lo", "lov2"}:
        raise RuntimeError("Licence ouverte de la Liste publique OF non confirmée")
    return {
        "dataset_id": str(payload.get("id") or DATASET_ID),
        "title": compact_text(payload.get("title"), 500),
        "source_updated_at": str(payload.get("last_update") or payload.get("last_modified") or ""),
        "license_code": str(payload.get("license") or ""),
        "license_name": LICENSE_NAME,
        "license_url": LICENSE_URL,
        "resource": {
            "id": str(resource.get("id") or ""),
            "title": str(resource.get("title") or RESOURCE_TITLE),
            "url": str(resource.get("url") or ""),
            "last_modified": str(resource.get("last_modified") or ""),
        },
    }


def download_resource(
    session: requests.Session,
    resource: dict[str, object],
    cache_dir: Path,
    refresh: bool,
) -> tuple[Path, bool]:
    resource_id = str(resource["id"])
    target = cache_dir / f"{resource_id}.csv"
    sidecar = cache_dir / f"{resource_id}.metadata.json"
    signature = {"url": resource.get("url"), "last_modified": resource.get("last_modified")}
    if not refresh and target.exists() and sidecar.exists():
        try:
            if json.loads(sidecar.read_text(encoding="utf-8")) == signature and target.stat().st_size > 0:
                return target, False
        except (OSError, json.JSONDecodeError):
            pass
    cache_dir.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(".csv.part")
    partial.unlink(missing_ok=True)
    downloaded = 0
    prefix = b""
    with session.get(str(resource["url"]), stream=True, timeout=(30, 180)) as response:
        response.raise_for_status()
        with partial.open("wb") as output:
            for chunk in response.iter_content(256 * 1024):
                if not chunk:
                    continue
                if not prefix:
                    prefix = chunk[:512].lstrip().lower()
                    if prefix.startswith((b"<!doctype html", b"<html")):
                        raise ValueError("La ressource Liste publique OF renvoie du HTML")
                downloaded += len(chunk)
                if downloaded > MAX_DOWNLOAD_BYTES:
                    partial.unlink(missing_ok=True)
                    raise ValueError("Ressource Liste publique OF trop volumineuse")
                output.write(chunk)
    partial.replace(target)
    sidecar.write_text(json.dumps(signature, ensure_ascii=False, indent=2), encoding="utf-8")
    return target, True


def decoded_csv(path: Path) -> tuple[str, str]:
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "cp1252", "latin1"):
        try:
            return raw.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    raise ValueError(f"Encodage CSV non reconnu: {path}")


def source_text(value: object, limit: int = 1_000) -> str | None:
    result = compact_text(value, limit)
    if not result or normalize_header(result) in {"null", "none", "nan", "nr", "nonrenseigne"}:
        return None
    return result


def normalized_business_identifier(siren_value: object, siret_value: object) -> tuple[str | None, str | None]:
    siren_digits = re.sub(r"\D", "", source_text(siren_value, 64) or "")
    siret_digits = re.sub(r"\D", "", source_text(siret_value, 64) or "")
    siren = siren_digits if len(siren_digits) == 9 else None
    siret = siret_digits if len(siret_digits) == 14 else None
    if not siren and siret:
        siren = siret[:9]
    if siren and siret and siret[:9] != siren:
        return None, None
    return siren, siret


def normalized_activity_number(value: object) -> str | None:
    digits = re.sub(r"\D", "", source_text(value, 64) or "")
    return digits if len(digits) == 11 else None


def normalized_previous_activity_numbers(value: object, current: str) -> str | None:
    raw = source_text(value, 1_000)
    if not raw:
        return None
    numbers: list[str] = []
    for candidate in re.findall(r"(?<!\d)\d{11}(?!\d)", raw):
        if candidate != current and candidate not in numbers:
            numbers.append(candidate)
    return ", ".join(numbers) or None


def parse_boolean(value: object) -> bool | None:
    raw = source_text(value, 20)
    if not raw:
        return None
    normalized = normalize_header(raw)
    if normalized in {"true", "1", "oui", "o", "yes"}:
        return True
    if normalized in {"false", "0", "non", "n", "no"}:
        return False
    return None


def parse_nonnegative_integer(value: object) -> int | None:
    raw = source_text(value, 40)
    if not raw:
        return None
    normalized = raw.replace(" ", "").replace("\u00a0", "")
    if not re.fullmatch(r"\d+", normalized):
        return None
    result = int(normalized)
    return result if result >= 0 else None


def parse_date(value: object) -> str | None:
    raw = source_text(value, 30)
    if not raw:
        return None
    for pattern in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, pattern).date().isoformat()
        except ValueError:
            continue
    return None


def training_location_scope(postal_code: str | None, region_code: str | None) -> str:
    if (postal_code or "").startswith("971") or region_code == "01":
        return "guadeloupe"
    if postal_code or region_code:
        return "outside_guadeloupe"
    return "unknown"


def profile_fingerprint(profile: dict[str, object]) -> str:
    stable = (
        profile.get("siren"), profile.get("siret"), profile.get("activity_declaration_number"),
        profile.get("exercise_end_date"), profile.get("last_declaration_date"),
    )
    return sha256("|".join(str(value or "").casefold() for value in stable).encode("utf-8")).hexdigest()


def parse_resource(
    path: Path,
    resource: dict[str, object],
    company_db: Path,
) -> tuple[list[dict[str, object]], dict[str, object]]:
    targets = load_targets(company_db)
    text, encoding = decoded_csv(path)
    csv.field_size_limit(2 * 1024 * 1024)
    reader = csv.DictReader(io.StringIO(text, newline=""), delimiter=";")
    headers = {normalize_header(value) for value in reader.fieldnames or []}
    required = {
        "numerodeclarationactivite", "siren", "siretetablissementdeclarant",
        "certificationsactionsdeformation", "informationsdeclareesdatedernieredeclaration",
        "informationsdeclareesspecialitesdeformationcodespecialite1",
    }
    if not required.issubset(headers):
        raise ValueError(f"Colonnes Liste publique OF manquantes: {sorted(required - headers)}")
    stats: dict[str, object] = {
        "resource_id": resource["id"], "resource_title": resource["title"],
        "encoding": encoding, "delimiter": ";", "rows_read": 0,
        "rows_with_valid_identifier": 0, "rows_matched": 0,
        "invalid_identifier_rows": 0, "invalid_activity_number_rows": 0,
        "active_local_siret_matches": 0, "company_establishment_matches": 0,
        "exact_siren_matches": 0, "guadeloupe_registration_matches": 0,
        "outside_guadeloupe_registration_matches": 0, "unknown_location_matches": 0,
        "qualiopi_matches": 0, "matches_with_specialty": 0,
        "matches_with_activity_metrics": 0,
    }
    profiles: list[dict[str, object]] = []
    for row_number, raw_row in enumerate(reader, start=2):
        stats["rows_read"] = int(stats["rows_read"]) + 1
        row = {normalize_header(key): value for key, value in raw_row.items() if key is not None}
        siren, siret = normalized_business_identifier(row.get("siren"), row.get("siretetablissementdeclarant"))
        if not siren:
            stats["invalid_identifier_rows"] = int(stats["invalid_identifier_rows"]) + 1
            continue
        stats["rows_with_valid_identifier"] = int(stats["rows_with_valid_identifier"]) + 1
        if siren not in targets.company_sirens:
            continue
        activity_number = normalized_activity_number(row.get("numerodeclarationactivite"))
        if not activity_number:
            stats["invalid_activity_number_rows"] = int(stats["invalid_activity_number_rows"]) + 1
            continue
        if siret in targets.active_sirets:
            match_scope, confidence = "active_local_establishment", 1.0
            stats["active_local_siret_matches"] = int(stats["active_local_siret_matches"]) + 1
        elif siret:
            match_scope, confidence = "company_other_establishment", 0.98
            stats["company_establishment_matches"] = int(stats["company_establishment_matches"]) + 1
        else:
            match_scope, confidence = "exact_legal_unit", 0.99
            stats["exact_siren_matches"] = int(stats["exact_siren_matches"]) + 1
        postal_code = source_text(row.get("adressephysiqueorganismeformationcodepostal"), 20)
        region_code = source_text(row.get("adressephysiqueorganismeformationcoderegion"), 10)
        location_scope = training_location_scope(postal_code, region_code)
        location_stat = {
            "guadeloupe": "guadeloupe_registration_matches",
            "outside_guadeloupe": "outside_guadeloupe_registration_matches",
            "unknown": "unknown_location_matches",
        }[location_scope]
        stats[location_stat] = int(stats[location_stat]) + 1
        quality_training = parse_boolean(row.get("certificationsactionsdeformation"))
        quality_skills = parse_boolean(row.get("certificationsbilansdecompetences"))
        quality_vae = parse_boolean(row.get("certificationsvae"))
        quality_apprenticeship = parse_boolean(row.get("certificationsactionsdeformationparapprentissage"))
        is_quality_certified = any(value is True for value in (quality_training, quality_skills, quality_vae, quality_apprenticeship))
        if is_quality_certified:
            stats["qualiopi_matches"] = int(stats["qualiopi_matches"]) + 1
        specialty_values: list[tuple[str | None, str | None]] = []
        for index in range(1, 4):
            specialty_values.append((
                source_text(row.get(f"informationsdeclareesspecialitesdeformationcodespecialite{index}"), 20),
                source_text(row.get(f"informationsdeclareesspecialitesdeformationlibellespecialite{index}"), 500),
            ))
        if any(code or label for code, label in specialty_values):
            stats["matches_with_specialty"] = int(stats["matches_with_specialty"]) + 1
        trainee_count = parse_nonnegative_integer(row.get("informationsdeclareesnbstagiaires"))
        entrusted_trainee_count = parse_nonnegative_integer(row.get("informationsdeclareesnbstagiairesconfiesparunautreof"))
        trainer_count = parse_nonnegative_integer(row.get("informationsdeclareeseffectifformateurs"))
        if any(value is not None for value in (trainee_count, entrusted_trainee_count, trainer_count)):
            stats["matches_with_activity_metrics"] = int(stats["matches_with_activity_metrics"]) + 1
        profile: dict[str, object] = {
            "source_row_number": row_number,
            "siren": siren,
            "siret": siret,
            "match_scope": match_scope,
            "match_confidence": confidence,
            "registration_location_scope": location_scope,
            "activity_declaration_number": activity_number,
            "previous_activity_numbers": normalized_previous_activity_numbers(
                row.get("numerosdeclarationactiviteprecedent"), activity_number
            ),
            "postal_code": postal_code,
            "city": source_text(row.get("adressephysiqueorganismeformationville"), 200),
            "region_code": region_code,
            "quality_training": quality_training,
            "quality_skills_assessment": quality_skills,
            "quality_vae": quality_vae,
            "quality_apprenticeship": quality_apprenticeship,
            "is_quality_certified": is_quality_certified,
            "last_declaration_date": parse_date(row.get("informationsdeclareesdatedernieredeclaration")),
            "exercise_start_date": parse_date(row.get("informationsdeclareesdebutexercice")),
            "exercise_end_date": parse_date(row.get("informationsdeclareesfinexercice")),
            "specialty_code_1": specialty_values[0][0],
            "specialty_label_1": specialty_values[0][1],
            "specialty_code_2": specialty_values[1][0],
            "specialty_label_2": specialty_values[1][1],
            "specialty_code_3": specialty_values[2][0],
            "specialty_label_3": specialty_values[2][1],
            "trainee_count": trainee_count,
            "entrusted_trainee_count": entrusted_trainee_count,
            "trainer_count": trainer_count,
            "resource_id": resource["id"],
            "resource_title": resource["title"],
            "resource_url": resource["url"],
            "resource_last_modified": resource.get("last_modified") or None,
        }
        profile["fingerprint"] = profile_fingerprint(profile)
        profiles.append(profile)
        stats["rows_matched"] = int(stats["rows_matched"]) + 1
    return profiles, stats


def build_index(
    profiles: list[dict[str, object]],
    output: Path,
    metadata: dict[str, object],
    stats: dict[str, object],
    downloaded: bool,
) -> dict[str, object]:
    partial = output.with_suffix(output.suffix + ".part")
    partial.unlink(missing_ok=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(partial)
    connection.executescript("""
      CREATE TABLE training_organization_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fingerprint TEXT NOT NULL UNIQUE,
        source_row_number INTEGER NOT NULL,
        siren TEXT NOT NULL,
        siret TEXT,
        match_scope TEXT NOT NULL,
        match_confidence REAL NOT NULL,
        registration_location_scope TEXT NOT NULL,
        activity_declaration_number TEXT NOT NULL,
        previous_activity_numbers TEXT,
        postal_code TEXT,
        city TEXT,
        region_code TEXT,
        quality_training INTEGER,
        quality_skills_assessment INTEGER,
        quality_vae INTEGER,
        quality_apprenticeship INTEGER,
        is_quality_certified INTEGER NOT NULL,
        last_declaration_date TEXT,
        exercise_start_date TEXT,
        exercise_end_date TEXT,
        specialty_code_1 TEXT,
        specialty_label_1 TEXT,
        specialty_code_2 TEXT,
        specialty_label_2 TEXT,
        specialty_code_3 TEXT,
        specialty_label_3 TEXT,
        trainee_count INTEGER,
        entrusted_trainee_count INTEGER,
        trainer_count INTEGER,
        resource_id TEXT NOT NULL,
        resource_title TEXT NOT NULL,
        resource_url TEXT NOT NULL,
        resource_last_modified TEXT,
        source_updated_at TEXT NOT NULL,
        dataset_url TEXT NOT NULL,
        license_name TEXT NOT NULL,
        license_url TEXT NOT NULL,
        imported_at TEXT NOT NULL
      );
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX training_profiles_siren_declaration_idx ON training_organization_profiles(siren, last_declaration_date DESC);
      CREATE INDEX training_profiles_siret_idx ON training_organization_profiles(siret);
      CREATE INDEX training_profiles_location_idx ON training_organization_profiles(registration_location_scope, region_code);
      CREATE INDEX training_profiles_quality_idx ON training_organization_profiles(is_quality_certified);
      CREATE INDEX training_profiles_specialty_1_idx ON training_organization_profiles(specialty_code_1);
    """)
    imported_at = datetime.now(timezone.utc).isoformat()
    source_updated_at = str(metadata.get("source_updated_at") or "")
    columns = (
        "fingerprint", "source_row_number", "siren", "siret", "match_scope", "match_confidence",
        "registration_location_scope", "activity_declaration_number", "previous_activity_numbers",
        "postal_code", "city", "region_code", "quality_training", "quality_skills_assessment",
        "quality_vae", "quality_apprenticeship", "is_quality_certified", "last_declaration_date",
        "exercise_start_date", "exercise_end_date", "specialty_code_1", "specialty_label_1",
        "specialty_code_2", "specialty_label_2", "specialty_code_3", "specialty_label_3",
        "trainee_count", "entrusted_trainee_count", "trainer_count", "resource_id",
        "resource_title", "resource_url", "resource_last_modified",
    )
    placeholders = ",".join("?" for _ in range(len(columns) + 5))
    for profile in profiles:
        values = tuple(
            int(value) if isinstance(value, bool) else value
            for value in (profile.get(column) for column in columns)
        )
        connection.execute(
            f"INSERT OR IGNORE INTO training_organization_profiles ({','.join(columns)}, source_updated_at, dataset_url, license_name, license_url, imported_at) VALUES ({placeholders})",
            values + (source_updated_at, DATASET_URL, metadata["license_name"], metadata["license_url"], imported_at),
        )
    aggregate = connection.execute(
        """SELECT COUNT(*), COUNT(DISTINCT siren),
                  SUM(registration_location_scope = 'guadeloupe'),
                  SUM(registration_location_scope = 'outside_guadeloupe'),
                  SUM(match_scope = 'active_local_establishment'),
                  SUM(is_quality_certified = 1),
                  SUM(specialty_code_1 IS NOT NULL OR specialty_label_1 IS NOT NULL),
                  SUM(trainee_count IS NOT NULL OR trainer_count IS NOT NULL),
                  SUM(quality_training = 1), SUM(quality_skills_assessment = 1),
                  SUM(quality_vae = 1), SUM(quality_apprenticeship = 1),
                  MIN(last_declaration_date), MAX(last_declaration_date),
                  MIN(exercise_end_date), MAX(exercise_end_date)
           FROM training_organization_profiles"""
    ).fetchone()
    report = {
        "source": metadata.get("title"),
        "source_url": DATASET_URL,
        "source_updated_at": source_updated_at,
        "license": metadata.get("license_name"),
        "license_url": metadata.get("license_url"),
        "imported_at": imported_at,
        "downloaded_resource_count": int(downloaded),
        "cached_resource_count": int(not downloaded),
        "source_rows": int(stats["rows_read"]),
        "rows_with_valid_identifier": int(stats["rows_with_valid_identifier"]),
        "invalid_identifier_rows": int(stats["invalid_identifier_rows"]),
        "rows_matched": int(stats["rows_matched"]),
        "unique_profiles": aggregate[0],
        "matched_companies": aggregate[1],
        "guadeloupe_registration_count": aggregate[2] or 0,
        "outside_guadeloupe_registration_count": aggregate[3] or 0,
        "active_local_establishment_count": aggregate[4] or 0,
        "quality_certified_profile_count": aggregate[5] or 0,
        "profiles_with_specialty": aggregate[6] or 0,
        "profiles_with_activity_metrics": aggregate[7] or 0,
        "quality_training_count": aggregate[8] or 0,
        "quality_skills_assessment_count": aggregate[9] or 0,
        "quality_vae_count": aggregate[10] or 0,
        "quality_apprenticeship_count": aggregate[11] or 0,
        "earliest_declaration_date": aggregate[12],
        "latest_declaration_date": aggregate[13],
        "earliest_exercise_end_date": aggregate[14],
        "latest_exercise_end_date": aggregate[15],
        "resource_stats": stats,
        "contains_personal_names": False,
        "contains_street_addresses": False,
        "join_uses_names": False,
        "database": str(output),
    }
    for key, value in report.items():
        if key in {"database", "resource_stats"}:
            continue
        encoded = json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list, bool)) else str(value or "")
        connection.execute("INSERT INTO metadata(key, value) VALUES (?, ?)", (key, encoded))
    connection.commit()
    connection.execute("ANALYZE")
    connection.close()
    partial.replace(output)
    output.with_suffix(".report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--company-db", type=Path, default=DEFAULT_COMPANY_DB)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--skip-download", action="store_true")
    args = parser.parse_args()

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json,text/csv;q=0.9"})
    metadata = source_metadata(session)
    resource = metadata["resource"]
    if args.skip_download:
        path = args.cache_dir / f"{resource['id']}.csv"
        if not path.exists():
            raise SystemExit(f"Ressource Liste publique OF absente du cache: {path}")
        downloaded = False
    else:
        path, downloaded = download_resource(session, resource, args.cache_dir, args.refresh)
    profiles, stats = parse_resource(path, resource, args.company_db)
    print(json.dumps(build_index(profiles, args.output, metadata, stats, downloaded), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
