import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { addProspect, closeProspectCrmDatabase } from "@/lib/prospect-factory-crm-db";
import { GET as listRoute, POST as createRoute } from "./route";
import { PATCH as updateRoute } from "./[signalId]/route";
import { POST as attachRoute } from "./[signalId]/attachments/route";
import { GET as downloadRoute } from "./[signalId]/attachments/[attachmentId]/route";

const directory = mkdtempSync(join(tmpdir(), "caraaios-signal-routes-"));
const dbPath = join(directory, "crm.sqlite");
const environment = process.env as Record<string, string | undefined>;

beforeEach(() => {
  environment.PROSPECTS_CRM_DB_PATH = dbPath;
  environment.ADMIN_ACCESS_TOKEN = "signal-route-test-token";
  environment.ADMIN_SESSION_SECRET = "signal-route-test-secret";
  environment.ADMIN_ROLE = "DATA_ADMIN";
  closeProspectCrmDatabase();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
});
afterAll(() => { closeProspectCrmDatabase(); rmSync(directory, { recursive: true, force: true }); });

function company() {
  return addProspect({ warehouseId: "signal-route-company", snapshot: {
    dedupeKey: "signal-route-company", companyName: "Kactus", commercialName: "Kactus",
    country: "France", territory: "France", region: null, city: null,
    vertical: null, recordOrigin: "manual", sourceUrls: "", leadScore: 0, certification: "bronze"
  } });
}

function payload() {
  return { idempotency_key: "article-test", signal: {
    kind: "article", title: "Kactus annonce une nouvelle équipe", description: "Une équipe finance est annoncée.",
    readiness_dimension: "timing", interpretation: "Reporting à vérifier avec la direction.",
    evidence_type: "observed", source_reference: "Annonce test", source_url: "https://example.test/annonce",
    published_at: "2026-10-01", observed_at: "2026-10-02", archived: false
  } };
}

function jsonRequest(url: string, method: string, body?: unknown, authorized = true) {
  return new NextRequest(url, { method, headers: { ...(body ? { "content-type": "application/json" } : {}),
    ...(authorized ? { "x-admin-token": "signal-route-test-token" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
}

describe("company signal HTTP routes", () => {
  it("protects reads and writes, and returns persisted data to the UI", async () => {
    const account = company();
    const url = `http://localhost/api/prospect-factory/crm/prospects/${account.id}/signals`;
    expect((await listRoute(jsonRequest(url, "GET", undefined, false), { params: Promise.resolve({ id: account.id }) })).status).toBe(401);
    const created = await createRoute(jsonRequest(url, "POST", payload()), { params: Promise.resolve({ id: account.id }) });
    expect(created.status).toBe(201);
    const signal = (await created.json()).signal;
    const listed = await listRoute(jsonRequest(url, "GET"), { params: Promise.resolve({ id: account.id }) });
    expect((await listed.json()).items).toMatchObject([{ id: signal.id, title: "Kactus annonce une nouvelle équipe" }]);
    const editUrl = `${url}/${signal.id}`;
    const updated = await updateRoute(jsonRequest(editUrl, "PATCH", {
      expected_version: signal.version, signal: { ...payload().signal, interpretation: "Hypothèse révisée." }
    }), { params: Promise.resolve({ id: account.id, signalId: signal.id }) });
    expect(updated.status).toBe(200);
    const stale = await updateRoute(jsonRequest(editUrl, "PATCH", {
      expected_version: signal.version, signal: { ...payload().signal, description: "Écriture périmée" }
    }), { params: Promise.resolve({ id: account.id, signalId: signal.id }) });
    expect(stale.status).toBe(409);
  });

  it("accepts a PDF and serves the same bytes only through the authorized account", async () => {
    const account = company();
    const url = `http://localhost/api/prospect-factory/crm/prospects/${account.id}/signals`;
    const created = await createRoute(jsonRequest(url, "POST", payload()), { params: Promise.resolve({ id: account.id }) });
    const signal = (await created.json()).signal;
    const fileUrl = `${url}/${signal.id}/attachments`;
    const bytes = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n", "utf8");
    const form = new FormData(); form.set("file", new File([bytes], "article.pdf", { type: "application/pdf" }));
    const upload = await attachRoute(new NextRequest(fileUrl, { method: "POST",
      headers: { "x-admin-token": "signal-route-test-token" }, body: form }),
    { params: Promise.resolve({ id: account.id, signalId: signal.id }) });
    expect(upload.status).toBe(201);
    const attachment = (await upload.json()).attachment;
    const downloadUrl = `${fileUrl}/${attachment.id}`;
    const response = await downloadRoute(jsonRequest(downloadUrl, "GET"), {
      params: Promise.resolve({ id: account.id, signalId: signal.id, attachmentId: attachment.id })
    });
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("content-type")).toBe("application/pdf");
  });
});
