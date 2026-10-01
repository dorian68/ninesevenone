import "server-only";

import { randomUUID } from "node:crypto";

import { createAccountMapClaim, createAccountMapSource, getAccountMap } from "@/lib/account-map-db";
import { addProspectActivity, getProspect, listProspectActivities, withAccountMapDatabase } from "@/lib/prospect-factory-crm-db";

export const CARAAIOS_SOURCE_TYPES = [
  "linkedin_video", "linkedin_profile", "company_website", "press", "job_posting",
  "user_manual", "chatgpt_research", "codex_research", "other"
] as const;
export type CaraaiosSourceType = typeof CARAAIOS_SOURCE_TYPES[number];

export type CaraaiosSource = {
  source_type: CaraaiosSourceType;
  source_reference?: string;
  observed_at?: string;
  excerpt?: string;
};

export type CaraaiosResearchInput = {
  company_id: string;
  kind: "observed_fact" | "hypothesis" | "declared_pain" | "confirmed_use_case" | "note";
  statement: string;
  evidence_type: "observed" | "verified" | "declared" | "inferred" | "unknown";
  source?: CaraaiosSource;
  raw_value?: string;
  normalized_value?: string;
  justification?: string;
  verification_question?: string;
  idempotency_key?: string;
};

function mapSourceKind(type: CaraaiosSourceType) {
  if (type === "linkedin_video") return "document" as const;
  if (["linkedin_profile", "company_website", "press", "job_posting"].includes(type)) return "web_page" as const;
  if (type === "user_manual") return "crm_note" as const;
  return "other" as const;
}

export function addCaraaiosCompanyResearch(input: CaraaiosResearchInput) {
  const account = getProspect(input.company_id);
  if (!account) throw new Error("Société introuvable.");
  const map = getAccountMap(input.company_id);
  const root = map?.nodes.find((node) => node.isRoot);
  if (!map || !root) throw new Error("Cartographie du compte indisponible.");
  if (input.kind === "note") {
    const activity = addProspectActivity(input.company_id, {
      type: "note", detailType: "note", body: input.statement, eventType: "note_added",
      source: "api", actorRole: "MCP", actorId: "caraaios-mcp",
      idempotencyKey: input.idempotency_key,
      metadata: { evidence_type: input.evidence_type, source_type: input.source?.source_type ?? null,
        source_reference: input.source?.source_reference ?? null }
    });
    return { created: Boolean(activity && !activity.idempotent), activity_id: activity?.activity.id ?? null };
  }
  if (input.kind === "hypothesis" && input.evidence_type !== "inferred" && input.evidence_type !== "unknown") {
    throw new Error("Une hypothèse doit garder evidence_type inferred ou unknown.");
  }
  if (input.kind === "declared_pain" && input.evidence_type !== "declared") {
    throw new Error("Une douleur déclarée exige evidence_type declared.");
  }
  if (input.kind === "confirmed_use_case" && !["declared", "verified"].includes(input.evidence_type)) {
    throw new Error("Un cas d’usage confirmé exige une déclaration ou une vérification sourcée.");
  }
  const inferred = input.evidence_type === "inferred" || input.evidence_type === "unknown";
  if (!inferred && (!input.source || !(input.source.source_reference || input.source.excerpt))) {
    throw new Error("Une information observée, déclarée ou vérifiée exige une source repérable.");
  }
  if (inferred && (!input.justification || !input.verification_question)) {
    throw new Error("Une inférence exige une justification et une question de vérification.");
  }
  const value = { statement: input.statement, evidence_type: input.evidence_type,
    raw_value: input.raw_value ?? null, normalized_value: input.normalized_value ?? null };
  const existing = map.claims.find((claim) => claim.subjectNodeId === root.id && claim.field === input.kind
    && JSON.stringify(claim.value) === JSON.stringify(value));
  if (existing && (!input.source || map.sources.some((source) => existing.sourceIds.includes(source.id)
    && source.label === input.source!.source_type && source.reference === (input.source!.source_reference ?? null)))) {
    return { created: false, claim: existing };
  }
  let sourceId: string | undefined;
  if (input.source) {
    const oldSource = map.sources.find((source) => source.label === input.source!.source_type
      && source.reference === (input.source!.source_reference ?? null)
      && source.excerpt === (input.source!.excerpt ?? null));
    sourceId = oldSource?.id ?? createAccountMapSource(input.company_id, {
      kind: mapSourceKind(input.source.source_type), label: input.source.source_type,
      reference: input.source.source_reference ?? null,
      informationDate: input.source.observed_at ?? null,
      excerpt: input.source.excerpt ?? null
    }).id;
  }
  const claim = createAccountMapClaim(input.company_id, {
    subjectNodeId: root.id, field: input.kind, value,
    evidenceStatus: inferred ? "hypothesis" : "observed",
    sourceIds: sourceId ? [sourceId] : [],
    excerpt: input.source?.excerpt,
    informationDate: input.source?.observed_at,
    justification: input.justification,
    verificationQuestion: input.verification_question
  });
  return { created: true, claim };
}

export function getCaraaiosCompanyNotes(companyId: string) {
  return listProspectActivities(companyId, 100).filter((activity) => activity.type === "note")
    .map((activity) => ({ id: activity.id, body: activity.body, recorded_at: activity.recordedAt,
      source: activity.source, metadata: activity.metadata }));
}

export function recordCaraaiosMcpAudit(toolName: string, entityId: string | null,
  outcome: "created" | "updated" | "unchanged" | "partial" | "error", details: Record<string, number | string | boolean | null> = {}) {
  withAccountMapDatabase((db) => {
    db.prepare(`INSERT INTO prospect_factory_mcp_audit
      (id,actor,tool_name,entity_id,outcome,details_json,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(randomUUID(), "caraaios-mcp", toolName, entityId, outcome, JSON.stringify(details), new Date().toISOString());
  });
}
