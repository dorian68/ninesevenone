"""Generate a real Guadeloupe establishment dataset from API Recherche d'Entreprises.

This is a practical bootstrap importer, not the authoritative exhaustive Sirene stock
import. It stores only public establishment/company fields needed by the map and drops
person-level payloads such as dirigeants.
"""

from __future__ import annotations

import argparse
import json
import re
import time
import unicodedata
import urllib.parse
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
COMMUNES_GEOJSON = ROOT / "apps/web/public/data/guad-communes.geojson"
OUT_DATASET = ROOT / "apps/web/src/generated/real-establishments.json"
OUT_METADATA = ROOT / "apps/web/src/generated/real-metadata.json"
API_BASE = "https://recherche-entreprises.api.gouv.fr/search"


SECTION_TO_SECTOR = {
    "A": "Agriculture, pêche et ressources",
    "B": "Industrie et énergie",
    "C": "Industrie et fabrication",
    "D": "Industrie et énergie",
    "E": "Eau, déchets et environnement",
    "F": "Construction et immobilier",
    "G": "Commerce et distribution",
    "H": "Transport et logistique",
    "I": "Hébergement et restauration",
    "J": "Numérique, médias et communication",
    "K": "Finance et assurance",
    "L": "Immobilier",
    "M": "Services aux entreprises",
    "N": "Services administratifs et support",
    "O": "Administration publique",
    "P": "Enseignement",
    "Q": "Santé et action sociale",
    "R": "Arts, culture, sport et loisirs",
    "S": "Services de proximité",
    "T": "Services domestiques",
    "U": "Activités extra-territoriales",
}


def slugify(value: str) -> str:
    value = unicodedata.normalize("NFD", value)
    value = "".join(char for char in value if unicodedata.category(char) != "Mn")
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value.lower()).strip("-")
    return value[:80] or "entreprise"


def request_json(url: str, retries: int = 5) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": "guad-entreprises-import/0.1"})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code != 429 or attempt == retries - 1:
                raise
            retry_after = exc.headers.get("Retry-After")
            wait = float(retry_after) if retry_after and retry_after.isdigit() else 2 ** (attempt + 1)
            print(f"429 API, pause {wait:.1f}s")
            time.sleep(wait)
    raise RuntimeError("unreachable")


def load_communes() -> list[dict[str, Any]]:
    with COMMUNES_GEOJSON.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    communes = []
    for feature in data["features"]:
        props = feature["properties"]
        postcodes = props.get("codesPostaux") or []
        communes.append({"code": props["code"], "name": props["nom"], "postcodes": postcodes})
    return sorted(communes, key=lambda item: item["code"])


def company_name(company: dict[str, Any]) -> str:
    return company.get("nom_complet") or company.get("nom_raison_sociale") or f"Entreprise {company['siren']}"


def establishment_name(company: dict[str, Any], establishment: dict[str, Any]) -> str:
    enseignes = establishment.get("liste_enseignes") or []
    return establishment.get("nom_commercial") or (enseignes[0] if enseignes else company_name(company))


def make_company(company: dict[str, Any]) -> dict[str, Any]:
    name = company_name(company)
    naf = company.get("activite_principale") or company.get("activite_principale_naf25")
    description = f"Entreprise enregistrée dans la base publique Sirene sous le code NAF {naf}." if naf else "Entreprise enregistrée dans la base publique Sirene."
    return {
        "id": f"c_{company['siren']}",
        "siren": company["siren"],
        "raisonSociale": company.get("nom_raison_sociale") or name,
        "nomCommercial": None,
        "formeJuridique": company.get("nature_juridique") or "Non renseignée",
        "dateCreation": company.get("date_creation") or "",
        "statut": "active" if company.get("etat_administratif") == "A" else "inactive",
        "trancheEffectif": company.get("tranche_effectif_salarie"),
        "descriptionCourte": description,
        "descriptionLongue": description + " Cette description est automatique et factuelle; aucun service commercial non vérifié n'est ajouté.",
        "descriptionSource": "naf_generated",
        "descriptionConfidence": "medium",
        "verified": False,
        "slug": slugify(name),
    }


def make_establishment(company: dict[str, Any], establishment: dict[str, Any]) -> dict[str, Any] | None:
    siret = establishment.get("siret")
    lat = establishment.get("latitude")
    lng = establishment.get("longitude")
    code_commune = establishment.get("commune")
    if not siret or not code_commune or not str(code_commune).startswith("971") or not lat or not lng:
        return None
    try:
        latitude = float(lat)
        longitude = float(lng)
    except ValueError:
        return None
    if not (15.75 <= latitude <= 16.6 and -61.95 <= longitude <= -60.9):
        return None
    naf = establishment.get("activite_principale") or establishment.get("activite_principale_naf25") or ""
    section = company.get("section_activite_principale") or (naf[:1] if naf else "")
    return {
        "id": f"e_{siret}",
        "companyId": f"c_{company['siren']}",
        "siret": siret,
        "isHeadOffice": bool(establishment.get("est_siege")),
        "enseigne": establishment_name(company, establishment),
        "codeNaf": naf,
        "libelleNaf": f"Code NAF {naf}" if naf else "Activité non renseignée",
        "secteurNormalise": SECTION_TO_SECTOR.get(section, "Secteur non classé"),
        "adresseComplete": establishment.get("adresse") or "",
        "codePostal": establishment.get("code_postal") or "",
        "commune": establishment.get("libelle_commune") or code_commune,
        "codeCommune": code_commune,
        "latitude": latitude,
        "longitude": longitude,
        "geocodingPrecision": "exact_address",
        "geocodingSource": "recherche-entreprises.api.gouv.fr",
        "statut": "active" if establishment.get("etat_administratif") == "A" else "inactive",
        "dateCreation": establishment.get("date_creation") or "",
    }


def import_commune(commune: dict[str, Any], per_page: int, max_pages: int, delay: float) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    companies: dict[str, dict[str, Any]] = {}
    establishments: dict[str, dict[str, Any]] = {}
    queries = [f"{commune['name']} {postcode}" for postcode in commune["postcodes"]]
    for query in queries:
        for page in range(1, max_pages + 1):
            params = urllib.parse.urlencode({"q": query, "page": page, "per_page": per_page})
            payload = request_json(f"{API_BASE}?{params}")
            results = payload.get("results") or []
            if not results:
                break
            for company in results:
                if "siren" not in company:
                    continue
                matching = company.get("matching_etablissements") or []
                for item in matching:
                    if item.get("etat_administratif") != "A":
                        continue
                    establishment = make_establishment(company, item)
                    if not establishment:
                        continue
                    companies[company["siren"]] = make_company(company)
                    establishments[establishment["siret"]] = establishment
            if len(results) < per_page:
                break
            time.sleep(delay)
    return companies, establishments


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-pages", type=int, default=20)
    parser.add_argument("--per-page", type=int, default=25)
    parser.add_argument("--delay", type=float, default=0.45)
    args = parser.parse_args()

    all_companies: dict[str, dict[str, Any]] = {}
    all_establishments: dict[str, dict[str, Any]] = {}
    for commune in load_communes():
        companies, establishments = import_commune(commune, args.per_page, args.max_pages, args.delay)
        all_companies.update(companies)
        all_establishments.update(establishments)
        print(f"{commune['code']} {commune['name']}: {len(establishments)} établissements géolocalisés")

    dataset = {
        "companies": sorted(all_companies.values(), key=lambda item: item["siren"]),
        "establishments": sorted(all_establishments.values(), key=lambda item: item["siret"]),
    }
    OUT_DATASET.write_text(json.dumps(dataset, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    metadata = {
        "datasetName": "Import API Recherche d'Entreprises Guadeloupe",
        "referenceDate": date.today().isoformat(),
        "source": "API Recherche d'Entreprises / Annuaire des Entreprises, filtrée sur établissements actifs géolocalisés en communes 971.",
        "establishmentCount": len(dataset["establishments"]),
        "coverageNotice": "Import réel géolocalisé mais non exhaustif. L'exhaustivité doit être obtenue par le stock SIRENE complet filtré Guadeloupe.",
    }
    OUT_METADATA.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(metadata, ensure_ascii=False))


if __name__ == "__main__":
    main()
