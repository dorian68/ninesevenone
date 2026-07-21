import "server-only";

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type OsmBusinessProfileRow = {
  element_type: "node" | "way" | "relation";
  osm_id: number;
  siren: string;
  siret: string;
  name: string | null;
  brand: string | null;
  operator_name: string | null;
  category_key: string | null;
  category_value: string | null;
  website: string | null;
  public_email: string | null;
  phone: string | null;
  opening_hours: string | null;
  wheelchair: string | null;
  internet_access: string | null;
  address: string | null;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  services_json: string;
  social_json: string;
  source_reference_date: string;
};

const candidates = [
  (process as unknown as { env: Record<string, string | undefined> }).env.OSM_BUSINESS_DB_PATH,
  resolve((process as unknown as { cwd(): string }).cwd(), "data/osm-business-profiles.sqlite"),
  resolve((process as unknown as { cwd(): string }).cwd(), "../../data/osm-business-profiles.sqlite")
].filter((candidate): candidate is string => Boolean(candidate));

const databasePath = candidates.find(existsSync);
let database: DatabaseSync | null = null;
let searchRowsCache: Array<Pick<OsmBusinessProfileRow, "siren" | "name" | "brand" | "operator_name" | "category_key" | "category_value" | "description" | "services_json" | "source_reference_date">> | null = null;

function getDatabase() {
  if (!databasePath) return null;
  database ??= new DatabaseSync(databasePath, { readOnly: true });
  return database;
}

export function getOsmBusinessProfilesBySiren(siren: string) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    "SELECT * FROM osm_business_profiles WHERE siren = ? ORDER BY name, element_type, osm_id"
  ).all(siren) as unknown as OsmBusinessProfileRow[];
}

export function getOsmBusinessSearchRows() {
  const db = getDatabase();
  if (!db) return null;
  if (searchRowsCache) return searchRowsCache;
  searchRowsCache = db.prepare(
   `SELECT siren, name, brand, operator_name, category_key, category_value, description,
           services_json, source_reference_date
    FROM osm_business_profiles`
 ).all() as Array<Pick<OsmBusinessProfileRow, "siren" | "name" | "brand" | "operator_name" | "category_key" | "category_value" | "description" | "services_json" | "source_reference_date">>;
  return searchRowsCache;
}

export function getOsmBusinessMetadata() {
  const db = getDatabase();
  if (!db) return null;
  const rows = db.prepare("SELECT key, value FROM metadata").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}
