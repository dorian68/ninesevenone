import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { CompanySignalFields } from "./company-signal-contract";

const directory = mkdtempSync(join(tmpdir(), "caraaios-signals-"));
const databasePath = join(directory, "crm.sqlite");
(process as unknown as { env: Record<string, string | undefined> }).env.PROSPECTS_CRM_DB_PATH = databasePath;

let crm: typeof import("./prospect-factory-crm-db");
let signals: typeof import("./company-signals");
let mcp: typeof import("./caraaios-mcp-crm");

beforeAll(async () => {
  crm = await import("./prospect-factory-crm-db");
  signals = await import("./company-signals");
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

function addCompany(name = "Kactus", warehouseId = "manual:kactus") {
  return crm.addProspect({ warehouseId, snapshot: {
    dedupeKey: warehouseId, companyName: name, commercialName: name,
    country: "France", territory: "France", region: null, city: null,
    vertical: null, recordOrigin: "manual", sourceUrls: "", leadScore: 0,
    certification: "bronze"
  } });
}

function article(overrides: Partial<CompanySignalFields> = {}): CompanySignalFields {
  return { kind: "article", title: "Kactus ouvre un nouveau marché", description: "Le communiqué annonce une nouvelle équipe commerciale.",
    readiness_dimension: "timing", interpretation: "Une nouvelle équipe pourrait avoir besoin de reporting.",
    evidence_type: "observed", source_reference: "Article Kactus", source_url: "https://example.test/kactus-annonce",
    published_at: "2026-09-30", observed_at: "2026-10-01", archived: false, ...overrides };
}

describe("company signals shared by UI and MCP", () => {
  it("stores a sourced signal, returns it through the company map and deduplicates a replay", () => {
    const company = addCompany();
    const input = { signal: article(), idempotency_key: "kactus-annonce-2026" };
    const first = signals.upsertCompanySignal(company.id, input, "ui:DATA_ADMIN");
    expect(first.outcome).toBe("created");
    expect(first.signal.version).toBe(1);
    expect(first.signal.interpretation).toBe("Une nouvelle équipe pourrait avoir besoin de reporting.");
    const repeated = signals.upsertCompanySignal(company.id, input, "caraaios-mcp");
    expect(repeated).toMatchObject({ outcome: "unchanged", signal: { id: first.signal.id } });
    expect(signals.listCompanySignals(company.id).total).toBe(1);
    const map = mcp.getCaraaiosCompanyMap(company.id);
    expect(map?.signals?.items).toMatchObject([{ id: first.signal.id, title: input.signal.title,
      description: input.signal.description, evidence_type: "observed" }]);
    expect(mcp.getCaraaiosCompanyMap(company.id, { include_signals: false })?.signals).toBeUndefined();
    const db = new DatabaseSync(databasePath, { readOnly: true });
    expect(Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version)).toBe(11);
    db.close();
  });

  it("keeps prior versions and rejects stale or unsourced factual updates", () => {
    const company = addCompany();
    const first = signals.upsertCompanySignal(company.id, { signal: article() }, "ui:DATA_ADMIN").signal;
    const changed = signals.upsertCompanySignal(company.id, { signal_id: first.id, expected_version: 1,
      signal: article({ interpretation: "Nouvelle hypothèse à vérifier." }) }, "caraaios-mcp");
    expect(changed).toMatchObject({ outcome: "updated", signal: { version: 2 } });
    expect(() => signals.upsertCompanySignal(company.id, { signal_id: first.id, expected_version: 1,
      signal: article({ description: "Écriture périmée" }) }, "ui:DATA_ADMIN")).toThrow(/changé depuis son ouverture/);
    expect(signals.getCompanySignal(company.id, first.id)?.description).toBe(first.description);
    expect(() => signals.upsertCompanySignal(company.id, { signal: article({ source_reference: null, source_url: null }) }, "ui:DATA_ADMIN"))
      .toThrow(/source/);
    const db = new DatabaseSync(databasePath, { readOnly: true });
    expect((db.prepare("SELECT COUNT(*) AS n FROM prospect_factory_company_signal_revisions").get() as { n: number }).n).toBe(1);
    db.close();
  });

  it("stores original PDFs once, scopes reads to the company and archives without deleting", () => {
    const company = addCompany();
    const other = addCompany("Autre", "manual:other");
    const first = signals.upsertCompanySignal(company.id, { signal: article() }, "ui:DATA_ADMIN").signal;
    const bytes = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n", "utf8");
    const attached = signals.addCompanySignalAttachment(company.id, first.id,
      { fileName: "annonce.pdf", mimeType: "application/pdf", bytes }, "ui:DATA_ADMIN");
    expect(attached.created).toBe(true);
    expect(signals.addCompanySignalAttachment(company.id, first.id,
      { fileName: "copie.pdf", mimeType: "application/pdf", bytes }, "caraaios-mcp").created).toBe(false);
    expect(signals.getCompanySignalAttachment(company.id, first.id, attached.attachment.id)?.bytes).toEqual(bytes);
    expect(signals.getCompanySignalAttachment(other.id, first.id, attached.attachment.id)).toBeNull();
    expect(signals.listCompanySignals(company.id).items[0].attachments).toHaveLength(1);
    expect(() => signals.addCompanySignalAttachment(company.id, first.id,
      { fileName: "faux.png", mimeType: "image/png", bytes }, "ui:DATA_ADMIN")).toThrow(/PDF, PNG/);
    const archived = signals.upsertCompanySignal(company.id, { signal_id: first.id, expected_version: first.version,
      signal: article({ archived: true }) }, "ui:DATA_ADMIN").signal;
    expect(signals.listCompanySignals(company.id).total).toBe(0);
    expect(signals.listCompanySignals(company.id, { includeArchived: true }).items[0].attachments).toHaveLength(1);
    signals.upsertCompanySignal(company.id, { signal_id: first.id, expected_version: archived.version,
      signal: article() }, "ui:DATA_ADMIN");
    expect(signals.listCompanySignals(company.id).total).toBe(1);
  });
});
