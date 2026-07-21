import "server-only";

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type FinancialExerciseRow = {
  id: number;
  siren: string;
  closing_date: string;
  statement_type: "C" | "K" | "S";
  confidentiality: string;
  is_partially_confidential: number;
  date_quality: "published" | "future_closing_date";
  metric_count: number;
  chiffre_d_affaires: number | null;
  marge_brute: number | null;
  ebe: number | null;
  ebit: number | null;
  resultat_net: number | null;
  taux_d_endettement: number | null;
  ratio_de_liquidite: number | null;
  ratio_de_vetuste: number | null;
  autonomie_financiere: number | null;
  poids_bfr_exploitation_sur_ca: number | null;
  couverture_des_interets: number | null;
  caf_sur_ca: number | null;
  capacite_de_remboursement: number | null;
  marge_ebe: number | null;
  resultat_courant_avant_impots_sur_ca: number | null;
  poids_bfr_exploitation_sur_ca_jours: number | null;
  rotation_des_stocks_jours: number | null;
  credit_clients_jours: number | null;
  credit_fournisseurs_jours: number | null;
  source_updated_at: string;
  dataset_url: string;
  license_name: string;
  license_url: string;
};

export type FinancialSummaryRow = {
  total: number;
  public_count: number;
  partially_confidential_count: number;
  complete_count: number;
  simplified_count: number;
  consolidated_count: number;
  earliest_closing_date: string | null;
  latest_closing_date: string | null;
};

export type FinancialMetricDefinitionRow = {
  field_name: string;
  label: string;
  value_type: string;
  unit: "EUR" | "percent" | "days" | "ratio";
  description: string | null;
  formula_ck: string | null;
  formula_s: string | null;
};

const candidates = [
  (process as unknown as { env: Record<string, string | undefined> }).env.FINANCIAL_RATIOS_DB_PATH,
  resolve((process as unknown as { cwd(): string }).cwd(), "data/financial-ratios.sqlite"),
  resolve((process as unknown as { cwd(): string }).cwd(), "../../data/financial-ratios.sqlite")
].filter((candidate): candidate is string => Boolean(candidate));

const databasePath = candidates.find(existsSync);
let database: DatabaseSync | null = null;

function getDatabase() {
  if (!databasePath) return null;
  database ??= new DatabaseSync(databasePath, { readOnly: true });
  return database;
}

const exerciseColumns = `id, siren, closing_date, statement_type, confidentiality,
  is_partially_confidential, date_quality, metric_count, chiffre_d_affaires,
  marge_brute, ebe, ebit, resultat_net, taux_d_endettement, ratio_de_liquidite,
  ratio_de_vetuste, autonomie_financiere, poids_bfr_exploitation_sur_ca,
  couverture_des_interets, caf_sur_ca, capacite_de_remboursement, marge_ebe,
  resultat_courant_avant_impots_sur_ca, poids_bfr_exploitation_sur_ca_jours,
  rotation_des_stocks_jours, credit_clients_jours, credit_fournisseurs_jours,
  source_updated_at, dataset_url, license_name, license_url`;

export function getFinancialExercisesBySiren(siren: string, limit = 60) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    `SELECT ${exerciseColumns}
     FROM financial_exercises
     WHERE siren = ?
     ORDER BY date_quality = 'published' DESC, closing_date DESC,
       CASE statement_type WHEN 'C' THEN 1 WHEN 'S' THEN 2 ELSE 3 END
     LIMIT ?`
  ).all(siren, Math.max(1, Math.min(limit, 60))) as unknown as FinancialExerciseRow[];
}

export function getFinancialSummaryBySiren(siren: string) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    `SELECT COUNT(*) AS total,
       COALESCE(SUM(is_partially_confidential = 0), 0) AS public_count,
       COALESCE(SUM(is_partially_confidential = 1), 0) AS partially_confidential_count,
       COALESCE(SUM(statement_type = 'C'), 0) AS complete_count,
       COALESCE(SUM(statement_type = 'S'), 0) AS simplified_count,
       COALESCE(SUM(statement_type = 'K'), 0) AS consolidated_count,
       MIN(CASE WHEN date_quality = 'published' THEN closing_date END) AS earliest_closing_date,
       MAX(CASE WHEN date_quality = 'published' THEN closing_date END) AS latest_closing_date
     FROM financial_exercises WHERE siren = ?`
  ).get(siren) as FinancialSummaryRow | undefined ?? null;
}

export function getFinancialMetricDefinitions() {
  const db = getDatabase();
  if (!db) return null;
  return db.prepare(
    `SELECT field_name, label, value_type, unit, description, formula_ck, formula_s
     FROM financial_metric_definitions ORDER BY field_name`
  ).all() as unknown as FinancialMetricDefinitionRow[];
}

export function getFinancialRatiosMetadata() {
  const db = getDatabase();
  if (!db) return null;
  const rows = db.prepare("SELECT key, value FROM metadata").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}
