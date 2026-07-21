"""Build a local business-presence index from the Guadeloupe OSM extract.

Only objects carrying an exact ``ref:FR:SIRET`` or ``ref:FR:SIREN`` tag are
retained. Contributor metadata is not present in the Geofabrik extract and is
never requested or persisted by this importer.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import osmium


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_URL = "https://download.geofabrik.de/europe/france/guadeloupe-latest.osm.pbf"
DEFAULT_INPUT = ROOT / "data/imports/guadeloupe-latest.osm.pbf"
DEFAULT_OUTPUT = ROOT / "data/osm-business-profiles.sqlite"
SIREN_PATTERN = re.compile(r"(?<!\d)(\d{9})(?!\d)")
SIRET_PATTERN = re.compile(r"(?<!\d)(\d{14})(?!\d)")

CATEGORY_TAGS = (
    "amenity", "shop", "craft", "office", "tourism", "healthcare",
    "leisure", "industrial", "man_made", "club", "sport",
)
SERVICE_TAGS = (
    "service", "cuisine", "product", "beauty", "healthcare:speciality",
    "clothes", "rental", "repair",
)
SOCIAL_TAGS = (
    "contact:facebook", "facebook", "contact:instagram", "instagram",
    "contact:linkedin", "linkedin",
)
EMAIL_TAGS = ("contact:email", "email")
PUBLIC_EMAIL_PREFIXES = {
    "accueil", "administratif", "administration", "agence", "atelier", "booking", "bonjour",
    "commercial", "contact", "direction", "facturation", "formation", "hello", "info",
    "location", "office", "resa", "reservation", "reservations", "rh", "sav", "secretariat",
    "service", "support", "ventes", "vente"
}


def download_extract(target: Path, url: str) -> str | None:
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(target.suffix + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "guadeloupe-enterprises-import/0.2"})
    with urllib.request.urlopen(request, timeout=180) as response, partial.open("wb") as output:
        last_modified = response.headers.get("Last-Modified")
        downloaded = 0
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
            downloaded += len(chunk)
            print(f"{downloaded / 1024**2:.1f} Mio OSM reçus", flush=True)
    partial.replace(target)
    return last_modified


def identifiers(tags: dict[str, str]) -> list[tuple[str, str]]:
    sirets = set(SIRET_PATTERN.findall(tags.get("ref:FR:SIRET", "")))
    sirens = set(SIREN_PATTERN.findall(tags.get("ref:FR:SIREN", "")))
    rows = {(siret[:9], siret) for siret in sirets}
    rows.update((siren, "") for siren in sirens if not any(item[0] == siren for item in rows))
    return sorted(rows)


def category(tags: dict[str, str]) -> tuple[str | None, str | None]:
    for key in CATEGORY_TAGS:
        if value := tags.get(key):
            return key, value
    return None, None


def address(tags: dict[str, str]) -> str | None:
    parts = [
        tags.get("addr:housenumber"), tags.get("addr:street"),
        tags.get("addr:postcode"), tags.get("addr:city"),
    ]
    value = " ".join(part.strip() for part in parts if part and part.strip())
    return value or None


def public_email(tags: dict[str, str]) -> str | None:
    """Keep only generic professional mailboxes, never named mailboxes."""
    for key in EMAIL_TAGS:
        for candidate in re.split(r"[,;]", tags.get(key, "")):
            value = candidate.strip().lower()
            if not re.fullmatch(r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}", value):
                continue
            local_part = value.split("@", 1)[0].split("+", 1)[0]
            if local_part in PUBLIC_EMAIL_PREFIXES:
                return value
    return None


def coordinates(entity: Any) -> tuple[float | None, float | None]:
    if hasattr(entity, "location") and entity.location.valid():
        return entity.location.lat, entity.location.lon
    if hasattr(entity, "nodes"):
        valid = [node.location for node in entity.nodes if node.location.valid()]
        if valid:
            return sum(item.lat for item in valid) / len(valid), sum(item.lon for item in valid) / len(valid)
    return None, None


class BusinessProfileHandler(osmium.SimpleHandler):
    def __init__(self) -> None:
        super().__init__()
        self.rows: list[dict[str, object]] = []

    def node(self, entity: Any) -> None:
        self._collect("node", entity)

    def way(self, entity: Any) -> None:
        self._collect("way", entity)

    def relation(self, entity: Any) -> None:
        self._collect("relation", entity)

    def _collect(self, element_type: str, entity: Any) -> None:
        tags = dict(entity.tags)
        refs = identifiers(tags)
        if not refs:
            return
        latitude, longitude = coordinates(entity)
        category_key, category_value = category(tags)
        services = {key: tags[key] for key in SERVICE_TAGS if tags.get(key)}
        social = {key: tags[key] for key in SOCIAL_TAGS if tags.get(key)}
        selected_tags = {
            key: value for key, value in tags.items()
            if key in CATEGORY_TAGS + SERVICE_TAGS + SOCIAL_TAGS
            or key.startswith("payment:")
            or key in {
                "name", "brand", "operator", "website", "contact:website",
                "phone", "contact:phone", "opening_hours", "wheelchair",
                "internet_access", "description", "ref:FR:SIREN", "ref:FR:SIRET",
            }
        }
        for siren, siret in refs:
            self.rows.append({
                "element_type": element_type,
                "osm_id": int(entity.id),
                "siren": siren,
                "siret": siret,
                "name": tags.get("name"),
                "brand": tags.get("brand"),
                "operator_name": tags.get("operator"),
                "category_key": category_key,
                "category_value": category_value,
                "website": tags.get("contact:website") or tags.get("website"),
                "public_email": public_email(tags),
                "phone": tags.get("contact:phone") or tags.get("phone"),
                "opening_hours": tags.get("opening_hours"),
                "wheelchair": tags.get("wheelchair"),
                "internet_access": tags.get("internet_access"),
                "address": address(tags),
                "description": tags.get("description"),
                "latitude": latitude,
                "longitude": longitude,
                "services_json": json.dumps(services, ensure_ascii=False, sort_keys=True),
                "social_json": json.dumps(social, ensure_ascii=False, sort_keys=True),
                "tags_json": json.dumps(selected_tags, ensure_ascii=False, sort_keys=True),
            })


def write_database(rows: list[dict[str, object]], output: Path, reference_date: str) -> dict[str, object]:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.unlink(missing_ok=True)
    connection = sqlite3.connect(temporary)
    connection.executescript(
        """
        CREATE TABLE osm_business_profiles (
          element_type TEXT NOT NULL,
          osm_id INTEGER NOT NULL,
          siren TEXT NOT NULL,
          siret TEXT NOT NULL DEFAULT '',
          name TEXT,
          brand TEXT,
          operator_name TEXT,
          category_key TEXT,
          category_value TEXT,
          website TEXT,
          public_email TEXT,
          phone TEXT,
          opening_hours TEXT,
          wheelchair TEXT,
          internet_access TEXT,
          address TEXT,
          description TEXT,
          latitude REAL,
          longitude REAL,
          services_json TEXT NOT NULL,
          social_json TEXT NOT NULL,
          tags_json TEXT NOT NULL,
          source_reference_date TEXT NOT NULL,
          PRIMARY KEY (element_type, osm_id, siren, siret)
        );
        CREATE INDEX idx_osm_profiles_siren ON osm_business_profiles (siren);
        CREATE INDEX idx_osm_profiles_siret ON osm_business_profiles (siret);
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        """
    )
    columns = list(rows[0]) if rows else [
        "element_type", "osm_id", "siren", "siret", "name", "brand", "operator_name",
        "category_key", "category_value", "website", "public_email", "phone", "opening_hours",
        "wheelchair", "internet_access", "address", "description", "latitude",
        "longitude", "services_json", "social_json", "tags_json",
    ]
    if rows:
        placeholders = ",".join("?" for _ in columns)
        connection.executemany(
            f"INSERT INTO osm_business_profiles ({','.join(columns)}, source_reference_date) VALUES ({placeholders}, ?)",
            [tuple(row[column] for column in columns) + (reference_date,) for row in rows],
        )
    imported_at = datetime.now(timezone.utc).isoformat()
    metadata = {
        "source": "OpenStreetMap via Geofabrik",
        "source_url": DEFAULT_URL,
        "source_reference_date": reference_date,
        "imported_at": imported_at,
        "license": "ODbL 1.0",
        "attribution": "© OpenStreetMap contributors",
        "records": str(len(rows)),
        "companies": str(len({str(row['siren']) for row in rows})),
        "establishments": str(len({str(row['siret']) for row in rows if row['siret']})),
        "public_emails": str(len({str(row['public_email']) for row in rows if row.get('public_email')})),
    }
    connection.executemany("INSERT INTO metadata (key, value) VALUES (?, ?)", metadata.items())
    connection.commit()
    connection.close()
    temporary.replace(output)
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()

    last_modified = download_extract(args.input, args.url) if args.download or not args.input.exists() else None
    if not args.input.exists():
        raise FileNotFoundError(args.input)
    reference_date = last_modified or datetime.fromtimestamp(args.input.stat().st_mtime, timezone.utc).isoformat()
    handler = BusinessProfileHandler()
    handler.apply_file(str(args.input), locations=True, idx="flex_mem")
    report = write_database(handler.rows, args.output, reference_date)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
