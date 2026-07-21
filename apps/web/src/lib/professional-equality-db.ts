import "server-only";

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type EqualityScoreStatus = "calculated" | "not_calculable" | "not_applicable" | "invalid";

export type ProfessionalEqualityRow = {
  id: number;
  source_row_number: number;
  siren: string;
  declaring_siren: string;
  match_scope: "exact_declarant" | "ues_member";
  match_confidence: number;
  reference_year: number;
  structure_type: "company" | "ues";
  workforce_band: string | null;
  ues_name: string | null;
  ues_member_count: number | null;
  declaration_location_scope: "guadeloupe" | "outside_guadeloupe";
  declaring_region: string | null;
  declaring_department: string | null;
  declaring_country: string | null;
  naf_code: string | null;
  naf_label: string | null;
  pay_gap_score: number | null;
  pay_gap_status: EqualityScoreStatus;
  raise_gap_no_promotion_score: number | null;
  raise_gap_no_promotion_status: EqualityScoreStatus;
  promotion_gap_score: number | null;
  promotion_gap_status: EqualityScoreStatus;
  raise_gap_score: number | null;
  raise_gap_status: EqualityScoreStatus;
  maternity_return_score: number | null;
  maternity_return_status: EqualityScoreStatus;
  highest_remuneration_score: number | null;
  highest_remuneration_status: EqualityScoreStatus;
  index_score: number | null;
  index_status: EqualityScoreStatus;
  resource_id: string;
  resource_title: string;
  resource_url: string;
  resource_last_modified: string | null;
  source_updated_at: string;
  dataset_url: string;
  egapro_url: string;
  license_name: string;
  license_url: string;
  imported_at: string;
};

export type ProfessionalEqualitySummaryRow = {
  total: number;
  calculable_count: number;
  non_calculable_count: number;
  direct_count: number;
  ues_count: number;
  guadeloupe_count: number;
  earliest_year: number | null;
  latest_year: number | null;
  latest_calculable_year: number | null;
};

const candidates = [
  (process as unknown as { env: Record<string, string | undefined> }).env.PROFESSIONAL_EQUALITY_DB_PATH,
  resolve((process as unknown as { cwd(): string }).cwd(), "data/professional-equality-index.sqlite"),
  resolve((process as unknown as { cwd(): string }).cwd(), "../../data/professional-equality-index.sqlite")
].filter((candidate): candidate is string => Boolean(candidate));

const databasePath = candidates.find(existsSync);
let database: DatabaseSync | null = null;

function getDatabase() {
  if (!databasePath) return null;
  database ??= new DatabaseSync(databasePath, { readOnly: true });
  return database;
}

export function getProfessionalEqualityBySiren(siren: string, limit = 20) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    `SELECT * FROM professional_equality_declarations
     WHERE siren = ?
     ORDER BY reference_year DESC, match_scope = 'exact_declarant' DESC, id DESC
     LIMIT ?`
  ).all(siren, Math.max(1, Math.min(limit, 50))) as unknown as ProfessionalEqualityRow[];
}

export function getProfessionalEqualitySummaryBySiren(siren: string) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    `SELECT COUNT(*) AS total,
       SUM(index_status = 'calculated') AS calculable_count,
       SUM(index_status = 'not_calculable') AS non_calculable_count,
       SUM(match_scope = 'exact_declarant') AS direct_count,
       SUM(match_scope = 'ues_member') AS ues_count,
       SUM(declaration_location_scope = 'guadeloupe') AS guadeloupe_count,
       MIN(reference_year) AS earliest_year,
       MAX(reference_year) AS latest_year,
       MAX(CASE WHEN index_status = 'calculated' THEN reference_year END) AS latest_calculable_year
     FROM professional_equality_declarations
     WHERE siren = ?`
  ).get(siren) as ProfessionalEqualitySummaryRow | undefined ?? null;
}

export function getProfessionalEqualityMetadata() {
  const db = getDatabase();
  if (!db) return null;
  const rows = db.prepare("SELECT key, value FROM metadata").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}
