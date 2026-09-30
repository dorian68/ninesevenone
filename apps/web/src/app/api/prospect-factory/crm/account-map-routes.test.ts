import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { addProspect, closeProspectCrmDatabase, createProspectContact } from "@/lib/prospect-factory-crm-db";
import { GET as getMap } from "./prospects/[id]/map/route";
import { POST as postResource } from "./prospects/[id]/map/[resource]/route";
import { PATCH as patchItem } from "./prospects/[id]/map/[resource]/[itemId]/route";

const directory = mkdtempSync(join(tmpdir(), "guad-map-routes-"));
const databasePath = join(directory, "crm.sqlite");
const environment = process.env as Record<string, string | undefined>;
const base = "/api/prospect-factory/crm/prospects";

function account(name: string) {
  return addProspect({ warehouseId: `map-route:${name}`, snapshot: {
    dedupeKey: `map-route:${name}`, companyName: name, commercialName: name,
    country: "France", territory: "Guadeloupe", region: "Guadeloupe", city: "Baie-Mahault",
    vertical: "Services", recordOrigin: "test", sourceUrls: "", leadScore: 0, certification: "gold"
  } });
}
function request(path: string, method = "GET", body?: unknown, authenticated = true) {
  return new NextRequest(`http://localhost${path}`, {
    method, headers: { ...(authenticated ? { "x-admin-token": "map-route-token" } : {}),
      ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}
const context = (id: string, resource?: string, itemId?: string) => ({ params: Promise.resolve({ id, resource, itemId }) });

beforeEach(() => {
  environment.ADMIN_ACCESS_TOKEN = "map-route-token";
  environment.ADMIN_SESSION_SECRET = "map-route-secret";
  environment.ADMIN_ROLE = "DATA_ADMIN";
  environment.PROSPECTS_CRM_DB_PATH = databasePath;
  closeProspectCrmDatabase();
  for (const path of [databasePath, `${databasePath}-shm`, `${databasePath}-wal`]) rmSync(path, { force: true });
});
afterAll(() => { closeProspectCrmDatabase(); rmSync(directory, { recursive: true, force: true }); });

describe("Account map routes", () => {
  it("keeps existing contacts visible without automatically creating relations", async () => {
    const prospect = account("Route Démo");
    createProspectContact(prospect.id, { name: "Camille Exemple" });
    const path = `${base}/${prospect.id}/map`;
    expect((await getMap(request(path, "GET", undefined, false), context(prospect.id))).status).toBe(401);
    const response = await getMap(request(path), context(prospect.id));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.map.nodes).toHaveLength(2);
    expect(result.map.relations).toEqual([]);
  });

  it("saves and reloads notes supplied when adding a person node", async () => {
    const prospect = account("Route Notes Personne");
    const contact = createProspectContact(prospect.id, { name: "Camille Exemple" });
    const path = `${base}/${prospect.id}/map`;
    const notes = "A rencontré la personne au salon. Rappeler mardi.";
    const created = await postResource(request(`${path}/nodes`, "POST", { kind: "person", contactId: contact.id, notes }), context(prospect.id, "nodes"));
    expect(created.status).toBe(201);
    const createdPayload = await created.json();
    expect(createdPayload.node.notes).toBe(notes);

    const reloaded = await getMap(request(path), context(prospect.id));
    expect(reloaded.status).toBe(200);
    const reloadedPayload = await reloaded.json();
    expect(reloadedPayload.map.nodes.find((node: { id: string }) => node.id === createdPayload.node.id)?.notes).toBe(notes);
  });

  it("edits sourced relations with optimistic version checks and account boundaries", async () => {
    const prospect = account("Route Relations");
    const other = account("Autre Route");
    createProspectContact(prospect.id, { name: "Camille Exemple" });
    const path = `${base}/${prospect.id}/map`;
    const nodes = (await (await getMap(request(path), context(prospect.id))).json()).map.nodes as Array<{ id: string; kind: string }>;
    const person = nodes.find((node) => node.kind === "person")!;
    const root = nodes.find((node) => node.kind === "unit")!;
    const sourceResponse = await postResource(request(`${path}/sources`, "POST", { kind: "meeting_note", label: "Échange documenté", excerpt: "Camille travaille dans cette société." }), context(prospect.id, "sources"));
    expect(sourceResponse.status).toBe(201);
    const source = (await sourceResponse.json()).source as { id: string };
    const relationResponse = await postResource(request(`${path}/relations`, "POST", {
      fromNodeId: person.id, toNodeId: root.id, kind: "works_in", evidenceStatus: "observed", sourceId: source.id
    }), context(prospect.id, "relations"));
    expect(relationResponse.status).toBe(201);
    const relation = (await relationResponse.json()).relation as { id: string; version: number };
    const patchPath = `${path}/relations/${relation.id}`;
    const promoted = await patchItem(request(patchPath, "PATCH", { expectedVersion: relation.version, evidenceStatus: "confirmed" }), context(prospect.id, "relations", relation.id));
    expect(promoted.status).toBe(200);
    expect((await promoted.json()).relation.validatedBy).toMatch(/^credential:/);
    const stale = await patchItem(request(patchPath, "PATCH", { expectedVersion: relation.version, notes: "trop tard" }), context(prospect.id, "relations", relation.id));
    expect(stale.status).toBe(409);
    const foreign = await postResource(request(`${base}/${other.id}/map/relations`, "POST", {
      fromNodeId: person.id, toNodeId: root.id, kind: "works_in", justification: "à vérifier",
      verificationQuestion: "Affiliation ?"
    }), context(other.id, "relations"));
    expect(foreign.status).toBe(422);
  });
});
