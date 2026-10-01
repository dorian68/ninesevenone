import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { withAccountMapDatabase } from "./prospect-factory-crm-db";
import type {
  AccountMapClaim, AccountMapEvidenceLink, AccountMapLayout, AccountMapNode, AccountMapOpportunity,
  AccountMapQuestion, AccountMapRelation, AccountMapSnapshot, AccountMapSource,
  AccountMapStakeholderRole, MapEvidenceStatus, MapRelationKind, MapView
} from "./account-map-contract";
import { MAP_RELATION_KINDS } from "./account-map-contract";

export { withAccountMapDatabase } from "./prospect-factory-crm-db";

type Row = Record<string, unknown>;
type DB = DatabaseSync;

export class AccountMapInputError extends Error {
  constructor(readonly field: string, message: string) { super(message); this.name = "AccountMapInputError"; }
}
export class AccountMapVersionConflictError extends Error {
  constructor(readonly entityId: string) { super("Cet élément a été modifié depuis son ouverture."); this.name = "AccountMapVersionConflictError"; }
}

const now = () => new Date().toISOString();
const s = (value: unknown) => value === null || value === undefined ? null : String(value);
const n = (value: unknown) => Number(value);
const jsonArray = (value: unknown): string[] => {
  try { const parsed: unknown = JSON.parse(String(value ?? "[]")); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; }
  catch { return []; }
};
const nullable = (value: string | null | undefined) => value ?? null;
const queryAll = (db: DB, sql: string, ...args: Array<string | number | null>) => db.prepare(sql).all(...args) as Row[];
const queryOne = (db: DB, sql: string, ...args: Array<string | number | null>) => db.prepare(sql).get(...args) as Row | undefined;

function accountRow(db: DB, accountId: string) {
  return queryOne(db, "SELECT id, company_name FROM prospect_factory_prospects WHERE id=?", accountId);
}
function requireAccount(db: DB, accountId: string) {
  const row = accountRow(db, accountId);
  if (!row) throw new AccountMapInputError("accountId", "Compte suivi introuvable.");
  return row;
}
function requireContact(db: DB, accountId: string, contactId: string) {
  const row = queryOne(db, "SELECT id, name, input_title, verified_title FROM prospect_factory_contacts WHERE id=? AND prospect_id=?", contactId, accountId);
  if (!row) throw new AccountMapInputError("contactId", "Le contact n’appartient pas à ce compte.");
  return row;
}
function requireNode(db: DB, accountId: string, nodeId: string) {
  const row = queryOne(db, "SELECT * FROM prospect_factory_map_nodes WHERE id=? AND prospect_id=?", nodeId, accountId);
  if (!row) throw new AccountMapInputError("nodeId", "Nœud introuvable pour ce compte.");
  return row;
}
function requireOpportunity(db: DB, accountId: string, opportunityId: string | null | undefined) {
  if (!opportunityId) return null;
  const row = queryOne(db, "SELECT id FROM prospect_factory_map_opportunities WHERE id=? AND prospect_id=?", opportunityId, accountId);
  if (!row) throw new AccountMapInputError("opportunityId", "L’opportunité n’appartient pas à ce compte.");
  return row;
}
function requireSource(db: DB, accountId: string, sourceId: string) {
  if (!queryOne(db, "SELECT id FROM prospect_factory_map_sources WHERE id=? AND prospect_id=?", sourceId, accountId)) {
    throw new AccountMapInputError("sourceId", "La source n’appartient pas à ce compte.");
  }
}
function hasUsableTrace(db: DB, accountId: string, sourceIds: string[], locator?: string | null, excerpt?: string | null) {
  if (locator?.trim() || excerpt?.trim()) return true;
  return sourceIds.some((sourceId) => {
    const source = queryOne(db, "SELECT reference,locator,excerpt FROM prospect_factory_map_sources WHERE id=? AND prospect_id=?", sourceId, accountId);
    return Boolean(s(source?.reference)?.trim() || s(source?.locator)?.trim() || s(source?.excerpt)?.trim());
  });
}
function mapNode(row: Row): AccountMapNode {
  return { id: String(row.id), accountId: String(row.prospect_id), kind: row.kind as AccountMapNode["kind"],
    contactId: s(row.contact_id), unitKind: row.unit_kind as AccountMapNode["unitKind"],
    isRoot: Boolean(row.is_root), opportunityId: s(row.opportunity_id), name: String(row.contact_name ?? row.name),
    title: s(row.verified_title ?? row.input_title ?? row.title), notes: String(row.notes ?? ""),
    resolvedContactId: s(row.resolved_contact_id), version: n(row.version),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
function mapOpportunity(row: Row): AccountMapOpportunity {
  return { id: String(row.id), accountId: String(row.prospect_id), name: String(row.name),
    description: String(row.description), version: n(row.version),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
function mapSource(row: Row): AccountMapSource {
  return { id: String(row.id), accountId: String(row.prospect_id), kind: row.kind as AccountMapSource["kind"],
    label: String(row.label), reference: s(row.reference), collectedAt: s(row.collected_at),
    informationDate: s(row.information_date), locator: s(row.locator), excerpt: s(row.excerpt),
    retentionUntil: s(row.retention_until), version: n(row.version),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
function mapRelation(row: Row): AccountMapRelation {
  return { id: String(row.id), accountId: String(row.prospect_id), fromNodeId: String(row.from_node_id),
    toNodeId: String(row.to_node_id), kind: row.kind as MapRelationKind,
    opportunityId: s(row.opportunity_id), evidenceStatus: row.evidence_status as MapEvidenceStatus,
    sourceId: s(row.source_id), sourceIds: jsonArray(row.source_ids_json), label: s(row.label),
    notes: String(row.notes ?? ""), locator: s(row.locator), excerpt: s(row.excerpt),
    justification: s(row.justification), verificationQuestion: s(row.verification_question),
    validatedBy: s(row.validated_by), validatedAt: s(row.validated_at), version: n(row.version),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
function mapClaim(row: Row): AccountMapClaim {
  let value: unknown = null;
  try { value = JSON.parse(String(row.value_json)); } catch { /* Historical malformed value remains inspectable as null. */ }
  return { id: String(row.id), accountId: String(row.prospect_id), subjectNodeId: String(row.subject_node_id),
    opportunityId: s(row.opportunity_id), field: String(row.field), value,
    evidenceStatus: row.evidence_status as MapEvidenceStatus, sourceId: s(row.source_id),
    sourceIds: jsonArray(row.source_ids_json), locator: s(row.locator), excerpt: s(row.excerpt),
    justification: s(row.justification), verificationQuestion: s(row.verification_question),
    informationDate: s(row.information_date), validatedBy: s(row.validated_by),
    validatedAt: s(row.validated_at), version: n(row.version),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
function mapQuestion(row: Row): AccountMapQuestion {
  return { id: String(row.id), accountId: String(row.prospect_id), subjectNodeId: s(row.subject_node_id),
    opportunityId: s(row.opportunity_id), question: String(row.question), nextAction: s(row.next_action),
    status: row.status as AccountMapQuestion["status"], version: n(row.version),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
function mapRole(row: Row): AccountMapStakeholderRole {
  return { id: String(row.id), accountId: String(row.prospect_id), opportunityId: String(row.opportunity_id),
    personNodeId: String(row.person_node_id), role: row.role as AccountMapStakeholderRole["role"],
    evidenceStatus: row.evidence_status as MapEvidenceStatus, sourceId: s(row.source_id),
    sourceIds: jsonArray(row.source_ids_json), notes: String(row.notes ?? ""),
    validatedBy: s(row.validated_by), validatedAt: s(row.validated_at), version: n(row.version),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

/** The CRM contact list is mirrored as nodes only; no hierarchy is inferred. */
export function ensureAccountRootAndContacts(db: DB, accountId: string) {
  const account = requireAccount(db, accountId);
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`INSERT OR IGNORE INTO prospect_factory_map_nodes
      (id,prospect_id,kind,unit_kind,is_root,name,title,notes,created_at,updated_at)
      VALUES (?,?,'unit','account',1,?,NULL,'',?,?)`)
      .run(randomUUID(), accountId, String(account.company_name), timestamp, timestamp);
    const contacts = queryAll(db, "SELECT id,name,input_title,verified_title FROM prospect_factory_contacts WHERE prospect_id=?", accountId);
    const insert = db.prepare(`INSERT OR IGNORE INTO prospect_factory_map_nodes
      (id,prospect_id,kind,contact_id,name,title,notes,created_at,updated_at)
      VALUES (?,?,'person',?,?,?,?,?,?)`);
    for (const contact of contacts) insert.run(randomUUID(), accountId, String(contact.id), String(contact.name),
      s(contact.verified_title ?? contact.input_title), "", timestamp, timestamp);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

function readNode(db: DB, accountId: string, nodeId: string) {
  const row = queryOne(db, `SELECT n.*,c.name AS contact_name,c.input_title,c.verified_title
    FROM prospect_factory_map_nodes n LEFT JOIN prospect_factory_contacts c ON c.id=n.contact_id
    WHERE n.id=? AND n.prospect_id=?`, nodeId, accountId);
  return row ? mapNode(row) : null;
}
function readRelation(db: DB, accountId: string, relationId: string) {
  const row = queryOne(db, "SELECT * FROM prospect_factory_map_relations WHERE id=? AND prospect_id=?", relationId, accountId);
  if (!row) return null;
  const relation = mapRelation(row);
  return { ...relation, sourceIds: hydrateSourceIds(db, accountId, "relation", relationId, relation.sourceIds) };
}
function hydrateSourceIds(db: DB, accountId: string, kind: "relation" | "claim" | "stakeholder_role", id: string, stored: string[]) {
  const linked = queryAll(db, "SELECT source_id FROM prospect_factory_map_evidence_sources WHERE prospect_id=? AND subject_kind=? AND subject_id=?", accountId, kind, id)
    .map((row) => String(row.source_id));
  return [...new Set([...stored, ...linked])];
}

export function getAccountMap(accountId: string): AccountMapSnapshot | null {
  return withAccountMapDatabase((db) => {
    const account = accountRow(db, accountId);
    if (!account) return null;
    ensureAccountRootAndContacts(db, accountId);
    const nodes = queryAll(db, `SELECT n.*,c.name AS contact_name,c.input_title,c.verified_title
      FROM prospect_factory_map_nodes n LEFT JOIN prospect_factory_contacts c ON c.id=n.contact_id
      WHERE n.prospect_id=? ORDER BY n.is_root DESC,n.kind,n.name COLLATE NOCASE`, accountId)
      .map((row) => { const node = mapNode(row); return node.isRoot ? { ...node, name: String(account.company_name) } : node; });
    const opportunities = queryAll(db, "SELECT * FROM prospect_factory_map_opportunities WHERE prospect_id=? ORDER BY created_at", accountId).map(mapOpportunity);
    const relationRows = queryAll(db, "SELECT * FROM prospect_factory_map_relations WHERE prospect_id=? ORDER BY created_at", accountId);
    const sourceRows = queryAll(db, "SELECT * FROM prospect_factory_map_sources WHERE prospect_id=? ORDER BY collected_at DESC,created_at DESC", accountId);
    const claimRows = queryAll(db, "SELECT * FROM prospect_factory_map_claims WHERE prospect_id=? ORDER BY created_at", accountId);
    const questionRows = queryAll(db, "SELECT * FROM prospect_factory_map_questions WHERE prospect_id=? ORDER BY created_at", accountId);
    const roleRows = queryAll(db, "SELECT * FROM prospect_factory_map_stakeholder_roles WHERE prospect_id=? ORDER BY created_at, rowid", accountId);
    const evidenceRows = queryAll(db, "SELECT id,subject_kind,subject_id,source_id,locator,excerpt,evidence_type FROM prospect_factory_map_evidence_sources WHERE prospect_id=? ORDER BY rowid", accountId);
    const evidenceLinks: AccountMapEvidenceLink[] = evidenceRows.map((row) => ({
      id: String(row.id), accountId,
      subjectKind: String(row.subject_kind) as AccountMapEvidenceLink["subjectKind"],
      subjectId: String(row.subject_id), sourceId: String(row.source_id),
      locator: s(row.locator), excerpt: s(row.excerpt),
      evidenceType: s(row.evidence_type) as AccountMapEvidenceLink["evidenceType"]
    }));
    const evidenceBySubject = new Map<string, string[]>();
    for (const row of evidenceRows) {
      const key = `${String(row.subject_kind)}:${String(row.subject_id)}`;
      evidenceBySubject.set(key, [...(evidenceBySubject.get(key) ?? []), String(row.source_id)]);
    }
    const allSources = (kind: string, id: string, initial: string[]) => [...new Set([...initial, ...(evidenceBySubject.get(`${kind}:${id}`) ?? [])])];
    const positionRows = queryAll(db, "SELECT * FROM prospect_factory_map_layouts WHERE prospect_id=?", accountId);
    const viewportRows = queryAll(db, "SELECT * FROM prospect_factory_map_viewports WHERE prospect_id=?", accountId);
    const layouts = new Map<string, AccountMapLayout>();
    const layoutFor = (view: MapView, opportunityId: string | null) => {
      const key = `${view}:${opportunityId ?? ""}`;
      let value = layouts.get(key);
      if (!value) { value = { view, opportunityId, positions: [], viewport: null }; layouts.set(key, value); }
      return value;
    };
    layoutFor("organization", null);
    for (const row of positionRows) layoutFor(row.view as MapView, s(row.opportunity_key) || null)
      .positions.push({ nodeId: String(row.node_id), x: n(row.x), y: n(row.y) });
    for (const row of viewportRows) layoutFor(row.view as MapView, s(row.opportunity_key) || null)
      .viewport = { x: n(row.x), y: n(row.y), zoom: n(row.zoom) };
    const contacts = queryAll(db, "SELECT id,name,input_title,verified_title FROM prospect_factory_contacts WHERE prospect_id=? ORDER BY name COLLATE NOCASE", accountId);
    return { accountId, accountName: String(account.company_name), nodes,
      relations: relationRows.map((row) => { const relation = mapRelation(row); return { ...relation, sourceIds: allSources("relation", relation.id, relation.sourceIds) }; }),
      opportunities, sources: sourceRows.map(mapSource), evidenceLinks,
      claims: claimRows.map((row) => { const claim = mapClaim(row); return { ...claim, sourceIds: allSources("claim", claim.id, claim.sourceIds) }; }),
      questions: questionRows.map(mapQuestion),
      stakeholderRoles: roleRows.map((row) => { const role = mapRole(row); return { ...role, sourceIds: allSources("stakeholder_role", role.id, role.sourceIds) }; }), layouts: [...layouts.values()],
      availableContacts: contacts.map((row) => ({ id: String(row.id), name: String(row.name),
        inputTitle: s(row.input_title), verifiedTitle: s(row.verified_title) })) };
  });
}

export type CreateNodeInput =
  | { kind: "person"; contactId: string; notes?: string }
  | { kind: "unit"; unitKind: Exclude<AccountMapNode["unitKind"], null | "account">; name: string; title?: string | null; notes?: string }
  | { kind: "role_slot"; name: string; title?: string | null; notes?: string; opportunityId?: string | null };

export function createAccountMapNode(accountId: string, input: CreateNodeInput): AccountMapNode {
  return withAccountMapDatabase((db) => {
    requireAccount(db, accountId);
    const timestamp = now();
    if (input.kind === "person") {
      const contact = requireContact(db, accountId, input.contactId);
      db.prepare(`INSERT OR IGNORE INTO prospect_factory_map_nodes
        (id,prospect_id,kind,contact_id,name,title,notes,created_at,updated_at)
        VALUES (?,?,'person',?,?,?,?,?,?)`)
        .run(randomUUID(), accountId, input.contactId, String(contact.name),
          s(contact.verified_title ?? contact.input_title), input.notes ?? "", timestamp, timestamp);
      const row = queryOne(db, "SELECT id FROM prospect_factory_map_nodes WHERE prospect_id=? AND contact_id=?", accountId, input.contactId)!;
      return readNode(db, accountId, String(row.id))!;
    }
    if (input.kind === "role_slot") requireOpportunity(db, accountId, input.opportunityId);
    const nodeId = randomUUID();
    db.prepare(`INSERT INTO prospect_factory_map_nodes
      (id,prospect_id,kind,unit_kind,is_root,name,title,notes,opportunity_id,created_at,updated_at)
      VALUES (?,?,?,?,0,?,?,?,?,?,?)`)
      .run(nodeId, accountId, input.kind, input.kind === "unit" ? input.unitKind : null,
        input.name.trim(), nullable(input.title), input.notes ?? "",
        input.kind === "role_slot" ? nullable(input.opportunityId) : null, timestamp, timestamp);
    return readNode(db, accountId, nodeId)!;
  });
}

export function updateAccountMapNode(accountId: string, nodeId: string, patch: {
  expectedVersion: number; name?: string; title?: string | null; notes?: string;
  unitKind?: Exclude<AccountMapNode["unitKind"], null | "account">; resolvedContactId?: string | null;
}): AccountMapNode {
  return withAccountMapDatabase((db) => {
    const row = requireNode(db, accountId, nodeId);
    if (n(row.version) !== patch.expectedVersion) throw new AccountMapVersionConflictError(nodeId);
    if (Boolean(row.is_root)) throw new AccountMapInputError("nodeId", "Le compte racine se modifie dans sa fiche CRM.");
    if (row.kind === "person" && (patch.name !== undefined || patch.title !== undefined || patch.unitKind !== undefined || patch.resolvedContactId !== undefined)) {
      throw new AccountMapInputError("node", "L’identité et le poste du contact se modifient dans sa fiche CRM.");
    }
    if (row.kind !== "unit" && patch.unitKind !== undefined) throw new AccountMapInputError("unitKind", "Seule une unité a une catégorie d’unité.");
    if (row.kind !== "role_slot" && patch.resolvedContactId !== undefined) throw new AccountMapInputError("resolvedContactId", "Seule une fonction à identifier peut être résolue.");
    if (patch.resolvedContactId) requireContact(db, accountId, patch.resolvedContactId);
    const nextName = row.kind === "person" ? String(row.name) : patch.name ?? String(row.name);
    const changed = db.prepare(`UPDATE prospect_factory_map_nodes SET name=?,title=?,notes=?,unit_kind=?,resolved_contact_id=?,
      version=version+1,updated_at=? WHERE id=? AND prospect_id=? AND version=?`)
      .run(nextName, patch.title === undefined ? s(row.title) : patch.title,
        patch.notes ?? String(row.notes), patch.unitKind === undefined ? s(row.unit_kind) : patch.unitKind,
        patch.resolvedContactId === undefined ? s(row.resolved_contact_id) : patch.resolvedContactId,
        now(), nodeId, accountId, patch.expectedVersion).changes;
    if (!changed) throw new AccountMapVersionConflictError(nodeId);
    return readNode(db, accountId, nodeId)!;
  });
}

export function deleteAccountMapNode(accountId: string, nodeId: string): boolean {
  return withAccountMapDatabase((db) => {
    const row = queryOne(db, "SELECT kind,is_root FROM prospect_factory_map_nodes WHERE id=? AND prospect_id=?", nodeId, accountId);
    if (!row) return false;
    if (Boolean(row.is_root) || row.kind === "person") throw new AccountMapInputError("nodeId", "Les contacts CRM et le compte racine restent visibles dans la carte.");
    const dependencies = [
      queryOne(db, "SELECT 1 FROM prospect_factory_map_relations WHERE prospect_id=? AND (from_node_id=? OR to_node_id=?) LIMIT 1", accountId, nodeId, nodeId),
      queryOne(db, "SELECT 1 FROM prospect_factory_map_claims WHERE prospect_id=? AND subject_node_id=? LIMIT 1", accountId, nodeId),
      queryOne(db, "SELECT 1 FROM prospect_factory_map_questions WHERE prospect_id=? AND subject_node_id=? LIMIT 1", accountId, nodeId)
    ];
    if (dependencies.some(Boolean)) throw new AccountMapInputError("nodeId", "Cet élément possède des liens ou des informations ; retirez-les explicitement avant sa suppression.");
    return n(db.prepare("DELETE FROM prospect_factory_map_nodes WHERE id=? AND prospect_id=?").run(nodeId, accountId).changes) > 0;
  });
}

export function createAccountMapOpportunity(accountId: string, input: { name: string; description?: string }): AccountMapOpportunity {
  return withAccountMapDatabase((db) => {
    requireAccount(db, accountId);
    const id = randomUUID(); const timestamp = now();
    db.prepare(`INSERT INTO prospect_factory_map_opportunities
      (id,prospect_id,name,description,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
      .run(id, accountId, input.name.trim(), input.description ?? "", timestamp, timestamp);
    return mapOpportunity(queryOne(db, "SELECT * FROM prospect_factory_map_opportunities WHERE id=?", id)!);
  });
}
export function updateAccountMapOpportunity(accountId: string, id: string, patch: { expectedVersion: number; name?: string; description?: string }): AccountMapOpportunity | null {
  return withAccountMapDatabase((db) => {
    const row = queryOne(db, "SELECT * FROM prospect_factory_map_opportunities WHERE id=? AND prospect_id=?", id, accountId);
    if (!row) return null;
    if (n(row.version) !== patch.expectedVersion) throw new AccountMapVersionConflictError(id);
    const changed = db.prepare(`UPDATE prospect_factory_map_opportunities SET name=?,description=?,version=version+1,updated_at=? WHERE id=? AND prospect_id=? AND version=?`)
      .run(patch.name ?? String(row.name), patch.description ?? String(row.description), now(), id, accountId, patch.expectedVersion).changes;
    if (!changed) throw new AccountMapVersionConflictError(id);
    return mapOpportunity(queryOne(db, "SELECT * FROM prospect_factory_map_opportunities WHERE id=?", id)!);
  });
}
export function deleteAccountMapOpportunity(accountId: string, id: string): boolean {
  return withAccountMapDatabase((db) => {
    const dependencies = [
      queryOne(db, "SELECT 1 FROM prospect_factory_map_nodes WHERE prospect_id=? AND opportunity_id=? LIMIT 1", accountId, id),
      queryOne(db, "SELECT 1 FROM prospect_factory_map_relations WHERE prospect_id=? AND opportunity_id=? LIMIT 1", accountId, id),
      queryOne(db, "SELECT 1 FROM prospect_factory_map_claims WHERE prospect_id=? AND opportunity_id=? LIMIT 1", accountId, id),
      queryOne(db, "SELECT 1 FROM prospect_factory_map_questions WHERE prospect_id=? AND opportunity_id=? LIMIT 1", accountId, id),
      queryOne(db, "SELECT 1 FROM prospect_factory_map_stakeholder_roles WHERE prospect_id=? AND opportunity_id=? LIMIT 1", accountId, id)
    ];
    if (dependencies.some(Boolean)) throw new AccountMapInputError("opportunityId", "Cette opportunité contient des éléments de carte ; elle ne peut pas être supprimée.");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM prospect_factory_map_layouts WHERE prospect_id=? AND view='decision' AND opportunity_key=?").run(accountId, id);
      db.prepare("DELETE FROM prospect_factory_map_viewports WHERE prospect_id=? AND view='decision' AND opportunity_key=?").run(accountId, id);
      const deleted = n(db.prepare("DELETE FROM prospect_factory_map_opportunities WHERE id=? AND prospect_id=?").run(id, accountId).changes) > 0;
      db.exec("COMMIT"); return deleted;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  });
}

export function createAccountMapSource(accountId: string, input: {
  kind: AccountMapSource["kind"]; label: string; reference?: string | null; collectedAt?: string | null;
  informationDate?: string | null; locator?: string | null; excerpt?: string | null;
  retentionUntil?: string | null;
}): AccountMapSource {
  return withAccountMapDatabase((db) => {
    requireAccount(db, accountId);
    const id = randomUUID(); const timestamp = now();
    db.prepare(`INSERT INTO prospect_factory_map_sources
      (id,prospect_id,kind,label,reference,collected_at,information_date,locator,excerpt,retention_until,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, accountId, input.kind, input.label.trim(),
      nullable(input.reference), input.collectedAt ?? timestamp, nullable(input.informationDate),
      nullable(input.locator), nullable(input.excerpt), nullable(input.retentionUntil), timestamp, timestamp);
    return mapSource(queryOne(db, "SELECT * FROM prospect_factory_map_sources WHERE id=?", id)!);
  });
}
export function updateAccountMapSource(accountId: string, id: string, patch: {
  expectedVersion: number; kind?: AccountMapSource["kind"]; label?: string;
  reference?: string | null; collectedAt?: string | null; informationDate?: string | null;
  locator?: string | null; excerpt?: string | null; retentionUntil?: string | null;
}): AccountMapSource | null {
  return withAccountMapDatabase((db) => {
    const row = queryOne(db, "SELECT * FROM prospect_factory_map_sources WHERE id=? AND prospect_id=?", id, accountId);
    if (!row) return null;
    if (n(row.version) !== patch.expectedVersion) throw new AccountMapVersionConflictError(id);
    const substantiveEdit = (patch.kind !== undefined && patch.kind !== row.kind) ||
      (patch.reference !== undefined && patch.reference !== s(row.reference)) ||
      (patch.collectedAt !== undefined && patch.collectedAt !== s(row.collected_at)) ||
      (patch.informationDate !== undefined && patch.informationDate !== s(row.information_date)) ||
      (patch.locator !== undefined && patch.locator !== s(row.locator)) ||
      (patch.excerpt !== undefined && patch.excerpt !== s(row.excerpt));
    if (substantiveEdit) {
      const confirmed = queryOne(db, `SELECT 1 AS used FROM prospect_factory_map_relations
          WHERE prospect_id=? AND source_id=? AND evidence_status='confirmed'
        UNION SELECT 1 FROM prospect_factory_map_claims
          WHERE prospect_id=? AND source_id=? AND evidence_status='confirmed'
        UNION SELECT 1 FROM prospect_factory_map_stakeholder_roles
          WHERE prospect_id=? AND source_id=? AND evidence_status='confirmed'
        UNION SELECT 1 FROM prospect_factory_map_evidence_sources es
          WHERE es.prospect_id=? AND es.source_id=? AND (
            (es.subject_kind='relation' AND EXISTS (SELECT 1 FROM prospect_factory_map_relations r WHERE r.id=es.subject_id AND r.evidence_status='confirmed')) OR
            (es.subject_kind='claim' AND EXISTS (SELECT 1 FROM prospect_factory_map_claims c WHERE c.id=es.subject_id AND c.evidence_status='confirmed')) OR
            (es.subject_kind='stakeholder_role' AND EXISTS (SELECT 1 FROM prospect_factory_map_stakeholder_roles sr WHERE sr.id=es.subject_id AND sr.evidence_status='confirmed'))
          ) LIMIT 1`, accountId, id, accountId, id, accountId, id, accountId, id);
      if (confirmed) throw new AccountMapInputError("sourceId", "Cette source étaye une information confirmée. Ajoutez une source corrigée, puis revalidez l’information.");
    }
    const changed = db.prepare(`UPDATE prospect_factory_map_sources SET kind=?,label=?,reference=?,collected_at=?,
      information_date=?,locator=?,excerpt=?,retention_until=?,version=version+1,updated_at=?
      WHERE id=? AND prospect_id=? AND version=?`).run(patch.kind ?? String(row.kind), patch.label ?? String(row.label),
      patch.reference === undefined ? s(row.reference) : patch.reference,
      patch.collectedAt === undefined ? s(row.collected_at) : patch.collectedAt,
      patch.informationDate === undefined ? s(row.information_date) : patch.informationDate,
      patch.locator === undefined ? s(row.locator) : patch.locator,
      patch.excerpt === undefined ? s(row.excerpt) : patch.excerpt,
      patch.retentionUntil === undefined ? s(row.retention_until) : patch.retentionUntil,
      now(), id, accountId, patch.expectedVersion).changes;
    if (!changed) throw new AccountMapVersionConflictError(id);
    return mapSource(queryOne(db, "SELECT * FROM prospect_factory_map_sources WHERE id=?", id)!);
  });
}
export function deleteAccountMapSource(accountId: string, id: string): boolean {
  return withAccountMapDatabase((db) => {
    const used = [
      queryOne(db, "SELECT 1 FROM prospect_factory_map_relations WHERE prospect_id=? AND source_id=? LIMIT 1", accountId, id),
      queryOne(db, "SELECT 1 FROM prospect_factory_map_claims WHERE prospect_id=? AND source_id=? LIMIT 1", accountId, id),
      queryOne(db, "SELECT 1 FROM prospect_factory_map_stakeholder_roles WHERE prospect_id=? AND source_id=? LIMIT 1", accountId, id),
      queryOne(db, "SELECT 1 FROM prospect_factory_map_evidence_sources WHERE prospect_id=? AND source_id=? LIMIT 1", accountId, id)
    ];
    if (used.some(Boolean)) throw new AccountMapInputError("sourceId", "Cette source étaye des informations ; retirez ces liens avant sa suppression.");
    return n(db.prepare("DELETE FROM prospect_factory_map_sources WHERE id=? AND prospect_id=?").run(id, accountId).changes) > 0;
  });
}

type EvidenceInput = {
  evidenceStatus?: MapEvidenceStatus; sourceId?: string | null; sourceIds?: string[];
  locator?: string | null; excerpt?: string | null; justification?: string | null;
  verificationQuestion?: string | null;
};
function sameSources(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const orderedLeft = [...left].sort();
  const orderedRight = [...right].sort();
  return orderedLeft.every((id, index) => id === orderedRight[index]);
}
function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function assertExplicitRevalidation(currentStatus: MapEvidenceStatus, nextStatus: MapEvidenceStatus,
  materiallyChanged: boolean, revalidate?: boolean) {
  if (currentStatus === "confirmed" && nextStatus === "confirmed" && materiallyChanged && !revalidate) {
    throw new AccountMapInputError("revalidate", "La preuve ou l’information confirmée a changé ; confirmez explicitement sa nouvelle validation.");
  }
}
function checkedEvidence(db: DB, accountId: string, input: EvidenceInput, actorId?: string | null,
  allowUnexplainedHypothesis = false) {
  const status = input.evidenceStatus ?? "hypothesis";
  const sourceIds = [...new Set([...(input.sourceIds ?? []), ...(input.sourceId ? [input.sourceId] : [])])];
  for (const sourceId of sourceIds) requireSource(db, accountId, sourceId);
  if (status !== "hypothesis" && sourceIds.length === 0) throw new AccountMapInputError("sourceIds", "Une information observée ou validée exige une source.");
  if (status !== "hypothesis" && !hasUsableTrace(db, accountId, sourceIds, input.locator, input.excerpt)) {
    throw new AccountMapInputError("sourceIds", "La source doit contenir une référence, un extrait ou un repère consultable.");
  }
  if (status === "confirmed" && !actorId) throw new AccountMapInputError("evidenceStatus", "Une confirmation exige une session d’administration traçable.");
  if (status === "hypothesis" && !allowUnexplainedHypothesis && (!input.justification?.trim() || !input.verificationQuestion?.trim())) {
    throw new AccountMapInputError("justification", "Un lien supposé exige une justification et une question de vérification.");
  }
  return { status, sourceId: input.sourceId ?? sourceIds[0] ?? null, sourceIds,
    validatedBy: status === "confirmed" ? actorId ?? null : null,
    validatedAt: status === "confirmed" ? now() : null };
}
function syncEvidenceSources(db: DB, accountId: string, subjectKind: "relation" | "claim" | "stakeholder_role", subjectId: string,
  sourceIds: string[], locator?: string | null, excerpt?: string | null) {
  const current = queryAll(db, "SELECT source_id FROM prospect_factory_map_evidence_sources WHERE prospect_id=? AND subject_kind=? AND subject_id=?",
    accountId, subjectKind, subjectId);
  const desired = new Set(sourceIds);
  const retained = new Set<string>();
  for (const row of current) {
    const sourceId = String(row.source_id);
    if (desired.has(sourceId)) {
      retained.add(sourceId);
    } else {
      db.prepare("DELETE FROM prospect_factory_map_evidence_sources WHERE prospect_id=? AND subject_kind=? AND subject_id=? AND source_id=?")
        .run(accountId, subjectKind, subjectId, sourceId);
    }
  }
  const insert = db.prepare(`INSERT INTO prospect_factory_map_evidence_sources
    (id,prospect_id,subject_kind,subject_id,source_id,locator,excerpt) VALUES (?,?,?,?,?,?,?)`);
  for (const sourceId of sourceIds) {
    if (!retained.has(sourceId)) insert.run(randomUUID(), accountId, subjectKind, subjectId, sourceId, nullable(locator), nullable(excerpt));
  }
}
function assertRelationEndpoints(from: Row, to: Row, kind: MapRelationKind) {
  const valid = kind === "unqualified" ? true
    : kind === "works_in" ? (from.kind === "person" || from.kind === "role_slot") && to.kind === "unit"
    : kind === "part_of" ? from.kind === "unit" && to.kind === "unit"
      : from.kind === "person" && to.kind === "person";
  if (!valid) throw new AccountMapInputError("kind", "Ce type de lien ne correspond pas aux nœuds choisis.");
}
function assertNoUnitCycle(db: DB, accountId: string, fromId: string, toId: string, ignoreRelationId?: string) {
  const row = queryOne(db, `WITH RECURSIVE ancestors(id) AS (
    SELECT to_node_id FROM prospect_factory_map_relations WHERE prospect_id=? AND kind='part_of' AND from_node_id=? AND id<>?
    UNION SELECT r.to_node_id FROM prospect_factory_map_relations r JOIN ancestors a ON r.from_node_id=a.id
    WHERE r.prospect_id=? AND r.kind='part_of' AND r.id<>?
  ) SELECT 1 AS cycle FROM ancestors WHERE id=? LIMIT 1`, accountId, toId, ignoreRelationId ?? "", accountId, ignoreRelationId ?? "", fromId);
  if (row) throw new AccountMapInputError("relation", "Ce rattachement créerait un cycle entre unités.");
}

export type CreateRelationInput = EvidenceInput & {
  fromNodeId: string; toNodeId: string; kind: MapRelationKind; opportunityId?: string | null;
  label?: string | null; notes?: string;
};
export function createAccountMapRelation(accountId: string, input: CreateRelationInput, actorId?: string | null): AccountMapRelation {
  return withAccountMapDatabase((db) => {
    requireAccount(db, accountId);
    if (input.fromNodeId === input.toNodeId || !MAP_RELATION_KINDS.includes(input.kind)) throw new AccountMapInputError("relation", "Lien invalide.");
    const from = requireNode(db, accountId, input.fromNodeId); const to = requireNode(db, accountId, input.toNodeId);
    assertRelationEndpoints(from, to, input.kind);
    requireOpportunity(db, accountId, input.opportunityId);
    if (input.kind === "part_of") assertNoUnitCycle(db, accountId, input.fromNodeId, input.toNodeId);
    const evidence = checkedEvidence(db, accountId, input, actorId, true);
    const id = randomUUID(); const timestamp = now();
    db.exec("BEGIN IMMEDIATE");
    try {
      if (input.kind === "unqualified") {
        const existing = queryOne(db, `SELECT id FROM prospect_factory_map_relations
          WHERE prospect_id=? AND opportunity_id IS ? AND kind='unqualified'
            AND ((from_node_id=? AND to_node_id=?) OR (from_node_id=? AND to_node_id=?))
          LIMIT 1`, accountId, nullable(input.opportunityId), input.fromNodeId, input.toNodeId,
          input.toNodeId, input.fromNodeId);
        if (existing) {
          db.exec("COMMIT");
          return readRelation(db, accountId, String(existing.id))!;
        }
      }
      db.prepare(`INSERT INTO prospect_factory_map_relations
        (id,prospect_id,from_node_id,to_node_id,kind,opportunity_id,evidence_status,source_id,source_ids_json,
         label,notes,locator,excerpt,justification,verification_question,validated_by,validated_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, accountId, input.fromNodeId, input.toNodeId, input.kind, nullable(input.opportunityId),
          evidence.status, evidence.sourceId, JSON.stringify(evidence.sourceIds), nullable(input.label), input.notes ?? "",
          nullable(input.locator), nullable(input.excerpt), nullable(input.justification), nullable(input.verificationQuestion),
          evidence.validatedBy, evidence.validatedAt, timestamp, timestamp);
      syncEvidenceSources(db, accountId, "relation", id, evidence.sourceIds, input.locator, input.excerpt);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return readRelation(db, accountId, id)!;
  });
}

export function updateAccountMapRelation(accountId: string, relationId: string,
  patch: Partial<CreateRelationInput> & { expectedVersion: number; revalidate?: true }, actorId?: string | null): AccountMapRelation | null {
  return withAccountMapDatabase((db) => {
    const current = readRelation(db, accountId, relationId);
    if (!current) return null;
    if (current.version !== patch.expectedVersion) throw new AccountMapVersionConflictError(relationId);
    const next = { ...current, ...patch };
    if (next.fromNodeId === next.toNodeId) throw new AccountMapInputError("relation", "Un nœud ne peut pas être relié à lui-même.");
    const from = requireNode(db, accountId, next.fromNodeId); const to = requireNode(db, accountId, next.toNodeId);
    assertRelationEndpoints(from, to, next.kind);
    requireOpportunity(db, accountId, next.opportunityId);
    if (next.kind === "part_of") assertNoUnitCycle(db, accountId, next.fromNodeId, next.toNodeId, relationId);
    const materiallyChanged = next.fromNodeId !== current.fromNodeId || next.toNodeId !== current.toNodeId ||
      next.kind !== current.kind || next.opportunityId !== current.opportunityId ||
      next.evidenceStatus !== current.evidenceStatus || next.sourceId !== current.sourceId ||
      !sameSources(next.sourceIds, current.sourceIds) || next.locator !== current.locator ||
      next.excerpt !== current.excerpt || next.justification !== current.justification ||
      next.verificationQuestion !== current.verificationQuestion;
    assertExplicitRevalidation(current.evidenceStatus, next.evidenceStatus, materiallyChanged, patch.revalidate);
    const evidence = materiallyChanged || patch.revalidate ? checkedEvidence(db, accountId, next, actorId, true)
      : { status: current.evidenceStatus, sourceId: current.sourceId, sourceIds: current.sourceIds,
          validatedBy: current.validatedBy, validatedAt: current.validatedAt };
    db.exec("BEGIN IMMEDIATE");
    try {
      const changed = db.prepare(`UPDATE prospect_factory_map_relations SET from_node_id=?,to_node_id=?,kind=?,opportunity_id=?,
        evidence_status=?,source_id=?,source_ids_json=?,label=?,notes=?,locator=?,excerpt=?,justification=?,
        verification_question=?,validated_by=?,validated_at=?,version=version+1,updated_at=?
        WHERE id=? AND prospect_id=? AND version=?`)
        .run(next.fromNodeId, next.toNodeId, next.kind, nullable(next.opportunityId), evidence.status,
          evidence.sourceId, JSON.stringify(evidence.sourceIds), nullable(next.label), next.notes ?? "",
          nullable(next.locator), nullable(next.excerpt), nullable(next.justification), nullable(next.verificationQuestion),
          evidence.validatedBy, evidence.validatedAt, now(), relationId, accountId, patch.expectedVersion).changes;
      if (!changed) throw new AccountMapVersionConflictError(relationId);
      if (materiallyChanged || patch.revalidate) syncEvidenceSources(db, accountId, "relation", relationId, evidence.sourceIds, next.locator, next.excerpt);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return readRelation(db, accountId, relationId)!;
  });
}
export function deleteAccountMapRelation(accountId: string, id: string): boolean {
  return withAccountMapDatabase((db) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM prospect_factory_map_evidence_sources WHERE prospect_id=? AND subject_kind='relation' AND subject_id=?").run(accountId, id);
      const deleted = n(db.prepare("DELETE FROM prospect_factory_map_relations WHERE id=? AND prospect_id=?").run(id, accountId).changes) > 0;
      db.exec("COMMIT"); return deleted;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  });
}

export function createAccountMapQuestion(accountId: string, input: {
  subjectNodeId?: string | null; opportunityId?: string | null; question: string; nextAction?: string | null;
}): AccountMapQuestion {
  return withAccountMapDatabase((db) => {
    requireAccount(db, accountId);
    if (input.subjectNodeId) requireNode(db, accountId, input.subjectNodeId);
    requireOpportunity(db, accountId, input.opportunityId);
    const id = randomUUID(); const timestamp = now();
    db.prepare(`INSERT INTO prospect_factory_map_questions
      (id,prospect_id,subject_node_id,opportunity_id,question,next_action,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'open',?,?)`)
      .run(id, accountId, nullable(input.subjectNodeId), nullable(input.opportunityId),
        input.question.trim(), nullable(input.nextAction), timestamp, timestamp);
    return mapQuestion(queryOne(db, "SELECT * FROM prospect_factory_map_questions WHERE id=?", id)!);
  });
}
export function updateAccountMapQuestion(accountId: string, id: string, patch: {
  expectedVersion: number; question?: string; nextAction?: string | null;
  status?: AccountMapQuestion["status"];
}): AccountMapQuestion | null {
  return withAccountMapDatabase((db) => {
    const row = queryOne(db, "SELECT * FROM prospect_factory_map_questions WHERE id=? AND prospect_id=?", id, accountId);
    if (!row) return null;
    if (n(row.version) !== patch.expectedVersion) throw new AccountMapVersionConflictError(id);
    const changed = db.prepare(`UPDATE prospect_factory_map_questions SET question=?,next_action=?,status=?,version=version+1,updated_at=?
      WHERE id=? AND prospect_id=? AND version=?`).run(patch.question ?? String(row.question),
      patch.nextAction === undefined ? s(row.next_action) : patch.nextAction,
      patch.status ?? String(row.status), now(), id, accountId, patch.expectedVersion).changes;
    if (!changed) throw new AccountMapVersionConflictError(id);
    return mapQuestion(queryOne(db, "SELECT * FROM prospect_factory_map_questions WHERE id=?", id)!);
  });
}
export function deleteAccountMapQuestion(accountId: string, id: string): boolean {
  return withAccountMapDatabase((db) => n(db.prepare("DELETE FROM prospect_factory_map_questions WHERE id=? AND prospect_id=?").run(id, accountId).changes) > 0);
}

export function saveAccountMapLayout(accountId: string, input: AccountMapLayout): AccountMapLayout {
  return withAccountMapDatabase((db) => {
    requireAccount(db, accountId);
    if (input.view === "organization" && input.opportunityId !== null) throw new AccountMapInputError("opportunityId", "La vue Organisation n’est pas liée à une opportunité.");
    if (input.view === "decision" && !input.opportunityId) throw new AccountMapInputError("opportunityId", "Choisissez une opportunité pour la vue Décision.");
    requireOpportunity(db, accountId, input.opportunityId);
    const key = input.opportunityId ?? ""; const timestamp = now();
    db.exec("BEGIN IMMEDIATE");
    try {
      const upsert = db.prepare(`INSERT INTO prospect_factory_map_layouts
        (prospect_id,view,opportunity_key,node_id,x,y,updated_at) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(prospect_id,view,opportunity_key,node_id) DO UPDATE SET x=excluded.x,y=excluded.y,updated_at=excluded.updated_at`);
      for (const position of input.positions) {
        requireNode(db, accountId, position.nodeId);
        upsert.run(accountId, input.view, key, position.nodeId, position.x, position.y, timestamp);
      }
      if (input.viewport) db.prepare(`INSERT INTO prospect_factory_map_viewports
        (prospect_id,view,opportunity_key,x,y,zoom,updated_at) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(prospect_id,view,opportunity_key) DO UPDATE SET x=excluded.x,y=excluded.y,zoom=excluded.zoom,updated_at=excluded.updated_at`)
        .run(accountId, input.view, key, input.viewport.x, input.viewport.y, input.viewport.zoom, timestamp);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    const positions = queryAll(db, "SELECT node_id,x,y FROM prospect_factory_map_layouts WHERE prospect_id=? AND view=? AND opportunity_key=?", accountId, input.view, key)
      .map((row) => ({ nodeId: String(row.node_id), x: n(row.x), y: n(row.y) }));
    const viewport = queryOne(db, "SELECT x,y,zoom FROM prospect_factory_map_viewports WHERE prospect_id=? AND view=? AND opportunity_key=?", accountId, input.view, key);
    return { view: input.view, opportunityId: input.opportunityId, positions,
      viewport: viewport ? { x: n(viewport.x), y: n(viewport.y), zoom: n(viewport.zoom) } : null };
  });
}

export type CreateClaimInput = EvidenceInput & {
  subjectNodeId: string; opportunityId?: string | null; field: string; value: unknown;
  informationDate?: string | null;
};
function assertPowerClaim(input: CreateClaimInput) {
  if (!input.field.startsWith("power:")) return;
  if (!input.value || typeof input.value !== "object") throw new AccountMapInputError("value", "Un pouvoir exige oui, non ou inconnu.");
  const value = input.value as Record<string, unknown>;
  if (!["yes", "no", "unknown"].includes(String(value.answer))) throw new AccountMapInputError("value.answer", "Réponse de pouvoir invalide.");
  if (value.budgetLimit !== undefined && value.budgetLimit !== null) {
    if (value.answer !== "yes" || input.evidenceStatus !== "confirmed") throw new AccountMapInputError("value.budgetLimit", "Le plafond exige un pouvoir confirmé.");
    const limit = value.budgetLimit as Record<string, unknown>;
    if (!limit || typeof limit.amount !== "number" || !Number.isFinite(limit.amount) || limit.amount < 0 ||
      typeof limit.currency !== "string" || !/^[A-Z]{3}$/.test(limit.currency)) {
      throw new AccountMapInputError("value.budgetLimit", "Montant et devise ISO obligatoires.");
    }
  }
}
function readClaim(db: DB, accountId: string, claimId: string) {
  const row = queryOne(db, "SELECT * FROM prospect_factory_map_claims WHERE id=? AND prospect_id=?", claimId, accountId);
  if (!row) return null;
  const claim = mapClaim(row);
  return { ...claim, sourceIds: hydrateSourceIds(db, accountId, "claim", claimId, claim.sourceIds) };
}
function assertNoConflictingConfirmedClaim(db: DB, accountId: string, claimId: string,
  subjectNodeId: string, opportunityId: string | null | undefined, field: string, value: unknown) {
  const confirmed = queryAll(db, `SELECT value_json FROM prospect_factory_map_claims
    WHERE prospect_id=? AND subject_node_id=? AND opportunity_id IS ? AND field=?
      AND evidence_status='confirmed' AND id<>?`,
    accountId, subjectNodeId, nullable(opportunityId), field, claimId);
  if (confirmed.some((row) => {
    try { return !sameValue(JSON.parse(String(row.value_json)), value); }
    catch { return true; }
  })) {
    throw new AccountMapInputError("evidenceStatus",
      "Une valeur différente est déjà confirmée. Déclassez-la explicitement avant de confirmer cette information.");
  }
}
export function createAccountMapClaim(accountId: string, input: CreateClaimInput, actorId?: string | null): AccountMapClaim {
  return withAccountMapDatabase((db) => {
    requireNode(db, accountId, input.subjectNodeId);
    requireOpportunity(db, accountId, input.opportunityId);
    assertPowerClaim(input);
    if (input.value === undefined) throw new AccountMapInputError("value", "Valeur de l’information manquante.");
    const evidence = checkedEvidence(db, accountId, input, actorId);
    const id = randomUUID(); const timestamp = now();
    db.exec("BEGIN IMMEDIATE");
    try {
      if (evidence.status === "confirmed") assertNoConflictingConfirmedClaim(db, accountId, id,
        input.subjectNodeId, input.opportunityId, input.field, input.value);
      db.prepare(`INSERT INTO prospect_factory_map_claims
        (id,prospect_id,subject_node_id,opportunity_id,field,value_json,evidence_status,source_id,source_ids_json,
         locator,excerpt,justification,verification_question,information_date,validated_by,validated_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, accountId, input.subjectNodeId, nullable(input.opportunityId), input.field,
          JSON.stringify(input.value), evidence.status, evidence.sourceId, JSON.stringify(evidence.sourceIds),
          nullable(input.locator), nullable(input.excerpt), nullable(input.justification),
          nullable(input.verificationQuestion), nullable(input.informationDate), evidence.validatedBy,
          evidence.validatedAt, timestamp, timestamp);
      syncEvidenceSources(db, accountId, "claim", id, evidence.sourceIds, input.locator, input.excerpt);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return readClaim(db, accountId, id)!;
  });
}
export function updateAccountMapClaim(accountId: string, claimId: string,
  patch: Partial<CreateClaimInput> & { expectedVersion: number; revalidate?: true }, actorId?: string | null): AccountMapClaim | null {
  return withAccountMapDatabase((db) => {
    const current = readClaim(db, accountId, claimId);
    if (!current) return null;
    if (current.version !== patch.expectedVersion) throw new AccountMapVersionConflictError(claimId);
    const next = { ...current, ...patch };
    requireNode(db, accountId, next.subjectNodeId);
    requireOpportunity(db, accountId, next.opportunityId);
    assertPowerClaim(next);
    const materiallyChanged = next.subjectNodeId !== current.subjectNodeId || next.opportunityId !== current.opportunityId ||
      next.field !== current.field || !sameValue(next.value, current.value) ||
      next.evidenceStatus !== current.evidenceStatus || next.sourceId !== current.sourceId ||
      !sameSources(next.sourceIds, current.sourceIds) || next.locator !== current.locator ||
      next.excerpt !== current.excerpt || next.justification !== current.justification ||
      next.verificationQuestion !== current.verificationQuestion || next.informationDate !== current.informationDate;
    assertExplicitRevalidation(current.evidenceStatus, next.evidenceStatus, materiallyChanged, patch.revalidate);
    const evidence = materiallyChanged || patch.revalidate ? checkedEvidence(db, accountId, next, actorId)
      : { status: current.evidenceStatus, sourceId: current.sourceId, sourceIds: current.sourceIds,
          validatedBy: current.validatedBy, validatedAt: current.validatedAt };
    // Keep the previous validator on an obsolete claim when the fact and its proof stay unchanged.
    const preservePriorValidation = current.evidenceStatus === "confirmed" && next.evidenceStatus === "obsolete" &&
      next.subjectNodeId === current.subjectNodeId && next.opportunityId === current.opportunityId &&
      next.field === current.field && sameValue(next.value, current.value) &&
      next.sourceId === current.sourceId && sameSources(next.sourceIds, current.sourceIds) &&
      next.locator === current.locator && next.excerpt === current.excerpt &&
      next.informationDate === current.informationDate;
    db.exec("BEGIN IMMEDIATE");
    try {
      if (evidence.status === "confirmed") assertNoConflictingConfirmedClaim(db, accountId, claimId,
        next.subjectNodeId, next.opportunityId, next.field, next.value);
      const changed = db.prepare(`UPDATE prospect_factory_map_claims SET subject_node_id=?,opportunity_id=?,field=?,value_json=?,
        evidence_status=?,source_id=?,source_ids_json=?,locator=?,excerpt=?,justification=?,verification_question=?,
        information_date=?,validated_by=?,validated_at=?,version=version+1,updated_at=?
        WHERE id=? AND prospect_id=? AND version=?`)
        .run(next.subjectNodeId, nullable(next.opportunityId), next.field, JSON.stringify(next.value), evidence.status,
          evidence.sourceId, JSON.stringify(evidence.sourceIds), nullable(next.locator), nullable(next.excerpt),
          nullable(next.justification), nullable(next.verificationQuestion), nullable(next.informationDate),
          preservePriorValidation ? current.validatedBy : evidence.validatedBy,
          preservePriorValidation ? current.validatedAt : evidence.validatedAt,
          now(), claimId, accountId, patch.expectedVersion).changes;
      if (!changed) throw new AccountMapVersionConflictError(claimId);
      if (materiallyChanged || patch.revalidate) syncEvidenceSources(db, accountId, "claim", claimId, evidence.sourceIds, next.locator, next.excerpt);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return readClaim(db, accountId, claimId)!;
  });
}
export function deleteAccountMapClaim(accountId: string, claimId: string): boolean {
  return withAccountMapDatabase((db) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM prospect_factory_map_evidence_sources WHERE prospect_id=? AND subject_kind='claim' AND subject_id=?").run(accountId, claimId);
      const deleted = n(db.prepare("DELETE FROM prospect_factory_map_claims WHERE id=? AND prospect_id=?").run(claimId, accountId).changes) > 0;
      db.exec("COMMIT"); return deleted;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  });
}

export type CreateStakeholderInput = {
  opportunityId: string; personNodeId: string; role: AccountMapStakeholderRole["role"];
  evidenceStatus?: MapEvidenceStatus; sourceId?: string | null; sourceIds?: string[]; notes?: string;
};
function checkedRoleEvidence(db: DB, accountId: string, input: CreateStakeholderInput, actorId?: string | null) {
  const status = input.evidenceStatus ?? "hypothesis";
  if (input.role === "confirmed_champion" && status !== "confirmed") {
    throw new AccountMapInputError("role", "Champion confirmé exige une validation confirmée et sourcée.");
  }
  const sourceIds = [...new Set([...(input.sourceIds ?? []), ...(input.sourceId ? [input.sourceId] : [])])];
  for (const sourceId of sourceIds) requireSource(db, accountId, sourceId);
  if (status !== "hypothesis" && sourceIds.length === 0) throw new AccountMapInputError("sourceIds", "Un rôle observé ou confirmé exige une source.");
  if (status !== "hypothesis" && !hasUsableTrace(db, accountId, sourceIds)) {
    throw new AccountMapInputError("sourceIds", "La source du rôle doit contenir une référence, un extrait ou un repère consultable.");
  }
  if (status === "confirmed" && !actorId) throw new AccountMapInputError("evidenceStatus", "Confirmation sans acteur authentifié refusée.");
  return { status, sourceIds, sourceId: input.sourceId ?? sourceIds[0] ?? null,
    validatedBy: status === "confirmed" ? actorId ?? null : null,
    validatedAt: status === "confirmed" ? now() : null };
}
function readRole(db: DB, accountId: string, id: string) {
  const row = queryOne(db, "SELECT * FROM prospect_factory_map_stakeholder_roles WHERE id=? AND prospect_id=?", id, accountId);
  if (!row) return null;
  const role = mapRole(row);
  return { ...role, sourceIds: hydrateSourceIds(db, accountId, "stakeholder_role", id, role.sourceIds) };
}
export function createAccountMapStakeholder(accountId: string, input: CreateStakeholderInput, actorId?: string | null): AccountMapStakeholderRole {
  return withAccountMapDatabase((db) => {
    requireOpportunity(db, accountId, input.opportunityId);
    const person = requireNode(db, accountId, input.personNodeId);
    if (person.kind !== "person") throw new AccountMapInputError("personNodeId", "Le rôle commercial exige une personne réelle.");
    const existing = queryOne(db, `SELECT id FROM prospect_factory_map_stakeholder_roles
      WHERE prospect_id=? AND opportunity_id=? AND person_node_id=? AND role=?`,
      accountId, input.opportunityId, input.personNodeId, input.role);
    if (existing) return readRole(db, accountId, String(existing.id))!;
    const evidence = checkedRoleEvidence(db, accountId, input, actorId);
    const id = randomUUID(); const timestamp = now();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`INSERT INTO prospect_factory_map_stakeholder_roles
        (id,prospect_id,opportunity_id,person_node_id,role,evidence_status,source_id,source_ids_json,
         notes,validated_by,validated_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, accountId, input.opportunityId, input.personNodeId, input.role, evidence.status,
          evidence.sourceId, JSON.stringify(evidence.sourceIds), input.notes ?? "", evidence.validatedBy,
          evidence.validatedAt, timestamp, timestamp);
      syncEvidenceSources(db, accountId, "stakeholder_role", id, evidence.sourceIds);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return readRole(db, accountId, id)!;
  });
}
export function updateAccountMapStakeholder(accountId: string, id: string,
  patch: Partial<CreateStakeholderInput> & { expectedVersion: number; revalidate?: true }, actorId?: string | null): AccountMapStakeholderRole | null {
  return withAccountMapDatabase((db) => {
    const current = readRole(db, accountId, id);
    if (!current) return null;
    if (current.version !== patch.expectedVersion) throw new AccountMapVersionConflictError(id);
    const next = { ...current, ...patch };
    requireOpportunity(db, accountId, next.opportunityId);
    if (requireNode(db, accountId, next.personNodeId).kind !== "person") throw new AccountMapInputError("personNodeId", "Le rôle exige une personne réelle.");
    const materiallyChanged = next.opportunityId !== current.opportunityId || next.personNodeId !== current.personNodeId ||
      next.role !== current.role || next.evidenceStatus !== current.evidenceStatus ||
      next.sourceId !== current.sourceId || !sameSources(next.sourceIds, current.sourceIds);
    assertExplicitRevalidation(current.evidenceStatus, next.evidenceStatus, materiallyChanged, patch.revalidate);
    const evidence = materiallyChanged || patch.revalidate ? checkedRoleEvidence(db, accountId, next, actorId)
      : { status: current.evidenceStatus, sourceId: current.sourceId, sourceIds: current.sourceIds,
          validatedBy: current.validatedBy, validatedAt: current.validatedAt };
    if (next.role === "confirmed_champion" && evidence.status !== "confirmed") {
      throw new AccountMapInputError("role", "Champion confirmé exige une validation confirmée et sourcée.");
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const changed = db.prepare(`UPDATE prospect_factory_map_stakeholder_roles SET opportunity_id=?,person_node_id=?,role=?,
        evidence_status=?,source_id=?,source_ids_json=?,notes=?,validated_by=?,validated_at=?,version=version+1,updated_at=?
        WHERE id=? AND prospect_id=? AND version=?`)
        .run(next.opportunityId, next.personNodeId, next.role, evidence.status, evidence.sourceId,
          JSON.stringify(evidence.sourceIds), next.notes ?? "", evidence.validatedBy, evidence.validatedAt,
          now(), id, accountId, patch.expectedVersion).changes;
      if (!changed) throw new AccountMapVersionConflictError(id);
      if (materiallyChanged || patch.revalidate) syncEvidenceSources(db, accountId, "stakeholder_role", id, evidence.sourceIds);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return readRole(db, accountId, id)!;
  });
}
export function deleteAccountMapStakeholder(accountId: string, id: string): boolean {
  return withAccountMapDatabase((db) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM prospect_factory_map_evidence_sources WHERE prospect_id=? AND subject_kind='stakeholder_role' AND subject_id=?").run(accountId, id);
      const deleted = n(db.prepare("DELETE FROM prospect_factory_map_stakeholder_roles WHERE id=? AND prospect_id=?").run(id, accountId).changes) > 0;
      db.exec("COMMIT"); return deleted;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  });
}
