import "server-only";

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type AdemeAidRow = {
  id: number;
  source_row_number: number;
  siren: string;
  siret: string;
  match_scope: "active_local_establishment" | "company_historical_establishment";
  match_confidence: number;
  awarding_authority: string | null;
  awarding_authority_siret: string | null;
  convention_date: string | null;
  decision_reference: string | null;
  beneficiary_name: string;
  purpose: string;
  aid_scheme: string | null;
  amount: number;
  nature: string | null;
  payment_conditions: string | null;
  payment_period: string | null;
  rae_id: string | null;
  eu_notification: number | null;
  source_updated_at: string;
  source_url: string;
  data_gouv_url: string;
  license_name: string;
  license_url: string;
  imported_at: string;
};

export type AdemeAidSummaryRow = {
  total: number;
  total_amount: number | null;
  active_local_count: number;
  active_local_amount: number | null;
  company_scope_count: number;
  company_scope_amount: number | null;
  scheme_count: number;
  earliest_date: string | null;
  latest_date: string | null;
};

const candidates = [
  (process as unknown as { env: Record<string, string | undefined> }).env.ADEME_AIDS_DB_PATH,
  resolve((process as unknown as { cwd(): string }).cwd(), "data/ademe-financial-aids.sqlite"),
  resolve((process as unknown as { cwd(): string }).cwd(), "../../data/ademe-financial-aids.sqlite")
].filter((candidate): candidate is string => Boolean(candidate));

const databasePath = candidates.find(existsSync);
let database: DatabaseSync | null = null;

function getDatabase() {
  if (!databasePath) return null;
  database ??= new DatabaseSync(databasePath, { readOnly: true });
  return database;
}

export function getAdemeAidsBySiren(siren: string, limit = 100) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    `SELECT * FROM ademe_financial_aids
     WHERE siren = ?
     ORDER BY match_scope = 'active_local_establishment' DESC,
              convention_date IS NULL, convention_date DESC, amount DESC, id DESC
     LIMIT ?`
  ).all(siren, Math.max(1, Math.min(limit, 200))) as unknown as AdemeAidRow[];
}

export function getAdemeAidSummaryBySiren(siren: string) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    `SELECT COUNT(*) AS total, SUM(amount) AS total_amount,
       SUM(match_scope = 'active_local_establishment') AS active_local_count,
       SUM(CASE WHEN match_scope = 'active_local_establishment' THEN amount ELSE 0 END) AS active_local_amount,
       SUM(match_scope = 'company_historical_establishment') AS company_scope_count,
       SUM(CASE WHEN match_scope = 'company_historical_establishment' THEN amount ELSE 0 END) AS company_scope_amount,
       COUNT(DISTINCT aid_scheme) AS scheme_count,
       MIN(convention_date) AS earliest_date, MAX(convention_date) AS latest_date
     FROM ademe_financial_aids
     WHERE siren = ?`
  ).get(siren) as AdemeAidSummaryRow | undefined ?? null;
}

export function getAdemeAidsMetadata() {
  const db = getDatabase();
  if (!db) return null;
  const rows = db.prepare("SELECT key, value FROM metadata").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}
