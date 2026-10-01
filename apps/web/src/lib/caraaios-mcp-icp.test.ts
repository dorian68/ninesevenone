import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const directory = mkdtempSync(join(tmpdir(), "caraaios-icp-"));
const databasePath = join(directory, "crm.sqlite");
(process as unknown as { env: Record<string, string | undefined> }).env.PROSPECTS_CRM_DB_PATH = databasePath;

let crm: typeof import("./prospect-factory-crm-db");
let companyIcps: typeof import("./caraaios-mcp-icp");

beforeAll(async () => {
  crm = await import("./prospect-factory-crm-db");
  companyIcps = await import("./caraaios-mcp-icp");
});
beforeEach(() => {
  crm.closeProspectCrmDatabase();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${databasePath}${suffix}`, { force: true });
});
afterAll(() => {
  crm.closeProspectCrmDatabase();
  rmSync(directory, { recursive: true, force: true });
});

function addCompany() {
  return crm.addProspect({
    warehouseId: "manual:Kactus",
    snapshot: {
      dedupeKey: "manual:Kactus", companyName: "Kactus", commercialName: "Kactus",
      country: "France", territory: "France", region: "Île-de-France", city: "Paris",
      vertical: "SaaS", recordOrigin: "manual", sourceUrls: "", leadScore: 0,
      certification: "bronze"
    }
  });
}

describe("Caraaios company ICP associations", () => {
  it("keeps several ICP assessments without changing the legacy segment", () => {
    const company = addCompany();
    const legacySegment = crm.getMarketOverview().icps[0]!.segments[0]!;
    const classified = crm.updateAccountMarketProfile(company.id, {
      expectedVersion: company.version, market: { segmentId: legacySegment.id }
    }, "test")!.prospect;
    const secondIcp = crm.createIcp({ slug: "partenariats", name: "Partenariats" });

    const initial = companyIcps.getCompanyIcps(company.id)!;
    expect(initial.associations).toMatchObject([{
      icpId: legacySegment.icpId, origin: "legacy_segment", status: "candidate", evidenceType: "unknown"
    }]);

    const saved = companyIcps.upsertCompanyIcp(company.id, {
      icpId: secondIcp.id, status: "investigating", evidenceType: "inferred",
      sourceType: "linkedin_video", sourceReference: "PROSPECTION_KACTUS.mp4",
      notes: "Correspondance possible avec l'équipe partenariats."
    });
    expect(saved.icp.name).toBe("Partenariats");
    expect(saved.observations).toHaveLength(1);
    const context = companyIcps.getCompanyIcps(company.id)!;
    expect(context.associations.map((entry) => entry.icpId).sort()).toEqual([legacySegment.icpId, secondIcp.id].sort());
    expect(crm.getProspect(company.id)!.market.segmentId).toBe(classified.market.segmentId);
    expect(crm.getProspect(company.id)!.version).toBe(classified.version);
  });

  it("is idempotent, retains assessment history, and rejects inferred qualification", () => {
    const company = addCompany();
    const icp = crm.createIcp({ slug: "finance", name: "Finance" });
    const input = { icpId: icp.id, status: "candidate" as const, evidenceType: "inferred" as const,
      sourceType: "chatgpt_research" as const, sourceReference: "Analyse vidéo", notes: "Hypothèse" };
    const first = companyIcps.upsertCompanyIcp(company.id, input);
    const second = companyIcps.upsertCompanyIcp(company.id, input);
    expect(second.version).toBe(first.version);
    expect(second.observations).toHaveLength(1);
    expect(() => companyIcps.upsertCompanyIcp(company.id, { icpId: icp.id, status: "qualified" }))
      .toThrow(/preuve observée/i);
    const updated = companyIcps.upsertCompanyIcp(company.id, {
      icpId: icp.id, status: "qualified", evidenceType: "verified", sourceType: "user_manual",
      sourceReference: "Qualification commerciale confirmée"
    });
    expect(updated.version).toBe(first.version + 1);
    expect(updated.observations.map((entry) => entry.evidenceType)).toEqual(["inferred", "verified"].reverse());
    expect(updated.observations[1].notes).toBe("Hypothèse");
  });

  it("migrates the audit table alongside ICP tables and enforces foreign keys", () => {
    addCompany();
    crm.closeProspectCrmDatabase();
    const db = new DatabaseSync(databasePath);
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(9);
    expect((db.prepare("SELECT COUNT(*) AS total FROM prospect_factory_mcp_audit").get() as { total: number }).total).toBe(0);
    expect(db.prepare("PRAGMA foreign_key_check").get()).toBeUndefined();
    db.close();
  });
});
