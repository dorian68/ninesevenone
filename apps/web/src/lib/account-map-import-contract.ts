import { z } from "zod";

export const ACCOUNT_MAP_IMPORT_SCHEMA_VERSION = "account_map.v1" as const;

const id = z.string().uuid();
const text = (limit: number) => z.string().trim().min(1).max(limit);
const optionalText = (limit: number) => text(limit).nullable().optional();
const dateTime = z.string().datetime({ offset: true });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sourceId = z.string().trim().min(1).max(120).regex(/^src:[A-Za-z0-9._:-]+$/);
const tempId = z.string().trim().min(1).max(120).regex(/^tmp:(person|unit|slot):[A-Za-z0-9._:-]+$/);
const graphRef = z.string().trim().min(1).max(240).regex(/^(tmp:(person|unit|slot):[A-Za-z0-9._:-]+|crm:(contact|account):[0-9a-fA-F-]{36}|map:node:[0-9a-fA-F-]{36})$/);

export const accountMapEvidenceStatusSchema = z.enum([
  "observed", "confirmed", "hypothesis", "contradictory", "obsolete"
]);

export const accountMapImportEvidenceSchema = z.object({
  status: accountMapEvidenceStatusSchema,
  source_ids: z.array(sourceId).max(20),
  locator: optionalText(2_000),
  excerpt: optionalText(5_000),
  information_date: date.or(dateTime).nullable().optional(),
  justification: optionalText(5_000),
  verification_question: optionalText(2_000)
}).strict().superRefine((value, context) => {
  if (value.status !== "hypothesis" && value.source_ids.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["source_ids"], message: "Une information observée, confirmée, contradictoire ou obsolète doit citer une source." });
  }
  if (value.status !== "hypothesis" && !value.locator && !value.excerpt) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["locator"], message: "Indiquez un extrait ou une zone repérable dans la source." });
  }
  if (value.status === "hypothesis" && (!value.justification || !value.verification_question)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["justification"], message: "Une hypothèse doit être justifiée et avoir une question de vérification." });
  }
});

const source = z.object({
  source_id: sourceId,
  kind: z.enum(["user_screenshot", "document", "meeting_note", "crm_activity", "web_page", "other"]),
  label: text(500),
  collected_at: dateTime,
  information_date: date.or(dateTime).nullable().optional(),
  asset_ref: z.string().regex(/^private:[A-Za-z0-9._:/-]+$/).max(2_048).nullable().optional(),
  retention_until: dateTime.nullable().optional(),
  url: z.string().url().max(2_048).refine((value) => ["http:", "https:"].includes(new URL(value).protocol)).nullable().optional()
}).strict().superRefine((value, context) => {
  if (value.asset_ref && !value.retention_until) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["retention_until"], message: "Une pièce privée exige une date de conservation." });
  }
});

const unit = z.object({
  temp_id: tempId.refine((value) => value.startsWith("tmp:unit:")),
  kind: z.enum(["group", "company", "headquarters", "subsidiary", "establishment", "department", "external"]),
  name: text(500),
  linked_crm_account_id: id.nullable().optional(),
  evidence: accountMapImportEvidenceSchema
}).strict();

const affiliation = z.object({
  unit_ref: graphRef,
  job_title_observed: optionalText(1_000),
  scope: optionalText(500),
  external: z.boolean().default(false),
  evidence: accountMapImportEvidenceSchema
}).strict();

const person = z.object({
  temp_id: tempId.refine((value) => value.startsWith("tmp:person:")),
  crm_contact_id: id.nullable().optional(),
  display_name_observed: text(2_000),
  first_name: optionalText(500),
  last_name: optionalText(500),
  job_title_observed: optionalText(1_000),
  linkedin_url: z.string().url().max(2_048).refine((value) => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol)
      && ["linkedin.com", "www.linkedin.com"].includes(url.hostname.toLowerCase());
  }, "URL LinkedIn valide requise.").nullable().optional(),
  email: z.string().email().max(500).nullable().optional(),
  phone: optionalText(500),
  identity_evidence: accountMapImportEvidenceSchema,
  affiliations: z.array(affiliation).max(30).default([])
}).strict();

const roleSlot = z.object({
  temp_id: tempId.refine((value) => value.startsWith("tmp:slot:")),
  label: text(500),
  opportunity_id: id.nullable().optional(),
  notes: optionalText(5_000),
  evidence: accountMapImportEvidenceSchema.nullable().optional()
}).strict();

const relation = z.object({
  from_ref: graphRef,
  to_ref: graphRef,
  kind: z.enum(["unqualified", "works_in", "reports_to", "functional_reports_to", "part_of", "can_introduce", "advises"]),
  opportunity_id: id.nullable().optional(),
  evidence: accountMapImportEvidenceSchema
}).strict().refine((value) => value.from_ref !== value.to_ref, "Une relation ne peut pas relier un nœud à lui-même.");

const opportunityRole = z.object({
  person_ref: graphRef,
  opportunity_id: id,
  role: z.enum([
    "user", "process_owner", "influencer", "potential_relay", "confirmed_champion",
    "economic_decision_maker", "technical_validator", "security_validator", "procurement",
    "access_facilitator", "unknown"
  ]),
  evidence: accountMapImportEvidenceSchema
}).strict();

const powerClaim = z.object({
  person_ref: graphRef,
  opportunity_id: id.nullable().optional(),
  power: z.enum(["propose_project", "lead_process", "recommend_vendor", "authorize_budget", "sign", "validate_technology", "conduct_purchasing"]),
  answer: z.enum(["yes", "no", "unknown"]),
  scope: optionalText(1_000),
  budget_limit: z.object({ amount: z.number().finite().positive(), currency: z.string().regex(/^[A-Z]{3}$/) }).strict().nullable().optional(),
  evidence: accountMapImportEvidenceSchema
}).strict().superRefine((value, context) => {
  if (value.budget_limit && (value.power !== "authorize_budget" || value.answer !== "yes" || value.evidence.status === "hypothesis")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["budget_limit"], message: "Le plafond exige un pouvoir budgétaire explicitement documenté." });
  }
});

const claim = z.object({
  subject_ref: graphRef,
  field: z.enum(["documented_mission", "role_hypothesis", "supervised_process", "objective", "tool", "expressed_problem", "task_observed", "professional_scope", "other"]),
  value: text(10_000),
  opportunity_id: id.nullable().optional(),
  evidence: accountMapImportEvidenceSchema
}).strict().superRefine((value, context) => {
  if (value.field === "role_hypothesis" && value.evidence.status !== "hypothesis") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["evidence", "status"], message: "Une hypothèse de fonction doit garder le statut hypothèse." });
  }
});

const hypothesis = z.object({
  subject_ref: graphRef,
  proposition: text(5_000),
  justification: text(5_000),
  source_ids: z.array(sourceId).max(20).default([]),
  verification_question: text(2_000)
}).strict();

const openQuestion = z.object({
  subject_ref: graphRef.nullable().optional(),
  opportunity_id: id.nullable().optional(),
  question: text(2_000),
  next_action: optionalText(2_000)
}).strict();

const warning = z.object({
  code: text(120),
  message: text(2_000),
  source_id: sourceId.nullable().optional()
}).strict();

export const accountMapImportSchema = z.object({
  schema_version: z.literal(ACCOUNT_MAP_IMPORT_SCHEMA_VERSION),
  account_id: id,
  opportunity_id: id.nullable(),
  import_batch_id: id,
  sources: z.array(source).max(100),
  units: z.array(unit).max(100),
  people: z.array(person).max(200),
  role_slots: z.array(roleSlot).max(100),
  relations: z.array(relation).max(500),
  opportunity_roles: z.array(opportunityRole).max(500),
  power_claims: z.array(powerClaim).max(500),
  claims: z.array(claim).max(1_000),
  hypotheses: z.array(hypothesis).max(500),
  open_questions: z.array(openQuestion).max(500),
  warnings: z.array(warning).max(500)
}).strict().superRefine((document, context) => {
  const sourceIds = new Set<string>();
  for (const [index, source] of document.sources.entries()) {
    if (sourceIds.has(source.source_id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["sources", index, "source_id"], message: "Identifiant de source dupliqué." });
    sourceIds.add(source.source_id);
  }
  const tempIds = new Set<string>();
  for (const [group, items] of [["units", document.units], ["people", document.people], ["role_slots", document.role_slots]] as const) {
    for (const [index, item] of items.entries()) {
      if (tempIds.has(item.temp_id)) context.addIssue({ code: z.ZodIssueCode.custom, path: [group, index, "temp_id"], message: "Identifiant temporaire dupliqué." });
      tempIds.add(item.temp_id);
    }
  }
  const checkSources = (evidence: z.infer<typeof accountMapImportEvidenceSchema> | null | undefined, path: (string | number)[]) => {
    if (!evidence) return;
    evidence.source_ids.forEach((sourceId, index) => {
      if (!sourceIds.has(sourceId)) context.addIssue({ code: z.ZodIssueCode.custom, path: [...path, "source_ids", index], message: "Source absente du lot." });
    });
  };
  const checkRef = (ref: string, path: (string | number)[]) => {
    if (ref.startsWith("tmp:") && !tempIds.has(ref)) context.addIssue({ code: z.ZodIssueCode.custom, path, message: "Référence temporaire absente du lot." });
    if (ref.startsWith("crm:account:") && ref !== `crm:account:${document.account_id}`) context.addIssue({ code: z.ZodIssueCode.custom, path, message: "Référence à un autre compte interdite." });
  };
  document.units.forEach((item, index) => checkSources(item.evidence, ["units", index, "evidence"]));
  document.units.forEach((item, index) => {
    if (item.linked_crm_account_id && (item.linked_crm_account_id !== document.account_id || item.kind !== "company")) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["units", index, "linked_crm_account_id"],
        message: "Seule une unité de type société peut représenter le compte CRM du lot." });
    }
  });
  document.people.forEach((item, index) => {
    checkSources(item.identity_evidence, ["people", index, "identity_evidence"]);
    item.affiliations.forEach((affiliation, affIndex) => {
      checkRef(affiliation.unit_ref, ["people", index, "affiliations", affIndex, "unit_ref"]);
      checkSources(affiliation.evidence, ["people", index, "affiliations", affIndex, "evidence"]);
    });
  });
  document.role_slots.forEach((item, index) => checkSources(item.evidence, ["role_slots", index, "evidence"]));
  document.relations.forEach((item, index) => {
    checkRef(item.from_ref, ["relations", index, "from_ref"]);
    checkRef(item.to_ref, ["relations", index, "to_ref"]);
    checkSources(item.evidence, ["relations", index, "evidence"]);
  });
  document.opportunity_roles.forEach((item, index) => {
    checkRef(item.person_ref, ["opportunity_roles", index, "person_ref"]);
    checkSources(item.evidence, ["opportunity_roles", index, "evidence"]);
  });
  document.power_claims.forEach((item, index) => {
    checkRef(item.person_ref, ["power_claims", index, "person_ref"]);
    checkSources(item.evidence, ["power_claims", index, "evidence"]);
  });
  document.claims.forEach((item, index) => {
    checkRef(item.subject_ref, ["claims", index, "subject_ref"]);
    checkSources(item.evidence, ["claims", index, "evidence"]);
  });
  document.hypotheses.forEach((item, index) => {
    checkRef(item.subject_ref, ["hypotheses", index, "subject_ref"]);
    item.source_ids.forEach((sourceId, sourceIndex) => {
      if (!sourceIds.has(sourceId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["hypotheses", index, "source_ids", sourceIndex], message: "Source absente du lot." });
    });
  });
  document.open_questions.forEach((item, index) => {
    if (item.subject_ref) checkRef(item.subject_ref, ["open_questions", index, "subject_ref"]);
  });
  document.warnings.forEach((item, index) => {
    if (item.source_id && !sourceIds.has(item.source_id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["warnings", index, "source_id"], message: "Source absente du lot." });
  });
});

export type AccountMapImportDocument = z.infer<typeof accountMapImportSchema>;

export const accountMapImportApplySchema = z.object({
  document: accountMapImportSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  acceptedIds: z.array(text(240)).max(3_000),
  contactResolutions: z.record(tempId, id).default({})
}).strict();

export type AccountMapImportApply = z.infer<typeof accountMapImportApplySchema>;
