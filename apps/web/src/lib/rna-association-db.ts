import "server-only";

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type RnaAssociationRow = {
  rna_id: string;
  siren: string;
  former_id: string | null;
  siret: string | null;
  identifier_status: "rna_exact_siret_match" | "rna_exact_no_siret" | "rna_exact_siret_mismatch";
  match_confidence: number;
  public_utility_id: string | null;
  creation_date: string | null;
  declaration_date: string | null;
  publication_date: string | null;
  dissolution_date: string | null;
  nature_code: string | null;
  group_type: string | null;
  title: string | null;
  short_title: string | null;
  purpose: string | null;
  purpose_code_1: string | null;
  purpose_code_2: string | null;
  website: string | null;
  website_publication_authorized: number;
  position_code: string | null;
  updated_at: string | null;
  source_reference_date: string;
  source_url: string;
  imported_at: string;
};

const candidates = [
  (process as unknown as { env: Record<string, string | undefined> }).env.RNA_ASSOCIATION_DB_PATH,
  resolve((process as unknown as { cwd(): string }).cwd(), "data/rna-association-profiles.sqlite"),
  resolve((process as unknown as { cwd(): string }).cwd(), "../../data/rna-association-profiles.sqlite")
].filter((candidate): candidate is string => Boolean(candidate));

const databasePath = candidates.find(existsSync);
let database: DatabaseSync | null = null;

function getDatabase() {
  if (!databasePath) return null;
  database ??= new DatabaseSync(databasePath, { readOnly: true });
  return database;
}

export function getRnaAssociationsBySiren(siren: string) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    "SELECT * FROM association_profiles WHERE siren = ? ORDER BY position_code = 'A' DESC, title, rna_id"
  ).all(siren) as unknown as RnaAssociationRow[];
}

export function getRnaAssociationMetadata() {
  const db = getDatabase();
  if (!db) return null;
  const rows = db.prepare("SELECT key, value FROM metadata").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}
