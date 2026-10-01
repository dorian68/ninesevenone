import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const directory = mkdtempSync(join(tmpdir(), "caraaios-company-"));
const databasePath = join(directory, "crm.sqlite");
(process as unknown as { env: Record<string, string | undefined> }).env.PROSPECTS_CRM_DB_PATH = databasePath;

let crm: typeof import("./prospect-factory-crm-db");
let mcp: typeof import("./caraaios-mcp-crm");

beforeAll(async () => {
  crm = await import("./prospect-factory-crm-db");
  mcp = await import("./caraaios-mcp-crm");
});
beforeEach(() => {
  crm.closeProspectCrmDatabase();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${databasePath}${suffix}`, { force: true });
});
afterAll(() => {
  crm.closeProspectCrmDatabase();
  rmSync(directory, { recursive: true, force: true });
});

function addExisting(name: string, warehouseId: string, website?: string) {
  return crm.addProspect({
    warehouseId,
    snapshot: {
      dedupeKey: warehouseId, companyName: name, commercialName: name,
      country: "France", territory: "France", region: null, city: null,
      vertical: null, recordOrigin: "manual", sourceUrls: "", leadScore: 0,
      certification: "bronze", website: website ?? null
    }
  });
}

describe("Caraaios MCP company operations", () => {
  it("creates and then finds one company by normalized domain", () => {
    const created = mcp.upsertCaraaiosCompany({
      name: "Kactus", domain: "https://www.kactus.com/", linkedin_url: "https://www.linkedin.com/company/kactus/",
      country: "France", territory: "France"
    });
    expect(created).toMatchObject({ created: true, updated: false });
    expect(created.company.snapshot.companyName).toBe("Kactus");
    expect(created.company.enrichment.website ?? created.company.snapshot.website).toBe("https://kactus.com");
    expect(mcp.resolveCaraaiosCompany({ name: "Kactus", domain: "www.kactus.com" })?.id).toBe(created.company.id);
    const repeated = mcp.upsertCaraaiosCompany({ name: "Kactus", domain: "kactus.com" });
    expect(repeated).toMatchObject({ created: false, updated: false });
    expect(repeated.company.id).toBe(created.company.id);
    expect(crm.listProspects({ query: "Kactus" }).total).toBe(1);
  });

  it("enriches an existing CRM account and exposes it through search/get", () => {
    const existing = addExisting("Acme Caraïbes", "manual:acme");
    const enriched = mcp.upsertCaraaiosCompany({ name: "  ACME  Caraïbes ", domain: "acme.example" });
    expect(enriched).toMatchObject({ created: false, updated: true });
    expect(enriched.company.id).toBe(existing.id);
    expect(enriched.company.enrichment.website).toBe("https://acme.example");
    const result = mcp.searchCaraaiosCompanies("Acme Caraïbes");
    expect(result.total).toBe(1);
    expect(result.companies[0].company_id).toBe(existing.id);
    expect(mcp.getCaraaiosCompany(existing.id)).toMatchObject({
      company_id: existing.id, name: "Acme Caraïbes", domain: "acme.example", contact_count: 0
    });
    expect(mcp.getCaraaiosCompany("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("returns a conflict for ambiguous names and contradictory domain evidence", () => {
    const first = addExisting("John Martin Conseil", "manual:john:one", "https://john-one.example");
    const second = addExisting("John Martin Conseil", "manual:john:two", "https://john-two.example");
    expect(() => mcp.upsertCaraaiosCompany({ name: "John Martin Conseil" })).toThrow(mcp.CaraaiosMcpConflict);
    try {
      mcp.resolveCaraaiosCompany({ name: "John Martin Conseil" });
      throw new Error("Un conflit était attendu.");
    } catch (error) {
      expect(error).toBeInstanceOf(mcp.CaraaiosMcpConflict);
      expect((error as InstanceType<typeof mcp.CaraaiosMcpConflict>).candidates.sort()).toEqual([first.id, second.id].sort());
    }

    const other = addExisting("Autre société", "manual:other", "https://other.example");
    expect(() => mcp.resolveCaraaiosCompany({ name: "Autre société", domain: "john-one.example" }))
      .toThrow(mcp.CaraaiosMcpConflict);
    expect(crm.listProspects({}).total).toBe(3);
    expect(mcp.resolveCaraaiosCompany({ company_id: other.id, name: "Autre société" })?.id).toBe(other.id);
  });
});
