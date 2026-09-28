import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { accountMapImportSchema } from "./account-map-import-contract";
import { AccountMapImportError, applyAccountMapImport, previewAccountMapImport, undoAccountMapImport } from "./account-map-import";
import { createAccountMapNode, createAccountMapOpportunity } from "./account-map-db";
import { addProspect, closeProspectCrmDatabase, createProspectContact, listProspectContacts, withAccountMapDatabase } from "./prospect-factory-crm-db";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "guad-account-map-import-"));
const databasePath = join(temporaryDirectory, "crm.sqlite");
const environment = process.env as Record<string, string | undefined>;

function account() {
  return addProspect({ warehouseId: "import-account", snapshot: {
    dedupeKey: "import-account", companyName: "Société Démo", commercialName: "Société Démo",
    country: "France", territory: "Guadeloupe", region: "Guadeloupe", city: "Les Abymes",
    vertical: "Services", recordOrigin: "sirene", sourceUrls: "https://example.test/demo",
    leadScore: 50, certification: "silver"
  } });
}

function document(accountId: string, batchId = "33333333-3333-4333-8333-333333333333") {
  return accountMapImportSchema.parse({
    schema_version: "account_map.v1", account_id: accountId, opportunity_id: null, import_batch_id: batchId,
    sources: [{ source_id: "src:screen:1", kind: "user_screenshot", label: "Page équipe fictive",
      collected_at: "2026-09-28T09:00:00Z", information_date: null, asset_ref: null }],
    units: [{ temp_id: "tmp:unit:admin", kind: "department", name: "Service administratif",
      evidence: { status: "observed", source_ids: ["src:screen:1"], locator: "En-tête", excerpt: "Société Démo — Service administratif" } }],
    people: [{ temp_id: "tmp:person:camille", crm_contact_id: null, display_name_observed: "Camille Exemple",
      first_name: "Camille", last_name: "Exemple", job_title_observed: "Responsable administratif",
      linkedin_url: null, email: null, phone: null,
      identity_evidence: { status: "observed", source_ids: ["src:screen:1"], locator: "Ligne Camille",
        excerpt: "Camille Exemple — Responsable administratif" },
      affiliations: [{ unit_ref: "tmp:unit:admin", job_title_observed: "Responsable administratif", external: false,
        evidence: { status: "observed", source_ids: ["src:screen:1"], locator: "Ligne Camille",
          excerpt: "Camille Exemple — Service administratif" } }] }],
    role_slots: [{ temp_id: "tmp:slot:budget", label: "Validateur budgétaire à identifier", opportunity_id: null,
      notes: "Inconnu." }],
    relations: [], opportunity_roles: [], power_claims: [], claims: [], hypotheses: [], open_questions: [], warnings: []
  });
}

beforeEach(() => {
  environment.PROSPECTS_CRM_DB_PATH = databasePath;
  closeProspectCrmDatabase();
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
});

afterAll(() => {
  closeProspectCrmDatabase();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

function applyDefaults(accountId: string, value: ReturnType<typeof document>) {
  const preview = previewAccountMapImport(accountId, value);
  return applyAccountMapImport(accountId, { document: value, fingerprint: preview.fingerprint,
    acceptedIds: preview.items.filter((entry) => entry.defaultAccepted).map((entry) => entry.id), contactResolutions: {} }, "test:actor");
}

describe("account-map import", () => {
  it("previews without mutation, applies once, and stores only explicit affiliation", () => {
    const saved = account();
    const value = document(saved.id);
    const preview = previewAccountMapImport(saved.id, value);
    expect(listProspectContacts(saved.id)).toHaveLength(0);
    expect(withAccountMapDatabase((db) => db.prepare("SELECT COUNT(*) AS n FROM prospect_factory_map_nodes WHERE prospect_id=?").get(saved.id))).toEqual({ n: 0 });
    const first = applyDefaults(saved.id, value);
    expect(first.idempotent).toBe(false);
    expect(listProspectContacts(saved.id)).toHaveLength(1);
    const counts = withAccountMapDatabase((db) => ({
      relations: db.prepare("SELECT COUNT(*) AS n FROM prospect_factory_map_relations WHERE prospect_id=?").get(saved.id),
      slots: db.prepare("SELECT COUNT(*) AS n FROM prospect_factory_map_nodes WHERE prospect_id=? AND kind='role_slot'").get(saved.id)
    }));
    expect(counts.relations).toEqual({ n: 1 });
    expect(counts.slots).toEqual({ n: 1 });
    const second = applyAccountMapImport(saved.id, { document: value, fingerprint: preview.fingerprint,
      acceptedIds: preview.items.filter((entry) => entry.defaultAccepted).map((entry) => entry.id), contactResolutions: {} }, "test:actor");
    expect(second.idempotent).toBe(true);
    expect(listProspectContacts(saved.id)).toHaveLength(1);
  });

  it("does not merge homonyms and requires explicit resolution of a LinkedIn match", () => {
    const saved = account();
    createProspectContact(saved.id, { name: "Camille Exemple", linkedin: "https://www.linkedin.com/in/camille-exemple" });
    const value = document(saved.id);
    const sameName = previewAccountMapImport(saved.id, value);
    expect(sameName.items.find((entry) => entry.id === "person:tmp:person:camille")).toMatchObject({
      action: "possible_duplicate", defaultAccepted: false, matchBasis: "name"
    });
    value.people[0].linkedin_url = "https://www.linkedin.com/in/camille-exemple/";
    const linked = previewAccountMapImport(saved.id, value);
    expect(linked.items.find((entry) => entry.id === "person:tmp:person:camille")?.matchBasis).toBe("linkedin");
    const acceptedIds = linked.items.map((entry) => entry.id);
    expect(() => applyAccountMapImport(saved.id, { document: value, fingerprint: linked.fingerprint,
      acceptedIds, contactResolutions: {} }, "test:actor"))
      .toThrow(AccountMapImportError);
    const existing = listProspectContacts(saved.id)[0];
    applyAccountMapImport(saved.id, { document: value, fingerprint: linked.fingerprint, acceptedIds,
      contactResolutions: { "tmp:person:camille": existing.id } }, "test:actor");
    expect(listProspectContacts(saved.id)).toHaveLength(1);
  });

  it("creates a distinct person after explicit acceptance of a name-only homonym", () => {
    const saved = account();
    createProspectContact(saved.id, { name: "Camille Exemple" });
    const value = document(saved.id);
    const preview = previewAccountMapImport(saved.id, value);
    expect(preview.items.find((entry) => entry.id === "person:tmp:person:camille")).toMatchObject({
      action: "possible_duplicate", matchBasis: "name", defaultAccepted: false
    });
    applyAccountMapImport(saved.id, { document: value, fingerprint: preview.fingerprint,
      acceptedIds: preview.items.map((entry) => entry.id), contactResolutions: {} }, "test:actor");
    const contacts = listProspectContacts(saved.id);
    expect(contacts).toHaveLength(2);
    expect(contacts.map((contact) => contact.name)).toEqual(["Camille Exemple", "Camille Exemple"]);
  });

  it("requires an explicit choice for an exact email and does not duplicate the contact", () => {
    const saved = account();
    const existing = createProspectContact(saved.id, { name: "Camille Exemple", email: "camille@example.test" });
    const value = document(saved.id);
    value.people[0].email = "CAMILLE@example.test";
    const preview = previewAccountMapImport(saved.id, value);
    expect(preview.items.find((entry) => entry.id === "person:tmp:person:camille")).toMatchObject({
      action: "possible_duplicate", matchBasis: "email"
    });
    const acceptedIds = preview.items.map((entry) => entry.id);
    expect(() => applyAccountMapImport(saved.id, { document: value, fingerprint: preview.fingerprint,
      acceptedIds, contactResolutions: {} }, "test:actor"))
      .toThrowError(expect.objectContaining({ code: "CONTACT_MATCH_REQUIRES_DECISION" }));
    expect(listProspectContacts(saved.id)).toHaveLength(1);
    applyAccountMapImport(saved.id, { document: value, fingerprint: preview.fingerprint,
      acceptedIds, contactResolutions: { "tmp:person:camille": existing.id } }, "test:actor");
    expect(listProspectContacts(saved.id)).toHaveLength(1);
  });

  it("rejects a wrong same-account contact resolution before enriching CRM fields", () => {
    const saved = account();
    createProspectContact(saved.id, { name: "Camille Exemple", email: "camille@example.test" });
    const unrelated = createProspectContact(saved.id, { name: "Alex Autre", email: "alex@example.test" });
    const value = document(saved.id);
    value.people[0].email = "camille@example.test";
    value.people[0].phone = "+590590000001";
    const preview = previewAccountMapImport(saved.id, value);
    expect(() => applyAccountMapImport(saved.id, { document: value, fingerprint: preview.fingerprint,
      acceptedIds: preview.items.map((entry) => entry.id),
      contactResolutions: { "tmp:person:camille": unrelated.id } }, "test:actor"))
      .toThrowError(expect.objectContaining({ code: "CONTACT_RESOLUTION_CONFLICT" }));
    expect(listProspectContacts(saved.id).find((contact) => contact.id === unrelated.id)?.phone).toBeNull();
  });

  it("refuses to apply a sourced claim when its source was rejected", () => {
    const saved = account();
    const value = document(saved.id);
    const preview = previewAccountMapImport(saved.id, value);
    const acceptedIds = preview.items.filter((entry) => entry.id !== "source:src:screen:1").map((entry) => entry.id);
    try {
      applyAccountMapImport(saved.id, { document: value, fingerprint: preview.fingerprint,
        acceptedIds, contactResolutions: {} }, "test:actor");
      throw new Error("Expected the source dependency to be rejected.");
    } catch (error) {
      expect(error).toMatchObject({ code: "IMPORT_DEPENDENCY" });
    }
    expect(listProspectContacts(saved.id)).toHaveLength(0);
  });

  it("keeps an imported confirmation as observed and undoes only unchanged rows", () => {
    const saved = account();
    const value = document(saved.id);
    value.people[0].identity_evidence.status = "confirmed";
    applyDefaults(saved.id, value);
    const claim = withAccountMapDatabase((db) => db.prepare("SELECT evidence_status,validated_by FROM prospect_factory_map_claims WHERE field='person_identity'").get());
    expect(claim).toEqual({ evidence_status: "observed", validated_by: null });
    const undone = undoAccountMapImport(saved.id, value.import_batch_id, "test:actor");
    expect(undone).toEqual({ batchId: value.import_batch_id, undone: true, conflicts: [] });
    expect(listProspectContacts(saved.id)).toHaveLength(0);
  });

  it("blocks cross-account references and keeps opportunity roles scoped", () => {
    const saved = account();
    const value = document(saved.id);
    const otherAccountId = "44444444-4444-4444-8444-444444444444";
    value.relations.push({ from_ref: "tmp:unit:admin", to_ref: `crm:account:${otherAccountId}`,
      kind: "part_of", opportunity_id: null,
      evidence: { status: "observed", source_ids: ["src:screen:1"], locator: "En-tête" } });
    expect(accountMapImportSchema.safeParse(value).success).toBe(false);
    value.relations = [];
    const first = createAccountMapOpportunity(saved.id, { name: "Reporting" });
    const second = createAccountMapOpportunity(saved.id, { name: "Consolidation" });
    value.opportunity_roles = [
      { person_ref: "tmp:person:camille", opportunity_id: first.id, role: "process_owner",
        evidence: { status: "observed", source_ids: ["src:screen:1"], locator: "Ligne Camille" } },
      { person_ref: "tmp:person:camille", opportunity_id: second.id, role: "influencer",
        evidence: { status: "observed", source_ids: ["src:screen:1"], locator: "Ligne Camille" } }
    ];
    applyDefaults(saved.id, value);
    const roles = withAccountMapDatabase((db) => db.prepare("SELECT opportunity_id,role FROM prospect_factory_map_stakeholder_roles ORDER BY role").all());
    expect(roles).toEqual([{ opportunity_id: second.id, role: "influencer" }, { opportunity_id: first.id, role: "process_owner" }]);
  });

  it("flags a contradiction without overwriting the confirmed claim", () => {
    const saved = account();
    const contact = createProspectContact(saved.id, { name: "Camille Exemple" });
    const node = createAccountMapNode(saved.id, { kind: "person", contactId: contact.id });
    withAccountMapDatabase((db) => db.prepare(`INSERT INTO prospect_factory_map_claims
      (id,prospect_id,subject_node_id,opportunity_id,field,value_json,evidence_status,version,created_at,updated_at)
      VALUES (?,?,?,NULL,'professional_scope',?,'confirmed',1,?,?)`)
      .run("55555555-5555-4555-8555-555555555555", saved.id, node.id, JSON.stringify("Guadeloupe"),
        "2026-09-29T00:00:00Z", "2026-09-29T00:00:00Z"));
    const value = document(saved.id);
    value.people = [];
    value.units = [];
    value.role_slots = [];
    value.claims = [{ subject_ref: `map:node:${node.id}`, field: "professional_scope", value: "Antilles-Guyane",
      evidence: { status: "observed", source_ids: ["src:screen:1"], locator: "Zone périmètre", information_date: "2025-01-01" } }];
    const preview = previewAccountMapImport(saved.id, value);
    expect(preview.items.find((entry) => entry.id === "claim:0")?.action).toBe("conflict");
    applyAccountMapImport(saved.id, { document: value, fingerprint: preview.fingerprint,
      acceptedIds: preview.items.map((entry) => entry.id), contactResolutions: {} }, "test:actor");
    const claims = withAccountMapDatabase((db) => db.prepare(`SELECT value_json,evidence_status FROM prospect_factory_map_claims
      WHERE subject_node_id=? AND field='professional_scope' ORDER BY created_at`).all(node.id));
    expect(claims).toContainEqual({ value_json: JSON.stringify("Guadeloupe"), evidence_status: "confirmed" });
    expect(claims).toContainEqual({ value_json: JSON.stringify("Antilles-Guyane"), evidence_status: "contradictory" });
  });

  it("keeps later edits when an undo would destroy them", () => {
    const saved = account();
    const value = document(saved.id);
    applyDefaults(saved.id, value);
    const contact = listProspectContacts(saved.id)[0];
    withAccountMapDatabase((db) => db.prepare("UPDATE prospect_factory_contacts SET phone=? WHERE id=?")
      .run("+590590000001", contact.id));
    const result = undoAccountMapImport(saved.id, value.import_batch_id, "test:actor");
    expect(result.undone).toBe(false);
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(listProspectContacts(saved.id)[0].phone).toBe("+590590000001");
  });

  it("warns about unreadable captures without inventing a person", () => {
    const saved = account();
    const value = document(saved.id);
    value.people = [];
    value.units = [];
    value.role_slots = [];
    value.warnings = [{ code: "UNREADABLE", message: "Nom illisible.", source_id: "src:screen:1" }];
    const preview = previewAccountMapImport(saved.id, value);
    expect(preview.warnings).toContain("Nom illisible.");
    applyDefaults(saved.id, value);
    expect(listProspectContacts(saved.id)).toHaveLength(0);
  });

  it("rejects a reused batch id with altered content", () => {
    const saved = account();
    const value = document(saved.id);
    applyDefaults(saved.id, value);
    const changed = document(saved.id);
    changed.sources[0].label = "Une autre capture";
    expect(() => previewAccountMapImport(saved.id, changed)).toThrow(AccountMapImportError);
  });

  it("does not map a department or a differently named company onto the CRM root", () => {
    const saved = account();
    const value = document(saved.id);
    value.units[0].linked_crm_account_id = saved.id;
    expect(accountMapImportSchema.safeParse(value).success).toBe(false);
    value.units[0].kind = "company";
    expect(() => previewAccountMapImport(saved.id, value))
      .toThrowError(expect.objectContaining({ code: "INVALID_ROOT_UNIT_REFERENCE" }));
    value.units[0].name = "Société Démo";
    const preview = previewAccountMapImport(saved.id, value);
    expect(preview.items.find((entry) => entry.id === "unit:tmp:unit:admin")?.action).toBe("enrich");
  });

  it("never imports an unvalidated confirmed champion role from JSON", () => {
    const saved = account();
    const opportunity = createAccountMapOpportunity(saved.id, { name: "Projet reporting" });
    const value = document(saved.id);
    value.opportunity_roles = [{ person_ref: "tmp:person:camille", opportunity_id: opportunity.id,
      role: "confirmed_champion", evidence: { status: "confirmed", source_ids: ["src:screen:1"], locator: "Note de rendez-vous" } }];
    const preview = previewAccountMapImport(saved.id, value);
    expect(preview.items.find((entry) => entry.id === "role:0")).toMatchObject({ action: "reject", defaultAccepted: false });
    expect(() => applyAccountMapImport(saved.id, { document: value, fingerprint: preview.fingerprint,
      acceptedIds: preview.items.map((entry) => entry.id), contactResolutions: {} }, "test:actor"))
      .toThrowError(expect.objectContaining({ code: "REJECTED_PROPOSAL" }));
    applyDefaults(saved.id, value);
    const roles = withAccountMapDatabase((db) => db.prepare("SELECT role FROM prospect_factory_map_stakeholder_roles WHERE prospect_id=?").all(saved.id));
    expect(roles).toEqual([]);
  });

  it("rejects a part_of cycle formed by two edges in one transaction", () => {
    const saved = account();
    const value = document(saved.id);
    value.people = [];
    value.role_slots = [];
    value.units.push({ temp_id: "tmp:unit:finance", kind: "department", name: "Service finance",
      evidence: { status: "observed", source_ids: ["src:screen:1"], locator: "En-tête finance" } });
    value.relations = [
      { from_ref: "tmp:unit:admin", to_ref: "tmp:unit:finance", kind: "part_of", opportunity_id: null,
        evidence: { status: "observed", source_ids: ["src:screen:1"], locator: "Lien A vers B" } },
      { from_ref: "tmp:unit:finance", to_ref: "tmp:unit:admin", kind: "part_of", opportunity_id: null,
        evidence: { status: "observed", source_ids: ["src:screen:1"], locator: "Lien B vers A" } }
    ];
    const preview = previewAccountMapImport(saved.id, value);
    expect(() => applyAccountMapImport(saved.id, { document: value, fingerprint: preview.fingerprint,
      acceptedIds: preview.items.map((entry) => entry.id), contactResolutions: {} }, "test:actor"))
      .toThrowError(expect.objectContaining({ code: "UNIT_RELATION_CYCLE" }));
    const counts = withAccountMapDatabase((db) => ({
      nodes: db.prepare("SELECT COUNT(*) AS n FROM prospect_factory_map_nodes WHERE prospect_id=?").get(saved.id),
      relations: db.prepare("SELECT COUNT(*) AS n FROM prospect_factory_map_relations WHERE prospect_id=?").get(saved.id),
      batches: db.prepare("SELECT COUNT(*) AS n FROM prospect_factory_map_import_batches WHERE prospect_id=?").get(saved.id)
    }));
    expect(counts).toEqual({ nodes: { n: 0 }, relations: { n: 0 }, batches: { n: 0 } });
  });

  it("attaches a function to identify to a unit without creating a CRM contact", () => {
    const saved = account();
    const value = document(saved.id);
    value.people = [];
    value.relations = [{ from_ref: "tmp:slot:budget", to_ref: "tmp:unit:admin", kind: "works_in",
      opportunity_id: null, evidence: { status: "observed", source_ids: ["src:screen:1"], locator: "Fonction affichée dans le service" } }];
    applyDefaults(saved.id, value);
    expect(listProspectContacts(saved.id)).toHaveLength(0);
    const relation = withAccountMapDatabase((db) => db.prepare(`SELECT relation.kind, source.kind AS from_kind, target.kind AS to_kind
      FROM prospect_factory_map_relations relation
      JOIN prospect_factory_map_nodes source ON source.id=relation.from_node_id
      JOIN prospect_factory_map_nodes target ON target.id=relation.to_node_id
      WHERE relation.prospect_id=?`).get(saved.id));
    expect(relation).toEqual({ kind: "works_in", from_kind: "role_slot", to_kind: "unit" });
  });
});
