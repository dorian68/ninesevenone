import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AddProspectActivityInput, ProspectCanonicalSnapshot, ProspectQualificationImportInput } from "./prospect-factory-crm-contract";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "guad-prospect-crm-"));
const databasePath = join(temporaryDirectory, "prospect-factory-crm.sqlite");
(process as unknown as { env: Record<string, string | undefined> }).env.PROSPECTS_CRM_DB_PATH = databasePath;

let crm: typeof import("./prospect-factory-crm-db");

beforeAll(async () => {
  crm = await import("./prospect-factory-crm-db");
});

beforeEach(() => {
  crm.closeProspectCrmDatabase();
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
});

afterAll(() => {
  crm.closeProspectCrmDatabase();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

function snapshot(overrides: Partial<ProspectCanonicalSnapshot> = {}): ProspectCanonicalSnapshot {
  return {
    dedupeKey: "source:acme",
    companyName: "Acme Caraïbes",
    commercialName: "Acme",
    country: "France",
    territory: "Guadeloupe",
    region: "Guadeloupe",
    city: "Les Abymes",
    vertical: "Construction",
    recordOrigin: "sirene",
    sourceUrls: "https://example.test/source/acme",
    leadScore: 88,
    certification: "gold",
    contactName: "Contact observé",
    email: "source@acme.test",
    phone: "+590590111111",
    website: "https://source.acme.test",
    activityDetail: "Construction de bâtiments",
    employeeRange: "10 à 19 salariés",
    ...overrides
  };
}

function qualificationImport(
  accountKey: string,
  contactNames = ["Morgan Example"],
  idempotencyKey = `import:${accountKey}`
): ProspectQualificationImportInput {
  return {
    idempotencyKey,
    occurredAt: "2026-03-01T12:00:00.000Z",
    reportingTimezone: "Europe/Paris",
    account: {
      accountKey,
      companyName: `Account ${accountKey}`,
      commercialName: `Account ${accountKey}`,
      country: "United States",
      territory: "United States",
      city: "Boston",
      vertical: "Software",
      officialWebsite: `https://${accountKey.replaceAll(":", "-")}.example.test`,
      activityDetail: "B2B software company.",
      employeeRange: "51-100",
      businessSummary: "Observed B2B software activity.",
      offerHypothesis: "À confirmer : un diagnostic de reporting pourrait être utile.",
      nextVerification: "Vérifier les outils de reporting utilisés.",
      recommendedNextActionAt: "2026-03-08T09:00:00.000Z",
      sourceInput: {
        type: "apollo_screenshot",
        reference: "apollo-key-account-managers.png",
        rowOrRecord: "1",
        extractionStatus: "extracted",
        extractionNote: null
      },
      qualification: {
        status: "qualified",
        priority: "high",
        fitScore: 24,
        painScore: 18,
        timingScore: 12,
        personaScore: 10,
        confidence: "medium",
        scoreReason: "Fit et complexité observés ; timing à confirmer."
      },
      contacts: contactNames.map((name, index) => ({
        name,
        inputTitle: "Key Account Manager",
        verifiedTitle: null,
        evidenceType: "apollo_input",
        sourceUrl: null,
        sourceRowOrRecord: String(index + 1),
        buyingCommitteeRole: index === 0 ? "champion" : null
      })),
      sources: [{
        url: `https://${accountKey.replaceAll(":", "-")}.example.test/about`,
        sourceType: "official_website",
        supportedClaim: "Business activity observed on the official website.",
        publishedAt: null,
        researchedAt: "2026-03-01T11:00:00.000Z"
      }],
      observations: [{
        kind: "business_fact",
        statement: "The account describes a B2B software offer.",
        evidenceStatus: "observed",
        category: "business_model",
        sourceUrl: `https://${accountKey.replaceAll(":", "-")}.example.test/about`,
        occurredAt: null,
        publishedAt: null,
        researchedAt: "2026-03-01T11:00:00.000Z"
      }, {
        kind: "pain_signal",
        statement: "Reporting process to confirm before outreach.",
        evidenceStatus: "to_confirm",
        category: "reporting",
        sourceUrl: null,
        occurredAt: null,
        publishedAt: null,
        researchedAt: "2026-03-01T11:00:00.000Z"
      }]
    }
  };
}

describe("Prospect Factory CRM persistence", () => {
  it("resolves the default database at the monorepo root and preserves an explicit override", () => {
    const webDirectory = process.cwd();
    const monorepoRoot = resolve(webDirectory, "..", "..");
    const expectedDefault = join(monorepoRoot, "data", "prospects-db", "prospect_factory_crm.sqlite");
    const explicitOverride = join(temporaryDirectory, "custom", "crm.sqlite");

    expect(crm.resolveProspectCrmDatabasePath(webDirectory)).toBe(expectedDefault);
    expect(crm.resolveProspectCrmDatabasePath(monorepoRoot)).toBe(expectedDefault);
    expect(crm.resolveProspectCrmDatabasePath(webDirectory, explicitOverride)).toBe(explicitOverride);
    expect(crm.getProspectCrmDatabasePath()).toBe(databasePath);
  });

  it("adds by warehouse identity and refreshes source data without overwriting CRM enrichment", () => {
    const veryLongDedupeKey = `source:${"x".repeat(30_000)}`;
    const created = crm.addProspect({
      warehouseId: "warehouse-001",
      snapshot: snapshot({ dedupeKey: veryLongDedupeKey }),
      enrichment: { email: "override@acme.test", phone: "+590590000000" },
      qualification: { status: "qualified", priority: "high", tags: ["BTP", "local"] }
    });

    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.warehouseId).toBe("warehouse-001");
    expect(created.dedupeKey).toHaveLength(30_007);
    expect(created.version).toBe(1);
    expect(created.snapshot.email).toBe("source@acme.test");
    expect(created.enrichment.email).toBe("override@acme.test");

    const refreshed = crm.addProspect({
      warehouseId: "warehouse-001",
      snapshot: snapshot({
        dedupeKey: veryLongDedupeKey,
        companyName: "Acme Antilles",
        leadScore: 93,
        contactName: "Nouveau contact source",
        email: "refreshed-source@acme.test",
        phone: "+590590222222",
        website: "https://refreshed-source.acme.test",
        activityDetail: "Travaux spécialisés",
        employeeRange: "20 à 49 salariés"
      }),
      enrichment: { email: "should-not-replace@acme.test" }
    });

    expect(refreshed.id).toBe(created.id);
    expect(refreshed.version).toBe(2);
    expect(refreshed.snapshot.companyName).toBe("Acme Antilles");
    expect(refreshed.snapshot.leadScore).toBe(93);
    expect(refreshed.snapshot).toMatchObject({
      contactName: "Nouveau contact source",
      email: "refreshed-source@acme.test",
      phone: "+590590222222",
      website: "https://refreshed-source.acme.test",
      activityDetail: "Travaux spécialisés",
      employeeRange: "20 à 49 salariés"
    });
    expect(refreshed.enrichment.email).toBe("override@acme.test");
    expect(refreshed.enrichment.phone).toBe("+590590000000");
    expect(crm.getProspectByWarehouseId("warehouse-001")?.id).toBe(created.id);

    const sameDedupeDifferentWarehouse = crm.addProspect({
      warehouseId: "warehouse-002",
      snapshot: snapshot({ dedupeKey: veryLongDedupeKey, companyName: "Autre ligne source" })
    });
    expect(sameDedupeDifferentWarehouse.id).not.toBe(created.id);
    expect(crm.listProspects().total).toBe(2);
  });

  it("updates enrichment and qualification with optimistic concurrency", () => {
    const created = crm.addProspect({ warehouseId: "warehouse-update", snapshot: snapshot() });
    const updated = crm.updateProspect(created.id, {
      expectedVersion: created.version,
      enrichment: {
        contactName: "Marie Dupont",
        email: "marie@acme.test",
        website: "https://acme.test",
        jobTitle: "Directrice achats",
        linkedin: "https://linkedin.com/in/marie-dupont",
        address: "1 rue du Test, Les Abymes"
      },
      qualification: {
        status: "in_conversation",
        priority: "high",
        tags: ["décideur", "2026"],
        notes: "Premier échange positif.",
        nextActionAt: "2026-09-08T08:00:00.000Z",
        lastContactedAt: "2026-09-06T13:00:00.000Z"
      }
    });

    expect(updated).toMatchObject({
      id: created.id,
      version: 2,
      enrichment: { contactName: "Marie Dupont", email: "marie@acme.test", website: "https://acme.test" },
      qualification: { status: "in_conversation", priority: "high", tags: ["décideur", "2026"] }
    });

    expect(() => crm.updateProspect(created.id, {
      expectedVersion: 1,
      qualification: { notes: "Écriture obsolète" }
    })).toThrowError(crm.ProspectVersionConflictError);
    expect(crm.getProspect(created.id)?.qualification.notes).toBe("Premier échange positif.");

    const cleared = crm.updateProspect(created.id, {
      expectedVersion: 2,
      enrichment: { email: null },
      qualification: { nextActionAt: null }
    });
    expect(cleared?.version).toBe(3);
    expect(cleared?.enrichment.email).toBeNull();
    expect(cleared?.qualification.nextActionAt).toBeNull();
    expect(crm.updateProspect("missing", { enrichment: { phone: "123" } })).toBeNull();
  });

  it("updates a PATCH and appends privacy-safe audit activities atomically", () => {
    const created = crm.addProspect({ warehouseId: "warehouse-audited-patch", snapshot: snapshot() });
    const result = crm.updateProspectWithAudit(created.id, {
      expectedVersion: created.version,
      enrichment: {
        email: "private.person@acme.test",
        phone: "+590 690 00 00 00",
        jobTitle: "Directrice générale"
      },
      qualification: {
        status: "in_conversation",
        priority: "high",
        notes: "Échange prometteur."
      }
    }, "DATA_ADMIN");

    expect(result).toMatchObject({
      version: 2,
      prospect: {
        version: 2,
        enrichment: { email: "private.person@acme.test", phone: "+590 690 00 00 00" },
        qualification: { status: "in_conversation", priority: "high" }
      }
    });
    expect(result?.activities.map((activity) => activity.type)).toEqual(["enrichment", "status_change"]);
    expect(result?.activities[0]?.body).toContain("e-mail, téléphone, fonction");
    expect(result?.activities[1]?.body).toContain("À qualifier → En discussion");
    for (const activity of result?.activities ?? []) {
      expect(activity.direction).toBe("internal");
      expect(activity.body).not.toContain("private.person@acme.test");
      expect(activity.body).not.toContain("+590 690 00 00 00");
      expect(activity.body).not.toContain("Directrice générale");
    }
    expect(crm.listProspectActivities(created.id)).toHaveLength(2);

    const noChange = crm.updateProspectWithAudit(created.id, {
      expectedVersion: 2,
      enrichment: { email: "private.person@acme.test" },
      qualification: { status: "in_conversation" }
    }, "DATA_ADMIN");
    expect(noChange).toMatchObject({ version: 2, activities: [] });
    expect(crm.listProspectActivities(created.id)).toHaveLength(2);
  });

  it("rolls back the PATCH when its mandatory audit insert fails", () => {
    const created = crm.addProspect({ warehouseId: "warehouse-audit-rollback", snapshot: snapshot() });
    crm.closeProspectCrmDatabase();
    const rawDatabase = new DatabaseSync(databasePath);
    rawDatabase.exec(`
      CREATE TRIGGER force_prospect_audit_failure
      BEFORE INSERT ON prospect_factory_activities
      WHEN NEW.activity_type = 'status_change'
      BEGIN
        SELECT RAISE(ABORT, 'forced audit failure');
      END;
    `);
    rawDatabase.close();

    expect(() => crm.updateProspectWithAudit(created.id, {
      expectedVersion: 1,
      enrichment: { email: "must-rollback@acme.test" },
      qualification: { status: "qualified" }
    }, "DATA_ADMIN")).toThrow("forced audit failure");

    expect(crm.getProspect(created.id)).toMatchObject({
      version: 1,
      enrichment: { email: null },
      qualification: { status: "to_qualify" }
    });
    expect(crm.listProspectActivities(created.id)).toEqual([]);
  });

  it("rejects a stale audited PATCH before changing the row or timeline", () => {
    const created = crm.addProspect({ warehouseId: "warehouse-audit-conflict", snapshot: snapshot() });
    const interveningUpdate = crm.updateProspect(created.id, {
      expectedVersion: 1,
      qualification: { priority: "high" }
    });
    expect(interveningUpdate?.version).toBe(2);

    expect(() => crm.updateProspectWithAudit(created.id, {
      expectedVersion: 1,
      enrichment: { website: "https://stale-write.test" },
      qualification: { status: "opportunity" }
    }, "DATA_ADMIN")).toThrowError(crm.ProspectVersionConflictError);
    expect(crm.getProspect(created.id)).toMatchObject({
      version: 2,
      enrichment: { website: null },
      qualification: { status: "to_qualify", priority: "high" }
    });
    expect(crm.listProspectActivities(created.id)).toEqual([]);
  });

  it("keeps an append-only, ordered activity timeline", () => {
    const prospect = crm.addProspect({ warehouseId: "warehouse-timeline", snapshot: snapshot() });
    const firstWrite = crm.addProspectActivity(prospect.id, {
      type: "email",
      direction: "outbound",
      outcome: "replied",
      subject: "Présentation",
      body: "Envoi de la présentation commerciale.",
      occurredAt: "2026-09-05T09:00:00.000Z",
      actorRole: "DATA_ADMIN",
      statusAfter: "in_conversation",
      nextActionAt: "2026-09-08T08:00:00.000Z"
    });
    const secondWrite = crm.addProspectActivity(prospect.id, {
      type: "call",
      direction: "inbound",
      outcome: "meeting_booked",
      subject: "Retour prospect",
      body: "Le prospect demande une démonstration.",
      occurredAt: "2026-09-06T10:00:00.000Z",
      actorRole: "DATA_ADMIN"
    });
    const first = firstWrite?.activity;
    const second = secondWrite?.activity;

    expect(first?.prospectId).toBe(prospect.id);
    expect(first?.outcome).toBe("replied");
    expect(first?.actionKind).toBe("approach");
    expect(first?.statusBefore).toBe("to_qualify");
    expect(first?.statusAfter).toBe("in_conversation");
    expect(firstWrite?.prospect).toMatchObject({
      version: 2,
      qualification: {
        status: "in_conversation",
        nextActionAt: "2026-09-08T08:00:00.000Z",
        lastContactedAt: "2026-09-05T09:00:00.000Z"
      }
    });
    expect(second?.type).toBe("call");
    expect(secondWrite?.prospect.version).toBe(3);
    expect(secondWrite?.prospect.qualification.lastContactedAt).toBe("2026-09-06T10:00:00.000Z");
    expect(crm.listProspectActivities(prospect.id).map((activity) => activity.id)).toEqual([second?.id, first?.id]);

    const stats = crm.getProspectActivityStats("2026-09-01T00:00:00.000Z", "2026-09-08T00:00:00.000Z");
    expect(stats).toMatchObject({
      totalActivities: 2,
      approachEvents: 1,
      approachedProspects: 1,
      byType: { call: 1, email: 1 }
    });
    expect(stats.byDay).toEqual([
      {
        date: "2026-09-05",
        activities: 1,
        approachEvents: 1,
        followUpApproachEvents: 0,
        newContactsApproached: 1,
        newAccountsApproached: 1,
        approachedProspects: 1
      },
      {
        date: "2026-09-06",
        activities: 1,
        approachEvents: 0,
        followUpApproachEvents: 0,
        newContactsApproached: 0,
        newAccountsApproached: 0,
        approachedProspects: 0
      }
    ]);

    expect(() => crm.addProspectActivity(prospect.id, {
      type: "call",
      outcome: "invalid-outcome",
      actorRole: "DATA_ADMIN",
      statusAfter: "won"
    } as unknown as AddProspectActivityInput)).toThrow();
    expect(crm.listProspectActivities(prospect.id)).toHaveLength(2);
    expect(crm.getProspect(prospect.id)).toMatchObject({
      version: 3,
      qualification: { status: "in_conversation" }
    });
    expect(crm.addProspectActivity("missing", { type: "note", body: "Orpheline", actorRole: "DATA_ADMIN" })).toBeNull();
  });

  it("migrates a legacy activity table before persisting outcomes", () => {
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE prospect_factory_activities (
        id TEXT PRIMARY KEY,
        prospect_id TEXT NOT NULL,
        activity_type TEXT NOT NULL,
        direction TEXT,
        subject TEXT,
        body TEXT NOT NULL DEFAULT '',
        occurred_at TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    legacy.close();

    const prospect = crm.addProspect({ warehouseId: "warehouse-migration", snapshot: snapshot() });
    const result = crm.addProspectActivity(prospect.id, {
      type: "call",
      direction: "outbound",
      outcome: "no_answer",
      actorRole: "DATA_ADMIN"
    });

    expect(result?.activity.outcome).toBe("no_answer");
    expect(crm.listProspectActivities(prospect.id)[0]?.outcome).toBe("no_answer");
  });

  it("adds nullable canonical contact columns to an existing CRM without mixing overrides", () => {
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE prospect_factory_prospects (
        id TEXT PRIMARY KEY,
        warehouse_id TEXT NOT NULL UNIQUE,
        dedupe_key TEXT NOT NULL,
        company_name TEXT NOT NULL,
        commercial_name TEXT,
        country TEXT NOT NULL,
        territory TEXT NOT NULL,
        region TEXT,
        city TEXT,
        vertical TEXT,
        record_origin TEXT NOT NULL,
        source_urls TEXT NOT NULL DEFAULT '',
        lead_score REAL NOT NULL,
        certification TEXT NOT NULL,
        contact_name TEXT,
        email TEXT,
        phone TEXT,
        website TEXT,
        job_title TEXT,
        linkedin TEXT,
        address TEXT,
        qualification_status TEXT NOT NULL DEFAULT 'to_qualify',
        priority TEXT NOT NULL DEFAULT 'normal',
        tags_json TEXT NOT NULL DEFAULT '[]',
        notes TEXT NOT NULL DEFAULT '',
        next_action_at TEXT,
        last_contacted_at TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO prospect_factory_prospects (
        id, warehouse_id, dedupe_key, company_name, country, territory, record_origin,
        source_urls, lead_score, certification, email, qualification_status, priority,
        created_at, updated_at
      ) VALUES (
        '00000000-0000-4000-8000-000000000001', 'warehouse-legacy-source', 'legacy:source',
        'Entreprise historique', 'France', 'Guadeloupe', 'legacy', '', 50, 'silver',
        'manual-override@acme.test', 'qualified', 'normal',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
    `);
    legacy.close();

    const migrated = crm.getProspectByWarehouseId("warehouse-legacy-source");
    expect(migrated?.snapshot).toMatchObject({
      contactName: null,
      email: null,
      phone: null,
      website: null,
      activityDetail: null,
      employeeRange: null
    });
    expect(migrated?.enrichment.email).toBe("manual-override@acme.test");

    const refreshed = crm.addProspect({
      warehouseId: "warehouse-legacy-source",
      snapshot: snapshot({ email: "observed-after-migration@acme.test", phone: "+590590333333" })
    });
    expect(refreshed.snapshot.email).toBe("observed-after-migration@acme.test");
    expect(refreshed.snapshot.phone).toBe("+590590333333");
    expect(refreshed.enrichment.email).toBe("manual-override@acme.test");
  });

  it("lists safely, decorates Explorer rows in chunks, and computes pipeline counters", () => {
    const first = crm.addProspect({
      warehouseId: "warehouse-first",
      snapshot: snapshot({ companyName: "Société 100% Antilles" }),
      qualification: {
        status: "opportunity",
        priority: "high",
        nextActionAt: "2026-09-01T08:00:00.000Z",
        potentialValue: 10_000,
        probability: 50
      }
    });
    crm.addProspect({
      warehouseId: "warehouse-second",
      snapshot: snapshot({ dedupeKey: "source:second", companyName: "Deuxième société" }),
      qualification: { status: "won", priority: "low", potentialValue: 5_000 }
    });
    crm.addProspect({
      warehouseId: "warehouse-third",
      snapshot: snapshot({ dedupeKey: "source:third", companyName: "Troisième société" })
    });

    const literalWildcardSearch = crm.listProspects({ query: "100%", limit: 25 });
    expect(literalWildcardSearch.total).toBe(1);
    expect(literalWildcardSearch.prospects[0]?.id).toBe(first.id);
    expect(crm.listProspects({ status: ["opportunity", "won"], priority: ["high", "low"] }).total).toBe(2);

    const requestedIds = Array.from({ length: 501 }, (_, index) => `missing-${index}`);
    requestedIds[500] = "warehouse-first";
    const tracking = crm.getTrackingByWarehouseIds(requestedIds);
    expect(tracking["warehouse-first"]).toMatchObject({
      id: first.id,
      warehouseId: "warehouse-first",
      version: 1,
      status: "opportunity",
      priority: "high"
    });
    expect(Object.keys(tracking)).toEqual(["warehouse-first"]);

    const counts = crm.getPipelineCounts("2026-09-06T12:00:00.000Z");
    expect(counts.total).toBe(3);
    expect(counts.byStatus.opportunity).toBe(1);
    expect(counts.byStatus.won).toBe(1);
    expect(counts.byStatus.to_qualify).toBe(1);
    expect(counts.byStatus.qualified).toBe(0);
    expect(counts.byPriority).toEqual({ high: 1, normal: 1, low: 1 });
    expect(counts.overdueNextActions).toBe(1);
    expect(counts.withoutNextAction).toBe(1);
    expect(counts.pipelineValue).toBe(10_000);
    expect(counts.weightedPipelineValue).toBe(5_000);
    expect(counts.wonValue).toBe(5_000);
  });

  it("imports a source-backed batch atomically, preserves 10 accounts / 11 contacts, and is idempotent", () => {
    const batch = Array.from({ length: 10 }, (_, index) => qualificationImport(
      `apollo:account-${index + 1}`,
      index === 0 ? ["Alex One", "Blair Two"] : [`Contact ${index + 1}`]
    ));
    const results = crm.importProspectQualificationBatch(batch, "DATA_ADMIN");

    expect(results).toHaveLength(10);
    expect(results.every((result) => result.created && !result.idempotent)).toBe(true);
    expect(crm.listProspects({ limit: 20 }).total).toBe(10);
    const first = crm.getProspectByAccountKey("apollo:account-1");
    expect(first).toMatchObject({
      contacts: [{ name: "Alex One" }, { name: "Blair Two" }],
      qualification: {
        fitScore: 24,
        painScore: 18,
        timingScore: 12,
        personaScore: 10,
        scoreTotal: 64,
        tier: "B",
        confidence: "medium"
      },
      research: {
        accountKey: "apollo:account-1",
        sourceInput: { type: "apollo_screenshot", extractionStatus: "extracted" }
      }
    });
    expect(first?.contacts).toHaveLength(2);
    expect(first?.researchSources).toHaveLength(1);
    expect(first?.observations.map((observation) => observation.evidenceStatus).sort()).toEqual(["observed", "to_confirm"]);
    expect(crm.listProspectActivities(first!.id).map((activity) => activity.eventType).sort()).toEqual([
      "imported", "qualified", "research_completed"
    ]);
    expect(crm.listProspectActivities(first!.id).some((activity) => activity.actionKind === "approach")).toBe(false);
    expect(crm.getPipelineCounts().byTier).toEqual({ A: 0, B: 10, C: 0, unscored: 0 });

    const retry = crm.importProspectQualificationBatch(batch, "DATA_ADMIN");
    expect(retry.every((result) => result.idempotent && !result.created)).toBe(true);
    expect(crm.listProspects({ limit: 20 }).total).toBe(10);
    expect(crm.getProspectByAccountKey("apollo:account-1")?.contacts).toHaveLength(2);

    crm.closeProspectCrmDatabase();
    expect(crm.getProspectByAccountKey("apollo:account-1")?.contacts).toHaveLength(2);
  });

  it("rejects malformed or LinkedIn qualification batches before any account is written", () => {
    const valid = qualificationImport("apollo:valid");
    const malformed = qualificationImport("apollo:malformed");
    malformed.account.observations![0]!.sourceUrl = null;
    expect(() => crm.importProspectQualificationBatch([valid, malformed], "DATA_ADMIN"))
      .toThrowError(crm.ProspectCrmInputError);
    expect(crm.listProspects().total).toBe(0);

    const linkedIn = qualificationImport("apollo:linkedin");
    linkedIn.account.sources![0]!.url = "https://www.linkedin.com/company/not-allowed";
    expect(() => crm.importProspectQualification(linkedIn, "DATA_ADMIN"))
      .toThrowError(crm.ProspectCrmInputError);
    expect(crm.listProspects().total).toBe(0);

    const impossibleScore = qualificationImport("apollo:score");
    impossibleScore.account.qualification!.scoreTotal = 99;
    expect(() => crm.importProspectQualification(impossibleScore, "DATA_ADMIN"))
      .toThrowError(crm.ProspectCrmInputError);
    expect(crm.listProspects().total).toBe(0);

    const fakeContact = qualificationImport("apollo:fake-contact");
    fakeContact.account.qualification!.lastContactedAt = "2026-03-01T12:00:00.000Z";
    expect(() => crm.importProspectQualification(fakeContact, "DATA_ADMIN"))
      .toThrowError(crm.ProspectCrmInputError);
    const postContactStatus = qualificationImport("apollo:contacted-status");
    postContactStatus.account.qualification!.status = "contacted";
    expect(() => crm.importProspectQualification(postContactStatus, "DATA_ADMIN"))
      .toThrowError(crm.ProspectCrmInputError);
    expect(crm.listProspects().total).toBe(0);
  });

  it("counts unique first approached contacts in Europe/Paris and keeps follow-ups/accounts separate", () => {
    const imported = qualificationImport("apollo:timezone", ["Alex Contact", "Blair Contact"]);
    const account = crm.importProspectQualification(imported, "DATA_ADMIN").prospect;
    const alex = account.contacts.find((contact) => contact.name === "Alex Contact")!;
    const blair = account.contacts.find((contact) => contact.name === "Blair Contact")!;

    const initial = crm.addProspectActivity(account.id, {
      type: "email",
      direction: "outbound",
      body: "First real approach before the Paris Monday boundary.",
      occurredAt: "2026-03-29T21:30:00.000Z",
      contactId: alex.id,
      idempotencyKey: "activity:alex:first",
      reportingTimezone: "Europe/Paris",
      actorRole: "DATA_ADMIN"
    });
    const followUp = crm.addProspectActivity(account.id, {
      type: "email",
      direction: "outbound",
      body: "Follow-up after the Paris Monday boundary.",
      occurredAt: "2026-03-30T09:00:00.000Z",
      contactId: alex.id,
      idempotencyKey: "activity:alex:follow-up",
      reportingTimezone: "Europe/Paris",
      actorRole: "DATA_ADMIN"
    });
    const newContact = crm.addProspectActivity(account.id, {
      type: "call",
      direction: "outbound",
      body: "First approach to a second contact.",
      occurredAt: "2026-03-30T10:00:00.000Z",
      contactId: blair.id,
      idempotencyKey: "activity:blair:first",
      reportingTimezone: "Europe/Paris",
      actorRole: "DATA_ADMIN"
    });
    const repeat = crm.addProspectActivity(account.id, {
      type: "call",
      direction: "outbound",
      body: "First approach to a second contact.",
      occurredAt: "2026-03-30T10:00:00.000Z",
      contactId: blair.id,
      idempotencyKey: "activity:blair:first",
      reportingTimezone: "Europe/Paris",
      actorRole: "DATA_ADMIN"
    });
    expect(repeat?.activity.id).toBe(newContact?.activity.id);
    expect(initial?.activity.actionKind).toBe("approach");
    expect(followUp?.activity.actionKind).toBe("approach");
    expect(crm.addProspectActivity(account.id, {
      type: "status_change",
      direction: "internal",
      body: "Pipeline update, not an approach.",
      occurredAt: "2026-03-30T11:00:00.000Z",
      statusAfter: "contacted",
      actorRole: "DATA_ADMIN"
    })?.activity.actionKind).toBe("status_change");

    const stats = crm.getProspectActivityStats(
      "2026-03-29T22:00:00.000Z",
      "2026-04-05T22:00:00.000Z",
      "Europe/Paris"
    );
    expect(stats).toMatchObject({
      approachEvents: 2,
      followUpApproachEvents: 1,
      newContactsApproached: 1,
      newAccountsApproached: 0,
      approachedProspects: 0
    });
    expect(crm.getProspect(account.id)?.research).toMatchObject({
      firstApproachedAt: "2026-03-29T21:30:00.000Z",
      lastApproachedAt: "2026-03-30T10:00:00.000Z"
    });
  });

  it("attaches an unambiguous approach to the sole contact and requires a contact for multi-contact accounts", () => {
    const single = crm.importProspectQualification(qualificationImport("apollo:single", ["Only Person"]), "DATA_ADMIN").prospect;
    const autoAttached = crm.addProspectActivity(single.id, {
      type: "email",
      direction: "outbound",
      body: "First approach.",
      actorRole: "DATA_ADMIN"
    });
    expect(autoAttached?.activity.contactId).toBe(single.contacts[0]?.id);

    const multiple = crm.importProspectQualification(qualificationImport("apollo:multiple", ["First Person", "Second Person"]), "DATA_ADMIN").prospect;
    expect(() => crm.addProspectActivity(multiple.id, {
      type: "email",
      direction: "outbound",
      body: "Ambiguous approach.",
      actorRole: "DATA_ADMIN"
    })).toThrowError(crm.ProspectCrmInputError);
  });

  it("rejects incoherent or unbounded writes at the persistence boundary", () => {
    expect(() => crm.addProspect({
      warehouseId: "",
      snapshot: snapshot()
    })).toThrowError(crm.ProspectCrmInputError);

    const prospect = crm.addProspect({ warehouseId: "warehouse-validation", snapshot: snapshot() });
    const statusLog = crm.addProspectActivity(prospect.id, {
      type: "status_change",
      direction: "internal",
      body: "Ajout initial au suivi.",
      actorRole: "DATA_ADMIN"
    });
    expect(statusLog?.activity.type).toBe("status_change");
    expect(() => crm.updateProspect(prospect.id, {
      expectedVersion: 0,
      qualification: { notes: "invalid version" }
    })).toThrowError(crm.ProspectCrmInputError);
    expect(crm.listProspects({ limit: 501, offset: -4 })).toMatchObject({ limit: 200, offset: 0 });
    expect(() => crm.getTrackingByWarehouseIds(Array.from({ length: 5_001 }, (_, index) => `id-${index}`)))
      .toThrowError(crm.ProspectCrmInputError);
  });
});
