import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const WORKSPACE_COOKIE = "guad_workspace";
const COOKIE_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export type WorkspaceCandidate = {
  establishmentId: string;
  siren: string;
  siret: string;
  name: string;
  legalName: string;
  commune: string;
  sector: string;
  nafCode: string;
  address: string;
  description: string;
  workforceBand?: string | null;
  workforceYear?: number | null;
  isHeadOffice?: boolean;
  url: string;
};

export type WorkspaceSavedSearch = {
  id: string;
  name: string;
  query: string;
  sector: string;
  commune: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceShortlist = {
  id: string;
  name: string;
  items: WorkspaceCandidate[];
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceDraft = {
  id: string;
  type: "cv" | "proposal";
  title: string;
  targetSiren: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceSnapshot = {
  savedSearches: WorkspaceSavedSearch[];
  shortlists: WorkspaceShortlist[];
  drafts: WorkspaceDraft[];
};

export type WorkspaceContext = {
  workspaceId: string;
  token: string;
  isNew: boolean;
};

const env = (process as unknown as { env: Record<string, string | undefined> }).env;
const databasePath = env.WORKSPACE_DB_PATH ?? resolve((process as unknown as { cwd(): string }).cwd(), "data/workspaces.sqlite");
let database: DatabaseSync | null = null;

function now() {
  return new Date().toISOString();
}

export function getWorkspaceRetentionDays() {
  const value = Number(env.WORKSPACE_RETENTION_DAYS ?? "180");
  return Number.isInteger(value) && value >= 1 && value <= 730 ? value : 180;
}

function expiresAt() {
  return new Date(Date.now() + getWorkspaceRetentionDays() * 24 * 60 * 60 * 1000).toISOString();
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function getDatabase() {
  if (database) return database;
  mkdirSync(dirname(databasePath), { recursive: true });
  database = new DatabaseSync(databasePath);
  const db = database;
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS workspace_sessions (
      workspace_id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT
    );
    CREATE TABLE IF NOT EXISTS workspace_saved_searches (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspace_sessions(workspace_id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      query TEXT NOT NULL DEFAULT '',
      sector TEXT NOT NULL DEFAULT '',
      commune TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workspace_saved_searches_workspace_idx
      ON workspace_saved_searches(workspace_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS workspace_shortlists (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspace_sessions(workspace_id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      items_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workspace_shortlists_workspace_idx
      ON workspace_shortlists(workspace_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS workspace_drafts (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspace_sessions(workspace_id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('cv', 'proposal')),
      title TEXT NOT NULL,
      target_siren TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workspace_drafts_workspace_idx
      ON workspace_drafts(workspace_id, updated_at DESC);
  `);
  const sessionColumns = db.prepare("PRAGMA table_info(workspace_sessions)").all() as Array<{ name: string }>;
  if (!sessionColumns.some((column) => column.name === "expires_at")) db.exec("ALTER TABLE workspace_sessions ADD COLUMN expires_at TEXT");
  return db;
}

function newToken() {
  return randomBytes(32).toString("hex");
}

export function ensureWorkspace(tokenValue: string | undefined): WorkspaceContext {
  const db = getDatabase();
  const candidate = tokenValue && COOKIE_TOKEN_PATTERN.test(tokenValue) ? tokenValue : null;
  if (candidate) {
    const existing = db.prepare("SELECT workspace_id, expires_at FROM workspace_sessions WHERE token_hash = ?").get(tokenHash(candidate)) as { workspace_id: string; expires_at: string | null } | undefined;
    if (existing) {
      if (existing.expires_at && existing.expires_at <= now()) {
        db.prepare("DELETE FROM workspace_sessions WHERE workspace_id = ?").run(existing.workspace_id);
      } else {
        db.prepare("UPDATE workspace_sessions SET updated_at = ?, expires_at = ? WHERE workspace_id = ?").run(now(), expiresAt(), existing.workspace_id);
        return { workspaceId: existing.workspace_id, token: candidate, isNew: false };
      }
    }
  }
  const token = newToken();
  const workspaceId = randomUUID();
  const timestamp = now();
  db.prepare("INSERT INTO workspace_sessions(workspace_id, token_hash, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?)").run(workspaceId, tokenHash(token), timestamp, timestamp, expiresAt());
  return { workspaceId, token, isNew: true };
}

function parseItems(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as WorkspaceCandidate[] : [];
  } catch {
    return [];
  }
}

export function getWorkspaceSnapshot(workspaceId: string): WorkspaceSnapshot {
  const db = getDatabase();
  const savedSearches = db.prepare(
    "SELECT id, name, query, sector, commune, created_at, updated_at FROM workspace_saved_searches WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 30"
  ).all(workspaceId) as Array<{ id: string; name: string; query: string; sector: string; commune: string; created_at: string; updated_at: string }>;
  const shortlists = db.prepare(
    "SELECT id, name, items_json, created_at, updated_at FROM workspace_shortlists WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 30"
  ).all(workspaceId) as Array<{ id: string; name: string; items_json: string; created_at: string; updated_at: string }>;
  const drafts = db.prepare(
    "SELECT id, type, title, target_siren, content, created_at, updated_at FROM workspace_drafts WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 30"
  ).all(workspaceId) as Array<{ id: string; type: "cv" | "proposal"; title: string; target_siren: string | null; content: string; created_at: string; updated_at: string }>;
  return {
    savedSearches: savedSearches.map((row) => ({ id: row.id, name: row.name, query: row.query, sector: row.sector, commune: row.commune, createdAt: row.created_at, updatedAt: row.updated_at })),
    shortlists: shortlists.map((row) => ({ id: row.id, name: row.name, items: parseItems(row.items_json), createdAt: row.created_at, updatedAt: row.updated_at })),
    drafts: drafts.map((row) => ({ id: row.id, type: row.type, title: row.title, targetSiren: row.target_siren, content: row.content, createdAt: row.created_at, updatedAt: row.updated_at }))
  };
}

export function saveWorkspaceSearch(workspaceId: string, input: { name: string; query: string; sector: string; commune: string }) {
  const db = getDatabase();
  const id = randomUUID();
  const timestamp = now();
  db.prepare(
    "INSERT INTO workspace_saved_searches(id, workspace_id, name, query, sector, commune, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, workspaceId, input.name, input.query, input.sector, input.commune, timestamp, timestamp);
  return getWorkspaceSnapshot(workspaceId).savedSearches.find((item) => item.id === id) ?? null;
}

export function saveWorkspaceShortlist(workspaceId: string, input: { name: string; items: WorkspaceCandidate[] }) {
  const db = getDatabase();
  const id = randomUUID();
  const timestamp = now();
  db.prepare(
    "INSERT INTO workspace_shortlists(id, workspace_id, name, items_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, workspaceId, input.name, JSON.stringify(input.items), timestamp, timestamp);
  return getWorkspaceSnapshot(workspaceId).shortlists.find((item) => item.id === id) ?? null;
}

export function saveWorkspaceDraft(workspaceId: string, input: { type: "cv" | "proposal"; title: string; targetSiren: string | null; content: string }) {
  const db = getDatabase();
  const id = randomUUID();
  const timestamp = now();
  db.prepare(
    "INSERT INTO workspace_drafts(id, workspace_id, type, title, target_siren, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, workspaceId, input.type, input.title, input.targetSiren, input.content, timestamp, timestamp);
  return getWorkspaceSnapshot(workspaceId).drafts.find((item) => item.id === id) ?? null;
}

export function deleteWorkspaceResource(workspaceId: string, resource: "saved-searches" | "shortlists" | "drafts", id: string) {
  const table = resource === "saved-searches" ? "workspace_saved_searches" : resource === "shortlists" ? "workspace_shortlists" : "workspace_drafts";
  const result = getDatabase().prepare(`DELETE FROM ${table} WHERE workspace_id = ? AND id = ?`).run(workspaceId, id);
  return Number(result.changes) > 0;
}

export function clearWorkspace(workspaceId: string) {
  const db = getDatabase();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM workspace_saved_searches WHERE workspace_id = ?").run(workspaceId);
    db.prepare("DELETE FROM workspace_shortlists WHERE workspace_id = ?").run(workspaceId);
    db.prepare("DELETE FROM workspace_drafts WHERE workspace_id = ?").run(workspaceId);
    db.prepare("DELETE FROM workspace_sessions WHERE workspace_id = ?").run(workspaceId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
