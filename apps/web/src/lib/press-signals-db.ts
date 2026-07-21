import "server-only";

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type PressSignalRow = {
  siren: string;
  title: string;
  url: string;
  domain: string | null;
  published_at: string | null;
  language: string | null;
  source_country: string | null;
  source: string;
  confidence: number;
  query_name: string;
  retrieved_at: string;
};

const candidates = [
  (process as unknown as { env: Record<string, string | undefined> }).env.PRESS_SIGNALS_DB_PATH,
  resolve((process as unknown as { cwd(): string }).cwd(), "data/press-signals.sqlite"),
  resolve((process as unknown as { cwd(): string }).cwd(), "../../data/press-signals.sqlite")
].filter((candidate): candidate is string => Boolean(candidate));
const databasePath = candidates.find(existsSync);
let database: DatabaseSync | null = null;
let pressSearchRowsCache: PressSignalRow[] | null = null;

function getDatabase() {
  if (!databasePath) return null;
  database ??= new DatabaseSync(databasePath, { readOnly: true });
  return database;
}

export function getPressSignalSnapshotBySiren(siren: string) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  const log = db.prepare("SELECT status, mention_count, fetched_at, error FROM fetch_log WHERE siren = ?").get(siren) as { status: string; mention_count: number; fetched_at: string; error: string | null } | undefined;
  if (!log) return null;
  const mentions = db.prepare(
    "SELECT siren, title, url, domain, published_at, language, source_country, source, confidence, query_name, retrieved_at FROM press_mentions WHERE siren = ? ORDER BY published_at DESC, source LIMIT 40"
  ).all(siren) as unknown as PressSignalRow[];
  return { ...log, mentions };
}

export function getPressSignalMetadata() {
  const db = getDatabase();
  if (!db) return null;
  const rows = db.prepare("SELECT key, value FROM metadata").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

function normalizeSearchText(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr");
}

export function searchPressSignals(rawQuery: string, limit = 24) {
  const db = getDatabase();
  if (!db) return null;
  const tokens = normalizeSearchText(rawQuery).split(/[^a-z0-9]+/).filter((token) => token.length >= 2);
  if (!tokens.length) return [];
  if (!pressSearchRowsCache) {
    pressSearchRowsCache = db.prepare(
      "SELECT siren,title,url,domain,published_at,language,source_country,source,confidence,query_name,retrieved_at FROM press_mentions ORDER BY published_at DESC"
    ).all() as unknown as PressSignalRow[];
  }
  const rows = pressSearchRowsCache;
  return rows.filter((row) => {
    const haystack = normalizeSearchText([row.title, row.domain ?? "", row.query_name].join(" "));
    return tokens.every((token) => haystack.includes(token));
  }).slice(0, limit);
}
