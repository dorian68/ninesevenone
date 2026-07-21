import "server-only";

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type PatentFamilyRow = {
  id: number;
  siren: string;
  family_docdb: string;
  family_inpadoc: string | null;
  applicant_names_json: string;
  application_count: number;
  first_publication_date: string | null;
  first_application_date: string | null;
  epo_application: number | null;
  international_application: number | null;
  granted: number | null;
  first_grant_date: string | null;
  display_title: string | null;
  display_abstract: string | null;
  technology_count: number;
  scanr_url: string;
  scope: "national_legal_unit";
  source_updated_at: string;
  dataset_url: string;
  license_name: string;
  license_url: string;
};

export type PatentPortfolioSummaryRow = {
  total: number;
  application_count: number;
  granted_count: number;
  international_count: number;
  epo_count: number;
  title_count: number;
  abstract_count: number;
  earliest_application_date: string | null;
  latest_application_date: string | null;
  application_authority_count: number;
  technology_count: number;
  technology_section_count: number;
};

export type PatentTechnologyRow = {
  family_docdb: string;
  level: "section" | "classe" | "sous-classe";
  code: string;
  label: string | null;
};

export type PatentSectionSummaryRow = {
  code: string;
  label: string | null;
  family_count: number;
};

const candidates = [
  (process as unknown as { env: Record<string, string | undefined> }).env.PATENT_PORTFOLIOS_DB_PATH,
  resolve((process as unknown as { cwd(): string }).cwd(), "data/patent-portfolios.sqlite"),
  resolve((process as unknown as { cwd(): string }).cwd(), "../../data/patent-portfolios.sqlite")
].filter((candidate): candidate is string => Boolean(candidate));

const databasePath = candidates.find(existsSync);
let database: DatabaseSync | null = null;

function getDatabase() {
  if (!databasePath) return null;
  database ??= new DatabaseSync(databasePath, { readOnly: true });
  return database;
}

export function getPatentFamiliesBySiren(siren: string, limit = 50) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    `SELECT id, siren, family_docdb, family_inpadoc, applicant_names_json,
       application_count, first_publication_date, first_application_date,
       epo_application, international_application, granted, first_grant_date,
       display_title, display_abstract, technology_count, scanr_url, scope,
       source_updated_at, dataset_url, license_name, license_url
     FROM patent_families
     WHERE siren = ?
     ORDER BY COALESCE(first_application_date, first_publication_date) DESC, family_docdb DESC
     LIMIT ?`
  ).all(siren, Math.max(1, Math.min(limit, 50))) as unknown as PatentFamilyRow[];
}

export function getPatentPortfolioSummaryBySiren(siren: string) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    `SELECT COUNT(*) AS total,
       COALESCE(SUM(application_count), 0) AS application_count,
       COALESCE(SUM(granted = 1), 0) AS granted_count,
       COALESCE(SUM(international_application = 1), 0) AS international_count,
       COALESCE(SUM(epo_application = 1), 0) AS epo_count,
       COALESCE(SUM(display_title IS NOT NULL), 0) AS title_count,
       COALESCE(SUM(display_abstract IS NOT NULL), 0) AS abstract_count,
       MIN(first_application_date) AS earliest_application_date,
       MAX(first_application_date) AS latest_application_date,
       (SELECT COUNT(DISTINCT application_authority) FROM patent_applications WHERE siren = ?) AS application_authority_count,
       (SELECT COUNT(*) FROM patent_technologies WHERE siren = ?) AS technology_count,
       (SELECT COUNT(DISTINCT code) FROM patent_technologies WHERE siren = ? AND level = 'section') AS technology_section_count
     FROM patent_families
     WHERE siren = ?`
  ).get(siren, siren, siren, siren) as PatentPortfolioSummaryRow | undefined ?? null;
}

export function getPatentTechnologiesForFamilies(siren: string, familyIds: string[], limit = 600) {
  const db = getDatabase();
  const validIds = [...new Set(familyIds.filter((value) => /^\d{1,30}$/.test(value)))];
  if (!db || !/^\d{9}$/.test(siren) || !validIds.length) return null;
  const placeholders = validIds.map(() => "?").join(",");
  return db.prepare(
    `SELECT family_docdb, level, code, label
     FROM patent_technologies
     WHERE siren = ? AND family_docdb IN (${placeholders})
     ORDER BY family_docdb, CASE level WHEN 'section' THEN 1 WHEN 'classe' THEN 2 ELSE 3 END, code
     LIMIT ?`
  ).all(siren, ...validIds, Math.max(1, Math.min(limit, 600))) as unknown as PatentTechnologyRow[];
}

export function getPatentSectionSummaryBySiren(siren: string) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    `SELECT code, MIN(label) AS label, COUNT(DISTINCT family_docdb) AS family_count
     FROM patent_technologies
     WHERE siren = ? AND level = 'section'
     GROUP BY code
     ORDER BY family_count DESC, code`
  ).all(siren) as unknown as PatentSectionSummaryRow[];
}

export function getPatentPortfolioMetadata() {
  const db = getDatabase();
  if (!db) return null;
  const rows = db.prepare("SELECT key, value FROM metadata").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}
