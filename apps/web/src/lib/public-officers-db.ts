import "server-only";

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type PublicOfficerRow = {
  id: number;
  officer_key: string;
  siren: string;
  officer_type: string;
  display_name: string;
  family_name: string | null;
  given_names: string | null;
  role: string;
  related_siren: string;
  source_updated_at: string | null;
  retrieved_at: string;
  source: string;
  source_url: string;
};

export type AnnuaireProfileRow = {
  siren: string;
  company_category: string | null;
  workforce_band_code: string | null;
  workforce_year: string | null;
  naf25: string | null;
  establishment_count: number;
  open_establishment_count: number;
  collective_agreement_reported: number;
  source_updated_at: string | null;
  retrieved_at: string;
  source: string;
  source_url: string;
};

export type AnnuaireFinancialRow = {
  siren: string;
  year: string;
  revenue: number | null;
  net_income: number | null;
};

export type AnnuaireLabelRow = {
  siren: string;
  label_key: string;
  label: string;
};

const env = (process as unknown as { env: Record<string, string | undefined> }).env;
const databaseCandidates = [
  env.PUBLIC_OFFICERS_DB_PATH,
  resolve((process as unknown as { cwd(): string }).cwd(), "data/public-officers.sqlite"),
  resolve((process as unknown as { cwd(): string }).cwd(), "../../data/public-officers.sqlite")
].filter((candidate): candidate is string => Boolean(candidate));
const databasePath = databaseCandidates.find(existsSync);
let database: DatabaseSync | null = null;
const tableAvailability = new Map<string, boolean>();

function getDatabase() {
  if (!databasePath) return null;
  database ??= new DatabaseSync(databasePath, { readOnly: true });
  return database;
}

export function hasPublicOfficersDatabase() {
  return Boolean(databasePath);
}

export function getPublicOfficersMetadata() {
  const db = getDatabase();
  if (!db) return null;
  const rows = db.prepare("SELECT key, value FROM metadata").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

function hasTable(tableName: string) {
  const cached = tableAvailability.get(tableName);
  if (cached !== undefined) return cached;
  const db = getDatabase();
  if (!db || !/^[a-z_]+$/.test(tableName)) return false;
  const exists = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
  tableAvailability.set(tableName, exists);
  return exists;
}

function ftsQuery(raw: string) {
  const tokens = raw.normalize("NFD").replace(/\p{Diacritic}/gu, "").match(/[a-zA-Z0-9]+/g) ?? [];
  return tokens.map((token) => `"${token}"*`).join(" AND ");
}

export function getPublicOfficersBySiren(siren: string, limit = 100) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    "SELECT id, officer_key, siren, officer_type, display_name, family_name, given_names, role, related_siren, source_updated_at, retrieved_at, source, source_url FROM officers WHERE siren = ? ORDER BY display_name, role LIMIT ?"
  ).all(siren, limit) as unknown as PublicOfficerRow[];
}

export function getAnnuaireProfileBySiren(siren: string) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren) || !hasTable("annuaire_profiles")) return null;
  const profile = db.prepare(
    `SELECT siren, company_category, workforce_band_code, workforce_year, naf25,
            establishment_count, open_establishment_count, collective_agreement_reported,
            source_updated_at, retrieved_at, source, source_url
     FROM annuaire_profiles WHERE siren = ?`
  ).get(siren) as AnnuaireProfileRow | undefined;
  if (!profile) return null;
  const financials = hasTable("annuaire_financials")
    ? db.prepare("SELECT siren, year, revenue, net_income FROM annuaire_financials WHERE siren = ? ORDER BY year DESC").all(siren) as unknown as AnnuaireFinancialRow[]
    : [];
  const labels = hasTable("annuaire_labels")
    ? db.prepare("SELECT siren, label_key, label FROM annuaire_labels WHERE siren = ? ORDER BY label").all(siren) as unknown as AnnuaireLabelRow[]
    : [];
  const agreements = hasTable("annuaire_agreements")
    ? (db.prepare("SELECT idcc FROM annuaire_agreements WHERE siren = ? ORDER BY idcc").all(siren) as Array<{ idcc: string }>).map((row) => row.idcc)
    : [];
  return {
    profile,
    financials,
    labels: labels.filter((row) => !row.label_key.startsWith("a_aide_")),
    aidSignals: labels.filter((row) => row.label_key.startsWith("a_aide_")).map((row) => row.label),
    agreements
  };
}

export function searchPublicOfficers(rawQuery: string, limit = 12) {
  const db = getDatabase();
  if (!db) return null;
  const query = ftsQuery(rawQuery.trim());
  if (!query) return [];
  return db.prepare(
    `SELECT o.id, o.officer_key, o.siren, o.officer_type, o.display_name, o.family_name, o.given_names,
            o.role, o.related_siren, o.source_updated_at, o.retrieved_at, o.source, o.source_url
     FROM officer_search s
     JOIN officers o ON o.id = CAST(s.officer_id AS INTEGER)
     WHERE officer_search MATCH ?
     ORDER BY bm25(officer_search)
     LIMIT ?`
  ).all(query, limit) as unknown as PublicOfficerRow[];
}
