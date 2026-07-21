"""Import public legal officers from the official Annuaire des Entreprises API.

The join key is an exact SIREN from the local SIRENE stock. Only public legal
identity and mandate information is retained. Birth dates, nationality,
addresses and contact details are deliberately discarded at parse time.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
COMPANY_DB = ROOT / "data" / "guadeloupe-enterprises.sqlite"
OUTPUT_DB = ROOT / "data" / "public-officers.sqlite"
API_BASE = "https://recherche-entreprises.api.gouv.fr/search"
SOURCE = "API Recherche d'entreprises / Annuaire des Entreprises (dirigeants publics issus du RNE)"
SOURCE_URL = "https://recherche-entreprises.api.gouv.fr/docs/"
ANNUAIRE_URL = "https://annuaire-entreprises.data.gouv.fr/entreprise/"
USER_AGENT = "Guadeloupe-Entreprises-BI/0.2 (+https://recherche-entreprises.api.gouv.fr/docs/)"
DEFAULT_DEPARTMENT = "971"
API_MAX_PER_PAGE = 25

SAFE_COMPLEMENT_LABELS = {
    "est_ess": "Economie sociale et solidaire",
    "est_societe_mission": "Societe a mission",
    "est_qualiopi": "Certification Qualiopi",
    "est_rge": "Reconnu garant de l'environnement (RGE)",
    "est_bio": "Agriculture biologique",
    "est_organisme_formation": "Organisme de formation",
    "est_patrimoine_vivant": "Entreprise du patrimoine vivant",
    "est_siae": "Structure d'insertion par l'activite economique",
    "egapro_renseignee": "Index egalite professionnelle renseigne",
    "bilan_ges_renseigne": "Bilan d'emissions de gaz a effet de serre renseigne",
    "est_entrepreneur_spectacle": "Entrepreneur de spectacles",
    "est_uai": "Unite administrative immatriculee",
    "est_administration": "Administration",
    "est_service_public": "Service public",
}


def clean_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = " ".join(value.split()).strip()
    return value or None


def valid_siren(value: Any) -> str | None:
    raw = "".join(str(value or "").split())
    return raw if len(raw) == 9 and raw.isdigit() else None


def normalized_name(*parts: str | None) -> str:
    import unicodedata

    value = " ".join(part for part in parts if part)
    value = unicodedata.normalize("NFD", value)
    return "".join(char for char in value if unicodedata.category(char) != "Mn").lower().strip()


def officer_key(row: dict[str, Any]) -> str:
    raw = "|".join(
        str(row.get(key) or "")
        for key in ("siren", "officer_type", "display_name", "role", "related_siren")
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def number_value(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = value.strip().replace(" ", "").replace(",", ".")
        try:
            return float(cleaned) if cleaned else None
        except ValueError:
            return None
    return None


def parse_officers(result: dict[str, Any], retrieved_at: str) -> list[dict[str, Any]]:
    """Parse only public identity and role fields from one exact SIREN result."""

    siren = valid_siren(result.get("siren"))
    if not siren:
        return []
    source_updated_at = clean_text(result.get("date_mise_a_jour_rne")) or clean_text(result.get("date_mise_a_jour"))
    output: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in result.get("dirigeants") or []:
        if not isinstance(item, dict):
            continue
        officer_type = clean_text(item.get("type_dirigeant")) or "type non renseigne"
        role = clean_text(item.get("qualite")) or "Qualite non renseignee"
        if officer_type == "personne physique":
            family_name = clean_text(item.get("nom"))
            given_names = clean_text(item.get("prenoms"))
            if not family_name and not given_names:
                continue
            display_name = " ".join(part for part in (given_names, family_name) if part)
            related_siren = ""
        elif officer_type == "personne morale":
            family_name = None
            given_names = None
            display_name = clean_text(item.get("denomination"))
            related_siren = valid_siren(item.get("siren")) or ""
            if not display_name:
                continue
        else:
            continue
        row = {
            "siren": siren,
            "officer_type": officer_type,
            "display_name": display_name,
            "family_name": family_name,
            "given_names": given_names,
            "search_name": normalized_name(display_name, role),
            "role": role,
            "related_siren": related_siren,
            "source_updated_at": source_updated_at,
            "retrieved_at": retrieved_at,
            "source": SOURCE,
            "source_url": f"{ANNUAIRE_URL}{siren}",
        }
        key = officer_key(row)
        if key in seen:
            continue
        seen.add(key)
        row["officer_key"] = key
        output.append(row)
    return output


def parse_annuaire_profile(result: dict[str, Any], retrieved_at: str) -> dict[str, Any] | None:
    """Extract non-personal company aggregates; never retain the raw API payload."""

    siren = valid_siren(result.get("siren"))
    if not siren:
        return None
    complements = result.get("complements") if isinstance(result.get("complements"), dict) else {}
    labels = [
        {"label_key": key, "label": label}
        for key, label in SAFE_COMPLEMENT_LABELS.items()
        if complements.get(key) is True
    ]
    aid_labels = []
    if complements.get("a_aide_minimis") is True:
        aid_labels.append({"label_key": "a_aide_minimis", "label": "Aide de minimis signalee"})
    if complements.get("a_aide_ademe") is True:
        aid_labels.append({"label_key": "a_aide_ademe", "label": "Aide ADEME signalee"})

    financials = []
    finances = result.get("finances") if isinstance(result.get("finances"), dict) else {}
    for year, raw in finances.items():
        if not re.fullmatch(r"\d{4}", str(year)) or not isinstance(raw, dict):
            continue
        financials.append({
            "year": str(year),
            "revenue": number_value(raw.get("ca")),
            "net_income": number_value(raw.get("resultat_net")),
        })

    agreements = [
        str(item).strip()
        for item in complements.get("liste_idcc") or []
        if isinstance(item, (str, int)) and str(item).strip()
    ]
    source_updated_at = clean_text(result.get("date_mise_a_jour_rne")) or clean_text(result.get("date_mise_a_jour"))
    return {
        "siren": siren,
        "company_category": clean_text(result.get("categorie_entreprise")),
        "workforce_band_code": clean_text(result.get("tranche_effectif_salarie")),
        "workforce_year": clean_text(result.get("annee_tranche_effectif_salarie")),
        "naf25": clean_text(result.get("activite_principale_naf25")),
        "establishment_count": int(number_value(result.get("nombre_etablissements")) or 0),
        "open_establishment_count": int(number_value(result.get("nombre_etablissements_ouverts")) or 0),
        "collective_agreement_reported": 1 if complements.get("convention_collective_renseignee") is True else 0,
        "source_updated_at": source_updated_at,
        "retrieved_at": retrieved_at,
        "source": SOURCE,
        "source_url": f"{ANNUAIRE_URL}{siren}",
        "labels": labels + aid_labels,
        "financials": financials,
        "agreements": sorted(set(agreements)),
    }


def request_payload(params: dict[str, Any], retries: int = 5) -> dict[str, Any]:
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(
        f"{API_BASE}?{query}",
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == retries - 1:
                raise
            retry_after = error.headers.get("Retry-After")
            wait = float(retry_after) if retry_after and retry_after.replace(".", "", 1).isdigit() else 2 ** (attempt + 1)
            time.sleep(wait)
    raise RuntimeError("unreachable")


def request_json(siren: str, retries: int = 5) -> dict[str, Any]:
    return request_payload({
        "q": siren,
        "per_page": 1,
        "minimal": "true",
        "include": "complements,dirigeants,finances",
    }, retries)


def request_department_page(
    department: str,
    page: int,
    per_page: int = API_MAX_PER_PAGE,
    retries: int = 5,
) -> dict[str, Any]:
    """Fetch one official department page without widening the join key."""

    if not department.isdigit() or not 1 <= len(department) <= 3:
        raise ValueError("Le département doit être un code numérique")
    if page < 1:
        raise ValueError("La page doit être supérieure ou égale à 1")
    if not 1 <= per_page <= API_MAX_PER_PAGE:
        raise ValueError(f"per_page doit être compris entre 1 et {API_MAX_PER_PAGE}")
    return request_payload({
        "departement": department,
        "page": page,
        "per_page": per_page,
        "minimal": "true",
        "include": "complements,dirigeants,finances",
    }, retries)


def integer_value(value: Any) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def parse_department_page(payload: dict[str, Any], target_sirens: set[str]) -> dict[str, Any]:
    """Keep only exact SIRENs present in the local SIRENE stock."""

    raw_results = payload.get("results") or []
    results: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw_results:
        if not isinstance(item, dict):
            continue
        siren = valid_siren(item.get("siren"))
        if not siren or siren not in target_sirens or siren in seen:
            continue
        seen.add(siren)
        results.append(item)
    return {
        "rows_read": len(raw_results),
        "matched_rows": len(results),
        "results": results,
        "total_results": integer_value(payload.get("total_results")),
        "total_pages": integer_value(payload.get("total_pages")),
    }


def source_sirens(path: Path) -> list[str]:
    connection = sqlite3.connect(path)
    try:
        rows = connection.execute("SELECT siren FROM companies WHERE length(siren) = 9 ORDER BY siren").fetchall()
    finally:
        connection.close()
    return [str(row[0]) for row in rows if str(row[0]).isdigit()]


def pending_profile_sirens(path: Path) -> list[str]:
    connection = sqlite3.connect(path)
    try:
        rows = connection.execute(
            "SELECT siren FROM fetch_log WHERE status = 'ok' AND profile_status <> 'ok' ORDER BY siren"
        ).fetchall()
    finally:
        connection.close()
    return [str(row[0]) for row in rows if str(row[0]).isdigit()]


def initialise(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
        CREATE TABLE IF NOT EXISTS officers (
          id INTEGER PRIMARY KEY,
          officer_key TEXT NOT NULL UNIQUE,
          siren TEXT NOT NULL,
          officer_type TEXT NOT NULL,
          display_name TEXT NOT NULL,
          family_name TEXT,
          given_names TEXT,
          search_name TEXT NOT NULL,
          role TEXT NOT NULL,
          related_siren TEXT NOT NULL DEFAULT '',
          source_updated_at TEXT,
          retrieved_at TEXT NOT NULL,
          source TEXT NOT NULL,
          source_url TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS officers_siren_idx ON officers(siren);
        CREATE INDEX IF NOT EXISTS officers_search_name_idx ON officers(search_name);
        CREATE TABLE IF NOT EXISTS fetch_log (
          siren TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          officer_count INTEGER NOT NULL DEFAULT 0,
          profile_status TEXT NOT NULL DEFAULT 'pending',
          source_updated_at TEXT,
          fetched_at TEXT NOT NULL,
          error TEXT
        );
        CREATE TABLE IF NOT EXISTS annuaire_profiles (
          siren TEXT PRIMARY KEY,
          company_category TEXT,
          workforce_band_code TEXT,
          workforce_year TEXT,
          naf25 TEXT,
          establishment_count INTEGER NOT NULL DEFAULT 0,
          open_establishment_count INTEGER NOT NULL DEFAULT 0,
          collective_agreement_reported INTEGER NOT NULL DEFAULT 0,
          source_updated_at TEXT,
          retrieved_at TEXT NOT NULL,
          source TEXT NOT NULL,
          source_url TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS annuaire_financials (
          siren TEXT NOT NULL,
          year TEXT NOT NULL,
          revenue REAL,
          net_income REAL,
          PRIMARY KEY (siren, year)
        );
        CREATE TABLE IF NOT EXISTS annuaire_labels (
          siren TEXT NOT NULL,
          label_key TEXT NOT NULL,
          label TEXT NOT NULL,
          PRIMARY KEY (siren, label_key)
        );
        CREATE TABLE IF NOT EXISTS annuaire_agreements (
          siren TEXT NOT NULL,
          idcc TEXT NOT NULL,
          PRIMARY KEY (siren, idcc)
        );
        CREATE INDEX IF NOT EXISTS annuaire_profiles_updated_idx ON annuaire_profiles(source_updated_at, retrieved_at);
        CREATE INDEX IF NOT EXISTS annuaire_financials_year_idx ON annuaire_financials(year, siren);
        CREATE INDEX IF NOT EXISTS annuaire_labels_key_idx ON annuaire_labels(label_key, siren);
        CREATE INDEX IF NOT EXISTS annuaire_agreements_idcc_idx ON annuaire_agreements(idcc, siren);
        CREATE TABLE IF NOT EXISTS metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS department_runs (
          id INTEGER PRIMARY KEY,
          department TEXT NOT NULL,
          per_page INTEGER NOT NULL,
          next_page INTEGER NOT NULL DEFAULT 1,
          total_results INTEGER,
          total_pages INTEGER,
          pages_processed INTEGER NOT NULL DEFAULT 0,
          rows_read INTEGER NOT NULL DEFAULT 0,
          matched_rows INTEGER NOT NULL DEFAULT 0,
          processed_sirens INTEGER NOT NULL DEFAULT 0,
          successful_sirens INTEGER NOT NULL DEFAULT 0,
          skipped_sirens INTEGER NOT NULL DEFAULT 0,
          error_sirens INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL,
          started_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          finished_at TEXT,
          error TEXT
        );
        CREATE INDEX IF NOT EXISTS department_runs_status_idx ON department_runs(department, status, updated_at);
        CREATE VIRTUAL TABLE IF NOT EXISTS officer_search USING fts5(
          officer_id UNINDEXED,
          siren UNINDEXED,
          display_name,
          family_name,
          given_names,
          role,
          search_name,
          tokenize='unicode61 remove_diacritics 2'
        );
        """
    )
    try:
        connection.execute("ALTER TABLE fetch_log ADD COLUMN profile_status TEXT NOT NULL DEFAULT 'pending'")
    except sqlite3.OperationalError:
        pass


def rebuild_search(connection: sqlite3.Connection) -> None:
    connection.execute("DELETE FROM officer_search")
    connection.execute(
        """
        INSERT INTO officer_search(officer_id, siren, display_name, family_name, given_names, role, search_name)
        SELECT id, siren, display_name, family_name, given_names, role, search_name
        FROM officers
        """
    )


def index_metadata(connection: sqlite3.Connection, values: dict[str, Any]) -> None:
    connection.executemany(
        "INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [(key, str(value)) for key, value in values.items()],
    )


def clear_siren_snapshot(connection: sqlite3.Connection, siren: str) -> None:
    connection.execute("DELETE FROM officers WHERE siren = ?", (siren,))
    for table in ("annuaire_profiles", "annuaire_financials", "annuaire_labels", "annuaire_agreements"):
        connection.execute(f"DELETE FROM {table} WHERE siren = ?", (siren,))


def mark_empty_siren(connection: sqlite3.Connection, siren: str, fetched_at: str, error: str) -> None:
    clear_siren_snapshot(connection, siren)
    connection.execute(
        "INSERT INTO fetch_log(siren,status,profile_status,fetched_at,error) VALUES (?, 'empty', 'empty', ?, ?) ON CONFLICT(siren) DO UPDATE SET status='empty', profile_status='empty', fetched_at=excluded.fetched_at, error=excluded.error",
        (siren, fetched_at, error),
    )


def persist_result(connection: sqlite3.Connection, result: dict[str, Any], fetched_at: str) -> dict[str, Any]:
    """Replace one SIREN snapshot with a safe projection of the API response."""

    siren = valid_siren(result.get("siren"))
    if not siren:
        raise ValueError("Réponse Annuaire sans SIREN valide")
    rows = parse_officers(result, fetched_at)
    profile = parse_annuaire_profile(result, fetched_at)
    clear_siren_snapshot(connection, siren)
    connection.executemany(
        """
        INSERT INTO officers(
          officer_key,siren,officer_type,display_name,family_name,given_names,search_name,role,
          related_siren,source_updated_at,retrieved_at,source,source_url
        ) VALUES (:officer_key,:siren,:officer_type,:display_name,:family_name,:given_names,:search_name,:role,
                  :related_siren,:source_updated_at,:retrieved_at,:source,:source_url)
        ON CONFLICT(officer_key) DO UPDATE SET
          source_updated_at=excluded.source_updated_at,
          retrieved_at=excluded.retrieved_at,
          source_url=excluded.source_url
        """,
        rows,
    )
    financial_count = 0
    label_count = 0
    agreement_count = 0
    if profile:
        connection.execute(
            """
            INSERT INTO annuaire_profiles(
              siren,company_category,workforce_band_code,workforce_year,naf25,
              establishment_count,open_establishment_count,collective_agreement_reported,
              source_updated_at,retrieved_at,source,source_url
            ) VALUES (:siren,:company_category,:workforce_band_code,:workforce_year,:naf25,
                      :establishment_count,:open_establishment_count,:collective_agreement_reported,
                      :source_updated_at,:retrieved_at,:source,:source_url)
            """,
            profile,
        )
        connection.executemany(
            "INSERT INTO annuaire_financials(siren,year,revenue,net_income) VALUES (?,?,?,?)",
            [(siren, row["year"], row["revenue"], row["net_income"]) for row in profile["financials"]],
        )
        connection.executemany(
            "INSERT INTO annuaire_labels(siren,label_key,label) VALUES (?,?,?)",
            [(siren, row["label_key"], row["label"]) for row in profile["labels"]],
        )
        connection.executemany(
            "INSERT INTO annuaire_agreements(siren,idcc) VALUES (?,?)",
            [(siren, idcc) for idcc in profile["agreements"]],
        )
        financial_count = len(profile["financials"])
        label_count = len(profile["labels"])
        agreement_count = len(profile["agreements"])
    source_updated_at = clean_text(result.get("date_mise_a_jour_rne")) or clean_text(result.get("date_mise_a_jour"))
    connection.execute(
        """
        INSERT INTO fetch_log(siren,status,officer_count,profile_status,source_updated_at,fetched_at,error)
        VALUES (?, 'ok', ?, 'ok', ?, ?, NULL)
        ON CONFLICT(siren) DO UPDATE SET status='ok', officer_count=excluded.officer_count,
          profile_status='ok', source_updated_at=excluded.source_updated_at, fetched_at=excluded.fetched_at, error=NULL
        """,
        (siren, len(rows), source_updated_at, fetched_at),
    )
    return {
        "siren": siren,
        "officer_count": len(rows),
        "profile_count": 1 if profile else 0,
        "financial_count": financial_count,
        "label_count": label_count,
        "agreement_count": agreement_count,
    }


def snapshot_counts(connection: sqlite3.Connection) -> dict[str, int]:
    return {
        "successful_sirens": int(connection.execute("SELECT COUNT(*) FROM fetch_log WHERE status = 'ok'").fetchone()[0]),
        "empty_sirens": int(connection.execute("SELECT COUNT(*) FROM fetch_log WHERE status = 'empty'").fetchone()[0]),
        "error_sirens": int(connection.execute("SELECT COUNT(*) FROM fetch_log WHERE status = 'error'").fetchone()[0]),
        "officer_rows": int(connection.execute("SELECT COUNT(*) FROM officers").fetchone()[0]),
        "profile_rows": int(connection.execute("SELECT COUNT(*) FROM annuaire_profiles").fetchone()[0]),
        "financial_rows": int(connection.execute("SELECT COUNT(*) FROM annuaire_financials").fetchone()[0]),
        "label_rows": int(connection.execute("SELECT COUNT(*) FROM annuaire_labels").fetchone()[0]),
        "agreement_rows": int(connection.execute("SELECT COUNT(*) FROM annuaire_agreements").fetchone()[0]),
    }


def write_snapshot_metadata(
    connection: sqlite3.Connection,
    coverage_total: int,
    retrieved_at: str,
    stats: dict[str, Any],
    requested_sirens: int,
) -> None:
    counts = snapshot_counts(connection)
    index_metadata(connection, {
        "source": SOURCE,
        "source_url": SOURCE_URL,
        "license": "MIT pour l'API; données publiques référencées par l'Annuaire des Entreprises",
        "retrieved_at": retrieved_at,
        "requested_sirens": coverage_total,
        "processed_sirens": stats.get("processed_sirens", 0),
        **counts,
        "indexed_sirens": counts["successful_sirens"],
        "profile_indexed_sirens": counts["profile_rows"],
        "coverage_ratio": round(counts["successful_sirens"] / coverage_total, 6) if coverage_total else 0,
        "coverage_total": coverage_total,
        "last_run_processed_sirens": stats.get("processed_sirens", 0),
        "last_run_requested_sirens": requested_sirens,
        "last_run_successful_sirens": stats.get("successful_sirens", 0),
        "last_run_officer_rows": stats.get("officer_rows", 0),
        "last_run_profile_rows": stats.get("profile_rows", 0),
        "last_run_financial_rows": stats.get("financial_rows", 0),
        "last_run_label_rows": stats.get("label_rows", 0),
        "last_run_agreement_rows": stats.get("agreement_rows", 0),
        "contains_birth_dates": False,
        "contains_nationality": False,
        "contains_personal_contacts": False,
        "contains_raw_annuaire_payload": False,
    })


def import_sirens(
    output: Path,
    sirens: list[str],
    delay: float,
    resume: bool,
    max_requests: int | None,
    coverage_total: int | None = None,
) -> dict[str, Any]:
    output.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(output)
    initialise(connection)
    already_done = {
        str(row[0])
        for row in connection.execute("SELECT siren FROM fetch_log WHERE status = 'ok' AND profile_status = 'ok'").fetchall()
    } if resume else set()
    pending = [siren for siren in sirens if siren not in already_done]
    if max_requests is not None:
        pending = pending[:max_requests]
    coverage_total = coverage_total or len(sirens)
    retrieved_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    stats = {
        "requested_sirens": coverage_total,
        "skipped_sirens": len(sirens) - len(pending),
        "processed_sirens": 0,
        "successful_sirens": 0,
        "empty_sirens": 0,
        "error_sirens": 0,
        "officer_rows": 0,
        "profile_rows": 0,
        "financial_rows": 0,
        "label_rows": 0,
        "agreement_rows": 0,
        "retrieved_at": retrieved_at,
    }
    for index, siren in enumerate(pending):
        fetched_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        try:
            payload = request_json(siren)
            result = next((item for item in payload.get("results") or [] if valid_siren(item.get("siren")) == siren), None)
            if result is None:
                mark_empty_siren(connection, siren, fetched_at, "SIREN absent de la réponse officielle")
                stats["empty_sirens"] += 1
            else:
                result_stats = persist_result(connection, result, fetched_at)
                stats["successful_sirens"] += 1
                stats["officer_rows"] += result_stats["officer_count"]
                stats["profile_rows"] += result_stats["profile_count"]
                stats["financial_rows"] += result_stats["financial_count"]
                stats["label_rows"] += result_stats["label_count"]
                stats["agreement_rows"] += result_stats["agreement_count"]
                if not result_stats["officer_count"]:
                    stats["empty_sirens"] += 1
            stats["processed_sirens"] += 1
        except (OSError, ValueError, json.JSONDecodeError) as error:
            connection.execute(
                """
                INSERT INTO fetch_log(siren,status,profile_status,fetched_at,error) VALUES (?, 'error', 'error', ?, ?)
                ON CONFLICT(siren) DO UPDATE SET status='error', profile_status='error', fetched_at=excluded.fetched_at, error=excluded.error
                """,
                (siren, fetched_at, str(error)[:500]),
            )
            stats["processed_sirens"] += 1
            stats["error_sirens"] += 1
        if index % 25 == 0:
            connection.commit()
        if delay > 0 and index < len(pending) - 1:
            time.sleep(delay)
    rebuild_search(connection)
    write_snapshot_metadata(connection, coverage_total, retrieved_at, stats, len(sirens))
    connection.commit()
    connection.close()
    return stats


def start_department_run(
    connection: sqlite3.Connection,
    department: str,
    per_page: int,
    resume: bool,
    start_page: int,
) -> tuple[int, int, dict[str, Any]]:
    if resume:
        row = connection.execute(
            "SELECT id,next_page,total_results,total_pages,pages_processed,rows_read,matched_rows,processed_sirens,successful_sirens,skipped_sirens,error_sirens,status FROM department_runs WHERE department = ? ORDER BY id DESC LIMIT 1",
            (department,),
        ).fetchone()
        if row:
            run_id = int(row[0])
            next_page = int(row[1])
            stats = {
                "api_total_results": row[2],
                "api_total_pages": row[3],
                "pages_processed": int(row[4]),
                "rows_read": int(row[5]),
                "matched_rows": int(row[6]),
                "processed_sirens": int(row[7]),
                "successful_sirens": int(row[8]),
                "skipped_sirens": int(row[9]),
                "error_sirens": int(row[10]),
                "status": str(row[11]),
            }
            return run_id, next_page, stats
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    cursor = connection.execute(
        "INSERT INTO department_runs(department,per_page,next_page,status,started_at,updated_at) VALUES (?, ?, ?, 'running', ?, ?)",
        (department, per_page, start_page, now, now),
    )
    return int(cursor.lastrowid), start_page, {
        "api_total_results": None,
        "api_total_pages": None,
        "pages_processed": 0,
        "rows_read": 0,
        "matched_rows": 0,
        "processed_sirens": 0,
        "successful_sirens": 0,
        "skipped_sirens": 0,
        "error_sirens": 0,
    }


def import_department_bulk(
    output: Path,
    company_db: Path,
    department: str,
    delay: float,
    resume: bool,
    start_page: int,
    max_pages: int | None,
    per_page: int = API_MAX_PER_PAGE,
) -> dict[str, Any]:
    """Import the bounded official department search with page-level resume."""

    target_sirens = set(source_sirens(company_db))
    coverage_total = len(target_sirens)
    output.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(output)
    initialise(connection)
    run_id, page, stats = start_department_run(connection, department, per_page, resume, start_page)
    connection.commit()
    retrieved_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    if stats.get("status") == "complete":
        stats.update({
            "run_id": run_id,
            "department": department,
            "requested_sirens": coverage_total,
            "retrieved_at": retrieved_at,
            "indexed_sirens": int(connection.execute("SELECT COUNT(*) FROM fetch_log WHERE status = 'ok'").fetchone()[0]),
            "profile_indexed_sirens": int(connection.execute("SELECT COUNT(*) FROM annuaire_profiles").fetchone()[0]),
            "coverage_ratio": round(int(connection.execute("SELECT COUNT(*) FROM fetch_log WHERE status = 'ok'").fetchone()[0]) / coverage_total, 6) if coverage_total else 0,
            "api_cap_observed": stats["api_total_results"] == 10000,
        })
        connection.close()
        return stats
    already_done = {
        str(row[0])
        for row in connection.execute("SELECT siren FROM fetch_log WHERE status = 'ok' AND profile_status = 'ok'").fetchall()
    } if resume else set()
    pages_this_run = 0
    while True:
        if max_pages is not None and pages_this_run >= max_pages:
            break
        fetched_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        try:
            payload = request_department_page(department, page, per_page)
            parsed = parse_department_page(payload, target_sirens)
        except (OSError, ValueError, json.JSONDecodeError) as error:
            now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
            connection.execute(
                "UPDATE department_runs SET status='error', updated_at=?, error=? WHERE id=?",
                (now, str(error)[:500], run_id),
            )
            connection.commit()
            connection.close()
            raise
        if stats["api_total_results"] is None:
            stats["api_total_results"] = parsed["total_results"]
        if stats["api_total_pages"] is None:
            stats["api_total_pages"] = parsed["total_pages"]
        for result in parsed["results"]:
            siren = valid_siren(result.get("siren"))
            if not siren:
                continue
            if siren in already_done:
                stats["skipped_sirens"] += 1
                continue
            try:
                result_stats = persist_result(connection, result, fetched_at)
                already_done.add(siren)
                stats["successful_sirens"] += 1
                stats["processed_sirens"] += 1
                stats["officer_rows"] = stats.get("officer_rows", 0) + result_stats["officer_count"]
                stats["profile_rows"] = stats.get("profile_rows", 0) + result_stats["profile_count"]
                stats["financial_rows"] = stats.get("financial_rows", 0) + result_stats["financial_count"]
                stats["label_rows"] = stats.get("label_rows", 0) + result_stats["label_count"]
                stats["agreement_rows"] = stats.get("agreement_rows", 0) + result_stats["agreement_count"]
            except (ValueError, sqlite3.Error) as error:
                stats["processed_sirens"] += 1
                stats["error_sirens"] += 1
                connection.execute(
                    "INSERT INTO fetch_log(siren,status,profile_status,fetched_at,error) VALUES (?, 'error', 'error', ?, ?) ON CONFLICT(siren) DO UPDATE SET status='error', profile_status='error', fetched_at=excluded.fetched_at, error=excluded.error",
                    (siren, fetched_at, str(error)[:500]),
                )
        stats["pages_processed"] += 1
        stats["rows_read"] += parsed["rows_read"]
        stats["matched_rows"] += parsed["matched_rows"]
        next_page = page + 1
        now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        connection.execute(
            """
            UPDATE department_runs SET next_page=?, total_results=?, total_pages=?, pages_processed=?, rows_read=?, matched_rows=?,
              processed_sirens=?, successful_sirens=?, skipped_sirens=?, error_sirens=?, status='running', updated_at=?, error=NULL
            WHERE id=?
            """,
            (
                next_page,
                stats["api_total_results"],
                stats["api_total_pages"],
                stats["pages_processed"],
                stats["rows_read"],
                stats["matched_rows"],
                stats["processed_sirens"],
                stats["successful_sirens"],
                stats["skipped_sirens"],
                stats["error_sirens"],
                now,
                run_id,
            ),
        )
        connection.commit()
        pages_this_run += 1
        page = next_page
        if stats["api_total_pages"] is not None and page > stats["api_total_pages"]:
            break
        if delay > 0:
            time.sleep(delay)
    completed = stats["api_total_pages"] is not None and page > stats["api_total_pages"]
    status = "complete" if completed else "paused"
    finished_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z") if completed else None
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    connection.execute(
        "UPDATE department_runs SET status=?, updated_at=?, finished_at=? WHERE id=?",
        (status, now, finished_at, run_id),
    )
    rebuild_search(connection)
    stats.update({
        "run_id": run_id,
        "department": department,
        "status": status,
        "requested_sirens": coverage_total,
        "retrieved_at": retrieved_at,
        "indexed_sirens": int(connection.execute("SELECT COUNT(*) FROM fetch_log WHERE status = 'ok'").fetchone()[0]),
        "profile_indexed_sirens": int(connection.execute("SELECT COUNT(*) FROM annuaire_profiles").fetchone()[0]),
        "coverage_ratio": round(int(connection.execute("SELECT COUNT(*) FROM fetch_log WHERE status = 'ok'").fetchone()[0]) / coverage_total, 6) if coverage_total else 0,
        "api_cap_observed": stats["api_total_results"] == 10000,
    })
    write_snapshot_metadata(connection, coverage_total, retrieved_at, stats, stats["matched_rows"])
    index_metadata(connection, {
        "bulk_department": department,
        "bulk_per_page": per_page,
        "bulk_run_id": run_id,
        "bulk_status": status,
        "bulk_next_page": page,
        "bulk_total_results": stats["api_total_results"],
        "bulk_total_pages": stats["api_total_pages"],
        "bulk_pages_processed": stats["pages_processed"],
        "bulk_rows_read": stats["rows_read"],
        "bulk_matched_rows": stats["matched_rows"],
        "bulk_api_cap_observed": stats["api_cap_observed"],
    })
    connection.commit()
    connection.close()
    return stats


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--company-db", type=Path, default=COMPANY_DB)
    parser.add_argument("--output", type=Path, default=OUTPUT_DB)
    parser.add_argument("--siren", action="append", default=[], help="SIREN exact; repeatable or comma-separated")
    parser.add_argument("--limit", type=int, default=None, help="maximum number of SIREN requests")
    parser.add_argument("--delay", type=float, default=0.18, help="delay between requests; keep below the public API limit")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--refresh-profiles", action="store_true", help="refresh only SIREN already present in fetch_log without a local aggregate snapshot")
    parser.add_argument("--bulk-department", action="store_true", help="import the bounded official department search page by page")
    parser.add_argument("--department", default=DEFAULT_DEPARTMENT, help="department code for --bulk-department")
    parser.add_argument("--start-page", type=int, default=1, help="first department page for a new bulk run")
    parser.add_argument("--max-pages", type=int, default=None, help="maximum pages for this invocation; the run remains resumable")
    parser.add_argument("--per-page", type=int, default=API_MAX_PER_PAGE, help=f"department page size, maximum {API_MAX_PER_PAGE}")
    args = parser.parse_args()
    if args.bulk_department:
        if args.siren or args.refresh_profiles or args.limit is not None:
            parser.error("--bulk-department est exclusif de --siren, --refresh-profiles et --limit")
        stats = import_department_bulk(
            args.output,
            args.company_db,
            args.department,
            args.delay,
            args.resume,
            args.start_page,
            args.max_pages,
            args.per_page,
        )
        print(json.dumps(stats, ensure_ascii=False, sort_keys=True))
        return
    if args.siren:
        sirens = sorted({
            item.strip() for value in args.siren for item in value.split(",") if valid_siren(item.strip())
        })
    elif args.refresh_profiles:
        sirens = pending_profile_sirens(args.output)
    else:
        sirens = source_sirens(args.company_db)
    coverage_total = len(source_sirens(args.company_db))
    stats = import_sirens(args.output, sirens, args.delay, args.resume, args.limit, coverage_total)
    print(json.dumps(stats, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
