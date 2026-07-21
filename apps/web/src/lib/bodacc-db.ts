import "server-only";

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type BodaccEventRow = {
  siren: string;
  event_id: string;
  publication_date: string | null;
  announcement_number: number;
  announcement_type: string | null;
  announcement_type_label: string | null;
  family: string | null;
  family_label: string;
  department_code: string;
  tribunal: string | null;
  city: string | null;
  postal_codes: string | null;
  legal_form: string | null;
  capital: number | null;
  capital_currency: string;
  activity_text: string | null;
  source_url: string | null;
  retrieved_at: string;
};

export type BodaccSearchRow = {
  siren: string;
  event_id: string;
  family_label: string;
  activity_text: string | null;
  city: string | null;
  tribunal: string | null;
  publication_date: string | null;
};

const env = (process as unknown as { env: Record<string, string | undefined> }).env;
const databaseCandidates = [
  env.BODACC_DB_PATH,
  resolve((process as unknown as { cwd(): string }).cwd(), "data/bodacc-guadeloupe.sqlite"),
  resolve((process as unknown as { cwd(): string }).cwd(), "../../data/bodacc-guadeloupe.sqlite")
].filter((candidate): candidate is string => Boolean(candidate));
const databasePath = databaseCandidates.find(existsSync);
let database: DatabaseSync | null = null;
let available: boolean | null = null;

function getDatabase() {
  if (!databasePath) return null;
  database ??= new DatabaseSync(databasePath, { readOnly: true });
  return database;
}

function hasIndex() {
  if (available !== null) return available;
  const db = getDatabase();
  if (!db) return false;
  available = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bodacc_events'").get());
  return available;
}

function ftsQuery(raw: string) {
  const tokens = raw.normalize("NFD").replace(/\p{Diacritic}/gu, "").match(/[a-zA-Z0-9]+/g) ?? [];
  return tokens.map((token) => `"${token}"*`).join(" AND ");
}

export function getBodaccMetadata() {
  const db = getDatabase();
  if (!db || !hasIndex()) return null;
  const rows = db.prepare("SELECT key, value FROM metadata").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export function getBodaccEventsBySiren(siren: string, limit = 30) {
  const db = getDatabase();
  if (!db || !hasIndex() || !/^\d{9}$/.test(siren)) return null;
  const rows = db.prepare(
    `SELECT siren, event_id, publication_date, announcement_number, announcement_type,
            announcement_type_label, family, family_label, department_code, tribunal,
            city, postal_codes, legal_form, capital, capital_currency, activity_text,
            source_url, retrieved_at
     FROM bodacc_events
     WHERE siren = ?
     ORDER BY publication_date DESC, event_id DESC
     LIMIT ?`
  ).all(siren, limit) as unknown as BodaccEventRow[];
  const total = Number((db.prepare("SELECT COUNT(*) AS count FROM bodacc_events WHERE siren = ?").get(siren) as { count: number } | undefined)?.count ?? 0);
  return { total, rows };
}

export function searchBodaccSignals(rawQuery: string, limit = 24) {
  const db = getDatabase();
  if (!db || !hasIndex()) return null;
  const query = ftsQuery(rawQuery.trim());
  if (!query) return [];
  try {
    return db.prepare(
      `SELECT s.siren, s.event_id, s.family_label, s.activity_text, s.city,
              s.tribunal, e.publication_date
       FROM bodacc_search s
       JOIN bodacc_events e ON e.siren = s.siren AND e.event_id = s.event_id
       WHERE bodacc_search MATCH ?
       ORDER BY bm25(bodacc_search), e.publication_date DESC
       LIMIT ?`
    ).all(query, limit) as unknown as BodaccSearchRow[];
  } catch {
    return [];
  }
}
