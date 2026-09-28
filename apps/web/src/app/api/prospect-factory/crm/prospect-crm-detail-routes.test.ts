import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prospect-factory-db", () => {
  class ProspectFactoryInputError extends Error {}
  return {
    ProspectFactoryInputError,
    getProspectFactoryById: vi.fn(async (warehouseId: string) => ({
      warehouseId,
      dedupeKey: "source:acme",
      companyName: "Acme Caraïbes",
      commercialName: "Acme",
      country: "France",
      territory: "Guadeloupe",
      region: "Guadeloupe",
      city: "Les Abymes",
      vertical: "Construction",
      activityDetail: "Travaux d'installation électrique",
      employeeRange: "10 à 19 salariés",
      contactName: "Contact public",
      email: "source@acme.test",
      phone: "+590 590 00 00 00",
      website: "https://acme.test",
      leadScore: 88,
      prioritySegment: null,
      certification: "gold",
      qualityReasons: [],
      recordOrigin: "sirene",
      sourceType: "public",
      sourceUrls: "https://example.test/source/acme",
      sourceReferenceDate: null,
      retrievedAt: null,
      administrativeStatus: null,
      siren: "123456789",
      siret: null,
      businessId: null
    }))
  };
});

import { GET as getDetail, PATCH as patchDetail } from "./prospects/[id]/route";
import { GET as getActivities, POST as postActivity } from "./prospects/[id]/activities/route";
import { GET as getProspects, POST as postProspect } from "./prospects/route";
import { addProspect, closeProspectCrmDatabase } from "@/lib/prospect-factory-crm-db";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "guad-prospect-crm-routes-"));
const databasePath = join(temporaryDirectory, "prospect-factory-crm.sqlite");
const environment = process.env as Record<string, string | undefined>;

function request(path: string, init: { method?: string; body?: string; headers?: HeadersInit } = {}) {
  return new NextRequest(`http://localhost${path}`, {
    ...init,
    headers: {
      "x-admin-token": "crm-route-test-token",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers
    }
  });
}

function createProspect() {
  return addProspect({
    warehouseId: "warehouse-001",
    snapshot: {
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
      certification: "gold"
    }
  });
}

beforeEach(() => {
  environment.ADMIN_ACCESS_TOKEN = "crm-route-test-token";
  environment.ADMIN_SESSION_SECRET = "crm-route-test-session-secret";
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

describe("Prospect Factory CRM detail routes", () => {
  it("lists the pipeline without optional filters and adds prospects idempotently", async () => {
    createProspect();
    const list = getProspects(request("/api/prospect-factory/crm/prospects"));
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ total: 1, prospects: [{ warehouseId: "warehouse-001" }], counts: { total: 1 } });

    const existing = await postProspect(request("/api/prospect-factory/crm/prospects", {
      method: "POST",
      body: JSON.stringify({ warehouseId: "warehouse-001" })
    }));
    expect(existing.status).toBe(200);
    expect(await existing.json()).toMatchObject({ created: false, prospect: { warehouseId: "warehouse-001" } });

    const created = await postProspect(request("/api/prospect-factory/crm/prospects", {
      method: "POST",
      body: JSON.stringify({ warehouseId: "warehouse-002" })
    }));
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      created: true,
      prospect: {
        warehouseId: "warehouse-002",
        snapshot: {
          contactName: "Contact public",
          email: "source@acme.test",
          phone: "+590 590 00 00 00",
          website: "https://acme.test",
          activityDetail: "Travaux d'installation électrique",
          employeeRange: "10 à 19 salariés"
        },
        enrichment: { contactName: null, email: null, phone: null, website: null }
      }
    });
  });

  it("returns the tracked record, current canonical row and timeline without public caching", async () => {
    const prospect = createProspect();
    const response = await getDetail(request(`/api/prospect-factory/crm/prospects/${prospect.id}`), {
      params: Promise.resolve({ id: prospect.id })
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      prospect: { id: prospect.id, warehouseId: "warehouse-001" },
      canonical: { warehouseId: "warehouse-001", companyName: "Acme Caraïbes" },
      activities: []
    });
  });

  it("updates strictly and returns the current record on an optimistic-lock conflict", async () => {
    const prospect = createProspect();
    const first = await patchDetail(request(`/api/prospect-factory/crm/prospects/${prospect.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        expectedVersion: prospect.version,
        enrichment: { email: "contact@acme.test", website: "https://acme.test" },
        qualification: { status: "in_conversation", notes: "Premier échange." }
      })
    }), { params: Promise.resolve({ id: prospect.id }) });

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      prospect: { version: 2, enrichment: { email: "contact@acme.test" } },
      activities: [{ type: "enrichment" }, { type: "status_change" }]
    });

    const stale = await patchDetail(request(`/api/prospect-factory/crm/prospects/${prospect.id}`, {
      method: "PATCH",
      body: JSON.stringify({ expectedVersion: 1, qualification: { notes: "Écriture obsolète" } })
    }), { params: Promise.resolve({ id: prospect.id }) });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "VERSION_CONFLICT", current: { version: 2 } });

    const unsafeUrl = await patchDetail(request(`/api/prospect-factory/crm/prospects/${prospect.id}`, {
      method: "PATCH",
      body: JSON.stringify({ expectedVersion: 2, enrichment: { website: "javascript:alert(1)" } })
    }), { params: Promise.resolve({ id: prospect.id }) });
    expect(unsafeUrl.status).toBe(422);
  });

  it("records an authenticated activity atomically and exposes its timeline", async () => {
    const prospect = createProspect();
    const created = await postActivity(request(`/api/prospect-factory/crm/prospects/${prospect.id}/activities`, {
      method: "POST",
      body: JSON.stringify({
        type: "call",
        direction: "outbound",
        outcome: "reached",
        body: "Échange avec le décideur.",
        statusAfter: "contacted",
        nextActionAt: "2026-09-10T09:00:00.000Z"
      })
    }), { params: Promise.resolve({ id: prospect.id }) });

    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("no-store");
    expect(await created.json()).toMatchObject({
      activity: { type: "call", actorRole: "DATA_ADMIN" },
      prospect: { version: 2, qualification: { status: "contacted" } }
    });

    const timeline = await getActivities(request(`/api/prospect-factory/crm/prospects/${prospect.id}/activities?limit=25`), {
      params: Promise.resolve({ id: prospect.id })
    });
    expect(timeline.status).toBe(200);
    expect(await timeline.json()).toMatchObject({ activities: [{ type: "call", body: "Échange avec le décideur." }] });
  });

  it("rejects unauthenticated access and client-controlled actor roles", async () => {
    const prospect = createProspect();
    const anonymous = await getDetail(new NextRequest(`http://localhost/api/prospect-factory/crm/prospects/${prospect.id}`), {
      params: Promise.resolve({ id: prospect.id })
    });
    expect(anonymous.status).toBe(401);

    const spoofed = await postActivity(request(`/api/prospect-factory/crm/prospects/${prospect.id}/activities`, {
      method: "POST",
      body: JSON.stringify({ type: "note", body: "Note", actorRole: "SUPER_ADMIN" })
    }), { params: Promise.resolve({ id: prospect.id }) });
    expect(spoofed.status).toBe(422);
  });
});
