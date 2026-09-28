import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { addProspect, closeProspectCrmDatabase, listProspectContacts } from "@/lib/prospect-factory-crm-db";
import { POST as previewRoute } from "./preview/route";
import { POST as applyRoute } from "./apply/route";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "guad-account-map-import-routes-"));
const databasePath = join(temporaryDirectory, "crm.sqlite");
const environment = process.env as Record<string, string | undefined>;

beforeEach(() => {
  environment.PROSPECTS_CRM_DB_PATH = databasePath;
  environment.ADMIN_ACCESS_TOKEN = "map-import-test-token";
  environment.ADMIN_SESSION_SECRET = "map-import-test-secret";
  environment.ADMIN_ROLE = "DATA_ADMIN";
  closeProspectCrmDatabase();
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
});

afterAll(() => {
  closeProspectCrmDatabase();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

function setup() {
  const account = addProspect({ warehouseId: "route-account", snapshot: {
    dedupeKey: "route-account", companyName: "Entreprise Fictive", commercialName: "Entreprise Fictive",
    country: "France", territory: "Guadeloupe", region: "Guadeloupe", city: "Pointe-à-Pitre",
    vertical: "Services", recordOrigin: "sirene", sourceUrls: "https://example.test/fictive",
    leadScore: 50, certification: "silver"
  } });
  const document = {
    schema_version: "account_map.v1", account_id: account.id, opportunity_id: null,
    import_batch_id: "88888888-8888-4888-8888-888888888888",
    sources: [{ source_id: "src:1", kind: "user_screenshot", label: "Capture fictive",
      collected_at: "2026-09-28T09:00:00Z" }],
    units: [], people: [], role_slots: [], relations: [], opportunity_roles: [], power_claims: [],
    claims: [], hypotheses: [], open_questions: [], warnings: [{ code: "UNREADABLE", message: "Nom illisible.", source_id: "src:1" }]
  };
  return { account, document };
}

function request(path: string, body: unknown, authorized = true) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST", headers: { "content-type": "application/json",
      ...(authorized ? { "x-admin-token": "map-import-test-token" } : {}) },
    body: JSON.stringify(body)
  });
}

describe("account-map import API", () => {
  it("requires CRM authorization before revealing a preview", async () => {
    const { account, document } = setup();
    const path = `/api/prospect-factory/crm/prospects/${account.id}/map/imports/preview`;
    const response = await previewRoute(request(path, document, false), { params: Promise.resolve({ id: account.id }) });
    expect(response.status).toBe(401);
  });

  it("previews then applies a proposal without creating an unreadable person", async () => {
    const { account, document } = setup();
    const previewPath = `/api/prospect-factory/crm/prospects/${account.id}/map/imports/preview`;
    const previewResponse = await previewRoute(request(previewPath, document), { params: Promise.resolve({ id: account.id }) });
    expect(previewResponse.status).toBe(200);
    const { preview } = await previewResponse.json();
    expect(preview.warnings).toContain("Nom illisible.");
    const applyPath = `/api/prospect-factory/crm/prospects/${account.id}/map/imports/apply`;
    const applyResponse = await applyRoute(request(applyPath, {
      document, fingerprint: preview.fingerprint, acceptedIds: preview.items.map((item: { id: string }) => item.id),
      contactResolutions: {}
    }), { params: Promise.resolve({ id: account.id }) });
    expect(applyResponse.status).toBe(201);
    expect(listProspectContacts(account.id)).toHaveLength(0);
  });
});
