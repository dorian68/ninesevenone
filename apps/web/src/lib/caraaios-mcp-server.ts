import "server-only";

import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod4";

import { createAccountMapOpportunity, getAccountMap } from "@/lib/account-map-db";
import {
  getCaraaiosCompany, getCaraaiosCompanyMap, getCaraaiosContact,
  isValidCaraaiosDomain, resolveCaraaiosCompany, searchCaraaiosCompanies,
  searchCaraaiosContacts, upsertCaraaiosCompany
} from "@/lib/caraaios-mcp-crm";
import { getCompanyIcps, upsertCompanyIcp } from "@/lib/caraaios-mcp-icp";
import { caraaiosImportPersonSchema, importCaraaiosCompanyMap } from "@/lib/caraaios-mcp-import";
import { addCaraaiosCompanyResearch, CARAAIOS_SOURCE_TYPES, recordCaraaiosMcpAudit } from "@/lib/caraaios-mcp-research";
import { getProspect, listIcps } from "@/lib/prospect-factory-crm-db";
import { COMPANY_SIGNAL_FILE_TYPES, companySignalFieldsSchema } from "@/lib/company-signal-contract";
import {
  addCompanySignalAttachment, decodeSignalAttachmentBase64, getCompanySignalAttachment,
  listCompanySignals, upsertCompanySignal
} from "@/lib/company-signals";
import { outreachDraftFieldsSchema } from "@/lib/outreach-draft-contract";
import { getOutreachContext, listOutreachDrafts, upsertOutreachDraft } from "@/lib/outreach-drafts";

const uuid = z.uuid();
const shortText = (max: number) => z.string().trim().min(1).max(max);
const evidenceType = z.enum(["observed", "verified", "declared", "inferred", "unknown"]);
const companyIdentity = z.object({
  name: shortText(500).describe("Company name as observed."),
  domain: shortText(253).optional().describe("Company website hostname, e.g. kactus.com."),
  linkedin_url: z.url().optional(),
  country: shortText(100).optional(),
  territory: shortText(200).optional()
}).strict();
const source = z.object({
  source_type: z.enum(CARAAIOS_SOURCE_TYPES),
  source_reference: shortText(2_048).describe("URL, filename or human source reference; e.g. PROSPECTION_KACTUS.mp4."),
  observed_at: z.iso.datetime({ offset: true }).optional()
}).strict();
const person = z.object({
  name: shortText(2_000), first_name: shortText(500).optional(), last_name: shortText(500).optional(),
  title_raw: shortText(1_000).optional(), title_normalized: shortText(1_000).optional(),
  department: shortText(500).optional(), team: shortText(500).optional(), seniority: shortText(500).optional(),
  linkedin_url: z.url().optional(), professional_email: z.email().optional(), location: shortText(500).optional(),
  employment_status: z.enum(["current_employee", "former_employee", "board", "investor", "advisor", "external", "homonym", "uncertain"]).optional(),
  evidence_type: evidenceType.describe("Proof for identity and observed title, independently of buying-role inference."),
  employment_evidence_type: evidenceType.optional(), notes: shortText(9_994).optional(),
  notes_evidence_type: evidenceType.optional(), contact_id: uuid.optional(),
  evidence: z.object({ locator: shortText(2_000).optional(), excerpt: shortText(5_000).optional(),
    justification: shortText(5_000).optional(), verification_question: shortText(2_000).optional() }).strict().optional()
}).strict();

type ToolValue = Record<string, unknown>;
function ok(value: ToolValue) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value };
}
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Erreur CRM inconnue.";
  const candidates = error && typeof error === "object" && "candidates" in error
    ? (error as { candidates?: string[] }).candidates : undefined;
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message, candidates }) }], isError: true };
}
function audit(tool: string, entityId: string | null, outcome: "created" | "updated" | "unchanged" | "partial",
  details: Record<string, number | string | boolean | null> = {}) {
  try { recordCaraaiosMcpAudit(tool, entityId, outcome, details); return true; }
  catch (error) {
    console.error("Caraaios MCP audit write failed", error instanceof Error ? error.name : "UnknownError");
    return false;
  }
}

function projectNewCompanyImport(people: unknown[]) {
  const projected = people.map((raw, index) => {
    const parsed = caraaiosImportPersonSchema.safeParse(raw);
    if (!parsed.success) return { index, name: "Ligne " + (index + 1), status: "error",
      reason: parsed.error.issues.map((issue) => issue.message).join("; ") };
    if (["unknown", "inferred"].includes(parsed.data.evidence_type)) return { index, name: parsed.data.name,
      status: "conflict", reason: "Identité sans preuve observée." };
    return { index, name: parsed.data.name, status: "would_create" };
  });
  const seen = new Map<string, number[]>();
  people.forEach((raw, index) => {
    const parsed = caraaiosImportPersonSchema.safeParse(raw);
    if (!parsed.success) return;
    const person = parsed.data;
    const keys = [person.linkedin_url?.trim().toLowerCase(), person.professional_email?.trim().toLowerCase()]
      .filter((value): value is string => Boolean(value));
    if (!keys.length) keys.push(`name:${person.name.normalize("NFKD").toLowerCase().trim()}`);
    for (const key of keys) seen.set(key, [...(seen.get(key) ?? []), index]);
  });
  for (const indexes of seen.values()) if (indexes.length > 1) for (const index of indexes) {
    if (projected[index].status === "would_create") {
      projected[index] = { ...projected[index], status: "conflict",
        reason: "Doublon probable dans le même import ; vérifier l'identité." };
    }
  }
  return {
    people: projected,
    summary: { created: 0, updated: 0, unchanged: 0,
      conflicts: projected.filter((item) => item.status === "conflict").length,
      errors: projected.filter((item) => item.status === "error").length,
      would_create: projected.filter((item) => item.status === "would_create").length, would_update: 0 }
  };
}

/** Fresh server per HTTP request; CRM state remains solely in the existing SQLite services. */
export function createCaraaiosMcpServer(): McpServer {
  const server = new McpServer({ name: "caraaios-crm", version: "1.0.0" });
  const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const upsert = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

  server.registerTool("crm_search_companies", {
    description: "Search existing CRM companies before creating one. Returns concise IDs, names and contact counts.",
    annotations: read,
    inputSchema: z.object({ query: shortText(200), limit: z.number().int().min(1).max(50).optional() }).strict().shape
  }, async ({ query, limit }) => {
    try { return ok(searchCaraaiosCompanies(query, limit) as ToolValue); } catch (error) { return failure(error); }
  });

  server.registerTool("crm_get_company", {
    description: "Read a CRM company, qualification and research summary by company_id.", annotations: read,
    inputSchema: z.object({ company_id: uuid }).strict().shape
  }, async ({ company_id }) => {
    try { return ok({ company: getCaraaiosCompany(company_id) }); } catch (error) { return failure(error); }
  });

  server.registerTool("crm_get_company_map", {
    description: "Read the existing CRM organigram with people, sourced observations, relations, buying committee, multiple ICPs, notes and the 50 most recent company signals. Use after an import to verify persistence; page through all signals with crm_get_company_signals.",
    // getAccountMap synchronizes missing contact nodes in the shared CRM map.
    annotations: upsert,
    inputSchema: z.object({ company_id: uuid, include_people: z.boolean().optional(), include_relationships: z.boolean().optional(),
      include_evidence: z.boolean().optional(), include_research: z.boolean().optional(),
      include_buying_committee: z.boolean().optional(), include_signals: z.boolean().optional() }).strict().shape
  }, async ({ company_id, ...options }) => {
    try { return ok({ map: getCaraaiosCompanyMap(company_id, options) }); } catch (error) { return failure(error); }
  });

  server.registerTool("crm_search_contacts", {
    description: "Search contact identity, title or professional email; optionally restrict to a company. Use before creating a contact.",
    annotations: read,
    inputSchema: z.object({ query: shortText(200), company_id: uuid.optional(), limit: z.number().int().min(1).max(100).optional() }).strict().shape
  }, async ({ query, company_id, limit }) => {
    try { return ok({ contacts: searchCaraaiosContacts(query, company_id, limit) }); } catch (error) { return failure(error); }
  });

  server.registerTool("crm_get_contact", {
    description: "Read one contact and its CRM company by stable contact_id.", annotations: read,
    inputSchema: z.object({ contact_id: uuid, company_id: uuid.optional() }).strict().shape
  }, async ({ contact_id, company_id }) => {
    try { return ok({ result: getCaraaiosContact(contact_id, company_id) }); } catch (error) { return failure(error); }
  });

  server.registerTool("crm_upsert_company", {
    description: "Resolve an existing CRM company by ID, exact name, domain or LinkedIn; create only when no unambiguous match exists. Existing commercial data is preserved.",
    annotations: upsert,
    inputSchema: companyIdentity.extend({ company_id: uuid.optional() }).strict().shape
  }, async (identity) => {
    try {
      if (identity.domain && !isValidCaraaiosDomain(identity.domain)) throw new Error("Domaine de société invalide.");
      const result = upsertCaraaiosCompany(identity);
      const auditRecorded = audit("crm_upsert_company", result.company.id,
        result.created ? "created" : result.updated ? "updated" : "unchanged");
      return ok({ company_id: result.company.id, name: result.company.snapshot.companyName,
        created: result.created, updated: result.updated, audit_recorded: auditRecorded });
    } catch (error) { return failure(error); }
  });

  server.registerTool("crm_upsert_contact", {
    description: "Create or enrich one contact through the same audited map import as the CRM UI. Match by LinkedIn/email or explicit contact_id; ambiguous names need review. Never promote an inferred identity to fact.",
    annotations: upsert,
    inputSchema: z.object({ company_id: uuid, source, person,
      dry_run: z.boolean().optional(), idempotency_key: shortText(240).optional() }).strict().shape
  }, async ({ company_id, source: inputSource, person: inputPerson, dry_run, idempotency_key }) => {
    try {
      const result = importCaraaiosCompanyMap({ company_id, source: inputSource, people: [inputPerson], dry_run, idempotency_key }, "caraaios-mcp");
      if (!dry_run && !audit("crm_upsert_contact", company_id, result.summary.created ? "created" : result.summary.updated ? "updated" :
        result.summary.errors || result.summary.conflicts ? "partial" : "unchanged", result.summary)) {
        result.warnings.push("Écriture réussie mais audit MCP non enregistré ; vérifier le journal serveur.");
      }
      return ok(result as unknown as ToolValue);
    } catch (error) { return failure(error); }
  });

  server.registerTool("crm_import_company_map", {
    description: "Primary bulk operation for a video or research batch (up to 500 people in one call, internally chunked). Creates real CRM contacts and map nodes, sources, relationships, buying roles and hypotheses. Each row is validated independently; ambiguous identities are conflicts. Use dry_run first for large imports. Person evidence_type and buying role evidence_type are separate; inferred relations never become facts. company_id or company identity is required.",
    annotations: upsert,
    inputSchema: z.object({
      company_id: uuid.optional(), company: companyIdentity.optional(), source,
      people: z.array(z.unknown().describe("Each person: {name, title_raw?, title_normalized?, department?, team?, seniority?, linkedin_url?, professional_email?, location?, notes?, employment_status?, evidence_type, employment_evidence_type?, evidence?: {locator?, excerpt?, justification?, verification_question?}}. employment_status: current_employee|former_employee|board|investor|advisor|external|homonym|uncertain. evidence_type: observed|verified|declared|inferred|unknown. A malformed row returns its own error; observed/verified/declared identity is required to create a contact."))
        .min(1).max(500).describe("Malformed individual rows are reported without losing the rest of the batch."),
      relationships: z.array(z.unknown()).max(1_000).optional().describe("Each item: {from_person_index, to_person_index, kind, evidence_type, notes?, justification?, verification_question?}. kind: reports_to|manages|same_team|works_with|owns_process|influences|unknown|functional_reports_to|can_introduce|advises. Inferred links stay hypotheses."),
      buying_committee: z.array(z.unknown()).max(1_000).optional().describe("Each item: {person_index, opportunity_id, role, evidence_type, justification?, verification_question?}. Create/reuse the opportunity first. role: potential_user|potential_champion|champion|potential_sponsor|sponsor|economic_buyer|decision_maker|technical_influencer|security_it|blocker|unknown. Keep evidence_type independent of the person's title proof."),
      hypotheses: z.array(z.unknown()).max(1_000).optional().describe("Each item: {person_index?, proposition, justification, verification_question}. A missing person_index targets the company."),
      dry_run: z.boolean().optional(), idempotency_key: shortText(240).optional()
    }).strict().shape
  }, async ({ company_id, company, source: inputSource, people, relationships, buying_committee, hypotheses, dry_run, idempotency_key }) => {
    try {
      if (!company_id && !company) throw new Error("company_id ou company est requis pour l'import.");
      if (company?.domain && !isValidCaraaiosDomain(company.domain)) throw new Error("Domaine de société invalide.");
      const existing = company_id ? getProspect(company_id) : company ? resolveCaraaiosCompany(company) : null;
      if (company_id && !existing) throw new Error("company_id introuvable dans le CRM.");
      if (company_id && company) resolveCaraaiosCompany({ ...company, company_id });
      if (dry_run && !existing) {
        const projected = projectNewCompanyImport(people);
        return ok({ company_action: "would_create", dry_run: true, company,
          summary: projected.summary, people: projected.people,
          warning: "Les rapprochements et liens seront vérifiés après création de la société." });
      }
      if (!existing && !company) throw new Error("Société à créer absente.");
      if (!existing && projectNewCompanyImport(people).summary.would_create === 0) {
        throw new Error("Aucune personne valide à importer ; société non créée.");
      }
      const resolved = existing ?? upsertCaraaiosCompany(company!).company;
      const result = importCaraaiosCompanyMap({ company_id: resolved.id, source: inputSource, people,
        relationships, buying_committee, hypotheses, dry_run, idempotency_key }, "caraaios-mcp");
      const partial = result.summary.errors || result.summary.conflicts || result.relationship_errors.length
        || result.buying_committee_errors.length || result.hypothesis_errors.length || result.warnings.length;
      if (!dry_run && !audit("crm_import_company_map", resolved.id,
        partial ? "partial" : result.summary.created ? "created" : result.summary.updated ? "updated" : "unchanged",
        { ...result.summary, batches: result.import_batch_ids.length })) {
        result.warnings.push("Écriture réussie mais audit MCP non enregistré ; vérifier le journal serveur.");
      }
      return ok(result as unknown as ToolValue);
    } catch (error) { return failure(error); }
  });

  server.registerTool("crm_get_company_icps", {
    description: "List every ICP assessment for one company and the available ICP catalogue IDs, including historical single-segment classification and sourced assessment history.",
    annotations: read, inputSchema: z.object({ company_id: uuid }).strict().shape
  }, async ({ company_id }) => {
    try { return ok({ context: getCompanyIcps(company_id), available_icps: listIcps() }); } catch (error) { return failure(error); }
  });

  server.registerTool("crm_upsert_opportunity", {
    description: "Create or reuse a named company-map opportunity/context (for an ICP, campaign or use case). Use its returned opportunity_id for buying_committee entries. It appears in the existing CRM map.",
    annotations: upsert,
    inputSchema: z.object({ company_id: uuid, name: shortText(240), description: z.string().max(10_000).optional() }).strict().shape
  }, async ({ company_id, name, description }) => {
    try {
      const map = getAccountMap(company_id);
      if (!map) throw new Error("Société introuvable.");
      const existing = map.opportunities.filter((item) => item.name.trim().toLocaleLowerCase("fr") === name.trim().toLocaleLowerCase("fr"));
      if (existing.length > 1) throw new Error("Plusieurs contextes portent ce nom ; choisir un nom plus précis.");
      if (existing.length) {
        const auditRecorded = audit("crm_upsert_opportunity", company_id, "unchanged");
        return ok({ opportunity_id: existing[0].id, created: false, opportunity: existing[0], audit_recorded: auditRecorded });
      }
      const opportunity = createAccountMapOpportunity(company_id, { name, description });
      const auditRecorded = audit("crm_upsert_opportunity", company_id, "created");
      return ok({ opportunity_id: opportunity.id, created: true, opportunity, audit_recorded: auditRecorded });
    } catch (error) { return failure(error); }
  });

  server.registerTool("crm_upsert_company_icp", {
    description: "Assess one company against one existing ICP. candidate/investigating can be inferred; qualified/disqualified need observed, verified or declared evidence. Several ICPs may coexist.",
    annotations: upsert,
    inputSchema: z.object({ company_id: uuid, icp_id: uuid,
      status: z.enum(["candidate", "investigating", "qualified", "disqualified", "unknown"]).optional(),
      evidence_type: evidenceType.optional(), source_type: z.enum([...CARAAIOS_SOURCE_TYPES, "crm_ui", "unknown"]).optional(),
      source_reference: shortText(2_048).optional(), observed_at: z.iso.datetime({ offset: true }).optional(),
      notes: z.string().max(10_000).optional() }).strict().shape
  }, async ({ company_id, icp_id, status, evidence_type, source_type, source_reference, observed_at, notes }) => {
    try {
      const previous = getCompanyIcps(company_id)?.associations.find((item) => item.icpId === icp_id);
      const association = upsertCompanyIcp(company_id, { icpId: icp_id, status, evidenceType: evidence_type,
        sourceType: source_type, sourceReference: source_reference, observedAt: observed_at, notes });
      const auditRecorded = audit("crm_upsert_company_icp", company_id, !previous || previous.origin === "legacy_segment" ? "created" :
        previous.version === association.version ? "unchanged" : "updated", { icp_id });
      return ok({ association, audit_recorded: auditRecorded });
    } catch (error) { return failure(error); }
  });

  server.registerTool("crm_add_company_research", {
    description: "Save a sourced company fact, hypothesis, declared pain, confirmed use case or note in the existing map/activity model. Hypotheses remain hypotheses and require a verification question.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: z.object({ company_id: uuid,
      kind: z.enum(["observed_fact", "hypothesis", "declared_pain", "confirmed_use_case", "note"]),
      statement: shortText(10_000), evidence_type: evidenceType,
      source: z.object({ source_type: z.enum(CARAAIOS_SOURCE_TYPES), source_reference: shortText(2_048).optional(),
        observed_at: z.iso.datetime({ offset: true }).optional(), excerpt: shortText(4_000).optional() }).strict().optional(),
      raw_value: shortText(5_000).optional(), normalized_value: shortText(5_000).optional(),
      justification: shortText(5_000).optional(), verification_question: shortText(2_000).optional(),
      idempotency_key: shortText(240).optional() }).strict().shape
  }, async (input) => {
    try {
      const result = addCaraaiosCompanyResearch(input);
      const auditRecorded = audit("crm_add_company_research", input.company_id, result.created ? "created" : "unchanged",
        { kind: input.kind });
      return ok({ ...result, audit_recorded: auditRecorded } as unknown as ToolValue);
    } catch (error) { return failure(error); }
  });

  server.registerTool("crm_get_company_signals", {
    description: "List a company's editable fit/timing signals, source links, observed facts, separate commercial interpretations and attachment metadata. Returns at most 100 per page; file bytes are fetched only on request.",
    annotations: read,
    inputSchema: z.object({ company_id: uuid, limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).max(100_000).optional(), include_archived: z.boolean().optional() }).strict().shape
  }, async ({ company_id, limit, offset, include_archived }) => {
    try { return ok({ signals: listCompanySignals(company_id, { limit, offset, includeArchived: include_archived }) }); }
    catch (error) { return failure(error); }
  });

  server.registerTool("crm_upsert_company_signal", {
    description: "Create or edit one sourced company readiness signal (article, job posting or other). The description records source content; interpretation is a separate hypothesis. For creation provide a stable idempotency_key. For an edit provide signal_id and expected_version from the last read; conflicts never overwrite another change. Archiving is reversible.",
    annotations: upsert,
    inputSchema: z.object({ company_id: uuid, signal_id: uuid.optional(),
      expected_version: z.number().int().min(1).optional(), idempotency_key: shortText(240).optional(),
      signal: companySignalFieldsSchema }).strict().shape
  }, async ({ company_id, signal_id, expected_version, idempotency_key, signal }) => {
    try {
      const result = upsertCompanySignal(company_id, { signal_id, expected_version, idempotency_key, signal }, "caraaios-mcp");
      const auditRecorded = audit("crm_upsert_company_signal", result.signal.id, result.outcome, { company_id });
      return ok({ ...result, audit_recorded: auditRecorded } as unknown as ToolValue);
    } catch (error) { return failure(error); }
  });

  server.registerTool("crm_add_company_signal_attachment", {
    description: "Attach one original PDF, PNG, JPEG or WebP (10 MB maximum) to an existing company signal. Repeating identical file bytes is idempotent. Keep source text and URLs in the signal for efficient strategy reads; use this only for the original supporting file.",
    annotations: upsert,
    inputSchema: z.object({ company_id: uuid, signal_id: uuid, file_name: shortText(255),
      mime_type: z.enum(COMPANY_SIGNAL_FILE_TYPES), content_base64: z.string().min(1).max(14_000_000) }).strict().shape
  }, async ({ company_id, signal_id, file_name, mime_type, content_base64 }) => {
    try {
      const result = addCompanySignalAttachment(company_id, signal_id,
        { fileName: file_name, mimeType: mime_type, bytes: decodeSignalAttachmentBase64(content_base64) }, "caraaios-mcp");
      const auditRecorded = audit("crm_add_company_signal_attachment", signal_id,
        result.created ? "created" : "unchanged", { company_id, attachment_id: result.attachment.id });
      return ok({ ...result, audit_recorded: auditRecorded } as unknown as ToolValue);
    } catch (error) { return failure(error); }
  });

  server.registerTool("crm_get_company_signal_attachment", {
    description: "Fetch one signal's original attachment by ID. Images are returned as MCP image content for visual analysis; PDFs are returned as Base64. Call only when the original file is needed; crm_get_company_signals already returns metadata without large binary content.",
    annotations: read,
    inputSchema: z.object({ company_id: uuid, signal_id: uuid, attachment_id: uuid }).strict().shape
  }, async ({ company_id, signal_id, attachment_id }) => {
    try {
      const result = getCompanySignalAttachment(company_id, signal_id, attachment_id);
      if (!result) throw new Error("Pièce jointe introuvable dans ce signal.");
      if (result.attachment.mime_type.startsWith("image/")) {
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ attachment: result.attachment }) },
            { type: "image" as const, mimeType: result.attachment.mime_type, data: result.bytes.toString("base64") }
          ],
          structuredContent: { attachment: result.attachment }
        };
      }
      return ok({ attachment: result.attachment, content_base64: result.bytes.toString("base64") });
    } catch (error) { return failure(error); }
  });

  server.registerTool("crm_get_outreach_context", {
    description: "Read a compact, person-specific copywriting context for one existing CRM contact: company research, ICP status, selected persona, relevant organization links and buying roles, sourced fit/timing signals, observations and existing drafts. Use this before drafting an approach. No message is generated or sent. Reading may synchronize the person's missing map node, like crm_get_company_map.",
    annotations: upsert,
    inputSchema: z.object({ company_id: uuid, contact_id: uuid, icp_id: uuid.optional(),
      persona_id: uuid.optional(), opportunity_id: uuid.optional(),
      signal_limit: z.number().int().min(1).max(50).optional() }).strict().shape
  }, async ({ company_id, contact_id, icp_id, persona_id, opportunity_id, signal_limit }) => {
    try { return ok({ context: getOutreachContext(company_id, contact_id, {
      icpId: icp_id, personaId: persona_id, opportunityId: opportunity_id, signalLimit: signal_limit
    }) as unknown as ToolValue }); }
    catch (error) { return failure(error); }
  });

  server.registerTool("crm_list_outreach_drafts", {
    description: "List stored outreach drafts for a company, optionally restricted to one contact. Each draft retains the selected ICP, persona, channel, status, source signal references and version. Drafts are neither generated nor sent by this tool.",
    annotations: read,
    inputSchema: z.object({ company_id: uuid, contact_id: uuid.optional(),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).max(100_000).optional(),
      include_archived: z.boolean().optional() }).strict().shape
  }, async ({ company_id, contact_id, limit, offset, include_archived }) => {
    try { return ok({ drafts: listOutreachDrafts(company_id, {
      contactId: contact_id, limit, offset, includeArchived: include_archived
    }) }); } catch (error) { return failure(error); }
  });

  server.registerTool("crm_upsert_outreach_draft", {
    description: "Persist a human/ChatGPT/Codex-written outreach draft for ONE existing CRM contact, in a selected ICP/persona/use-case context. Requires the full draft including body and can cite up to 25 company signal IDs. Use a stable idempotency_key on creation; on edit provide draft_id and expected_version so concurrent changes cannot be lost. Never claim an inferred pain as fact. Status ready means ready to review, not sent. This tool does not generate or send messages.",
    annotations: upsert,
    inputSchema: z.object({ company_id: uuid, draft_id: uuid.optional(),
      expected_version: z.number().int().min(1).optional(),
      idempotency_key: shortText(240).optional(),
      draft: outreachDraftFieldsSchema }).strict().shape
  }, async ({ company_id, draft_id, expected_version, idempotency_key, draft }) => {
    try {
      const result = upsertOutreachDraft(company_id,
        { draft_id, expected_version, idempotency_key, draft }, "caraaios-mcp");
      const auditRecorded = audit("crm_upsert_outreach_draft", result.draft.id, result.outcome,
        { company_id, contact_id: result.draft.contact_id });
      return ok({ ...result, audit_recorded: auditRecorded } as unknown as ToolValue);
    } catch (error) { return failure(error); }
  });

  return server;
}
