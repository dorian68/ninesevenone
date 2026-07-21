import "server-only";

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type FondsVertProjectRow = {
  id: number;
  source_row_number: number;
  year: number;
  siren: string;
  siret: string | null;
  beneficiary_identifier: string;
  identifier_type: "siren" | "siret";
  match_scope: "active_local_establishment" | "company_other_establishment" | "exact_legal_unit";
  match_confidence: number;
  project_location_scope: "guadeloupe" | "outside_guadeloupe" | "unknown";
  project_name: string;
  project_summary: string | null;
  committed_amount: number;
  beneficiary_name: string;
  beneficiary_legal_form: string | null;
  dossier_number: string | null;
  commitment_number: string | null;
  operator_number: string | null;
  operator: string | null;
  scheme: string | null;
  axis: string | null;
  region: string | null;
  department: string | null;
  department_code: string | null;
  commune: string | null;
  commune_code: string | null;
  resource_id: string;
  resource_title: string;
  resource_url: string;
  resource_last_modified: string | null;
  source_updated_at: string;
  dataset_url: string;
  license_name: string;
  license_url: string;
  imported_at: string;
};

export type FondsVertSummaryRow = {
  total: number;
  total_amount: number | null;
  guadeloupe_count: number;
  guadeloupe_amount: number | null;
  outside_count: number;
  outside_amount: number | null;
  unknown_count: number;
  active_local_count: number;
  active_local_amount: number | null;
  scheme_count: number;
  earliest_year: number | null;
  latest_year: number | null;
};

const candidates = [
  (process as unknown as { env: Record<string, string | undefined> }).env.FONDS_VERT_DB_PATH,
  resolve((process as unknown as { cwd(): string }).cwd(), "data/fonds-vert-projects.sqlite"),
  resolve((process as unknown as { cwd(): string }).cwd(), "../../data/fonds-vert-projects.sqlite")
].filter((candidate): candidate is string => Boolean(candidate));

const databasePath = candidates.find(existsSync);
let database: DatabaseSync | null = null;

function getDatabase() {
  if (!databasePath) return null;
  database ??= new DatabaseSync(databasePath, { readOnly: true });
  return database;
}

export function getFondsVertProjectsBySiren(siren: string, limit = 100) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    `SELECT * FROM fonds_vert_projects
     WHERE siren = ?
     ORDER BY project_location_scope = 'guadeloupe' DESC,
              match_scope = 'active_local_establishment' DESC,
              year DESC, committed_amount DESC, id DESC
     LIMIT ?`
  ).all(siren, Math.max(1, Math.min(limit, 200))) as unknown as FondsVertProjectRow[];
}

export function getFondsVertSummaryBySiren(siren: string) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    `SELECT COUNT(*) AS total, SUM(committed_amount) AS total_amount,
       SUM(project_location_scope = 'guadeloupe') AS guadeloupe_count,
       SUM(CASE WHEN project_location_scope = 'guadeloupe' THEN committed_amount ELSE 0 END) AS guadeloupe_amount,
       SUM(project_location_scope = 'outside_guadeloupe') AS outside_count,
       SUM(CASE WHEN project_location_scope = 'outside_guadeloupe' THEN committed_amount ELSE 0 END) AS outside_amount,
       SUM(project_location_scope = 'unknown') AS unknown_count,
       SUM(match_scope = 'active_local_establishment') AS active_local_count,
       SUM(CASE WHEN match_scope = 'active_local_establishment' THEN committed_amount ELSE 0 END) AS active_local_amount,
       COUNT(DISTINCT scheme) AS scheme_count,
       MIN(year) AS earliest_year, MAX(year) AS latest_year
     FROM fonds_vert_projects
     WHERE siren = ?`
  ).get(siren) as FondsVertSummaryRow | undefined ?? null;
}

export function getFondsVertMetadata() {
  const db = getDatabase();
  if (!db) return null;
  const rows = db.prepare("SELECT key, value FROM metadata").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}
