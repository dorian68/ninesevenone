import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import { accountMapImportSchema, type AccountMapImportDocument } from "./account-map-import-contract";
import { applyAccountMapImport, previewAccountMapImport } from "./account-map-import";
import { getProspect, listProspectContacts, withAccountMapDatabase } from "./prospect-factory-crm-db";
import type { ProspectContact } from "./prospect-factory-crm-contract";

const uuid = z.string().uuid();
const text = (maximum: number) => z.string().trim().min(1).max(maximum);
const optionalText = (maximum: number) => text(maximum).optional();
const httpUrl = z.string().url().max(2_048).refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" || url.protocol === "http:";
});
const evidenceType = z.enum(["observed", "verified", "declared", "inferred", "unknown"]);
const employmentStatus = z.enum([
  "current_employee", "former_employee", "board", "investor", "advisor", "external", "homonym", "uncertain"
]);
const sourceType = z.enum([
  "linkedin_video", "linkedin_profile", "company_website", "press", "job_posting",
  "user_manual", "chatgpt_research", "codex_research", "other"
]);

export const caraaiosImportPersonSchema = z.object({
  name: text(2_000),
  first_name: optionalText(500),
  last_name: optionalText(500),
  title_raw: optionalText(1_000),
  title_normalized: optionalText(1_000),
  department: optionalText(500),
  team: optionalText(500),
  seniority: optionalText(500),
  linkedin_url: httpUrl.refine((value) => {
    const host = new URL(value).hostname.toLowerCase();
    return host === "linkedin.com" || host === "www.linkedin.com";
  }).optional(),
  professional_email: z.string().trim().email().max(500).optional(),
  location: optionalText(500),
  employment_status: employmentStatus.default("uncertain"),
  evidence_type: evidenceType.default("unknown"),
  employment_evidence_type: evidenceType.optional(),
  notes: optionalText(10_000),
  notes_evidence_type: evidenceType.optional(),
  contact_id: uuid.optional(),
  evidence: z.object({
    locator: optionalText(2_000),
    excerpt: optionalText(5_000),
    justification: optionalText(5_000),
    verification_question: optionalText(2_000)
  }).strict().optional()
}).strict();

export const caraaiosImportRelationshipSchema = z.object({
  from_person_index: z.number().int().nonnegative(),
  to_person_index: z.number().int().nonnegative(),
  kind: z.enum([
    "reports_to", "manages", "same_team", "works_with", "owns_process",
    "influences", "unknown", "functional_reports_to", "can_introduce", "advises"
  ]),
  evidence_type: evidenceType.default("unknown"),
  notes: optionalText(10_000),
  justification: optionalText(5_000),
  verification_question: optionalText(2_000)
}).strict();

export const caraaiosImportBuyingRoleSchema = z.object({
  person_index: z.number().int().nonnegative(),
  opportunity_id: uuid,
  role: z.enum([
    "potential_user", "potential_champion", "champion", "potential_sponsor", "sponsor",
    "economic_buyer", "decision_maker", "technical_influencer", "security_it", "blocker", "unknown"
  ]),
  evidence_type: evidenceType.default("unknown"),
  justification: optionalText(5_000),
  verification_question: optionalText(2_000)
}).strict();

export const caraaiosImportHypothesisSchema = z.object({
  person_index: z.number().int().nonnegative().optional(),
  proposition: text(5_000),
  justification: text(5_000),
  verification_question: text(2_000)
}).strict();

/**
 * The envelope accepts unknown rows intentionally: a malformed person must be
 * reported by index without discarding the other 129 people in the same call.
 * Each row is validated with the exported strict schemas above.
 */
export const caraaiosCompanyMapImportSchema = z.object({
  company_id: uuid,
  source: z.object({
    source_type: sourceType,
    source_reference: text(2_048),
    observed_at: z.string().datetime({ offset: true }).optional()
  }).strict(),
  people: z.array(z.unknown()).min(1).max(500),
  relationships: z.array(z.unknown()).max(1_000).default([]),
  buying_committee: z.array(z.unknown()).max(1_000).default([]),
  hypotheses: z.array(z.unknown()).max(1_000).default([]),
  dry_run: z.boolean().default(false),
  idempotency_key: optionalText(240)
}).strict();

export type CaraaiosCompanyMapImportInput = z.infer<typeof caraaiosCompanyMapImportSchema>;
type Person = z.infer<typeof caraaiosImportPersonSchema>;
type Relationship = z.infer<typeof caraaiosImportRelationshipSchema>;
type BuyingRole = z.infer<typeof caraaiosImportBuyingRoleSchema>;
type Hypothesis = z.infer<typeof caraaiosImportHypothesisSchema>;
type Evidence = AccountMapImportDocument["people"][number]["identity_evidence"];

type ItemStatus = "created" | "updated" | "unchanged" | "conflict" | "error" | "would_create" | "would_update";
export type CaraaiosImportItem = {
  index: number;
  name: string;
  status: ItemStatus;
  contact_id?: string;
  reason?: string;
};
export type CaraaiosImportIssue = { index: number; reason: string };
export type CaraaiosCompanyMapImportResult = {
  company_id: string;
  import_batch_ids: string[];
  dry_run: boolean;
  summary: {
    created: number; updated: number; unchanged: number; conflicts: number; errors: number;
    would_create: number; would_update: number; organization_errors: number;
  };
  people: CaraaiosImportItem[];
  relationship_errors: CaraaiosImportIssue[];
  buying_committee_errors: CaraaiosImportIssue[];
  hypothesis_errors: CaraaiosImportIssue[];
  warnings: string[];
};

type ValidPerson = { index: number; person: Person; contactId: string | null; importedBefore?: boolean };
// Each person can generate up to eight research claims. Keep each document
// below the shared account-map contract's 1,000-claim limit.
const CHUNK_SIZE = 100;
const ORGANIZATION_CHUNK_SIZE = 250;

function stableUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex");
  return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-4" + hex.slice(13, 16)
    + "-8" + hex.slice(17, 20) + "-" + hex.slice(20, 32);
}

function normalizeName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeLinkedin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["linkedin.com", "www.linkedin.com"].includes(url.hostname.toLowerCase())) return null;
    return "https://www.linkedin.com" + url.pathname.replace(/\/+$/, "").toLowerCase();
  } catch { return null; }
}

function normalizeEmail(value: string | null | undefined): string | null {
  return value?.trim().toLowerCase() || null;
}

function mapEvidenceType(value: z.infer<typeof evidenceType>): Evidence["status"] {
  return value === "inferred" || value === "unknown" ? "hypothesis" : "observed";
}

function evidence(value: z.infer<typeof evidenceType>, sourceId: string, locator: string,
  options: { excerpt?: string; justification?: string; verificationQuestion?: string; observedAt?: string } = {}): Evidence {
  const status = mapEvidenceType(value);
  return {
    status,
    evidence_type: value,
    source_ids: [sourceId],
    locator,
    ...(options.excerpt ? { excerpt: options.excerpt } : {}),
    ...(options.observedAt ? { information_date: options.observedAt } : {}),
    ...(status === "hypothesis" ? {
      justification: options.justification || "Proposition non vérifiée, conservée comme hypothèse.",
      verification_question: options.verificationQuestion || "Quelle source indépendante confirme cette proposition ?"
    } : {})
  };
}

function mapSourceKind(value: z.infer<typeof sourceType>): AccountMapImportDocument["sources"][number]["kind"] {
  if (value === "linkedin_profile" || value === "company_website" || value === "press" || value === "job_posting") return "web_page";
  if (value === "linkedin_video") return "document";
  if (value === "user_manual") return "meeting_note";
  return "other";
}

function sourceLabel(input: CaraaiosCompanyMapImportInput): string {
  return (input.source.source_type + ": " + input.source.source_reference).slice(0, 500);
}

function sourceCollectedAt(input: CaraaiosCompanyMapImportInput): string {
  if (input.source.observed_at) return input.source.observed_at;
  const existing = withAccountMapDatabase((db) => db.prepare(
    "SELECT collected_at FROM prospect_factory_map_sources WHERE prospect_id=? AND label=? AND collected_at IS NOT NULL ORDER BY created_at LIMIT 1"
  ).get(input.company_id, sourceLabel(input)) as { collected_at: string } | undefined);
  return existing?.collected_at ?? new Date().toISOString();
}

function sourceRecord(input: CaraaiosCompanyMapImportInput, sourceId: string, collectedAt: string): AccountMapImportDocument["sources"][number] {
  let url: string | undefined;
  try {
    const parsed = new URL(input.source.source_reference);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") url = parsed.href;
  } catch { /* A filename is still retained in the source label and evidence locator. */ }
  return {
    source_id: sourceId, kind: mapSourceKind(input.source.source_type),
    label: sourceLabel(input), reference: input.source.source_reference, collected_at: collectedAt,
    ...(url ? { url } : {})
  };
}

function claim(subjectRef: string, field: AccountMapImportDocument["claims"][number]["field"],
  value: string, claimEvidence: Evidence): AccountMapImportDocument["claims"][number] {
  return { subject_ref: subjectRef, field, value, evidence: claimEvidence };
}

function personClaims(entry: ValidPerson, sourceId: string, observedAt?: string): AccountMapImportDocument["claims"] {
  const { person, index } = entry;
  const ref = "tmp:person:i" + index;
  const locator = person.evidence?.locator ?? "people[" + index + "] · " + person.name;
  const observed = evidence(person.evidence_type, sourceId, locator, { observedAt, excerpt: person.evidence?.excerpt });
  const inferred = evidence("inferred", sourceId, locator, {
    observedAt, justification: person.evidence?.justification,
    verificationQuestion: person.evidence?.verification_question
  });
  const result: AccountMapImportDocument["claims"] = [];
  if (person.title_raw) result.push(claim(ref, "other", "title_observed: " + person.title_raw, observed));
  const employmentEvidenceType = person.employment_status === "uncertain"
    ? "unknown" : person.employment_evidence_type ?? person.evidence_type;
  result.push(claim(ref, "other", "employment_status: " + person.employment_status,
    evidence(employmentEvidenceType, sourceId, locator, {
      observedAt, excerpt: person.evidence?.excerpt,
      justification: person.evidence?.justification,
      verificationQuestion: person.evidence?.verification_question
    })));
  if (person.title_normalized) result.push(claim(ref, "role_hypothesis", person.title_normalized, inferred));
  for (const key of ["department", "team", "seniority", "location"] as const) {
    if (person[key]) result.push(claim(ref, "other", key + ": " + person[key], inferred));
  }
  if (person.notes) {
    const noteEvidence = evidence(person.notes_evidence_type ?? "inferred", sourceId, locator, {
      observedAt, excerpt: person.evidence?.excerpt,
      justification: person.evidence?.justification,
      verificationQuestion: person.evidence?.verification_question
    });
    result.push(claim(ref, "other", person.notes.length <= 9_994 ? "note: " + person.notes : person.notes,
      noteEvidence));
  }
  return result;
}

function mayAddCurrentAffiliation(accountId: string, contactId: string | null): boolean {
  if (!contactId) return true;
  const existing = withAccountMapDatabase((db) => db.prepare(
    "SELECT relation.evidence_status FROM prospect_factory_map_relations relation " +
    "JOIN prospect_factory_map_nodes person_node ON person_node.id=relation.from_node_id " +
    "JOIN prospect_factory_map_nodes account_node ON account_node.id=relation.to_node_id " +
    "WHERE relation.prospect_id=? AND person_node.contact_id=? AND account_node.is_root=1 " +
    "AND relation.kind='works_in' LIMIT 1"
  ).get(accountId, contactId) as { evidence_status: string } | undefined);
  return !existing || existing.evidence_status === "observed";
}

function makeDocument(input: CaraaiosCompanyMapImportInput, batchId: string, sourceId: string,
  collectedAt: string, people: ValidPerson[]): AccountMapImportDocument {
  const raw = {
    schema_version: "account_map.v1", account_id: input.company_id, opportunity_id: null,
    import_batch_id: batchId, sources: [sourceRecord(input, sourceId, collectedAt)],
    units: [],
    people: people.map(({ index, person, contactId, importedBefore }) => {
      const locator = person.evidence?.locator ?? "people[" + index + "] · " + person.name;
      const identityEvidence = evidence(person.evidence_type, sourceId, locator, {
        observedAt: input.source.observed_at, excerpt: person.evidence?.excerpt
      });
      const employmentEvidenceType = person.employment_evidence_type ?? person.evidence_type;
      const observedCurrentEmployee = person.employment_status === "current_employee"
        && mapEvidenceType(employmentEvidenceType) === "observed"
        && mayAddCurrentAffiliation(input.company_id, contactId);
      return {
        temp_id: "tmp:person:i" + index,
        ...(contactId && !importedBefore ? { crm_contact_id: contactId } : {}),
        display_name_observed: person.name,
        ...(person.first_name ? { first_name: person.first_name } : {}),
        ...(person.last_name ? { last_name: person.last_name } : {}),
        ...(person.title_raw ? { job_title_observed: person.title_raw } : {}),
        ...(person.linkedin_url ? { linkedin_url: person.linkedin_url } : {}),
        ...(person.professional_email ? { email: person.professional_email } : {}),
        ...(person.notes ? { notes: person.notes } : {}),
        identity_evidence: identityEvidence,
        affiliations: observedCurrentEmployee ? [{
          unit_ref: "crm:account:" + input.company_id,
          ...(person.title_raw ? { job_title_observed: person.title_raw } : {}),
          external: false,
          evidence: evidence(employmentEvidenceType, sourceId, locator, {
            observedAt: input.source.observed_at, excerpt: person.evidence?.excerpt
          })
        }] : []
      };
    }),
    role_slots: [], relations: [], opportunity_roles: [], power_claims: [],
    claims: people.flatMap((entry) => personClaims(entry, sourceId, input.source.observed_at)),
    hypotheses: [], open_questions: [], warnings: []
  };
  return accountMapImportSchema.parse(raw);
}

function strongMatches(person: Person, contacts: ProspectContact[]): ProspectContact[] {
  const linkedin = normalizeLinkedin(person.linkedin_url);
  const email = normalizeEmail(person.professional_email);
  return contacts.filter((contact) =>
    Boolean(linkedin && normalizeLinkedin(contact.linkedin) === linkedin)
    || Boolean(email && normalizeEmail(contact.email) === email));
}

function resolvePerson(person: Person, contacts: ProspectContact[]): { contactId: string | null; conflict?: string } {
  const matches = strongMatches(person, contacts);
  if (person.contact_id) {
    const explicit = contacts.find((contact) => contact.id === person.contact_id);
    if (!explicit) return { contactId: null, conflict: "Contact explicite absent de cette société." };
    if (matches.some((contact) => contact.id !== explicit.id)) {
      return { contactId: null, conflict: "L'identifiant explicite contredit LinkedIn ou l'email." };
    }
    return { contactId: explicit.id };
  }
  if (matches.length > 1) return { contactId: null, conflict: "LinkedIn et l'email renvoient à plusieurs contacts." };
  if (matches.length === 1) return { contactId: matches[0].id };
  const byName = contacts.filter((contact) => normalizeName(contact.name) === normalizeName(person.name));
  if (byName.length > 1) {
    return { contactId: null, conflict: "Plusieurs homonymes dans la société : fournir LinkedIn, l'email ou contact_id." };
  }
  if (byName.length === 1) {
    const contact = byName[0];
    if (person.linkedin_url && contact.linkedin
      && normalizeLinkedin(person.linkedin_url) !== normalizeLinkedin(contact.linkedin)
      || person.professional_email && contact.email
      && normalizeEmail(person.professional_email) !== normalizeEmail(contact.email)) {
      return { contactId: null, conflict: "Le nom correspond, mais LinkedIn ou l'email contredit le contact existant." };
    }
    return { contactId: contact.id };
  }
  return { contactId: null };
}

function previouslyImportedContact(accountId: string, batchId: string, index: number): string | null {
  const row = withAccountMapDatabase((db) => db.prepare(
    "SELECT id FROM prospect_factory_contacts WHERE prospect_id=? AND fingerprint=?"
  ).get(accountId, "map-import:" + batchId + ":tmp:person:i" + index) as { id: string } | undefined);
  return row?.id ?? null;
}

function findContact(person: Person, contacts: ProspectContact[], knownId: string | null): ProspectContact | undefined {
  if (knownId) return contacts.find((contact) => contact.id === knownId);
  const strong = strongMatches(person, contacts);
  if (strong.length === 1) return strong[0];
  const byName = contacts.filter((contact) => normalizeName(contact.name) === normalizeName(person.name));
  return byName.length === 1 ? byName[0] : undefined;
}

function appendSummary(result: CaraaiosCompanyMapImportResult, item: CaraaiosImportItem): void {
  result.people.push(item);
  if (item.status === "created") result.summary.created += 1;
  if (item.status === "updated") result.summary.updated += 1;
  if (item.status === "unchanged") result.summary.unchanged += 1;
  if (item.status === "conflict") result.summary.conflicts += 1;
  if (item.status === "error") result.summary.errors += 1;
  if (item.status === "would_create") result.summary.would_create += 1;
  if (item.status === "would_update") result.summary.would_update += 1;
}

function checkIncomingDuplicates(entries: ValidPerson[]): Map<number, string> {
  const conflicts = new Map<number, string>();
  const linkedin = new Map<string, number[]>();
  const email = new Map<string, number[]>();
  const nameWithoutStrongId = new Map<string, number[]>();
  const allNames = new Map<string, ValidPerson[]>();
  for (const entry of entries) {
    const link = normalizeLinkedin(entry.person.linkedin_url);
    const mail = normalizeEmail(entry.person.professional_email);
    const name = normalizeName(entry.person.name);
    if (link) linkedin.set(link, [...(linkedin.get(link) ?? []), entry.index]);
    if (mail) email.set(mail, [...(email.get(mail) ?? []), entry.index]);
    if (!link && !mail) nameWithoutStrongId.set(name, [...(nameWithoutStrongId.get(name) ?? []), entry.index]);
    allNames.set(name, [...(allNames.get(name) ?? []), entry]);
  }
  for (const grouped of [linkedin, email, nameWithoutStrongId]) {
    for (const indexes of grouped.values()) {
      if (indexes.length > 1) for (const index of indexes) {
        conflicts.set(index, "Plusieurs lignes de l'import désignent possiblement la même personne.");
      }
    }
  }
  for (const sameName of allNames.values()) {
    if (sameName.length < 2) continue;
    for (const entry of sameName) {
      if (!entry.person.linkedin_url && !entry.person.professional_email && !entry.person.contact_id) {
        conflicts.set(entry.index, "Homonyme dans le lot : une URL LinkedIn, un email ou contact_id est nécessaire.");
      }
    }
  }
  return conflicts;
}

function mapRelationshipKind(kind: Relationship["kind"]): AccountMapImportDocument["relations"][number]["kind"] {
  if (kind === "reports_to" || kind === "manages") return "reports_to";
  if (kind === "functional_reports_to") return kind;
  if (kind === "can_introduce" || kind === "advises") return kind;
  return "unqualified";
}

function mapBuyingRole(role: BuyingRole["role"]): AccountMapImportDocument["opportunity_roles"][number]["role"] {
  if (role === "potential_user") return "user";
  if (role === "potential_champion" || role === "champion") return "potential_relay";
  if (role === "economic_buyer") return "economic_decision_maker";
  if (role === "technical_influencer") return "technical_validator";
  if (role === "security_it") return "security_validator";
  if (role === "potential_sponsor" || role === "sponsor" || role === "decision_maker") return "influencer";
  return "unknown";
}

/**
 * Imports into the existing CRM map, using the same preview/apply service as
 * the UI. No SQL write is issued here. Company creation/resolution belongs to
 * the caller; in particular dry_run must never create the company.
 */
export function importCaraaiosCompanyMap(rawInput: unknown, actor: string): CaraaiosCompanyMapImportResult {
  const input = caraaiosCompanyMapImportSchema.parse(rawInput);
  if (typeof actor !== "string" || actor.trim().length < 1 || actor.length > 200) {
    throw new Error("Acteur MCP invalide.");
  }
  if (!getProspect(input.company_id)) throw new Error("Société CRM introuvable. Recherchez ou créez-la avant l'import.");
  const result: CaraaiosCompanyMapImportResult = {
    company_id: input.company_id, import_batch_ids: [], dry_run: input.dry_run,
    summary: { created: 0, updated: 0, unchanged: 0, conflicts: 0, errors: 0,
      would_create: 0, would_update: 0, organization_errors: 0 },
    people: [], relationship_errors: [], buying_committee_errors: [], hypothesis_errors: [], warnings: []
  };
  const existingContacts = listProspectContacts(input.company_id);
  const semanticKey = input.idempotency_key
    ? "key:" + input.idempotency_key
    : "payload:" + createHash("sha256").update(JSON.stringify({
      company_id: input.company_id, source: input.source, people: input.people,
      relationships: input.relationships, buying_committee: input.buying_committee, hypotheses: input.hypotheses
    })).digest("hex");
  const parsedPeople: ValidPerson[] = [];
  input.people.forEach((raw, index) => {
    const parsed = caraaiosImportPersonSchema.safeParse(raw);
    if (!parsed.success) {
      appendSummary(result, { index, name: typeof raw === "object" && raw !== null && "name" in raw
        ? String(raw.name) : "Ligne " + (index + 1), status: "error",
      reason: parsed.error.issues.map((issue) => issue.path.join(".") + ": " + issue.message).join("; ") });
      return;
    }
    if (mapEvidenceType(parsed.data.evidence_type) === "hypothesis") {
      appendSummary(result, { index, name: parsed.data.name, status: "conflict",
        reason: "L'identité est inférée ou inconnue ; aucun contact réel n'est créé sans observation." });
      return;
    }
    parsedPeople.push({ index, person: parsed.data, contactId: null });
  });
  const duplicateConflicts = checkIncomingDuplicates(parsedPeople);
  const safePeople: ValidPerson[] = [];
  for (const entry of parsedPeople) {
    const duplicate = duplicateConflicts.get(entry.index);
    if (duplicate) {
      appendSummary(result, { index: entry.index, name: entry.person.name, status: "conflict", reason: duplicate });
      continue;
    }
    const offset = Math.floor(entry.index / CHUNK_SIZE) * CHUNK_SIZE;
    const previousBatchId = stableUuid(input.company_id + "|" + semanticKey + "|people|" + offset);
    const fallbackBatchId = stableUuid(input.company_id + "|" + semanticKey + "|people|row|" + entry.index);
    const previousId = previouslyImportedContact(input.company_id, previousBatchId, entry.index)
      ?? previouslyImportedContact(input.company_id, fallbackBatchId, entry.index);
    if (previousId) {
      const prior = existingContacts.find((contact) => contact.id === previousId);
      if (!prior || normalizeName(prior.name) !== normalizeName(entry.person.name)) {
        appendSummary(result, { index: entry.index, name: entry.person.name, status: "conflict",
          reason: "La clé d'import a déjà désigné une autre identité." });
      } else {
        safePeople.push({ ...entry, contactId: previousId, importedBefore: true });
      }
      continue;
    }
    const matched = resolvePerson(entry.person, existingContacts);
    if (matched.conflict) {
      appendSummary(result, { index: entry.index, name: entry.person.name, status: "conflict", reason: matched.conflict });
      continue;
    }
    safePeople.push({ ...entry, contactId: matched.contactId });
  }

  const sourceId = "src:mcp:" + createHash("sha256").update(input.company_id + "|" + semanticKey).digest("hex").slice(0, 20);
  const collectedAt = sourceCollectedAt(input);
  const resolved = new Map<number, string>();
  const plannedNew = new Set<number>();

  for (let offset = 0; offset < input.people.length; offset += CHUNK_SIZE) {
    const chunk = safePeople.filter((entry) => entry.index >= offset && entry.index < offset + CHUNK_SIZE);
    if (!chunk.length) continue;
    const batchId = stableUuid(input.company_id + "|" + semanticKey + "|people|" + offset);
    let document: AccountMapImportDocument;
    let preview: ReturnType<typeof previewAccountMapImport>;
    try {
      document = makeDocument(input, batchId, sourceId, collectedAt, chunk);
      preview = previewAccountMapImport(input.company_id, document);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "La prévisualisation du lot a échoué.";
      for (const entry of chunk) appendSummary(result, {
        index: entry.index, name: entry.person.name, status: "error", reason
      });
      continue;
    }
    if (preview.idempotent) {
      for (const entry of chunk) {
        const contact = findContact(entry.person, existingContacts, entry.contactId);
        if (contact) resolved.set(entry.index, contact.id);
        appendSummary(result, { index: entry.index, name: entry.person.name, status: "unchanged",
          ...(contact ? { contact_id: contact.id } : {}) });
      }
      result.import_batch_ids.push(batchId);
      continue;
    }
    const selected = preview.items.filter((item) => item.defaultAccepted).map((item) => item.id);
    const accepted = chunk.filter((entry) =>
      selected.includes("person:tmp:person:i" + entry.index));
    const rejected = chunk.filter((entry) =>
      !selected.includes("person:tmp:person:i" + entry.index));
    for (const entry of rejected) {
      const proposal = preview.items.find((item) => item.id === "person:tmp:person:i" + entry.index);
      appendSummary(result, { index: entry.index, name: entry.person.name, status: "conflict",
        reason: proposal?.detail ?? "Rapprochement nécessaire avant l'import." });
    }
    if (input.dry_run) {
      result.import_batch_ids.push(batchId);
      for (const entry of accepted) {
        appendSummary(result, { index: entry.index, name: entry.person.name,
          status: entry.contactId ? "would_update" : "would_create",
          ...(entry.contactId ? { contact_id: entry.contactId } : {}) });
        if (entry.contactId) resolved.set(entry.index, entry.contactId);
        else plannedNew.add(entry.index);
      }
      continue;
    }
    if (!accepted.length) continue;
    try {
      applyAccountMapImport(input.company_id, {
        document, fingerprint: preview.fingerprint, acceptedIds: selected, contactResolutions: {}
      }, actor);
      result.import_batch_ids.push(batchId);
      const fresh = listProspectContacts(input.company_id);
      for (const entry of accepted) {
        const contact = findContact(entry.person, fresh, entry.contactId);
        if (!contact) {
          appendSummary(result, { index: entry.index, name: entry.person.name, status: "error",
            reason: "L'import a répondu avec succès, mais le contact n'a pas pu être relu." });
          continue;
        }
        resolved.set(entry.index, contact.id);
        appendSummary(result, { index: entry.index, name: entry.person.name,
          status: preview.idempotent ? "unchanged" : entry.contactId ? "updated" : "created",
          contact_id: contact.id });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Échec de l'import du lot.";
      result.warnings.push("Le lot de personnes a échoué ; chaque ligne est réessayée séparément : " + reason);
      for (const entry of accepted) {
        const rowBatchId = stableUuid(input.company_id + "|" + semanticKey + "|people|row|" + entry.index);
        try {
          const rowDocument = makeDocument(input, rowBatchId, sourceId, collectedAt, [entry]);
          const rowPreview = previewAccountMapImport(input.company_id, rowDocument);
          const rowSelected = rowPreview.items.filter((item) => item.defaultAccepted).map((item) => item.id);
          if (!rowPreview.idempotent && !rowSelected.includes("person:tmp:person:i" + entry.index)) {
            appendSummary(result, { index: entry.index, name: entry.person.name, status: "conflict",
              reason: "La ligne isolée requiert une revue avant import." });
            continue;
          }
          if (!rowPreview.idempotent) {
            applyAccountMapImport(input.company_id, {
              document: rowDocument, fingerprint: rowPreview.fingerprint,
              acceptedIds: rowSelected, contactResolutions: {}
            }, actor);
          }
          result.import_batch_ids.push(rowBatchId);
          const contact = findContact(entry.person, listProspectContacts(input.company_id), entry.contactId);
          if (!contact) throw new Error("La ligne isolée a été écrite, mais le contact reste introuvable.");
          resolved.set(entry.index, contact.id);
          appendSummary(result, { index: entry.index, name: entry.person.name,
            status: rowPreview.idempotent ? "unchanged" : entry.contactId ? "updated" : "created",
            contact_id: contact.id });
        } catch (rowError) {
          appendSummary(result, { index: entry.index, name: entry.person.name, status: "error",
            reason: rowError instanceof Error ? rowError.message : reason });
        }
      }
    }
  }

  const validRelationships: Array<{ index: number; relation: Relationship }> = [];
  input.relationships.forEach((raw, index) => {
    const parsed = caraaiosImportRelationshipSchema.safeParse(raw);
    if (!parsed.success) result.relationship_errors.push({ index, reason: parsed.error.issues.map((issue) => issue.message).join("; ") });
    else if (parsed.data.from_person_index === parsed.data.to_person_index)
      result.relationship_errors.push({ index, reason: "Une relation ne peut pas relier une personne à elle-même." });
    else validRelationships.push({ index, relation: parsed.data });
  });
  const validRoles: Array<{ index: number; role: BuyingRole }> = [];
  input.buying_committee.forEach((raw, index) => {
    const parsed = caraaiosImportBuyingRoleSchema.safeParse(raw);
    if (!parsed.success) result.buying_committee_errors.push({ index, reason: parsed.error.issues.map((issue) => issue.message).join("; ") });
    else {
      const found = withAccountMapDatabase((db) => db.prepare(
        "SELECT 1 FROM prospect_factory_map_opportunities WHERE id=? AND prospect_id=?"
      ).get(parsed.data.opportunity_id, input.company_id));
      if (!found) result.buying_committee_errors.push({ index, reason: "Opportunité absente de cette société." });
      else validRoles.push({ index, role: parsed.data });
    }
  });
  const validHypotheses: Array<{ index: number; hypothesis: Hypothesis }> = [];
  input.hypotheses.forEach((raw, index) => {
    const parsed = caraaiosImportHypothesisSchema.safeParse(raw);
    if (!parsed.success) result.hypothesis_errors.push({ index, reason: parsed.error.issues.map((issue) => issue.message).join("; ") });
    else validHypotheses.push({ index, hypothesis: parsed.data });
  });
  const graphRef = (index: number): string | null => {
    const contactId = resolved.get(index);
    return contactId ? "crm:contact:" + contactId
      : input.dry_run && plannedNew.has(index) ? "tmp:person:i" + index : null;
  };
  const relations: AccountMapImportDocument["relations"] = [];
  const relationInputIndexes: number[] = [];
  const autoAcceptNewInferredRelations = new Set<number>();
  const claims: AccountMapImportDocument["claims"] = [];
  for (const { index, relation } of validRelationships) {
    const from = graphRef(relation.from_person_index);
    const to = graphRef(relation.to_person_index);
    if (!from || !to) {
      result.relationship_errors.push({ index, reason: "Une ou plusieurs personnes de la relation n'ont pas été importées." });
      continue;
    }
    const rawKind = relation.kind;
    const reversed = rawKind === "manages";
    const fromRef = reversed ? to : from;
    const toRef = reversed ? from : to;
    const relationEvidence = evidence(relation.evidence_type, sourceId, "relationships[" + index + "]", {
      observedAt: input.source.observed_at, justification: relation.justification,
      verificationQuestion: relation.verification_question
    });
    const mappedKind = mapRelationshipKind(rawKind);
    if (!input.dry_run) {
      const existing = withAccountMapDatabase((db) => db.prepare(
        "SELECT r.evidence_status FROM prospect_factory_map_relations r " +
        "JOIN prospect_factory_map_nodes source_node ON source_node.id=r.from_node_id " +
        "JOIN prospect_factory_map_nodes target_node ON target_node.id=r.to_node_id " +
        "WHERE r.prospect_id=? AND source_node.contact_id=? AND target_node.contact_id=? " +
        "AND r.kind=? AND r.opportunity_id IS NULL LIMIT 1"
      ).get(input.company_id, fromRef.slice("crm:contact:".length),
        toRef.slice("crm:contact:".length), mappedKind) as { evidence_status: string } | undefined);
      if (existing && (existing.evidence_status === "confirmed" || relationEvidence.status === "hypothesis")) {
        result.relationship_errors.push({ index,
          reason: "Un lien existant requiert une revue humaine avant l'ajout de cette preuve." });
        continue;
      }
    }
    const documentIndex = relations.length;
    relations.push({ from_ref: fromRef, to_ref: toRef, kind: mappedKind,
      ...(relation.notes ? { notes: relation.notes } : {}), evidence: relationEvidence });
    relationInputIndexes.push(index);
    if (!input.dry_run && relationEvidence.status === "hypothesis"
      && (mappedKind === "reports_to" || mappedKind === "functional_reports_to")) {
      autoAcceptNewInferredRelations.add(documentIndex);
    }
    if (mappedKind !== rawKind || relation.notes) {
      const original = JSON.stringify({
        mcp_type: "relationship", kind: rawKind,
        from_ref: from, to_ref: to, notes: relation.notes?.slice(0, 5_000) ?? null
      });
      claims.push(claim(from, "other", original, relationEvidence));
    }
  }
  const opportunityRoles: AccountMapImportDocument["opportunity_roles"] = [];
  const roleInputIndexes: number[] = [];
  for (const { index, role } of validRoles) {
    const ref = graphRef(role.person_index);
    if (!ref) {
      result.buying_committee_errors.push({ index, reason: "La personne du buying committee n'a pas été importée." });
      continue;
    }
    const roleEvidence = evidence(role.evidence_type, sourceId, "buying_committee[" + index + "]", {
      observedAt: input.source.observed_at, justification: role.justification,
      verificationQuestion: role.verification_question
    });
    opportunityRoles.push({ person_ref: ref, opportunity_id: role.opportunity_id,
      role: mapBuyingRole(role.role), evidence: roleEvidence });
    roleInputIndexes.push(index);
    claims.push(claim(ref, "other", JSON.stringify({
      mcp_type: "buying_role", role: role.role, opportunity_id: role.opportunity_id
    }), roleEvidence));
  }
  const hypotheses: AccountMapImportDocument["hypotheses"] = [];
  const hypothesisInputIndexes: number[] = [];
  for (const { index, hypothesis } of validHypotheses) {
    const ref = hypothesis.person_index === undefined
      ? "crm:account:" + input.company_id : graphRef(hypothesis.person_index);
    if (!ref) {
      result.hypothesis_errors.push({ index, reason: "La personne de l'hypothèse n'a pas été importée." });
      continue;
    }
    hypotheses.push({ subject_ref: ref, proposition: hypothesis.proposition,
      justification: hypothesis.justification, verification_question: hypothesis.verification_question,
      source_ids: [sourceId], evidence_type: "inferred" });
    hypothesisInputIndexes.push(index);
  }
  let unassignedOrganizationErrors = 0;
  if (input.dry_run) {
    if (relations.length || opportunityRoles.length || hypotheses.length) {
      result.warnings.push("Les liens et rôles impliquant de nouveaux contacts seront vérifiés lors de l'application.");
    }
  } else if (relations.length || opportunityRoles.length || hypotheses.length || claims.length) {
    const maxEntries = Math.max(relations.length, opportunityRoles.length, hypotheses.length, claims.length);
    for (let offset = 0; offset < maxEntries; offset += ORGANIZATION_CHUNK_SIZE) {
      const batchId = stableUuid(input.company_id + "|" + semanticKey + "|organization|" + offset);
      const end = offset + ORGANIZATION_CHUNK_SIZE;
      try {
        const document = accountMapImportSchema.parse({
          schema_version: "account_map.v1", account_id: input.company_id, opportunity_id: null,
          import_batch_id: batchId, sources: [sourceRecord(input, sourceId, collectedAt)],
          units: [], people: [], role_slots: [],
          relations: relations.slice(offset, end),
          opportunity_roles: opportunityRoles.slice(offset, end),
          power_claims: [], claims: claims.slice(offset, end),
          hypotheses: hypotheses.slice(offset, end), open_questions: [], warnings: []
        });
        const preview = previewAccountMapImport(input.company_id, document);
        const selected = preview.items.filter((item) => item.defaultAccepted || (
          item.kind === "relation" && item.action === "conflict"
          && autoAcceptNewInferredRelations.has(offset + Number(item.id.slice("relation:".length)))))
          .map((item) => item.id);
        applyAccountMapImport(input.company_id, {
          document, fingerprint: preview.fingerprint, acceptedIds: selected, contactResolutions: {}
        }, actor);
        result.import_batch_ids.push(batchId);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Échec des relations ou hypothèses.";
        result.warnings.push("Les personnes ont été enregistrées, mais un lot de liens ou hypothèses a échoué : " + reason);
        if (offset >= relations.length && offset >= opportunityRoles.length && offset >= hypotheses.length) {
          unassignedOrganizationErrors += 1;
        }
        for (let index = offset; index < Math.min(end, relations.length); index++) {
          result.relationship_errors.push({ index: relationInputIndexes[index], reason });
        }
        for (let index = offset; index < Math.min(end, opportunityRoles.length); index++) {
          result.buying_committee_errors.push({ index: roleInputIndexes[index], reason });
        }
        for (let index = offset; index < Math.min(end, hypotheses.length); index++) {
          result.hypothesis_errors.push({ index: hypothesisInputIndexes[index], reason });
        }
      }
    }
  }
  result.summary.organization_errors = result.relationship_errors.length
    + result.buying_committee_errors.length + result.hypothesis_errors.length
    + unassignedOrganizationErrors;
  result.summary.errors += result.summary.organization_errors;
  result.people.sort((left, right) => left.index - right.index);
  return result;
}
