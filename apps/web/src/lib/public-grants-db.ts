import "server-only";

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type PublicGrantRow = {
  id: number;
  siren: string;
  siret: string | null;
  rna_id: string | null;
  match_method: "exact_active_siret" | "exact_company_siret" | "exact_unambiguous_rna" | "exact_active_siret_rna" | "exact_company_siret_rna";
  match_confidence: number;
  beneficiary_name: string;
  awarding_authority: string | null;
  awarding_authority_siret: string | null;
  convention_date: string | null;
  decision_reference: string | null;
  purpose: string;
  amount: number;
  nature: string | null;
  payment_conditions: string | null;
  payment_period: string | null;
  rae_id: string | null;
  eu_notification: number | null;
  subsidy_percentage: number | null;
  aid_scheme: string | null;
  source_reference_date: string | null;
  imported_at: string;
  occurrence_count: number;
  dataset_title: string | null;
  dataset_url: string | null;
  resource_title: string | null;
  resource_url: string | null;
  source_last_modified: string | null;
  license_name: string | null;
  license_url: string | null;
};

export type PublicGrantSummaryRow = {
  total: number;
  total_amount: number | null;
  earliest_date: string | null;
  latest_date: string | null;
  authority_count: number;
  active_siret_count: number;
  company_siret_count: number;
  rna_count: number;
  source_count: number;
};

const candidates = [
  (process as unknown as { env: Record<string, string | undefined> }).env.PUBLIC_GRANTS_DB_PATH,
  resolve((process as unknown as { cwd(): string }).cwd(), "data/public-grants.sqlite"),
  resolve((process as unknown as { cwd(): string }).cwd(), "../../data/public-grants.sqlite")
].filter((candidate): candidate is string => Boolean(candidate));

const databasePath = candidates.find(existsSync);
let database: DatabaseSync | null = null;

function getDatabase() {
  if (!databasePath) return null;
  database ??= new DatabaseSync(databasePath, { readOnly: true });
  return database;
}

export function getPublicGrantsBySiren(siren: string, limit = 100) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    `SELECT g.*,
       (SELECT COUNT(*) FROM grant_occurrences all_occurrences WHERE all_occurrences.grant_id = g.id) AS occurrence_count,
       occurrence.dataset_title, occurrence.dataset_url, occurrence.resource_title,
       occurrence.resource_url, occurrence.source_last_modified,
       occurrence.license_name, occurrence.license_url
     FROM public_grants g
     LEFT JOIN grant_occurrences occurrence ON occurrence.id = (
       SELECT MIN(first_occurrence.id) FROM grant_occurrences first_occurrence WHERE first_occurrence.grant_id = g.id
     )
     WHERE g.siren = ?
     ORDER BY g.convention_date IS NULL, g.convention_date DESC, g.amount DESC, g.id DESC
     LIMIT ?`
  ).all(siren, Math.max(1, Math.min(limit, 200))) as unknown as PublicGrantRow[];
}

export function getPublicGrantSummaryBySiren(siren: string) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    `SELECT COUNT(*) AS total, SUM(amount) AS total_amount,
       MIN(convention_date) AS earliest_date, MAX(convention_date) AS latest_date,
       COUNT(DISTINCT awarding_authority_siret) AS authority_count,
       SUM(match_method IN ('exact_active_siret', 'exact_active_siret_rna')) AS active_siret_count,
       SUM(match_method IN ('exact_company_siret', 'exact_company_siret_rna')) AS company_siret_count,
       SUM(match_method = 'exact_unambiguous_rna') AS rna_count,
       (SELECT COUNT(DISTINCT occurrence.dataset_id)
        FROM grant_occurrences occurrence
        JOIN public_grants source_grant ON source_grant.id = occurrence.grant_id
        WHERE source_grant.siren = ?) AS source_count
     FROM public_grants
     WHERE siren = ?`
  ).get(siren, siren) as PublicGrantSummaryRow | undefined ?? null;
}

export function getPublicGrantsMetadata() {
  const db = getDatabase();
  if (!db) return null;
  const rows = db.prepare("SELECT key, value FROM metadata").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}
