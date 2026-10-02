import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { OutreachDraftFields } from "./outreach-draft-contract";

const directory = mkdtempSync(join(tmpdir(), "caraaios-outreach-"));
const databasePath = join(directory, "crm.sqlite");
(process as unknown as { env: Record<string, string | undefined> }).env.PROSPECTS_CRM_DB_PATH = databasePath;

let crm: typeof import("./prospect-factory-crm-db");
let outreach: typeof import("./outreach-drafts");
let signals: typeof import("./company-signals");

beforeAll(async () => {
  crm = await import("./prospect-factory-crm-db");
  outreach = await import("./outreach-drafts");
  signals = await import("./company-signals");
});
beforeEach(() => {
  crm.closeProspectCrmDatabase();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${databasePath}${suffix}`, { force: true });
});
afterAll(() => {
  crm.closeProspectCrmDatabase();
  rmSync(directory, { recursive: true, force: true });
});

function company(name: string) {
  const warehouseId = `manual:${name}`;
  return crm.addProspect({ warehouseId, snapshot: {
    dedupeKey: warehouseId, companyName: name, commercialName: name,
    country: "France", territory: "France", region: null, city: null,
    vertical: null, recordOrigin: "manual", sourceUrls: "", leadScore: 0,
    certification: "bronze"
  } });
}

function draft(contactId: string, patch: Partial<OutreachDraftFields> = {}): OutreachDraftFields {
  return { contact_id: contactId, icp_id: null, persona_id: null, opportunity_id: null,
    channel: "email", status: "draft", angle: "Hypothèse à valider", subject: "Un échange ?",
    body: "Bonjour, votre offre d'emploi suggère une évolution de l'équipe.",
    call_to_action: "Échanger 15 minutes", signal_ids: [], ...patch };
}

describe("person-scoped outreach shared by CRM UI and MCP", () => {
  it("creates a draft only for the chosen person, links a sourced signal and replays idempotently", () => {
    const account = company("Kactus");
    const paul = crm.createProspectContact(account.id, { name: "Paul Averseng", inputTitle: "Lead Rev Ops" });
    const bruno = crm.createProspectContact(account.id, { name: "Bruno Lajous" });
    const icp = crm.createIcp({ slug: "partenariats", name: "Partenariats" });
    const persona = crm.createIcpPersona(icp.id, { key: "rev-ops", label: "Rev Ops" });
    const signal = signals.upsertCompanySignal(account.id, { signal: {
      kind: "job_posting", title: "Recrutement Rev Ops", description: "Une offre Rev Ops est publiée.",
      readiness_dimension: "timing", interpretation: "Un projet est possible.",
      evidence_type: "observed", source_reference: "Annonce emploi", source_url: null,
      published_at: "2026-10-01", observed_at: "2026-10-02", archived: false
    } }, "test").signal;
    expect(outreach.listOutreachDrafts(account.id).total).toBe(0);
    const contextBefore = outreach.getOutreachContext(account.id, paul.id, { icpId: icp.id, personaId: persona.id });
    expect(contextBefore.selected_persona?.label).toBe("Rev Ops");
    expect(contextBefore.signals[0]?.id).toBe(signal.id);
    expect(contextBefore.drafts.total).toBe(0);

    const input = { idempotency_key: "kactus-paul-approche-v1", draft: draft(paul.id,
      { icp_id: icp.id, persona_id: persona.id, signal_ids: [signal.id] }) };
    const created = outreach.upsertOutreachDraft(account.id, input, "caraaios-mcp");
    expect(created).toMatchObject({ outcome: "created", draft: { contact_id: paul.id,
      icp_name: "Partenariats", persona_label: "Rev Ops", version: 1, signal_ids: [signal.id] } });
    const replay = outreach.upsertOutreachDraft(account.id, input, "caraaios-mcp");
    expect(replay).toMatchObject({ outcome: "unchanged", draft: { id: created.draft.id } });
    expect(outreach.listOutreachDrafts(account.id, { contactId: paul.id }).total).toBe(1);
    expect(outreach.listOutreachDrafts(account.id, { contactId: bruno.id }).total).toBe(0);
    expect(outreach.getOutreachContext(account.id, paul.id).drafts.items[0]?.id).toBe(created.draft.id);
  });

  it("preserves old copy on update and rejects stale writes and recipient changes", () => {
    const account = company("Kactus");
    const paul = crm.createProspectContact(account.id, { name: "Paul Averseng" });
    const bruno = crm.createProspectContact(account.id, { name: "Bruno Lajous" });
    const first = outreach.upsertOutreachDraft(account.id, { draft: draft(paul.id) }, "ui").draft;
    const second = outreach.upsertOutreachDraft(account.id, { draft_id: first.id, expected_version: 1,
      draft: draft(paul.id, { body: "Nouveau texte adapté au persona." }) }, "caraaios-mcp").draft;
    expect(second).toMatchObject({ version: 2, body: "Nouveau texte adapté au persona." });
    expect(() => outreach.upsertOutreachDraft(account.id, { draft_id: first.id, expected_version: 1,
      draft: draft(paul.id, { body: "Écrasement périmé" }) }, "ui")).toThrow(/changé depuis son ouverture/);
    expect(() => outreach.upsertOutreachDraft(account.id, { draft_id: first.id, expected_version: 2,
      draft: draft(bruno.id) }, "ui")).toThrow(/autre personne/);
    const db = new DatabaseSync(databasePath, { readOnly: true });
    const row = db.prepare("SELECT snapshot_json FROM prospect_factory_outreach_draft_revisions WHERE draft_id=?")
      .get(first.id) as { snapshot_json: string };
    expect(JSON.parse(row.snapshot_json).body).toBe(first.body);
    db.close();
  });

  it("rejects cross-company contacts and signals and mismatched ICP personas", () => {
    const account = company("Kactus");
    const other = company("Autre");
    const paul = crm.createProspectContact(account.id, { name: "Paul Averseng" });
    const foreign = crm.createProspectContact(other.id, { name: "Autre personne" });
    const finance = crm.createIcp({ slug: "finance", name: "Finance" });
    const partnerships = crm.createIcp({ slug: "partenariats", name: "Partenariats" });
    const persona = crm.createIcpPersona(finance.id, { key: "cfo", label: "CFO" });
    expect(() => outreach.upsertOutreachDraft(account.id, { draft: draft(foreign.id) }, "ui"))
      .toThrow(/n'appartient pas/);
    expect(() => outreach.upsertOutreachDraft(account.id, { draft: draft(paul.id,
      { icp_id: partnerships.id, persona_id: persona.id }) }, "ui")).toThrow(/persona/);
    expect(() => outreach.upsertOutreachDraft(account.id, { draft: draft(paul.id,
      { signal_ids: [foreign.id] }) }, "ui")).toThrow(/signal/);
    expect(outreach.listOutreachDrafts(account.id).total).toBe(0);
  });
});
