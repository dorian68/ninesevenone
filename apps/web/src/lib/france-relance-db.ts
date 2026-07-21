import "server-only";

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type FranceRelanceProjectRow = {
  id: number;
  source_row_number: number;
  siren: string;
  siret: string | null;
  beneficiary_identifier: string;
  identifier_type: "siren" | "siret";
  match_scope: "active_local_establishment" | "company_other_establishment" | "exact_legal_unit";
  match_confidence: number;
  project_location_scope: "guadeloupe" | "outside_guadeloupe" | "unknown";
  beneficiary_name: string;
  company_type: string | null;
  recovery_axis: string | null;
  measure: string;
  measure_label: string | null;
  project_description: string | null;
  sector: string | null;
  expected_co2_tonnes: number | null;
  update_date: string | null;
  region: string | null;
  department: string | null;
  department_code: string | null;
  commune: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  resource_id: string;
  resource_title: string;
  resource_url: string;
  resource_last_modified: string | null;
  source_updated_at: string;
  dataset_url: string;
  portal_url: string;
  license_name: string;
  license_url: string;
  imported_at: string;
};

export type FranceRelanceSummaryRow = {
  total: number;
  guadeloupe_count: number;
  outside_count: number;
  unknown_count: number;
  active_local_count: number;
  description_count: number;
  co2_metric_count: number;
  measure_count: number;
  sector_count: number;
  earliest_date: string | null;
  latest_date: string | null;
};

const candidates = [
  (process as unknown as { env: Record<string, string | undefined> }).env.FRANCE_RELANCE_DB_PATH,
  resolve((process as unknown as { cwd(): string }).cwd(), "data/france-relance-industrial-projects.sqlite"),
  resolve((process as unknown as { cwd(): string }).cwd(), "../../data/france-relance-industrial-projects.sqlite")
].filter((candidate): candidate is string => Boolean(candidate));

const databasePath = candidates.find(existsSync);
let database: DatabaseSync | null = null;

function getDatabase() {
  if (!databasePath) return null;
  database ??= new DatabaseSync(databasePath, { readOnly: true });
  return database;
}

export function getFranceRelanceProjectsBySiren(siren: string, limit = 100) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    `SELECT * FROM france_relance_industrial_projects
     WHERE siren = ?
     ORDER BY project_location_scope = 'guadeloupe' DESC,
              match_scope = 'active_local_establishment' DESC,
              update_date DESC, id DESC
     LIMIT ?`
  ).all(siren, Math.max(1, Math.min(limit, 200))) as unknown as FranceRelanceProjectRow[];
}

export function getFranceRelanceSummaryBySiren(siren: string) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    `SELECT COUNT(*) AS total,
       SUM(project_location_scope = 'guadeloupe') AS guadeloupe_count,
       SUM(project_location_scope = 'outside_guadeloupe') AS outside_count,
       SUM(project_location_scope = 'unknown') AS unknown_count,
       SUM(match_scope = 'active_local_establishment') AS active_local_count,
       SUM(project_description IS NOT NULL) AS description_count,
       SUM(expected_co2_tonnes IS NOT NULL) AS co2_metric_count,
       COUNT(DISTINCT measure) AS measure_count,
       COUNT(DISTINCT sector) AS sector_count,
       MIN(update_date) AS earliest_date, MAX(update_date) AS latest_date
     FROM france_relance_industrial_projects
     WHERE siren = ?`
  ).get(siren) as FranceRelanceSummaryRow | undefined ?? null;
}

export function getFranceRelanceMetadata() {
  const db = getDatabase();
  if (!db) return null;
  const rows = db.prepare("SELECT key, value FROM metadata").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}
