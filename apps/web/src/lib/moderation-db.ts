import "server-only";

import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type ClaimStatus = "pending" | "approved" | "rejected";
export type ReportStatus = "pending" | "resolved" | "dismissed";
export type ReportCategory = "factual_error" | "personal_data" | "closed" | "other";
export type UpdateStatus = "pending" | "approved" | "rejected";

export type CompanyUpdatePayload = {
  siteWeb?: string;
  telephonePublic?: string;
  emailPublic?: string;
  openingHoursPublic?: string;
  descriptionCourte?: string;
};

export type CompanyClaim = {
  id: string;
  siren: string;
  claimantName: string;
  professionalEmail: string;
  companyRole: string;
  evidenceUrl: string | null;
  message: string;
  status: ClaimStatus;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

export type CompanyReport = {
  id: string;
  siren: string;
  category: ReportCategory;
  message: string;
  contactEmail: string | null;
  status: ReportStatus;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

export type CompanyUpdateRequest = {
  id: string;
  siren: string;
  claimId: string;
  professionalEmail: string;
  payload: CompanyUpdatePayload;
  status: UpdateStatus;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

export type CompanyDeclaredOverride = CompanyUpdatePayload & {
  siren: string;
  requestId: string;
  updatedAt: string;
};

const env = (process as unknown as { env: Record<string, string | undefined> }).env;
const databasePath = env.MODERATION_DB_PATH ?? resolve((process as unknown as { cwd(): string }).cwd(), "data/moderation.sqlite");
let database: DatabaseSync | null = null;

export function closeModerationDatabase() {
  (database as unknown as { close?: () => void } | null)?.close?.();
  database = null;
}

function now() {
  return new Date().toISOString();
}

function getDatabase() {
  if (database) return database;
  mkdirSync(dirname(databasePath), { recursive: true });
  database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS company_claims (
      id TEXT PRIMARY KEY,
      siren TEXT NOT NULL,
      claimant_name TEXT NOT NULL,
      professional_email TEXT NOT NULL,
      company_role TEXT NOT NULL,
      evidence_url TEXT,
      message TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
      review_note TEXT,
      created_at TEXT NOT NULL,
      reviewed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS company_claims_queue_idx ON company_claims(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS company_claims_siren_idx ON company_claims(siren, created_at DESC);
    CREATE TABLE IF NOT EXISTS company_reports (
      id TEXT PRIMARY KEY,
      siren TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('factual_error', 'personal_data', 'closed', 'other')),
      message TEXT NOT NULL,
      contact_email TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'resolved', 'dismissed')) DEFAULT 'pending',
      review_note TEXT,
      created_at TEXT NOT NULL,
      reviewed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS company_reports_queue_idx ON company_reports(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS company_reports_siren_idx ON company_reports(siren, created_at DESC);
    CREATE TABLE IF NOT EXISTS company_verification_overrides (
      siren TEXT PRIMARY KEY,
      verified INTEGER NOT NULL DEFAULT 0,
      claim_id TEXT,
      verified_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS company_update_requests (
      id TEXT PRIMARY KEY,
      siren TEXT NOT NULL,
      claim_id TEXT NOT NULL,
      professional_email TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
      review_note TEXT,
      created_at TEXT NOT NULL,
      reviewed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS company_update_requests_queue_idx ON company_update_requests(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS company_update_requests_siren_idx ON company_update_requests(siren, created_at DESC);
    CREATE TABLE IF NOT EXISTS company_declared_overrides (
      siren TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      site_web TEXT,
      telephone_public TEXT,
      email_public TEXT,
      opening_hours_public TEXT,
      description_courte TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id TEXT PRIMARY KEY,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS admin_audit_logs_created_idx ON admin_audit_logs(created_at DESC);
  `);
  return database;
}

function mapClaim(row: Record<string, unknown>): CompanyClaim {
  return {
    id: String(row.id),
    siren: String(row.siren),
    claimantName: String(row.claimant_name),
    professionalEmail: String(row.professional_email),
    companyRole: String(row.company_role),
    evidenceUrl: typeof row.evidence_url === "string" ? row.evidence_url : null,
    message: String(row.message),
    status: String(row.status) as ClaimStatus,
    reviewNote: typeof row.review_note === "string" ? row.review_note : null,
    createdAt: String(row.created_at),
    reviewedAt: typeof row.reviewed_at === "string" ? row.reviewed_at : null
  };
}

function mapReport(row: Record<string, unknown>): CompanyReport {
  return {
    id: String(row.id),
    siren: String(row.siren),
    category: String(row.category) as ReportCategory,
    message: String(row.message),
    contactEmail: typeof row.contact_email === "string" ? row.contact_email : null,
    status: String(row.status) as ReportStatus,
    reviewNote: typeof row.review_note === "string" ? row.review_note : null,
    createdAt: String(row.created_at),
    reviewedAt: typeof row.reviewed_at === "string" ? row.reviewed_at : null
  };
}

function mapUpdateRequest(row: Record<string, unknown>): CompanyUpdateRequest {
  let payload: CompanyUpdatePayload = {};
  try {
    const parsed = JSON.parse(String(row.payload_json)) as Record<string, unknown>;
    payload = Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === "string" && value.trim())) as CompanyUpdatePayload;
  } catch {
    payload = {};
  }
  return {
    id: String(row.id),
    siren: String(row.siren),
    claimId: String(row.claim_id),
    professionalEmail: String(row.professional_email),
    payload,
    status: String(row.status) as UpdateStatus,
    reviewNote: typeof row.review_note === "string" ? row.review_note : null,
    createdAt: String(row.created_at),
    reviewedAt: typeof row.reviewed_at === "string" ? row.reviewed_at : null
  };
}

function mapDeclaredOverride(row: Record<string, unknown>): CompanyDeclaredOverride {
  return {
    siren: String(row.siren),
    requestId: String(row.request_id),
    siteWeb: typeof row.site_web === "string" ? row.site_web : undefined,
    telephonePublic: typeof row.telephone_public === "string" ? row.telephone_public : undefined,
    emailPublic: typeof row.email_public === "string" ? row.email_public : undefined,
    openingHoursPublic: typeof row.opening_hours_public === "string" ? row.opening_hours_public : undefined,
    descriptionCourte: typeof row.description_courte === "string" ? row.description_courte : undefined,
    updatedAt: String(row.updated_at)
  };
}

function audit(actorRole: string, action: string, entityType: string, entityId: string | null, payload: Record<string, unknown> = {}) {
  getDatabase().prepare(
    "INSERT INTO admin_audit_logs(id, actor_role, action, entity_type, entity_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(randomUUID(), actorRole, action, entityType, entityId, JSON.stringify(payload), now());
}

export function createCompanyClaim(input: Omit<CompanyClaim, "id" | "status" | "reviewNote" | "createdAt" | "reviewedAt">) {
  const id = randomUUID();
  const timestamp = now();
  getDatabase().prepare(
    "INSERT INTO company_claims(id, siren, claimant_name, professional_email, company_role, evidence_url, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, input.siren, input.claimantName, input.professionalEmail, input.companyRole, input.evidenceUrl, input.message, timestamp);
  return getCompanyClaim(id);
}

export function createCompanyReport(input: Omit<CompanyReport, "id" | "status" | "reviewNote" | "createdAt" | "reviewedAt">) {
  const id = randomUUID();
  const timestamp = now();
  getDatabase().prepare(
    "INSERT INTO company_reports(id, siren, category, message, contact_email, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, input.siren, input.category, input.message, input.contactEmail, timestamp);
  return getCompanyReport(id);
}

export function getApprovedClaimForUpdate(id: string, siren: string, professionalEmail: string) {
  const claim = getCompanyClaim(id);
  if (!claim || claim.status !== "approved" || claim.siren !== siren) return null;
  return claim.professionalEmail.toLocaleLowerCase("fr") === professionalEmail.toLocaleLowerCase("fr") ? claim : null;
}

export function createCompanyUpdateRequest(input: { siren: string; claimId: string; professionalEmail: string; payload: CompanyUpdatePayload }) {
  const id = randomUUID();
  const timestamp = now();
  getDatabase().prepare(
    "INSERT INTO company_update_requests(id, siren, claim_id, professional_email, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, input.siren, input.claimId, input.professionalEmail, JSON.stringify(input.payload), timestamp);
  return getCompanyUpdateRequest(id);
}

export function getCompanyClaim(id: string) {
  const row = getDatabase().prepare("SELECT * FROM company_claims WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? mapClaim(row) : null;
}

export function getCompanyReport(id: string) {
  const row = getDatabase().prepare("SELECT * FROM company_reports WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? mapReport(row) : null;
}

export function getCompanyUpdateRequest(id: string) {
  const row = getDatabase().prepare("SELECT * FROM company_update_requests WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? mapUpdateRequest(row) : null;
}

export function listCompanyClaims(status?: ClaimStatus) {
  const rows = (status
    ? getDatabase().prepare("SELECT * FROM company_claims WHERE status = ? ORDER BY created_at DESC LIMIT 200").all(status)
    : getDatabase().prepare("SELECT * FROM company_claims ORDER BY created_at DESC LIMIT 200").all()) as Array<Record<string, unknown>>;
  return rows.map(mapClaim);
}

export function listCompanyReports(status?: ReportStatus) {
  const rows = (status
    ? getDatabase().prepare("SELECT * FROM company_reports WHERE status = ? ORDER BY created_at DESC LIMIT 200").all(status)
    : getDatabase().prepare("SELECT * FROM company_reports ORDER BY created_at DESC LIMIT 200").all()) as Array<Record<string, unknown>>;
  return rows.map(mapReport);
}

export function listCompanyUpdateRequests(status?: UpdateStatus) {
  const rows = (status
    ? getDatabase().prepare("SELECT * FROM company_update_requests WHERE status = ? ORDER BY created_at DESC LIMIT 200").all(status)
    : getDatabase().prepare("SELECT * FROM company_update_requests ORDER BY created_at DESC LIMIT 200").all()) as Array<Record<string, unknown>>;
  return rows.map(mapUpdateRequest);
}

export function reviewCompanyClaim(id: string, status: Exclude<ClaimStatus, "pending">, reviewNote: string | null, actorRole: string) {
  const db = getDatabase();
  const claim = getCompanyClaim(id);
  if (!claim) return null;
  const reviewedAt = now();
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE company_claims SET status = ?, review_note = ?, reviewed_at = ? WHERE id = ?").run(status, reviewNote, reviewedAt, id);
    if (status === "approved") {
      db.prepare(
        "INSERT INTO company_verification_overrides(siren, verified, claim_id, verified_at, updated_at) VALUES (?, 1, ?, ?, ?) ON CONFLICT(siren) DO UPDATE SET verified = 1, claim_id = excluded.claim_id, verified_at = excluded.verified_at, updated_at = excluded.updated_at"
      ).run(claim.siren, id, reviewedAt, reviewedAt);
    }
    audit(actorRole, `claim_${status}`, "company_claim", id, { siren: claim.siren });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getCompanyClaim(id);
}

export function reviewCompanyReport(id: string, status: Exclude<ReportStatus, "pending">, reviewNote: string | null, actorRole: string) {
  const report = getCompanyReport(id);
  if (!report) return null;
  const reviewedAt = now();
  getDatabase().prepare("UPDATE company_reports SET status = ?, review_note = ?, reviewed_at = ? WHERE id = ?").run(status, reviewNote, reviewedAt, id);
  audit(actorRole, `report_${status}`, "company_report", id, { siren: report.siren, category: report.category });
  return getCompanyReport(id);
}

export function reviewCompanyUpdateRequest(id: string, status: Exclude<UpdateStatus, "pending">, reviewNote: string | null, actorRole: string) {
  const db = getDatabase();
  const request = getCompanyUpdateRequest(id);
  if (!request) return null;
  const reviewedAt = now();
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE company_update_requests SET status = ?, review_note = ?, reviewed_at = ? WHERE id = ?").run(status, reviewNote, reviewedAt, id);
    if (status === "approved") {
      db.prepare(
        `INSERT INTO company_declared_overrides(siren, request_id, site_web, telephone_public, email_public, opening_hours_public, description_courte, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(siren) DO UPDATE SET
           request_id = excluded.request_id,
           site_web = COALESCE(excluded.site_web, company_declared_overrides.site_web),
           telephone_public = COALESCE(excluded.telephone_public, company_declared_overrides.telephone_public),
           email_public = COALESCE(excluded.email_public, company_declared_overrides.email_public),
           opening_hours_public = COALESCE(excluded.opening_hours_public, company_declared_overrides.opening_hours_public),
           description_courte = COALESCE(excluded.description_courte, company_declared_overrides.description_courte),
           updated_at = excluded.updated_at`
      ).run(
        request.siren,
        request.id,
        request.payload.siteWeb ?? null,
        request.payload.telephonePublic ?? null,
        request.payload.emailPublic ?? null,
        request.payload.openingHoursPublic ?? null,
        request.payload.descriptionCourte ?? null,
        reviewedAt
      );
    }
    audit(actorRole, `company_update_${status}`, "company_update_request", id, { siren: request.siren, claimId: request.claimId });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getCompanyUpdateRequest(id);
}

export function getCompanyVerificationOverride(siren: string) {
  const row = getDatabase().prepare("SELECT verified FROM company_verification_overrides WHERE siren = ?").get(siren) as { verified: number } | undefined;
  return row?.verified === 1;
}

export function getVerifiedCompanySirens(sirens?: readonly string[]) {
  const db = getDatabase();
  if (!sirens) {
    return new Set((db.prepare("SELECT siren FROM company_verification_overrides WHERE verified = 1").all() as Array<{ siren: string }>).map((row) => row.siren));
  }
  const unique = [...new Set(sirens.filter((siren) => /^\d{9}$/.test(siren)))];
  if (!unique.length) return new Set<string>();
  const placeholders = unique.map(() => "?").join(",");
  return new Set((db.prepare(`SELECT siren FROM company_verification_overrides WHERE verified = 1 AND siren IN (${placeholders})`).all(...unique) as Array<{ siren: string }>).map((row) => row.siren));
}

export function getCompanyDeclaredOverride(siren: string) {
  const row = getDatabase().prepare("SELECT * FROM company_declared_overrides WHERE siren = ?").get(siren) as Record<string, unknown> | undefined;
  return row ? mapDeclaredOverride(row) : null;
}

export function getAdminAuditLogs() {
  return (getDatabase().prepare("SELECT id, actor_role, action, entity_type, entity_id, created_at FROM admin_audit_logs ORDER BY created_at DESC LIMIT 200").all() as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    actorRole: String(row.actor_role),
    action: String(row.action),
    entityType: String(row.entity_type),
    entityId: typeof row.entity_id === "string" ? row.entity_id : null,
    createdAt: String(row.created_at)
  }));
}
