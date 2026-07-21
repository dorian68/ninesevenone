import "server-only";

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type IcpeInstallationRow = {
  id: number;
  aiot_code: string;
  siren: string;
  siret: string;
  match_scope: "exact_active_siret" | "exact_company_historical_siret";
  address_line_1: string | null;
  address_line_2: string | null;
  address_line_3: string | null;
  postal_code: string | null;
  commune_code: string | null;
  commune: string | null;
  naf_division: string | null;
  longitude: number | null;
  latitude: number | null;
  has_cattle: number;
  has_pigs: number;
  has_poultry: number;
  is_quarry: number;
  is_wind_farm: number;
  is_industry: number;
  national_priority: number;
  seveso_status: string | null;
  ied: number;
  activity_status: string | null;
  inspection_service: string | null;
  regime: string | null;
  source_updated_at: string | null;
  detail_url: string;
  dataset_url: string;
  license_name: string;
  license_url: string;
};

export type IcpeInspectionRow = {
  id: number;
  installation_id: number;
  inspection_date: string | null;
  document_date: string | null;
  document_type: string | null;
  document_url: string | null;
};

export type IcpeRubricRow = {
  id: number;
  installation_id: number;
  rubric_number: string;
  nature: string | null;
  paragraph: string | null;
  authorized_regime: string | null;
  total_quantity: string | null;
  unit: string | null;
  reason_date: string | null;
};

export type IcpeDocumentRow = {
  id: number;
  installation_id: number;
  document_date: string | null;
  document_type: string | null;
  document_url: string | null;
};

export type IcpeSummaryRow = {
  total: number;
  active_siret_count: number;
  authorization_count: number;
  registration_count: number;
  seveso_count: number;
  ied_count: number;
  national_priority_count: number;
  latest_source_update: string | null;
  latest_inspection_date: string | null;
  inspection_count: number;
  rubric_count: number;
  document_count: number;
};

const candidates = [
  (process as unknown as { env: Record<string, string | undefined> }).env.GEORISQUES_ICPE_DB_PATH,
  resolve((process as unknown as { cwd(): string }).cwd(), "data/georisques-icpe.sqlite"),
  resolve((process as unknown as { cwd(): string }).cwd(), "../../data/georisques-icpe.sqlite")
].filter((candidate): candidate is string => Boolean(candidate));

const databasePath = candidates.find(existsSync);
let database: DatabaseSync | null = null;

function getDatabase() {
  if (!databasePath) return null;
  database ??= new DatabaseSync(databasePath, { readOnly: true });
  return database;
}

function placeholders(ids: number[]) {
  return ids.map(() => "?").join(",");
}

export function getIcpeInstallationsBySiren(siren: string, limit = 100) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    `SELECT id, aiot_code, siren, siret, match_scope, address_line_1, address_line_2,
       address_line_3, postal_code, commune_code, commune, naf_division, longitude,
       latitude, has_cattle, has_pigs, has_poultry, is_quarry, is_wind_farm,
       is_industry, national_priority, seveso_status, ied, activity_status,
       inspection_service, regime, source_updated_at, detail_url, dataset_url,
       license_name, license_url
     FROM icpe_installations WHERE siren = ?
     ORDER BY match_scope = 'exact_active_siret' DESC,
       activity_status = 'En exploitation avec titre' DESC,
       regime = 'Autorisation' DESC, source_updated_at DESC
     LIMIT ?`
  ).all(siren, Math.max(1, Math.min(limit, 100))) as unknown as IcpeInstallationRow[];
}

export function getIcpeSummaryBySiren(siren: string) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    `SELECT COUNT(*) AS total,
       COALESCE(SUM(match_scope='exact_active_siret'),0) AS active_siret_count,
       COALESCE(SUM(regime='Autorisation'),0) AS authorization_count,
       COALESCE(SUM(regime='Enregistrement'),0) AS registration_count,
       COALESCE(SUM(COALESCE(seveso_status,'') LIKE 'Seveso%'),0) AS seveso_count,
       COALESCE(SUM(ied=1),0) AS ied_count,
       COALESCE(SUM(national_priority=1),0) AS national_priority_count,
       MAX(source_updated_at) AS latest_source_update,
       (SELECT MAX(i.inspection_date) FROM icpe_inspections i
          JOIN icpe_installations x ON x.id=i.installation_id WHERE x.siren=?) AS latest_inspection_date,
       (SELECT COUNT(*) FROM icpe_inspections i
          JOIN icpe_installations x ON x.id=i.installation_id WHERE x.siren=?) AS inspection_count,
       (SELECT COUNT(*) FROM icpe_rubrics r
          JOIN icpe_installations x ON x.id=r.installation_id WHERE x.siren=?) AS rubric_count,
       (SELECT COUNT(*) FROM icpe_documents d
          JOIN icpe_installations x ON x.id=d.installation_id WHERE x.siren=?) AS document_count
     FROM icpe_installations WHERE siren=?`
  ).get(siren, siren, siren, siren, siren) as IcpeSummaryRow | undefined ?? null;
}

export function getIcpeInspections(installationIds: number[], limit = 100) {
  const db = getDatabase();
  if (!db) return null;
  const ids = installationIds.filter(Number.isInteger).slice(0, 100);
  if (!ids.length) return [];
  return db.prepare(
    `SELECT id, installation_id, inspection_date, document_date, document_type, document_url
     FROM icpe_inspections WHERE installation_id IN (${placeholders(ids)})
     ORDER BY inspection_date DESC, id DESC LIMIT ?`
  ).all(...ids, Math.max(1, Math.min(limit, 200))) as unknown as IcpeInspectionRow[];
}

export function getIcpeRubrics(installationIds: number[], limit = 200) {
  const db = getDatabase();
  if (!db) return null;
  const ids = installationIds.filter(Number.isInteger).slice(0, 100);
  if (!ids.length) return [];
  return db.prepare(
    `SELECT id, installation_id, rubric_number, nature, paragraph, authorized_regime,
       total_quantity, unit, reason_date
     FROM icpe_rubrics WHERE installation_id IN (${placeholders(ids)})
     ORDER BY rubric_number, id LIMIT ?`
  ).all(...ids, Math.max(1, Math.min(limit, 300))) as unknown as IcpeRubricRow[];
}

export function getIcpeDocuments(installationIds: number[], limit = 100) {
  const db = getDatabase();
  if (!db) return null;
  const ids = installationIds.filter(Number.isInteger).slice(0, 100);
  if (!ids.length) return [];
  return db.prepare(
    `SELECT id, installation_id, document_date, document_type, document_url
     FROM icpe_documents WHERE installation_id IN (${placeholders(ids)})
     ORDER BY document_date DESC, id DESC LIMIT ?`
  ).all(...ids, Math.max(1, Math.min(limit, 200))) as unknown as IcpeDocumentRow[];
}

export function getIcpeMetadata() {
  const db = getDatabase();
  if (!db) return null;
  const rows = db.prepare("SELECT key, value FROM metadata").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}
