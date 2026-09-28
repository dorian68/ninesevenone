import "server-only";

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { DuckDBInstance, type DuckDBConnection, type DuckDBValue, type Json } from "@duckdb/node-api";
import type {
  ProspectCertification,
  ProspectFactoryFilters,
  ProspectFactoryFacetsResponse,
  ProspectFactoryRow,
  ProspectFactorySearchResponse,
  ProspectQualityDimensionRow,
  ProspectQualitySnapshot
} from "@/lib/prospect-factory-contract";

const processLike = process as unknown as { cwd(): string; env: Record<string, string | undefined> };
const localDataRoot = resolve(/* turbopackIgnore: true */ processLike.cwd(), "data", "prospects-db");
const workspaceDataRoot = resolve(/* turbopackIgnore: true */ processLike.cwd(), "..", "..", "data", "prospects-db");
const databaseCandidates = [
  processLike.env.PROSPECTS_DB_PATH,
  resolve(localDataRoot, "prospects_master.duckdb"),
  resolve(workspaceDataRoot, "prospects_master.duckdb")
].filter((candidate): candidate is string => Boolean(candidate));
const snapshotCandidates = [
  processLike.env.PROSPECTS_QUALITY_SNAPSHOT_PATH,
  resolve(localDataRoot, "prospect_factory_quality_snapshot.json"),
  resolve(workspaceDataRoot, "prospect_factory_quality_snapshot.json")
].filter((candidate): candidate is string => Boolean(candidate));
const servingCandidates = [
  processLike.env.PROSPECTS_SERVING_PATH,
  resolve(localDataRoot, "prospect_factory_gold.parquet"),
  resolve(workspaceDataRoot, "prospect_factory_gold.parquet")
].filter((candidate): candidate is string => Boolean(candidate));
const allServingCandidates = [
  processLike.env.PROSPECTS_ALL_SERVING_PATH,
  resolve(localDataRoot, "prospect_factory_all.parquet"),
  resolve(workspaceDataRoot, "prospect_factory_all.parquet")
].filter((candidate): candidate is string => Boolean(candidate));
const browseServingCandidates = [
  processLike.env.PROSPECTS_BROWSE_SERVING_PATH,
  resolve(localDataRoot, "prospect_factory_browse.parquet"),
  resolve(workspaceDataRoot, "prospect_factory_browse.parquet")
].filter((candidate): candidate is string => Boolean(candidate));
const facetCandidates = [
  processLike.env.PROSPECTS_FACETS_PATH,
  resolve(localDataRoot, "prospect_factory_facets.parquet"),
  resolve(workspaceDataRoot, "prospect_factory_facets.parquet")
].filter((candidate): candidate is string => Boolean(candidate));

const databasePath = databaseCandidates.find(existsSync) ?? null;
const snapshotPath = snapshotCandidates.find(existsSync) ?? null;
const servingPath = servingCandidates.find(existsSync) ?? null;
const allServingPath = allServingCandidates.find(existsSync) ?? null;
const browseServingCandidate = browseServingCandidates.find(existsSync) ?? null;
// Browse is an exact prefix of the complete serving layer. If the latter has
// been refreshed more recently, fail closed to the complete layer until the
// compact prefix is rebuilt.
const browseServingPath = browseServingCandidate && allServingPath
  && statSync(browseServingCandidate).mtimeMs >= statSync(allServingPath).mtimeMs
  ? browseServingCandidate
  : null;
const facetsPath = facetCandidates.find(existsSync) ?? null;
let instancePromise: Promise<DuckDBInstance> | null = null;
let snapshotCache: { modifiedMs: number; value: ProspectQualitySnapshot } | null = null;

type CacheEntry<T> = { expiresAt: number; value: T };
const queryCache = new Map<string, CacheEntry<ProspectFactorySearchResponse>>();
const facetCache = new Map<string, CacheEntry<ProspectFactoryFacetsResponse>>();
const QUERY_CACHE_TTL_MS = 60_000;
const FACET_CACHE_TTL_MS = 120_000;
const QUERY_CACHE_MAX = 80;

let activeQueries = 0;
const queryWaiters: Array<() => void> = [];
const MAX_CONCURRENT_QUERIES = 4;

export class ProspectFactoryInputError extends Error {}

function snakeToCamel(value: string) {
  return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function camelizeObject<T>(value: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [snakeToCamel(key), item])) as T;
}

function numeric(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numericNullable(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function acquireQuerySlot(signal?: AbortSignal) {
  if (activeQueries >= MAX_CONCURRENT_QUERIES) {
    await new Promise<void>((resolveWaiter, reject) => {
      const waiter = () => { signal?.removeEventListener("abort", aborted); resolveWaiter(); };
      const aborted = () => {
        const index = queryWaiters.indexOf(waiter);
        if (index >= 0) queryWaiters.splice(index, 1);
        reject(new Error("Requête annulée."));
      };
      queryWaiters.push(waiter);
      signal?.addEventListener("abort", aborted, { once: true });
    });
  }
  if (signal?.aborted) throw new Error("Requête annulée.");
  activeQueries += 1;
  return () => {
    activeQueries -= 1;
    queryWaiters.shift()?.();
  };
}

async function getInstance() {
  if (!databasePath) throw new Error("La base prospects DuckDB est introuvable.");
  instancePromise ??= DuckDBInstance.create(databasePath, {
    access_mode: "READ_ONLY",
    threads: processLike.env.PROSPECTS_DUCKDB_THREADS?.trim() || "4",
    max_memory: processLike.env.PROSPECTS_DUCKDB_MEMORY?.trim() || "2GB"
  });
  return instancePromise;
}

async function withConnection<T>(callback: (connection: DuckDBConnection) => Promise<T>, signal?: AbortSignal) {
  const release = await acquireQuerySlot(signal);
  let connection: DuckDBConnection | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const abort = () => connection?.interrupt();
  try {
    const instance = await getInstance();
    connection = await instance.connect();
    signal?.addEventListener("abort", abort, { once: true });
    const timeoutMs = Math.min(60_000, Math.max(2_000, Number(processLike.env.PROSPECTS_QUERY_TIMEOUT_MS ?? "15000") || 15_000));
    timer = setTimeout(() => connection?.interrupt(), timeoutMs);
    return await callback(connection);
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    connection?.closeSync();
    release();
  }
}

function normalizeSnapshot(raw: Record<string, unknown>): ProspectQualitySnapshot {
  const dimensionsRaw = raw.dimensions as Record<string, Array<Record<string, unknown>>>;
  const dimension = (key: string) => (dimensionsRaw[key] ?? []).map((row) => {
    const converted = camelizeObject<Record<string, unknown>>(row);
    return Object.fromEntries(Object.entries(converted).map(([name, value]) => [name, name === "value" ? String(value ?? "") : numeric(value)])) as unknown as ProspectQualityDimensionRow;
  });
  const summaryRaw = camelizeObject<Record<string, unknown>>(raw.summary as Record<string, unknown>);
  return {
    schemaVersion: numeric(raw.schemaVersion),
    generatedAt: String(raw.generatedAt),
    database: String(raw.database),
    elapsedMs: numeric(raw.elapsedMs),
    definitions: raw.definitions as Record<string, string>,
    summary: Object.fromEntries(Object.entries(summaryRaw).map(([key, value]) => [key, numeric(value)])) as unknown as ProspectQualitySnapshot["summary"],
    dimensions: {
      countries: dimension("countries"),
      territories: dimension("territories"),
      origins: dimension("origins"),
      verticals: dimension("verticals")
    }
  };
}

export function prospectFactoryStatus() {
  return {
    available: Boolean(databasePath && snapshotPath),
    databasePath,
    snapshotPath,
    servingPath,
    allServingPath,
    browseServingPath,
    facetsPath,
    databaseSizeBytes: databasePath ? statSync(databasePath).size : null,
    servingSizeBytes: servingPath ? statSync(servingPath).size : null,
    allServingSizeBytes: allServingPath ? statSync(allServingPath).size : null,
    browseServingSizeBytes: browseServingPath ? statSync(browseServingPath).size : null,
    facetsSizeBytes: facetsPath ? statSync(facetsPath).size : null
  };
}

export function getProspectQualitySnapshot() {
  if (!snapshotPath) throw new Error("Le snapshot qualité doit être généré avec scripts/build_prospect_factory_quality.py.");
  const modifiedMs = statSync(snapshotPath).mtimeMs;
  if (snapshotCache?.modifiedMs === modifiedMs) return snapshotCache.value;
  const parsed = JSON.parse(readFileSync(snapshotPath, "utf8")) as Record<string, unknown>;
  const value = normalizeSnapshot(parsed);
  snapshotCache = { modifiedMs, value };
  return value;
}

type Cursor = { score: number; id: string; layer?: "browse" | "all" };

export function encodeProspectCursor(cursor: Cursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeProspectCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<Cursor>;
    if (typeof parsed.score !== "number" || !Number.isInteger(parsed.score) || typeof parsed.id !== "string" || !parsed.id || parsed.id.length > 64) return null;
    if (parsed.layer !== undefined && parsed.layer !== "browse" && parsed.layer !== "all") return null;
    return parsed.layer ? { score: parsed.score, id: parsed.id, layer: parsed.layer } : { score: parsed.score, id: parsed.id };
  } catch {
    return null;
  }
}

export function parseProspectFactoryFilters(parameters: URLSearchParams): ProspectFactoryFilters {
  const clean = (key: string, maximum = 160) => parameters.get(key)?.trim().slice(0, maximum) || undefined;
  const certification = clean("certification") as ProspectCertification | undefined;
  const contact = clean("contact") as ProspectFactoryFilters["contact"];
  const minScoreRaw = Number.parseInt(clean("minScore", 3) ?? "0", 10);
  return {
    country: clean("country"),
    territory: clean("territory"),
    vertical: clean("vertical"),
    origin: clean("origin", 240),
    certification: certification && ["gold", "silver", "bronze", "blocked"].includes(certification) ? certification : undefined,
    contact: contact && ["any", "email", "phone", "website", "no_website"].includes(contact) ? contact : undefined,
    minScore: Number.isFinite(minScoreRaw) ? Math.min(100, Math.max(0, minScoreRaw)) : undefined,
    query: clean("query", 120)
  };
}

const EMAIL_VALID = "regexp_full_match(lower(trim(coalesce(email, ''))), '[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]{2,}')";
const PHONE_VALID = "length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) BETWEEN 7 AND 15";
const IDENTIFIED = "trim(coalesce(company_name, '')) <> '' AND trim(coalesce(dedupe_key, '')) <> ''";
const TRACEABLE = "trim(coalesce(record_origin, '')) <> '' AND trim(coalesce(source_type, '')) <> '' AND trim(coalesce(source_urls, '')) <> ''";
const JOINABLE = "(trim(coalesce(siren, '')) <> '' OR trim(coalesce(siret, '')) <> '' OR trim(coalesce(business_id, '')) <> '' OR trim(coalesce(address, '')) <> '')";
const DATED = "(trim(coalesce(source_reference_date, '')) <> '' OR trim(coalesce(retrieved_at, '')) <> '')";
const GOLD = `(${IDENTIFIED}) AND (${TRACEABLE}) AND (${DATED}) AND ((${EMAIL_VALID}) OR (${PHONE_VALID}))`;
const SILVER = `(${IDENTIFIED}) AND (${TRACEABLE}) AND (${JOINABLE}) AND NOT ((${DATED}) AND ((${EMAIL_VALID}) OR (${PHONE_VALID})))`;
const BRONZE = `(${IDENTIFIED}) AND NOT ((${TRACEABLE}) AND (${JOINABLE}))`;

export function buildProspectWhere(filters: ProspectFactoryFilters, cursor: Cursor | null = null, precomputedQuality = false) {
  const clauses: string[] = [];
  const values: DuckDBValue[] = [];
  const add = (clause: string, value?: DuckDBValue) => {
    if (value !== undefined) {
      values.push(value);
      clauses.push(clause.replace("?", `$${values.length}`));
    } else clauses.push(clause);
  };
  if (filters.country) add("country = ?", filters.country);
  if (filters.territory) add("territory = ?", filters.territory);
  if (filters.vertical) add("vertical = ?", filters.vertical);
  if (filters.origin) add("record_origin = ?", filters.origin);
  if (filters.minScore) add("coalesce(try_cast(lead_score AS INTEGER), 0) >= ?", filters.minScore);
  if (filters.contact === "email") add(precomputedQuality ? "email_valid_shape" : EMAIL_VALID);
  if (filters.contact === "phone") add(precomputedQuality ? "phone_valid_shape" : PHONE_VALID);
  if (filters.contact === "website") add("trim(coalesce(website, '')) <> ''");
  if (filters.contact === "no_website") add("trim(coalesce(website, '')) = ''");
  if (filters.contact === "any") add(precomputedQuality ? "(email_valid_shape OR phone_valid_shape OR website_observed)" : `((${EMAIL_VALID}) OR (${PHONE_VALID}) OR trim(coalesce(website, '')) <> '')`);
  if (filters.certification === "gold") add(precomputedQuality ? "certification = 'gold'" : GOLD);
  if (filters.certification === "silver") add(precomputedQuality ? "certification = 'silver'" : SILVER);
  if (filters.certification === "bronze") add(precomputedQuality ? "certification = 'bronze'" : BRONZE);
  if (filters.certification === "blocked") add(precomputedQuality ? "certification = 'blocked'" : `NOT (${IDENTIFIED})`);
  if (filters.query) {
    const query = filters.query.trim();
    if (/^(?:SIREN:|SIRET:|UEI:|NPI:|OSM:|SBA:|FCC:)/i.test(query) || /^\d{9,14}$/.test(query)) {
      add("(dedupe_key = ? OR siren = ? OR siret = ? OR business_id = ?)", query);
      values.push(query, query, query);
      const last = clauses.length - 1;
      clauses[last] = clauses[last].replace("?", `$${values.length - 2}`).replace("?", `$${values.length - 1}`).replace("?", `$${values.length}`);
    } else if (query.length >= 3) {
      const searchableFields = [
        "company_name", "commercial_name", "city", "region", "postal_code", "vertical",
        "activity_category", "activity_detail", "contact_name", "email", "phone", "website",
        "address", "persona", "icp", "approach_angle"
      ];
      const searchClauses = searchableFields.map((field) => {
        values.push(query);
        return `lower(coalesce(${field}, '')) LIKE '%' || lower($${values.length}) || '%'`;
      });
      clauses.push(`(${searchClauses.join(" OR ")})`);
    }
  }
  if (cursor) {
    values.push(cursor.score, cursor.score, cursor.id);
    clauses.push(`(coalesce(try_cast(lead_score AS INTEGER), 0) < $${values.length - 2} OR (coalesce(try_cast(lead_score AS INTEGER), 0) = $${values.length - 1} AND id > $${values.length}))`);
  }
  return { sql: clauses.length ? clauses.join(" AND ") : "TRUE", values };
}

function certificationSql() {
  return `CASE WHEN ${GOLD} THEN 'gold' WHEN ${SILVER} THEN 'silver' WHEN ${BRONZE} THEN 'bronze' ELSE 'blocked' END`;
}

function sqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function sourceRelation(filters: ProspectFactoryFilters) {
  const goldCompatible = filters.certification === "gold" || (!filters.certification && (filters.contact === "email" || filters.contact === "phone"));
  if (servingPath && goldCompatible) return { sql: `(SELECT * EXCLUDE (lead_score_int), lead_score_int::VARCHAR AS lead_score FROM read_parquet(${sqlLiteral(servingPath)}))`, precomputed: true, goldOnly: true };
  if (allServingPath) return { sql: `(SELECT * EXCLUDE (lead_score_int), lead_score_int::VARCHAR AS lead_score FROM read_parquet(${sqlLiteral(allServingPath)}))`, precomputed: true, goldOnly: false };
  return { sql: "prospects_unique", precomputed: false, goldOnly: false };
}

export function isUnfilteredProspectQuery(filters: ProspectFactoryFilters) {
  return !filters.country
    && !filters.territory
    && !filters.vertical
    && !filters.origin
    && !filters.certification
    && !filters.contact
    && !(filters.minScore && filters.minScore > 0)
    && !filters.query?.trim();
}

function browseRelation() {
  return browseServingPath
    ? { sql: `(SELECT * EXCLUDE (lead_score_int), lead_score_int::VARCHAR AS lead_score FROM read_parquet(${sqlLiteral(browseServingPath)}))`, precomputed: true, goldOnly: false }
    : null;
}

function qualityReasons(row: Record<string, Json>) {
  const reasons: string[] = [];
  if (row.email_valid_shape) reasons.push("email syntaxiquement plausible");
  if (row.phone_valid_shape) reasons.push("téléphone syntaxiquement plausible");
  if (row.website_observed) reasons.push("site observé");
  if (row.traceable) reasons.push("provenance traçable");
  if (row.joinable) reasons.push("clé d’enrichissement disponible");
  if (!row.dated) reasons.push("fraîcheur à confirmer");
  if (!reasons.length) reasons.push("identité à réparer");
  return reasons;
}

function rowValue(row: Record<string, Json>, key: string) {
  const value = row[key];
  return value === null || value === undefined || value === "" ? null : String(value);
}

function serializeRow(row: Record<string, Json>): ProspectFactoryRow {
  return {
    warehouseId: String(row.id ?? ""),
    dedupeKey: String(row.dedupe_key ?? "").slice(0, 512),
    companyName: String(row.company_name ?? "Entreprise sans nom"),
    commercialName: rowValue(row, "commercial_name"),
    country: String(row.country ?? "Non renseigné"),
    territory: String(row.territory ?? "Non renseigné"),
    region: rowValue(row, "region"),
    city: rowValue(row, "city"),
    vertical: rowValue(row, "vertical"),
    activityDetail: rowValue(row, "activity_detail"),
    employeeRange: rowValue(row, "employee_range"),
    contactName: rowValue(row, "contact_name"),
    email: rowValue(row, "email"),
    phone: rowValue(row, "phone"),
    website: rowValue(row, "website"),
    fax: rowValue(row, "fax"),
    leadScore: numeric(row.lead_score_int),
    prioritySegment: rowValue(row, "priority_segment"),
    certification: String(row.certification) as ProspectCertification,
    qualityReasons: qualityReasons(row),
    recordOrigin: String(row.record_origin ?? "Non renseigné"),
    sourceType: String(row.source_type ?? "Non renseigné"),
    sourceUrls: String(row.source_urls ?? ""),
    sourceReferenceDate: rowValue(row, "source_reference_date"),
    retrievedAt: rowValue(row, "retrieved_at"),
    administrativeStatus: rowValue(row, "administrative_status"),
    siren: rowValue(row, "siren"),
    siret: rowValue(row, "siret"),
    businessId: rowValue(row, "business_id"),
    activityCategory: rowValue(row, "activity_category"),
    employeeCount: rowValue(row, "employee_count"),
    employeeMin: rowValue(row, "employee_min"),
    employeeMax: rowValue(row, "employee_max"),
    employeeDataType: rowValue(row, "employee_data_type"),
    employeeScope: rowValue(row, "employee_scope"),
    employeeYear: rowValue(row, "employee_year"),
    contactType: rowValue(row, "contact_type"),
    websiteStatus: rowValue(row, "website_status"),
    noWebsiteSignal: rowValue(row, "no_website_signal"),
    googleReviewCount: numericNullable(row.google_review_count),
    googleRating: numericNullable(row.google_rating),
    googleMapsUrl: rowValue(row, "google_maps_url"),
    address: rowValue(row, "address"),
    postalCode: rowValue(row, "postal_code"),
    creationDate: rowValue(row, "creation_date"),
    legalCategory: rowValue(row, "legal_category"),
    employerStatus: rowValue(row, "employer_status"),
    persona: rowValue(row, "persona"),
    icp: rowValue(row, "icp"),
    approachAngle: rowValue(row, "approach_angle"),
    sourceCount: numericNullable(row.source_count),
    dataQuality: rowValue(row, "data_quality"),
    employeeDataStatus: rowValue(row, "employee_data_status"),
    capitalSocial: numericNullable(row.capital_social),
    capitalCurrency: rowValue(row, "capital_currency"),
    capitalReferenceDate: rowValue(row, "capital_reference_date"),
    capitalSource: rowValue(row, "capital_source")
  };
}

function getCached(key: string) {
  const cached = queryCache.get(key);
  if (!cached || cached.expiresAt < Date.now()) {
    queryCache.delete(key);
    return null;
  }
  return { ...cached.value, elapsedMs: 0, cached: true };
}

function setCached(key: string, value: ProspectFactorySearchResponse) {
  if (queryCache.size >= QUERY_CACHE_MAX) queryCache.delete(queryCache.keys().next().value as string);
  queryCache.set(key, { expiresAt: Date.now() + QUERY_CACHE_TTL_MS, value });
}

function getCachedFacets(key: string) {
  const cached = facetCache.get(key);
  if (!cached || cached.expiresAt < Date.now()) {
    facetCache.delete(key);
    return null;
  }
  return { ...cached.value, elapsedMs: 0, cached: true };
}

function setCachedFacets(key: string, value: ProspectFactoryFacetsResponse) {
  if (facetCache.size >= QUERY_CACHE_MAX) facetCache.delete(facetCache.keys().next().value as string);
  facetCache.set(key, { expiresAt: Date.now() + FACET_CACHE_TTL_MS, value });
}

function prospectCandidateQuery(relationSql: string, whereSql: string, limit: number) {
  return `
    WITH candidates AS (
      SELECT id, dedupe_key, company_name, commercial_name, country, territory, region, city, vertical,
        activity_category, activity_detail, employee_count, employee_range, employee_min, employee_max,
        employee_data_type, employee_scope, employee_year, contact_name, email, phone, website, fax,
        website_status, no_website_signal, google_review_count, google_rating, google_maps_url,
        coalesce(try_cast(lead_score AS INTEGER), 0) AS lead_score_int, priority_segment,
        record_origin, source_type, source_urls, source_reference_date, retrieved_at,
        administrative_status, siren, siret, business_id, address, postal_code,
        creation_date, legal_category, employer_status, persona, icp, approach_angle, source_count,
        data_quality, employee_data_status, capital_social, capital_currency, capital_reference_date, capital_source
      FROM ${relationSql}
      WHERE ${whereSql}
      ORDER BY lead_score_int DESC, id ASC
      LIMIT ${limit}
    )
    SELECT *,
      ${certificationSql()} AS certification,
      (${EMAIL_VALID}) AS email_valid_shape, (${PHONE_VALID}) AS phone_valid_shape,
      trim(coalesce(website, '')) <> '' AS website_observed,
      (${TRACEABLE}) AS traceable, (${JOINABLE}) AS joinable, (${DATED}) AS dated
    FROM candidates
    ORDER BY lead_score_int DESC, id ASC`;
}

export async function searchProspectFactory(filters: ProspectFactoryFilters, options: { cursor?: string; limit?: number; includeCount?: boolean; signal?: AbortSignal } = {}) {
  const limit = Math.min(100, Math.max(10, options.limit ?? 50));
  const cursor = decodeProspectCursor(options.cursor);
  if (options.cursor && !cursor) throw new ProspectFactoryInputError("Curseur de pagination invalide.");
  const query = filters.query?.trim();
  if (query && query.length < 3 && !/^\d{9,14}$/.test(query)) throw new ProspectFactoryInputError("Saisissez au moins 3 caractères pour rechercher une entreprise.");
  const cacheKey = JSON.stringify({ filters, cursor, limit, count: Boolean(options.includeCount) });
  const cached = getCached(cacheKey);
  if (cached) return cached;
  const started = performance.now();
  const relation = sourceRelation(filters);
  const relationFilters = relation.goldOnly ? { ...filters, certification: undefined, contact: filters.contact === "any" ? undefined : filters.contact } : filters;
  const where = buildProspectWhere(relationFilters, cursor, relation.precomputed);
  const countWhere = buildProspectWhere(relationFilters, null, relation.precomputed);
  const result = await withConnection(async (connection) => {
    let layer: "browse" | "all" = "all";
    let objects: Array<Record<string, Json>>;
    const compactRelation = isUnfilteredProspectQuery(filters) && cursor?.layer !== "all" ? browseRelation() : null;
    if (compactRelation) {
      const compactWhere = buildProspectWhere(filters, cursor, compactRelation.precomputed);
      const compactReader = await connection.runAndReadAll(
        prospectCandidateQuery(compactRelation.sql, compactWhere.sql, limit + 1),
        compactWhere.values
      );
      objects = compactReader.getRowObjectsJson();
      layer = "browse";

      // The compact file is the exact global prefix. At its boundary, complete
      // the page from the full relation using the last compact row as keyset.
      if (objects.length <= limit) {
        const lastCompact = objects.at(-1);
        const continuation = lastCompact
          ? { score: numeric(lastCompact.lead_score_int), id: String(lastCompact.id), layer: "all" as const }
          : cursor;
        const remaining = limit + 1 - objects.length;
        const continuationWhere = buildProspectWhere(relationFilters, continuation, relation.precomputed);
        const fullReader = await connection.runAndReadAll(
          prospectCandidateQuery(relation.sql, continuationWhere.sql, remaining),
          continuationWhere.values
        );
        const fullObjects = fullReader.getRowObjectsJson();
        objects.push(...fullObjects);
        if (fullObjects.length || !objects.length) layer = "all";
      }
    } else {
      const reader = await connection.runAndReadAll(
        prospectCandidateQuery(relation.sql, where.sql, limit + 1),
        where.values
      );
      objects = reader.getRowObjectsJson();
    }
    let total: number | null = null;
    if (options.includeCount) {
      const useFacetCount = Boolean(facetsPath && !filters.query?.trim());
      const facetWhere = useFacetCount ? buildFacetCubeWhere(filters) : null;
      const countReader = useFacetCount && facetWhere
        ? await connection.runAndReadAll(`SELECT coalesce(sum(row_count), 0)::BIGINT AS total FROM read_parquet(${sqlLiteral(facetsPath!)}) WHERE ${facetWhere.sql}`, facetWhere.values)
        : await connection.runAndReadAll(`SELECT count(*) AS total FROM ${relation.sql} WHERE ${countWhere.sql}`, countWhere.values);
      total = numeric(countReader.getRowObjectsJson()[0]?.total);
    }
    return { objects, total, layer };
  }, options.signal);
  const hasMore = result.objects.length > limit;
  const objects = result.objects.slice(0, limit);
  const rows = objects.map(serializeRow);
  const last = rows.at(-1);
  const response: ProspectFactorySearchResponse = {
    rows,
    nextCursor: hasMore && last ? encodeProspectCursor({ score: last.leadScore, id: last.warehouseId, layer: result.layer }) : null,
    total: result.total,
    elapsedMs: Math.round(performance.now() - started),
    cached: false
  };
  setCached(cacheKey, response);
  return response;
}

export async function getProspectFactoryById(warehouseId: string, signal?: AbortSignal) {
  const id = warehouseId.trim();
  if (!id || id.length > 64) throw new ProspectFactoryInputError("Identifiant prospect invalide.");
  const relation = sourceRelation({});
  const reader = await withConnection((connection) => connection.runAndReadAll(`
    WITH candidate AS (
      SELECT id, dedupe_key, company_name, commercial_name, country, territory, region, city, vertical,
        activity_category, activity_detail, employee_count, employee_range, employee_min, employee_max,
        employee_data_type, employee_scope, employee_year, contact_name, email, phone, website, fax,
        website_status, no_website_signal, google_review_count, google_rating, google_maps_url,
        coalesce(try_cast(lead_score AS INTEGER), 0) AS lead_score_int, priority_segment,
        record_origin, source_type, source_urls, source_reference_date, retrieved_at,
        administrative_status, siren, siret, business_id, address, postal_code,
        creation_date, legal_category, employer_status, persona, icp, approach_angle, source_count,
        data_quality, employee_data_status, capital_social, capital_currency, capital_reference_date, capital_source
      FROM ${relation.sql}
      WHERE id = $1
      LIMIT 1
    )
    SELECT *,
      ${certificationSql()} AS certification,
      (${EMAIL_VALID}) AS email_valid_shape, (${PHONE_VALID}) AS phone_valid_shape,
      trim(coalesce(website, '')) <> '' AS website_observed,
      (${TRACEABLE}) AS traceable, (${JOINABLE}) AS joinable, (${DATED}) AS dated
    FROM candidate
  `, [id]), signal);
  const row = reader.getRowObjectsJson()[0];
  return row ? serializeRow(row) : null;
}

const FACET_DIMENSIONS = [
  { key: "countries", filter: "country", field: "country" },
  { key: "territories", filter: "territory", field: "territory" },
  { key: "verticals", filter: "vertical", field: "vertical" },
  { key: "origins", filter: "origin", field: "record_origin" },
  { key: "certifications", filter: "certification", field: "certification" }
] as const;

function buildFacetCubeWhere(filters: ProspectFactoryFilters, excluded?: keyof ProspectFactoryFilters | readonly (keyof ProspectFactoryFilters)[]) {
  const clauses: string[] = [];
  const values: DuckDBValue[] = [];
  const isExcluded = (key: keyof ProspectFactoryFilters) => Array.isArray(excluded) ? excluded.includes(key) : excluded === key;
  const addValue = (field: string, value: string | number) => {
    values.push(value);
    clauses.push(`${field} = $${values.length}`);
  };
  if (!isExcluded("country") && filters.country) addValue("country", filters.country);
  if (!isExcluded("territory") && filters.territory) addValue("territory", filters.territory);
  if (!isExcluded("vertical") && filters.vertical) addValue("vertical", filters.vertical);
  if (!isExcluded("origin") && filters.origin) addValue("record_origin", filters.origin);
  if (!isExcluded("certification") && filters.certification) addValue("certification", filters.certification);
  if (!isExcluded("minScore") && filters.minScore) {
    values.push(filters.minScore);
    clauses.push(`lead_score_int >= $${values.length}`);
  }
  if (!isExcluded("contact")) {
    if (filters.contact === "email") clauses.push("email_valid_shape");
    if (filters.contact === "phone") clauses.push("phone_valid_shape");
    if (filters.contact === "website") clauses.push("website_observed");
    if (filters.contact === "no_website") clauses.push("NOT website_observed");
    if (filters.contact === "any") clauses.push("(email_valid_shape OR phone_valid_shape OR website_observed)");
  }
  return { sql: clauses.length ? clauses.join(" AND ") : "TRUE", values };
}

export function buildProspectFacetQuery(filters: ProspectFactoryFilters) {
  const relation = `read_parquet(${sqlLiteral(facetsPath ?? "prospect_factory_facets.parquet")})`;
  const values: DuckDBValue[] = [];
  const appendWhere = (where: ReturnType<typeof buildFacetCubeWhere>) => {
    const offset = values.length;
    const sql = where.sql.replace(/\$(\d+)/g, (_, index: string) => `$${Number(index) + offset}`);
    values.push(...where.values);
    return sql;
  };
  const branches = FACET_DIMENSIONS.map((dimension) => {
    const excluded = dimension.filter === "country" ? (["country", "territory"] as const) : dimension.filter;
    const where = appendWhere(buildFacetCubeWhere(filters, excluded));
    return `SELECT ${sqlLiteral(dimension.key)} AS dimension, value, total FROM (
      SELECT ${dimension.field}::VARCHAR AS value, sum(row_count)::BIGINT AS total
      FROM ${relation}
      WHERE ${where} AND trim(coalesce(${dimension.field}, '')) <> ''
      GROUP BY ${dimension.field}
      ORDER BY total DESC, value ASC
    )`;
  });
  const contactWhere = appendWhere(buildFacetCubeWhere(filters, "contact"));
  branches.push(`SELECT 'contacts' AS dimension, unnest(['any', 'email', 'phone', 'website', 'no_website']) AS value,
    unnest([
      coalesce(sum(CASE WHEN email_valid_shape OR phone_valid_shape OR website_observed THEN row_count ELSE 0 END), 0),
      coalesce(sum(CASE WHEN email_valid_shape THEN row_count ELSE 0 END), 0),
      coalesce(sum(CASE WHEN phone_valid_shape THEN row_count ELSE 0 END), 0),
      coalesce(sum(CASE WHEN website_observed THEN row_count ELSE 0 END), 0),
      coalesce(sum(CASE WHEN NOT website_observed THEN row_count ELSE 0 END), 0)
    ])::BIGINT AS total
    FROM ${relation}
    WHERE ${contactWhere}`);
  return { sql: branches.join(" UNION ALL "), values };
}

export async function getProspectFactoryFacets(filters: ProspectFactoryFilters, signal?: AbortSignal) {
  if (!facetsPath) throw new Error("Le cube de facettes Prospect Factory doit être généré.");
  const structuralFilters = { ...filters, query: undefined };
  const cacheKey = JSON.stringify(structuralFilters);
  const cached = getCachedFacets(cacheKey);
  if (cached) return cached;
  const started = performance.now();
  const facetQuery = buildProspectFacetQuery(structuralFilters);
  const reader = await withConnection((connection) => connection.runAndReadAll(facetQuery.sql, facetQuery.values), signal);
  const response: ProspectFactoryFacetsResponse = { countries: [], territories: [], verticals: [], origins: [], certifications: [], contacts: [], elapsedMs: 0, cached: false };
  for (const row of reader.getRowObjectsJson()) {
    const dimension = String(row.dimension) as keyof Pick<ProspectFactoryFacetsResponse, "countries" | "territories" | "verticals" | "origins" | "certifications" | "contacts">;
    if (dimension in response && Array.isArray(response[dimension])) response[dimension].push({ value: String(row.value), count: numeric(row.total) });
  }
  const byCount = (left: { value: string; count: number }, right: { value: string; count: number }) => right.count - left.count || left.value.localeCompare(right.value, "fr");
  response.countries.sort(byCount);
  response.territories.sort(byCount);
  response.verticals.sort(byCount);
  response.origins.sort(byCount);
  const certificationOrder = ["gold", "silver", "bronze", "blocked"];
  const contactOrder = ["any", "email", "phone", "website", "no_website"];
  response.certifications.sort((left, right) => certificationOrder.indexOf(left.value) - certificationOrder.indexOf(right.value));
  response.contacts.sort((left, right) => contactOrder.indexOf(left.value) - contactOrder.indexOf(right.value));
  response.elapsedMs = Math.round(performance.now() - started);
  setCachedFacets(cacheKey, response);
  return response;
}

export function csvCell(value: Json | undefined) {
  const raw = value === null || value === undefined ? "" : String(value);
  const text = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[";\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function exportProspectFactoryCsv(filters: ProspectFactoryFilters, requestedLimit = 5_000) {
  const limit = Math.min(10_000, Math.max(1, requestedLimit));
  const relation = sourceRelation(filters);
  const relationFilters = relation.goldOnly ? { ...filters, certification: undefined, contact: filters.contact === "any" ? undefined : filters.contact } : filters;
  const where = buildProspectWhere(relationFilters, null, relation.precomputed);
  const reader = await withConnection((connection) => connection.runAndReadAll(`
    SELECT id, dedupe_key, company_name, commercial_name, country, territory, region, city, vertical,
      activity_category, activity_detail, employee_count, employee_range, employee_min, employee_max,
      employee_data_type, employee_scope, employee_year, contact_name, email, phone, website, fax,
      website_status, no_website_signal, google_review_count, google_rating, google_maps_url,
      coalesce(try_cast(lead_score AS INTEGER), 0) AS lead_score,
      priority_segment, ${certificationSql()} AS certification,
      record_origin, source_type, source_urls, source_reference_date, retrieved_at,
      administrative_status, siren, siret, business_id, address, postal_code,
      creation_date, legal_category, employer_status, persona, icp, approach_angle, source_count,
      data_quality, employee_data_status, capital_social, capital_currency, capital_reference_date, capital_source
    FROM ${relation.sql}
    WHERE ${where.sql}
    ORDER BY lead_score DESC, id ASC
    LIMIT ${limit}
  `, where.values));
  const rows = reader.getRowObjectsJson();
  const headers = ["id", "dedupe_key", "company_name", "commercial_name", "country", "territory", "region", "city", "vertical", "activity_category", "activity_detail", "employee_count", "employee_range", "employee_min", "employee_max", "employee_data_type", "employee_scope", "employee_year", "contact_name", "email", "phone", "website", "fax", "website_status", "no_website_signal", "google_review_count", "google_rating", "google_maps_url", "lead_score", "priority_segment", "certification", "record_origin", "source_type", "source_urls", "source_reference_date", "retrieved_at", "administrative_status", "siren", "siret", "business_id", "address", "postal_code", "creation_date", "legal_category", "employer_status", "persona", "icp", "approach_angle", "source_count", "data_quality", "employee_data_status", "capital_social", "capital_currency", "capital_reference_date", "capital_source"];
  return `\uFEFF${headers.join(";")}\r\n${rows.map((row) => headers.map((header) => csvCell(row[header])).join(";")).join("\r\n")}`;
}
