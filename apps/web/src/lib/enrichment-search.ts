import "server-only";

import { searchBodaccSignals } from "@/lib/bodacc-db";
import { getOsmBusinessSearchRows } from "@/lib/osm-business-db";
import { searchPressSignals } from "@/lib/press-signals-db";
import { getWebsiteEnrichmentSearchRows } from "@/lib/website-enrichment-db";

export type EnrichmentSearchHit = {
  siren: string;
  source: string;
  sourceReferenceDate: string | null;
  score: number;
  matchedText: string;
};

function normalize(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr").replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(value: string) {
  return normalize(value).split(/\s+/).filter((token) => token.length >= 2);
}

function jsonText(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.flatMap((item) => typeof item === "object" && item !== null && "name" in item && typeof item.name === "string" ? [item.name] : []);
    if (typeof parsed === "object" && parsed !== null) return Object.entries(parsed).flatMap(([key, item]) => typeof item === "string" ? [`${key} ${item}`] : []);
  } catch {
    return [];
  }
  return [];
}

function addHit(hits: Map<string, EnrichmentSearchHit>, siren: string, source: string, sourceReferenceDate: string | null, fields: string[], queryTokens: string[]) {
  if (!/^\d{9}$/.test(siren)) return;
  const normalizedFields = fields.filter(Boolean).map(normalize);
  const haystack = normalizedFields.join(" ");
  if (!queryTokens.length || !queryTokens.every((token) => haystack.includes(token))) return;
  const matchedText = fields.find((field) => queryTokens.every((token) => normalize(field).includes(token))) ?? fields.find(Boolean) ?? "Signal public";
  const sourceBoost = source === "Site professionnel public" || source === "BODACC" ? 5 : 4;
  const nameBoost = normalizedFields[0]?.includes(queryTokens.join(" ")) ? 5 : 0;
  const score = sourceBoost + nameBoost + queryTokens.length;
  const current = hits.get(siren);
  if (!current || score > current.score) hits.set(siren, { siren, source, sourceReferenceDate, score, matchedText: matchedText.slice(0, 180) });
}

export function searchEnrichmentSignals(rawQuery: string, limit = 24) {
  const queryTokens = tokens(rawQuery);
  if (!queryTokens.length) return [];
  const hits = new Map<string, EnrichmentSearchHit>();
  for (const row of getWebsiteEnrichmentSearchRows() ?? []) {
    addHit(hits, row.siren, "Site professionnel public", row.source_reference_date ?? row.fetched_at, [
      row.source_name ?? "", row.hostname ?? "", row.title ?? "", row.description ?? "", ...jsonText(row.services_json)
    ], queryTokens);
  }
  for (const row of getOsmBusinessSearchRows() ?? []) {
    addHit(hits, row.siren, "OpenStreetMap", row.source_reference_date, [
      row.name ?? "", row.brand ?? "", row.operator_name ?? "", row.category_key ?? "", row.category_value ?? "", row.description ?? "", ...jsonText(row.services_json)
    ], queryTokens);
  }
  for (const row of searchBodaccSignals(rawQuery, limit * 2) ?? []) {
    addHit(hits, row.siren, "BODACC", row.publication_date, [
      row.family_label ?? "",
      row.activity_text ?? "",
      row.city ?? "",
      row.tribunal ?? ""
    ], queryTokens);
  }
  for (const row of searchPressSignals(rawQuery, limit * 2) ?? []) {
    addHit(hits, row.siren, "Presse", row.published_at ?? row.retrieved_at, [row.title, row.domain ?? "", row.query_name], queryTokens);
  }
  return [...hits.values()].sort((left, right) => right.score - left.score || left.siren.localeCompare(right.siren)).slice(0, limit);
}
