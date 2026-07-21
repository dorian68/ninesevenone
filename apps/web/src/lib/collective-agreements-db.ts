import "server-only";

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type CollectiveAgreementStatus =
  | "declared_code"
  | "status_unspecified"
  | "company_agreement_unspecified"
  | "agreement_not_known"
  | "no_collective_agreement";

export type CollectiveAgreementRow = {
  id: number;
  siren: string;
  siret: string;
  commune: string | null;
  is_head_office: number;
  employer: number | null;
  idcc: string;
  idcc_status: CollectiveAgreementStatus;
  reference_month: string;
  source_update_date: string | null;
  resource_title: string;
  resource_url: string;
  resource_last_modified: string | null;
  dataset_url: string;
  source_updated_at: string;
  license_name: string;
  license_url: string;
  kali_id: string | null;
  title: string | null;
  short_title: string | null;
  base_text_status: string | null;
  legifrance_url: string | null;
};

export type OpcoAssignmentRow = {
  id: number;
  siren: string;
  siret: string;
  commune: string | null;
  is_head_office: number;
  employer: number | null;
  idcc: string | null;
  idcc_status: string;
  owner_opco: string | null;
  managing_opco: string | null;
  assignment_status: string;
  reference_month: string;
  resource_title: string;
  resource_url: string;
  resource_last_modified: string | null;
  dataset_url: string;
  source_updated_at: string;
  license_name: string;
  license_url: string;
  kali_id: string | null;
  title: string | null;
  short_title: string | null;
  base_text_status: string | null;
  legifrance_url: string | null;
};

export type CollectiveAgreementSummaryRow = {
  total: number;
  establishment_count: number;
  substantive_count: number;
  escape_count: number;
  distinct_idcc_count: number;
  multi_idcc_establishment_count: number;
  titled_count: number;
  earliest_reference_month: string | null;
  latest_reference_month: string | null;
};

export type OpcoAssignmentSummaryRow = {
  total: number;
  establishment_count: number;
  assigned_count: number;
  anomaly_count: number;
  effective_opco_count: number;
  earliest_reference_month: string | null;
  latest_reference_month: string | null;
};

const candidates = [
  (process as unknown as { env: Record<string, string | undefined> }).env.COLLECTIVE_AGREEMENTS_DB_PATH,
  resolve((process as unknown as { cwd(): string }).cwd(), "data/collective-agreements.sqlite"),
  resolve((process as unknown as { cwd(): string }).cwd(), "../../data/collective-agreements.sqlite")
].filter((candidate): candidate is string => Boolean(candidate));

const databasePath = candidates.find(existsSync);
let database: DatabaseSync | null = null;

function getDatabase() {
  if (!databasePath) return null;
  database ??= new DatabaseSync(databasePath, { readOnly: true });
  return database;
}

export function getCollectiveAgreementsBySiren(siren: string, limit = 100) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    `SELECT agreement.*, catalog.kali_id, catalog.title, catalog.short_title,
       catalog.base_text_status, catalog.legifrance_url
     FROM establishment_collective_agreements agreement
     LEFT JOIN agreement_catalog catalog ON catalog.idcc = agreement.idcc
     WHERE agreement.siren = ?
     ORDER BY agreement.is_head_office DESC, agreement.siret, agreement.idcc
     LIMIT ?`
  ).all(siren, Math.max(1, Math.min(limit, 100))) as unknown as CollectiveAgreementRow[];
}

export function getCollectiveAgreementSummaryBySiren(siren: string) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    `WITH per_establishment AS (
       SELECT siret, COUNT(DISTINCT idcc) AS idcc_count
       FROM establishment_collective_agreements
       WHERE siren = ?
       GROUP BY siret
     )
     SELECT COUNT(*) AS total,
       COUNT(DISTINCT agreement.siret) AS establishment_count,
       SUM(agreement.idcc_status = 'declared_code') AS substantive_count,
       SUM(agreement.idcc_status != 'declared_code') AS escape_count,
       COUNT(DISTINCT agreement.idcc) AS distinct_idcc_count,
       (SELECT COUNT(*) FROM per_establishment WHERE idcc_count > 1) AS multi_idcc_establishment_count,
       SUM(catalog.title IS NOT NULL) AS titled_count,
       MIN(agreement.reference_month) AS earliest_reference_month,
       MAX(agreement.reference_month) AS latest_reference_month
     FROM establishment_collective_agreements agreement
     LEFT JOIN agreement_catalog catalog ON catalog.idcc = agreement.idcc
     WHERE agreement.siren = ?`
  ).get(siren, siren) as CollectiveAgreementSummaryRow | undefined ?? null;
}

export function getOpcoAssignmentsBySiren(siren: string, limit = 100) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    `SELECT assignment.*, catalog.kali_id, catalog.title, catalog.short_title,
       catalog.base_text_status, catalog.legifrance_url
     FROM establishment_opco_assignments assignment
     LEFT JOIN agreement_catalog catalog ON catalog.idcc = assignment.idcc
     WHERE assignment.siren = ?
     ORDER BY assignment.is_head_office DESC, assignment.siret
     LIMIT ?`
  ).all(siren, Math.max(1, Math.min(limit, 100))) as unknown as OpcoAssignmentRow[];
}

export function getOpcoAssignmentSummaryBySiren(siren: string) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    `SELECT COUNT(*) AS total,
       COUNT(DISTINCT siret) AS establishment_count,
       SUM(assignment_status = 'assigned') AS assigned_count,
       SUM(assignment_status != 'assigned') AS anomaly_count,
       COUNT(DISTINCT COALESCE(managing_opco, owner_opco)) AS effective_opco_count,
       MIN(reference_month) AS earliest_reference_month,
       MAX(reference_month) AS latest_reference_month
     FROM establishment_opco_assignments
     WHERE siren = ?`
  ).get(siren) as OpcoAssignmentSummaryRow | undefined ?? null;
}

export function getCollectiveAgreementMetadata() {
  const db = getDatabase();
  if (!db) return null;
  const rows = db.prepare("SELECT key, value FROM metadata").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}
