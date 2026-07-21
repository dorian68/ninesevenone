import { NextRequest, NextResponse } from "next/server";
import { searchEstablishments } from "@/lib/search";
import {
  getEnterpriseCompanyBySiren,
  getEnterpriseFilterOptions,
  getEnterpriseLocationsBySiren,
  searchEnterpriseDatabase
} from "@/lib/enterprise-db";
import { parseStructuredSearch } from "@/lib/search-query";
import { searchPublicOfficers, type PublicOfficerRow } from "@/lib/public-officers-db";
import { searchEnrichmentSignals, type EnrichmentSearchHit } from "@/lib/enrichment-search";
import { getNafLabel } from "@/lib/naf";

const OFFICIAL_SEARCH_API = "https://recherche-entreprises.api.gouv.fr/search";
type SearchResult = {
  establishmentId: string;
  companyId: string;
  siren: string;
  siret: string;
  name: string;
  legalName: string;
  commune: string;
  sector: string;
  nafCode: string;
  address: string;
  description: string;
  latitude: number | null;
  longitude: number | null;
  verified: boolean;
  slug: string;
  url: string;
  matchType: "entreprise" | "dirigeant";
  matchedOfficer: { name: string; role: string } | null;
  source?: string;
  sourceUpdatedAt?: string | null;
  matchedSignal?: string;
};
type SearchSuggestion = {
  id: string;
  kind: "company" | "director" | "commune" | "sector";
  title: string;
  subtitle: string;
  source: string;
  result?: SearchResult;
};
const sectorBySection: Record<string, string> = {
  A: "Agriculture, pêche et ressources",
  B: "Industrie et énergie",
  C: "Industrie et fabrication",
  D: "Industrie et énergie",
  E: "Eau, déchets et environnement",
  F: "Construction et immobilier",
  G: "Commerce et distribution",
  H: "Transport et logistique",
  I: "Hébergement et restauration",
  J: "Numérique, médias et communication",
  K: "Finance et assurance",
  L: "Immobilier",
  M: "Services aux entreprises",
  N: "Services administratifs et support",
  O: "Administration publique",
  P: "Enseignement",
  Q: "Santé et action sociale",
  R: "Arts, culture, sport et loisirs",
  S: "Services de proximité"
};

function slugify(value: string) {
  return value.toLocaleLowerCase("fr").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function normalize(value: string) {
  return value.toLocaleLowerCase("fr").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function officerSearchQuery(raw: string) {
  return raw.replace(/^(dirigeant|mandataire|directeur)\s*:\s*/i, "").trim();
}

function localOfficerResult(row: PublicOfficerRow): SearchResult {
  const company = getEnterpriseCompanyBySiren(row.siren);
  const locations = getEnterpriseLocationsBySiren(row.siren) ?? [];
  const location = locations.find((item) => item.is_head_office) ?? locations[0];
  const legalName = company?.legal_name ?? location?.legal_name ?? `Entreprise ${row.siren}`;
  const commune = location?.commune ?? "Guadeloupe";
  return {
    establishmentId: location ? `db_${location.siret}` : `officer_${row.id}`,
    companyId: `db_company_${row.siren}`,
    siren: row.siren,
    siret: location?.siret ?? "",
    name: location?.trade_name ?? company?.usual_name ?? legalName,
    legalName,
    commune,
    sector: location?.sector ?? "Secteur non renseigné",
    nafCode: location?.naf_code ?? "Non renseigné",
    address: location?.address ?? commune,
    description: location?.naf_code && getNafLabel(location.naf_code)
      ? `Activité principale : ${getNafLabel(location.naf_code)} (code NAF ${location.naf_code}).`
      : location?.description ?? "Activité enregistrée dans les données publiques SIRENE.",
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
    verified: false,
    slug: slugify(legalName),
    url: `/entreprises/${slugify(commune)}/${slugify(legalName)}-${row.siren}`,
    matchType: "dirigeant",
    matchedOfficer: { name: row.display_name, role: row.role },
    source: row.source,
    sourceUpdatedAt: row.source_updated_at,
  };
}

function localEnrichmentResult(hit: EnrichmentSearchHit): SearchResult | null {
  const company = getEnterpriseCompanyBySiren(hit.siren);
  const locations = (getEnterpriseLocationsBySiren(hit.siren) ?? []).filter((item) => item.administrative_status === "A");
  const location = locations.find((item) => item.is_head_office) ?? locations[0];
  if (!location) return null;
  const legalName = company?.legal_name ?? location.legal_name;
  const name = location.trade_name ?? company?.usual_name ?? legalName;
  return {
    establishmentId: `db_${location.siret}`,
    companyId: `db_company_${hit.siren}`,
    siren: hit.siren,
    siret: location.siret,
    name,
    legalName,
    commune: location.commune,
    sector: location.sector,
    nafCode: location.naf_code ?? "Non renseigné",
    address: location.address ?? location.commune,
    description: location.naf_code && getNafLabel(location.naf_code)
      ? `Activité principale : ${getNafLabel(location.naf_code)} (code NAF ${location.naf_code}).`
      : location.description,
    latitude: location.latitude,
    longitude: location.longitude,
    verified: false,
    slug: slugify(legalName),
    url: `/entreprises/${slugify(location.commune)}/${slugify(legalName)}-${hit.siren}`,
    matchType: "entreprise",
    matchedOfficer: null,
    source: hit.source,
    sourceUpdatedAt: hit.sourceReferenceDate,
    matchedSignal: hit.matchedText
  };
}

function officialOfficerMatch(result: Record<string, unknown>, rawQuery: string) {
  const tokens = normalize(officerSearchQuery(rawQuery)).split(/\s+/).filter(Boolean);
  const officers = Array.isArray(result.dirigeants) ? result.dirigeants as Array<Record<string, unknown>> : [];
  return officers.find((officer) => {
    const name = normalize([officer.prenoms, officer.nom, officer.denomination].filter((value): value is string => typeof value === "string").join(" "));
    return tokens.length > 0 && tokens.every((token) => name.includes(token));
  });
}

async function searchOfficialDirectory(rawQuery: string): Promise<SearchResult[]> {
  const query = officerSearchQuery(rawQuery);
  if (query.length < 3) return [];
  const url = new URL(OFFICIAL_SEARCH_API);
  url.searchParams.set("q", query);
  url.searchParams.set("departement", "971");
  url.searchParams.set("per_page", "8");
  url.searchParams.set("minimal", "true");
  url.searchParams.set("include", "dirigeants,siege,matching_etablissements");
  url.searchParams.set("limite_matching_etablissements", "10");
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Guadeloupe-Entreprises-BI/0.2 (+https://recherche-entreprises.api.gouv.fr/docs/)" },
      next: { revalidate: 300 }
    });
    if (!response.ok) return [];
    const payload = await response.json() as { results?: Array<Record<string, unknown>> };
    return (payload.results ?? []).map((result): SearchResult => {
      const siren = typeof result.siren === "string" ? result.siren : "";
      const matching = Array.isArray(result.matching_etablissements) ? result.matching_etablissements as Array<Record<string, unknown>> : [];
      const local = matching.find((item) => String(item.code_postal ?? "").startsWith("971") && item.etat_administratif === "A");
      const seat = (typeof result.siege === "object" && result.siege !== null ? result.siege : {}) as Record<string, unknown>;
      const establishment = local ?? seat;
      const legalName = typeof result.nom_raison_sociale === "string" && result.nom_raison_sociale
        ? result.nom_raison_sociale
        : typeof result.nom_complet === "string" ? result.nom_complet : `Entreprise ${siren}`;
      const commune = typeof establishment.libelle_commune === "string"
        ? establishment.libelle_commune
        : typeof establishment.commune === "string" ? establishment.commune : "Guadeloupe";
      const naf = typeof result.activite_principale === "string" ? result.activite_principale : "";
      const officer = officialOfficerMatch(result, rawQuery);
      const name = typeof establishment.nom_commercial === "string" && establishment.nom_commercial
        ? establishment.nom_commercial
        : legalName;
      return {
        establishmentId: typeof establishment.siret === "string" ? `annuaire_${establishment.siret}` : `annuaire_${siren}`,
        companyId: `annuaire_company_${siren}`,
        siren,
        siret: typeof establishment.siret === "string" ? establishment.siret : "",
        name,
        legalName,
        commune,
        sector: sectorBySection[String(result.section_activite_principale ?? "")] ?? "Secteur non renseigné",
        nafCode: naf || "Non renseigné",
        address: typeof establishment.adresse === "string" ? establishment.adresse : commune,
        description: naf
          ? `Activité principale : ${getNafLabel(naf) ?? `code NAF ${naf}`}.`
          : "Entreprise référencée dans les données publiques de l’Annuaire des Entreprises.",
        latitude: typeof establishment.latitude === "string" ? Number(establishment.latitude) : null,
        longitude: typeof establishment.longitude === "string" ? Number(establishment.longitude) : null,
        verified: false,
        slug: slugify(legalName),
        url: `/entreprises/${slugify(commune)}/${slugify(legalName)}-${siren}`,
        matchType: officer ? "dirigeant" : "entreprise",
        matchedOfficer: officer ? {
          name: [officer.prenoms, officer.nom, officer.denomination].filter((value): value is string => typeof value === "string" && value.length > 0).join(" "),
          role: typeof officer.qualite === "string" ? officer.qualite : "Qualité non renseignée"
        } : null,
        source: "API Recherche d'entreprises / Annuaire des Entreprises",
        sourceUpdatedAt: typeof result.date_mise_a_jour_rne === "string" ? result.date_mise_a_jour_rne : null
      };
    }).filter((result) => result.siren.length === 9);
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const suggest = request.nextUrl.searchParams.get("suggest") === "true";
  const structured = parseStructuredSearch(q);
  const databaseResults: SearchResult[] = (searchEnterpriseDatabase(q) ?? searchEstablishments(q).map((entry) => ({
    establishmentId: entry.id,
    companyId: entry.companyId,
    siren: entry.company.siren,
    name: entry.enseigne ?? entry.company.nomCommercial ?? entry.company.raisonSociale,
    commune: entry.commune,
    sector: entry.secteurNormalise,
    description: entry.company.descriptionCourte,
    latitude: entry.latitude,
    longitude: entry.longitude,
    legalName: entry.company.raisonSociale,
    siret: entry.siret,
    address: entry.adresseComplete,
    nafCode: entry.codeNaf,
    verified: entry.company.verified,
    slug: entry.company.slug,
    matchType: "entreprise",
    matchedOfficer: null,
    url: `/entreprises/${entry.commune.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, "-")}/${entry.company.slug}-${entry.company.siren}`
  }))) as SearchResult[];
  const officers = structured ? [] : (searchPublicOfficers(officerSearchQuery(q)) ?? []).map(localOfficerResult);
  const enrichmentQuery = structured?.scope === "presse" ? structured.value : structured ? "" : officerSearchQuery(q);
  const enrichmentResults = searchEnrichmentSignals(enrichmentQuery).map(localEnrichmentResult).filter((result): result is SearchResult => Boolean(result));
  const combined: SearchResult[] = [...officers, ...enrichmentResults, ...databaseResults];
  const seen = new Set<string>();
  const local = combined.filter((result) => {
    const key = `${result.siren}:${result.matchType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const localCount = local.length;
  const normalizedQuery = structured ? "" : officerSearchQuery(q);
  const explicitDirectorSuggestion = suggest && /^\s*(dirigeant|mandataire|directeur)\s*:/i.test(q);
  const remote = (!suggest || explicitDirectorSuggestion) && normalizedQuery.length >= 3 && /[a-zA-ZÀ-ÿ]/.test(normalizedQuery)
    ? await searchOfficialDirectory(q)
    : [];
  for (const result of remote) {
    const key = `${result.siren}:${result.matchType}`;
    if (!seen.has(key)) {
      seen.add(key);
      local.push(result);
    }
  }
  const suggestions: SearchSuggestion[] = [];
  const suggestionKeys = new Set<string>();
  const addSuggestion = (suggestion: SearchSuggestion) => {
    if (suggestionKeys.has(suggestion.id)) return;
    suggestionKeys.add(suggestion.id);
    suggestions.push(suggestion);
  };
  for (const result of local) {
    if (result.matchType === "dirigeant" && result.matchedOfficer) {
      addSuggestion({
        id: `director:${result.matchedOfficer.name}:${result.siren}`,
        kind: "director",
        title: result.matchedOfficer.name,
        subtitle: `${result.matchedOfficer.role} · ${result.name} · ${result.commune}`,
        source: result.source ?? "Mandat public",
        result
      });
      continue;
    }
    addSuggestion({
      id: `company:${result.siren}`,
      kind: "company",
      title: result.name,
      subtitle: `${result.commune} · ${result.sector}${result.nafCode !== "Non renseigné" ? ` · ${result.nafCode}` : ""}${result.matchedSignal ? ` · signal : ${result.matchedSignal}` : ""}`,
      source: result.source ?? "SIRENE",
      result
    });
  }
  const optionQuery = normalize(officerSearchQuery(q));
  if (!q.trim().toLowerCase().startsWith("dirigeant:") && optionQuery.length >= 2) {
    const options = getEnterpriseFilterOptions();
    for (const communeOption of options?.communes ?? []) {
      if (normalize(communeOption).startsWith(optionQuery)) addSuggestion({ id: `commune:${communeOption}`, kind: "commune", title: communeOption, subtitle: "Commune de Guadeloupe", source: "SIRENE" });
    }
    for (const sectorOption of options?.sectors ?? []) {
      if (normalize(sectorOption).startsWith(optionQuery)) addSuggestion({ id: `sector:${sectorOption}`, kind: "sector", title: sectorOption, subtitle: "Secteur économique", source: "SIRENE" });
    }
  }
  return NextResponse.json({
    results: local.slice(0, 24),
    suggestions: suggest ? suggestions.slice(0, 8) : undefined,
    metadata: { localCount, officialSearch: remote.length > 0 }
  }, {
    headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=300" }
  });
}
