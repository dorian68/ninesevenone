import "server-only";

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type DetailedFinancialStatementRow = {
  id: number;
  siren: string;
  closing_date: string;
  statement_type: "C" | "K" | "S";
  confidentiality: string;
  is_partially_confidential: number;
  date_quality: "published" | "future_closing_date";
  cell_count: number;
  derived_metric_count: number;
  balance_sheet_total: number | null;
  equity: number | null;
  provisions: number | null;
  financial_debt: number | null;
  total_debt: number | null;
  fixed_assets_gross: number | null;
  fixed_assets_net: number | null;
  current_assets_gross: number | null;
  current_assets_net: number | null;
  inventory_gross: number | null;
  inventory_net: number | null;
  trade_receivables_gross: number | null;
  trade_receivables_net: number | null;
  cash_and_securities_net: number | null;
  trade_payables: number | null;
  tax_social_debt: number | null;
  capital: number | null;
  revenue: number | null;
  operating_result: number | null;
  current_pre_tax_result: number | null;
  net_income: number | null;
  personnel_costs: number | null;
  external_purchases: number | null;
  taxes: number | null;
  source_updated_at: string;
  dataset_url: string;
  resource_url: string;
  license_name: string;
  license_url: string;
};

export type DetailedFinancialSummaryRow = {
  total: number;
  partially_confidential_count: number;
  earliest_closing_date: string | null;
  latest_closing_date: string | null;
};

const candidates = [
  (process as unknown as { env: Record<string, string | undefined> }).env.DETAILED_FINANCIAL_STATEMENTS_DB_PATH,
  resolve((process as unknown as { cwd(): string }).cwd(), "data/detailed-financial-statements.sqlite"),
  resolve((process as unknown as { cwd(): string }).cwd(), "../../data/detailed-financial-statements.sqlite")
].filter((candidate): candidate is string => Boolean(candidate));

const databasePath = candidates.find(existsSync);
let database: DatabaseSync | null = null;

function getDatabase() {
  if (!databasePath) return null;
  database ??= new DatabaseSync(databasePath, { readOnly: true });
  return database;
}

const publicColumns = `id, siren, closing_date, statement_type, confidentiality,
  is_partially_confidential, date_quality, cell_count, derived_metric_count,
  balance_sheet_total, equity, provisions, financial_debt, total_debt,
  fixed_assets_gross, fixed_assets_net, current_assets_gross, current_assets_net,
  inventory_gross, inventory_net, trade_receivables_gross, trade_receivables_net,
  cash_and_securities_net, trade_payables, tax_social_debt, capital, revenue,
  operating_result, current_pre_tax_result, net_income, personnel_costs,
  external_purchases, taxes, source_updated_at, dataset_url, resource_url,
  license_name, license_url`;

export function getDetailedFinancialStatementsBySiren(siren: string, limit = 60) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    `SELECT ${publicColumns}
     FROM detailed_financial_statements
     WHERE siren = ?
     ORDER BY date_quality = 'published' DESC, closing_date DESC,
       CASE statement_type WHEN 'C' THEN 1 WHEN 'S' THEN 2 ELSE 3 END
     LIMIT ?`
  ).all(siren, Math.max(1, Math.min(limit, 60))) as unknown as DetailedFinancialStatementRow[];
}

export function getDetailedFinancialSummaryBySiren(siren: string) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    `SELECT COUNT(*) AS total,
       COALESCE(SUM(is_partially_confidential = 1), 0) AS partially_confidential_count,
       MIN(CASE WHEN date_quality = 'published' THEN closing_date END) AS earliest_closing_date,
       MAX(CASE WHEN date_quality = 'published' THEN closing_date END) AS latest_closing_date
     FROM detailed_financial_statements WHERE siren = ?`
  ).get(siren) as DetailedFinancialSummaryRow | undefined ?? null;
}

export function getDetailedFinancialMetadata() {
  const db = getDatabase();
  if (!db) return null;
  const rows = db.prepare("SELECT key, value FROM metadata").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}
