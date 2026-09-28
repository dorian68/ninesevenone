import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { withAccountMapDatabase } from "@/lib/prospect-factory-crm-db";
import type { AccountMapImportApply, AccountMapImportDocument } from "@/lib/account-map-import-contract";

type Row = Record<string, string | number | null>;
type ContactRow = Row & { id: string; name: string; linkedin: string | null; email: string | null; prospect_id: string };
type NodeRow = Row & { id: string; prospect_id: string; kind: string; contact_id: string | null; name: string; unit_kind: string | null };
type BatchRow = { id: string; prospect_id: string; payload_hash: string; status: string };
type Evidence = AccountMapImportDocument["units"][number]["evidence"];
const SINGLETON_CLAIM_FIELDS = new Set(["person_identity", "unit_identity", "role_slot_identity", "professional_scope"]);

export class AccountMapImportError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 422) {
    super(message);
    this.name = "AccountMapImportError";
  }
}

export type AccountMapImportPreviewItem = {
  id: string;
  kind: "source" | "unit" | "person" | "role_slot" | "affiliation" | "relation" | "opportunity_role" | "power_claim" | "claim" | "hypothesis" | "question";
  label: string;
  action: "create" | "enrich" | "possible_duplicate" | "conflict" | "reject";
  detail: string;
  defaultAccepted: boolean;
  candidateContactId?: string;
  matchBasis?: "name" | "email" | "linkedin";
};

export type AccountMapImportPreview = {
  batchId: string;
  fingerprint: string;
  idempotent: boolean;
  items: AccountMapImportPreviewItem[];
  warnings: string[];
  questions: string[];
};

export type AccountMapImportResult = {
  batchId: string;
  idempotent: boolean;
  created: number;
  updated: number;
  rejected: number;
  warnings: string[];
};

function digest(document: AccountMapImportDocument): string {
  return createHash("sha256").update(JSON.stringify(document)).digest("hex");
}

function normalizeLinkedin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (host !== "linkedin.com" && host !== "www.linkedin.com") return null;
    const path = url.pathname.replace(/\/+$/, "");
    return `https://www.linkedin.com${path || "/"}`;
  } catch { return null; }
}

function normalizeEmail(raw: string | null | undefined): string | null {
  return raw?.trim().toLowerCase() || null;
}

function getAccount(db: DatabaseSync, accountId: string): Row | null {
  return (db.prepare("SELECT id, company_name, certification, qualification_status, version FROM prospect_factory_prospects WHERE id=?")
    .get(accountId) as Row | undefined) ?? null;
}

function requireAccount(db: DatabaseSync, document: AccountMapImportDocument, routeAccountId: string): Row {
  if (document.account_id !== routeAccountId) throw new AccountMapImportError("Le compte du lot ne correspond pas à l’URL.", "ACCOUNT_MISMATCH");
  const account = getAccount(db, routeAccountId);
  if (!account) throw new AccountMapImportError("Compte CRM introuvable.", "ACCOUNT_NOT_FOUND", 404);
  return account;
}

function getExistingBatch(db: DatabaseSync, document: AccountMapImportDocument, fingerprint: string): BatchRow | null {
  const batch = (db.prepare("SELECT id, prospect_id, payload_hash, status FROM prospect_factory_map_import_batches WHERE id=?")
    .get(document.import_batch_id) as BatchRow | undefined) ?? null;
  if (batch && (batch.prospect_id !== document.account_id || batch.payload_hash !== fingerprint)) {
    throw new AccountMapImportError("Cet identifiant de lot a déjà été utilisé avec un contenu différent.", "IMPORT_BATCH_CONFLICT", 409);
  }
  return batch;
}

function assertOpportunities(db: DatabaseSync, document: AccountMapImportDocument): void {
  const referenced = new Set<string>();
  if (document.opportunity_id) referenced.add(document.opportunity_id);
  for (const item of document.role_slots) if (item.opportunity_id) referenced.add(item.opportunity_id);
  for (const item of document.relations) if (item.opportunity_id) referenced.add(item.opportunity_id);
  for (const item of document.opportunity_roles) referenced.add(item.opportunity_id);
  for (const item of document.power_claims) if (item.opportunity_id) referenced.add(item.opportunity_id);
  for (const item of document.claims) if (item.opportunity_id) referenced.add(item.opportunity_id);
  for (const item of document.open_questions) if (item.opportunity_id) referenced.add(item.opportunity_id);
  for (const opportunityId of referenced) {
    const found = db.prepare("SELECT 1 FROM prospect_factory_map_opportunities WHERE id=? AND prospect_id=?")
      .get(opportunityId, document.account_id);
    if (!found) throw new AccountMapImportError("Opportunité absente de ce compte.", "INVALID_OPPORTUNITY");
  }
}

function assertExistingReferences(db: DatabaseSync, document: AccountMapImportDocument): void {
  const references: string[] = [];
  for (const person of document.people) {
    if (person.crm_contact_id) references.push(`crm:contact:${person.crm_contact_id}`);
    for (const affiliation of person.affiliations) references.push(affiliation.unit_ref);
  }
  for (const relation of document.relations) references.push(relation.from_ref, relation.to_ref);
  for (const role of document.opportunity_roles) references.push(role.person_ref);
  for (const power of document.power_claims) references.push(power.person_ref);
  for (const claim of document.claims) references.push(claim.subject_ref);
  for (const hypothesis of document.hypotheses) references.push(hypothesis.subject_ref);
  for (const question of document.open_questions) if (question.subject_ref) references.push(question.subject_ref);
  for (const reference of references) {
    if (reference.startsWith("crm:account:")) {
      if (reference !== `crm:account:${document.account_id}`) {
        throw new AccountMapImportError("Référence à un autre compte interdite.", "CROSS_ACCOUNT_REFERENCE");
      }
    } else if (reference.startsWith("crm:contact:")) {
      const contactId = reference.slice("crm:contact:".length);
      if (!db.prepare("SELECT 1 FROM prospect_factory_contacts WHERE id=? AND prospect_id=?").get(contactId, document.account_id)) {
        throw new AccountMapImportError("Contact référencé absent de ce compte.", "INVALID_CONTACT_REFERENCE");
      }
    } else if (reference.startsWith("map:node:")) {
      const nodeId = reference.slice("map:node:".length);
      if (!db.prepare("SELECT 1 FROM prospect_factory_map_nodes WHERE id=? AND prospect_id=?").get(nodeId, document.account_id)) {
        throw new AccountMapImportError("Nœud référencé absent de ce compte.", "INVALID_NODE_REFERENCE");
      }
    }
  }
  for (const unit of document.units) {
    if (unit.linked_crm_account_id) {
      const account = getAccount(db, document.account_id);
      const sameName = String(account?.company_name ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase()
        === unit.name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
      if (unit.linked_crm_account_id !== document.account_id || unit.kind !== "company" || !sameName) {
        throw new AccountMapImportError("Seule la société au nom du compte CRM peut représenter le nœud racine.", "INVALID_ROOT_UNIT_REFERENCE");
      }
    }
  }
}

function item(id: string, kind: AccountMapImportPreviewItem["kind"], label: string,
  action: AccountMapImportPreviewItem["action"], detail: string, candidateContactId?: string): AccountMapImportPreviewItem {
  return { id, kind, label, action, detail, defaultAccepted: action === "create" || action === "enrich", ...(candidateContactId ? { candidateContactId } : {}) };
}

function proposalDependencies(document: AccountMapImportDocument): Map<string, string[]> {
  const dependencies = new Map<string, string[]>();
  const sourceRefs = (sourceIds: string[]) => sourceIds.map((sourceId) => `source:${sourceId}`);
  const tempRef = (ref: string) => ref.startsWith("tmp:person:") ? `person:${ref}`
    : ref.startsWith("tmp:unit:") ? `unit:${ref}`
      : ref.startsWith("tmp:slot:") ? `slot:${ref}` : null;
  const refs = (...values: string[]) => values.map(tempRef).filter((value): value is string => Boolean(value));
  for (const unit of document.units) dependencies.set(`unit:${unit.temp_id}`, sourceRefs(unit.evidence.source_ids));
  for (const person of document.people) {
    dependencies.set(`person:${person.temp_id}`, sourceRefs(person.identity_evidence.source_ids));
    person.affiliations.forEach((affiliation, index) => dependencies.set(`affiliation:${person.temp_id}:${index}`,
      [...refs(person.temp_id, affiliation.unit_ref), ...sourceRefs(affiliation.evidence.source_ids)]));
  }
  for (const slot of document.role_slots) dependencies.set(`slot:${slot.temp_id}`, sourceRefs(slot.evidence?.source_ids ?? []));
  document.relations.forEach((relation, index) => dependencies.set(`relation:${index}`,
    [...refs(relation.from_ref, relation.to_ref), ...sourceRefs(relation.evidence.source_ids)]));
  document.opportunity_roles.forEach((role, index) => dependencies.set(`role:${index}`,
    [...refs(role.person_ref), ...sourceRefs(role.evidence.source_ids)]));
  document.power_claims.forEach((power, index) => dependencies.set(`power:${index}`,
    [...refs(power.person_ref), ...sourceRefs(power.evidence.source_ids)]));
  document.claims.forEach((claim, index) => dependencies.set(`claim:${index}`,
    [...refs(claim.subject_ref), ...sourceRefs(claim.evidence.source_ids)]));
  document.hypotheses.forEach((hypothesis, index) => dependencies.set(`hypothesis:${index}`,
    [...refs(hypothesis.subject_ref), ...sourceRefs(hypothesis.source_ids)]));
  document.open_questions.forEach((question, index) => dependencies.set(`question:${index}`,
    question.subject_ref ? refs(question.subject_ref) : []));
  return dependencies;
}

function existingNodeForRef(db: DatabaseSync, accountId: string, reference: string): NodeRow | null {
  if (reference.startsWith("map:node:")) {
    return (db.prepare("SELECT * FROM prospect_factory_map_nodes WHERE id=? AND prospect_id=?")
      .get(reference.slice("map:node:".length), accountId) as NodeRow | undefined) ?? null;
  }
  if (reference.startsWith("crm:contact:")) {
    return (db.prepare("SELECT * FROM prospect_factory_map_nodes WHERE contact_id=? AND prospect_id=? AND kind='person'")
      .get(reference.slice("crm:contact:".length), accountId) as NodeRow | undefined) ?? null;
  }
  return null;
}

function previewNodeForRef(db: DatabaseSync, document: AccountMapImportDocument, reference: string): NodeRow | null {
  const direct = existingNodeForRef(db, document.account_id, reference);
  if (direct || !reference.startsWith("tmp:")) return direct;
  const person = document.people.find((entry) => entry.temp_id === reference);
  if (person?.crm_contact_id) return existingNodeForRef(db, document.account_id, `crm:contact:${person.crm_contact_id}`);
  const unit = document.units.find((entry) => entry.temp_id === reference);
  if (unit?.linked_crm_account_id === document.account_id) {
    return (db.prepare("SELECT * FROM prospect_factory_map_nodes WHERE prospect_id=? AND is_root=1")
      .get(document.account_id) as NodeRow | undefined) ?? null;
  }
  return null;
}

function buildPreview(db: DatabaseSync, routeAccountId: string, document: AccountMapImportDocument): AccountMapImportPreview {
  const account = requireAccount(db, document, routeAccountId);
  const fingerprint = digest(document);
  const batch = getExistingBatch(db, document, fingerprint);
  assertOpportunities(db, document);
  assertExistingReferences(db, document);
  const contacts = db.prepare("SELECT id, prospect_id, name, linkedin, email FROM prospect_factory_contacts WHERE prospect_id=?")
    .all(document.account_id) as ContactRow[];
  const nodes = db.prepare("SELECT id, prospect_id, kind, contact_id, unit_kind, name FROM prospect_factory_map_nodes WHERE prospect_id=?")
    .all(document.account_id) as NodeRow[];
  const items: AccountMapImportPreviewItem[] = [];
  const warnings = document.warnings.map((warning) => warning.message);
  const proposedEvidence: Evidence[] = [
    ...document.units.map((entry) => entry.evidence),
    ...document.people.flatMap((entry) => [entry.identity_evidence, ...entry.affiliations.map((affiliation) => affiliation.evidence)]),
    ...document.role_slots.flatMap((entry) => entry.evidence ? [entry.evidence] : []),
    ...document.relations.map((entry) => entry.evidence),
    ...document.opportunity_roles.map((entry) => entry.evidence),
    ...document.power_claims.map((entry) => entry.evidence),
    ...document.claims.map((entry) => entry.evidence)
  ];
  if (proposedEvidence.some((evidence) => evidence.status === "confirmed")) {
    warnings.push("Le statut « confirmé » du JSON devient « observé » ; une validation humaine traçable est nécessaire.");
  }
  if (account.certification === "blocked" || account.qualification_status === "disqualified") {
    warnings.push("Compte bloqué ou disqualifié : l’import ne modifie ni l’opposition ni les actions commerciales.");
  }
  if (batch?.status === "undone") warnings.push("Ce lot a déjà été annulé ; créez un nouvel identifiant de lot pour une nouvelle proposition.");
  for (const source of document.sources) items.push(item(`source:${source.source_id}`, "source", source.label, "create", "Source explicite à enregistrer."));
  for (const unit of document.units) {
    const duplicate = nodes.find((node) => node.kind === "unit" && node.unit_kind === unit.kind && node.name.toLocaleLowerCase() === unit.name.toLocaleLowerCase());
    const action = unit.linked_crm_account_id === document.account_id ? "enrich" : duplicate ? "possible_duplicate" : "create";
    items.push(item(`unit:${unit.temp_id}`, "unit", unit.name, action,
      action === "possible_duplicate" ? "Une unité de même nom et type existe ; vérifiez avant de créer." : action === "enrich" ? "Reliée au compte CRM existant." : "Nouvelle unité."));
  }
  for (const person of document.people) {
    const explicit = person.crm_contact_id ? contacts.find((contact) => contact.id === person.crm_contact_id) : null;
    const linkedin = normalizeLinkedin(person.linkedin_url);
    const byLinkedin = linkedin ? contacts.filter((contact) => normalizeLinkedin(contact.linkedin) === linkedin) : [];
    const byEmail = person.email ? contacts.filter((contact) =>
      contact.email?.trim().toLowerCase() === person.email?.trim().toLowerCase()) : [];
    const byName = contacts.filter((contact) => contact.name.trim().toLocaleLowerCase() === person.display_name_observed.trim().toLocaleLowerCase());
    const incompatibleMatches = byLinkedin.length > 0 && byEmail.length > 0
      && !byLinkedin.some((linkedinMatch) => byEmail.some((emailMatch) => emailMatch.id === linkedinMatch.id));
    const conflictingIdentity = Boolean(explicit && (
      (linkedin && explicit.linkedin && normalizeLinkedin(explicit.linkedin) !== linkedin)
      || (person.email && explicit.email && person.email.trim().toLowerCase() !== explicit.email.trim().toLowerCase())
      || byLinkedin.some((contact) => contact.id !== explicit.id)
      || byEmail.some((contact) => contact.id !== explicit.id)
    ));
    const insufficientIdentity = !["observed", "confirmed"].includes(person.identity_evidence.status)
      || !explicit && !linkedin && !person.email
      && !(person.first_name && person.last_name)
      && person.display_name_observed.trim().split(/\s+/).length < 2;
    const action = insufficientIdentity ? "reject" : conflictingIdentity || incompatibleMatches ? "conflict" : explicit ? "enrich" : byLinkedin.length > 0 || byEmail.length > 0 || byName.length > 0 ? "possible_duplicate" : "create";
    const candidate = explicit?.id ?? (byLinkedin.length === 1 ? byLinkedin[0].id : byEmail.length === 1 ? byEmail[0].id : undefined);
    const reason = insufficientIdentity ? "Identité insuffisante ou hypothétique pour créer un contact réel ; proposer une fonction à identifier."
      : conflictingIdentity ? "L'identifiant CRM contredit une URL LinkedIn ou un email connu ; corriger la proposition avant application."
      : incompatibleMatches ? "L'URL LinkedIn et l'email désignent deux contacts CRM différents ; corriger la proposition."
      : explicit ? "Contact CRM référencé explicitement ; les champs vides peuvent être complétés, les valeurs existantes sont conservées."
      : byLinkedin.length > 0 ? "URL LinkedIn identique : choisissez explicitement le contact à rattacher."
        : byEmail.length > 0 ? "Email identique : vérifiez le contact avant toute fusion."
        : byName.length > 0 ? "Nom identique : homonymie possible, aucune fusion automatique."
          : "Nouveau contact CRM proposé.";
    const proposal = item(`person:${person.temp_id}`, "person", person.display_name_observed, action, reason, candidate);
    if (action === "possible_duplicate") proposal.matchBasis = byLinkedin.length ? "linkedin" : byEmail.length ? "email" : "name";
    items.push(proposal);
    person.affiliations.forEach((affiliation, index) => items.push(item(
      `affiliation:${person.temp_id}:${index}`, "affiliation", `${person.display_name_observed} → ${affiliation.unit_ref}`,
      "create", "Affiliation documentée ou hypothétique selon sa preuve."
    )));
  }
  for (const slot of document.role_slots) items.push(item(`slot:${slot.temp_id}`, "role_slot", slot.label, "create", "Fonction à identifier, non comptée comme contact."));
  document.relations.forEach((relation, index) => {
    const risky = relation.kind === "reports_to" || relation.kind === "functional_reports_to";
    const from = previewNodeForRef(db, document, relation.from_ref);
    const to = previewNodeForRef(db, document, relation.to_ref);
    const existingConfirmed = from && to ? db.prepare(`SELECT 1 FROM prospect_factory_map_relations WHERE prospect_id=?
      AND from_node_id=? AND to_node_id=? AND kind=? AND opportunity_id IS ? AND evidence_status='confirmed' LIMIT 1`)
      .get(document.account_id, from.id, to.id, relation.kind, relation.opportunity_id ?? null) : null;
    const disputed = existingConfirmed && ["contradictory", "obsolete"].includes(relation.evidence.status);
    items.push(item(`relation:${index}`, "relation", `${relation.from_ref} → ${relation.to_ref}`,
      disputed || risky && relation.evidence.status === "hypothesis" ? "conflict" : "create",
      disputed ? "Une relation confirmée est contestée ; arbitrage requis sans écrasement."
        : risky ? "Lien hiérarchique ou fonctionnel : vérifier la preuve et le sens." : "Lien typé et dirigé."));
  });
  document.opportunity_roles.forEach((role, index) => items.push(item(`role:${index}`, "opportunity_role", `${role.person_ref} — ${role.role}`,
    role.role === "confirmed_champion" ? "reject" : "create",
    role.role === "confirmed_champion"
      ? "« Champion confirmé » exige une validation humaine distincte ; proposer un relais potentiel puis confirmer dans le CRM."
      : "Rôle propre à l’opportunité.")));
  document.power_claims.forEach((power, index) => {
    const subject = previewNodeForRef(db, document, power.person_ref);
    const existingDifferent = subject ? db.prepare(`SELECT 1 FROM prospect_factory_map_claims WHERE prospect_id=?
      AND subject_node_id=? AND opportunity_id IS ? AND field=? AND value_json<>? LIMIT 1`)
      .get(document.account_id, subject.id, power.opportunity_id ?? null, `power:${power.power}`,
        JSON.stringify({ answer: power.answer, scope: power.scope ?? null, budget_limit: power.budget_limit ?? null })) : null;
    items.push(item(`power:${index}`, "power_claim", `${power.person_ref} — ${power.power}`,
      existingDifferent ? "conflict" : "create", existingDifferent ? "Pouvoir différent déjà renseigné ; arbitrage requis." : "Pouvoir documenté au niveau de son périmètre."));
  });
  document.claims.forEach((claim, index) => {
    const subject = previewNodeForRef(db, document, claim.subject_ref);
    const existingConfirmed = subject && SINGLETON_CLAIM_FIELDS.has(claim.field) ? db.prepare(`SELECT 1 FROM prospect_factory_map_claims WHERE prospect_id=? AND subject_node_id=? AND opportunity_id IS ? AND field=? AND value_json<>? LIMIT 1`)
      .get(document.account_id, subject.id, claim.opportunity_id ?? null, claim.field, JSON.stringify(claim.value)) : null;
    items.push(item(`claim:${index}`, "claim", `${claim.subject_ref} — ${claim.field}`,
      existingConfirmed ? "conflict" : "create", existingConfirmed ? "Une information différente existe ; arbitrage requis, sans écrasement." : "Information sourcée à ajouter."));
  });
  document.hypotheses.forEach((hypothesis, index) => items.push(item(`hypothesis:${index}`, "hypothesis", hypothesis.proposition, "create", "Hypothèse séparée, à vérifier.")));
  document.open_questions.forEach((question, index) => items.push(item(`question:${index}`, "question", question.question, "create", "Question ouverte ; aucune action n’est envoyée automatiquement.")));
  const dependencies = proposalDependencies(document);
  const defaults = new Map(items.map((entry) => [entry.id, entry.defaultAccepted]));
  for (const entry of items) {
    if ((dependencies.get(entry.id) ?? []).some((dependency) => !defaults.get(dependency))) {
      entry.defaultAccepted = false;
      defaults.set(entry.id, false);
    }
  }
  return { batchId: document.import_batch_id, fingerprint, idempotent: batch?.status === "applied", items, warnings,
    questions: document.open_questions.map((question) => question.question) };
}

export function previewAccountMapImport(routeAccountId: string, document: AccountMapImportDocument): AccountMapImportPreview {
  return withAccountMapDatabase((db) => buildPreview(db, routeAccountId, document));
}

const INSERTABLE_TABLES = new Set([
  "prospect_factory_contacts", "prospect_factory_map_sources", "prospect_factory_map_nodes",
  "prospect_factory_map_relations", "prospect_factory_map_claims", "prospect_factory_map_stakeholder_roles",
  "prospect_factory_map_questions", "prospect_factory_map_evidence_sources"
]);

function insertLogged(db: DatabaseSync, batchId: string, table: string, values: Record<string, string | number | null>): string {
  if (!INSERTABLE_TABLES.has(table)) throw new Error("Invalid account-map import table.");
  const columns = Object.keys(values);
  const sql = `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`;
  db.prepare(sql).run(...Object.values(values));
  const entityId = String(values.id);
  const after = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(entityId) as Row | undefined;
  if (!after) throw new Error("Imported row missing after insert.");
  db.prepare(`INSERT INTO prospect_factory_map_import_changes
    (id,batch_id,entity_table,entity_id,operation,before_json,after_json,applied_version,undone_at)
    VALUES (?,?,?,?,?,?,?,?,NULL)`).run(randomUUID(), batchId, table, entityId, "insert", null,
      JSON.stringify(after), after.version === undefined ? null : String(after.version));
  return entityId;
}

function fillEmptyContactFields(db: DatabaseSync, batchId: string, accountId: string, contactId: string,
  person: AccountMapImportDocument["people"][number]): boolean {
  if (!["observed", "confirmed"].includes(person.identity_evidence.status)) return false;
  const before = db.prepare("SELECT * FROM prospect_factory_contacts WHERE id=? AND prospect_id=?")
    .get(contactId, accountId) as Row | undefined;
  if (!before) throw new AccountMapImportError("Contact CRM absent de ce compte.", "INVALID_CONTACT_REFERENCE");
  const candidates: Record<string, string | null | undefined> = {
    first_name: person.first_name, last_name: person.last_name, email: person.email,
    phone: person.phone, linkedin: person.linkedin_url, input_title: person.job_title_observed
  };
  const patch = Object.entries(candidates).filter(([key, value]) => value && !before[key]);
  if (!patch.length) return false;
  const timestamp = new Date().toISOString();
  db.prepare(`UPDATE prospect_factory_contacts SET ${patch.map(([key]) => `${key}=?`).join(",")}, updated_at=? WHERE id=? AND prospect_id=?`)
    .run(...patch.map(([, value]) => value!), timestamp, contactId, accountId);
  const after = db.prepare("SELECT * FROM prospect_factory_contacts WHERE id=?").get(contactId) as Row | undefined;
  if (!after) throw new Error("Contact absent après enrichissement.");
  db.prepare(`INSERT INTO prospect_factory_map_import_changes
    (id,batch_id,entity_table,entity_id,operation,before_json,after_json,applied_version,undone_at)
    VALUES (?,?,?,?,?,?,?,?,NULL)`).run(randomUUID(), batchId, "prospect_factory_contacts", contactId, "update",
      JSON.stringify(before), JSON.stringify(after), null);
  return true;
}

function effectiveStatus(evidence: Evidence): string {
  // JSON supplied by an assistant cannot authenticate a human validation.
  return evidence.status === "confirmed" ? "observed" : evidence.status;
}

function firstSource(sourceIds: string[], sourceMap: Map<string, string>): string | null {
  return sourceIds.length ? sourceMap.get(sourceIds[0]) ?? null : null;
}

function addEvidenceSources(db: DatabaseSync, batchId: string, accountId: string,
  subjectKind: "relation" | "claim" | "stakeholder_role", subjectId: string,
  evidence: Evidence, sourceMap: Map<string, string>): void {
  for (const sourceId of evidence.source_ids) {
    const dbSourceId = sourceMap.get(sourceId);
    if (!dbSourceId) throw new AccountMapImportError("Source refusée mais référencée par une proposition acceptée.", "SOURCE_DEPENDENCY");
    const existing = db.prepare(`SELECT 1 FROM prospect_factory_map_evidence_sources
      WHERE subject_kind=? AND subject_id=? AND source_id=?`).get(subjectKind, subjectId, dbSourceId);
    if (existing) continue;
    insertLogged(db, batchId, "prospect_factory_map_evidence_sources", {
      id: randomUUID(), prospect_id: accountId, subject_kind: subjectKind, subject_id: subjectId,
      source_id: dbSourceId, locator: evidence.locator ?? null, excerpt: evidence.excerpt ?? null
    });
  }
}

function addClaim(db: DatabaseSync, batchId: string, document: AccountMapImportDocument,
  nodeId: string, opportunityId: string | null, field: string, value: unknown,
  evidence: Evidence, sourceMap: Map<string, string>): string {
  const timestamp = new Date().toISOString();
  const valueJson = JSON.stringify(value);
  const previous = db.prepare(`SELECT * FROM prospect_factory_map_claims WHERE prospect_id=? AND subject_node_id=?
    AND opportunity_id IS ? AND field=? AND value_json=? ORDER BY created_at DESC LIMIT 1`)
    .get(document.account_id, nodeId, opportunityId, field, valueJson) as Row | undefined;
  if (previous) {
    addEvidenceSources(db, batchId, document.account_id, "claim", String(previous.id), evidence, sourceMap);
    return String(previous.id);
  }
  const conflicting = (SINGLETON_CLAIM_FIELDS.has(field) || field.startsWith("power:"))
    ? db.prepare(`SELECT 1 FROM prospect_factory_map_claims WHERE prospect_id=? AND subject_node_id=?
        AND opportunity_id IS ? AND field=? AND value_json<>? LIMIT 1`)
      .get(document.account_id, nodeId, opportunityId, field, valueJson)
    : null;
  const status = conflicting ? "contradictory" : effectiveStatus(evidence);
  const claimId = insertLogged(db, batchId, "prospect_factory_map_claims", {
    id: randomUUID(), prospect_id: document.account_id, subject_node_id: nodeId,
    opportunity_id: opportunityId, field, value_json: valueJson, evidence_status: status,
    source_id: firstSource(evidence.source_ids, sourceMap), source_ids_json: JSON.stringify(evidence.source_ids.map((id) => sourceMap.get(id))),
    locator: evidence.locator ?? null, excerpt: evidence.excerpt ?? null,
    justification: evidence.justification ?? null, verification_question: evidence.verification_question ?? null,
    information_date: evidence.information_date ?? null, validated_by: null, validated_at: null,
    version: 1, created_at: timestamp, updated_at: timestamp
  });
  addEvidenceSources(db, batchId, document.account_id, "claim", claimId, evidence, sourceMap);
  return claimId;
}

function addRelation(db: DatabaseSync, batchId: string, document: AccountMapImportDocument,
  fromId: string, toId: string, kind: string, opportunityId: string | null,
  evidence: Evidence, sourceMap: Map<string, string>, notes = ""): string {
  if (fromId === toId) throw new AccountMapImportError("Relation réflexive interdite.", "INVALID_RELATION");
  const from = db.prepare("SELECT kind,prospect_id FROM prospect_factory_map_nodes WHERE id=?").get(fromId) as { kind: string; prospect_id: string } | undefined;
  const to = db.prepare("SELECT kind,prospect_id FROM prospect_factory_map_nodes WHERE id=?").get(toId) as { kind: string; prospect_id: string } | undefined;
  if (!from || !to || from.prospect_id !== document.account_id || to.prospect_id !== document.account_id) {
    throw new AccountMapImportError("Relation vers un nœud absent ou un autre compte.", "INVALID_RELATION_REFERENCE");
  }
  const validKinds = kind === "works_in" ? ["person", "role_slot"].includes(from.kind) && to.kind === "unit"
    : kind === "part_of" ? from.kind === "unit" && to.kind === "unit"
      : kind === "advises" ? from.kind === "person" && ["person", "unit"].includes(to.kind)
        : from.kind === "person" && to.kind === "person";
  if (!validKinds) throw new AccountMapImportError("Types de nœuds incompatibles avec ce lien.", "INVALID_RELATION_TYPES");
  if (kind === "part_of") {
    // Inspect the current transaction, including earlier accepted edges in this import.
    const cycle = db.prepare(`WITH RECURSIVE ancestors(id) AS (
      SELECT to_node_id FROM prospect_factory_map_relations
      WHERE prospect_id=? AND kind='part_of' AND from_node_id=?
      UNION
      SELECT relation.to_node_id FROM prospect_factory_map_relations relation
      JOIN ancestors ON relation.from_node_id=ancestors.id
      WHERE relation.prospect_id=? AND relation.kind='part_of'
    ) SELECT 1 FROM ancestors WHERE id=? LIMIT 1`)
      .get(document.account_id, toId, document.account_id, fromId);
    if (cycle) throw new AccountMapImportError("Ce rattachement créerait un cycle entre unités.", "UNIT_RELATION_CYCLE", 409);
  }
  const existing = db.prepare(`SELECT id FROM prospect_factory_map_relations WHERE prospect_id=? AND from_node_id=?
    AND to_node_id=? AND kind=? AND opportunity_id IS ? ORDER BY created_at LIMIT 1`)
    .get(document.account_id, fromId, toId, kind, opportunityId) as { id: string } | undefined;
  if (existing && !["contradictory", "obsolete"].includes(evidence.status)) {
    addEvidenceSources(db, batchId, document.account_id, "relation", existing.id, evidence, sourceMap);
    return existing.id;
  }
  const timestamp = new Date().toISOString();
  const relationId = insertLogged(db, batchId, "prospect_factory_map_relations", {
    id: randomUUID(), prospect_id: document.account_id, from_node_id: fromId, to_node_id: toId,
    kind, opportunity_id: opportunityId, evidence_status: effectiveStatus(evidence),
    source_id: firstSource(evidence.source_ids, sourceMap), source_ids_json: JSON.stringify(evidence.source_ids.map((id) => sourceMap.get(id))),
    label: null, notes, locator: evidence.locator ?? null, excerpt: evidence.excerpt ?? null,
    justification: evidence.justification ?? null, verification_question: evidence.verification_question ?? null,
    validated_by: null, validated_at: null, version: 1, created_at: timestamp, updated_at: timestamp
  });
  addEvidenceSources(db, batchId, document.account_id, "relation", relationId, evidence, sourceMap);
  return relationId;
}

function ensureRoot(db: DatabaseSync, accountId: string, accountName: string): string {
  const existing = db.prepare("SELECT id FROM prospect_factory_map_nodes WHERE prospect_id=? AND is_root=1")
    .get(accountId) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  db.prepare(`INSERT INTO prospect_factory_map_nodes
    (id,prospect_id,kind,contact_id,unit_kind,is_root,name,title,notes,resolved_contact_id,version,created_at,updated_at)
    VALUES (?,?,'unit',NULL,'account',1,?,NULL,'',NULL,1,?,?)`).run(id, accountId, accountName, timestamp, timestamp);
  return id;
}

function insertContact(db: DatabaseSync, batchId: string, document: AccountMapImportDocument,
  person: AccountMapImportDocument["people"][number]): string {
  const timestamp = new Date().toISOString();
  return insertLogged(db, batchId, "prospect_factory_contacts", {
    id: randomUUID(), prospect_id: document.account_id, fingerprint: `map-import:${batchId}:${person.temp_id}`,
    name: person.display_name_observed.trim(), first_name: person.first_name ?? null, last_name: person.last_name ?? null,
    email: person.email ?? null, phone: person.phone ?? null, linkedin: person.linkedin_url ?? null,
    seniority: null, persona_key: null, deal_roles_json: "[]", decision_scope: null,
    input_title: person.job_title_observed ?? null, verified_title: null, evidence_type: "to_confirm",
    source_url: null, source_row_or_record: null, buying_committee_role: null,
    created_at: timestamp, updated_at: timestamp
  });
}

function makeNode(db: DatabaseSync, batchId: string, accountId: string,
  kind: "person" | "unit" | "role_slot", name: string,
  options: { contactId?: string; unitKind?: string; title?: string | null; notes?: string | null; opportunityId?: string | null } = {}): string {
  const timestamp = new Date().toISOString();
  return insertLogged(db, batchId, "prospect_factory_map_nodes", {
    id: randomUUID(), prospect_id: accountId, kind, contact_id: options.contactId ?? null,
    unit_kind: options.unitKind ?? null, is_root: 0, name, title: options.title ?? null,
    notes: options.notes ?? "", resolved_contact_id: null, version: 1,
    ...(options.opportunityId ? { opportunity_id: options.opportunityId } : {}),
    created_at: timestamp, updated_at: timestamp
  });
}

function requireSelected(selected: Set<string>, itemId: string, message: string): void {
  if (!selected.has(itemId)) throw new AccountMapImportError(message, "IMPORT_DEPENDENCY");
}

function resolveNode(db: DatabaseSync, document: AccountMapImportDocument, reference: string,
  tempNodes: Map<string, string>, rootId: string): string {
  if (reference.startsWith("tmp:")) {
    const value = tempNodes.get(reference);
    if (!value) throw new AccountMapImportError("Une proposition référence un nœud refusé.", "IMPORT_DEPENDENCY");
    return value;
  }
  if (reference === `crm:account:${document.account_id}`) return rootId;
  if (reference.startsWith("map:node:")) return reference.slice("map:node:".length);
  if (reference.startsWith("crm:contact:")) {
    const contactId = reference.slice("crm:contact:".length);
    const node = db.prepare("SELECT id FROM prospect_factory_map_nodes WHERE prospect_id=? AND contact_id=? AND kind='person'")
      .get(document.account_id, contactId) as { id: string } | undefined;
    if (node) return node.id;
    const contact = db.prepare("SELECT name,input_title FROM prospect_factory_contacts WHERE prospect_id=? AND id=?")
      .get(document.account_id, contactId) as { name: string; input_title: string | null } | undefined;
    if (!contact) throw new AccountMapImportError("Contact référencé absent de ce compte.", "INVALID_CONTACT_REFERENCE");
    return makeNode(db, document.import_batch_id, document.account_id, "person", contact.name,
      { contactId, title: contact.input_title });
  }
  throw new AccountMapImportError("Référence de nœud invalide.", "INVALID_NODE_REFERENCE");
}

function applyInsideTransaction(db: DatabaseSync, routeAccountId: string, input: AccountMapImportApply,
  actor: string): AccountMapImportResult {
  const { document } = input;
  const preview = buildPreview(db, routeAccountId, document);
  if (preview.fingerprint !== input.fingerprint) {
    throw new AccountMapImportError("La proposition a changé depuis la prévisualisation.", "STALE_PREVIEW", 409);
  }
  if (preview.idempotent) {
    return { batchId: document.import_batch_id, idempotent: true, created: 0, updated: 0, rejected: 0,
      warnings: ["Ce lot avait déjà été appliqué ; aucune nouvelle écriture."] };
  }
  const oldBatch = getExistingBatch(db, document, preview.fingerprint);
  if (oldBatch?.status === "undone") {
    throw new AccountMapImportError("Ce lot a été annulé. Utilisez un nouvel identifiant pour une nouvelle importation.", "IMPORT_ALREADY_UNDONE", 409);
  }
  const selected = new Set(input.acceptedIds);
  if (selected.size !== input.acceptedIds.length) throw new AccountMapImportError("Proposition acceptée plusieurs fois.", "DUPLICATE_DECISION");
  const known = new Map(preview.items.map((entry) => [entry.id, entry]));
  for (const id of selected) {
    const proposal = known.get(id);
    if (!proposal) throw new AccountMapImportError("Décision sur une proposition inconnue.", "UNKNOWN_DECISION");
    if (proposal.action === "reject") throw new AccountMapImportError("Une proposition rejetée ne peut pas être acceptée.", "REJECTED_PROPOSAL");
    if (proposal.kind === "person" && proposal.action === "conflict") throw new AccountMapImportError(
      "Une identité CRM contradictoire doit être corrigée avant l’import.", "CONFLICTING_PERSON_IDENTITY", 409);
  }
  for (const [proposalId, dependencies] of proposalDependencies(document)) {
    if (!selected.has(proposalId)) continue;
    for (const dependency of dependencies) {
      if (!selected.has(dependency)) throw new AccountMapImportError(
        `La proposition ${proposalId} dépend de ${dependency}, qui n’a pas été accepté.`, "IMPORT_DEPENDENCY");
    }
  }
  const peopleByTemp = new Map(document.people.map((person) => [person.temp_id, person]));
  const selectedContactIds = new Set<string>();
  const selectedLinkedinUrls = new Set<string>();
  for (const person of document.people) {
    if (!selected.has(`person:${person.temp_id}`)) continue;
    const chosen = person.crm_contact_id ?? input.contactResolutions[person.temp_id];
    if (chosen) {
      if (selectedContactIds.has(chosen)) throw new AccountMapImportError(
        "Deux propositions du lot pointent vers le même contact CRM ; réunissez-les dans une seule personne.", "DUPLICATE_PERSON_REFERENCE");
      selectedContactIds.add(chosen);
    }
    const linkedin = normalizeLinkedin(person.linkedin_url);
    if (linkedin) {
      if (selectedLinkedinUrls.has(linkedin)) throw new AccountMapImportError(
        "Deux personnes du lot ont la même URL LinkedIn ; réunissez-les avant l’import.", "DUPLICATE_PERSON_REFERENCE");
      selectedLinkedinUrls.add(linkedin);
    }
  }
  for (const [tempId, contactId] of Object.entries(input.contactResolutions)) {
    if (!peopleByTemp.has(tempId) || !selected.has(`person:${tempId}`)) {
      throw new AccountMapImportError("Résolution d’un contact non accepté ou absent.", "INVALID_CONTACT_RESOLUTION");
    }
    if (!db.prepare("SELECT 1 FROM prospect_factory_contacts WHERE id=? AND prospect_id=?").get(contactId, document.account_id)) {
      throw new AccountMapImportError("Le contact choisi n’appartient pas à ce compte.", "CROSS_ACCOUNT_CONTACT");
    }
    if (peopleByTemp.get(tempId)?.crm_contact_id && peopleByTemp.get(tempId)?.crm_contact_id !== contactId) {
      throw new AccountMapImportError("La résolution contredit l’identifiant CRM fourni.", "CONTACT_RESOLUTION_CONFLICT");
    }
  }
  const account = requireAccount(db, document, routeAccountId);
  const timestamp = new Date().toISOString();
  db.prepare(`INSERT INTO prospect_factory_map_import_batches
    (id,prospect_id,payload_hash,status,applied_at,applied_by,undone_at,undone_by)
    VALUES (?,?,?,'applied',?,?,NULL,NULL)`)
    .run(document.import_batch_id, document.account_id, preview.fingerprint, timestamp, actor);
  const rootId = ensureRoot(db, document.account_id, String(account.company_name));
  const sourceMap = new Map<string, string>();
  const tempNodes = new Map<string, string>();
  let created = 0;
  let updated = 0;
  const warnings = [...preview.warnings];
  for (const source of document.sources) {
    if (!selected.has(`source:${source.source_id}`)) continue;
    const dbId = insertLogged(db, document.import_batch_id, "prospect_factory_map_sources", {
      id: randomUUID(), prospect_id: document.account_id,
      kind: source.kind === "user_screenshot" ? "screenshot" : source.kind === "crm_activity" ? "crm_note" : source.kind,
      label: source.label, reference: source.asset_ref ?? source.url ?? null,
      collected_at: source.collected_at, information_date: source.information_date ?? null,
      locator: null, excerpt: null, retention_until: source.retention_until ?? null,
      version: 1, created_at: timestamp, updated_at: timestamp
    });
    sourceMap.set(source.source_id, dbId);
    created += 1;
  }
  for (const unit of document.units) {
    if (!selected.has(`unit:${unit.temp_id}`)) continue;
    const nodeId = unit.linked_crm_account_id === document.account_id ? rootId
      : makeNode(db, document.import_batch_id, document.account_id, "unit", unit.name, { unitKind: unit.kind });
    tempNodes.set(unit.temp_id, nodeId);
    if (nodeId !== rootId) created += 1;
    addClaim(db, document.import_batch_id, document, nodeId, null, "unit_identity", { kind: unit.kind, name: unit.name },
      unit.evidence, sourceMap);
  }
  for (const person of document.people) {
    if (!selected.has(`person:${person.temp_id}`)) continue;
    let contactId = person.crm_contact_id ?? input.contactResolutions[person.temp_id] ?? null;
    const normalized = normalizeLinkedin(person.linkedin_url);
    const email = normalizeEmail(person.email);
    const contacts = db.prepare("SELECT id,name,linkedin,email FROM prospect_factory_contacts WHERE prospect_id=?")
      .all(document.account_id) as Array<{ id: string; name: string; linkedin: string | null; email: string | null }>;
    const linkedinMatches = normalized ? contacts.filter((contact) => normalizeLinkedin(contact.linkedin) === normalized) : [];
    const emailMatches = email ? contacts.filter((contact) => normalizeEmail(contact.email) === email) : [];
    if (!contactId && (linkedinMatches.length > 0 || emailMatches.length > 0)) {
      throw new AccountMapImportError("Une URL LinkedIn ou un email identique exige un rapprochement explicite.", "CONTACT_MATCH_REQUIRES_DECISION", 409);
    }
    if (contactId) {
      const chosen = contacts.find((contact) => contact.id === contactId);
      if (!chosen) throw new AccountMapImportError("Le contact choisi n’appartient pas à ce compte.", "CROSS_ACCOUNT_CONTACT");
      const chosenLinkedin = normalizeLinkedin(chosen.linkedin);
      const chosenEmail = normalizeEmail(chosen.email);
      const wrongLinkedin = Boolean(normalized && chosenLinkedin && normalized !== chosenLinkedin)
        || linkedinMatches.some((contact) => contact.id !== contactId);
      const wrongEmail = Boolean(email && chosenEmail && email !== chosenEmail)
        || emailMatches.some((contact) => contact.id !== contactId);
      const sameName = chosen.name.trim().toLocaleLowerCase() === person.display_name_observed.trim().toLocaleLowerCase();
      const strongMatch = Boolean(normalized && chosenLinkedin === normalized) || Boolean(email && chosenEmail === email);
      const unsupportedResolution = Boolean(input.contactResolutions[person.temp_id] && !person.crm_contact_id
        && !sameName && !strongMatch);
      if (wrongLinkedin || wrongEmail || unsupportedResolution) {
        throw new AccountMapImportError("Le contact choisi contredit l’identité, l’email ou l’URL LinkedIn de la proposition. Corrigez le JSON ou le rapprochement.",
          "CONTACT_RESOLUTION_CONFLICT", 409);
      }
    }
    const existingContact = Boolean(contactId);
    if (!contactId) {
      contactId = insertContact(db, document.import_batch_id, document, person);
      created += 1;
    }
    const existingNode = db.prepare("SELECT id FROM prospect_factory_map_nodes WHERE prospect_id=? AND kind='person' AND contact_id=?")
      .get(document.account_id, contactId) as { id: string } | undefined;
    const nodeId = existingNode?.id ?? makeNode(db, document.import_batch_id, document.account_id,
      "person", person.display_name_observed, { contactId, title: person.job_title_observed });
    if (!existingNode) created += 1;
    tempNodes.set(person.temp_id, nodeId);
    if (existingContact && fillEmptyContactFields(db, document.import_batch_id, document.account_id, contactId, person)) updated += 1;
    addClaim(db, document.import_batch_id, document, nodeId, null, "person_identity", {
      display_name_observed: person.display_name_observed, first_name: person.first_name ?? null,
      last_name: person.last_name ?? null, job_title_observed: person.job_title_observed ?? null,
      linkedin_url: person.linkedin_url ?? null, email: person.email ?? null, phone: person.phone ?? null
    }, person.identity_evidence, sourceMap);
  }
  for (const slot of document.role_slots) {
    if (!selected.has(`slot:${slot.temp_id}`)) continue;
    const nodeId = makeNode(db, document.import_batch_id, document.account_id, "role_slot", slot.label,
      { notes: slot.notes, opportunityId: slot.opportunity_id });
    tempNodes.set(slot.temp_id, nodeId);
    created += 1;
    if (slot.evidence) addClaim(db, document.import_batch_id, document, nodeId, slot.opportunity_id ?? null,
      "role_slot_identity", slot.label, slot.evidence, sourceMap);
  }
  for (const person of document.people) {
    for (const [index, affiliation] of person.affiliations.entries()) {
      if (!selected.has(`affiliation:${person.temp_id}:${index}`)) continue;
      requireSelected(selected, `person:${person.temp_id}`, "Affiliation acceptée sans la personne.");
      if (affiliation.unit_ref.startsWith("tmp:")) requireSelected(selected, `unit:${affiliation.unit_ref}`, "Affiliation acceptée sans l’unité.");
      const personNodeId = resolveNode(db, document, person.temp_id, tempNodes, rootId);
      const unitNodeId = resolveNode(db, document, affiliation.unit_ref, tempNodes, rootId);
      const affiliationNotes = [
        affiliation.external ? "Affiliation externe" : null,
        affiliation.job_title_observed ? `Poste observé : ${affiliation.job_title_observed}` : null,
        affiliation.scope ? `Périmètre : ${affiliation.scope}` : null
      ].filter(Boolean).join(" · ");
      addRelation(db, document.import_batch_id, document, personNodeId, unitNodeId, "works_in", null,
        affiliation.evidence, sourceMap, affiliationNotes);
      if (affiliation.external) addClaim(db, document.import_batch_id, document, personNodeId, null,
        "external_affiliation", { unit_node_id: unitNodeId, scope: affiliation.scope ?? null },
        affiliation.evidence, sourceMap);
      created += 1;
    }
  }
  for (const [index, relation] of document.relations.entries()) {
    if (!selected.has(`relation:${index}`)) continue;
    const fromId = resolveNode(db, document, relation.from_ref, tempNodes, rootId);
    const toId = resolveNode(db, document, relation.to_ref, tempNodes, rootId);
    addRelation(db, document.import_batch_id, document, fromId, toId, relation.kind,
      relation.opportunity_id ?? null, relation.evidence, sourceMap);
    created += 1;
  }
  for (const [index, role] of document.opportunity_roles.entries()) {
    if (!selected.has(`role:${index}`)) continue;
    const nodeId = resolveNode(db, document, role.person_ref, tempNodes, rootId);
    const node = db.prepare("SELECT kind FROM prospect_factory_map_nodes WHERE id=?").get(nodeId) as { kind: string };
    if (node.kind !== "person") throw new AccountMapImportError("Un rôle commercial exige une personne réelle.", "INVALID_ROLE_SUBJECT");
    const existing = db.prepare(`SELECT id FROM prospect_factory_map_stakeholder_roles WHERE prospect_id=?
      AND opportunity_id=? AND person_node_id=? AND role=?`)
      .get(document.account_id, role.opportunity_id, nodeId, role.role) as { id: string } | undefined;
    let roleId = existing?.id;
    if (!roleId) {
      roleId = insertLogged(db, document.import_batch_id, "prospect_factory_map_stakeholder_roles", {
        id: randomUUID(), prospect_id: document.account_id, opportunity_id: role.opportunity_id,
        person_node_id: nodeId, role: role.role, evidence_status: effectiveStatus(role.evidence),
        source_id: firstSource(role.evidence.source_ids, sourceMap),
        source_ids_json: JSON.stringify(role.evidence.source_ids.map((id) => sourceMap.get(id))),
        notes: "", version: 1, created_at: timestamp, updated_at: timestamp
      });
      created += 1;
    }
    addEvidenceSources(db, document.import_batch_id, document.account_id, "stakeholder_role", roleId,
      role.evidence, sourceMap);
  }
  for (const [index, power] of document.power_claims.entries()) {
    if (!selected.has(`power:${index}`)) continue;
    const nodeId = resolveNode(db, document, power.person_ref, tempNodes, rootId);
    const node = db.prepare("SELECT kind FROM prospect_factory_map_nodes WHERE id=?").get(nodeId) as { kind: string };
    if (node.kind !== "person") throw new AccountMapImportError("Un pouvoir commercial exige une personne réelle.", "INVALID_POWER_SUBJECT");
    addClaim(db, document.import_batch_id, document, nodeId, power.opportunity_id ?? null, `power:${power.power}`,
      { answer: power.answer, scope: power.scope ?? null, budget_limit: power.budget_limit ?? null },
      power.evidence, sourceMap);
    created += 1;
  }
  for (const [index, claim] of document.claims.entries()) {
    if (!selected.has(`claim:${index}`)) continue;
    const nodeId = resolveNode(db, document, claim.subject_ref, tempNodes, rootId);
    addClaim(db, document.import_batch_id, document, nodeId, claim.opportunity_id ?? null,
      claim.field, claim.value, claim.evidence, sourceMap);
    created += 1;
  }
  for (const [index, hypothesis] of document.hypotheses.entries()) {
    if (!selected.has(`hypothesis:${index}`)) continue;
    const nodeId = resolveNode(db, document, hypothesis.subject_ref, tempNodes, rootId);
    addClaim(db, document.import_batch_id, document, nodeId, null, "hypothesis", hypothesis.proposition,
      { status: "hypothesis", source_ids: hypothesis.source_ids, justification: hypothesis.justification,
        verification_question: hypothesis.verification_question }, sourceMap);
    created += 1;
  }
  for (const [index, question] of document.open_questions.entries()) {
    if (!selected.has(`question:${index}`)) continue;
    const nodeId = question.subject_ref ? resolveNode(db, document, question.subject_ref, tempNodes, rootId) : null;
    const old = db.prepare(`SELECT 1 FROM prospect_factory_map_questions WHERE prospect_id=? AND subject_node_id IS ?
      AND opportunity_id IS ? AND question=? AND status='open'`)
      .get(document.account_id, nodeId, question.opportunity_id ?? null, question.question);
    if (old) continue;
    insertLogged(db, document.import_batch_id, "prospect_factory_map_questions", {
      id: randomUUID(), prospect_id: document.account_id, subject_node_id: nodeId,
      opportunity_id: question.opportunity_id ?? null, question: question.question,
      next_action: question.next_action ?? null, status: "open", version: 1,
      created_at: timestamp, updated_at: timestamp
    });
    created += 1;
  }
  if (account.certification === "blocked" || account.qualification_status === "disqualified") {
    warnings.push("L’exclusion commerciale du compte est conservée.");
  }
  return { batchId: document.import_batch_id, idempotent: false, created, updated,
    rejected: preview.items.length - selected.size, warnings };
}

export function applyAccountMapImport(routeAccountId: string, input: AccountMapImportApply,
  actor: string): AccountMapImportResult {
  return withAccountMapDatabase((db) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = applyInsideTransaction(db, routeAccountId, input, actor);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });
}

export type AccountMapImportUndo = { batchId: string; undone: boolean; conflicts: string[] };

type ChangeRow = {
  id: string; entity_table: string; entity_id: string; operation: string;
  before_json: string | null; after_json: string | null; undone_at: string | null;
};

function checkExternalDependents(db: DatabaseSync, table: string, entityId: string): string | null {
  const one = (sql: string) => Boolean(db.prepare(sql).get(entityId));
  if (table === "prospect_factory_map_nodes") {
    if (db.prepare("SELECT 1 FROM prospect_factory_map_relations WHERE from_node_id=? OR to_node_id=? LIMIT 1").get(entityId, entityId)) return "Des relations ultérieures utilisent ce nœud.";
    if (one("SELECT 1 FROM prospect_factory_map_claims WHERE subject_node_id=? LIMIT 1")) return "Des informations ultérieures utilisent ce nœud.";
    if (one("SELECT 1 FROM prospect_factory_map_stakeholder_roles WHERE person_node_id=? LIMIT 1")) return "Des rôles ultérieurs utilisent ce nœud.";
    if (one("SELECT 1 FROM prospect_factory_map_questions WHERE subject_node_id=? LIMIT 1")) return "Des questions ultérieures utilisent ce nœud.";
    if (one("SELECT 1 FROM prospect_factory_map_layouts WHERE node_id=? LIMIT 1")) return "La position de ce nœud a été modifiée.";
  }
  if (table === "prospect_factory_map_sources") {
    if (one("SELECT 1 FROM prospect_factory_map_relations WHERE source_id=? LIMIT 1")) return "Une relation utilise encore cette source.";
    if (one("SELECT 1 FROM prospect_factory_map_claims WHERE source_id=? LIMIT 1")) return "Une information utilise encore cette source.";
    if (one("SELECT 1 FROM prospect_factory_map_stakeholder_roles WHERE source_id=? LIMIT 1")) return "Un rôle utilise encore cette source.";
    if (one("SELECT 1 FROM prospect_factory_map_evidence_sources WHERE source_id=? LIMIT 1")) return "Une preuve utilise encore cette source.";
  }
  if (table === "prospect_factory_contacts") {
    if (db.prepare("SELECT 1 FROM prospect_factory_map_nodes WHERE contact_id=? OR resolved_contact_id=? LIMIT 1").get(entityId, entityId)) return "Un nœud utilise encore ce contact.";
    if (one("SELECT 1 FROM prospect_factory_activities WHERE contact_id=? LIMIT 1")) return "Une activité commerciale est liée à ce contact.";
    if (one("SELECT 1 FROM prospect_factory_account_personas WHERE contact_id=? LIMIT 1")) return "Un persona CRM est lié à ce contact.";
  }
  return null;
}

export function undoAccountMapImport(accountId: string, batchId: string, actor: string): AccountMapImportUndo {
  return withAccountMapDatabase((db) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const batch = db.prepare("SELECT * FROM prospect_factory_map_import_batches WHERE id=? AND prospect_id=?")
        .get(batchId, accountId) as BatchRow | undefined;
      if (!batch) throw new AccountMapImportError("Lot introuvable pour ce compte.", "IMPORT_BATCH_NOT_FOUND", 404);
      if (batch.status === "undone") {
        db.exec("COMMIT");
        return { batchId, undone: true, conflicts: [] };
      }
      const changes = db.prepare("SELECT * FROM prospect_factory_map_import_changes WHERE batch_id=? ORDER BY rowid DESC")
        .all(batchId) as ChangeRow[];
      const conflicts: string[] = [];
      for (const change of changes) {
        if (!INSERTABLE_TABLES.has(change.entity_table) || !["insert", "update"].includes(change.operation) || !change.after_json
          || (change.operation === "update" && (change.entity_table !== "prospect_factory_contacts" || !change.before_json))) {
          conflicts.push(`Modification ${change.id} impossible à annuler automatiquement.`);
          continue;
        }
        const current = db.prepare(`SELECT * FROM ${change.entity_table} WHERE id=?`).get(change.entity_id) as Row | undefined;
        if (!current || JSON.stringify(current) !== change.after_json) {
          conflicts.push(`L’élément ${change.entity_id} a été modifié depuis l’import.`);
        }
      }
      if (conflicts.length) {
        db.exec("ROLLBACK");
        return { batchId, undone: false, conflicts };
      }
      try {
        for (const change of changes) {
          if (change.operation === "update") {
            const before = JSON.parse(change.before_json!) as Row;
            const columns = Object.keys(before).filter((column) => column !== "id");
            db.prepare(`UPDATE prospect_factory_contacts SET ${columns.map((column) => `${column}=?`).join(",")}
              WHERE id=?`).run(...columns.map((column) => before[column]), change.entity_id);
            continue;
          }
          const dependent = checkExternalDependents(db, change.entity_table, change.entity_id);
          if (dependent) throw new AccountMapImportError(dependent, "UNDO_CONFLICT", 409);
          db.prepare(`DELETE FROM ${change.entity_table} WHERE id=?`).run(change.entity_id);
        }
      } catch (error) {
        db.exec("ROLLBACK");
        if (error instanceof AccountMapImportError && error.code === "UNDO_CONFLICT") {
          return { batchId, undone: false, conflicts: [error.message] };
        }
        throw error;
      }
      const timestamp = new Date().toISOString();
      db.prepare("UPDATE prospect_factory_map_import_changes SET undone_at=? WHERE batch_id=?")
        .run(timestamp, batchId);
      db.prepare("UPDATE prospect_factory_map_import_batches SET status='undone',undone_at=?,undone_by=? WHERE id=?")
        .run(timestamp, actor, batchId);
      db.exec("COMMIT");
      return { batchId, undone: true, conflicts: [] };
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* Transaction was already rolled back for a conflict result. */ }
      throw error;
    }
  });
}
