import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";

const directory = mkdtempSync(join(tmpdir(), "guad-account-map-"));
const databasePath = join(directory, "crm.sqlite");
(process as unknown as { env: Record<string, string | undefined> }).env.PROSPECTS_CRM_DB_PATH = databasePath;

let crm: typeof import("./prospect-factory-crm-db");
let map: typeof import("./account-map-db");

beforeAll(async () => {
  crm = await import("./prospect-factory-crm-db");
  map = await import("./account-map-db");
});
beforeEach(() => {
  crm.closeProspectCrmDatabase();
  for (const path of [databasePath, `${databasePath}-shm`, `${databasePath}-wal`]) rmSync(path, { force: true });
});
afterAll(() => {
  crm.closeProspectCrmDatabase();
  rmSync(directory, { recursive: true, force: true });
});

function account(name: string) {
  return crm.addProspect({
    warehouseId: `map-${name}`,
    snapshot: {
      dedupeKey: `map:${name}`, companyName: name, commercialName: name,
      country: "France", territory: "Guadeloupe", region: "Guadeloupe", city: "Pointe-à-Pitre",
      vertical: "Services", recordOrigin: "test", sourceUrls: "", leadScore: 0,
      certification: "gold"
    }
  });
}

describe("Account map persistence", () => {
  it("adds an account root and existing CRM contacts without invented hierarchy", () => {
    const prospect = account("Société Démo");
    const first = crm.createProspectContact(prospect.id, { name: "Camille Exemple" });
    const second = crm.createProspectContact(prospect.id, { name: "Camille Exemple" });
    expect(first.id).not.toBe(second.id);

    const snapshot = map.getAccountMap(prospect.id)!;
    expect(snapshot.nodes.filter((node) => node.kind === "person")).toHaveLength(2);
    expect(snapshot.nodes.filter((node) => node.isRoot)).toHaveLength(1);
    expect(snapshot.relations).toHaveLength(0);
    expect(map.getAccountMap(prospect.id)!.nodes).toHaveLength(snapshot.nodes.length);

    const third = crm.createProspectContact(prospect.id, { name: "Alex Démo" });
    expect(map.getAccountMap(prospect.id)!.nodes.some((node) => node.contactId === third.id)).toBe(true);
  });

  it("scopes roles by opportunity and rejects cross-account links", () => {
    const prospect = account("Compte A");
    const other = account("Compte B");
    const contact = crm.createProspectContact(prospect.id, { name: "Camille Exemple" });
    const person = map.getAccountMap(prospect.id)!.nodes.find((node) => node.contactId === contact.id)!;
    const otherRoot = map.getAccountMap(other.id)!.nodes.find((node) => node.isRoot)!;
    const first = map.createAccountMapOpportunity(prospect.id, { name: "Reporting" });
    const second = map.createAccountMapOpportunity(prospect.id, { name: "Contrôle" });
    map.createAccountMapStakeholder(prospect.id, { opportunityId: first.id, personNodeId: person.id, role: "user" });
    map.createAccountMapStakeholder(prospect.id, { opportunityId: second.id, personNodeId: person.id, role: "influencer" });
    expect(map.getAccountMap(prospect.id)!.stakeholderRoles.map((role) => role.role)).toEqual(["user", "influencer"]);
    expect(() => map.createAccountMapRelation(prospect.id, {
      fromNodeId: person.id, toNodeId: otherRoot.id, kind: "works_in",
      justification: "À vérifier", verificationQuestion: "Travaille-t-elle dans cette unité ?"
    })).toThrow(map.AccountMapInputError);
  });

  it("keeps layout separate from business relations and preserves positions", () => {
    const prospect = account("Compte Layout");
    const root = map.getAccountMap(prospect.id)!.nodes.find((node) => node.isRoot)!;
    map.saveAccountMapLayout(prospect.id, { view: "organization", opportunityId: null,
      positions: [{ nodeId: root.id, x: 42, y: -20 }], viewport: { x: 10, y: 15, zoom: 1.25 } });
    const snapshot = map.getAccountMap(prospect.id)!;
    expect(snapshot.layouts[0].positions).toEqual([{ nodeId: root.id, x: 42, y: -20 }]);
    expect(snapshot.layouts[0].viewport?.zoom).toBe(1.25);
    expect(snapshot.relations).toHaveLength(0);
  });

  it("requires evidence and an authenticated actor for confirmed relations", () => {
    const prospect = account("Compte Preuves");
    const contact = crm.createProspectContact(prospect.id, { name: "Camille Exemple" });
    const snapshot = map.getAccountMap(prospect.id)!;
    const person = snapshot.nodes.find((node) => node.contactId === contact.id)!;
    const root = snapshot.nodes.find((node) => node.isRoot)!;
    expect(() => map.createAccountMapRelation(prospect.id, {
      fromNodeId: person.id, toNodeId: root.id, kind: "works_in", evidenceStatus: "confirmed"
    })).toThrow(map.AccountMapInputError);
    const emptySource = map.createAccountMapSource(prospect.id, { kind: "meeting_note", label: "Sans contenu" });
    expect(() => map.createAccountMapRelation(prospect.id, {
      fromNodeId: person.id, toNodeId: root.id, kind: "works_in", evidenceStatus: "confirmed", sourceId: emptySource.id
    }, "session:demo")).toThrow(map.AccountMapInputError);
    const source = map.createAccountMapSource(prospect.id, { kind: "meeting_note", label: "Échange documenté", excerpt: "Camille travaille dans cette société." });
    const relation = map.createAccountMapRelation(prospect.id, {
      fromNodeId: person.id, toNodeId: root.id, kind: "works_in", evidenceStatus: "confirmed", sourceId: source.id
    }, "session:demo");
    expect(relation.validatedBy).toBe("session:demo");
    expect(relation.sourceIds).toEqual([source.id]);
  });

  it("keeps unknown functions separate from CRM contacts and guards linked records", () => {
    const prospect = account("Compte Fonctions");
    const opportunity = map.createAccountMapOpportunity(prospect.id, { name: "Projet Reporting" });
    const slot = map.createAccountMapNode(prospect.id, {
      kind: "role_slot", name: "Validateur budgétaire à identifier", opportunityId: opportunity.id,
      notes: "À demander au prochain échange"
    });
    expect(slot.opportunityId).toBe(opportunity.id);
    expect(crm.listProspectContacts(prospect.id)).toHaveLength(0);
    const question = map.createAccountMapQuestion(prospect.id, {
      subjectNodeId: slot.id, opportunityId: opportunity.id,
      question: "Qui valide ce budget ?"
    });
    expect(() => map.deleteAccountMapNode(prospect.id, slot.id)).toThrow(map.AccountMapInputError);
    expect(() => map.deleteAccountMapOpportunity(prospect.id, opportunity.id)).toThrow(map.AccountMapInputError);
    expect(map.deleteAccountMapQuestion(prospect.id, question.id)).toBe(true);
    expect(map.deleteAccountMapNode(prospect.id, slot.id)).toBe(true);
    expect(map.deleteAccountMapOpportunity(prospect.id, opportunity.id)).toBe(true);
  });

  it("links a function to identify with an organizational unit without creating a contact", () => {
    const prospect = account("Compte Fonction À Identifier");
    const root = map.getAccountMap(prospect.id)!.nodes.find((node) => node.isRoot)!;
    const slot = map.createAccountMapNode(prospect.id, {
      kind: "role_slot", name: "Responsable du reporting à identifier"
    });
    const relation = map.createAccountMapRelation(prospect.id, {
      fromNodeId: slot.id, toNodeId: root.id, kind: "works_in",
      justification: "Service de rattachement possible", verificationQuestion: "Où se situe cette fonction ?"
    });
    expect(relation.kind).toBe("works_in");
    expect(map.getAccountMap(prospect.id)!.relations.some((item) => item.id === relation.id)).toBe(true);
    expect(crm.listProspectContacts(prospect.id)).toHaveLength(0);
    expect(() => map.createAccountMapRelation(prospect.id, {
      fromNodeId: root.id, toNodeId: slot.id, kind: "works_in",
      justification: "À vérifier", verificationQuestion: "Quel rattachement ?"
    })).toThrow(map.AccountMapInputError);
  });

  it("rejects a cycle in explicitly created unit memberships and stale edits", () => {
    const prospect = account("Compte Unités");
    const first = map.createAccountMapNode(prospect.id, { kind: "unit", unitKind: "department", name: "Service A" });
    const second = map.createAccountMapNode(prospect.id, { kind: "unit", unitKind: "department", name: "Service B" });
    const evidence = { justification: "À confirmer", verificationQuestion: "Quel service dépend de quel autre ?" };
    map.createAccountMapRelation(prospect.id, { fromNodeId: first.id, toNodeId: second.id, kind: "part_of", ...evidence });
    expect(() => map.createAccountMapRelation(prospect.id, { fromNodeId: second.id, toNodeId: first.id, kind: "part_of", ...evidence }))
      .toThrow(map.AccountMapInputError);
    const updated = map.updateAccountMapNode(prospect.id, first.id, { expectedVersion: first.version, name: "Service A2" });
    expect(updated.name).toBe("Service A2");
    expect(() => map.updateAccountMapNode(prospect.id, first.id, { expectedVersion: first.version, name: "Ancien" }))
      .toThrow(map.AccountMapVersionConflictError);
  });

  it("preserves validation provenance on note edits and requires explicit revalidation for substantive changes", () => {
    const prospect = account("Compte Validation");
    const contact = crm.createProspectContact(prospect.id, { name: "Camille Exemple" });
    const snapshot = map.getAccountMap(prospect.id)!;
    const person = snapshot.nodes.find((node) => node.contactId === contact.id)!;
    const root = snapshot.nodes.find((node) => node.isRoot)!;
    const source = map.createAccountMapSource(prospect.id, { kind: "meeting_note", label: "Entretien", excerpt: "Camille travaille pour le compte." });
    const relation = map.createAccountMapRelation(prospect.id, {
      fromNodeId: person.id, toNodeId: root.id, kind: "works_in", evidenceStatus: "confirmed",
      sourceId: source.id, locator: "Ligne 2", label: "Affiliation"
    }, "session:initial");
    const relabelled = map.updateAccountMapRelation(prospect.id, relation.id, {
      expectedVersion: relation.version, label: "Affiliation locale", notes: "Suivi éditorial"
    }, "session:editor")!;
    expect(relabelled.validatedBy).toBe("session:initial");
    expect(relabelled.validatedAt).toBe(relation.validatedAt);
    const renamedSource = map.updateAccountMapSource(prospect.id, source.id, { expectedVersion: source.version, label: "Entretien du lundi" })!;
    expect(renamedSource.label).toBe("Entretien du lundi");
    expect(() => map.updateAccountMapSource(prospect.id, source.id, {
      expectedVersion: renamedSource.version, excerpt: "Autre contenu"
    })).toThrow(map.AccountMapInputError);
    const evidenceLocator = crm.withAccountMapDatabase((db) => db.prepare(`
      SELECT locator FROM prospect_factory_map_evidence_sources
      WHERE prospect_id=? AND subject_kind='relation' AND subject_id=?
    `).get(prospect.id, relation.id) as { locator: string });
    expect(evidenceLocator.locator).toBe("Ligne 2");
    expect(() => map.updateAccountMapRelation(prospect.id, relation.id, {
      expectedVersion: relabelled.version, excerpt: "Nouvelle preuve"
    }, "session:editor")).toThrow(map.AccountMapInputError);
    const revalidated = map.updateAccountMapRelation(prospect.id, relation.id, {
      expectedVersion: relabelled.version, excerpt: "Nouvelle preuve", revalidate: true
    }, "session:editor")!;
    expect(revalidated.validatedBy).toBe("session:editor");

    const claim = map.createAccountMapClaim(prospect.id, {
      subjectNodeId: person.id, field: "task_observed", value: "Reporting mensuel",
      evidenceStatus: "confirmed", sourceId: source.id
    }, "session:initial");
    expect(() => map.updateAccountMapClaim(prospect.id, claim.id, {
      expectedVersion: claim.version, value: "Reporting hebdomadaire"
    }, "session:editor")).toThrow(map.AccountMapInputError);
    const changedClaim = map.updateAccountMapClaim(prospect.id, claim.id, {
      expectedVersion: claim.version, value: "Reporting hebdomadaire", revalidate: true
    }, "session:editor")!;
    expect(changedClaim.validatedBy).toBe("session:editor");

    const opportunity = map.createAccountMapOpportunity(prospect.id, { name: "Projet Reporting" });
    expect(() => map.createAccountMapStakeholder(prospect.id, {
      opportunityId: opportunity.id, personNodeId: person.id, role: "confirmed_champion",
      evidenceStatus: "hypothesis", notes: "Intérêt supposé"
    })).toThrow(map.AccountMapInputError);
    const role = map.createAccountMapStakeholder(prospect.id, {
      opportunityId: opportunity.id, personNodeId: person.id, role: "confirmed_champion",
      evidenceStatus: "confirmed", sourceId: source.id
    }, "session:initial");
    const notedRole = map.updateAccountMapStakeholder(prospect.id, role.id, {
      expectedVersion: role.version, notes: "Relance à prévoir"
    }, "session:editor")!;
    expect(notedRole.validatedBy).toBe("session:initial");
    expect(notedRole.validatedAt).toBe(role.validatedAt);
    expect(() => map.updateAccountMapStakeholder(prospect.id, role.id, {
      expectedVersion: notedRole.version, role: "economic_decision_maker"
    }, "session:editor")).toThrow(map.AccountMapInputError);
  });

  it("requires an explicit resolution before confirming a contradictory claim", () => {
    const prospect = account("Compte Contradiction");
    const contact = crm.createProspectContact(prospect.id, { name: "Camille Exemple" });
    const person = map.getAccountMap(prospect.id)!.nodes.find((node) => node.contactId === contact.id)!;
    const source = map.createAccountMapSource(prospect.id, {
      kind: "meeting_note", label: "Compte rendu", excerpt: "Pouvoir budgétaire discuté."
    });
    const common = { subjectNodeId: person.id, field: "power:authorize_budget", sourceId: source.id };
    const confirmed = map.createAccountMapClaim(prospect.id, {
      ...common, value: { answer: "yes" }, evidenceStatus: "confirmed"
    }, "session:first");
    const contradictory = map.createAccountMapClaim(prospect.id, {
      ...common, value: { answer: "no" }, evidenceStatus: "contradictory"
    });
    expect(() => map.createAccountMapClaim(prospect.id, {
      ...common, value: { answer: "no" }, evidenceStatus: "confirmed"
    }, "session:second")).toThrow(/Déclassez-la explicitement/);
    expect(() => map.updateAccountMapClaim(prospect.id, contradictory.id, {
      expectedVersion: contradictory.version, evidenceStatus: "confirmed", revalidate: true
    }, "session:second")).toThrow(/Déclassez-la explicitement/);
    expect(map.getAccountMap(prospect.id)!.claims.find((item) => item.id === contradictory.id)?.evidenceStatus).toBe("contradictory");

    const obsolete = map.updateAccountMapClaim(prospect.id, confirmed.id, {
      expectedVersion: confirmed.version, evidenceStatus: "obsolete"
    }, "session:second")!;
    expect(obsolete.validatedBy).toBe("session:first");
    expect(obsolete.validatedAt).toBe(confirmed.validatedAt);
    const resolved = map.updateAccountMapClaim(prospect.id, contradictory.id, {
      expectedVersion: contradictory.version, evidenceStatus: "confirmed", revalidate: true
    }, "session:second")!;
    expect(resolved.evidenceStatus).toBe("confirmed");
    expect(resolved.validatedBy).toBe("session:second");
  });
});
