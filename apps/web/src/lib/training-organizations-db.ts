import "server-only";

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type TrainingOrganizationRow = {
  id: number;
  source_row_number: number;
  siren: string;
  siret: string | null;
  match_scope: "active_local_establishment" | "company_other_establishment" | "exact_legal_unit";
  match_confidence: number;
  registration_location_scope: "guadeloupe" | "outside_guadeloupe" | "unknown";
  activity_declaration_number: string;
  previous_activity_numbers: string | null;
  postal_code: string | null;
  city: string | null;
  region_code: string | null;
  quality_training: number | null;
  quality_skills_assessment: number | null;
  quality_vae: number | null;
  quality_apprenticeship: number | null;
  is_quality_certified: number;
  last_declaration_date: string | null;
  exercise_start_date: string | null;
  exercise_end_date: string | null;
  specialty_code_1: string | null;
  specialty_label_1: string | null;
  specialty_code_2: string | null;
  specialty_label_2: string | null;
  specialty_code_3: string | null;
  specialty_label_3: string | null;
  trainee_count: number | null;
  entrusted_trainee_count: number | null;
  trainer_count: number | null;
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

export type TrainingOrganizationSummaryRow = {
  total: number;
  guadeloupe_count: number;
  outside_count: number;
  active_local_count: number;
  quality_count: number;
  specialty_count: number;
  metrics_count: number;
  training_quality_count: number;
  skills_quality_count: number;
  vae_quality_count: number;
  apprenticeship_quality_count: number;
  earliest_declaration: string | null;
  latest_declaration: string | null;
  latest_exercise_end: string | null;
};

const candidates = [
  (process as unknown as { env: Record<string, string | undefined> }).env.TRAINING_ORGANIZATIONS_DB_PATH,
  resolve((process as unknown as { cwd(): string }).cwd(), "data/training-organizations.sqlite"),
  resolve((process as unknown as { cwd(): string }).cwd(), "../../data/training-organizations.sqlite")
].filter((candidate): candidate is string => Boolean(candidate));

const databasePath = candidates.find(existsSync);
let database: DatabaseSync | null = null;

function getDatabase() {
  if (!databasePath) return null;
  database ??= new DatabaseSync(databasePath, { readOnly: true });
  return database;
}

export function getTrainingOrganizationsBySiren(siren: string, limit = 50) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    `SELECT * FROM training_organization_profiles
     WHERE siren = ?
     ORDER BY registration_location_scope = 'guadeloupe' DESC,
              match_scope = 'active_local_establishment' DESC,
              is_quality_certified DESC,
              last_declaration_date DESC, id DESC
     LIMIT ?`
  ).all(siren, Math.max(1, Math.min(limit, 100))) as unknown as TrainingOrganizationRow[];
}

export function getTrainingOrganizationSummaryBySiren(siren: string) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    `SELECT COUNT(*) AS total,
       SUM(registration_location_scope = 'guadeloupe') AS guadeloupe_count,
       SUM(registration_location_scope = 'outside_guadeloupe') AS outside_count,
       SUM(match_scope = 'active_local_establishment') AS active_local_count,
       SUM(is_quality_certified = 1) AS quality_count,
       SUM(specialty_code_1 IS NOT NULL OR specialty_label_1 IS NOT NULL) AS specialty_count,
       SUM(trainee_count IS NOT NULL OR trainer_count IS NOT NULL) AS metrics_count,
       SUM(quality_training = 1) AS training_quality_count,
       SUM(quality_skills_assessment = 1) AS skills_quality_count,
       SUM(quality_vae = 1) AS vae_quality_count,
       SUM(quality_apprenticeship = 1) AS apprenticeship_quality_count,
       MIN(last_declaration_date) AS earliest_declaration,
       MAX(last_declaration_date) AS latest_declaration,
       MAX(exercise_end_date) AS latest_exercise_end
     FROM training_organization_profiles
     WHERE siren = ?`
  ).get(siren) as TrainingOrganizationSummaryRow | undefined ?? null;
}

export function getTrainingOrganizationsMetadata() {
  const db = getDatabase();
  if (!db) return null;
  const rows = db.prepare("SELECT key, value FROM metadata").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}
