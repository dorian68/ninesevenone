import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import type { ProspectCertification, ProspectContactFilter } from "./prospect-factory-contract";
import {
  PROSPECT_ACTIVITY_DIRECTIONS,
  PROSPECT_ACTIVITY_DETAIL_TYPES,
  PROSPECT_ACTIVITY_OUTCOMES,
  PROSPECT_ACTIVITY_TYPES,
  PROSPECT_BUYING_COMMITTEE_ROLES,
  PROSPECT_DEAL_ROLES,
  PROSPECT_DECISION_SCOPES,
  PROSPECT_EVENT_SOURCES,
  PROSPECT_EVENT_TYPES,
  PROSPECT_EVIDENCE_TYPES,
  PROSPECT_OBSERVATION_KINDS,
  PROSPECT_OBSERVATION_STATUSES,
  PROSPECT_OPERATIONAL_SIGNALS,
  PROSPECT_PRIORITIES,
  PROSPECT_QUALIFICATION_CONFIDENCES,
  PROSPECT_QUALIFICATION_STATUSES,
  PROSPECT_QUALIFICATION_TIERS,
  PROSPECT_RESEARCH_SOURCE_TYPES,
  PROSPECT_SOURCE_EXTRACTION_STATUSES,
  PROSPECT_SOURCE_INPUT_TYPES,
  type AddProspectActivityInput,
  type AddProspectInput,
  type AccountMarketProfile,
  type AccountMarketUpdateInput,
  type AccountPersonaSlot,
  type AccountPersonaWriteInput,
  type IcpPersona,
  type IcpPersonaWriteInput,
  type IcpWriteInput,
  type ListMarketAccountsOptions,
  type ListProspectsOptions,
  type MarketAccountListResult,
  type MarketIcp,
  type MarketMetrics,
  type MarketOverview,
  type MarketSegment,
  type ProspectContactWriteInput,
  type ProspectDealRole,
  type ProspectDecisionScope,
  type ProspectOperationalSignal,
  type SegmentWriteInput,
  type ProspectActivity,
  type ProspectActivityActionKind,
  type ProspectActivityDirection,
  type ProspectActivityOutcome,
  type ProspectActivityType,
  type ProspectActivityWriteResult,
  type ProspectContact,
  type ProspectCrmFilterOptions,
  type ProspectEventSource,
  type ProspectEventType,
  type ProspectListResult,
  type ProspectObservation,
  type ProspectObservationKind,
  type ProspectObservationStatus,
  type ProspectPipelineCounts,
  type ProspectActivityStats,
  type ProspectPriority,
  type ProspectQualificationImportInput,
  type ProspectQualificationImportResult,
  type ProspectQualificationTier,
  type ProspectQualificationStatus,
  type ProspectResearchSource,
  type ProspectResearchSourceType,
  type ProspectSourceExtractionStatus,
  type ProspectSourceInput,
  type ProspectSourceInputType,
  type ProspectTrackingSummary,
  type TrackedProspect,
  type UpdateProspectInput,
  type ProspectUpdateAuditResult
} from "./prospect-factory-crm-contract";

export * from "./prospect-factory-crm-contract";

type ProspectRow = Record<string, unknown>;

const env = (process as unknown as { env: Record<string, string | undefined> }).env;
let database: DatabaseSync | null = null;

export class ProspectVersionConflictError extends Error {
  readonly prospectId: string;
  readonly expectedVersion: number;
  readonly currentVersion: number;

  constructor(prospectId: string, expectedVersion: number, currentVersion: number) {
    super(`Prospect ${prospectId} was modified after version ${expectedVersion}.`);
    this.name = "ProspectVersionConflictError";
    this.prospectId = prospectId;
    this.expectedVersion = expectedVersion;
    this.currentVersion = currentVersion;
  }
}

export class ProspectCrmInputError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "ProspectCrmInputError";
    this.field = field;
  }
}

/** A client retried an idempotency key with a materially different import payload. */
export class ProspectCrmIdempotencyConflictError extends Error {
  readonly idempotencyKey: string;

  constructor(idempotencyKey: string) {
    super(`The idempotency key ${idempotencyKey} was already used with another payload.`);
    this.name = "ProspectCrmIdempotencyConflictError";
    this.idempotencyKey = idempotencyKey;
  }
}

function now() {
  return new Date().toISOString();
}

function canonicalDateTime(value: string) {
  return new Date(value).toISOString();
}

function canonicalOptionalDate(value: string | null | undefined) {
  return value == null ? null : canonicalDateTime(value);
}

const DEFAULT_REPORTING_TIMEZONE = "Europe/Paris";

function canonicalTimezone(value: string | null | undefined, field = "reportingTimezone") {
  const timezone = value?.trim() || DEFAULT_REPORTING_TIMEZONE;
  if (timezone.length > 100) throw new ProspectCrmInputError(field, `${field} is too long.`);
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone }).format();
  } catch {
    throw new ProspectCrmInputError(field, `${field} must be a valid IANA time zone.`);
  }
  return timezone;
}

function isLinkedInUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "linkedin.com" || hostname.endsWith(".linkedin.com");
  } catch {
    return false;
  }
}

function assertResearchUrl(field: string, value: unknown, required = false) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new ProspectCrmInputError(field, `${field} must be an HTTP(S) URL.`);
    return;
  }
  assertText(field, value, 10_000);
  const urlValue = value as string;
  let parsed: URL;
  try {
    parsed = new URL(urlValue);
  } catch {
    throw new ProspectCrmInputError(field, `${field} must be an HTTP(S) URL.`);
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || isLinkedInUrl(urlValue)) {
    throw new ProspectCrmInputError(field, `${field} must be a non-LinkedIn HTTP(S) URL.`);
  }
}

function assertOptionalInteger(field: string, value: unknown, minimum: number, maximum: number) {
  if (value === undefined || value === null) return;
  const numericValue = value as number;
  if (!Number.isInteger(numericValue) || numericValue < minimum || numericValue > maximum) {
    throw new ProspectCrmInputError(field, `${field} must be an integer between ${minimum} and ${maximum}.`);
  }
}

function assertMetadata(field: string, value: unknown) {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProspectCrmInputError(field, `${field} must be an object.`);
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > 20_000) throw new ProspectCrmInputError(field, `${field} exceeds 20,000 characters.`);
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function fingerprint(...parts: Array<string | null | undefined>) {
  return createHash("sha256").update(parts.map((part) => part ?? "").join("\u001f")).digest("hex");
}

function assertRequiredText(field: string, value: unknown, maxLength: number) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ProspectCrmInputError(field, `${field} must be a non-empty string.`);
  }
  if (value.length > maxLength) {
    throw new ProspectCrmInputError(field, `${field} exceeds ${maxLength} characters.`);
  }
}

function assertText(field: string, value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    throw new ProspectCrmInputError(field, `${field} must be a string.`);
  }
  if (value.length > maxLength) {
    throw new ProspectCrmInputError(field, `${field} exceeds ${maxLength} characters.`);
  }
}

function assertOptionalText(field: string, value: unknown, maxLength: number) {
  if (value === undefined || value === null) return;
  if (typeof value !== "string") {
    throw new ProspectCrmInputError(field, `${field} must be a string or null.`);
  }
  if (value.length > maxLength) {
    throw new ProspectCrmInputError(field, `${field} exceeds ${maxLength} characters.`);
  }
}

function assertEnum(field: string, value: unknown, allowed: readonly string[]) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new ProspectCrmInputError(field, `${field} has an unsupported value.`);
  }
}

function assertOptionalDate(field: string, value: unknown) {
  if (value === undefined || value === null) return;
  if (typeof value !== "string" || !value.trim() || !Number.isFinite(Date.parse(value))) {
    throw new ProspectCrmInputError(field, `${field} must be a valid date-time or null.`);
  }
}

function assertOptionalNumber(field: string, value: unknown, minimum: number, maximum: number) {
  if (value === undefined || value === null) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ProspectCrmInputError(field, `${field} must be a number between ${minimum} and ${maximum}.`);
  }
}

function validateEnrichment(enrichment: AddProspectInput["enrichment"] | UpdateProspectInput["enrichment"]) {
  if (!enrichment) return;
  assertOptionalText("enrichment.contactName", enrichment.contactName, 1_000);
  assertOptionalText("enrichment.email", enrichment.email, 2_000);
  assertOptionalText("enrichment.phone", enrichment.phone, 500);
  assertOptionalText("enrichment.website", enrichment.website, 10_000);
  assertOptionalText("enrichment.jobTitle", enrichment.jobTitle, 1_000);
  assertOptionalText("enrichment.linkedin", enrichment.linkedin, 10_000);
  assertOptionalText("enrichment.address", enrichment.address, 10_000);
}

function validateQualification(qualification: AddProspectInput["qualification"] | UpdateProspectInput["qualification"]) {
  if (!qualification) return;
  if (qualification.status !== undefined) assertEnum("qualification.status", qualification.status, PROSPECT_QUALIFICATION_STATUSES);
  if (qualification.priority !== undefined) assertEnum("qualification.priority", qualification.priority, PROSPECT_PRIORITIES);
  if (qualification.tags !== undefined) {
    if (!Array.isArray(qualification.tags) || qualification.tags.length > 50) {
      throw new ProspectCrmInputError("qualification.tags", "qualification.tags must contain at most 50 strings.");
    }
    qualification.tags.forEach((tag) => assertRequiredText("qualification.tags[]", tag, 200));
  }
  if (qualification.notes !== undefined) assertText("qualification.notes", qualification.notes, 200_000);
  assertOptionalText("qualification.owner", qualification.owner, 180);
  assertOptionalText("qualification.campaign", qualification.campaign, 180);
  assertOptionalNumber("qualification.potentialValue", qualification.potentialValue, 0, 1_000_000_000);
  assertOptionalNumber("qualification.probability", qualification.probability, 0, 100);
  assertOptionalText("qualification.disqualificationReason", qualification.disqualificationReason, 500);
  assertOptionalDate("qualification.nextActionAt", qualification.nextActionAt);
  assertOptionalText("qualification.nextActionLabel", qualification.nextActionLabel, 500);
  assertOptionalDate("qualification.lastContactedAt", qualification.lastContactedAt);
  assertOptionalDate("qualification.expectedCloseAt", qualification.expectedCloseAt);
  assertOptionalInteger("qualification.fitScore", qualification.fitScore, 0, 30);
  assertOptionalInteger("qualification.painScore", qualification.painScore, 0, 30);
  assertOptionalInteger("qualification.timingScore", qualification.timingScore, 0, 20);
  assertOptionalInteger("qualification.personaScore", qualification.personaScore, 0, 20);
  if (qualification.confidence !== undefined && qualification.confidence !== null) {
    assertEnum("qualification.confidence", qualification.confidence, PROSPECT_QUALIFICATION_CONFIDENCES);
  }
  assertOptionalText("qualification.scoreReason", qualification.scoreReason, 10_000);
  // scoreTotal and tier are projections. Validate caller-provided values so a
  // direct persistence caller cannot smuggle an impossible score, then derive
  // their stored values below from the four components.
  assertOptionalInteger("qualification.scoreTotal", qualification.scoreTotal, 0, 100);
  if (qualification.tier !== undefined && qualification.tier !== null) {
    assertEnum("qualification.tier", qualification.tier, PROSPECT_QUALIFICATION_TIERS);
  }
}

type ScoreProjection = {
  fitScore: number | null;
  painScore: number | null;
  timingScore: number | null;
  personaScore: number | null;
  scoreTotal: number | null;
  tier: ProspectQualificationTier | null;
};

function deriveScoreProjection(
  qualification: Partial<TrackedProspect["qualification"]> | undefined,
  current?: TrackedProspect["qualification"]
): ScoreProjection {
  const fitScore = qualification?.fitScore === undefined ? current?.fitScore ?? null : qualification.fitScore ?? null;
  const painScore = qualification?.painScore === undefined ? current?.painScore ?? null : qualification.painScore ?? null;
  const timingScore = qualification?.timingScore === undefined ? current?.timingScore ?? null : qualification.timingScore ?? null;
  const personaScore = qualification?.personaScore === undefined ? current?.personaScore ?? null : qualification.personaScore ?? null;
  const complete = [fitScore, painScore, timingScore, personaScore].every((value) => value !== null);
  const scoreTotal = complete ? fitScore! + painScore! + timingScore! + personaScore! : null;
  const tier: ProspectQualificationTier | null = scoreTotal === null ? null : scoreTotal >= 80 ? "A" : scoreTotal >= 60 ? "B" : "C";
  const providedTotal = qualification?.scoreTotal;
  const providedTier = qualification?.tier;
  if (providedTotal !== undefined && providedTotal !== null && (scoreTotal === null || providedTotal !== scoreTotal)) {
    throw new ProspectCrmInputError("qualification.scoreTotal", "qualification.scoreTotal is derived from Fit, Pain, Timing and Persona.");
  }
  if (providedTier !== undefined && providedTier !== null && (tier === null || providedTier !== tier)) {
    throw new ProspectCrmInputError("qualification.tier", "qualification.tier is derived from the total score.");
  }
  return { fitScore, painScore, timingScore, personaScore, scoreTotal, tier };
}

function validateAddProspectInput(input: AddProspectInput) {
  if (!input?.snapshot) throw new ProspectCrmInputError("snapshot", "snapshot is required.");
  assertRequiredText("warehouseId", input.warehouseId, 256);
  assertRequiredText("snapshot.dedupeKey", input.snapshot.dedupeKey, 100_000);
  assertRequiredText("snapshot.companyName", input.snapshot.companyName, 10_000);
  assertOptionalText("snapshot.commercialName", input.snapshot.commercialName, 10_000);
  assertRequiredText("snapshot.country", input.snapshot.country, 1_000);
  assertRequiredText("snapshot.territory", input.snapshot.territory, 2_000);
  assertOptionalText("snapshot.region", input.snapshot.region, 2_000);
  assertOptionalText("snapshot.city", input.snapshot.city, 2_000);
  assertOptionalText("snapshot.vertical", input.snapshot.vertical, 5_000);
  assertRequiredText("snapshot.recordOrigin", input.snapshot.recordOrigin, 2_000);
  assertText("snapshot.sourceUrls", input.snapshot.sourceUrls, 200_000);
  assertOptionalText("snapshot.contactName", input.snapshot.contactName, 2_000);
  assertOptionalText("snapshot.email", input.snapshot.email, 4_000);
  assertOptionalText("snapshot.phone", input.snapshot.phone, 2_000);
  assertOptionalText("snapshot.website", input.snapshot.website, 10_000);
  assertOptionalText("snapshot.activityDetail", input.snapshot.activityDetail, 100_000);
  assertOptionalText("snapshot.employeeRange", input.snapshot.employeeRange, 2_000);
  if (!Number.isFinite(input.snapshot.leadScore)) {
    throw new ProspectCrmInputError("snapshot.leadScore", "snapshot.leadScore must be finite.");
  }
  assertEnum("snapshot.certification", input.snapshot.certification, ["gold", "silver", "bronze", "blocked"]);
  validateEnrichment(input.enrichment);
  validateQualification(input.qualification);
}

function validateUpdateProspectInput(input: UpdateProspectInput) {
  if (!input || typeof input !== "object") throw new ProspectCrmInputError("input", "An update payload is required.");
  if (input.expectedVersion !== undefined && (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1)) {
    throw new ProspectCrmInputError("expectedVersion", "expectedVersion must be a positive integer.");
  }
  validateEnrichment(input.enrichment);
  validateQualification(input.qualification);
}

function validateActivityInput(input: AddProspectActivityInput) {
  if (!input || typeof input !== "object") throw new ProspectCrmInputError("input", "An activity payload is required.");
  assertEnum("type", input.type, PROSPECT_ACTIVITY_TYPES);
  if (input.detailType !== undefined && input.detailType !== null) assertEnum("detailType", input.detailType, PROSPECT_ACTIVITY_DETAIL_TYPES);
  if (input.direction !== undefined && input.direction !== null) assertEnum("direction", input.direction, PROSPECT_ACTIVITY_DIRECTIONS);
  if (input.outcome !== undefined && input.outcome !== null) assertEnum("outcome", input.outcome, PROSPECT_ACTIVITY_OUTCOMES);
  assertOptionalText("subject", input.subject, 2_000);
  if (input.body !== undefined) assertText("body", input.body, 200_000);
  assertRequiredText("actorRole", input.actorRole, 200);
  assertOptionalDate("occurredAt", input.occurredAt);
  assertOptionalDate("nextActionAt", input.nextActionAt);
  assertOptionalText("nextActionLabel", input.nextActionLabel, 500);
  if (input.statusAfter !== undefined) assertEnum("statusAfter", input.statusAfter, PROSPECT_QUALIFICATION_STATUSES);
  assertOptionalText("contactId", input.contactId, 256);
  if (input.eventType !== undefined) assertEnum("eventType", input.eventType, PROSPECT_EVENT_TYPES);
  if (input.source !== undefined) assertEnum("source", input.source, PROSPECT_EVENT_SOURCES);
  assertOptionalText("actorId", input.actorId, 256);
  assertOptionalText("idempotencyKey", input.idempotencyKey, 256);
  if (input.reportingTimezone !== undefined) canonicalTimezone(input.reportingTimezone);
  assertMetadata("metadata", input.metadata);
}

function findMonorepoRoot(startDirectory: string) {
  let candidate = resolve(startDirectory);
  const filesystemRoot = parse(candidate).root;

  while (true) {
    if (
      existsSync(resolve(/* turbopackIgnore: true */ candidate, "package.json"))
      && existsSync(resolve(/* turbopackIgnore: true */ candidate, "apps", "web", "package.json"))
    ) {
      return candidate;
    }
    if (candidate === filesystemRoot) return resolve(startDirectory);
    candidate = dirname(candidate);
  }
}

export function resolveProspectCrmDatabasePath(startDirectory: string, configuredPath?: string) {
  if (configuredPath?.trim()) return configuredPath;
  return resolve(findMonorepoRoot(startDirectory), "data", "prospects-db", "prospect_factory_crm.sqlite");
}

export function getProspectCrmDatabasePath(): string {
  return resolveProspectCrmDatabasePath(
    (process as unknown as { cwd(): string }).cwd(),
    env.PROSPECTS_CRM_DB_PATH
  );
}

export function closeProspectCrmDatabase(): void {
  (database as unknown as { close?: () => void } | null)?.close?.();
  database = null;
}

function tableHasColumn(db: DatabaseSync, table: string, column: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return columns.some((existingColumn) => existingColumn.name === column);
}

function addColumnIfMissing(db: DatabaseSync, table: string, column: string, definition: string) {
  if (tableHasColumn(db, table, column)) return;
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (error) {
    // A second server process may have completed the same additive migration
    // while this process was waiting for SQLite's schema lock.
    if (!tableHasColumn(db, table, column)) throw error;
  }
}

function getDatabase() {
  if (database) return database;

  const databasePath = getProspectCrmDatabasePath();
  mkdirSync(dirname(databasePath), { recursive: true });
  database = new DatabaseSync(databasePath);
  const db = database;
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS prospect_factory_prospects (
      id TEXT PRIMARY KEY,
      warehouse_id TEXT NOT NULL UNIQUE,
      dedupe_key TEXT NOT NULL,

      company_name TEXT NOT NULL,
      commercial_name TEXT,
      country TEXT NOT NULL,
      territory TEXT NOT NULL,
      region TEXT,
      city TEXT,
      vertical TEXT,
      record_origin TEXT NOT NULL,
      source_urls TEXT NOT NULL DEFAULT '',
      lead_score REAL NOT NULL,
      certification TEXT NOT NULL CHECK (certification IN ('gold', 'silver', 'bronze', 'blocked')),

      source_contact_name TEXT,
      source_email TEXT,
      source_phone TEXT,
      source_website TEXT,
      source_activity_detail TEXT,
      source_employee_range TEXT,

      contact_name TEXT,
      email TEXT,
      phone TEXT,
      website TEXT,
      job_title TEXT,
      linkedin TEXT,
      address TEXT,

      qualification_status TEXT NOT NULL DEFAULT 'to_qualify' CHECK (qualification_status IN ('to_qualify', 'qualified', 'to_contact', 'contacted', 'in_conversation', 'opportunity', 'won', 'lost', 'disqualified')),
      priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('high', 'normal', 'low')),
      tags_json TEXT NOT NULL DEFAULT '[]',
      notes TEXT NOT NULL DEFAULT '',
      next_action_at TEXT,
      last_contacted_at TEXT,
      owner TEXT,
      campaign TEXT,
      potential_value REAL,
      probability REAL,
      expected_close_at TEXT,
      disqualification_reason TEXT,
      account_key TEXT,
      business_summary TEXT,
      offer_hypothesis TEXT,
      next_verification TEXT,
      recommended_next_action_at TEXT,
      source_input_type TEXT,
      source_input_reference TEXT,
      source_input_row_or_record TEXT,
      source_input_status TEXT,
      source_input_note TEXT,
      fit_score INTEGER,
      pain_score INTEGER,
      timing_score INTEGER,
      persona_score INTEGER,
      qualification_score_total INTEGER,
      qualification_tier TEXT,
      qualification_confidence TEXT,
      qualification_score_reason TEXT,
      first_action_at TEXT,
      last_action_at TEXT,
      first_approached_at TEXT,
      last_approached_at TEXT,
      first_researched_at TEXT,
      last_researched_at TEXT,
      first_qualified_at TEXT,
      last_qualified_at TEXT,
      status_changed_at TEXT,
      reporting_timezone TEXT NOT NULL DEFAULT 'Europe/Paris',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS prospect_factory_prospects_pipeline_idx
      ON prospect_factory_prospects(qualification_status, priority, updated_at DESC);
    CREATE INDEX IF NOT EXISTS prospect_factory_prospects_next_action_idx
      ON prospect_factory_prospects(next_action_at, qualification_status);
    CREATE INDEX IF NOT EXISTS prospect_factory_prospects_company_idx
      ON prospect_factory_prospects(company_name COLLATE NOCASE);

    CREATE TABLE IF NOT EXISTS prospect_factory_activities (
      id TEXT PRIMARY KEY,
      prospect_id TEXT NOT NULL REFERENCES prospect_factory_prospects(id) ON DELETE CASCADE,
      contact_id TEXT,
      activity_type TEXT NOT NULL CHECK (activity_type IN ('note', 'call', 'email', 'meeting', 'status_change', 'enrichment')),
      action_kind TEXT NOT NULL DEFAULT 'activity' CHECK (action_kind IN ('activity', 'approach', 'status_change', 'enrichment')),
      event_type TEXT,
      direction TEXT CHECK (direction IS NULL OR direction IN ('inbound', 'outbound', 'internal')),
      outcome TEXT CHECK (outcome IS NULL OR outcome IN ('reached', 'no_answer', 'replied', 'interested', 'follow_up', 'meeting_booked', 'not_interested', 'wrong_contact', 'other')),
      subject TEXT,
      body TEXT NOT NULL DEFAULT '',
      occurred_at TEXT NOT NULL,
      status_before TEXT,
      status_after TEXT,
      actor_role TEXT NOT NULL,
      actor_id TEXT,
      event_source TEXT NOT NULL DEFAULT 'ui',
      idempotency_key TEXT,
      reporting_timezone TEXT NOT NULL DEFAULT 'Europe/Paris',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      recorded_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS prospect_factory_activities_timeline_idx
      ON prospect_factory_activities(prospect_id, occurred_at DESC, created_at DESC);
    CREATE INDEX IF NOT EXISTS prospect_factory_activities_reporting_idx
      ON prospect_factory_activities(occurred_at, prospect_id);

    CREATE TABLE IF NOT EXISTS prospect_factory_contacts (
      id TEXT PRIMARY KEY,
      prospect_id TEXT NOT NULL REFERENCES prospect_factory_prospects(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL,
      name TEXT NOT NULL,
      input_title TEXT,
      verified_title TEXT,
      evidence_type TEXT NOT NULL CHECK (evidence_type IN ('official', 'apollo_input', 'to_confirm')),
      source_url TEXT,
      source_row_or_record TEXT,
      buying_committee_role TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(prospect_id, fingerprint)
    );
    CREATE INDEX IF NOT EXISTS prospect_factory_contacts_prospect_idx
      ON prospect_factory_contacts(prospect_id, name COLLATE NOCASE);

    CREATE TABLE IF NOT EXISTS prospect_factory_research_sources (
      id TEXT PRIMARY KEY,
      prospect_id TEXT NOT NULL REFERENCES prospect_factory_prospects(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL,
      source_url TEXT NOT NULL,
      source_type TEXT NOT NULL,
      supported_claim TEXT NOT NULL,
      published_at TEXT,
      researched_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(prospect_id, fingerprint)
    );
    CREATE INDEX IF NOT EXISTS prospect_factory_research_sources_prospect_idx
      ON prospect_factory_research_sources(prospect_id, researched_at DESC);

    CREATE TABLE IF NOT EXISTS prospect_factory_observations (
      id TEXT PRIMARY KEY,
      prospect_id TEXT NOT NULL REFERENCES prospect_factory_prospects(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL,
      observation_kind TEXT NOT NULL,
      statement TEXT NOT NULL,
      evidence_status TEXT NOT NULL,
      category TEXT,
      source_url TEXT,
      occurred_at TEXT,
      published_at TEXT,
      researched_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(prospect_id, fingerprint)
    );
    CREATE INDEX IF NOT EXISTS prospect_factory_observations_prospect_idx
      ON prospect_factory_observations(prospect_id, researched_at DESC);

    CREATE TABLE IF NOT EXISTS prospect_factory_qualification_imports (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      payload_fingerprint TEXT NOT NULL,
      prospect_id TEXT NOT NULL REFERENCES prospect_factory_prospects(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );

  `);
  const canonicalContactColumns = [
    "source_contact_name",
    "source_email",
    "source_phone",
    "source_website",
    "source_activity_detail",
    "source_employee_range"
  ] as const;
  for (const column of canonicalContactColumns) {
    addColumnIfMissing(db, "prospect_factory_prospects", column, "TEXT");
  }
  addColumnIfMissing(
    db,
    "prospect_factory_activities",
    "outcome",
    "TEXT CHECK (outcome IS NULL OR outcome IN ('reached', 'no_answer', 'replied', 'interested', 'follow_up', 'meeting_booked', 'not_interested', 'wrong_contact', 'other'))"
  );
  addColumnIfMissing(
    db,
    "prospect_factory_activities",
    "action_kind",
    "TEXT NOT NULL DEFAULT 'activity' CHECK (action_kind IN ('activity', 'approach', 'status_change', 'enrichment'))"
  );
  addColumnIfMissing(db, "prospect_factory_activities", "status_before", "TEXT");
  addColumnIfMissing(db, "prospect_factory_activities", "status_after", "TEXT");
  addColumnIfMissing(db, "prospect_factory_prospects", "owner", "TEXT");
  addColumnIfMissing(db, "prospect_factory_prospects", "campaign", "TEXT");
  addColumnIfMissing(db, "prospect_factory_prospects", "potential_value", "REAL");
  addColumnIfMissing(db, "prospect_factory_prospects", "probability", "REAL");
  addColumnIfMissing(db, "prospect_factory_prospects", "expected_close_at", "TEXT");
  addColumnIfMissing(db, "prospect_factory_prospects", "disqualification_reason", "TEXT");
  const prospectResearchColumns: ReadonlyArray<readonly [string, string]> = [
    ["account_key", "TEXT"],
    ["business_summary", "TEXT"],
    ["offer_hypothesis", "TEXT"],
    ["next_verification", "TEXT"],
    ["recommended_next_action_at", "TEXT"],
    ["source_input_type", "TEXT"],
    ["source_input_reference", "TEXT"],
    ["source_input_row_or_record", "TEXT"],
    ["source_input_status", "TEXT"],
    ["source_input_note", "TEXT"],
    ["fit_score", "INTEGER"],
    ["pain_score", "INTEGER"],
    ["timing_score", "INTEGER"],
    ["persona_score", "INTEGER"],
    ["qualification_score_total", "INTEGER"],
    ["qualification_tier", "TEXT"],
    ["qualification_confidence", "TEXT"],
    ["qualification_score_reason", "TEXT"],
    ["first_action_at", "TEXT"],
    ["last_action_at", "TEXT"],
    ["first_approached_at", "TEXT"],
    ["last_approached_at", "TEXT"],
    ["first_researched_at", "TEXT"],
    ["last_researched_at", "TEXT"],
    ["first_qualified_at", "TEXT"],
    ["last_qualified_at", "TEXT"],
    ["status_changed_at", "TEXT"],
    ["reporting_timezone", "TEXT NOT NULL DEFAULT 'Europe/Paris'"]
  ];
  for (const [column, definition] of prospectResearchColumns) {
    addColumnIfMissing(db, "prospect_factory_prospects", column, definition);
  }
  const activityTemporalColumns: ReadonlyArray<readonly [string, string]> = [
    ["contact_id", "TEXT"],
    ["event_type", "TEXT"],
    ["actor_id", "TEXT"],
    ["event_source", "TEXT NOT NULL DEFAULT 'ui'"],
    ["idempotency_key", "TEXT"],
    ["reporting_timezone", "TEXT NOT NULL DEFAULT 'Europe/Paris'"],
    ["metadata_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["recorded_at", "TEXT"]
  ];
  for (const [column, definition] of activityTemporalColumns) {
    addColumnIfMissing(db, "prospect_factory_activities", column, definition);
  }
  // Earlier database versions used an `activity` default for every migrated
  // row. Recover the canonical action kind from the information that existed.
  db.exec(`
    UPDATE prospect_factory_activities
    SET action_kind = CASE
      WHEN activity_type IN ('call', 'email', 'meeting') AND direction = 'outbound' THEN 'approach'
      WHEN activity_type = 'status_change' THEN 'status_change'
      WHEN activity_type = 'enrichment' THEN 'enrichment'
      ELSE action_kind
    END
    WHERE action_kind IS NULL OR action_kind = 'activity';
    UPDATE prospect_factory_activities
    SET event_type = CASE
      WHEN action_kind = 'approach' THEN 'approach'
      WHEN activity_type = 'status_change' THEN 'status_changed'
      WHEN activity_type = 'enrichment' THEN 'enrichment_updated'
      WHEN activity_type = 'call' THEN 'call_logged'
      WHEN activity_type = 'meeting' THEN 'meeting_booked'
      WHEN activity_type = 'note' THEN 'note_added'
      ELSE 'note_added'
    END
    WHERE event_type IS NULL OR event_type = '';
    UPDATE prospect_factory_activities
    SET recorded_at = created_at
    WHERE recorded_at IS NULL OR recorded_at = '';
    UPDATE prospect_factory_activities
    SET reporting_timezone = '${DEFAULT_REPORTING_TIMEZONE}'
    WHERE reporting_timezone IS NULL OR reporting_timezone = '';
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS prospect_factory_prospects_account_key_unique_idx
      ON prospect_factory_prospects(account_key COLLATE NOCASE) WHERE account_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS prospect_factory_activities_contact_reporting_idx
      ON prospect_factory_activities(contact_id, occurred_at);
    CREATE UNIQUE INDEX IF NOT EXISTS prospect_factory_activities_idempotency_unique_idx
      ON prospect_factory_activities(prospect_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
  `);
  // Materialize historical projections. The event log remains the source of
  // truth; these columns only make the commercial dashboard inexpensive.
  db.exec(`
    UPDATE prospect_factory_prospects
    SET
      first_action_at = COALESCE(first_action_at, (SELECT MIN(a.occurred_at) FROM prospect_factory_activities a WHERE a.prospect_id = prospect_factory_prospects.id)),
      last_action_at = COALESCE(last_action_at, (SELECT MAX(a.occurred_at) FROM prospect_factory_activities a WHERE a.prospect_id = prospect_factory_prospects.id)),
      first_approached_at = COALESCE(first_approached_at, (SELECT MIN(a.occurred_at) FROM prospect_factory_activities a WHERE a.prospect_id = prospect_factory_prospects.id AND a.action_kind = 'approach')),
      last_approached_at = COALESCE(last_approached_at, (SELECT MAX(a.occurred_at) FROM prospect_factory_activities a WHERE a.prospect_id = prospect_factory_prospects.id AND a.action_kind = 'approach')),
      first_researched_at = COALESCE(first_researched_at, (SELECT MIN(a.occurred_at) FROM prospect_factory_activities a WHERE a.prospect_id = prospect_factory_prospects.id AND a.event_type = 'research_completed')),
      last_researched_at = COALESCE(last_researched_at, (SELECT MAX(a.occurred_at) FROM prospect_factory_activities a WHERE a.prospect_id = prospect_factory_prospects.id AND a.event_type = 'research_completed')),
      first_qualified_at = COALESCE(first_qualified_at, (SELECT MIN(a.occurred_at) FROM prospect_factory_activities a WHERE a.prospect_id = prospect_factory_prospects.id AND a.event_type = 'qualified')),
      last_qualified_at = COALESCE(last_qualified_at, (SELECT MAX(a.occurred_at) FROM prospect_factory_activities a WHERE a.prospect_id = prospect_factory_prospects.id AND a.event_type = 'qualified')),
      status_changed_at = COALESCE(status_changed_at, (SELECT MAX(a.occurred_at) FROM prospect_factory_activities a WHERE a.prospect_id = prospect_factory_prospects.id AND a.event_type = 'status_changed'));
  `);
  const schemaVersion = db.prepare("PRAGMA user_version").get() as { user_version: number };
  if (Number(schemaVersion.user_version) < 5) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS prospect_factory_icps (
          id TEXT PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          qualification_criteria_json TEXT NOT NULL DEFAULT '[]',
          exclusions_json TEXT NOT NULL DEFAULT '[]',
          employee_min INTEGER,
          employee_max INTEGER,
          territories_json TEXT NOT NULL DEFAULT '[]',
          signal_weights_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS prospect_factory_icp_segments (
          id TEXT PRIMARY KEY,
          icp_id TEXT NOT NULL REFERENCES prospect_factory_icps(id) ON DELETE RESTRICT,
          slug TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          criteria_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(icp_id, slug)
        );
        CREATE INDEX IF NOT EXISTS prospect_factory_icp_segments_icp_idx
          ON prospect_factory_icp_segments(icp_id, name COLLATE NOCASE);
        CREATE TABLE IF NOT EXISTS prospect_factory_icp_personas (
          id TEXT PRIMARY KEY,
          icp_id TEXT NOT NULL REFERENCES prospect_factory_icps(id) ON DELETE CASCADE,
          persona_key TEXT NOT NULL,
          label TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(icp_id, persona_key)
        );
        CREATE TABLE IF NOT EXISTS prospect_factory_account_personas (
          id TEXT PRIMARY KEY,
          prospect_id TEXT NOT NULL REFERENCES prospect_factory_prospects(id) ON DELETE CASCADE,
          persona_key TEXT NOT NULL,
          label TEXT NOT NULL,
          contact_id TEXT REFERENCES prospect_factory_contacts(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'to_find' CHECK (status IN ('to_find', 'identified', 'not_relevant')),
          notes TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(prospect_id, persona_key)
        );
        CREATE INDEX IF NOT EXISTS prospect_factory_account_personas_account_idx
          ON prospect_factory_account_personas(prospect_id, persona_key);
      `);
      const accountColumns: ReadonlyArray<readonly [string, string]> = [
        ["segment_id", "TEXT REFERENCES prospect_factory_icp_segments(id) ON DELETE RESTRICT"],
        ["group_name", "TEXT"], ["siren", "TEXT"], ["siret", "TEXT"],
        ["employee_count_estimate", "INTEGER"], ["establishment_count", "INTEGER"],
        ["entity_count", "INTEGER"], ["operational_signals_json", "TEXT NOT NULL DEFAULT '[]'"],
        ["icp_fit_score", "INTEGER"], ["icp_fit_reason", "TEXT"],
        ["next_action_label", "TEXT"]
      ];
      for (const [column, definition] of accountColumns) addColumnIfMissing(db, "prospect_factory_prospects", column, definition);
      const contactColumns: ReadonlyArray<readonly [string, string]> = [
        ["first_name", "TEXT"], ["last_name", "TEXT"], ["email", "TEXT"], ["phone", "TEXT"],
        ["linkedin", "TEXT"], ["seniority", "TEXT"], ["persona_key", "TEXT"],
        ["deal_roles_json", "TEXT NOT NULL DEFAULT '[]'"], ["decision_scope", "TEXT"]
      ];
      for (const [column, definition] of contactColumns) addColumnIfMissing(db, "prospect_factory_contacts", column, definition);
      addColumnIfMissing(db, "prospect_factory_activities", "detail_type", "TEXT");
      addColumnIfMissing(db, "prospect_factory_activities", "next_action_label", "TEXT");
      addColumnIfMissing(db, "prospect_factory_activities", "next_action_at", "TEXT");
      db.exec(`
        CREATE INDEX IF NOT EXISTS prospect_factory_prospects_segment_idx
          ON prospect_factory_prospects(segment_id, qualification_status, priority);
      `);
      seedInitialMarket(db);
      db.exec("PRAGMA user_version = 5");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  // Account maps extend the CRM; they do not replace or rewrite prospect,
  // contact, activity, or pipeline records. Keep the migration additive.
  if (Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version) < 6) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS prospect_factory_map_opportunities (
          id TEXT PRIMARY KEY,
          prospect_id TEXT NOT NULL REFERENCES prospect_factory_prospects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS prospect_factory_map_opportunities_account_idx
          ON prospect_factory_map_opportunities(prospect_id, created_at);

        CREATE TABLE IF NOT EXISTS prospect_factory_map_nodes (
          id TEXT PRIMARY KEY,
          prospect_id TEXT NOT NULL REFERENCES prospect_factory_prospects(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK(kind IN ('person','unit','role_slot')),
          contact_id TEXT REFERENCES prospect_factory_contacts(id) ON DELETE CASCADE,
          unit_kind TEXT CHECK(unit_kind IS NULL OR unit_kind IN ('account','group','company','headquarters','subsidiary','establishment','department','external')),
          is_root INTEGER NOT NULL DEFAULT 0 CHECK(is_root IN (0,1)),
          name TEXT NOT NULL,
          title TEXT,
          notes TEXT NOT NULL DEFAULT '',
          opportunity_id TEXT REFERENCES prospect_factory_map_opportunities(id) ON DELETE CASCADE,
          resolved_contact_id TEXT REFERENCES prospect_factory_contacts(id) ON DELETE SET NULL,
          version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK((kind='person' AND contact_id IS NOT NULL AND unit_kind IS NULL AND is_root=0 AND opportunity_id IS NULL)
             OR (kind='unit' AND contact_id IS NULL AND unit_kind IS NOT NULL AND resolved_contact_id IS NULL AND opportunity_id IS NULL)
             OR (kind='role_slot' AND contact_id IS NULL AND unit_kind IS NULL AND is_root=0))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS prospect_factory_map_person_unique_idx
          ON prospect_factory_map_nodes(prospect_id, contact_id) WHERE kind='person';
        CREATE UNIQUE INDEX IF NOT EXISTS prospect_factory_map_root_unique_idx
          ON prospect_factory_map_nodes(prospect_id) WHERE is_root=1;
        CREATE INDEX IF NOT EXISTS prospect_factory_map_nodes_account_idx
          ON prospect_factory_map_nodes(prospect_id, kind, name COLLATE NOCASE);

        CREATE TABLE IF NOT EXISTS prospect_factory_map_sources (
          id TEXT PRIMARY KEY,
          prospect_id TEXT NOT NULL REFERENCES prospect_factory_prospects(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK(kind IN ('screenshot','document','meeting_note','web_page','crm_note','other')),
          label TEXT NOT NULL,
          reference TEXT,
          collected_at TEXT,
          information_date TEXT,
          locator TEXT,
          excerpt TEXT,
          retention_until TEXT,
          version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS prospect_factory_map_sources_account_idx
          ON prospect_factory_map_sources(prospect_id, collected_at DESC);

        CREATE TABLE IF NOT EXISTS prospect_factory_map_relations (
          id TEXT PRIMARY KEY,
          prospect_id TEXT NOT NULL REFERENCES prospect_factory_prospects(id) ON DELETE CASCADE,
          from_node_id TEXT NOT NULL REFERENCES prospect_factory_map_nodes(id) ON DELETE CASCADE,
          to_node_id TEXT NOT NULL REFERENCES prospect_factory_map_nodes(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK(kind IN ('works_in','reports_to','functional_reports_to','part_of','can_introduce','advises')),
          opportunity_id TEXT REFERENCES prospect_factory_map_opportunities(id) ON DELETE CASCADE,
          evidence_status TEXT NOT NULL DEFAULT 'hypothesis' CHECK(evidence_status IN ('observed','confirmed','hypothesis','contradictory','obsolete')),
          source_id TEXT REFERENCES prospect_factory_map_sources(id) ON DELETE SET NULL,
          source_ids_json TEXT NOT NULL DEFAULT '[]',
          label TEXT,
          notes TEXT NOT NULL DEFAULT '',
          locator TEXT,
          excerpt TEXT,
          justification TEXT,
          verification_question TEXT,
          validated_by TEXT,
          validated_at TEXT,
          version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK(from_node_id <> to_node_id)
        );
        CREATE INDEX IF NOT EXISTS prospect_factory_map_relations_account_idx
          ON prospect_factory_map_relations(prospect_id, opportunity_id, kind);

        CREATE TABLE IF NOT EXISTS prospect_factory_map_claims (
          id TEXT PRIMARY KEY,
          prospect_id TEXT NOT NULL REFERENCES prospect_factory_prospects(id) ON DELETE CASCADE,
          subject_node_id TEXT NOT NULL REFERENCES prospect_factory_map_nodes(id) ON DELETE CASCADE,
          opportunity_id TEXT REFERENCES prospect_factory_map_opportunities(id) ON DELETE CASCADE,
          field TEXT NOT NULL,
          value_json TEXT NOT NULL,
          evidence_status TEXT NOT NULL CHECK(evidence_status IN ('observed','confirmed','hypothesis','contradictory','obsolete')),
          source_id TEXT REFERENCES prospect_factory_map_sources(id) ON DELETE SET NULL,
          source_ids_json TEXT NOT NULL DEFAULT '[]',
          locator TEXT,
          excerpt TEXT,
          justification TEXT,
          verification_question TEXT,
          information_date TEXT,
          validated_by TEXT,
          validated_at TEXT,
          version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS prospect_factory_map_claims_account_idx
          ON prospect_factory_map_claims(prospect_id, subject_node_id);

        CREATE TABLE IF NOT EXISTS prospect_factory_map_evidence_sources (
          id TEXT PRIMARY KEY,
          prospect_id TEXT NOT NULL REFERENCES prospect_factory_prospects(id) ON DELETE CASCADE,
          subject_kind TEXT NOT NULL CHECK(subject_kind IN ('relation','claim','stakeholder_role')),
          subject_id TEXT NOT NULL,
          source_id TEXT NOT NULL REFERENCES prospect_factory_map_sources(id) ON DELETE CASCADE,
          locator TEXT,
          excerpt TEXT,
          UNIQUE(subject_kind, subject_id, source_id)
        );
        CREATE INDEX IF NOT EXISTS prospect_factory_map_evidence_subject_idx
          ON prospect_factory_map_evidence_sources(prospect_id, subject_kind, subject_id);

        CREATE TABLE IF NOT EXISTS prospect_factory_map_stakeholder_roles (
          id TEXT PRIMARY KEY,
          prospect_id TEXT NOT NULL REFERENCES prospect_factory_prospects(id) ON DELETE CASCADE,
          opportunity_id TEXT NOT NULL REFERENCES prospect_factory_map_opportunities(id) ON DELETE CASCADE,
          person_node_id TEXT NOT NULL REFERENCES prospect_factory_map_nodes(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK(role IN ('user','process_owner','influencer','potential_relay','confirmed_champion','economic_decision_maker','technical_validator','security_validator','procurement','access_facilitator','unknown')),
          evidence_status TEXT NOT NULL CHECK(evidence_status IN ('observed','confirmed','hypothesis','contradictory','obsolete')),
          source_id TEXT REFERENCES prospect_factory_map_sources(id) ON DELETE SET NULL,
          source_ids_json TEXT NOT NULL DEFAULT '[]',
          notes TEXT NOT NULL DEFAULT '',
          validated_by TEXT,
          validated_at TEXT,
          version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK(role <> 'confirmed_champion' OR evidence_status='confirmed'),
          UNIQUE(opportunity_id, person_node_id, role)
        );
        CREATE INDEX IF NOT EXISTS prospect_factory_map_roles_account_idx
          ON prospect_factory_map_stakeholder_roles(prospect_id, opportunity_id);

        CREATE TABLE IF NOT EXISTS prospect_factory_map_questions (
          id TEXT PRIMARY KEY,
          prospect_id TEXT NOT NULL REFERENCES prospect_factory_prospects(id) ON DELETE CASCADE,
          subject_node_id TEXT REFERENCES prospect_factory_map_nodes(id) ON DELETE SET NULL,
          opportunity_id TEXT REFERENCES prospect_factory_map_opportunities(id) ON DELETE CASCADE,
          question TEXT NOT NULL,
          next_action TEXT,
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','answered','dismissed')),
          version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS prospect_factory_map_questions_account_idx
          ON prospect_factory_map_questions(prospect_id, status);

        CREATE TABLE IF NOT EXISTS prospect_factory_map_layouts (
          prospect_id TEXT NOT NULL REFERENCES prospect_factory_prospects(id) ON DELETE CASCADE,
          view TEXT NOT NULL CHECK(view IN ('organization','decision')),
          opportunity_key TEXT NOT NULL DEFAULT '',
          node_id TEXT NOT NULL REFERENCES prospect_factory_map_nodes(id) ON DELETE CASCADE,
          x REAL NOT NULL,
          y REAL NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(prospect_id, view, opportunity_key, node_id)
        );
        CREATE TABLE IF NOT EXISTS prospect_factory_map_viewports (
          prospect_id TEXT NOT NULL REFERENCES prospect_factory_prospects(id) ON DELETE CASCADE,
          view TEXT NOT NULL CHECK(view IN ('organization','decision')),
          opportunity_key TEXT NOT NULL DEFAULT '',
          x REAL NOT NULL,
          y REAL NOT NULL,
          zoom REAL NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(prospect_id, view, opportunity_key)
        );

        CREATE TABLE IF NOT EXISTS prospect_factory_map_import_batches (
          id TEXT PRIMARY KEY,
          prospect_id TEXT NOT NULL REFERENCES prospect_factory_prospects(id) ON DELETE CASCADE,
          payload_hash TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('applied','undone')),
          applied_at TEXT NOT NULL,
          applied_by TEXT NOT NULL,
          undone_at TEXT,
          undone_by TEXT
        );
        CREATE TABLE IF NOT EXISTS prospect_factory_map_import_changes (
          id TEXT PRIMARY KEY,
          batch_id TEXT NOT NULL REFERENCES prospect_factory_map_import_batches(id) ON DELETE CASCADE,
          entity_table TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          operation TEXT NOT NULL,
          before_json TEXT,
          after_json TEXT,
          applied_version TEXT,
          undone_at TEXT
        );
        CREATE INDEX IF NOT EXISTS prospect_factory_map_import_changes_batch_idx
          ON prospect_factory_map_import_changes(batch_id);

        CREATE TRIGGER IF NOT EXISTS prospect_factory_map_nodes_scope_insert
        BEFORE INSERT ON prospect_factory_map_nodes
        WHEN (NEW.contact_id IS NOT NULL AND NOT EXISTS
                (SELECT 1 FROM prospect_factory_contacts c WHERE c.id=NEW.contact_id AND c.prospect_id=NEW.prospect_id))
          OR (NEW.resolved_contact_id IS NOT NULL AND NOT EXISTS
                (SELECT 1 FROM prospect_factory_contacts c WHERE c.id=NEW.resolved_contact_id AND c.prospect_id=NEW.prospect_id))
          OR (NEW.opportunity_id IS NOT NULL AND NOT EXISTS
                (SELECT 1 FROM prospect_factory_map_opportunities o WHERE o.id=NEW.opportunity_id AND o.prospect_id=NEW.prospect_id))
        BEGIN SELECT RAISE(ABORT, 'account_map_cross_account_reference'); END;
        CREATE TRIGGER IF NOT EXISTS prospect_factory_map_nodes_scope_update
        BEFORE UPDATE ON prospect_factory_map_nodes
        WHEN (NEW.contact_id IS NOT NULL AND NOT EXISTS
                (SELECT 1 FROM prospect_factory_contacts c WHERE c.id=NEW.contact_id AND c.prospect_id=NEW.prospect_id))
          OR (NEW.resolved_contact_id IS NOT NULL AND NOT EXISTS
                (SELECT 1 FROM prospect_factory_contacts c WHERE c.id=NEW.resolved_contact_id AND c.prospect_id=NEW.prospect_id))
          OR (NEW.opportunity_id IS NOT NULL AND NOT EXISTS
                (SELECT 1 FROM prospect_factory_map_opportunities o WHERE o.id=NEW.opportunity_id AND o.prospect_id=NEW.prospect_id))
        BEGIN SELECT RAISE(ABORT, 'account_map_cross_account_reference'); END;
        CREATE TRIGGER IF NOT EXISTS prospect_factory_map_relations_scope_insert
        BEFORE INSERT ON prospect_factory_map_relations
        WHEN NOT EXISTS (SELECT 1 FROM prospect_factory_map_nodes n WHERE n.id=NEW.from_node_id AND n.prospect_id=NEW.prospect_id)
          OR NOT EXISTS (SELECT 1 FROM prospect_factory_map_nodes n WHERE n.id=NEW.to_node_id AND n.prospect_id=NEW.prospect_id)
          OR (NEW.opportunity_id IS NOT NULL AND NOT EXISTS
                (SELECT 1 FROM prospect_factory_map_opportunities o WHERE o.id=NEW.opportunity_id AND o.prospect_id=NEW.prospect_id))
          OR (NEW.source_id IS NOT NULL AND NOT EXISTS
                (SELECT 1 FROM prospect_factory_map_sources s WHERE s.id=NEW.source_id AND s.prospect_id=NEW.prospect_id))
        BEGIN SELECT RAISE(ABORT, 'account_map_cross_account_reference'); END;
        CREATE TRIGGER IF NOT EXISTS prospect_factory_map_relations_scope_update
        BEFORE UPDATE ON prospect_factory_map_relations
        WHEN NOT EXISTS (SELECT 1 FROM prospect_factory_map_nodes n WHERE n.id=NEW.from_node_id AND n.prospect_id=NEW.prospect_id)
          OR NOT EXISTS (SELECT 1 FROM prospect_factory_map_nodes n WHERE n.id=NEW.to_node_id AND n.prospect_id=NEW.prospect_id)
          OR (NEW.opportunity_id IS NOT NULL AND NOT EXISTS
                (SELECT 1 FROM prospect_factory_map_opportunities o WHERE o.id=NEW.opportunity_id AND o.prospect_id=NEW.prospect_id))
          OR (NEW.source_id IS NOT NULL AND NOT EXISTS
                (SELECT 1 FROM prospect_factory_map_sources s WHERE s.id=NEW.source_id AND s.prospect_id=NEW.prospect_id))
        BEGIN SELECT RAISE(ABORT, 'account_map_cross_account_reference'); END;
        CREATE TRIGGER IF NOT EXISTS prospect_factory_map_evidence_scope_insert
        BEFORE INSERT ON prospect_factory_map_evidence_sources
        WHEN NOT EXISTS (SELECT 1 FROM prospect_factory_map_sources s WHERE s.id=NEW.source_id AND s.prospect_id=NEW.prospect_id)
          OR (NEW.subject_kind='relation' AND NOT EXISTS
                (SELECT 1 FROM prospect_factory_map_relations r WHERE r.id=NEW.subject_id AND r.prospect_id=NEW.prospect_id))
          OR (NEW.subject_kind='claim' AND NOT EXISTS
                (SELECT 1 FROM prospect_factory_map_claims c WHERE c.id=NEW.subject_id AND c.prospect_id=NEW.prospect_id))
          OR (NEW.subject_kind='stakeholder_role' AND NOT EXISTS
                (SELECT 1 FROM prospect_factory_map_stakeholder_roles r WHERE r.id=NEW.subject_id AND r.prospect_id=NEW.prospect_id))
        BEGIN SELECT RAISE(ABORT, 'account_map_cross_account_reference'); END;
        CREATE TRIGGER IF NOT EXISTS prospect_factory_map_relations_evidence_delete
        AFTER DELETE ON prospect_factory_map_relations
        BEGIN DELETE FROM prospect_factory_map_evidence_sources
          WHERE subject_kind='relation' AND subject_id=OLD.id; END;
        CREATE TRIGGER IF NOT EXISTS prospect_factory_map_claims_evidence_delete
        AFTER DELETE ON prospect_factory_map_claims
        BEGIN DELETE FROM prospect_factory_map_evidence_sources
          WHERE subject_kind='claim' AND subject_id=OLD.id; END;
        CREATE TRIGGER IF NOT EXISTS prospect_factory_map_roles_evidence_delete
        AFTER DELETE ON prospect_factory_map_stakeholder_roles
        BEGIN DELETE FROM prospect_factory_map_evidence_sources
          WHERE subject_kind='stakeholder_role' AND subject_id=OLD.id; END;
      `);
      db.exec("PRAGMA user_version = 6");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return db;
}

/** Share the initialized CRM SQLite connection with account-map services. */
export function withAccountMapDatabase<T>(fn: (db: DatabaseSync) => T): T {
  return fn(getDatabase());
}

function seedInitialMarket(db: DatabaseSync) {
  const timestamp = now();
  const slug = "entreprises-complexite-operationnelle-elevee";
  const criteria = [
    "Complexité opérationnelle suffisante pour rendre coûteux les processus manuels.",
    "Environ 20 à 200 salariés de préférence ; cette plage reste indicative.",
    "Guadeloupe, Antilles-Guyane ou territoires similaires.",
    "Plusieurs entités, établissements, équipes, territoires ou flux ; reporting, consolidation et tâches administratives récurrentes.",
    "Croissance et hypercroissance non obligatoires."
  ];
  const signalWeights = Object.fromEntries(PROSPECT_OPERATIONAL_SIGNALS.map((signal) => [signal, 1]));
  db.prepare(`
    INSERT OR IGNORE INTO prospect_factory_icps (
      id, slug, name, description, qualification_criteria_json, exclusions_json,
      employee_min, employee_max, territories_json, signal_weights_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(), slug, "Entreprises à complexité opérationnelle élevée",
    "Entreprises de préférence de 20 à 200 salariés, situées en Guadeloupe, aux Antilles-Guyane ou dans des territoires similaires, où la complexité opérationnelle rend coûteux les processus manuels. La croissance n'est pas un critère obligatoire.",
    JSON.stringify(criteria), "[]", 20, 200,
    JSON.stringify(["Guadeloupe", "Antilles-Guyane", "Territoires similaires"]),
    JSON.stringify(signalWeights), timestamp, timestamp
  );
  const icp = db.prepare("SELECT id FROM prospect_factory_icps WHERE slug = ?").get(slug) as { id: string };
  const segments = [
    {
      slug: "groupes-familiaux-locaux",
      name: "Groupes familiaux locaux",
      description: "Entreprises ou groupes détenus localement, souvent historiquement implantés sur le territoire.",
      criteria: ["Plusieurs sociétés, activités ou établissements", "Gouvernance familiale", "Processus historiques ou organisation informelle", "Dépendance possible à Excel, email ou à des personnes clés", "Visibilité numérique parfois limitée"]
    },
    {
      slug: "filiales-antennes-regionales-groupes-nationaux",
      name: "Filiales / antennes régionales de groupes nationaux",
      description: "Entités locales rattachées à un groupe national ou international, avec reporting et décision potentiellement répartie entre local et siège.",
      criteria: ["Management local et reporting au siège", "Processus ou outils imposés partiellement par le groupe", "Autonomie budgétaire variable", "Champion local possible, décideur ou validateur au siège", "Identifier IT, sécurité et achats"]
    },
    {
      slug: "pme-structurees-peu-digitalisees",
      name: "PME structurées mais peu digitalisées",
      description: "PME dont la taille ou la complexité est significative mais dont les processus restent très manuels.",
      criteria: ["Reporting et consolidation sur Excel", "Fichiers échangés par email", "Saisie répétitive et tâches administratives récurrentes", "Intégrations absentes ou outils hétérogènes", "Reporting chronophage"]
    }
  ];
  for (const segment of segments) {
    db.prepare(`
      INSERT OR IGNORE INTO prospect_factory_icp_segments
        (id, icp_id, slug, name, description, criteria_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), icp.id, segment.slug, segment.name, segment.description, JSON.stringify(segment.criteria), timestamp, timestamp);
  }
  const personas = [
    ["dg", "DG / dirigeant"], ["daf", "DAF"], ["raf", "RAF"],
    ["responsable-comptable", "Responsable comptable"], ["directeur-operations", "Directeur des opérations"],
    ["responsable-administratif", "Responsable administratif"], ["directeur-regional", "Directeur régional"],
    ["assistante-direction", "Assistante de direction"], ["responsable-transformation", "Responsable transformation"],
    ["dsi-it", "DSI / IT"]
  ] as const;
  personas.forEach(([key, label], index) => {
    db.prepare(`
      INSERT OR IGNORE INTO prospect_factory_icp_personas
        (id, icp_id, persona_key, label, description, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, '', ?, ?, ?)
    `).run(randomUUID(), icp.id, key, label, index, timestamp, timestamp);
  });
}

function nullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function parseTags(value: unknown) {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function nullableNumber(value: unknown) {
  return value === null || value === undefined || value === "" ? null : Number(value);
}

function mapContact(row: ProspectRow): ProspectContact {
  const legacyRole = nullableString(row.buying_committee_role);
  const roleFromLegacy: Partial<Record<string, ProspectDealRole>> = {
    champion: "champion", economic_buyer: "economic_decision_maker", user: "user",
    technical_buyer: "it_security", procurement: "procurement", sponsor: "influencer", blocker: "gatekeeper"
  };
  const storedRoles = parseTags(row.deal_roles_json).filter((role): role is ProspectDealRole =>
    (PROSPECT_DEAL_ROLES as readonly string[]).includes(role));
  return {
    id: String(row.id),
    name: String(row.name),
    firstName: nullableString(row.first_name),
    lastName: nullableString(row.last_name),
    email: nullableString(row.email),
    phone: nullableString(row.phone),
    linkedin: nullableString(row.linkedin),
    seniority: nullableString(row.seniority),
    personaKey: nullableString(row.persona_key),
    dealRoles: storedRoles.length ? storedRoles : legacyRole && roleFromLegacy[legacyRole] ? [roleFromLegacy[legacyRole]!] : [],
    decisionScope: nullableString(row.decision_scope) as ProspectDecisionScope | null,
    inputTitle: nullableString(row.input_title),
    verifiedTitle: nullableString(row.verified_title),
    evidenceType: String(row.evidence_type) as ProspectContact["evidenceType"],
    sourceUrl: nullableString(row.source_url),
    sourceRowOrRecord: nullableString(row.source_row_or_record),
    buyingCommitteeRole: nullableString(row.buying_committee_role) as ProspectContact["buyingCommitteeRole"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapResearchSource(row: ProspectRow): ProspectResearchSource {
  return {
    id: String(row.id),
    url: String(row.source_url),
    sourceType: String(row.source_type) as ProspectResearchSourceType,
    supportedClaim: String(row.supported_claim),
    publishedAt: nullableString(row.published_at),
    researchedAt: String(row.researched_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapObservation(row: ProspectRow): ProspectObservation {
  return {
    id: String(row.id),
    kind: String(row.observation_kind) as ProspectObservationKind,
    statement: String(row.statement),
    evidenceStatus: String(row.evidence_status) as ProspectObservationStatus,
    category: nullableString(row.category),
    sourceUrl: nullableString(row.source_url),
    occurredAt: nullableString(row.occurred_at),
    publishedAt: nullableString(row.published_at),
    researchedAt: String(row.researched_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function listRelations(prospectId: string) {
  const db = getDatabase();
  const contacts = db.prepare(`
    SELECT * FROM prospect_factory_contacts WHERE prospect_id = ?
    ORDER BY name COLLATE NOCASE ASC, id ASC
  `).all(prospectId) as ProspectRow[];
  const researchSources = db.prepare(`
    SELECT * FROM prospect_factory_research_sources WHERE prospect_id = ?
    ORDER BY researched_at DESC, id ASC
  `).all(prospectId) as ProspectRow[];
  const observations = db.prepare(`
    SELECT * FROM prospect_factory_observations WHERE prospect_id = ?
    ORDER BY researched_at DESC, id ASC
  `).all(prospectId) as ProspectRow[];
  return {
    contacts: contacts.map(mapContact),
    researchSources: researchSources.map(mapResearchSource),
    observations: observations.map(mapObservation)
  };
}

function mapProspect(row: ProspectRow): TrackedProspect {
  const dedupeKey = String(row.dedupe_key);
  const sourceInputType = nullableString(row.source_input_type) as ProspectSourceInputType | null;
  const sourceInput: ProspectSourceInput | null = sourceInputType ? {
    type: sourceInputType,
    reference: nullableString(row.source_input_reference),
    rowOrRecord: nullableString(row.source_input_row_or_record),
    extractionStatus: (nullableString(row.source_input_status) ?? "extracted") as ProspectSourceExtractionStatus,
    extractionNote: nullableString(row.source_input_note)
  } : null;
  const relations = listRelations(String(row.id));
  const segmentId = nullableString(row.segment_id);
  const segment = segmentId ? getDatabase().prepare("SELECT icp_id FROM prospect_factory_icp_segments WHERE id = ?").get(segmentId) as { icp_id: string } | undefined : undefined;
  const legacyName = nullableString(row.contact_name)?.trim() || nullableString(row.source_contact_name)?.trim() || null;
  const legacyEmail = nullableString(row.email)?.trim() || nullableString(row.source_email)?.trim() || null;
  const legacyPhone = nullableString(row.phone)?.trim() || nullableString(row.source_phone)?.trim() || null;
  const legacyAlreadyStructured = relations.contacts.some((contact) =>
    (legacyEmail && contact.email?.toLocaleLowerCase() === legacyEmail.toLocaleLowerCase())
    || (legacyName && contact.name.toLocaleLowerCase() === legacyName.toLocaleLowerCase()));
  return {
    id: String(row.id),
    warehouseId: String(row.warehouse_id),
    dedupeKey,
    version: Number(row.version),
    snapshot: {
      dedupeKey,
      companyName: String(row.company_name),
      commercialName: nullableString(row.commercial_name),
      country: String(row.country),
      territory: String(row.territory),
      region: nullableString(row.region),
      city: nullableString(row.city),
      vertical: nullableString(row.vertical),
      recordOrigin: String(row.record_origin),
      sourceUrls: String(row.source_urls),
      leadScore: Number(row.lead_score),
      certification: String(row.certification) as ProspectCertification,
      contactName: nullableString(row.source_contact_name),
      email: nullableString(row.source_email),
      phone: nullableString(row.source_phone),
      website: nullableString(row.source_website),
      activityDetail: nullableString(row.source_activity_detail),
      employeeRange: nullableString(row.source_employee_range)
    },
    enrichment: {
      contactName: nullableString(row.contact_name),
      email: nullableString(row.email),
      phone: nullableString(row.phone),
      website: nullableString(row.website),
      jobTitle: nullableString(row.job_title),
      linkedin: nullableString(row.linkedin),
      address: nullableString(row.address)
    },
    qualification: {
      status: String(row.qualification_status) as ProspectQualificationStatus,
      priority: String(row.priority) as ProspectPriority,
      tags: parseTags(row.tags_json),
      notes: String(row.notes),
      nextActionAt: nullableString(row.next_action_at),
      nextActionLabel: nullableString(row.next_action_label),
      lastContactedAt: nullableString(row.last_contacted_at),
      owner: nullableString(row.owner),
      campaign: nullableString(row.campaign),
      potentialValue: row.potential_value === null || row.potential_value === undefined ? null : Number(row.potential_value),
      probability: row.probability === null || row.probability === undefined ? null : Number(row.probability),
      expectedCloseAt: nullableString(row.expected_close_at),
      disqualificationReason: nullableString(row.disqualification_reason),
      fitScore: nullableNumber(row.fit_score),
      painScore: nullableNumber(row.pain_score),
      timingScore: nullableNumber(row.timing_score),
      personaScore: nullableNumber(row.persona_score),
      scoreTotal: nullableNumber(row.qualification_score_total),
      tier: nullableString(row.qualification_tier) as ProspectQualificationTier | null,
      confidence: nullableString(row.qualification_confidence) as TrackedProspect["qualification"]["confidence"],
      scoreReason: nullableString(row.qualification_score_reason)
    },
    research: {
      accountKey: nullableString(row.account_key),
      businessSummary: nullableString(row.business_summary),
      offerHypothesis: nullableString(row.offer_hypothesis),
      nextVerification: nullableString(row.next_verification),
      recommendedNextActionAt: nullableString(row.recommended_next_action_at),
      sourceInput,
      firstActionAt: nullableString(row.first_action_at),
      lastActionAt: nullableString(row.last_action_at),
      firstApproachedAt: nullableString(row.first_approached_at),
      lastApproachedAt: nullableString(row.last_approached_at),
      firstResearchedAt: nullableString(row.first_researched_at),
      lastResearchedAt: nullableString(row.last_researched_at),
      firstQualifiedAt: nullableString(row.first_qualified_at),
      lastQualifiedAt: nullableString(row.last_qualified_at),
      statusChangedAt: nullableString(row.status_changed_at),
      reportingTimezone: nullableString(row.reporting_timezone) ?? DEFAULT_REPORTING_TIMEZONE
    },
    contacts: relations.contacts,
    market: {
      icpId: segment?.icp_id ?? null,
      segmentId,
      groupName: nullableString(row.group_name),
      siren: nullableString(row.siren),
      siret: nullableString(row.siret),
      employeeCountEstimate: nullableNumber(row.employee_count_estimate),
      establishmentCount: nullableNumber(row.establishment_count),
      entityCount: nullableNumber(row.entity_count),
      operationalSignals: parseTags(row.operational_signals_json).filter((signal): signal is ProspectOperationalSignal =>
        (PROSPECT_OPERATIONAL_SIGNALS as readonly string[]).includes(signal)),
      icpFitScore: nullableNumber(row.icp_fit_score),
      icpFitReason: nullableString(row.icp_fit_reason)
    },
    legacyContact: legacyName && !legacyAlreadyStructured ? {
      name: legacyName,
      email: legacyEmail,
      phone: legacyPhone,
      title: nullableString(row.job_title),
      linkedin: nullableString(row.linkedin)
    } : null,
    researchSources: relations.researchSources,
    observations: relations.observations,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapActivity(row: ProspectRow): ProspectActivity {
  const type = String(row.activity_type) as ProspectActivityType;
  const actionKind = String(row.action_kind || "activity") as ProspectActivityActionKind;
  return {
    id: String(row.id),
    prospectId: String(row.prospect_id),
    contactId: nullableString(row.contact_id),
    type,
    detailType: nullableString(row.detail_type) as ProspectActivity["detailType"],
    actionKind,
    eventType: (nullableString(row.event_type) ?? eventTypeFromActivity(type, actionKind)) as ProspectEventType,
    direction: nullableString(row.direction) as ProspectActivityDirection | null,
    outcome: nullableString(row.outcome) as ProspectActivityOutcome | null,
    subject: nullableString(row.subject),
    body: String(row.body),
    nextActionLabel: nullableString(row.next_action_label),
    nextActionAt: nullableString(row.next_action_at),
    occurredAt: String(row.occurred_at),
    statusBefore: nullableString(row.status_before) as ProspectQualificationStatus | null,
    statusAfter: nullableString(row.status_after) as ProspectQualificationStatus | null,
    actorRole: String(row.actor_role),
    actorId: nullableString(row.actor_id),
    source: (nullableString(row.event_source) ?? "ui") as ProspectEventSource,
    idempotencyKey: nullableString(row.idempotency_key),
    reportingTimezone: nullableString(row.reporting_timezone) ?? DEFAULT_REPORTING_TIMEZONE,
    metadata: parseJsonObject(row.metadata_json),
    recordedAt: nullableString(row.recorded_at) ?? String(row.created_at),
    createdAt: String(row.created_at)
  };
}

function eventTypeFromActivity(type: ProspectActivityType, actionKind: ProspectActivityActionKind): ProspectEventType {
  if (actionKind === "approach") return "approach";
  if (type === "status_change") return "status_changed";
  if (type === "enrichment") return "enrichment_updated";
  if (type === "call") return "call_logged";
  if (type === "meeting") return "meeting_booked";
  return "note_added";
}

function activityActionKind(type: ProspectActivityType, direction: ProspectActivityDirection | null, detailType?: AddProspectActivityInput["detailType"]): ProspectActivityActionKind {
  if (direction === "outbound" && detailType && ["linkedin_connection", "linkedin_message", "follow_up", "proposal"].includes(detailType)) return "approach";
  if ((type === "call" || type === "email" || type === "meeting") && direction === "outbound") return "approach";
  if (type === "status_change") return "status_change";
  if (type === "enrichment") return "enrichment";
  return "activity";
}

type AppendProspectEventInput = {
  prospectId: string;
  contactId: string | null;
  type: ProspectActivityType;
  detailType?: AddProspectActivityInput["detailType"];
  actionKind: ProspectActivityActionKind;
  eventType: ProspectEventType;
  direction: ProspectActivityDirection | null;
  outcome: ProspectActivityOutcome | null;
  subject: string | null;
  body: string;
  nextActionLabel?: string | null;
  nextActionAt?: string | null;
  occurredAt: string;
  statusBefore: ProspectQualificationStatus | null;
  statusAfter: ProspectQualificationStatus | null;
  actorRole: string;
  actorId: string | null;
  source: ProspectEventSource;
  idempotencyKey: string | null;
  reportingTimezone: string;
  metadata: Record<string, unknown>;
  recordedAt: string;
};

function applyTemporalProjections(db: DatabaseSync, event: AppendProspectEventInput) {
  const assignments: string[] = ["reporting_timezone = ?"];
  const parameters: SQLInputValue[] = [event.reportingTimezone];
  const range = (firstColumn: string, lastColumn: string) => {
    assignments.push(
      `${firstColumn} = CASE WHEN ${firstColumn} IS NULL OR ${firstColumn} > ? THEN ? ELSE ${firstColumn} END`,
      `${lastColumn} = CASE WHEN ${lastColumn} IS NULL OR ${lastColumn} < ? THEN ? ELSE ${lastColumn} END`
    );
    parameters.push(event.occurredAt, event.occurredAt, event.occurredAt, event.occurredAt);
  };
  // Imports only describe the data entering the CRM; they are never a
  // commercial action. Research and qualification are real, traceable actions.
  if (event.eventType !== "prospect_created" && event.eventType !== "imported") {
    range("first_action_at", "last_action_at");
  }
  if (event.actionKind === "approach") range("first_approached_at", "last_approached_at");
  if (event.eventType === "research_completed") range("first_researched_at", "last_researched_at");
  if (event.eventType === "qualified") range("first_qualified_at", "last_qualified_at");
  if (event.eventType === "status_changed") {
    assignments.push("status_changed_at = CASE WHEN status_changed_at IS NULL OR status_changed_at < ? THEN ? ELSE status_changed_at END");
    parameters.push(event.occurredAt, event.occurredAt);
  }
  db.prepare(`
    UPDATE prospect_factory_prospects
    SET ${assignments.join(", ")}
    WHERE id = ?
  `).run(...parameters, event.prospectId);
}

/** Appends an event and updates only derived temporal projections. */
function appendProspectEvent(db: DatabaseSync, event: AppendProspectEventInput) {
  if (event.contactId) {
    const contact = db.prepare(
      "SELECT id FROM prospect_factory_contacts WHERE id = ? AND prospect_id = ?"
    ).get(event.contactId, event.prospectId);
    if (!contact) throw new ProspectCrmInputError("contactId", "contactId must belong to this prospect.");
  }
  if (event.idempotencyKey) {
    const existing = db.prepare(`
      SELECT * FROM prospect_factory_activities
      WHERE prospect_id = ? AND idempotency_key = ?
    `).get(event.prospectId, event.idempotencyKey) as ProspectRow | undefined;
    if (existing) return { activity: mapActivity(existing), idempotent: true };
  }
  const id = randomUUID();
  db.prepare(`
    INSERT INTO prospect_factory_activities (
      id, prospect_id, contact_id, activity_type, action_kind, event_type, direction, outcome, subject, body, occurred_at,
      status_before, status_after, actor_role, actor_id, event_source, idempotency_key, reporting_timezone,
      metadata_json, recorded_at, created_at, detail_type, next_action_label, next_action_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    event.prospectId,
    event.contactId,
    event.type,
    event.actionKind,
    event.eventType,
    event.direction,
    event.outcome,
    event.subject,
    event.body,
    event.occurredAt,
    event.statusBefore,
    event.statusAfter,
    event.actorRole,
    event.actorId,
    event.source,
    event.idempotencyKey,
    event.reportingTimezone,
    JSON.stringify(event.metadata),
    event.recordedAt,
    event.recordedAt,
    event.detailType ?? null,
    event.nextActionLabel ?? null,
    event.nextActionAt ?? null
  );
  applyTemporalProjections(db, event);
  const row = db.prepare("SELECT * FROM prospect_factory_activities WHERE id = ?").get(id) as ProspectRow | undefined;
  if (!row) throw new Error("Prospect event was not persisted.");
  return { activity: mapActivity(row), idempotent: false };
}

export function getProspectByWarehouseId(warehouseId: string): TrackedProspect | null {
  assertRequiredText("warehouseId", warehouseId, 256);
  const row = getDatabase().prepare(
    "SELECT * FROM prospect_factory_prospects WHERE warehouse_id = ?"
  ).get(warehouseId) as ProspectRow | undefined;
  return row ? mapProspect(row) : null;
}

export function getProspectByAccountKey(accountKey: string): TrackedProspect | null {
  assertRequiredText("accountKey", accountKey, 256);
  const row = getDatabase().prepare(
    "SELECT * FROM prospect_factory_prospects WHERE account_key = ? COLLATE NOCASE"
  ).get(accountKey.trim()) as ProspectRow | undefined;
  return row ? mapProspect(row) : null;
}

/**
 * Adds a prospect idempotently. Re-adding the same warehouse id refreshes only the
 * canonical source snapshot; manually maintained CRM fields are never replaced.
 */
export function addProspect(input: AddProspectInput): TrackedProspect {
  validateAddProspectInput(input);
  const db = getDatabase();
  const timestamp = now();
  const id = randomUUID();
  const enrichment = input.enrichment ?? {};
  const qualification = input.qualification ?? {};
  const score = deriveScoreProjection(qualification);
  const snapshot = input.snapshot;

  db.prepare(`
    INSERT INTO prospect_factory_prospects (
      id, warehouse_id, dedupe_key, company_name, commercial_name, country, territory, region, city, vertical,
      record_origin, source_urls, lead_score, certification,
      source_contact_name, source_email, source_phone, source_website, source_activity_detail, source_employee_range,
      contact_name, email, phone, website, job_title, linkedin, address,
      qualification_status, priority, tags_json, notes, next_action_at, last_contacted_at,
      owner, campaign, potential_value, probability, expected_close_at, disqualification_reason,
      fit_score, pain_score, timing_score, persona_score, qualification_score_total, qualification_tier,
      qualification_confidence, qualification_score_reason, reporting_timezone,
      version, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?,
      1, ?, ?
    )
    ON CONFLICT(warehouse_id) DO UPDATE SET
      dedupe_key = excluded.dedupe_key,
      company_name = excluded.company_name,
      commercial_name = excluded.commercial_name,
      country = excluded.country,
      territory = excluded.territory,
      region = excluded.region,
      city = excluded.city,
      vertical = excluded.vertical,
      record_origin = excluded.record_origin,
      source_urls = excluded.source_urls,
      lead_score = excluded.lead_score,
      certification = excluded.certification,
      source_contact_name = excluded.source_contact_name,
      source_email = excluded.source_email,
      source_phone = excluded.source_phone,
      source_website = excluded.source_website,
      source_activity_detail = excluded.source_activity_detail,
      source_employee_range = excluded.source_employee_range,
      version = prospect_factory_prospects.version + 1,
      updated_at = excluded.updated_at
  `).run(
    id,
    input.warehouseId,
    snapshot.dedupeKey,
    snapshot.companyName,
    snapshot.commercialName,
    snapshot.country,
    snapshot.territory,
    snapshot.region,
    snapshot.city,
    snapshot.vertical,
    snapshot.recordOrigin,
    snapshot.sourceUrls,
    snapshot.leadScore,
    snapshot.certification,
    snapshot.contactName ?? null,
    snapshot.email ?? null,
    snapshot.phone ?? null,
    snapshot.website ?? null,
    snapshot.activityDetail ?? null,
    snapshot.employeeRange ?? null,
    enrichment.contactName ?? null,
    enrichment.email ?? null,
    enrichment.phone ?? null,
    enrichment.website ?? null,
    enrichment.jobTitle ?? null,
    enrichment.linkedin ?? null,
    enrichment.address ?? null,
    qualification.status ?? "to_qualify",
    qualification.priority ?? "normal",
    JSON.stringify(qualification.tags ?? []),
    qualification.notes ?? "",
    canonicalOptionalDate(qualification.nextActionAt),
    canonicalOptionalDate(qualification.lastContactedAt),
    qualification.owner ?? null,
    qualification.campaign ?? null,
    qualification.potentialValue ?? null,
    qualification.probability ?? null,
    canonicalOptionalDate(qualification.expectedCloseAt),
    qualification.disqualificationReason ?? null,
    score.fitScore,
    score.painScore,
    score.timingScore,
    score.personaScore,
    score.scoreTotal,
    score.tier,
    qualification.confidence ?? null,
    qualification.scoreReason ?? null,
    DEFAULT_REPORTING_TIMEZONE,
    timestamp,
    timestamp
  );

  return getProspectByWarehouseId(input.warehouseId)!;
}

export function getProspect(id: string): TrackedProspect | null {
  assertRequiredText("id", id, 256);
  const row = getDatabase().prepare(
    "SELECT * FROM prospect_factory_prospects WHERE id = ?"
  ).get(id) as ProspectRow | undefined;
  return row ? mapProspect(row) : null;
}

function asList<T>(value: T | readonly T[] | undefined) {
  if (value === undefined) return [];
  return Array.isArray(value) ? [...value] as T[] : [value as T];
}

function escapeLike(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export function getProspectFilterOptions(): ProspectCrmFilterOptions {
  const db = getDatabase();
  const groupedOptions = (column: "country" | "territory" | "vertical" | "record_origin" | "certification") => db.prepare(`
    SELECT ${column} AS value, COUNT(*) AS count
    FROM prospect_factory_prospects
    WHERE NULLIF(TRIM(${column}), '') IS NOT NULL
    GROUP BY ${column}
    ORDER BY count DESC, value COLLATE NOCASE ASC
  `).all() as Array<{ value: string; count: number }>;
  const hasEmail = "(NULLIF(TRIM(email), '') IS NOT NULL OR NULLIF(TRIM(source_email), '') IS NOT NULL)";
  const hasPhone = "(NULLIF(TRIM(phone), '') IS NOT NULL OR NULLIF(TRIM(source_phone), '') IS NOT NULL)";
  const hasWebsite = "(NULLIF(TRIM(website), '') IS NOT NULL OR NULLIF(TRIM(source_website), '') IS NOT NULL)";
  const contactCounts = db.prepare(`
    SELECT
      SUM(CASE WHEN ${hasEmail} OR ${hasPhone} OR ${hasWebsite} THEN 1 ELSE 0 END) AS contact_any,
      SUM(CASE WHEN ${hasEmail} THEN 1 ELSE 0 END) AS contact_email,
      SUM(CASE WHEN ${hasPhone} THEN 1 ELSE 0 END) AS contact_phone,
      SUM(CASE WHEN ${hasWebsite} THEN 1 ELSE 0 END) AS contact_website,
      SUM(CASE WHEN NOT ${hasWebsite} THEN 1 ELSE 0 END) AS contact_no_website
    FROM prospect_factory_prospects
  `).get() as Record<string, number | null>;
  const contactOrder: ProspectContactFilter[] = ["any", "email", "phone", "website", "no_website"];

  return {
    countries: groupedOptions("country"),
    territories: groupedOptions("territory"),
    verticals: groupedOptions("vertical"),
    origins: groupedOptions("record_origin"),
    certifications: groupedOptions("certification"),
    contacts: contactOrder.map((value) => ({
      value,
      count: Number(contactCounts[`contact_${value}`] ?? 0)
    }))
  };
}

export function listProspects(options: ListProspectsOptions = {}): ProspectListResult {
  const db = getDatabase();
  const clauses: string[] = [];
  const parameters: SQLInputValue[] = [];
  const statuses = asList(options.status);
  const priorities = asList(options.priority);

  statuses.forEach((status) => assertEnum("status", status, PROSPECT_QUALIFICATION_STATUSES));
  priorities.forEach((priority) => assertEnum("priority", priority, PROSPECT_PRIORITIES));
  assertOptionalText("query", options.query, 1_000);
  assertOptionalText("country", options.country, 1_000);
  assertOptionalText("territory", options.territory, 2_000);
  assertOptionalText("vertical", options.vertical, 5_000);
  assertOptionalText("origin", options.origin, 2_000);
  if (options.certification !== undefined) assertEnum("certification", options.certification, ["gold", "silver", "bronze", "blocked"]);
  if (options.contact !== undefined) assertEnum("contact", options.contact, ["any", "email", "phone", "website", "no_website"]);
  assertOptionalNumber("minScore", options.minScore, 0, 100);

  if (statuses.length) {
    clauses.push(`qualification_status IN (${statuses.map(() => "?").join(", ")})`);
    parameters.push(...statuses);
  }
  if (priorities.length) {
    clauses.push(`priority IN (${priorities.map(() => "?").join(", ")})`);
    parameters.push(...priorities);
  }
  for (const [column, value] of [
    ["country", options.country],
    ["territory", options.territory],
    ["vertical", options.vertical],
    ["record_origin", options.origin],
    ["certification", options.certification]
  ] as const) {
    if (value) {
      clauses.push(`${column} = ? COLLATE NOCASE`);
      parameters.push(value);
    }
  }
  if (options.minScore !== undefined && options.minScore > 0) {
    clauses.push("lead_score >= ?");
    parameters.push(options.minScore);
  }
  const hasEmail = "(NULLIF(TRIM(email), '') IS NOT NULL OR NULLIF(TRIM(source_email), '') IS NOT NULL)";
  const hasPhone = "(NULLIF(TRIM(phone), '') IS NOT NULL OR NULLIF(TRIM(source_phone), '') IS NOT NULL)";
  const hasWebsite = "(NULLIF(TRIM(website), '') IS NOT NULL OR NULLIF(TRIM(source_website), '') IS NOT NULL)";
  if (options.contact === "any") clauses.push(`(${hasEmail} OR ${hasPhone} OR ${hasWebsite})`);
  if (options.contact === "email") clauses.push(hasEmail);
  if (options.contact === "phone") clauses.push(hasPhone);
  if (options.contact === "website") clauses.push(hasWebsite);
  if (options.contact === "no_website") clauses.push(`NOT ${hasWebsite}`);
  if (options.query) {
    const search = `%${escapeLike(options.query)}%`;
    const searchableColumns = [
      "company_name", "commercial_name", "country", "territory", "region", "city", "vertical",
      "source_activity_detail", "source_employee_range", "record_origin", "source_contact_name", "contact_name",
      "email", "source_email", "phone", "source_phone", "website", "source_website", "owner", "campaign", "notes"
    ];
    clauses.push(`(${searchableColumns.map((column) => `${column} LIKE ? ESCAPE '\\' COLLATE NOCASE`).join(" OR ")})`);
    parameters.push(...searchableColumns.map(() => search));
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const requestedLimit = Number.isFinite(options.limit) ? Math.trunc(options.limit!) : 50;
  const requestedOffset = Number.isSafeInteger(options.offset) ? options.offset! : 0;
  const limit = Math.max(1, Math.min(200, requestedLimit));
  const offset = Math.max(0, requestedOffset);
  const totalRow = db.prepare(
    `SELECT COUNT(*) AS total FROM prospect_factory_prospects ${where}`
  ).get(...parameters) as { total: number };
  const rows = db.prepare(`
    SELECT * FROM prospect_factory_prospects
    ${where}
    ORDER BY
      CASE WHEN next_action_at IS NULL THEN 1 ELSE 0 END,
      next_action_at ASC,
      CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
      updated_at DESC,
      id ASC
    LIMIT ? OFFSET ?
  `).all(...parameters, limit, offset) as ProspectRow[];

  return {
    prospects: rows.map(mapProspect),
    total: Number(totalRow.total),
    limit,
    offset
  };
}

export function updateProspect(id: string, input: UpdateProspectInput): TrackedProspect | null {
  assertRequiredText("id", id, 256);
  validateUpdateProspectInput(input);
  const assignments: string[] = [];
  const parameters: SQLInputValue[] = [];

  function assign(column: string, value: SQLInputValue) {
    assignments.push(`${column} = ?`);
    parameters.push(value);
  }

  const enrichment = input.enrichment;
  if (enrichment) {
    if (enrichment.contactName !== undefined) assign("contact_name", enrichment.contactName);
    if (enrichment.email !== undefined) assign("email", enrichment.email);
    if (enrichment.phone !== undefined) assign("phone", enrichment.phone);
    if (enrichment.website !== undefined) assign("website", enrichment.website);
    if (enrichment.jobTitle !== undefined) assign("job_title", enrichment.jobTitle);
    if (enrichment.linkedin !== undefined) assign("linkedin", enrichment.linkedin);
    if (enrichment.address !== undefined) assign("address", enrichment.address);
  }

  const qualification = input.qualification;
  if (qualification) {
    if (qualification.status !== undefined) assign("qualification_status", qualification.status);
    if (qualification.priority !== undefined) assign("priority", qualification.priority);
    if (qualification.tags !== undefined) assign("tags_json", JSON.stringify(qualification.tags));
    if (qualification.notes !== undefined) assign("notes", qualification.notes);
    if (qualification.nextActionAt !== undefined) assign("next_action_at", qualification.nextActionAt);
    if (qualification.nextActionLabel !== undefined) assign("next_action_label", qualification.nextActionLabel);
    if (qualification.lastContactedAt !== undefined) assign("last_contacted_at", qualification.lastContactedAt);
    if (qualification.owner !== undefined) assign("owner", qualification.owner);
    if (qualification.campaign !== undefined) assign("campaign", qualification.campaign);
    if (qualification.potentialValue !== undefined) assign("potential_value", qualification.potentialValue);
    if (qualification.probability !== undefined) assign("probability", qualification.probability);
    if (qualification.expectedCloseAt !== undefined) assign("expected_close_at", qualification.expectedCloseAt);
    if (qualification.disqualificationReason !== undefined) assign("disqualification_reason", qualification.disqualificationReason);
    const scoreFieldsProvided = qualification.fitScore !== undefined
      || qualification.painScore !== undefined
      || qualification.timingScore !== undefined
      || qualification.personaScore !== undefined
      || qualification.scoreTotal !== undefined
      || qualification.tier !== undefined;
    if (scoreFieldsProvided) {
      const current = getProspect(id);
      if (!current) return null;
      const score = deriveScoreProjection(qualification, current.qualification);
      assign("fit_score", score.fitScore);
      assign("pain_score", score.painScore);
      assign("timing_score", score.timingScore);
      assign("persona_score", score.personaScore);
      assign("qualification_score_total", score.scoreTotal);
      assign("qualification_tier", score.tier);
    }
    if (qualification.confidence !== undefined) assign("qualification_confidence", qualification.confidence);
    if (qualification.scoreReason !== undefined) assign("qualification_score_reason", qualification.scoreReason);
  }

  if (!assignments.length) {
    const current = getProspect(id);
    if (current && input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
      throw new ProspectVersionConflictError(id, input.expectedVersion, current.version);
    }
    return current;
  }
  assign("updated_at", now());
  assignments.push("version = version + 1");
  const versionClause = input.expectedVersion === undefined ? "" : " AND version = ?";
  const result = getDatabase().prepare(
    `UPDATE prospect_factory_prospects SET ${assignments.join(", ")} WHERE id = ?${versionClause}`
  ).run(...parameters, id, ...(input.expectedVersion === undefined ? [] : [input.expectedVersion]));
  if (Number(result.changes) > 0) return getProspect(id);

  const current = getProspect(id);
  if (current && input.expectedVersion !== undefined) {
    throw new ProspectVersionConflictError(id, input.expectedVersion, current.version);
  }
  return null;
}

const STATUS_AUDIT_LABELS: Record<ProspectQualificationStatus, string> = {
  to_qualify: "À qualifier",
  qualified: "Qualifié",
  to_contact: "À contacter",
  contacted: "Contacté",
  in_conversation: "En discussion",
  opportunity: "Opportunité",
  won: "Gagné",
  lost: "Perdu",
  disqualified: "Écarté"
};

/**
 * Applies a PATCH and its audit events under one SQLite write lock. This does
 * not call updateProspect or addProspectActivity, so no nested transaction is
 * opened. Audit bodies name changed fields but never copy their PII values.
 */
export function updateProspectWithAudit(
  id: string,
  input: UpdateProspectInput,
  actorRole: string
): ProspectUpdateAuditResult | null {
  assertRequiredText("id", id, 256);
  assertRequiredText("actorRole", actorRole, 200);
  validateUpdateProspectInput(input);

  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const currentRow = db.prepare(
      "SELECT * FROM prospect_factory_prospects WHERE id = ?"
    ).get(id) as ProspectRow | undefined;
    if (!currentRow) {
      db.exec("ROLLBACK");
      return null;
    }

    const current = mapProspect(currentRow);
    if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
      throw new ProspectVersionConflictError(id, input.expectedVersion, current.version);
    }

    const assignments: string[] = [];
    const parameters: SQLInputValue[] = [];
    const changedEnrichmentLabels: string[] = [];
    const changedCommercialLabels: string[] = [];
    const changedTrackingLabels: string[] = [];

    function assignIfChanged(column: string, currentValue: SQLInputValue, nextValue: SQLInputValue) {
      if (Object.is(currentValue, nextValue)) return;
      assignments.push(`${column} = ?`);
      parameters.push(nextValue);
    }

    function assignEnrichment(
      column: string,
      label: string,
      currentValue: string | null,
      nextValue: string | null | undefined
    ) {
      if (nextValue === undefined || Object.is(currentValue, nextValue)) return;
      assignments.push(`${column} = ?`);
      parameters.push(nextValue);
      changedEnrichmentLabels.push(label);
    }

    function assignCommercial(
      column: string,
      label: string,
      currentValue: SQLInputValue,
      nextValue: SQLInputValue | undefined
    ) {
      if (nextValue === undefined || Object.is(currentValue, nextValue)) return;
      assignments.push(`${column} = ?`);
      parameters.push(nextValue);
      changedCommercialLabels.push(label);
    }

    const enrichment = input.enrichment;
    if (enrichment) {
      assignEnrichment("contact_name", "contact", current.enrichment.contactName, enrichment.contactName);
      assignEnrichment("email", "e-mail", current.enrichment.email, enrichment.email);
      assignEnrichment("phone", "téléphone", current.enrichment.phone, enrichment.phone);
      assignEnrichment("website", "site web", current.enrichment.website, enrichment.website);
      assignEnrichment("job_title", "fonction", current.enrichment.jobTitle, enrichment.jobTitle);
      assignEnrichment("linkedin", "profil LinkedIn", current.enrichment.linkedin, enrichment.linkedin);
      assignEnrichment("address", "adresse", current.enrichment.address, enrichment.address);
    }

    const qualification = input.qualification;
    const statusAfter = qualification?.status;
    const statusChanged = statusAfter !== undefined && statusAfter !== current.qualification.status;
    if (qualification) {
      if (qualification.status !== undefined) {
        assignIfChanged("qualification_status", current.qualification.status, qualification.status);
      }
      if (qualification.priority !== undefined) {
        const before = current.qualification.priority;
        assignIfChanged("priority", before, qualification.priority);
        if (!Object.is(before, qualification.priority)) changedTrackingLabels.push("priorité");
      }
      if (qualification.tags !== undefined) {
        const currentTags = JSON.stringify(current.qualification.tags);
        const nextTags = JSON.stringify(qualification.tags);
        assignIfChanged("tags_json", currentTags, nextTags);
        if (!Object.is(currentTags, nextTags)) changedTrackingLabels.push("tags");
      }
      if (qualification.notes !== undefined) {
        assignIfChanged("notes", current.qualification.notes, qualification.notes);
        if (!Object.is(current.qualification.notes, qualification.notes)) changedTrackingLabels.push("notes");
      }
      if (qualification.nextActionAt !== undefined) {
        const nextActionAt = canonicalOptionalDate(qualification.nextActionAt);
        assignIfChanged("next_action_at", current.qualification.nextActionAt, nextActionAt);
        if (!Object.is(current.qualification.nextActionAt, nextActionAt)) changedTrackingLabels.push("prochaine action");
      }
      if (qualification.nextActionLabel !== undefined) {
        assignIfChanged("next_action_label", current.qualification.nextActionLabel, qualification.nextActionLabel);
        if (!Object.is(current.qualification.nextActionLabel, qualification.nextActionLabel)) changedTrackingLabels.push("libellé prochaine action");
      }
      if (qualification.lastContactedAt !== undefined) {
        const lastContactedAt = canonicalOptionalDate(qualification.lastContactedAt);
        assignIfChanged("last_contacted_at", current.qualification.lastContactedAt, lastContactedAt);
        if (!Object.is(current.qualification.lastContactedAt, lastContactedAt)) changedTrackingLabels.push("dernier contact");
      }
      assignCommercial("owner", "responsable", current.qualification.owner, qualification.owner);
      assignCommercial("campaign", "campagne", current.qualification.campaign, qualification.campaign);
      assignCommercial("potential_value", "valeur potentielle", current.qualification.potentialValue, qualification.potentialValue);
      assignCommercial("probability", "probabilité", current.qualification.probability, qualification.probability);
      assignCommercial("expected_close_at", "date prévisionnelle", current.qualification.expectedCloseAt, canonicalOptionalDate(qualification.expectedCloseAt));
      assignCommercial("disqualification_reason", "motif d’écartement", current.qualification.disqualificationReason, qualification.disqualificationReason);
      const scoreFieldsProvided = qualification.fitScore !== undefined
        || qualification.painScore !== undefined
        || qualification.timingScore !== undefined
        || qualification.personaScore !== undefined
        || qualification.scoreTotal !== undefined
        || qualification.tier !== undefined;
      if (scoreFieldsProvided) {
        const score = deriveScoreProjection(qualification, current.qualification);
        const before = JSON.stringify({
          fitScore: current.qualification.fitScore,
          painScore: current.qualification.painScore,
          timingScore: current.qualification.timingScore,
          personaScore: current.qualification.personaScore,
          scoreTotal: current.qualification.scoreTotal,
          tier: current.qualification.tier
        });
        const after = JSON.stringify(score);
        assignIfChanged("fit_score", current.qualification.fitScore, score.fitScore);
        assignIfChanged("pain_score", current.qualification.painScore, score.painScore);
        assignIfChanged("timing_score", current.qualification.timingScore, score.timingScore);
        assignIfChanged("persona_score", current.qualification.personaScore, score.personaScore);
        assignIfChanged("qualification_score_total", current.qualification.scoreTotal, score.scoreTotal);
        assignIfChanged("qualification_tier", current.qualification.tier, score.tier);
        if (before !== after) changedTrackingLabels.push("score de qualification");
      }
      assignCommercial("qualification_confidence", "confiance de qualification", current.qualification.confidence, qualification.confidence);
      assignCommercial("qualification_score_reason", "justification du score", current.qualification.scoreReason, qualification.scoreReason);
    }

    if (!assignments.length) {
      db.exec("COMMIT");
      return { prospect: current, version: current.version, activities: [] };
    }

    const timestamp = now();
    assignments.push("updated_at = ?", "version = version + 1");
    parameters.push(timestamp);
    const updateResult = db.prepare(`
      UPDATE prospect_factory_prospects
      SET ${assignments.join(", ")}
      WHERE id = ? AND version = ?
    `).run(...parameters, id, current.version);
    if (Number(updateResult.changes) !== 1) {
      throw new ProspectVersionConflictError(id, current.version, current.version);
    }

    const activityIds: string[] = [];
    function appendAuditActivity(
      type: "enrichment" | "status_change",
      subject: string,
      body: string,
      statusBefore: ProspectQualificationStatus | null = null,
      statusAfter: ProspectQualificationStatus | null = null
    ) {
      const activity = appendProspectEvent(db, {
        prospectId: id,
        contactId: null,
        type,
        actionKind: activityActionKind(type, "internal"),
        eventType: type === "status_change" ? "status_changed" : "enrichment_updated",
        direction: "internal",
        outcome: null,
        subject,
        body,
        occurredAt: timestamp,
        statusBefore,
        statusAfter,
        actorRole,
        actorId: null,
        source: "ui",
        idempotencyKey: null,
        reportingTimezone: current.research.reportingTimezone,
        metadata: {},
        recordedAt: timestamp
      }).activity;
      activityIds.push(activity.id);
    }

    const changedDataLabels = [...changedEnrichmentLabels, ...changedCommercialLabels, ...changedTrackingLabels];
    if (changedDataLabels.length) {
      appendAuditActivity(
        "enrichment",
        "Fiche prospect mise à jour",
        `Champs mis à jour : ${changedDataLabels.join(", ")}.`
      );
    }
    if (statusChanged && statusAfter) {
      appendAuditActivity(
        "status_change",
        "Étape commerciale mise à jour",
        `Étape modifiée : ${STATUS_AUDIT_LABELS[current.qualification.status]} → ${STATUS_AUDIT_LABELS[statusAfter]}.`,
        current.qualification.status,
        statusAfter
      );
    }

    const finalRow = db.prepare(
      "SELECT * FROM prospect_factory_prospects WHERE id = ?"
    ).get(id) as ProspectRow | undefined;
    if (!finalRow) throw new Error("Prospect disappeared during its transactional update.");
    const prospect = mapProspect(finalRow);
    const activities = activityIds.map((activityId) => {
      const row = db.prepare(
        "SELECT * FROM prospect_factory_activities WHERE id = ?"
      ).get(activityId) as ProspectRow | undefined;
      if (!row) throw new Error("Prospect audit activity was not persisted.");
      return mapActivity(row);
    });
    db.exec("COMMIT");
    return { prospect, version: prospect.version, activities };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function addProspectActivity(prospectId: string, input: AddProspectActivityInput): ProspectActivityWriteResult | null {
  assertRequiredText("prospectId", prospectId, 256);
  validateActivityInput(input);
  const db = getDatabase();
  const recordedAt = now();
  const occurredAt = input.occurredAt ? canonicalDateTime(input.occurredAt) : recordedAt;
  const updatesNextActionDate = input.nextActionAt !== undefined;
  const updatesNextActionLabel = input.nextActionLabel !== undefined || input.nextActionAt !== undefined;
  const nextActionAt = canonicalOptionalDate(input.nextActionAt);
  const actionKind = activityActionKind(input.type, input.direction ?? null, input.detailType);
  const updatesLastContact = actionKind === "approach" || input.type === "call" || input.type === "email" || input.type === "meeting";
  const eventType = input.eventType ?? eventTypeFromActivity(input.type, actionKind);
  const reportingTimezone = canonicalTimezone(input.reportingTimezone);

  db.exec("BEGIN IMMEDIATE");
  try {
    const currentRow = db.prepare(
      "SELECT * FROM prospect_factory_prospects WHERE id = ?"
    ).get(prospectId) as ProspectRow | undefined;
    if (!currentRow) {
      db.exec("ROLLBACK");
      return null;
    }
    const current = mapProspect(currentRow);
    let contactId = input.contactId ?? null;
    if (actionKind === "approach" && !contactId) {
      const knownContacts = db.prepare(`
        SELECT id FROM prospect_factory_contacts WHERE prospect_id = ? ORDER BY created_at ASC, id ASC
      `).all(prospectId) as Array<{ id: string }>;
      if (knownContacts.length === 1) {
        // A single known person is unambiguous: attach the action so a later
        // contact import cannot turn one first approach into two KPI entries.
        contactId = knownContacts[0]!.id;
      } else if (knownContacts.length > 1) {
        throw new ProspectCrmInputError("contactId", "contactId is required when this account has multiple contacts.");
      }
    }
    const appended = appendProspectEvent(db, {
      prospectId,
      contactId,
      type: input.type,
      detailType: input.detailType ?? (input.type === "call" || input.type === "email" || input.type === "meeting" || input.type === "note" ? input.type : null),
      actionKind,
      eventType,
      direction: input.direction ?? null,
      outcome: input.outcome ?? null,
      subject: input.subject ?? null,
      body: input.body ?? "",
      nextActionLabel: input.nextActionLabel ?? null,
      nextActionAt,
      occurredAt,
      statusBefore: input.statusAfter === undefined ? null : current.qualification.status,
      statusAfter: input.statusAfter ?? null,
      actorRole: input.actorRole,
      actorId: input.actorId ?? null,
      source: input.source ?? "ui",
      idempotencyKey: input.idempotencyKey ?? null,
      reportingTimezone,
      metadata: input.metadata ?? {},
      recordedAt
    });
    if (appended.idempotent) {
      db.exec("COMMIT");
      const prospect = getProspect(prospectId);
      return prospect ? { activity: appended.activity, prospect } : null;
    }

    db.prepare(`
      UPDATE prospect_factory_prospects SET
        qualification_status = CASE WHEN ? = 1 THEN ? ELSE qualification_status END,
        next_action_at = CASE WHEN ? = 1 THEN ? ELSE next_action_at END,
        next_action_label = CASE WHEN ? = 1 THEN ? ELSE next_action_label END,
        last_contacted_at = CASE
          WHEN ? = 1 AND (last_contacted_at IS NULL OR last_contacted_at < ?) THEN ?
          ELSE last_contacted_at
        END,
        status_changed_at = CASE
          WHEN ? = 1 AND (status_changed_at IS NULL OR status_changed_at < ?) THEN ?
          ELSE status_changed_at
        END,
        updated_at = ?,
        version = version + 1
      WHERE id = ?
    `).run(
      input.statusAfter === undefined ? 0 : 1,
      input.statusAfter ?? null,
      updatesNextActionDate ? 1 : 0,
      nextActionAt,
      updatesNextActionLabel ? 1 : 0,
      input.nextActionLabel ?? null,
      updatesLastContact ? 1 : 0,
      occurredAt,
      occurredAt,
      input.statusAfter === undefined ? 0 : 1,
      occurredAt,
      occurredAt,
      recordedAt,
      prospectId
    );
    db.exec("COMMIT");
    const prospect = getProspect(prospectId);
    return prospect ? { activity: appended.activity, prospect } satisfies ProspectActivityWriteResult : null;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listProspectActivities(prospectId: string, limit = 100): ProspectActivity[] {
  assertRequiredText("prospectId", prospectId, 256);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new ProspectCrmInputError("limit", "limit must be an integer between 1 and 500.");
  }
  const safeLimit = limit;
  const rows = getDatabase().prepare(`
    SELECT * FROM prospect_factory_activities
    WHERE prospect_id = ?
    ORDER BY occurred_at DESC, created_at DESC, rowid DESC
    LIMIT ?
  `).all(prospectId, safeLimit) as ProspectRow[];
  return rows.map(mapActivity);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function validateSourceInput(sourceInput: ProspectSourceInput | null | undefined) {
  if (sourceInput === undefined || sourceInput === null) return;
  assertEnum("account.sourceInput.type", sourceInput.type, PROSPECT_SOURCE_INPUT_TYPES);
  assertOptionalText("account.sourceInput.reference", sourceInput.reference, 10_000);
  assertOptionalText("account.sourceInput.rowOrRecord", sourceInput.rowOrRecord, 1_000);
  assertEnum("account.sourceInput.extractionStatus", sourceInput.extractionStatus, PROSPECT_SOURCE_EXTRACTION_STATUSES);
  assertOptionalText("account.sourceInput.extractionNote", sourceInput.extractionNote, 10_000);
}

function validateImportInput(input: ProspectQualificationImportInput) {
  if (!input || typeof input !== "object" || !input.account) {
    throw new ProspectCrmInputError("input", "A qualification import row is required.");
  }
  assertRequiredText("idempotencyKey", input.idempotencyKey, 256);
  assertOptionalDate("occurredAt", input.occurredAt);
  canonicalTimezone(input.reportingTimezone);
  const account = input.account;
  assertRequiredText("account.accountKey", account.accountKey, 256);
  assertRequiredText("account.companyName", account.companyName, 10_000);
  assertOptionalText("account.commercialName", account.commercialName, 10_000);
  assertRequiredText("account.country", account.country, 1_000);
  assertRequiredText("account.territory", account.territory, 2_000);
  assertOptionalText("account.region", account.region, 2_000);
  assertOptionalText("account.city", account.city, 2_000);
  assertOptionalText("account.vertical", account.vertical, 5_000);
  assertResearchUrl("account.officialWebsite", account.officialWebsite);
  assertOptionalText("account.activityDetail", account.activityDetail, 100_000);
  assertOptionalText("account.employeeRange", account.employeeRange, 2_000);
  assertOptionalText("account.businessSummary", account.businessSummary, 100_000);
  assertOptionalText("account.offerHypothesis", account.offerHypothesis, 20_000);
  assertOptionalText("account.nextVerification", account.nextVerification, 20_000);
  assertOptionalDate("account.recommendedNextActionAt", account.recommendedNextActionAt);
  validateSourceInput(account.sourceInput);
  validateQualification(account.qualification);
  if (account.qualification?.lastContactedAt !== undefined) {
    throw new ProspectCrmInputError(
      "account.qualification.lastContactedAt",
      "A qualification import cannot set lastContactedAt; record a real approach activity instead."
    );
  }
  if (account.qualification?.status && !["to_qualify", "qualified", "to_contact", "disqualified"].includes(account.qualification.status)) {
    throw new ProspectCrmInputError(
      "account.qualification.status",
      "A qualification import cannot move a prospect to a post-contact commercial stage."
    );
  }
  if ((account.contacts?.length ?? 0) > 100) {
    throw new ProspectCrmInputError("account.contacts", "account.contacts must contain at most 100 contacts.");
  }
  if ((account.sources?.length ?? 0) > 200) {
    throw new ProspectCrmInputError("account.sources", "account.sources must contain at most 200 sources.");
  }
  if ((account.observations?.length ?? 0) > 500) {
    throw new ProspectCrmInputError("account.observations", "account.observations must contain at most 500 observations.");
  }
  for (const contact of account.contacts ?? []) {
    assertRequiredText("account.contacts[].name", contact.name, 2_000);
    assertOptionalText("account.contacts[].inputTitle", contact.inputTitle, 1_000);
    assertOptionalText("account.contacts[].verifiedTitle", contact.verifiedTitle, 1_000);
    assertEnum("account.contacts[].evidenceType", contact.evidenceType, PROSPECT_EVIDENCE_TYPES);
    assertResearchUrl("account.contacts[].sourceUrl", contact.sourceUrl);
    assertOptionalText("account.contacts[].sourceRowOrRecord", contact.sourceRowOrRecord, 1_000);
    if (contact.buyingCommitteeRole !== null) {
      assertEnum("account.contacts[].buyingCommitteeRole", contact.buyingCommitteeRole, PROSPECT_BUYING_COMMITTEE_ROLES);
    }
  }
  for (const source of account.sources ?? []) {
    assertResearchUrl("account.sources[].url", source.url, true);
    assertEnum("account.sources[].sourceType", source.sourceType, PROSPECT_RESEARCH_SOURCE_TYPES);
    assertRequiredText("account.sources[].supportedClaim", source.supportedClaim, 20_000);
    assertOptionalDate("account.sources[].publishedAt", source.publishedAt);
    assertRequiredText("account.sources[].researchedAt", source.researchedAt, 64);
    assertOptionalDate("account.sources[].researchedAt", source.researchedAt);
  }
  for (const observation of account.observations ?? []) {
    assertEnum("account.observations[].kind", observation.kind, PROSPECT_OBSERVATION_KINDS);
    assertRequiredText("account.observations[].statement", observation.statement, 30_000);
    assertEnum("account.observations[].evidenceStatus", observation.evidenceStatus, PROSPECT_OBSERVATION_STATUSES);
    assertOptionalText("account.observations[].category", observation.category, 500);
    assertResearchUrl("account.observations[].sourceUrl", observation.sourceUrl);
    assertOptionalDate("account.observations[].occurredAt", observation.occurredAt);
    assertOptionalDate("account.observations[].publishedAt", observation.publishedAt);
    assertRequiredText("account.observations[].researchedAt", observation.researchedAt, 64);
    assertOptionalDate("account.observations[].researchedAt", observation.researchedAt);
    if (observation.evidenceStatus === "observed" && !observation.sourceUrl) {
      throw new ProspectCrmInputError("account.observations[].sourceUrl", "Observed evidence must cite a source URL.");
    }
  }
}

function importWarehouseId(accountKey: string) {
  return `qualification:${fingerprint(accountKey).slice(0, 48)}`;
}

function upsertImportContacts(db: DatabaseSync, prospectId: string, contacts: ProspectQualificationImportInput["account"]["contacts"], timestamp: string) {
  for (const contact of contacts ?? []) {
    const contactFingerprint = fingerprint(contact.name.trim().toLowerCase(), contact.inputTitle, contact.verifiedTitle, contact.sourceRowOrRecord);
    db.prepare(`
      INSERT INTO prospect_factory_contacts (
        id, prospect_id, fingerprint, name, input_title, verified_title, evidence_type, source_url,
        source_row_or_record, buying_committee_role, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(prospect_id, fingerprint) DO UPDATE SET
        name = excluded.name,
        input_title = excluded.input_title,
        verified_title = excluded.verified_title,
        evidence_type = excluded.evidence_type,
        source_url = excluded.source_url,
        source_row_or_record = excluded.source_row_or_record,
        buying_committee_role = excluded.buying_committee_role,
        updated_at = excluded.updated_at
    `).run(
      randomUUID(),
      prospectId,
      contactFingerprint,
      contact.name.trim(),
      contact.inputTitle ?? null,
      contact.verifiedTitle ?? null,
      contact.evidenceType,
      contact.sourceUrl ?? null,
      contact.sourceRowOrRecord ?? null,
      contact.buyingCommitteeRole ?? null,
      timestamp,
      timestamp
    );
  }
}

function upsertImportSources(db: DatabaseSync, prospectId: string, sources: ProspectQualificationImportInput["account"]["sources"], timestamp: string) {
  for (const source of sources ?? []) {
    const sourceFingerprint = fingerprint(source.url, source.sourceType, source.supportedClaim, source.publishedAt);
    db.prepare(`
      INSERT INTO prospect_factory_research_sources (
        id, prospect_id, fingerprint, source_url, source_type, supported_claim, published_at, researched_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(prospect_id, fingerprint) DO UPDATE SET
        source_url = excluded.source_url,
        source_type = excluded.source_type,
        supported_claim = excluded.supported_claim,
        published_at = excluded.published_at,
        researched_at = excluded.researched_at,
        updated_at = excluded.updated_at
    `).run(
      randomUUID(), prospectId, sourceFingerprint, source.url, source.sourceType, source.supportedClaim,
      canonicalOptionalDate(source.publishedAt), canonicalDateTime(source.researchedAt), timestamp, timestamp
    );
  }
}

function upsertImportObservations(db: DatabaseSync, prospectId: string, observations: ProspectQualificationImportInput["account"]["observations"], timestamp: string) {
  for (const observation of observations ?? []) {
    const observationFingerprint = fingerprint(
      observation.kind,
      observation.statement,
      observation.evidenceStatus,
      observation.category,
      observation.sourceUrl,
      observation.occurredAt,
      observation.publishedAt
    );
    db.prepare(`
      INSERT INTO prospect_factory_observations (
        id, prospect_id, fingerprint, observation_kind, statement, evidence_status, category, source_url,
        occurred_at, published_at, researched_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(prospect_id, fingerprint) DO UPDATE SET
        observation_kind = excluded.observation_kind,
        statement = excluded.statement,
        evidence_status = excluded.evidence_status,
        category = excluded.category,
        source_url = excluded.source_url,
        occurred_at = excluded.occurred_at,
        published_at = excluded.published_at,
        researched_at = excluded.researched_at,
        updated_at = excluded.updated_at
    `).run(
      randomUUID(), prospectId, observationFingerprint, observation.kind, observation.statement,
      observation.evidenceStatus, observation.category ?? null, observation.sourceUrl ?? null,
      canonicalOptionalDate(observation.occurredAt), canonicalOptionalDate(observation.publishedAt),
      canonicalDateTime(observation.researchedAt), timestamp, timestamp
    );
  }
}

/**
 * Atomically saves one account qualification from a research skill. It is safe
 * to retry with the same idempotency key, never manufactures an approach, and
 * keeps research evidence in normalized relation tables.
 */
function importProspectQualificationInTransaction(
  db: DatabaseSync,
  input: ProspectQualificationImportInput,
  actorRole: string,
  actorId: string | null = null
): ProspectQualificationImportResult {
  validateImportInput(input);
  assertRequiredText("actorRole", actorRole, 200);
  assertOptionalText("actorId", actorId, 256);
  const payloadFingerprint = fingerprint(stableJson(input));
  const timestamp = now();
  const occurredAt = input.occurredAt ? canonicalDateTime(input.occurredAt) : timestamp;
  const reportingTimezone = canonicalTimezone(input.reportingTimezone);
  const account = input.account;

  const prior = db.prepare(`
      SELECT prospect_id, payload_fingerprint FROM prospect_factory_qualification_imports WHERE idempotency_key = ?
    `).get(input.idempotencyKey) as { prospect_id: string; payload_fingerprint: string } | undefined;
    if (prior) {
      if (prior.payload_fingerprint !== payloadFingerprint) {
        throw new ProspectCrmIdempotencyConflictError(input.idempotencyKey);
      }
      const existing = getProspect(prior.prospect_id);
      if (!existing) throw new Error("The idempotent import no longer has a prospect.");
      return { prospect: existing, created: false, idempotent: true, events: [] };
    }

    const matchingRow = db.prepare(
      "SELECT * FROM prospect_factory_prospects WHERE account_key = ? COLLATE NOCASE"
    ).get(account.accountKey.trim()) as ProspectRow | undefined;
    const created = !matchingRow;
    const warehouseId = matchingRow ? String(matchingRow.warehouse_id) : importWarehouseId(account.accountKey.trim());
    const before = matchingRow ? mapProspect(matchingRow) : null;
    const score = deriveScoreProjection(account.qualification, before?.qualification);
    const qualification = account.qualification ?? {};

    // Refresh source facts through the existing compatibility layer. This keeps
    // manual CRM enrichment (email, owner, notes, etc.) untouched.
    const refreshed = addProspect({
      warehouseId,
      snapshot: {
        dedupeKey: `qualification:${account.accountKey.trim()}`,
        companyName: account.companyName.trim(),
        commercialName: account.commercialName ?? null,
        country: account.country.trim(),
        territory: account.territory.trim(),
        region: account.region ?? null,
        city: account.city ?? null,
        vertical: account.vertical ?? null,
        recordOrigin: "qualification_import",
        sourceUrls: account.officialWebsite ?? "",
        leadScore: score.scoreTotal ?? 0,
        certification: "bronze",
        website: account.officialWebsite ?? null,
        activityDetail: account.activityDetail ?? null,
        employeeRange: account.employeeRange ?? null
      },
      enrichment: created && account.officialWebsite ? { website: account.officialWebsite } : undefined,
      qualification: created ? {
        status: qualification.status ?? "to_qualify",
        priority: qualification.priority ?? "normal",
        tags: qualification.tags ?? [],
        notes: qualification.notes ?? "",
        nextActionAt: qualification.nextActionAt ?? null,
        owner: qualification.owner ?? null,
        campaign: qualification.campaign ?? null,
        potentialValue: qualification.potentialValue ?? null,
        probability: qualification.probability ?? null,
        expectedCloseAt: qualification.expectedCloseAt ?? null,
        disqualificationReason: qualification.disqualificationReason ?? null,
        fitScore: score.fitScore,
        painScore: score.painScore,
        timingScore: score.timingScore,
        personaScore: score.personaScore,
        scoreTotal: score.scoreTotal,
        tier: score.tier,
        confidence: qualification.confidence ?? null,
        scoreReason: qualification.scoreReason ?? null
      } : undefined
    });

    if (!created && account.qualification) {
      updateProspect(refreshed.id, {
        qualification: {
          ...account.qualification,
          fitScore: score.fitScore,
          painScore: score.painScore,
          timingScore: score.timingScore,
          personaScore: score.personaScore,
          scoreTotal: score.scoreTotal,
          tier: score.tier
        }
      });
    }
    const current = getProspect(refreshed.id);
    if (!current) throw new Error("Prospect disappeared during qualification import.");
    const sourceInput = account.sourceInput ?? null;
    db.prepare(`
      UPDATE prospect_factory_prospects SET
        account_key = ?, business_summary = ?, offer_hypothesis = ?, next_verification = ?, recommended_next_action_at = ?,
        source_input_type = ?, source_input_reference = ?, source_input_row_or_record = ?, source_input_status = ?, source_input_note = ?,
        reporting_timezone = ?, updated_at = ?, version = version + 1
      WHERE id = ?
    `).run(
      account.accountKey.trim(), account.businessSummary ?? null, account.offerHypothesis ?? null, account.nextVerification ?? null,
      canonicalOptionalDate(account.recommendedNextActionAt), sourceInput?.type ?? null, sourceInput?.reference ?? null,
      sourceInput?.rowOrRecord ?? null, sourceInput?.extractionStatus ?? null, sourceInput?.extractionNote ?? null,
      reportingTimezone, timestamp, current.id
    );
    upsertImportContacts(db, current.id, account.contacts, timestamp);
    upsertImportSources(db, current.id, account.sources, timestamp);
    upsertImportObservations(db, current.id, account.observations, timestamp);

    const events: ProspectActivity[] = [];
    const appendImportEvent = (eventType: ProspectEventType, suffix: string, subject: string, body: string) => {
      const result = appendProspectEvent(db, {
        prospectId: current.id,
        contactId: null,
        type: "enrichment",
        actionKind: "enrichment",
        eventType,
        direction: "internal",
        outcome: null,
        subject,
        body,
        occurredAt,
        statusBefore: null,
        statusAfter: null,
        actorRole,
        actorId,
        source: "import",
        idempotencyKey: `qi:${fingerprint(input.idempotencyKey, suffix).slice(0, 48)}`,
        reportingTimezone,
        metadata: { accountKey: account.accountKey.trim(), sourceInputType: sourceInput?.type ?? null },
        recordedAt: timestamp
      });
      if (!result.idempotent) events.push(result.activity);
    };
    appendImportEvent("imported", "imported", "Qualification importée", "Résultat de recherche intégré sans action commerciale.");
    appendImportEvent("research_completed", "research", "Recherche terminée", "Recherche sourcée enregistrée dans la fiche prospect.");
    if (score.scoreTotal !== null || qualification.status === "qualified") {
      appendImportEvent("qualified", "qualified", "Qualification enregistrée", "Score et niveau de qualification enregistrés.");
    }
    if (before && qualification.status && qualification.status !== before.qualification.status) {
      const statusEvent = appendProspectEvent(db, {
        prospectId: current.id,
        contactId: null,
        type: "status_change",
        actionKind: "status_change",
        eventType: "status_changed",
        direction: "internal",
        outcome: null,
        subject: "Étape commerciale mise à jour par import",
        body: "Étape commerciale mise à jour pendant l’import de qualification.",
        occurredAt,
        statusBefore: before.qualification.status,
        statusAfter: qualification.status,
        actorRole,
        actorId,
        source: "import",
        idempotencyKey: `qi:${fingerprint(input.idempotencyKey, "status").slice(0, 48)}`,
        reportingTimezone,
        metadata: { accountKey: account.accountKey.trim() },
        recordedAt: timestamp
      });
      if (!statusEvent.idempotent) events.push(statusEvent.activity);
    }
    db.prepare(`
      INSERT INTO prospect_factory_qualification_imports (id, idempotency_key, payload_fingerprint, prospect_id, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(randomUUID(), input.idempotencyKey, payloadFingerprint, current.id, timestamp);
    const result = getProspect(current.id);
    if (!result) throw new Error("Qualification import did not produce a prospect.");
    return { prospect: result, created, idempotent: false, events };
}

/** Saves one source-backed account in an isolated transaction. */
export function importProspectQualification(
  input: ProspectQualificationImportInput,
  actorRole: string,
  actorId: string | null = null
): ProspectQualificationImportResult {
  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = importProspectQualificationInTransaction(db, input, actorRole, actorId);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Saves a bounded batch atomically: schema/persistence validation happens for
 * every row before the write lock, then either every account is committed or
 * none is. Each result retains row-level created/idempotent information.
 */
export function importProspectQualificationBatch(
  inputs: readonly ProspectQualificationImportInput[],
  actorRole: string,
  actorId: string | null = null
) {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 50) {
    throw new ProspectCrmInputError("items", "A batch must contain between 1 and 50 accounts.");
  }
  assertRequiredText("actorRole", actorRole, 200);
  assertOptionalText("actorId", actorId, 256);
  inputs.forEach(validateImportInput);
  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const results = inputs.map((input) => importProspectQualificationInTransaction(db, input, actorRole, actorId));
    db.exec("COMMIT");
    return results;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function localCalendarDate(iso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function safeEventTimezone(value: unknown, fallback: string) {
  try {
    return canonicalTimezone(nullableString(value) ?? fallback);
  } catch {
    return fallback;
  }
}

/**
 * Returns append-only activity metrics for an explicit UTC window. New-contact
 * and new-account metrics are based on the *historical first* `approach` event,
 * not a status transition or a later follow-up. The caller supplies a local
 * ISO-week window (Europe/Paris by default in the route) and daily buckets use
 * the reporting timezone copied to each event.
 */
export function getProspectActivityStats(
  from: string,
  to: string,
  reportingTimezone = DEFAULT_REPORTING_TIMEZONE
): ProspectActivityStats {
  assertOptionalDate("from", from);
  assertOptionalDate("to", to);
  if (Date.parse(to) <= Date.parse(from)) {
    throw new ProspectCrmInputError("to", "to must be later than from.");
  }
  const maximumWindowMs = 366 * 24 * 60 * 60 * 1000;
  if (Date.parse(to) - Date.parse(from) > maximumWindowMs) {
    throw new ProspectCrmInputError("to", "The reporting window cannot exceed 366 days.");
  }
  const normalizedFrom = canonicalDateTime(from);
  const normalizedTo = canonicalDateTime(to);
  const normalizedTimezone = canonicalTimezone(reportingTimezone);

  const db = getDatabase();
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total_activities,
      SUM(CASE WHEN activity_type = 'status_change' OR action_kind = 'status_change' THEN 1 ELSE 0 END) AS status_changes,
      SUM(CASE WHEN activity_type = 'enrichment' OR action_kind = 'enrichment' THEN 1 ELSE 0 END) AS enrichment_updates
    FROM prospect_factory_activities
    WHERE occurred_at >= ? AND occurred_at < ?
  `).get(normalizedFrom, normalizedTo) as {
    total_activities: number;
    status_changes: number | null;
    enrichment_updates: number | null;
  };

  const activityRows = db.prepare(`
    SELECT id, prospect_id, contact_id, activity_type, action_kind, occurred_at, reporting_timezone
    FROM prospect_factory_activities
    WHERE occurred_at >= ? AND occurred_at < ?
    ORDER BY occurred_at ASC, recorded_at ASC, id ASC
  `).all(normalizedFrom, normalizedTo) as Array<{
    id: string;
    prospect_id: string;
    contact_id: string | null;
    activity_type: ProspectActivityType;
    action_kind: ProspectActivityActionKind;
    occurred_at: string;
    reporting_timezone: string | null;
  }>;
  const firstContactRows = db.prepare(`
    SELECT prospect_id, contact_id, MIN(occurred_at) AS occurred_at, MIN(reporting_timezone) AS reporting_timezone
    FROM prospect_factory_activities
    WHERE action_kind = 'approach'
    GROUP BY prospect_id, COALESCE(contact_id, 'legacy:' || prospect_id)
    HAVING MIN(occurred_at) >= ? AND MIN(occurred_at) < ?
  `).all(normalizedFrom, normalizedTo) as Array<{
    prospect_id: string;
    contact_id: string | null;
    occurred_at: string;
    reporting_timezone: string | null;
  }>;
  const firstAccountRows = db.prepare(`
    SELECT prospect_id, MIN(occurred_at) AS occurred_at, MIN(reporting_timezone) AS reporting_timezone
    FROM prospect_factory_activities
    WHERE action_kind = 'approach'
    GROUP BY prospect_id
    HAVING MIN(occurred_at) >= ? AND MIN(occurred_at) < ?
  `).all(normalizedFrom, normalizedTo) as Array<{
    prospect_id: string;
    occurred_at: string;
    reporting_timezone: string | null;
  }>;
  const firstContactInstants = db.prepare(`
    SELECT prospect_id, contact_id, MIN(occurred_at) AS occurred_at
    FROM prospect_factory_activities
    WHERE action_kind = 'approach'
    GROUP BY prospect_id, COALESCE(contact_id, 'legacy:' || prospect_id)
  `).all() as Array<{ prospect_id: string; contact_id: string | null; occurred_at: string }>;
  const contactFirstAt = new Map(firstContactInstants.map((row) => [
    `${row.prospect_id}:${row.contact_id ?? `legacy:${row.prospect_id}`}`,
    row.occurred_at
  ]));

  type DailyBucket = ProspectActivityStats["byDay"][number];
  const daily = new Map<string, DailyBucket>();
  const bucketFor = (date: string): DailyBucket => {
    let bucket = daily.get(date);
    if (!bucket) {
      bucket = {
        date,
        activities: 0,
        approachEvents: 0,
        followUpApproachEvents: 0,
        newContactsApproached: 0,
        newAccountsApproached: 0,
        approachedProspects: 0
      };
      daily.set(date, bucket);
    }
    return bucket;
  };
  let approachEvents = 0;
  let followUpApproachEvents = 0;
  for (const row of activityRows) {
    const date = localCalendarDate(row.occurred_at, safeEventTimezone(row.reporting_timezone, normalizedTimezone));
    const bucket = bucketFor(date);
    bucket.activities += 1;
    if (row.action_kind === "approach") {
      approachEvents += 1;
      bucket.approachEvents += 1;
      const key = `${row.prospect_id}:${row.contact_id ?? `legacy:${row.prospect_id}`}`;
      if (contactFirstAt.get(key) !== row.occurred_at) {
        followUpApproachEvents += 1;
        bucket.followUpApproachEvents += 1;
      }
    }
  }
  for (const row of firstContactRows) {
    const date = localCalendarDate(row.occurred_at, safeEventTimezone(row.reporting_timezone, normalizedTimezone));
    bucketFor(date).newContactsApproached += 1;
  }
  for (const row of firstAccountRows) {
    const date = localCalendarDate(row.occurred_at, safeEventTimezone(row.reporting_timezone, normalizedTimezone));
    const bucket = bucketFor(date);
    bucket.newAccountsApproached += 1;
    bucket.approachedProspects += 1;
  }

  const byType = Object.fromEntries(PROSPECT_ACTIVITY_TYPES.map((type) => [type, 0])) as Record<ProspectActivityType, number>;
  const typeRows = db.prepare(`
    SELECT activity_type, COUNT(*) AS total
    FROM prospect_factory_activities
    WHERE occurred_at >= ? AND occurred_at < ?
    GROUP BY activity_type
  `).all(normalizedFrom, normalizedTo) as Array<{ activity_type: ProspectActivityType; total: number }>;
  for (const row of typeRows) byType[row.activity_type] = Number(row.total);

  return {
    from: normalizedFrom,
    to: normalizedTo,
    reportingTimezone: normalizedTimezone,
    totalActivities: Number(totals.total_activities ?? 0),
    approachEvents,
    followUpApproachEvents,
    newContactsApproached: firstContactRows.length,
    newAccountsApproached: firstAccountRows.length,
    approachedProspects: firstAccountRows.length,
    statusChanges: Number(totals.status_changes ?? 0),
    enrichmentUpdates: Number(totals.enrichment_updates ?? 0),
    byDay: [...daily.values()].sort((left, right) => left.date.localeCompare(right.date)),
    byType
  };
}

/** Returns only lightweight CRM state, in bounded chunks, for Explorer row decoration. */
export function getTrackingByWarehouseIds(warehouseIds: readonly string[]): Record<string, ProspectTrackingSummary> {
  if (!Array.isArray(warehouseIds) || warehouseIds.length > 5_000) {
    throw new ProspectCrmInputError("warehouseIds", "warehouseIds must contain at most 5,000 identifiers.");
  }
  warehouseIds.forEach((warehouseId) => assertRequiredText("warehouseIds[]", warehouseId, 256));
  const result = Object.create(null) as Record<string, ProspectTrackingSummary>;
  const uniqueKeys = [...new Set(warehouseIds.filter(Boolean))];
  const chunkSize = 500;

  for (let index = 0; index < uniqueKeys.length; index += chunkSize) {
    const chunk = uniqueKeys.slice(index, index + chunkSize);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = getDatabase().prepare(`
      SELECT id, warehouse_id, version, qualification_status, priority, next_action_at, last_contacted_at, updated_at
      FROM prospect_factory_prospects
      WHERE warehouse_id IN (${placeholders})
    `).all(...chunk) as ProspectRow[];

    for (const row of rows) {
      const warehouseId = String(row.warehouse_id);
      result[warehouseId] = {
        id: String(row.id),
        warehouseId,
        version: Number(row.version),
        status: String(row.qualification_status) as ProspectQualificationStatus,
        priority: String(row.priority) as ProspectPriority,
        nextActionAt: nullableString(row.next_action_at),
        lastContactedAt: nullableString(row.last_contacted_at),
        updatedAt: String(row.updated_at)
      };
    }
  }

  return result;
}

export function getPipelineCounts(referenceTime = now()): ProspectPipelineCounts {
  assertOptionalDate("referenceTime", referenceTime);
  const db = getDatabase();
  const byStatus = Object.fromEntries(
    PROSPECT_QUALIFICATION_STATUSES.map((status) => [status, 0])
  ) as Record<ProspectQualificationStatus, number>;
  const byPriority = Object.fromEntries(
    PROSPECT_PRIORITIES.map((priority) => [priority, 0])
  ) as Record<ProspectPriority, number>;
  const byTier: ProspectPipelineCounts["byTier"] = { A: 0, B: 0, C: 0, unscored: 0 };

  const statusRows = db.prepare(`
    SELECT qualification_status, COUNT(*) AS total
    FROM prospect_factory_prospects
    GROUP BY qualification_status
  `).all() as Array<{ qualification_status: ProspectQualificationStatus; total: number }>;
  for (const row of statusRows) byStatus[row.qualification_status] = Number(row.total);

  const priorityRows = db.prepare(`
    SELECT priority, COUNT(*) AS total
    FROM prospect_factory_prospects
    GROUP BY priority
  `).all() as Array<{ priority: ProspectPriority; total: number }>;
  for (const row of priorityRows) byPriority[row.priority] = Number(row.total);

  const tierRows = db.prepare(`
    SELECT COALESCE(qualification_tier, 'unscored') AS tier, COUNT(*) AS total
    FROM prospect_factory_prospects
    GROUP BY COALESCE(qualification_tier, 'unscored')
  `).all() as Array<{ tier: string; total: number }>;
  for (const row of tierRows) {
    if (row.tier === "A" || row.tier === "B" || row.tier === "C" || row.tier === "unscored") {
      byTier[row.tier] = Number(row.total);
    }
  }

  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN qualification_status NOT IN ('won', 'lost', 'disqualified') THEN COALESCE(potential_value, 0) ELSE 0 END), 0) AS pipeline_value,
      COALESCE(SUM(CASE WHEN qualification_status NOT IN ('won', 'lost', 'disqualified') THEN COALESCE(potential_value, 0) * COALESCE(probability, 0) / 100 ELSE 0 END), 0) AS weighted_pipeline_value,
      COALESCE(SUM(CASE WHEN qualification_status = 'won' THEN COALESCE(potential_value, 0) ELSE 0 END), 0) AS won_value,
      SUM(CASE
        WHEN next_action_at IS NOT NULL
          AND next_action_at < ?
          AND qualification_status NOT IN ('won', 'lost', 'disqualified')
        THEN 1 ELSE 0 END) AS overdue_next_actions,
      SUM(CASE
        WHEN next_action_at IS NULL
          AND qualification_status NOT IN ('won', 'lost', 'disqualified')
        THEN 1 ELSE 0 END) AS without_next_action
    FROM prospect_factory_prospects
  `).get(referenceTime) as {
    total: number;
    pipeline_value: number | null;
    weighted_pipeline_value: number | null;
    won_value: number | null;
    overdue_next_actions: number | null;
    without_next_action: number | null;
  };

  return {
    total: Number(totals.total),
    byStatus,
    byPriority,
    byTier,
    overdueNextActions: Number(totals.overdue_next_actions ?? 0),
    withoutNextAction: Number(totals.without_next_action ?? 0),
    pipelineValue: Number(totals.pipeline_value ?? 0),
    weightedPipelineValue: Number(totals.weighted_pipeline_value ?? 0),
    wonValue: Number(totals.won_value ?? 0)
  };
}

function assertMarketSlug(field: string, value: string) {
  assertRequiredText(field, value, 120);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new ProspectCrmInputError(field, `${field} must be a lowercase URL slug.`);
  }
}

function assertMarketTextList(field: string, value: readonly string[], maximum = 100) {
  if (!Array.isArray(value) || value.length > maximum) throw new ProspectCrmInputError(field, `${field} must contain at most ${maximum} entries.`);
  value.forEach((item) => assertRequiredText(`${field}[]`, item, 2_000));
}

function assertSignalWeights(value: Partial<Record<ProspectOperationalSignal, number>>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProspectCrmInputError("signalWeights", "signalWeights must be an object.");
  for (const [signal, weight] of Object.entries(value)) {
    if (!(PROSPECT_OPERATIONAL_SIGNALS as readonly string[]).includes(signal) || !Number.isInteger(weight) || weight < 0 || weight > 100) {
      throw new ProspectCrmInputError("signalWeights", "Each signal weight must be an integer from 0 to 100 for a known signal.");
    }
  }
}

function assertOperationalSignals(value: readonly ProspectOperationalSignal[]) {
  if (!Array.isArray(value) || value.length > PROSPECT_OPERATIONAL_SIGNALS.length) throw new ProspectCrmInputError("operationalSignals", "Invalid operational signals.");
  value.forEach((signal) => assertEnum("operationalSignals[]", signal, PROSPECT_OPERATIONAL_SIGNALS));
  if (new Set(value).size !== value.length) throw new ProspectCrmInputError("operationalSignals", "Operational signals must be unique.");
}

function mapIcp(row: ProspectRow): MarketIcp {
  const weights = parseJsonObject(row.signal_weights_json);
  return {
    id: String(row.id), slug: String(row.slug), name: String(row.name), description: String(row.description),
    qualificationCriteria: parseTags(row.qualification_criteria_json), exclusions: parseTags(row.exclusions_json),
    employeeMin: nullableNumber(row.employee_min), employeeMax: nullableNumber(row.employee_max),
    territories: parseTags(row.territories_json),
    signalWeights: Object.fromEntries(Object.entries(weights).filter(([signal, weight]) =>
      (PROSPECT_OPERATIONAL_SIGNALS as readonly string[]).includes(signal) && Number.isInteger(weight) && Number(weight) >= 0)) as MarketIcp["signalWeights"],
    createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

function mapSegment(row: ProspectRow): MarketSegment {
  return {
    id: String(row.id), icpId: String(row.icp_id), slug: String(row.slug), name: String(row.name),
    description: String(row.description), criteria: parseTags(row.criteria_json),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

function mapIcpPersona(row: ProspectRow): IcpPersona {
  return {
    id: String(row.id), icpId: String(row.icp_id), key: String(row.persona_key),
    label: String(row.label), description: String(row.description), sortOrder: Number(row.sort_order),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

function mapAccountPersona(row: ProspectRow): AccountPersonaSlot {
  return {
    id: String(row.id), prospectId: String(row.prospect_id), key: String(row.persona_key),
    label: String(row.label), contactId: nullableString(row.contact_id),
    status: String(row.status) as AccountPersonaSlot["status"], notes: String(row.notes),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

export function listIcps(): MarketIcp[] {
  return (getDatabase().prepare("SELECT * FROM prospect_factory_icps ORDER BY name COLLATE NOCASE, id").all() as ProspectRow[]).map(mapIcp);
}

export function getIcp(id: string): MarketIcp | null {
  const row = getDatabase().prepare("SELECT * FROM prospect_factory_icps WHERE id = ?").get(id) as ProspectRow | undefined;
  return row ? mapIcp(row) : null;
}

export function listIcpSegments(icpId?: string): MarketSegment[] {
  const db = getDatabase();
  const rows = (icpId
    ? db.prepare("SELECT * FROM prospect_factory_icp_segments WHERE icp_id = ? ORDER BY name COLLATE NOCASE, id").all(icpId)
    : db.prepare("SELECT * FROM prospect_factory_icp_segments ORDER BY name COLLATE NOCASE, id").all()) as ProspectRow[];
  return rows.map(mapSegment);
}

export function getIcpSegment(id: string): MarketSegment | null {
  const row = getDatabase().prepare("SELECT * FROM prospect_factory_icp_segments WHERE id = ?").get(id) as ProspectRow | undefined;
  return row ? mapSegment(row) : null;
}

function validateIcpInput(input: IcpWriteInput) {
  assertMarketSlug("slug", input.slug);
  assertRequiredText("name", input.name, 240);
  if (input.description !== undefined) assertText("description", input.description, 20_000);
  if (input.qualificationCriteria !== undefined) assertMarketTextList("qualificationCriteria", input.qualificationCriteria);
  if (input.exclusions !== undefined) assertMarketTextList("exclusions", input.exclusions);
  if (input.territories !== undefined) assertMarketTextList("territories", input.territories);
  if (input.employeeMin !== undefined) assertOptionalInteger("employeeMin", input.employeeMin, 0, 1_000_000);
  if (input.employeeMax !== undefined) assertOptionalInteger("employeeMax", input.employeeMax, 0, 1_000_000);
  if (input.employeeMin != null && input.employeeMax != null && input.employeeMin > input.employeeMax) throw new ProspectCrmInputError("employeeMax", "employeeMax must be at least employeeMin.");
  if (input.signalWeights !== undefined) assertSignalWeights(input.signalWeights);
}

export function createIcp(input: IcpWriteInput): MarketIcp {
  validateIcpInput(input);
  const db = getDatabase();
  if (db.prepare("SELECT 1 FROM prospect_factory_icps WHERE slug = ? COLLATE NOCASE").get(input.slug)) throw new ProspectCrmInputError("slug", "An ICP with this slug already exists.");
  const id = randomUUID();
  const timestamp = now();
  db.prepare(`
    INSERT INTO prospect_factory_icps
      (id, slug, name, description, qualification_criteria_json, exclusions_json, employee_min, employee_max,
       territories_json, signal_weights_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.slug, input.name.trim(), input.description ?? "", JSON.stringify(input.qualificationCriteria ?? []),
    JSON.stringify(input.exclusions ?? []), input.employeeMin ?? null, input.employeeMax ?? null,
    JSON.stringify(input.territories ?? []), JSON.stringify(input.signalWeights ?? {}), timestamp, timestamp);
  return getIcp(id)!;
}

export function updateIcp(id: string, patch: Partial<IcpWriteInput>): MarketIcp | null {
  const current = getIcp(id);
  if (!current) return null;
  const next: IcpWriteInput = { ...current, ...patch };
  validateIcpInput(next);
  const db = getDatabase();
  if (db.prepare("SELECT 1 FROM prospect_factory_icps WHERE slug = ? COLLATE NOCASE AND id <> ?").get(next.slug, id)) throw new ProspectCrmInputError("slug", "An ICP with this slug already exists.");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE prospect_factory_icps SET slug=?, name=?, description=?, qualification_criteria_json=?, exclusions_json=?,
        employee_min=?, employee_max=?, territories_json=?, signal_weights_json=?, updated_at=? WHERE id=?
    `).run(next.slug, next.name.trim(), next.description ?? "", JSON.stringify(next.qualificationCriteria ?? []),
      JSON.stringify(next.exclusions ?? []), next.employeeMin ?? null, next.employeeMax ?? null,
      JSON.stringify(next.territories ?? []), JSON.stringify(next.signalWeights ?? {}), now(), id);
    if (next.employeeMin !== current.employeeMin || next.employeeMax !== current.employeeMax
      || JSON.stringify(next.signalWeights) !== JSON.stringify(current.signalWeights)) {
      const updatedIcp = getIcp(id)!;
      const accounts = db.prepare(`
        SELECT p.* FROM prospect_factory_prospects p
        JOIN prospect_factory_icp_segments s ON s.id=p.segment_id WHERE s.icp_id=?
      `).all(id) as ProspectRow[];
      for (const row of accounts) {
        const account = mapProspect(row);
        const fit = deriveIcpFit(account.market, updatedIcp);
        if (fit.score === account.market.icpFitScore && fit.reason === account.market.icpFitReason) continue;
        db.prepare("UPDATE prospect_factory_prospects SET icp_fit_score=?, icp_fit_reason=?, updated_at=?, version=version+1 WHERE id=?")
          .run(fit.score, fit.reason, now(), account.id);
      }
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return getIcp(id);
}

export function deleteIcp(id: string): boolean {
  const db = getDatabase();
  if (!getIcp(id)) return false;
  if (db.prepare("SELECT 1 FROM prospect_factory_icp_segments WHERE icp_id = ? LIMIT 1").get(id)) throw new ProspectCrmInputError("id", "Remove the ICP segments before deleting this ICP.");
  return Number(db.prepare("DELETE FROM prospect_factory_icps WHERE id = ?").run(id).changes) > 0;
}

function validateSegmentInput(input: SegmentWriteInput) {
  assertRequiredText("icpId", input.icpId, 256);
  assertMarketSlug("slug", input.slug);
  assertRequiredText("name", input.name, 240);
  if (input.description !== undefined) assertText("description", input.description, 20_000);
  if (input.criteria !== undefined) assertMarketTextList("criteria", input.criteria);
}

export function createIcpSegment(input: SegmentWriteInput): MarketSegment {
  validateSegmentInput(input);
  const db = getDatabase();
  if (!getIcp(input.icpId)) throw new ProspectCrmInputError("icpId", "ICP not found.");
  if (db.prepare("SELECT 1 FROM prospect_factory_icp_segments WHERE icp_id = ? AND slug = ? COLLATE NOCASE").get(input.icpId, input.slug)) throw new ProspectCrmInputError("slug", "A segment with this slug already exists in the ICP.");
  const id = randomUUID();
  const timestamp = now();
  db.prepare(`
    INSERT INTO prospect_factory_icp_segments (id, icp_id, slug, name, description, criteria_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.icpId, input.slug, input.name.trim(), input.description ?? "", JSON.stringify(input.criteria ?? []), timestamp, timestamp);
  return getIcpSegment(id)!;
}

export function updateIcpSegment(id: string, patch: Partial<SegmentWriteInput>): MarketSegment | null {
  const current = getIcpSegment(id);
  if (!current) return null;
  const next: SegmentWriteInput = { ...current, ...patch };
  validateSegmentInput(next);
  const db = getDatabase();
  if (!getIcp(next.icpId)) throw new ProspectCrmInputError("icpId", "ICP not found.");
  if (next.icpId !== current.icpId && db.prepare("SELECT 1 FROM prospect_factory_prospects WHERE segment_id = ? LIMIT 1").get(id)) throw new ProspectCrmInputError("icpId", "Move or unclassify the segment accounts before changing its ICP.");
  if (db.prepare("SELECT 1 FROM prospect_factory_icp_segments WHERE icp_id=? AND slug=? COLLATE NOCASE AND id<>?").get(next.icpId, next.slug, id)) throw new ProspectCrmInputError("slug", "A segment with this slug already exists in the ICP.");
  db.prepare("UPDATE prospect_factory_icp_segments SET icp_id=?, slug=?, name=?, description=?, criteria_json=?, updated_at=? WHERE id=?")
    .run(next.icpId, next.slug, next.name.trim(), next.description ?? "", JSON.stringify(next.criteria ?? []), now(), id);
  return getIcpSegment(id);
}

export function deleteIcpSegment(id: string): boolean {
  const db = getDatabase();
  if (!getIcpSegment(id)) return false;
  if (db.prepare("SELECT 1 FROM prospect_factory_prospects WHERE segment_id=? LIMIT 1").get(id)) throw new ProspectCrmInputError("id", "Move or unclassify the segment accounts before deleting it.");
  return Number(db.prepare("DELETE FROM prospect_factory_icp_segments WHERE id=?").run(id).changes) > 0;
}

function emptyMarketMetrics(): MarketMetrics {
  return {
    accountCount: 0, contactCount: 0, contactedCount: 0, conversationCount: 0,
    responseCount: 0, meetingCount: 0, opportunityCount: 0, clientCount: 0,
    potentialValue: 0, signedValue: 0, responseRate: null, averageWonValue: null
  };
}

function addMarketMetric(target: MarketMetrics, row: ProspectRow) {
  const status = String(row.qualification_status);
  const potential = Number(row.potential_value ?? 0);
  const contacted = Number(row.contacted) > 0;
  const responded = Number(row.responded) > 0;
  target.accountCount += 1;
  target.contactCount += Number(row.contact_count ?? 0) + Number(row.legacy_contact_count ?? 0);
  if (contacted) target.contactedCount += 1;
  if (responded) target.responseCount += 1;
  if (responded || status === "in_conversation" || status === "opportunity" || status === "won") target.conversationCount += 1;
  target.meetingCount += Number(row.meeting_count ?? 0);
  if (status === "opportunity") target.opportunityCount += 1;
  if (status === "won") target.clientCount += 1;
  if (!["won", "lost", "disqualified"].includes(status)) target.potentialValue += potential;
  if (status === "won") target.signedValue += potential;
}

function finishMarketMetrics(metrics: MarketMetrics) {
  metrics.responseRate = metrics.contactedCount ? Math.round(metrics.responseCount / metrics.contactedCount * 1_000) / 1_000 : null;
  metrics.averageWonValue = metrics.clientCount ? Math.round(metrics.signedValue / metrics.clientCount * 100) / 100 : null;
}

export function getMarketOverview(): MarketOverview {
  const db = getDatabase();
  const icps = listIcps().map((icp) => ({
    ...icp,
    metrics: emptyMarketMetrics(),
    segments: listIcpSegments(icp.id).map((segment) => ({ ...segment, metrics: emptyMarketMetrics() })),
    targetPersonas: listIcpPersonas(icp.id)
  }));
  const icpById = new Map(icps.map((icp) => [icp.id, icp]));
  const segmentById = new Map(icps.flatMap((icp) => icp.segments.map((segment) => [segment.id, segment] as const)));
  const unclassified = emptyMarketMetrics();
  const rows = db.prepare(`
    SELECT p.id, p.segment_id, s.icp_id, p.qualification_status, p.potential_value,
      (SELECT COUNT(*) FROM prospect_factory_contacts c WHERE c.prospect_id = p.id) AS contact_count,
      CASE WHEN NULLIF(TRIM(COALESCE(p.contact_name, p.source_contact_name, '')), '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM prospect_factory_contacts c
          WHERE c.prospect_id = p.id
            AND LOWER(TRIM(c.name)) = LOWER(TRIM(COALESCE(p.contact_name, p.source_contact_name, '')))
        )
        AND NOT EXISTS (
          SELECT 1 FROM prospect_factory_contacts c
          WHERE c.prospect_id = p.id
            AND NULLIF(TRIM(COALESCE(p.email, p.source_email, '')), '') IS NOT NULL
            AND LOWER(TRIM(COALESCE(c.email, ''))) = LOWER(TRIM(COALESCE(p.email, p.source_email, '')))
        )
        THEN 1 ELSE 0 END AS legacy_contact_count,
      (p.qualification_status IN ('contacted', 'in_conversation', 'opportunity', 'won', 'lost')
        OR EXISTS(SELECT 1 FROM prospect_factory_activities a WHERE a.prospect_id=p.id
          AND (a.action_kind='approach' OR a.outcome IN ('replied', 'interested', 'meeting_booked')
            OR (a.direction='inbound' AND a.activity_type IN ('email', 'call', 'meeting'))))) AS contacted,
      EXISTS(SELECT 1 FROM prospect_factory_activities a WHERE a.prospect_id=p.id
        AND (a.outcome IN ('replied', 'interested', 'meeting_booked')
          OR (a.direction='inbound' AND a.activity_type IN ('email', 'call', 'meeting')))) AS responded,
      (SELECT COUNT(*) FROM prospect_factory_activities a WHERE a.prospect_id=p.id
        AND (a.activity_type='meeting' OR a.event_type='meeting_booked' OR a.outcome='meeting_booked')) AS meeting_count
    FROM prospect_factory_prospects p
    LEFT JOIN prospect_factory_icp_segments s ON s.id=p.segment_id
  `).all() as ProspectRow[];
  for (const row of rows) {
    const segment = segmentById.get(String(row.segment_id));
    const icp = icpById.get(String(row.icp_id));
    if (segment && icp) {
      addMarketMetric(segment.metrics, row);
      addMarketMetric(icp.metrics, row);
    } else {
      addMarketMetric(unclassified, row);
    }
  }
  finishMarketMetrics(unclassified);
  for (const icp of icps) {
    finishMarketMetrics(icp.metrics);
    icp.segments.forEach((segment) => finishMarketMetrics(segment.metrics));
  }
  return { icps, unclassified, totalAccounts: rows.length };
}

export function listMarketAccounts(options: ListMarketAccountsOptions = {}): MarketAccountListResult {
  const db = getDatabase();
  if (options.icpId) assertRequiredText("icpId", options.icpId, 256);
  if (options.segmentId) assertRequiredText("segmentId", options.segmentId, 256);
  if (options.unclassified && (options.icpId || options.segmentId)) throw new ProspectCrmInputError("unclassified", "Unclassified cannot be combined with an ICP or segment.");
  if (options.status) assertEnum("status", options.status, PROSPECT_QUALIFICATION_STATUSES);
  if (options.priority) assertEnum("priority", options.priority, PROSPECT_PRIORITIES);
  if (options.signal) assertEnum("signal", options.signal, PROSPECT_OPERATIONAL_SIGNALS);
  assertOptionalInteger("minIcpFitScore", options.minIcpFitScore, 0, 100);
  assertOptionalText("query", options.query, 120);
  const clauses: string[] = [];
  const parameters: SQLInputValue[] = [];
  if (options.icpId) { clauses.push("s.icp_id=?"); parameters.push(options.icpId); }
  if (options.segmentId) { clauses.push("p.segment_id=?"); parameters.push(options.segmentId); }
  if (options.unclassified) clauses.push("p.segment_id IS NULL");
  if (options.status) { clauses.push("p.qualification_status=?"); parameters.push(options.status); }
  if (options.priority) { clauses.push("p.priority=?"); parameters.push(options.priority); }
  if (options.minIcpFitScore !== undefined) { clauses.push("p.icp_fit_score>=?"); parameters.push(options.minIcpFitScore); }
  if (options.signal) { clauses.push("EXISTS (SELECT 1 FROM json_each(p.operational_signals_json) WHERE value=?)"); parameters.push(options.signal); }
  if (options.query?.trim()) {
    const search = `%${escapeLike(options.query.trim())}%`;
    const accountSearchColumns = [
      "p.company_name", "p.commercial_name", "p.group_name", "p.city", "p.siren",
      "p.contact_name", "p.source_contact_name", "p.email", "p.source_email"
    ];
    clauses.push(`(${accountSearchColumns.map((column) => `${column} LIKE ? ESCAPE '\\' COLLATE NOCASE`).join(" OR ")}
      OR EXISTS (SELECT 1 FROM prospect_factory_contacts c WHERE c.prospect_id=p.id
        AND (c.name LIKE ? ESCAPE '\\' COLLATE NOCASE OR c.email LIKE ? ESCAPE '\\' COLLATE NOCASE)))`);
    parameters.push(...accountSearchColumns.map(() => search), search, search);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(200, Number.isInteger(options.limit) ? options.limit! : 50));
  const offset = Math.max(0, Number.isSafeInteger(options.offset) ? options.offset! : 0);
  const total = Number((db.prepare(`
    SELECT COUNT(*) AS total FROM prospect_factory_prospects p
    LEFT JOIN prospect_factory_icp_segments s ON s.id=p.segment_id ${where}
  `).get(...parameters) as { total: number }).total);
  const rows = db.prepare(`
    SELECT p.* FROM prospect_factory_prospects p
    LEFT JOIN prospect_factory_icp_segments s ON s.id=p.segment_id ${where}
    ORDER BY CASE WHEN p.next_action_at IS NULL THEN 1 ELSE 0 END,
      p.next_action_at ASC, p.icp_fit_score DESC,
      CASE p.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
      p.company_name COLLATE NOCASE ASC, p.id ASC LIMIT ? OFFSET ?
  `).all(...parameters, limit, offset) as ProspectRow[];
  return {
    accounts: rows.map((row) => {
      const prospect = mapProspect(row);
      const lastRow = db.prepare("SELECT * FROM prospect_factory_activities WHERE prospect_id=? ORDER BY occurred_at DESC, created_at DESC LIMIT 1").get(prospect.id) as ProspectRow | undefined;
      const activityCount = Number((db.prepare("SELECT COUNT(*) AS total FROM prospect_factory_activities WHERE prospect_id=?").get(prospect.id) as { total: number }).total);
      return {
        prospect,
        lastActivity: lastRow ? mapActivity(lastRow) : null,
        activityCount,
        targetPersonas: listAccountPersonas(prospect.id)
      };
    }), total, limit, offset
  };
}

function deriveIcpFit(market: AccountMarketProfile, icp: MarketIcp | null) {
  if (!icp || (market.employeeCountEstimate === null && market.operationalSignals.length === 0)) {
    return { score: null, reason: null };
  }
  const weightedSignals = Object.entries(icp.signalWeights).filter(([, weight]) => Number(weight) > 0);
  const availableWeight = weightedSignals.reduce((total, [, weight]) => total + Number(weight), 0);
  const matchedWeight = weightedSignals.reduce((total, [signal, weight]) =>
    total + (market.operationalSignals.includes(signal as ProspectOperationalSignal) ? Number(weight) : 0), 0);
  const employeeRule = icp.employeeMin !== null || icp.employeeMax !== null;
  const signalMaximum = availableWeight ? employeeRule ? 80 : 100 : 0;
  const employeeMaximum = employeeRule ? availableWeight ? 20 : 100 : 0;
  const employeeMatches = market.employeeCountEstimate !== null
    && (icp.employeeMin === null || market.employeeCountEstimate >= icp.employeeMin)
    && (icp.employeeMax === null || market.employeeCountEstimate <= icp.employeeMax);
  const score = Math.round((availableWeight ? matchedWeight / availableWeight * signalMaximum : 0)
    + (employeeMatches ? employeeMaximum : 0));
  const pieces = [`${market.operationalSignals.length} signal(s) relevé(s)`];
  if (employeeRule) pieces.push(market.employeeCountEstimate === null
    ? "effectif à vérifier" : employeeMatches ? "effectif dans la plage cible" : "effectif hors plage indicative");
  pieces.push("croissance non requise");
  return { score, reason: pieces.join(" · ") };
}

function validateMarketProfilePatch(patch: AccountMarketUpdateInput["market"]) {
  if (!patch || typeof patch !== "object" || !Object.keys(patch).length) throw new ProspectCrmInputError("market", "A market profile change is required.");
  assertOptionalText("market.segmentId", patch.segmentId, 256);
  assertOptionalText("market.groupName", patch.groupName, 240);
  assertOptionalText("market.siren", patch.siren, 20);
  assertOptionalText("market.siret", patch.siret, 20);
  if (patch.siren && !/^\d{9}$/.test(patch.siren)) throw new ProspectCrmInputError("market.siren", "SIREN must contain nine digits.");
  if (patch.siret && !/^\d{14}$/.test(patch.siret)) throw new ProspectCrmInputError("market.siret", "SIRET must contain fourteen digits.");
  assertOptionalInteger("market.employeeCountEstimate", patch.employeeCountEstimate, 0, 1_000_000);
  assertOptionalInteger("market.establishmentCount", patch.establishmentCount, 0, 1_000_000);
  assertOptionalInteger("market.entityCount", patch.entityCount, 0, 1_000_000);
  if (patch.operationalSignals !== undefined) assertOperationalSignals(patch.operationalSignals);
}

function seedAccountPersonaSlots(db: DatabaseSync, prospectId: string, icpId: string, timestamp: string) {
  const personas = db.prepare("SELECT persona_key, label FROM prospect_factory_icp_personas WHERE icp_id=? ORDER BY sort_order, label").all(icpId) as Array<{ persona_key: string; label: string }>;
  for (const persona of personas) {
    const matching = db.prepare("SELECT id FROM prospect_factory_contacts WHERE prospect_id=? AND persona_key=? ORDER BY created_at LIMIT 1")
      .get(prospectId, persona.persona_key) as { id: string } | undefined;
    db.prepare(`
      INSERT OR IGNORE INTO prospect_factory_account_personas
        (id, prospect_id, persona_key, label, contact_id, status, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, '', ?, ?)
    `).run(randomUUID(), prospectId, persona.persona_key, persona.label, matching?.id ?? null,
      matching ? "identified" : "to_find", timestamp, timestamp);
  }
}

export function updateAccountMarketProfile(
  id: string,
  input: AccountMarketUpdateInput,
  actorRole: string
): ProspectUpdateAuditResult | null {
  assertRequiredText("id", id, 256);
  assertRequiredText("actorRole", actorRole, 200);
  if (!Number.isInteger(input?.expectedVersion) || input.expectedVersion < 1) throw new ProspectCrmInputError("expectedVersion", "A positive expectedVersion is required.");
  validateMarketProfilePatch(input.market);
  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT * FROM prospect_factory_prospects WHERE id=?").get(id) as ProspectRow | undefined;
    if (!row) { db.exec("ROLLBACK"); return null; }
    const current = mapProspect(row);
    if (current.version !== input.expectedVersion) throw new ProspectVersionConflictError(id, input.expectedVersion, current.version);
    const patch = input.market;
    const segmentId = patch.segmentId === undefined ? current.market.segmentId : patch.segmentId;
    const segment = segmentId ? getIcpSegment(segmentId) : null;
    if (segmentId && !segment) throw new ProspectCrmInputError("market.segmentId", "Segment not found.");
    const next: AccountMarketProfile = {
      ...current.market,
      segmentId,
      icpId: segment?.icpId ?? null,
      groupName: patch.groupName === undefined ? current.market.groupName : patch.groupName,
      siren: patch.siren === undefined ? current.market.siren : patch.siren,
      siret: patch.siret === undefined ? current.market.siret : patch.siret,
      employeeCountEstimate: patch.employeeCountEstimate === undefined ? current.market.employeeCountEstimate : patch.employeeCountEstimate,
      establishmentCount: patch.establishmentCount === undefined ? current.market.establishmentCount : patch.establishmentCount,
      entityCount: patch.entityCount === undefined ? current.market.entityCount : patch.entityCount,
      operationalSignals: patch.operationalSignals === undefined ? current.market.operationalSignals : [...patch.operationalSignals],
      icpFitScore: null,
      icpFitReason: null
    };
    const fit = deriveIcpFit(next, segment ? getIcp(segment.icpId) : null);
    next.icpFitScore = fit.score;
    next.icpFitReason = fit.reason;
    if (JSON.stringify(current.market) === JSON.stringify(next)) {
      db.exec("COMMIT");
      return { prospect: current, version: current.version, activities: [] };
    }
    const timestamp = now();
    const result = db.prepare(`
      UPDATE prospect_factory_prospects SET segment_id=?, group_name=?, siren=?, siret=?, employee_count_estimate=?,
        establishment_count=?, entity_count=?, operational_signals_json=?, icp_fit_score=?, icp_fit_reason=?,
        updated_at=?, version=version+1 WHERE id=? AND version=?
    `).run(next.segmentId, next.groupName, next.siren, next.siret, next.employeeCountEstimate,
      next.establishmentCount, next.entityCount, JSON.stringify(next.operationalSignals), next.icpFitScore,
      next.icpFitReason, timestamp, id, current.version);
    if (Number(result.changes) !== 1) throw new ProspectVersionConflictError(id, input.expectedVersion, current.version);
    if (current.market.icpId && segment?.icpId !== current.market.icpId) {
      db.prepare(`
        DELETE FROM prospect_factory_account_personas
        WHERE prospect_id=? AND contact_id IS NULL AND status='to_find' AND notes=''
          AND EXISTS (
            SELECT 1 FROM prospect_factory_icp_personas ip
            WHERE ip.icp_id=? AND ip.persona_key=prospect_factory_account_personas.persona_key
              AND ip.label=prospect_factory_account_personas.label
          )
      `).run(id, current.market.icpId);
    }
    if (segment && segment.icpId !== current.market.icpId) seedAccountPersonaSlots(db, id, segment.icpId, timestamp);
    const event = appendProspectEvent(db, {
      prospectId: id, contactId: null, type: "enrichment", actionKind: "enrichment",
      eventType: "enrichment_updated", direction: "internal", outcome: null,
      subject: "Cartographie du compte mise à jour",
      body: "Classement ICP, identité ou signaux de complexité mis à jour.",
      occurredAt: timestamp, statusBefore: null, statusAfter: null,
      actorRole, actorId: null, source: "ui", idempotencyKey: null,
      reportingTimezone: current.research.reportingTimezone, metadata: { fields: Object.keys(patch) }, recordedAt: timestamp
    }).activity;
    const prospect = getProspect(id)!;
    db.exec("COMMIT");
    return { prospect, version: prospect.version, activities: [event] };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listIcpPersonas(icpId: string): IcpPersona[] {
  return (getDatabase().prepare(`
    SELECT * FROM prospect_factory_icp_personas WHERE icp_id=? ORDER BY sort_order, label COLLATE NOCASE, id
  `).all(icpId) as ProspectRow[]).map(mapIcpPersona);
}

function validateIcpPersonaInput(input: IcpPersonaWriteInput) {
  assertMarketSlug("key", input.key);
  assertRequiredText("label", input.label, 180);
  if (input.description !== undefined) assertText("description", input.description, 2_000);
  if (input.sortOrder !== undefined) assertOptionalInteger("sortOrder", input.sortOrder, -10_000, 10_000);
}

export function createIcpPersona(icpId: string, input: IcpPersonaWriteInput): IcpPersona {
  validateIcpPersonaInput(input);
  const db = getDatabase();
  if (!getIcp(icpId)) throw new ProspectCrmInputError("icpId", "ICP not found.");
  if (db.prepare("SELECT 1 FROM prospect_factory_icp_personas WHERE icp_id=? AND persona_key=?").get(icpId, input.key)) throw new ProspectCrmInputError("key", "This persona already exists in the ICP.");
  const id = randomUUID();
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO prospect_factory_icp_personas
        (id, icp_id, persona_key, label, description, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, icpId, input.key, input.label.trim(), input.description ?? "", input.sortOrder ?? 0, timestamp, timestamp);
    const accounts = db.prepare(`
      SELECT p.id FROM prospect_factory_prospects p
      JOIN prospect_factory_icp_segments s ON s.id=p.segment_id WHERE s.icp_id=?
    `).all(icpId) as Array<{ id: string }>;
    accounts.forEach((account) => seedAccountPersonaSlots(db, account.id, icpId, timestamp));
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return listIcpPersonas(icpId).find((persona) => persona.id === id)!;
}

export function updateIcpPersona(icpId: string, personaId: string, patch: Partial<IcpPersonaWriteInput>): IcpPersona | null {
  const current = listIcpPersonas(icpId).find((persona) => persona.id === personaId);
  if (!current) return null;
  const next: IcpPersonaWriteInput = { ...current, ...patch };
  validateIcpPersonaInput(next);
  const db = getDatabase();
  if (next.key !== current.key) {
    if (db.prepare("SELECT 1 FROM prospect_factory_icp_personas WHERE icp_id=? AND persona_key=? AND id<>?").get(icpId, next.key, personaId)) throw new ProspectCrmInputError("key", "This persona already exists in the ICP.");
    if (db.prepare(`
      SELECT 1 FROM prospect_factory_account_personas ap
      JOIN prospect_factory_prospects p ON p.id=ap.prospect_id
      JOIN prospect_factory_icp_segments s ON s.id=p.segment_id
      WHERE s.icp_id=? AND ap.persona_key=? LIMIT 1
    `).get(icpId, current.key)) throw new ProspectCrmInputError("key", "The persona key is used by classified accounts and cannot be changed yet.");
  }
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE prospect_factory_icp_personas SET persona_key=?, label=?, description=?, sort_order=?, updated_at=? WHERE id=? AND icp_id=?")
      .run(next.key, next.label.trim(), next.description ?? "", next.sortOrder ?? 0, timestamp, personaId, icpId);
    if (next.label !== current.label) {
      db.prepare(`
        UPDATE prospect_factory_account_personas SET label=?, updated_at=?
        WHERE persona_key=? AND label=? AND prospect_id IN (
          SELECT p.id FROM prospect_factory_prospects p
          JOIN prospect_factory_icp_segments s ON s.id=p.segment_id WHERE s.icp_id=?
        )
      `).run(next.label.trim(), timestamp, current.key, current.label, icpId);
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return listIcpPersonas(icpId).find((persona) => persona.id === personaId) ?? null;
}

export function deleteIcpPersona(icpId: string, personaId: string): boolean {
  const current = listIcpPersonas(icpId).find((persona) => persona.id === personaId);
  if (!current) return false;
  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      DELETE FROM prospect_factory_account_personas
      WHERE persona_key=? AND contact_id IS NULL AND notes='' AND status='to_find'
        AND prospect_id IN (
          SELECT p.id FROM prospect_factory_prospects p
          JOIN prospect_factory_icp_segments s ON s.id=p.segment_id WHERE s.icp_id=?
        )
    `).run(current.key, icpId);
    db.prepare("DELETE FROM prospect_factory_icp_personas WHERE id=? AND icp_id=?").run(personaId, icpId);
    db.exec("COMMIT");
    return true;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

function validateAccountPersonaInput(input: AccountPersonaWriteInput) {
  assertMarketSlug("key", input.key);
  assertRequiredText("label", input.label, 180);
  assertOptionalText("contactId", input.contactId, 256);
  if (input.status !== undefined) assertEnum("status", input.status, ["to_find", "identified", "not_relevant"] as const);
  if (input.notes !== undefined) assertText("notes", input.notes, 5_000);
}

function assertContactBelongsToAccount(db: DatabaseSync, prospectId: string, contactId: string | null | undefined) {
  if (!contactId) return;
  if (!db.prepare("SELECT 1 FROM prospect_factory_contacts WHERE id=? AND prospect_id=?").get(contactId, prospectId)) {
    throw new ProspectCrmInputError("contactId", "Contact must belong to this account.");
  }
}

export function listAccountPersonas(prospectId: string): AccountPersonaSlot[] {
  const db = getDatabase();
  const slots = (db.prepare("SELECT * FROM prospect_factory_account_personas WHERE prospect_id=? ORDER BY label COLLATE NOCASE, id")
    .all(prospectId) as ProspectRow[]).map(mapAccountPersona);
  return slots.map((slot) => {
    if (slot.contactId || slot.status === "not_relevant") return slot;
    const matches = db.prepare("SELECT id FROM prospect_factory_contacts WHERE prospect_id=? AND persona_key=? ORDER BY created_at LIMIT 2")
      .all(prospectId, slot.key) as Array<{ id: string }>;
    return matches.length === 1 ? { ...slot, contactId: matches[0]!.id, status: "identified" } : slot;
  });
}

export function createAccountPersona(prospectId: string, input: AccountPersonaWriteInput): AccountPersonaSlot {
  validateAccountPersonaInput(input);
  const db = getDatabase();
  if (!getProspect(prospectId)) throw new ProspectCrmInputError("prospectId", "Account not found.");
  assertContactBelongsToAccount(db, prospectId, input.contactId);
  if (db.prepare("SELECT 1 FROM prospect_factory_account_personas WHERE prospect_id=? AND persona_key=?").get(prospectId, input.key)) throw new ProspectCrmInputError("key", "This persona already exists on the account.");
  const id = randomUUID();
  const timestamp = now();
  const status = input.status ?? (input.contactId ? "identified" : "to_find");
  if (status === "identified" && !input.contactId) throw new ProspectCrmInputError("contactId", "An identified persona needs a contact.");
  db.prepare(`
    INSERT INTO prospect_factory_account_personas
      (id, prospect_id, persona_key, label, contact_id, status, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, prospectId, input.key, input.label.trim(), input.contactId ?? null, status, input.notes ?? "", timestamp, timestamp);
  return listAccountPersonas(prospectId).find((slot) => slot.id === id)!;
}

export function updateAccountPersona(prospectId: string, personaId: string, patch: Partial<AccountPersonaWriteInput>): AccountPersonaSlot | null {
  const current = listAccountPersonas(prospectId).find((slot) => slot.id === personaId);
  if (!current) return null;
  const next: AccountPersonaWriteInput = { ...current, ...patch };
  validateAccountPersonaInput(next);
  const db = getDatabase();
  assertContactBelongsToAccount(db, prospectId, next.contactId);
  if (next.status === "identified" && !next.contactId) throw new ProspectCrmInputError("contactId", "An identified persona needs a contact.");
  if (next.key !== current.key && db.prepare("SELECT 1 FROM prospect_factory_account_personas WHERE prospect_id=? AND persona_key=? AND id<>?").get(prospectId, next.key, personaId)) throw new ProspectCrmInputError("key", "This persona already exists on the account.");
  db.prepare(`
    UPDATE prospect_factory_account_personas SET persona_key=?, label=?, contact_id=?, status=?, notes=?, updated_at=?
    WHERE id=? AND prospect_id=?
  `).run(next.key, next.label.trim(), next.contactId ?? null, next.status ?? "to_find", next.notes ?? "", now(), personaId, prospectId);
  return listAccountPersonas(prospectId).find((slot) => slot.id === personaId) ?? null;
}

export function deleteAccountPersona(prospectId: string, personaId: string): boolean {
  return Number(getDatabase().prepare("DELETE FROM prospect_factory_account_personas WHERE id=? AND prospect_id=?").run(personaId, prospectId).changes) > 0;
}

export function listProspectContacts(prospectId: string): ProspectContact[] {
  return (getDatabase().prepare("SELECT * FROM prospect_factory_contacts WHERE prospect_id=? ORDER BY name COLLATE NOCASE, id")
    .all(prospectId) as ProspectRow[]).map(mapContact);
}

function validateProspectContactWrite(input: ProspectContactWriteInput) {
  assertRequiredText("name", input.name, 2_000);
  for (const [field, value, max] of [
    ["firstName", input.firstName, 500], ["lastName", input.lastName, 500],
    ["email", input.email, 500], ["phone", input.phone, 500], ["linkedin", input.linkedin, 2_048],
    ["seniority", input.seniority, 500], ["personaKey", input.personaKey, 120],
    ["inputTitle", input.inputTitle, 1_000], ["verifiedTitle", input.verifiedTitle, 1_000],
    ["sourceUrl", input.sourceUrl, 2_048], ["sourceRowOrRecord", input.sourceRowOrRecord, 1_000]
  ] as const) assertOptionalText(field, value, max);
  if (input.evidenceType !== undefined) assertEnum("evidenceType", input.evidenceType, PROSPECT_EVIDENCE_TYPES);
  if (input.buyingCommitteeRole !== undefined && input.buyingCommitteeRole !== null) assertEnum("buyingCommitteeRole", input.buyingCommitteeRole, PROSPECT_BUYING_COMMITTEE_ROLES);
  if (input.decisionScope !== undefined && input.decisionScope !== null) assertEnum("decisionScope", input.decisionScope, PROSPECT_DECISION_SCOPES);
  if (input.personaKey) assertMarketSlug("personaKey", input.personaKey);
  if (input.dealRoles !== undefined) {
    if (!Array.isArray(input.dealRoles) || input.dealRoles.length > PROSPECT_DEAL_ROLES.length) throw new ProspectCrmInputError("dealRoles", "Invalid deal roles.");
    input.dealRoles.forEach((role) => assertEnum("dealRoles[]", role, PROSPECT_DEAL_ROLES));
    if (new Set(input.dealRoles).size !== input.dealRoles.length) throw new ProspectCrmInputError("dealRoles", "Deal roles must be unique.");
  }
}

function assertNoDuplicateContact(db: DatabaseSync, prospectId: string, email: string | null, linkedin: string | null, exceptId?: string) {
  if (!email?.trim() && !linkedin?.trim()) return;
  const duplicate = db.prepare(`
    SELECT id FROM prospect_factory_contacts WHERE prospect_id=? AND id<>?
      AND ((? IS NOT NULL AND LOWER(TRIM(COALESCE(email,'')))=LOWER(TRIM(?)))
        OR (? IS NOT NULL AND LOWER(TRIM(RTRIM(COALESCE(linkedin,''),'/')))=LOWER(TRIM(RTRIM(?,'/'))))) LIMIT 1
  `).get(prospectId, exceptId ?? "", email, email, linkedin, linkedin);
  if (duplicate) throw new ProspectCrmInputError("email", "Un contact avec cet email ou cette URL LinkedIn existe déjà sur le compte.");
}

function touchAccountForContact(db: DatabaseSync, prospectId: string, eventType: "contact_added" | "enrichment_updated", subject: string) {
  const timestamp = now();
  db.prepare("UPDATE prospect_factory_prospects SET updated_at=?, version=version+1 WHERE id=?").run(timestamp, prospectId);
  appendProspectEvent(db, {
    prospectId, contactId: null, type: "enrichment", actionKind: "enrichment", eventType,
    direction: "internal", outcome: null, subject,
    body: "Contact du compte mis à jour.", occurredAt: timestamp,
    statusBefore: null, statusAfter: null, actorRole: "crm", actorId: null,
    source: "ui", idempotencyKey: null, reportingTimezone: DEFAULT_REPORTING_TIMEZONE,
    metadata: {}, recordedAt: timestamp
  });
}

function linkContactToPersonaSlot(db: DatabaseSync, prospectId: string, contactId: string, personaKey: string | null) {
  if (!personaKey) return;
  const matches = db.prepare("SELECT id FROM prospect_factory_contacts WHERE prospect_id=? AND persona_key=? LIMIT 2")
    .all(prospectId, personaKey) as Array<{ id: string }>;
  if (matches.length !== 1 || matches[0]?.id !== contactId) return;
  db.prepare(`
    UPDATE prospect_factory_account_personas SET contact_id=?, status='identified', updated_at=?
    WHERE prospect_id=? AND persona_key=? AND contact_id IS NULL AND status<>'not_relevant'
  `).run(contactId, now(), prospectId, personaKey);
}

export function createProspectContact(prospectId: string, input: ProspectContactWriteInput): ProspectContact {
  validateProspectContactWrite(input);
  const db = getDatabase();
  const prospect = getProspect(prospectId);
  if (!prospect) throw new ProspectCrmInputError("prospectId", "Account not found.");
  const legacy = prospect.legacyContact?.name.toLocaleLowerCase() === input.name.trim().toLocaleLowerCase()
    ? prospect.legacyContact : null;
  const email = input.email === undefined ? legacy?.email ?? null : input.email;
  assertNoDuplicateContact(db, prospectId, email ?? null, input.linkedin ?? null);
  const id = randomUUID();
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO prospect_factory_contacts
        (id, prospect_id, fingerprint, name, first_name, last_name, email, phone, linkedin,
         seniority, persona_key, deal_roles_json, decision_scope, input_title, verified_title,
         evidence_type, source_url, source_row_or_record, buying_committee_role, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, prospectId, `manual:${id}`, input.name.trim(), input.firstName ?? null, input.lastName ?? null,
      email ?? null, input.phone === undefined ? legacy?.phone ?? null : input.phone,
      input.linkedin === undefined ? legacy?.linkedin ?? null : input.linkedin,
      input.seniority ?? null, input.personaKey ?? null, JSON.stringify(input.dealRoles ?? []),
      input.decisionScope ?? null, input.inputTitle === undefined ? legacy?.title ?? null : input.inputTitle,
      input.verifiedTitle ?? null, input.evidenceType ?? "to_confirm", input.sourceUrl ?? null,
      input.sourceRowOrRecord ?? null, input.buyingCommitteeRole ?? null, timestamp, timestamp);
    linkContactToPersonaSlot(db, prospectId, id, input.personaKey ?? null);
    touchAccountForContact(db, prospectId, "contact_added", "Contact ajouté au compte");
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return listProspectContacts(prospectId).find((contact) => contact.id === id)!;
}

export function updateProspectContact(
  prospectId: string,
  contactId: string,
  patch: Partial<ProspectContactWriteInput>
): ProspectContact | null {
  const current = listProspectContacts(prospectId).find((contact) => contact.id === contactId);
  if (!current) return null;
  const next: ProspectContactWriteInput = { ...current, ...patch };
  validateProspectContactWrite(next);
  const db = getDatabase();
  assertNoDuplicateContact(db, prospectId, next.email ?? null, next.linkedin ?? null, contactId);
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE prospect_factory_contacts SET name=?, first_name=?, last_name=?, email=?, phone=?, linkedin=?,
        seniority=?, persona_key=?, deal_roles_json=?, decision_scope=?, input_title=?, verified_title=?,
        evidence_type=?, source_url=?, source_row_or_record=?, buying_committee_role=?, updated_at=?
      WHERE id=? AND prospect_id=?
    `).run(next.name.trim(), next.firstName ?? null, next.lastName ?? null, next.email ?? null,
      next.phone ?? null, next.linkedin ?? null, next.seniority ?? null, next.personaKey ?? null,
      JSON.stringify(next.dealRoles ?? []), next.decisionScope ?? null, next.inputTitle ?? null,
      next.verifiedTitle ?? null, next.evidenceType ?? "to_confirm", next.sourceUrl ?? null,
      next.sourceRowOrRecord ?? null, next.buyingCommitteeRole ?? null, timestamp, contactId, prospectId);
    if (current.personaKey !== next.personaKey) {
      db.prepare(`
        UPDATE prospect_factory_account_personas SET contact_id=NULL, status='to_find', updated_at=?
        WHERE prospect_id=? AND contact_id=? AND persona_key=?
      `).run(timestamp, prospectId, contactId, current.personaKey ?? "");
    }
    linkContactToPersonaSlot(db, prospectId, contactId, next.personaKey ?? null);
    touchAccountForContact(db, prospectId, "enrichment_updated", "Contact mis à jour");
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return listProspectContacts(prospectId).find((contact) => contact.id === contactId) ?? null;
}

export function deleteProspectContact(prospectId: string, contactId: string): boolean {
  const db = getDatabase();
  if (!db.prepare("SELECT 1 FROM prospect_factory_contacts WHERE id=? AND prospect_id=?").get(contactId, prospectId)) return false;
  if (db.prepare("SELECT 1 FROM prospect_factory_activities WHERE prospect_id=? AND contact_id=? LIMIT 1").get(prospectId, contactId)) {
    throw new ProspectCrmInputError("contactId", "This contact has commercial activities and cannot be deleted without losing their attribution.");
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE prospect_factory_account_personas SET contact_id=NULL, status='to_find', updated_at=? WHERE prospect_id=? AND contact_id=?")
      .run(now(), prospectId, contactId);
    db.prepare("DELETE FROM prospect_factory_contacts WHERE id=? AND prospect_id=?").run(contactId, prospectId);
    touchAccountForContact(db, prospectId, "enrichment_updated", "Contact retiré du compte");
    db.exec("COMMIT");
    return true;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
