import "server-only";

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getNafLabel } from "@/lib/naf";
import { findNafCodesForTerms } from "@/lib/naf";
import { getVerifiedCompanySirens } from "@/lib/moderation-db";
import { extractSearchTerms, parseStructuredSearch } from "@/lib/search-query";

export type EnterpriseRow = {
  id: number;
  siren: string;
  siret: string;
  legal_name: string;
  trade_name: string | null;
  naf_code: string | null;
  sector: string;
  commune: string;
  commune_code: string;
  postal_code: string | null;
  address: string | null;
  address_id: string | null;
  latitude: number | null;
  longitude: number | null;
  creation_date: string | null;
  workforce_band: string | null;
  workforce_year: number | null;
  is_head_office: number;
  employer: string | null;
  administrative_status: string | null;
  diffusion_status: string | null;
  last_processed_at: string | null;
  period_count: number | null;
  geocoding_precision: string | null;
  geocoding_source: string | null;
  description: string;
};

export type EnterpriseCompanyRow = {
  siren: string;
  legal_name: string;
  usual_name: string | null;
  acronym: string | null;
  legal_category: string | null;
  creation_date: string | null;
  administrative_status: string | null;
  diffusion_status: string | null;
  company_category: string | null;
  company_category_year: number | null;
  workforce_band: string | null;
  workforce_year: number | null;
  primary_activity: string | null;
  head_office_nic: string | null;
  association_id: string | null;
  social_economy: string | null;
  mission_company: string | null;
  employer: string | null;
  period_start_date: string | null;
  last_processed_at: string | null;
  period_count: number | null;
  source: string;
  source_reference_date: string;
};

type MapFilters = {
  sector?: string;
  commune?: string;
  verified?: boolean;
  workforceBand?: string;
  headOffice?: boolean;
  employer?: boolean;
  postalCode?: string;
  nafCode?: string;
  recent?: boolean;
};

const workforceLabels: Record<string, string> = {
  NN: "Effectif inconnu",
  "00": "0 salarié",
  "01": "1 à 2 salariés",
  "02": "3 à 5 salariés",
  "03": "6 à 9 salariés",
  "11": "10 à 19 salariés",
  "12": "20 à 49 salariés",
  "21": "50 à 99 salariés",
  "22": "100 à 199 salariés",
  "31": "200 à 249 salariés",
  "32": "250 à 499 salariés",
  "41": "500 à 999 salariés",
  "42": "1 000 à 1 999 salariés",
  "51": "2 000 à 4 999 salariés",
  "52": "5 000 à 9 999 salariés",
  "53": "10 000 salariés ou plus"
};

type EnterpriseFilterOptions = {
  sectors: string[];
  communes: string[];
  workforceBands: Array<{ code: string; label: string }>;
};

const databaseCandidates = [
  (process as unknown as { env: Record<string, string | undefined> }).env.GUADELOUPE_DB_PATH,
  resolve((process as unknown as { cwd(): string }).cwd(), "data/guadeloupe-enterprises.sqlite"),
  resolve((process as unknown as { cwd(): string }).cwd(), "../../data/guadeloupe-enterprises.sqlite")
].filter((candidate): candidate is string => Boolean(candidate));

const databasePath = databaseCandidates.find(existsSync);
let database: DatabaseSync | null = null;
let filterOptionsCache: EnterpriseFilterOptions | null = null;

function getDatabase() {
  if (!databasePath) return null;
  database ??= new DatabaseSync(databasePath, { readOnly: true });
  return database;
}

export function hasEnterpriseDatabase() {
  return Boolean(databasePath);
}

export function getEnterpriseMetadata() {
  const db = getDatabase();
  if (!db) return null;
  const rows = db.prepare("SELECT key, value FROM metadata").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

function slugify(value: string) {
  return value.toLocaleLowerCase("fr").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function serializeEnterprise(row: EnterpriseRow) {
  const name = row.trade_name || row.legal_name;
  const nafLabel = getNafLabel(row.naf_code);
  return {
    establishmentId: `db_${row.siret}`,
    companyId: `db_company_${row.siren}`,
    siren: row.siren,
    siret: row.siret,
    name,
    legalName: row.legal_name,
    commune: row.commune,
    communeCode: row.commune_code,
    sector: row.sector,
    nafCode: row.naf_code ?? "Non renseigné",
    address: row.address ?? `${row.postal_code ?? ""} ${row.commune}`.trim(),
    description: nafLabel
      ? `Établissement enregistré dans l’activité « ${nafLabel} » (code NAF ${row.naf_code}).`
      : row.description,
    latitude: row.latitude,
    longitude: row.longitude,
    verified: false,
    workforceBand: row.workforce_band ? workforceLabels[row.workforce_band] ?? row.workforce_band : null,
    workforceYear: row.workforce_year,
    isHeadOffice: Boolean(row.is_head_office),
    employer: row.employer === null ? null : row.employer === "O",
    slug: slugify(row.legal_name),
    url: `/entreprises/${slugify(row.commune)}/${slugify(row.legal_name)}-${row.siren}`,
    matchType: "entreprise" as const,
    matchedOfficer: null
  };
}

export function serializeEnterpriseRows(rows: EnterpriseRow[]) {
  const verifiedSirens = getVerifiedCompanySirens(rows.map((row) => row.siren));
  return rows.map((row) => ({ ...serializeEnterprise(row), verified: verifiedSirens.has(row.siren) }));
}

export type ProspectingFilters = {
  sector?: string;
  commune?: string;
};

export function searchProspectingDatabase(rawQuery: string, filters: ProspectingFilters = {}, limit = 60) {
  const db = getDatabase();
  if (!db) return null;
  const query = ftsQuery(rawQuery.trim());
  const clauses = ["e.administrative_status = 'A'"];
  const parameters: Array<string | number> = [];
  if (filters.sector) {
    clauses.push("e.sector = ?");
    parameters.push(filters.sector);
  }
  if (filters.commune) {
    clauses.push("upper(e.commune) = upper(?)");
    parameters.push(filters.commune);
  }
  const where = clauses.join(" AND ");
  const rows = query
    ? db.prepare(`SELECT e.* FROM establishment_search s JOIN establishments e ON e.id = s.rowid WHERE establishment_search MATCH ? AND ${where} ORDER BY bm25(establishment_search, 7.0, 5.0, 8.0, 9.0, 3.0, 2.0, 2.0, 1.0), e.legal_name LIMIT ?`).all(query, ...parameters, limit)
    : db.prepare(`SELECT e.* FROM establishments e WHERE ${where} ORDER BY e.legal_name, e.commune, e.siret LIMIT ?`).all(...parameters, limit);
  return serializeEnterpriseRows(rows as unknown as EnterpriseRow[]);
}

export function getEnterpriseFilterOptions() {
  const db = getDatabase();
  if (!db) return null;
  if (filterOptionsCache) return filterOptionsCache;
  const sectors = db.prepare("SELECT DISTINCT sector FROM establishments WHERE sector IS NOT NULL AND sector <> '' ORDER BY sector").all() as Array<{ sector: string }>;
  const communes = db.prepare("SELECT DISTINCT commune FROM establishments WHERE commune IS NOT NULL AND commune <> '' ORDER BY commune").all() as Array<{ commune: string }>;
  const workforceBands = db.prepare("SELECT DISTINCT workforce_band FROM establishments WHERE workforce_band IS NOT NULL AND workforce_band <> '' ORDER BY workforce_band").all() as Array<{ workforce_band: string }>;
  filterOptionsCache = {
    sectors: sectors.map((row) => row.sector),
    communes: communes.map((row) => row.commune),
    workforceBands: workforceBands.map((row) => ({ code: row.workforce_band, label: workforceLabels[row.workforce_band] ?? row.workforce_band }))
  };
  return filterOptionsCache;
}


function ftsQuery(raw: string) {
  return raw.normalize("NFD").replace(/\p{Diacritic}/gu, "").match(/[a-zA-Z0-9]+/g)?.map((token) => `"${token}"*`).join(" AND ") ?? "";
}

function fuzzyTokens(raw: string) {
  return raw.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr").match(/[a-z0-9]+/g) ?? [];
}

function editDistance(left: string, right: string) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function fuzzyScore(rawQuery: string, row: EnterpriseRow) {
  const queryTokens = fuzzyTokens(rawQuery).filter((token) => token.length >= 4);
  if (!queryTokens.length) return 0;
  const nameTokens = fuzzyTokens([
    row.legal_name,
    row.trade_name
  ].filter(Boolean).join(" "));
  const contextTokens = fuzzyTokens([
    row.sector,
    row.commune,
    row.naf_code,
    getNafLabel(row.naf_code),
    row.address
  ].filter(Boolean).join(" "));
  let score = 0;
  let nameMatches = 0;
  for (const queryToken of queryTokens) {
    let bestName = 0;
    for (const candidateToken of nameTokens) {
      const distance = editDistance(queryToken, candidateToken);
      const similarity = 1 - distance / Math.max(queryToken.length, candidateToken.length);
      if (similarity > bestName) bestName = similarity;
    }
    let bestContext = 0;
    for (const candidateToken of contextTokens) {
      const distance = editDistance(queryToken, candidateToken);
      const similarity = 1 - distance / Math.max(queryToken.length, candidateToken.length);
      if (similarity > bestContext) bestContext = similarity;
    }
    const best = Math.max(bestName, bestContext);
    if (best < 0.68) return 0;
    score += best;
    if (bestName >= bestContext && bestName >= 0.68) nameMatches += 1;
  }
  return score / queryTokens.length + (nameMatches / queryTokens.length) * 0.25;
}

function fuzzySearchEnterpriseDatabase(db: DatabaseSync, rawQuery: string, limit: number) {
  const tokens = fuzzyTokens(rawQuery);
  const anchor = tokens[0]?.slice(0, 3);
  if (!anchor) return [] as EnterpriseRow[];
  const candidates = db.prepare(
    `SELECT e.* FROM establishments e
     WHERE e.administrative_status = 'A'
       AND (lower(coalesce(e.legal_name, '')) LIKE '%' || ? || '%'
         OR lower(coalesce(e.trade_name, '')) LIKE '%' || ? || '%'
         OR lower(coalesce(e.sector, '')) LIKE '%' || ? || '%'
         OR lower(coalesce(e.commune, '')) LIKE '%' || ? || '%')
     ORDER BY
       CASE
         WHEN lower(coalesce(e.legal_name, '')) LIKE '%' || ? || '%' THEN 0
         WHEN lower(coalesce(e.trade_name, '')) LIKE '%' || ? || '%' THEN 0
         ELSE 1
       END,
       CASE
         WHEN lower(coalesce(e.trade_name, '')) LIKE '%' || ? || '%' THEN 0
         ELSE 1
       END,
       e.legal_name, e.commune, e.siret
     LIMIT 8000`
  ).all(anchor, anchor, anchor, anchor, anchor, anchor, anchor) as unknown as EnterpriseRow[];
  return candidates
    .map((row) => ({ row, score: fuzzyScore(rawQuery, row) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.row.legal_name.localeCompare(right.row.legal_name, "fr"))
    .slice(0, limit)
    .map((item) => item.row);
}

function normalizedSearchValue(value: string) {
  return value
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function searchNaturalLanguageSector(db: DatabaseSync, rawQuery: string, limit: number) {
  const terms = extractSearchTerms(rawQuery);
  if (!terms.length) return null;

  const sectorOptions = getEnterpriseFilterOptions()?.sectors ?? [];
  const matchingSectors = sectorOptions.filter((sector) => {
    const normalizedSector = normalizedSearchValue(sector);
    return terms.every((term) => normalizedSector.includes(term));
  });
  const matchingNafCodes = findNafCodesForTerms(terms);
  if (!matchingSectors.length && !matchingNafCodes.length) return null;
  const anchor = terms[0]?.slice(0, 3) ?? "";

  const clauses: string[] = [];
  const values: Array<string | number> = [];
  if (matchingSectors.length) {
    clauses.push(`sector IN (${matchingSectors.map(() => "?").join(",")})`);
    values.push(...matchingSectors);
  }
  if (matchingNafCodes.length) {
    clauses.push(`upper(naf_code) IN (${matchingNafCodes.map(() => "?").join(",")})`);
    values.push(...matchingNafCodes.map((code) => code.toUpperCase()));
  }
  const candidateLimit = Math.min(Math.max(limit * 20, 240), 1000);
  const rows = db.prepare(
    `SELECT * FROM establishments
     WHERE ${clauses.join(" OR ")}
     ORDER BY CASE
       WHEN lower(coalesce(legal_name, '')) LIKE '%' || ? || '%'
         OR lower(coalesce(trade_name, '')) LIKE '%' || ? || '%' THEN 0
       ELSE 1
     END, legal_name, commune
     LIMIT ?`
  ).all(anchor, anchor, ...values, candidateLimit) as unknown as EnterpriseRow[];
  return rows
    .map((row) => ({ row, score: fuzzyScore(terms.join(" "), row) }))
    .sort((left, right) => right.score - left.score || left.row.legal_name.localeCompare(right.row.legal_name, "fr"))
    .slice(0, limit)
    .map((item) => item.row);
}

export function searchEnterpriseDatabase(rawQuery: string, limit = 24) {
  const db = getDatabase();
  if (!db) return null;
  const structured = parseStructuredSearch(rawQuery);
  if (structured?.scope === "presse") return [];
  if (structured) {
    const value = structured.value;
    if (!value) return [];
    let rows: EnterpriseRow[] = [];
    if (structured.scope === "siren") {
      const digits = value.replace(/\D/g, "");
      rows = digits ? db.prepare("SELECT * FROM establishments WHERE siren LIKE ? ORDER BY is_head_office DESC, legal_name LIMIT ?").all(`${digits}%`, limit) as unknown as EnterpriseRow[] : [];
    } else if (structured.scope === "siret") {
      const digits = value.replace(/\D/g, "");
      rows = digits ? db.prepare("SELECT * FROM establishments WHERE siret LIKE ? ORDER BY is_head_office DESC, legal_name LIMIT ?").all(`${digits}%`, limit) as unknown as EnterpriseRow[] : [];
    } else if (structured.scope === "naf") {
      const naf = value.toUpperCase().replace(/[^0-9A-Z.]/g, "");
      rows = naf ? db.prepare("SELECT * FROM establishments WHERE upper(naf_code) LIKE ? ORDER BY legal_name, commune LIMIT ?").all(`${naf}%`, limit) as unknown as EnterpriseRow[] : [];
    } else if (structured.scope === "commune") {
      rows = db.prepare("SELECT * FROM establishments WHERE upper(replace(replace(commune, '-', ' '), '''', ' ')) LIKE upper(?) ORDER BY legal_name, commune LIMIT ?").all(`%${value}%`, limit) as unknown as EnterpriseRow[];
    } else if (structured.scope === "secteur") {
      rows = db.prepare("SELECT * FROM establishments WHERE upper(sector) LIKE upper(?) ORDER BY legal_name, commune LIMIT ?").all(`%${value}%`, limit) as unknown as EnterpriseRow[];
    } else if (structured.scope === "adresse") {
      rows = db.prepare("SELECT * FROM establishments WHERE upper(coalesce(address, '')) LIKE upper(?) OR upper(coalesce(postal_code, '')) LIKE upper(?) ORDER BY legal_name, commune LIMIT ?").all(`%${value}%`, `%${value}%`, limit) as unknown as EnterpriseRow[];
    }
    return serializeEnterpriseRows(rows);
  }
  const sectorRows = searchNaturalLanguageSector(db, rawQuery, limit);
  if (sectorRows?.length) return serializeEnterpriseRows(sectorRows);
  const query = ftsQuery(rawQuery.trim());
  let rows: EnterpriseRow[];
  if (!query) {
    rows = db.prepare("SELECT * FROM establishments ORDER BY legal_name LIMIT ?").all(limit) as unknown as EnterpriseRow[];
  } else {
    rows = db.prepare(
      `SELECT e.* FROM establishment_search s
       JOIN establishments e ON e.id = s.rowid
       WHERE establishment_search MATCH ?
       ORDER BY bm25(establishment_search, 7.0, 5.0, 8.0, 9.0, 3.0, 2.0, 2.0, 1.0)
       LIMIT ?`
    ).all(query, limit) as unknown as EnterpriseRow[];
  }
  if (!rows.length && rawQuery.trim().length >= 4) rows = fuzzySearchEnterpriseDatabase(db, rawQuery, limit);
  return serializeEnterpriseRows(rows);
}

export function getEnterpriseLocationsBySiren(siren: string) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare(
    "SELECT * FROM establishments WHERE siren = ? ORDER BY legal_name, commune, siret"
  ).all(siren) as unknown as EnterpriseRow[];
}

export function getEnterpriseCompanyBySiren(siren: string) {
  const db = getDatabase();
  if (!db || !/^\d{9}$/.test(siren)) return null;
  return db.prepare("SELECT * FROM companies WHERE siren = ?").get(siren) as EnterpriseCompanyRow | undefined ?? null;
}

function mapWhere(filters: MapFilters, verifiedSirens: ReadonlySet<string> | null) {
  const clauses = [
    "sp.max_longitude >= ?", "sp.min_longitude <= ?",
    "sp.max_latitude >= ?", "sp.min_latitude <= ?"
  ];
  const values: Array<string | number> = [];
  if (filters.sector) {
    clauses.push("e.sector = ?");
    values.push(filters.sector);
  }
  if (filters.commune) {
    clauses.push("replace(replace(e.commune, '-', ' '), '''', ' ') = replace(replace(?, '-', ' '), '''', ' ')");
    values.push(filters.commune);
  }
  if (filters.verified) {
    const valuesForQuery = verifiedSirens ? [...verifiedSirens] : [];
    if (valuesForQuery.length) {
      clauses.push(`e.siren IN (${valuesForQuery.map(() => "?").join(",")})`);
      values.push(...valuesForQuery);
    } else {
      clauses.push("0 = 1");
    }
  }
  if (filters.workforceBand) {
    clauses.push("e.workforce_band = ?");
    values.push(filters.workforceBand);
  }
  if (filters.headOffice) clauses.push("e.is_head_office = 1");
  if (filters.employer) clauses.push("e.employer = 'O'");
  if (filters.postalCode) {
    clauses.push("e.postal_code = ?");
    values.push(filters.postalCode);
  }
  if (filters.nafCode) {
    clauses.push("e.naf_code = ?");
    values.push(filters.nafCode.toUpperCase());
  }
  if (filters.recent) clauses.push("e.creation_date >= date('now', '-24 months')");
  return { sql: clauses.join(" AND "), values };
}

export function getEnterpriseMapData(
  bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number },
  zoom: number,
  filters: MapFilters
) {
  const db = getDatabase();
  if (!db) return null;
  const where = mapWhere(filters, filters.verified ? getVerifiedCompanySirens() : null);
  const bounds = [bbox.minLng, bbox.maxLng, bbox.minLat, bbox.maxLat];
  const parameters = [...bounds, ...where.values];

  let resultCount: number | null = null;
  if (zoom >= 13) {
    resultCount = Number((db.prepare(
      `SELECT count(*) AS count FROM establishment_spatial sp JOIN establishments e ON e.id = sp.id WHERE ${where.sql}`
    ).get(...parameters) as { count: number }).count);
  }

  if (zoom < 13 || (resultCount ?? 0) > 5000) {
    const cellSize = Math.max(0.0005, 0.24 / (2 ** Math.max(0, zoom - 8)));
    const rows = db.prepare(
      `SELECT avg(e.longitude) AS longitude, avg(e.latitude) AS latitude, count(*) AS count
       FROM establishment_spatial sp JOIN establishments e ON e.id = sp.id
       WHERE ${where.sql}
       GROUP BY cast(e.longitude / ? AS integer), cast(e.latitude / ? AS integer)`
    ).all(...parameters, cellSize, cellSize) as Array<{ longitude: number; latitude: number; count: number }>;
    resultCount ??= rows.reduce((total, row) => total + row.count, 0);
    return {
      resultCount,
      clustered: true,
      features: rows.map((row) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [row.longitude, row.latitude] },
        properties: {
          kind: "cluster",
          count: row.count,
          label: row.count >= 1000 ? `${(row.count / 1000).toFixed(row.count >= 10_000 ? 0 : 1)}k` : String(row.count)
        }
      }))
    };
  }

  const rows = db.prepare(
    `SELECT e.* FROM establishment_spatial sp JOIN establishments e ON e.id = sp.id
     WHERE ${where.sql} LIMIT 5000`
  ).all(...parameters) as unknown as EnterpriseRow[];
  const serialized = serializeEnterpriseRows(rows);
  return {
    resultCount: resultCount ?? rows.length,
    clustered: false,
    features: rows.map((row, index) => {
      const item = serialized[index];
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [row.longitude, row.latitude] },
        properties: { kind: "establishment", ...item, id: item.establishmentId }
      };
    })
  };
}
