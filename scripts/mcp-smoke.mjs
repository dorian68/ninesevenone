import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

async function ready(url) {
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const response = await fetch(url);
      if (response.status === 401) return;
    } catch { /* Next.js is still starting. */ }
    await delay(1_000);
  }
  throw new Error("MCP server did not become ready within 90 seconds.");
}

function content(result) {
  if (result.isError) throw new Error(result.content?.[0]?.text || "MCP tool error");
  if (result.structuredContent) return result.structuredContent;
  return JSON.parse(result.content[0].text);
}

const directory = await mkdtemp(join(tmpdir(), "caraaios-mcp-smoke-"));
const dbPath = join(directory, "crm.sqlite");
const token = randomBytes(32).toString("hex");
const port = await freePort();
const url = `http://127.0.0.1:${port}/mcp`;
const nextCli = resolve("node_modules", "next", "dist", "bin", "next");
const server = spawn(process.execPath, [nextCli, "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: resolve("apps", "web"), windowsHide: true,
  env: { ...process.env, CARAAIOS_MCP_TOKEN: token, PROSPECTS_CRM_DB_PATH: dbPath },
  stdio: ["ignore", "pipe", "pipe"]
});
let serverOutput = "";
server.stdout.on("data", (data) => { serverOutput = (serverOutput + data.toString()).slice(-20_000); });
server.stderr.on("data", (data) => { serverOutput = (serverOutput + data.toString()).slice(-20_000); });

const clients = [];
try {
  await ready(url);
  const unauthorized = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) });
  assert.equal(unauthorized.status, 401, "unauthenticated MCP must be rejected");

  if (process.env.CARAAIOS_MCP_INSPECTOR === "1") {
    const npxCli = resolve(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
    const inspector = spawn(process.execPath, [npxCli, "--yes", "@modelcontextprotocol/inspector@latest",
      "--cli", url, "--transport", "http", "--header", `Authorization: Bearer ${token}`,
      "--method", "tools/list"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let inspectorOutput = "";
    for (const stream of [inspector.stdout, inspector.stderr]) {
      stream.on("data", (data) => { inspectorOutput += data.toString(); });
    }
    const inspectorExit = await new Promise((done, reject) => {
      inspector.on("error", reject);
      inspector.on("exit", done);
    });
    assert.equal(inspectorExit, 0, `MCP Inspector failed: ${inspectorOutput.replaceAll(token, "[redacted]")}`);
    const inspectorTools = new Set(Array.from(
      inspectorOutput.matchAll(/"name"\s*:\s*"(crm_[a-z_]+)"/g), (match) => match[1]
    ));
    assert.equal(inspectorTools.size, 19, "MCP Inspector must discover all 19 tools");
    process.stdout.write("MCP Inspector passed: 19 authenticated tools discovered.\n");
  }

  async function connect(mode) {
    const client = new Client({ name: `caraaios-smoke-${mode}`, version: "1.0.0" },
      mode === "modern" ? { versionNegotiation: { mode: "auto" } } : undefined);
    await client.connect(new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } }
    }));
    clients.push(client);
    return client;
  }
  const legacy = await connect("legacy");
  const listed = await legacy.listTools();
  assert.equal(listed.tools.length, 19, "all 19 business tools must be discoverable");
  assert.ok(listed.tools.some((tool) => tool.name === "crm_import_company_map"));
  assert.ok(listed.tools.some((tool) => tool.name === "crm_upsert_company_signal"));
  const missingCompany = await legacy.callTool({ name: "crm_import_company_map", arguments: {
    source: { source_type: "user_manual", source_reference: "MCP smoke" },
    people: [{ name: "Unattached Contact", evidence_type: "observed" }], dry_run: true
  } });
  assert.equal(missingCompany.isError, true, "dry run still requires a company identity");
  const newCompanyInput = {
    company: { name: "MCP Projection Test", domain: "mcp-projection.example" },
    source: { source_type: "user_manual", source_reference: "MCP smoke" },
    people: [{ name: "Test Contact", evidence_type: "observed", employment_status: "uncertain" }]
  };
  const newCompanyPreview = content(await legacy.callTool({ name: "crm_import_company_map",
    arguments: { ...newCompanyInput, dry_run: true } }));
  assert.equal(newCompanyPreview.company_action, "would_create");
  assert.equal(newCompanyPreview.summary.would_create, 1);
  const beforeCreate = content(await legacy.callTool({ name: "crm_search_companies",
    arguments: { query: "MCP Projection Test" } }));
  assert.equal(beforeCreate.companies.length, 0, "new-company dry run must not write");
  const newCompanyImport = content(await legacy.callTool({ name: "crm_import_company_map",
    arguments: newCompanyInput }));
  assert.equal(newCompanyImport.summary.created, 1);
  const created = content(await legacy.callTool({ name: "crm_upsert_company",
    arguments: { name: "Kactus MCP Smoke", domain: "kactus-smoke.example" } }));
  assert.ok(created.company_id);
  const signalInput = { company_id: created.company_id, idempotency_key: "mcp-smoke-signal",
    signal: { kind: "job_posting", title: "Lead Finance Ops", description: "Kactus recrute un responsable finance ops.",
      readiness_dimension: "timing", interpretation: "Besoin de reporting possible, à vérifier.",
      evidence_type: "observed", source_reference: "Offre d'emploi test",
      source_url: "https://example.test/kactus-finance-job", published_at: "2026-10-01",
      observed_at: "2026-10-02", archived: false } };
  const signal = content(await legacy.callTool({ name: "crm_upsert_company_signal", arguments: signalInput }));
  assert.equal(signal.outcome, "created");
  assert.equal(content(await legacy.callTool({ name: "crm_upsert_company_signal", arguments: signalInput })).outcome, "unchanged");
  const signalPage = content(await legacy.callTool({ name: "crm_get_company_signals",
    arguments: { company_id: created.company_id } })).signals;
  assert.equal(signalPage.total, 1);
  assert.equal(signalPage.items[0].interpretation, signalInput.signal.interpretation);
  const originalPdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n", "utf8");
  const attached = content(await legacy.callTool({ name: "crm_add_company_signal_attachment",
    arguments: { company_id: created.company_id, signal_id: signal.signal.id,
      file_name: "offre.pdf", mime_type: "application/pdf", content_base64: originalPdf.toString("base64") } }));
  assert.equal(attached.created, true);
  const file = content(await legacy.callTool({ name: "crm_get_company_signal_attachment",
    arguments: { company_id: created.company_id, signal_id: signal.signal.id,
      attachment_id: attached.attachment.id } }));
  assert.deepEqual(Buffer.from(file.content_base64, "base64"), originalPdf);
  const originalPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+lKxkAAAAASUVORK5CYII=", "base64");
  const imageAttached = content(await legacy.callTool({ name: "crm_add_company_signal_attachment",
    arguments: { company_id: created.company_id, signal_id: signal.signal.id,
      file_name: "capture.png", mime_type: "image/png", content_base64: originalPng.toString("base64") } }));
  const imageResult = await legacy.callTool({ name: "crm_get_company_signal_attachment",
    arguments: { company_id: created.company_id, signal_id: signal.signal.id,
      attachment_id: imageAttached.attachment.id } });
  const imageBlock = imageResult.content.find((block) => block.type === "image");
  assert.equal(imageBlock?.mimeType, "image/png");
  assert.deepEqual(Buffer.from(imageBlock.data, "base64"), originalPng);
  const opportunity = content(await legacy.callTool({ name: "crm_upsert_opportunity",
    arguments: { company_id: created.company_id, name: "ICP Partenariats" } }));
  assert.ok(opportunity.opportunity_id);
  const people = [
    { name: "Arnaud Katz", title_raw: "CEO", employment_status: "current_employee", evidence_type: "observed",
      linkedin_url: "https://www.linkedin.com/in/arnaud-katz-smoke", notes: "Note conservée depuis la carte" },
    { name: "Paul Averseng", title_raw: "Lead Rev Ops", employment_status: "current_employee", evidence_type: "observed",
      linkedin_url: "https://www.linkedin.com/in/paul-averseng-smoke" },
    { name: "Bruno Lajous", title_raw: "VP Operations & Finance", employment_status: "current_employee", evidence_type: "observed",
      linkedin_url: "https://www.linkedin.com/in/bruno-lajous-smoke" }
  ];
  const input = { company_id: created.company_id,
    source: { source_type: "linkedin_video", source_reference: "PROSPECTION_KACTUS_SMOKE.mp4" },
    people, relationships: [{ from_person_index: 1, to_person_index: 2, kind: "reports_to", evidence_type: "inferred" }],
    buying_committee: [{ person_index: 1, opportunity_id: opportunity.opportunity_id,
      role: "potential_champion", evidence_type: "inferred" }],
    hypotheses: [{ person_index: 2, proposition: "Reporting multi-source probable",
      justification: "Hypothèse de prospection", verification_question: "Quel est le processus réel ?" }],
    idempotency_key: "mcp-smoke-kactus" };
  const preview = content(await legacy.callTool({ name: "crm_import_company_map", arguments: { ...input, dry_run: true } }));
  assert.equal(preview.summary.would_create, 3);
  const imported = content(await legacy.callTool({ name: "crm_import_company_map", arguments: input }));
  assert.equal(imported.summary.created, 3);
  const repeated = content(await legacy.callTool({ name: "crm_import_company_map", arguments: input }));
  assert.equal(repeated.summary.created, 0);
  assert.equal(repeated.summary.unchanged, 3);
  const map = content(await legacy.callTool({ name: "crm_get_company_map",
    arguments: { company_id: created.company_id } })).map;
  assert.equal(map.people.length, 3);
  assert.equal(map.people.find((entry) => entry.name === "Arnaud Katz")?.notes, "Note conservée depuis la carte");
  assert.ok(map.sources.some((entry) => entry.reference === "PROSPECTION_KACTUS_SMOKE.mp4"));
  assert.ok(map.relationships.some((entry) => entry.kind === "reports_to" && entry.evidenceStatus === "hypothesis"));
  assert.ok(map.buying_committee.some((entry) => entry.opportunityId === opportunity.opportunity_id
    && entry.evidenceStatus === "hypothesis"));
  assert.ok(map.hypotheses_and_facts.some((entry) => entry.field === "hypothesis"));
  assert.equal(map.signals.total, 1);
  assert.equal(map.signals.items[0].attachments.length, 2);

  const paul = map.people.find((entry) => entry.name === "Paul Averseng");
  const bruno = map.people.find((entry) => entry.name === "Bruno Lajous");
  assert.ok(paul?.contactId && bruno?.contactId);
  const outreachContext = content(await legacy.callTool({ name: "crm_get_outreach_context",
    arguments: { company_id: created.company_id, contact_id: paul.contactId } })).context;
  assert.equal(outreachContext.contact.id, paul.contactId);
  assert.equal(outreachContext.drafts.total, 0, "reading context must not create a draft");
  const outreachInput = { company_id: created.company_id, idempotency_key: "mcp-smoke-paul-email",
    draft: { contact_id: paul.contactId, icp_id: null, persona_id: null,
      opportunity_id: opportunity.opportunity_id, channel: "email", status: "draft",
      angle: "Hypothèse à vérifier à partir du rôle Rev Ops",
      subject: "Un échange sur les opérations ?",
      body: "Bonjour Paul, votre rôle Rev Ops m'intéresse. Un échange serait-il utile ?",
      call_to_action: "Proposer 15 minutes", signal_ids: [signal.signal.id] } };
  const outreachCreated = content(await legacy.callTool({ name: "crm_upsert_outreach_draft",
    arguments: outreachInput }));
  assert.equal(outreachCreated.outcome, "created");
  assert.equal(outreachCreated.draft.contact_id, paul.contactId);
  assert.equal(content(await legacy.callTool({ name: "crm_upsert_outreach_draft",
    arguments: outreachInput })).outcome, "unchanged");
  const paulDrafts = content(await legacy.callTool({ name: "crm_list_outreach_drafts",
    arguments: { company_id: created.company_id, contact_id: paul.contactId } })).drafts;
  assert.equal(paulDrafts.total, 1);
  assert.deepEqual(paulDrafts.items[0].signal_ids, [signal.signal.id]);
  const brunoDrafts = content(await legacy.callTool({ name: "crm_list_outreach_drafts",
    arguments: { company_id: created.company_id, contact_id: bruno.contactId } })).drafts;
  assert.equal(brunoDrafts.total, 0, "other employees must not receive a draft automatically");
  const outreachUpdated = content(await legacy.callTool({ name: "crm_upsert_outreach_draft",
    arguments: { company_id: created.company_id, draft_id: outreachCreated.draft.id,
      expected_version: outreachCreated.draft.version,
      draft: { ...outreachInput.draft, body: "Bonjour Paul, puis-je vous proposer 15 minutes ?" } } }));
  assert.equal(outreachUpdated.draft.version, 2);
  assert.equal(content(await legacy.callTool({ name: "crm_get_outreach_context",
    arguments: { company_id: created.company_id, contact_id: paul.contactId } })).context.drafts.items[0].body,
  "Bonjour Paul, puis-je vous proposer 15 minutes ?");

  const modern = await connect("modern");
  assert.equal(modern.getProtocolEra(), "modern");
  const modernMap = content(await modern.callTool({ name: "crm_get_company_map",
    arguments: { company_id: created.company_id, include_relationships: false } })).map;
  assert.equal(modernMap.people.length, 3);
  process.stdout.write(`MCP smoke passed: 19 tools, legacy + modern HTTP, auth, company signal and outreach draft round trips, 3 contacts, idempotence, source and inferred map data persisted.\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.stderr.write(`Server output:\n${serverOutput}\n`);
  process.exitCode = 1;
} finally {
  await Promise.all(clients.map((client) => client.close().catch(() => {})));
  server.kill("SIGTERM");
  await delay(1_000);
  if (server.exitCode === null) server.kill("SIGKILL");
  await rm(directory, { recursive: true, force: true });
}
