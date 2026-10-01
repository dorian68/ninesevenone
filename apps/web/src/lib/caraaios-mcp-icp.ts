import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

import { getIcp, ProspectCrmInputError, withAccountMapDatabase } from "./prospect-factory-crm-db";
import type { MarketIcp } from "./prospect-factory-crm-contract";

export const COMPANY_ICP_STATUSES = ["candidate", "investigating", "qualified", "disqualified", "unknown"] as const;
export const COMPANY_ICP_EVIDENCE_TYPES = ["observed", "verified", "declared", "inferred", "unknown"] as const;
export const COMPANY_ICP_SOURCE_TYPES = [
  "linkedin_video", "linkedin_profile", "company_website", "press", "job_posting",
  "user_manual", "chatgpt_research", "codex_research", "crm_ui", "other", "unknown"
] as const;

export const upsertCompanyIcpSchema = z.object({
  icpId: z.string().uuid(),
  status: z.enum(COMPANY_ICP_STATUSES).optional(),
  evidenceType: z.enum(COMPANY_ICP_EVIDENCE_TYPES).optional(),
  sourceType: z.enum(COMPANY_ICP_SOURCE_TYPES).optional(),
  sourceReference: z.string().trim().max(2_048).nullable().optional(),
  observedAt: z.string().datetime({ offset: true }).nullable().optional(),
  notes: z.string().max(10_000).optional()
}).strict();

export type UpsertCompanyIcpInput = z.input<typeof upsertCompanyIcpSchema>;
export type CompanyIcpStatus = typeof COMPANY_ICP_STATUSES[number];
export type CompanyIcpEvidenceType = typeof COMPANY_ICP_EVIDENCE_TYPES[number];
export type CompanyIcpSourceType = typeof COMPANY_ICP_SOURCE_TYPES[number];

export type CompanyIcpObservation = {
  id: string;
  status: CompanyIcpStatus;
  evidenceType: CompanyIcpEvidenceType;
  sourceType: CompanyIcpSourceType;
  sourceReference: string | null;
  observedAt: string | null;
  notes: string;
  recordedAt: string;
};

export type CompanyIcpAssociation = Omit<CompanyIcpObservation, "id" | "recordedAt"> & {
  companyId: string;
  icpId: string;
  icp: MarketIcp;
  origin: "explicit" | "legacy_segment";
  legacySegmentId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  observations: CompanyIcpObservation[];
};

export type CompanyIcpContext = {
  companyId: string;
  associations: CompanyIcpAssociation[];
};

type Row = Record<string, unknown>;

function observation(row: Row): CompanyIcpObservation {
  return {
    id: String(row.id), status: row.status as CompanyIcpStatus,
    evidenceType: row.evidence_type as CompanyIcpEvidenceType,
    sourceType: row.source_type as CompanyIcpSourceType,
    sourceReference: row.source_reference == null ? null : String(row.source_reference),
    observedAt: row.observed_at == null ? null : String(row.observed_at),
    notes: String(row.notes), recordedAt: String(row.recorded_at)
  };
}

function association(db: DatabaseSync, row: Row, icp: MarketIcp, legacySegmentId: string | null): CompanyIcpAssociation {
  const history = db.prepare(`SELECT * FROM prospect_factory_account_icp_observations
    WHERE prospect_id=? AND icp_id=? ORDER BY recorded_at DESC, rowid DESC`)
    .all(String(row.prospect_id), String(row.icp_id)) as Row[];
  return {
    companyId: String(row.prospect_id), icpId: String(row.icp_id), icp,
    status: row.status as CompanyIcpStatus,
    evidenceType: row.evidence_type as CompanyIcpEvidenceType,
    sourceType: row.source_type as CompanyIcpSourceType,
    sourceReference: row.source_reference == null ? null : String(row.source_reference),
    observedAt: row.observed_at == null ? null : String(row.observed_at),
    notes: String(row.notes), origin: "explicit", legacySegmentId,
    version: Number(row.version), createdAt: String(row.created_at),
    updatedAt: String(row.updated_at), observations: history.map(observation)
  };
}

/** Includes the old single-segment classification until an explicit assessment replaces it. */
export function getCompanyIcps(companyId: string): CompanyIcpContext | null {
  return withAccountMapDatabase((db) => {
    const company = db.prepare(`SELECT p.id,p.segment_id,p.created_at,p.updated_at,s.icp_id AS legacy_icp_id
      FROM prospect_factory_prospects p
      LEFT JOIN prospect_factory_icp_segments s ON s.id=p.segment_id WHERE p.id=?`)
      .get(companyId) as Row | undefined;
    if (!company) return null;
    const legacyIcpId = company.legacy_icp_id == null ? null : String(company.legacy_icp_id);
    const legacySegmentId = company.segment_id == null ? null : String(company.segment_id);
    const rows = db.prepare("SELECT * FROM prospect_factory_account_icps WHERE prospect_id=? ORDER BY updated_at DESC, icp_id")
      .all(companyId) as Row[];
    const associations = rows.map((row) => {
      const icp = getIcp(String(row.icp_id));
      if (!icp) throw new Error("ICP lié au compte introuvable.");
      return association(db, row, icp, String(row.icp_id) === legacyIcpId ? legacySegmentId : null);
    });
    if (legacyIcpId && !rows.some((row) => row.icp_id === legacyIcpId)) {
      const icp = getIcp(legacyIcpId);
      if (icp) associations.push({
        companyId, icpId: legacyIcpId, icp, status: "candidate", evidenceType: "unknown",
        sourceType: "crm_ui", sourceReference: null, observedAt: null, notes: "",
        origin: "legacy_segment", legacySegmentId, version: 0,
        createdAt: String(company.created_at), updatedAt: String(company.updated_at), observations: []
      });
    }
    return { companyId, associations };
  });
}

/** Idempotent assessment. A changed assessment appends a separate observation. */
export function upsertCompanyIcp(companyId: string, input: UpsertCompanyIcpInput): CompanyIcpAssociation {
  const parsed = upsertCompanyIcpSchema.safeParse(input);
  if (!parsed.success) throw new ProspectCrmInputError("companyIcp", parsed.error.issues[0]?.message ?? "Association ICP invalide.");
  const value = parsed.data;
  return withAccountMapDatabase((db) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (!db.prepare("SELECT 1 FROM prospect_factory_prospects WHERE id=?").get(companyId)) {
        throw new ProspectCrmInputError("companyId", "Société suivie introuvable.");
      }
      if (!db.prepare("SELECT 1 FROM prospect_factory_icps WHERE id=?").get(value.icpId)) {
        throw new ProspectCrmInputError("icpId", "ICP introuvable dans le catalogue.");
      }
      const before = db.prepare("SELECT * FROM prospect_factory_account_icps WHERE prospect_id=? AND icp_id=?")
        .get(companyId, value.icpId) as Row | undefined;
      const next = {
        status: value.status ?? (before?.status as CompanyIcpStatus | undefined) ?? "candidate",
        evidenceType: value.evidenceType ?? (before?.evidence_type as CompanyIcpEvidenceType | undefined) ?? "unknown",
        sourceType: value.sourceType ?? (before?.source_type as CompanyIcpSourceType | undefined) ?? "unknown",
        sourceReference: value.sourceReference === undefined
          ? (before?.source_reference == null ? null : String(before.source_reference))
          : value.sourceReference,
        observedAt: value.observedAt === undefined
          ? (before?.observed_at == null ? null : String(before.observed_at))
          : value.observedAt == null ? null : new Date(value.observedAt).toISOString(),
        notes: value.notes ?? (before ? String(before.notes) : "")
      };
      if (["qualified", "disqualified"].includes(next.status) &&
          ["inferred", "unknown"].includes(next.evidenceType)) {
        throw new ProspectCrmInputError("evidenceType", "Une qualification confirmée exige une preuve observée, vérifiée ou déclarée.");
      }
      const changed = !before || before.status !== next.status || before.evidence_type !== next.evidenceType ||
        before.source_type !== next.sourceType || before.source_reference !== next.sourceReference ||
        before.observed_at !== next.observedAt || before.notes !== next.notes;
      if (changed) {
        const timestamp = new Date().toISOString();
        if (before) {
          db.prepare(`UPDATE prospect_factory_account_icps SET status=?,evidence_type=?,source_type=?,
            source_reference=?,observed_at=?,notes=?,version=version+1,updated_at=?
            WHERE prospect_id=? AND icp_id=?`).run(next.status, next.evidenceType, next.sourceType,
            next.sourceReference, next.observedAt, next.notes, timestamp, companyId, value.icpId);
        } else {
          db.prepare(`INSERT INTO prospect_factory_account_icps
            (prospect_id,icp_id,status,evidence_type,source_type,source_reference,observed_at,notes,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?)`).run(companyId, value.icpId, next.status, next.evidenceType,
            next.sourceType, next.sourceReference, next.observedAt, next.notes, timestamp, timestamp);
        }
        db.prepare(`INSERT INTO prospect_factory_account_icp_observations
          (id,prospect_id,icp_id,status,evidence_type,source_type,source_reference,observed_at,notes,recorded_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), companyId, value.icpId, next.status,
          next.evidenceType, next.sourceType, next.sourceReference, next.observedAt, next.notes, timestamp);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    const context = getCompanyIcps(companyId);
    const saved = context?.associations.find((entry) => entry.icpId === value.icpId);
    if (!saved) throw new Error("Association ICP absente après enregistrement.");
    return saved;
  });
}
