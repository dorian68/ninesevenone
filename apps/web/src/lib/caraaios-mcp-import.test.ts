import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  getAccountMap, createAccountMapOpportunity, createAccountMapRelation, createAccountMapSource,
  updateAccountMapRelation
} from "./account-map-db";
import { undoAccountMapImport } from "./account-map-import";
import { importCaraaiosCompanyMap } from "./caraaios-mcp-import";
import { getCaraaiosCompanyMap } from "./caraaios-mcp-crm";
import {
  addProspect, closeProspectCrmDatabase, createProspectContact,
  listProspectContacts, withAccountMapDatabase
} from "./prospect-factory-crm-db";

const directory = mkdtempSync(join(tmpdir(), "caraaios-mcp-import-"));
const databasePath = join(directory, "crm.sqlite");
const environment = process.env as Record<string, string | undefined>;

beforeEach(() => {
  environment.PROSPECTS_CRM_DB_PATH = databasePath;
  closeProspectCrmDatabase();
  rmSync(databasePath, { force: true });
  rmSync(databasePath + "-wal", { force: true });
  rmSync(databasePath + "-shm", { force: true });
});

afterAll(() => {
  closeProspectCrmDatabase();
  rmSync(directory, { recursive: true, force: true });
});

function company() {
  return addProspect({
    warehouseId: "manual:mcp-kactus",
    snapshot: {
      dedupeKey: "manual:mcp-kactus", companyName: "Kactus", commercialName: "Kactus",
      country: "France", territory: "France", region: "Île-de-France", city: "Paris",
      vertical: "Software", recordOrigin: "manual", sourceUrls: "",
      leadScore: 0, certification: "bronze"
    }
  });
}

function person(index: number, overrides: Record<string, unknown> = {}) {
  return {
    name: "Personne " + index + " Kactus",
    title_raw: "Operations Manager",
    employment_status: "current_employee",
    evidence_type: "observed",
    ...overrides
  };
}

function payload(companyId: string, people: unknown[]) {
  return {
    company_id: companyId,
    source: { source_type: "linkedin_video", source_reference: "PROSPECTION_KACTUS.mp4" },
    people
  };
}

describe("MCP company map bulk import", () => {
  it("imports 130 people into the existing contacts and graph and repeats without duplicates", () => {
    const account = company();
    const input = payload(account.id, Array.from({ length: 130 }, (_, index) => person(index)));
    const first = importCaraaiosCompanyMap(input, "mcp:test");
    expect(first.summary).toMatchObject({ created: 130, errors: 0, conflicts: 0 });
    expect(listProspectContacts(account.id)).toHaveLength(130);
    const map = getAccountMap(account.id)!;
    expect(map.nodes.filter((node) => node.kind === "person")).toHaveLength(130);
    expect(map.sources[0].reference).toBe("PROSPECTION_KACTUS.mp4");
    const second = importCaraaiosCompanyMap(input, "mcp:test");
    expect(second.summary).toMatchObject({ created: 0, unchanged: 130, errors: 0, conflicts: 0 });
    expect(listProspectContacts(account.id)).toHaveLength(130);
    expect(second.import_batch_ids).toEqual(first.import_batch_ids);
  });

  it("imports 130 fully annotated people without exceeding the map claim limit", () => {
    const account = company();
    const people = Array.from({ length: 130 }, (_, index) => person(index, {
      title_normalized: "Operations Manager", department: "Operations", team: "Field",
      seniority: "Lead", location: "Paris", notes: "Role to qualify."
    }));
    const result = importCaraaiosCompanyMap(payload(account.id, people), "mcp:test");
    expect(result.summary).toMatchObject({ created: 130, errors: 0, conflicts: 0 });
    expect(listProspectContacts(account.id)).toHaveLength(130);
    expect(result.import_batch_ids).toHaveLength(2);
    expect(getAccountMap(account.id)!.claims.length).toBeGreaterThan(1_000);
  });

  it("applies a large organization payload in independent batches", () => {
    const account = company();
    const input = {
      ...payload(account.id, [person(1)]),
      hypotheses: Array.from({ length: 300 }, (_, index) => ({
        proposition: "Process hypothesis " + index,
        justification: "Research hypothesis only.",
        verification_question: "Is this process used?"
      }))
    };
    const first = importCaraaiosCompanyMap(input, "mcp:test");
    expect(first.summary).toMatchObject({ created: 1, errors: 0 });
    expect(first.hypothesis_errors).toHaveLength(0);
    expect(first.import_batch_ids).toHaveLength(3);
    expect(getAccountMap(account.id)!.claims.filter((entry) => entry.field === "hypothesis")).toHaveLength(300);
    const second = importCaraaiosCompanyMap(input, "mcp:test");
    expect(second.summary.unchanged).toBe(1);
    expect(getAccountMap(account.id)!.claims.filter((entry) => entry.field === "hypothesis")).toHaveLength(300);
  });

  it("keeps 129 valid rows when one person is invalid, and reports that row", () => {
    const account = company();
    const people = Array.from({ length: 130 }, (_, index) => person(index));
    people[64] = person(64, { name: "" });
    const result = importCaraaiosCompanyMap(payload(account.id, people), "mcp:test");
    expect(result.summary).toMatchObject({ created: 129, errors: 1, conflicts: 0 });
    expect(result.people.find((entry) => entry.index === 64)).toMatchObject({ status: "error" });
    expect(listProspectContacts(account.id)).toHaveLength(129);
  });

  it("retries individual people when one database row rejects an otherwise valid batch", () => {
    const account = company();
    withAccountMapDatabase((db) => db.exec(
      "CREATE TRIGGER reject_one_contact BEFORE INSERT ON prospect_factory_contacts " +
      "WHEN NEW.name='Personne 2 Kactus' BEGIN SELECT RAISE(ABORT,'contact rejected'); END"
    ));
    const input = payload(account.id, [person(1), person(2), person(3)]);
    const first = importCaraaiosCompanyMap(input, "mcp:test");
    expect(first.summary).toMatchObject({ created: 2, errors: 1 });
    expect(first.people[1]).toMatchObject({ index: 1, status: "error" });
    expect(listProspectContacts(account.id)).toHaveLength(2);
    withAccountMapDatabase((db) => db.exec("DROP TRIGGER reject_one_contact"));
    const second = importCaraaiosCompanyMap(input, "mcp:test");
    expect(second.summary).toMatchObject({ errors: 0 });
    expect(listProspectContacts(account.id)).toHaveLength(3);
  });

  it("splits 250 people into safe batches and remains idempotent", () => {
    const account = company();
    const input = payload(account.id, Array.from({ length: 250 }, (_, index) => person(index)));
    const first = importCaraaiosCompanyMap(input, "mcp:test");
    expect(first.summary).toMatchObject({ created: 250, errors: 0, conflicts: 0 });
    expect(first.import_batch_ids).toHaveLength(3);
    const second = importCaraaiosCompanyMap(input, "mcp:test");
    expect(second.summary).toMatchObject({ unchanged: 250, created: 0, errors: 0, conflicts: 0 });
    expect(listProspectContacts(account.id)).toHaveLength(250);
  });

  it("previews without storing a contact, source, or map node", () => {
    const account = company();
    const result = importCaraaiosCompanyMap({
      ...payload(account.id, [person(1), person(2)]), dry_run: true,
      relationships: [{
        from_person_index: 0, to_person_index: 1, kind: "reports_to", evidence_type: "inferred",
        justification: "Fonctions proches dans la vidéo.", verification_question: "Quelle est la ligne hiérarchique réelle ?"
      }]
    }, "mcp:test");
    expect(result.summary).toMatchObject({ would_create: 2, created: 0 });
    expect(result.relationship_errors).toHaveLength(0);
    expect(listProspectContacts(account.id)).toHaveLength(0);
    const counts = withAccountMapDatabase((db) => ({
      nodes: db.prepare("SELECT count(*) AS count FROM prospect_factory_map_nodes WHERE prospect_id=?").get(account.id),
      sources: db.prepare("SELECT count(*) AS count FROM prospect_factory_map_sources WHERE prospect_id=?").get(account.id)
    }));
    expect(counts).toEqual({ nodes: { count: 0 }, sources: { count: 0 } });
  });

  it("never merges ambiguous homonyms or creates another copy", () => {
    const account = company();
    createProspectContact(account.id, { name: "John Martin" });
    createProspectContact(account.id, { name: "John Martin" });
    const result = importCaraaiosCompanyMap(payload(account.id, [
      person(1, { name: "John Martin" })
    ]), "mcp:test");
    expect(result.summary).toMatchObject({ conflicts: 1, created: 0 });
    expect(result.people[0].reason).toMatch(/homonymes/i);
    expect(listProspectContacts(account.id)).toHaveLength(2);
  });

  it("treats a name-only duplicate inside the same video as a conflict", () => {
    const account = company();
    const result = importCaraaiosCompanyMap(payload(account.id, [
      person(1, { name: "John Martin", linkedin_url: "https://www.linkedin.com/in/john-one" }),
      person(2, { name: "John Martin" })
    ]), "mcp:test");
    expect(result.summary).toMatchObject({ created: 1, conflicts: 1 });
    expect(listProspectContacts(account.id)).toHaveLength(1);
  });

  it("keeps title observations over time and separates observed identity from inferred buying role", () => {
    const account = company();
    const opportunity = createAccountMapOpportunity(account.id, { name: "Partenariats" });
    const linkedIn = "https://www.linkedin.com/in/paul-averseng-test";
    const first = importCaraaiosCompanyMap({
      ...payload(account.id, [person(1, {
        name: "Paul Averseng", title_raw: "Lead Rev Ops", linkedin_url: linkedIn
      })]),
      buying_committee: [{
        person_index: 0, opportunity_id: opportunity.id,
        role: "potential_champion", evidence_type: "inferred",
        justification: "Sa fonction touche le processus commercial.",
        verification_question: "Participe-t-il au choix d'un outil ?"
      }]
    }, "mcp:test");
    expect(first.summary.created).toBe(1);
    const second = importCaraaiosCompanyMap({
      ...payload(account.id, [person(1, {
        name: "Paul Averseng", title_raw: "Head of Revenue Operations", linkedin_url: linkedIn
      })]),
      idempotency_key: "new-observation-paul"
    }, "mcp:test");
    expect(second.summary).toMatchObject({ created: 0, updated: 1, conflicts: 0 });
    const map = getAccountMap(account.id)!;
    const identityClaims = map.claims.filter((entry) => entry.field === "person_identity");
    expect(identityClaims).toHaveLength(2);
    expect(identityClaims.map((entry) => (entry.value as { job_title_observed: string }).job_title_observed))
      .toEqual(["Lead Rev Ops", "Head of Revenue Operations"]);
    const titleClaims = map.claims.filter((entry) => entry.field === "other"
      && typeof entry.value === "string" && entry.value.startsWith("title_observed:"));
    expect(titleClaims.map((entry) => entry.value)).toEqual([
      "title_observed: Lead Rev Ops", "title_observed: Head of Revenue Operations"
    ]);
    expect(titleClaims.every((entry) => entry.evidenceStatus === "observed")).toBe(true);
    expect(map.stakeholderRoles).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "potential_relay", evidenceStatus: "hypothesis" })
    ]));
  });

  it("retains exact observed, inferred, declared, and verified evidence types on source links", () => {
    const account = company();
    const opportunity = createAccountMapOpportunity(account.id, { name: "Partenariats" });
    const result = importCaraaiosCompanyMap({
      ...payload(account.id, [
        person(1, { name: "Paul Averseng", title_raw: "Lead Rev Ops", evidence_type: "observed" }),
        person(2, { name: "Bruno Lajous", title_raw: "VP Operations", evidence_type: "verified" }),
        person(3, { name: "Carine Nait", title_raw: "Head of Partnerships", evidence_type: "declared" })
      ]),
      relationships: [{
        from_person_index: 0, to_person_index: 1, kind: "reports_to", evidence_type: "inferred",
        justification: "Simple hypothèse de structure.",
        verification_question: "Quelle est la ligne hiérarchique réelle ?"
      }],
      buying_committee: [{
        person_index: 0, opportunity_id: opportunity.id, role: "potential_champion",
        evidence_type: "inferred", justification: "Rôle potentiellement pertinent.",
        verification_question: "Paul porte-t-il le projet ?"
      }]
    }, "mcp:test");
    expect(result.summary).toMatchObject({ created: 3, errors: 0 });
    const map = getCaraaiosCompanyMap(account.id, { include_evidence: true })!;
    const titleClaims = map.hypotheses_and_facts!.filter((entry) =>
      entry.field === "other" && typeof entry.value === "string" && entry.value.startsWith("title_observed:"));
    const evidenceFor = (subjectId: string) => map.evidence!.filter((entry) => entry.subjectId === subjectId);
    expect(Object.fromEntries(titleClaims.map((entry) =>
      [entry.value as string, evidenceFor(entry.id)[0]?.evidenceType]))).toEqual({
      "title_observed: Lead Rev Ops": "observed",
      "title_observed: VP Operations": "verified",
      "title_observed: Head of Partnerships": "declared"
    });
    expect(map.buying_committee!.find((entry) => entry.role === "potential_champion")?.evidenceStatus)
      .toBe("hypothesis");
    expect(evidenceFor(map.buying_committee!.find((entry) => entry.role === "potential_champion")!.id)[0]?.evidenceType)
      .toBe("inferred");
    expect(map.buying_committee!.find((entry) => entry.role === "potential_champion")?.mapRole)
      .toBe("potential_relay");
    const reportingLine = map.relationships!.find((entry) => entry.kind === "reports_to")!;
    expect(reportingLine.evidenceStatus).toBe("hypothesis");
    expect(evidenceFor(reportingLine.id)[0]?.evidenceType).toBe("inferred");
    updateAccountMapRelation(account.id, reportingLine.id, {
      expectedVersion: reportingLine.version, locator: "Repère corrigé après lecture"
    }, "session:human");
    expect(getCaraaiosCompanyMap(account.id)!.evidence!
      .find((entry) => entry.subjectId === reportingLine.id)?.evidenceType).toBe("inferred");
    expect(getCaraaiosCompanyMap(account.id, { include_evidence: false })!.evidence).toBeUndefined();
  });

  it("refreshes a unique name-only contact from a later video without creating a duplicate", () => {
    const account = company();
    const firstInput = payload(account.id, [person(1, {
      name: "Gabriel Matutano", title_raw: "Lead Financial Ops"
    })]);
    const first = importCaraaiosCompanyMap(firstInput, "mcp:test");
    const second = importCaraaiosCompanyMap({
      ...payload(account.id, [person(1, {
        name: "Gabriel Matutano", title_raw: "Head of Financial Operations"
      })]),
      source: { source_type: "linkedin_video", source_reference: "PROSPECTION_KACTUS_2027.mp4",
        observed_at: "2027-03-01T12:00:00Z" }
    }, "mcp:test");
    expect(second.summary).toMatchObject({ created: 0, updated: 1, conflicts: 0 });
    expect(listProspectContacts(account.id)).toHaveLength(1);
    expect(second.people[0].contact_id).toBe(first.people[0].contact_id);
    expect(listProspectContacts(account.id)[0].inputTitle).toBe("Head of Financial Operations");
    const titleObservations = getAccountMap(account.id)!.claims.filter((entry) =>
      entry.field === "other" && typeof entry.value === "string"
      && entry.value.startsWith("title_observed:"));
    expect(titleObservations.map((entry) => entry.value)).toEqual([
      "title_observed: Lead Financial Ops", "title_observed: Head of Financial Operations"
    ]);
  });

  it("records an inferred reporting line and an account hypothesis as hypotheses, not facts", () => {
    const account = company();
    const result = importCaraaiosCompanyMap({
      ...payload(account.id, [
        person(1, { name: "Paul Averseng" }),
        person(2, { name: "Bruno Lajous" })
      ]),
      relationships: [{
        from_person_index: 0, to_person_index: 1, kind: "reports_to", evidence_type: "inferred",
        notes: "Hypothèse hiérarchique à confirmer.",
        justification: "Fonctions voisines.", verification_question: "Paul reporte-t-il réellement à Bruno ?"
      }],
      hypotheses: [{
        proposition: "L'équipe pourrait consolider plusieurs sources pour le reporting.",
        justification: "Hypothèse tirée des fonctions visibles, sans entretien.",
        verification_question: "Combien de systèmes alimentent le reporting aujourd'hui ?"
      }]
    }, "mcp:test");
    expect(result.summary).toMatchObject({ created: 2, errors: 0 });
    expect(result.relationship_errors).toHaveLength(0);
    expect(result.hypothesis_errors).toHaveLength(0);
    const map = getAccountMap(account.id)!;
    expect(map.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "reports_to", evidenceStatus: "hypothesis",
        notes: "Hypothèse hiérarchique à confirmer." })
    ]));
    expect(map.claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "hypothesis", evidenceStatus: "hypothesis" })
    ]));
  });

  it("exposes original sponsor and relationship meanings when the UI graph uses broader categories", () => {
    const account = company();
    const opportunity = createAccountMapOpportunity(account.id, { name: "Finance" });
    const imported = importCaraaiosCompanyMap({
      ...payload(account.id, [
        person(1, { name: "Bruno Lajous" }),
        person(2, { name: "Gabriel Matutano" })
      ]),
      relationships: [{
        from_person_index: 0, to_person_index: 1, kind: "manages",
        evidence_type: "inferred", justification: "Organigramme supposé.",
        verification_question: "Bruno supervise-t-il Gabriel ?"
      }],
      buying_committee: [{
        person_index: 0, opportunity_id: opportunity.id, role: "potential_sponsor",
        evidence_type: "inferred", justification: "Son poste suggère ce rôle.",
        verification_question: "Bruno sponsorise-t-il le projet ?"
      }]
    }, "mcp:test");
    expect(imported.summary).toMatchObject({ created: 2, errors: 0 });
    const map = getCaraaiosCompanyMap(account.id)!;
    const sponsor = map.buying_committee!.find((entry) => entry.role === "potential_sponsor");
    expect(sponsor).toMatchObject({ mapRole: "influencer", evidenceStatus: "hypothesis" });
    expect(map.relationship_observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "manages", evidenceStatus: "hypothesis" })
    ]));
    expect(map.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "reports_to", evidenceStatus: "hypothesis" })
    ]));
  });

  it("does not attach an inferred source to an already confirmed reporting line", () => {
    const account = company();
    const people = [
      person(1, { name: "Paul Averseng", linkedin_url: "https://www.linkedin.com/in/paul-audit" }),
      person(2, { name: "Bruno Lajous", linkedin_url: "https://www.linkedin.com/in/bruno-audit" })
    ];
    importCaraaiosCompanyMap(payload(account.id, people), "mcp:test");
    const nodes = getAccountMap(account.id)!.nodes;
    const paul = nodes.find((node) => node.name === "Paul Averseng")!;
    const bruno = nodes.find((node) => node.name === "Bruno Lajous")!;
    const manualSource = createAccountMapSource(account.id, {
      kind: "meeting_note", label: "Entretien", excerpt: "Paul reporte à Bruno."
    });
    const confirmed = createAccountMapRelation(account.id, {
      fromNodeId: paul.id, toNodeId: bruno.id, kind: "reports_to",
      evidenceStatus: "confirmed", sourceId: manualSource.id
    }, "session:human");
    const result = importCaraaiosCompanyMap({
      ...payload(account.id, people),
      source: { source_type: "chatgpt_research", source_reference: "Inference after video" },
      relationships: [{
        from_person_index: 0, to_person_index: 1, kind: "reports_to", evidence_type: "inferred",
        justification: "Leur niveau suggère un lien.", verification_question: "Confirmer en entretien."
      }]
    }, "mcp:test");
    expect(result.relationship_errors).toEqual([expect.objectContaining({ index: 0 })]);
    const links = getAccountMap(account.id)!.relations.filter((relation) =>
      relation.fromNodeId === paul.id && relation.toNodeId === bruno.id && relation.kind === "reports_to");
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ id: confirmed.id, evidenceStatus: "confirmed",
      sourceIds: [manualSource.id] });
  });

  it("does not let a confirmed employment link roll back an otherwise valid person import", () => {
    const account = company();
    const contact = createProspectContact(account.id, {
      name: "Carine Nait", linkedin: "https://www.linkedin.com/in/carine-audit"
    });
    const map = getAccountMap(account.id)!;
    const node = map.nodes.find((entry) => entry.contactId === contact.id)!;
    const root = map.nodes.find((entry) => entry.isRoot)!;
    const source = createAccountMapSource(account.id, {
      kind: "meeting_note", label: "Entretien", excerpt: "Carine travaille chez Kactus."
    });
    const confirmed = createAccountMapRelation(account.id, {
      fromNodeId: node.id, toNodeId: root.id, kind: "works_in",
      evidenceStatus: "confirmed", sourceId: source.id
    }, "session:human");
    const result = importCaraaiosCompanyMap(payload(account.id, [person(1, {
      name: "Carine Nait", linkedin_url: "https://www.linkedin.com/in/carine-audit",
      notes: "Partenariats à explorer."
    })]), "mcp:test");
    expect(result.summary).toMatchObject({ updated: 1, errors: 0 });
    expect(getAccountMap(account.id)!.nodes.find((entry) => entry.id === node.id)?.notes)
      .toBe("Partenariats à explorer.");
    expect(getAccountMap(account.id)!.relations.find((entry) => entry.id === confirmed.id)?.sourceIds)
      .toEqual([source.id]);
  });

  it("shows imported person notes in the graph, appends later notes once, and can undo them", () => {
    const account = company();
    const linkedIn = "https://www.linkedin.com/in/manon-massou-test";
    const firstInput = payload(account.id, [person(1, {
      name: "Manon Massou", linkedin_url: linkedIn, notes: "Échange initial à préparer."
    })]);
    const first = importCaraaiosCompanyMap(firstInput, "mcp:test");
    const contactId = first.people[0].contact_id;
    const notes = () => getAccountMap(account.id)!.nodes.find((node) => node.contactId === contactId)!.notes;
    expect(notes()).toBe("Échange initial à préparer.");
    expect(importCaraaiosCompanyMap(firstInput, "mcp:test").summary.unchanged).toBe(1);
    expect(notes()).toBe("Échange initial à préparer.");
    const laterInput = {
      ...payload(account.id, [person(1, {
        name: "Manon Massou", linkedin_url: linkedIn, notes: "Souhaite une démonstration."
      })]),
      idempotency_key: "manon-follow-up"
    };
    const later = importCaraaiosCompanyMap(laterInput, "mcp:test");
    expect(later.summary.updated).toBe(1);
    expect(notes()).toBe("Échange initial à préparer.\n\nSouhaite une démonstration.");
    expect(importCaraaiosCompanyMap(laterInput, "mcp:test").summary.unchanged).toBe(1);
    expect(notes()).toBe("Échange initial à préparer.\n\nSouhaite une démonstration.");
    const undone = undoAccountMapImport(account.id, later.import_batch_ids[0], "mcp:test");
    expect(undone).toMatchObject({ undone: true, conflicts: [] });
    expect(notes()).toBe("Échange initial à préparer.");
  });
});
