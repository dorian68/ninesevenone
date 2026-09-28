import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { POST } from "./route";
import { closeProspectCrmDatabase, listProspects } from "@/lib/prospect-factory-crm-db";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "guad-prospect-qualification-import-"));
const databasePath = join(temporaryDirectory, "prospect-factory-crm.sqlite");
const environment = process.env as Record<string, string | undefined>;

function request(body: unknown, token = "qualification-import-test-token") {
  return new NextRequest("http://localhost/api/prospect-factory/crm/qualification-import", {
    method: "POST",
    headers: {
      "x-admin-token": token,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: "apollo:acme:row-1",
    occurredAt: "2026-09-19T10:00:00.000Z",
    reportingTimezone: "Europe/Paris",
    account: {
      accountKey: "apollo:acme",
      companyName: "Acme US",
      commercialName: "Acme",
      country: "United States",
      territory: "United States",
      city: "New York",
      vertical: "Software",
      officialWebsite: "https://acme.example.test",
      activityDetail: "B2B operating software.",
      employeeRange: "51-100",
      businessSummary: "Official site describes B2B operating software.",
      offerHypothesis: "À confirmer : le reporting peut être un sujet.",
      nextVerification: "Vérifier les outils de reporting.",
      sourceInput: {
        type: "apollo_screenshot",
        reference: "apollo.png",
        rowOrRecord: "1",
        extractionStatus: "extracted",
        extractionNote: null
      },
      qualification: {
        status: "qualified",
        fitScore: 25,
        painScore: 17,
        timingScore: 12,
        personaScore: 11,
        confidence: "medium"
      },
      contacts: [{
        name: "Avery Person",
        inputTitle: "Key Account Manager",
        verifiedTitle: null,
        evidenceType: "apollo_input",
        sourceUrl: null,
        sourceRowOrRecord: "1",
        buyingCommitteeRole: "champion"
      }, {
        name: "Blair Person",
        inputTitle: "Key Account Manager",
        verifiedTitle: null,
        evidenceType: "apollo_input",
        sourceUrl: null,
        sourceRowOrRecord: "2",
        buyingCommitteeRole: null
      }],
      sources: [{
        url: "https://acme.example.test/about",
        sourceType: "official_website",
        supportedClaim: "The company describes its B2B operating software.",
        publishedAt: null,
        researchedAt: "2026-09-19T09:30:00.000Z"
      }],
      observations: [{
        kind: "business_fact",
        statement: "The official site describes B2B operating software.",
        evidenceStatus: "observed",
        category: "business_model",
        sourceUrl: "https://acme.example.test/about",
        occurredAt: null,
        publishedAt: null,
        researchedAt: "2026-09-19T09:30:00.000Z"
      }, {
        kind: "pain_signal",
        statement: "Reporting workflow to confirm.",
        evidenceStatus: "to_confirm",
        category: "reporting",
        sourceUrl: null,
        occurredAt: null,
        publishedAt: null,
        researchedAt: "2026-09-19T09:30:00.000Z"
      }]
    },
    ...overrides
  };
}

beforeEach(() => {
  environment.ADMIN_ACCESS_TOKEN = "qualification-import-test-token";
  environment.ADMIN_SESSION_SECRET = "qualification-import-test-secret";
  environment.ADMIN_ROLE = "DATA_ADMIN";
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

describe("POST /api/prospect-factory/crm/qualification-import", () => {
  it("imports an account with two contacts, derived score and non-commercial events", async () => {
    const response = await POST(request({ items: [item()] }));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      results: [{
        created: true,
        idempotent: false,
        prospect: {
          contacts: [{ name: "Avery Person" }, { name: "Blair Person" }],
          qualification: { scoreTotal: 65, tier: "B" },
          research: { accountKey: "apollo:acme" }
        },
        events: [
          { eventType: "imported", actionKind: "enrichment", source: "import" },
          { eventType: "research_completed", actionKind: "enrichment", source: "import" },
          { eventType: "qualified", actionKind: "enrichment", source: "import" }
        ]
      }]
    });
    expect(listProspects().total).toBe(1);

    const retry = await POST(request({ items: [item()] }));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ results: [{ created: false, idempotent: true, events: [] }] });
    expect(listProspects().total).toBe(1);
  });

  it("rejects LinkedIn and malformed observed evidence without a partial import", async () => {
    const linkedIn = item();
    (linkedIn.account.sources[0] as { url: string }).url = "https://fr.linkedin.com/company/acme";
    const linkedInResponse = await POST(request({ items: [linkedIn] }));
    expect(linkedInResponse.status).toBe(422);
    expect(listProspects().total).toBe(0);

    const invalidObservation = item({ idempotencyKey: "apollo:bad:row-1" });
    (invalidObservation.account.observations[0] as { sourceUrl: string | null }).sourceUrl = null;
    const invalidResponse = await POST(request({ items: [item(), invalidObservation] }));
    expect(invalidResponse.status).toBe(422);
    expect(listProspects().total).toBe(0);
  });

  it("requires an authenticated data role", async () => {
    const response = await POST(request({ items: [item()] }, "wrong-token"));
    expect(response.status).toBe(401);
  });
});
