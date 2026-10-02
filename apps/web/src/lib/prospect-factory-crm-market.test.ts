import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const directory = mkdtempSync(join(tmpdir(), "guad-crm-market-"));
const databasePath = join(directory, "crm.sqlite");
(process as unknown as { env: Record<string, string | undefined> }).env.PROSPECTS_CRM_DB_PATH = databasePath;

let crm: typeof import("./prospect-factory-crm-db");

beforeAll(async () => { crm = await import("./prospect-factory-crm-db"); });
beforeEach(() => {
  crm.closeProspectCrmDatabase();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${databasePath}${suffix}`, { force: true });
});
afterAll(() => {
  crm.closeProspectCrmDatabase();
  rmSync(directory, { recursive: true, force: true });
});

function addAccount(name: string) {
  return crm.addProspect({
    warehouseId: `manual:${name}`,
    snapshot: {
      dedupeKey: `manual:${name}`, companyName: name, commercialName: name,
      country: "France", territory: "Guadeloupe", region: "Guadeloupe", city: "Baie-Mahault",
      vertical: "Services", recordOrigin: "manual", sourceUrls: "", leadScore: 0,
      certification: "bronze", contactName: "Alex Martin", email: "alex@example.test"
    },
    qualification: { fitScore: 20, painScore: 20, timingScore: 15, personaScore: 15 }
  });
}

describe("Prospect Factory market hierarchy", () => {
  it("finds legacy contact fields and structured contacts in account search", () => {
    const account = addAccount("Entreprise sans contact structuré");
    expect(crm.listMarketAccounts({ query: "Alex Martin" }).accounts[0]?.prospect.id).toBe(account.id);
    expect(crm.listMarketAccounts({ query: "alex@example.test" }).total).toBe(1);
    crm.createProspectContact(account.id, { name: "Camille Dupont", email: "camille@example.test" });
    expect(crm.listMarketAccounts({ query: "Camille Dupont" }).accounts[0]?.prospect.id).toBe(account.id);
    expect(crm.listMarketAccounts({ query: "camille@example.test" }).total).toBe(1);
  });

  it("upgrades an existing CRM without changing commercial rows and seeds only definitions", () => {
    const account = addAccount("Héritage local");
    crm.createProspectContact(account.id, { name: "Alex Martin", email: "alex@example.test" });
    crm.addProspectActivity(account.id, { type: "email", direction: "outbound", actorRole: "test", body: "Premier contact" });
    crm.closeProspectCrmDatabase();

    const oldDb = new DatabaseSync(databasePath);
    const before = ["prospect_factory_prospects", "prospect_factory_contacts", "prospect_factory_activities"]
      .map((table) => Number((oldDb.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total));
    oldDb.exec("PRAGMA foreign_keys=OFF");
    oldDb.exec("DROP TABLE prospect_factory_account_personas; DROP TABLE prospect_factory_icp_personas; DROP TABLE prospect_factory_icp_segments; DROP TABLE prospect_factory_icps");
    oldDb.exec("ALTER TABLE prospect_factory_prospects DROP COLUMN group_name");
    oldDb.exec("ALTER TABLE prospect_factory_contacts DROP COLUMN first_name");
    oldDb.exec("ALTER TABLE prospect_factory_activities DROP COLUMN detail_type");
    oldDb.exec("PRAGMA user_version=4");
    oldDb.close();

    const overview = crm.getMarketOverview();
    expect(overview.icps).toHaveLength(1);
    expect(overview.icps[0]?.segments).toHaveLength(3);
    expect(overview.icps[0]?.targetPersonas).toHaveLength(10);
    expect(overview.unclassified.accountCount).toBe(1);
    expect(crm.getProspect(account.id)?.market.segmentId).toBeNull();
    crm.closeProspectCrmDatabase();
    const upgraded = new DatabaseSync(databasePath);
    expect((upgraded.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(11);
    expect(["prospect_factory_prospects", "prospect_factory_contacts", "prospect_factory_activities"]
      .map((table) => Number((upgraded.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total))).toEqual(before);
    upgraded.close();
    expect(crm.getMarketOverview().icps[0]?.segments).toHaveLength(3);
  });

  it("classifies a company, keeps the commercial score separate, and recalculates ICP fit after a rule change", () => {
    const account = addAccount("Compte cartographié");
    const icp = crm.getMarketOverview().icps[0]!;
    const segment = icp.segments[0]!;
    const result = crm.updateAccountMarketProfile(account.id, {
      expectedVersion: account.version,
      market: {
        segmentId: segment.id, employeeCountEstimate: 48,
        operationalSignals: ["multiple_establishments", "regular_reporting"]
      }
    }, "test")!;
    expect(result.prospect.market.icpId).toBe(icp.id);
    expect(result.prospect.market.icpFitScore).not.toBeNull();
    expect(result.prospect.qualification.fitScore).toBe(20);
    expect(result.prospect.qualification.scoreTotal).toBe(70);
    expect(crm.listAccountPersonas(account.id)).toHaveLength(10);
    expect(crm.listMarketAccounts({ segmentId: segment.id, signal: "regular_reporting", minIcpFitScore: 1 }).total).toBe(1);

    crm.updateIcp(icp.id, { signalWeights: { multiple_establishments: 1, regular_reporting: 1 } });
    const refreshed = crm.getProspect(account.id)!;
    expect(refreshed.market.icpFitScore).toBe(100);
    expect(refreshed.qualification.scoreTotal).toBe(70);
    expect(crm.getMarketOverview().unclassified.accountCount).toBe(0);
  });

  it("links a contact to one account persona and counts LinkedIn and follow-up approaches", () => {
    const account = addAccount("Compte relationnel");
    const segment = crm.getMarketOverview().icps[0]!.segments[0]!;
    crm.updateAccountMarketProfile(account.id, { expectedVersion: account.version, market: { segmentId: segment.id } }, "test");
    const contact = crm.createProspectContact(account.id, {
      name: "Camille Dupont", personaKey: "raf", email: "camille@example.test",
      dealRoles: ["champion", "business_decision_maker"], decisionScope: "local"
    });
    const slot = crm.listAccountPersonas(account.id).find((persona) => persona.key === "raf");
    expect(slot?.contactId).toBe(contact.id);
    expect(slot?.status).toBe("identified");
    expect(contact.dealRoles).toEqual(["champion", "business_decision_maker"]);
    const first = crm.addProspectActivity(account.id, {
      type: "note", detailType: "linkedin_message", direction: "outbound", contactId: contact.id,
      body: "Message LinkedIn", nextActionLabel: "Relancer Camille",
      nextActionAt: "2026-10-03T09:00:00.000Z", occurredAt: "2026-10-01T09:00:00.000Z", actorRole: "test"
    })!;
    expect(first.activity.actionKind).toBe("approach");
    expect(first.prospect.qualification.nextActionLabel).toBe("Relancer Camille");
    crm.addProspectActivity(account.id, {
      type: "note", detailType: "follow_up", direction: "outbound", contactId: contact.id,
      body: "Relance", occurredAt: "2026-10-02T09:00:00.000Z", actorRole: "test"
    });
    crm.addProspectActivity(account.id, {
      type: "email", detailType: "email", direction: "inbound", outcome: "replied", contactId: contact.id,
      body: "Réponse", occurredAt: "2026-10-02T10:00:00.000Z", actorRole: "test"
    });
    const stats = crm.getProspectActivityStats("2026-10-01T00:00:00.000Z", "2026-10-03T00:00:00.000Z");
    expect(stats.approachEvents).toBe(2);
    expect(stats.newContactsApproached).toBe(1);
    expect(stats.followUpApproachEvents).toBe(1);
    expect(stats.byType.note).toBe(2);
    expect(crm.getMarketOverview().icps[0]?.metrics.responseRate).toBe(1);

    const other = addAccount("Autre compte");
    const foreign = crm.createProspectContact(other.id, { name: "Autre personne" });
    expect(() => crm.updateAccountPersona(account.id, slot!.id, { contactId: foreign.id }))
      .toThrow(/belong to this account/i);
  });
});
