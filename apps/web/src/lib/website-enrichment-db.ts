import "server-only";

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type WebsiteEnrichmentRow = {
  siren: string;
  siret: string;
  source_name: string | null;
  source_origin: string | null;
  input_url: string;
  final_url: string | null;
  hostname: string | null;
  source_reference_date: string | null;
  robots_status: string;
  fetch_status: string;
  http_status: number | null;
  title: string | null;
  canonical_url: string | null;
  description: string | null;
  description_source: string | null;
  services_json: string;
  social_json: string;
  structured_types_json: string;
  language: string | null;
  meta_robots_restricted: number;
  content_hash: string | null;
  last_modified: string | null;
  fetched_at: string;
  error_detail: string | null;
};

const candidates = [
  (process as unknown as { env: Record<string, string | undefined> }).env.WEBSITE_ENRICHMENT_DB_PATH,
  resolve((process as unknown as { cwd(): string }).cwd(), "data/website-enrichments.sqlite"),
  resolve((process as unknown as { cwd(): string }).cwd(), "../../data/website-enrichments.sqlite")
].filter((candidate): candidate is string => Boolean(candidate));

const databasePath = candidates.find(existsSync);
let database: DatabaseSync | null = null;
let searchRowsCache: Array<Pick<WebsiteEnrichmentRow, "siren" | "source_origin" | "source_name" | "hostname" | "title" | "description" | "services_json" | "fetched_at" | "source_reference_date">> | null = null;

function getDatabase() {
  if (!databasePath) return null;
  database ??= new DatabaseSync(databasePath, { readOnly: true });
  return database;
}

export function getWebsiteEnrichmentsBySiren(siren: string) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    "SELECT * FROM website_enrichments WHERE siren = ? ORDER BY fetch_status = 'ok' DESC, source_name, input_url"
  ).all(siren) as unknown as WebsiteEnrichmentRow[];
}

export function getWebsiteEnrichmentSearchRows() {
  const db = getDatabase();
  if (!db) return null;
  if (searchRowsCache) return searchRowsCache;
  searchRowsCache = db.prepare(
   `SELECT siren, source_origin, source_name, hostname, title, description, services_json,
           fetched_at, source_reference_date
    FROM website_enrichments
    WHERE fetch_status = 'ok'`
 ).all() as Array<Pick<WebsiteEnrichmentRow, "siren" | "source_origin" | "source_name" | "hostname" | "title" | "description" | "services_json" | "fetched_at" | "source_reference_date">>;
  return searchRowsCache;
}

export function getWebsiteEnrichmentMetadata() {
  const db = getDatabase();
  if (!db) return null;
  const rows = db.prepare("SELECT key, value FROM metadata").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}
