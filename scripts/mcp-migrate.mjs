import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { backup, DatabaseSync } from "node:sqlite";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const path = resolve(process.env.PROSPECTS_CRM_DB_PATH || "data/prospects-db/prospect_factory_crm.sqlite");
if (!existsSync(path)) throw new Error(`CRM database not found: ${path}`);
const before = new DatabaseSync(path, { readOnly: true });
const oldVersion = Number(before.prepare("PRAGMA user_version").get().user_version);
const backupDirectory = join(dirname(path), "backups");
await mkdir(backupDirectory, { recursive: true });
const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
const backupPath = join(backupDirectory, `${basename(path, ".sqlite")}_before_mcp_${stamp}.sqlite`);
await backup(before, backupPath);
before.close();

const probe = createServer();
await new Promise((done) => probe.listen(0, "127.0.0.1", done));
const port = probe.address().port;
await new Promise((done) => probe.close(done));
const token = randomBytes(32).toString("hex");
const url = `http://127.0.0.1:${port}/mcp`;
const nextCli = resolve("node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextCli, "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: resolve("apps", "web"), windowsHide: true,
  env: { ...process.env, CARAAIOS_MCP_TOKEN: token, PROSPECTS_CRM_DB_PATH: path },
  stdio: ["ignore", "pipe", "pipe"]
});
let output = "";
child.stdout.on("data", (data) => { output = (output + data.toString()).slice(-15_000); });
child.stderr.on("data", (data) => { output = (output + data.toString()).slice(-15_000); });
let client;
try {
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      if ((await fetch(url)).status === 401) { ready = true; break; }
    } catch { /* Starting. */ }
    await delay(1_000);
  }
  if (!ready) throw new Error("MCP server did not start within 90 seconds.");
  client = new Client({ name: "caraaios-migration-check", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } }
  }));
  const result = await client.callTool({ name: "crm_search_companies", arguments: { query: "Caraaios", limit: 1 } });
  if (result.isError) throw new Error(result.content?.[0]?.text || "MCP CRM read failed");
  const verified = new DatabaseSync(path, { readOnly: true });
  const newVersion = Number(verified.prepare("PRAGMA user_version").get().user_version);
  const integrity = verified.prepare("PRAGMA integrity_check").get().integrity_check;
  verified.close();
  assert.ok(newVersion >= 9, `expected CRM schema v9+, got ${newVersion}`);
  assert.equal(integrity, "ok");
  process.stdout.write(`CRM migration verified: schema ${oldVersion} -> ${newVersion}, integrity ok. Backup: ${backupPath}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\nServer output:\n${output}\n`);
  process.exitCode = 1;
} finally {
  await client?.close().catch(() => {});
  child.kill("SIGTERM");
  await delay(1_000);
  if (child.exitCode === null) child.kill("SIGKILL");
}
