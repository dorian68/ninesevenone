import "server-only";

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type CoverageSource = {
  name: string;
  status: "ok" | "partial" | "unavailable";
  count: number | null;
  detail: string;
  retrievedAt: string | null;
  sourceUrl: string | null;
};

function databasePath(fileName: string) {
  const cwd = (process as unknown as { cwd(): string }).cwd();
  return [
    (process as unknown as { env: Record<string, string | undefined> }).env[`${fileName.replace(/[^a-z0-9]/gi, "_").toUpperCase()}_DB_PATH`],
    resolve(cwd, "data", fileName),
    resolve(cwd, "../../data", fileName)
  ].filter((value): value is string => Boolean(value)).find(existsSync) ?? null;
}

function readSnapshot(fileName: string, table: string, countKey: string | null = null) {
  const path = databasePath(fileName);
  if (!path) return null;
  const db = new DatabaseSync(path, { readOnly: true });
  const metadata = Object.fromEntries((db.prepare("SELECT key,value FROM metadata").all() as Array<{ key: string; value: string }>).map((row) => [row.key, row.value]));
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number } | undefined;
  const count = countKey ? Number(metadata[countKey] ?? NaN) : Number(row?.count ?? NaN);
  return { metadata, count: Number.isFinite(count) ? count : null };
}

function number(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getAdminCoverageSnapshot() {
  const sirene = readSnapshot("guadeloupe-enterprises.sqlite", "establishments", "establishment_count");
  const osm = readSnapshot("osm-business-profiles.sqlite", "osm_business_profiles", "records");
  const websites = readSnapshot("website-enrichments.sqlite", "website_enrichments", "total");
  const officers = readSnapshot("public-officers.sqlite", "officers", "indexed_sirens");
  const bodacc = readSnapshot("bodacc-guadeloupe.sqlite", "bodacc_events", "indexed_event_count");
  const press = readSnapshot("press-signals.sqlite", "press_mentions");
  const pressLogs = (() => {
    const path = databasePath("press-signals.sqlite");
    if (!path) return null;
    const db = new DatabaseSync(path, { readOnly: true });
    return {
      logs: db.prepare("SELECT status,COUNT(*) AS count FROM fetch_log GROUP BY status").all() as Array<{ status: string; count: number }>,
      targetCount: Number((db.prepare("SELECT COUNT(*) AS count FROM fetch_log").get() as { count: number } | undefined)?.count ?? 0)
    };
  })();
  const pressStatusCounts = Object.fromEntries((pressLogs?.logs ?? []).map((row) => [row.status, row.count]));
  const sources: CoverageSource[] = [
    {
      name: "SIRENE / SIRET",
      status: sirene ? "ok" : "unavailable",
      count: sirene?.count ?? null,
      detail: sirene ? `${sirene.metadata.company_count ?? "0"} unités légales · ${sirene.metadata.geolocated_count ?? "0"} géolocalisés · ${sirene.metadata.commune_count ?? "0"} communes` : "Snapshot absent",
      retrievedAt: sirene?.metadata.retrieved_at ?? null,
      sourceUrl: sirene?.metadata.source_url ?? null
    },
    {
      name: "OpenStreetMap",
      status: osm ? "partial" : "unavailable",
      count: osm?.count ?? null,
      detail: osm ? `${osm.metadata.companies ?? "0"} entreprises · ${osm.metadata.establishments ?? "0"} établissements · ${osm.metadata.public_emails ?? "0"} emails fonctionnels` : "Snapshot absent",
      retrievedAt: osm?.metadata.imported_at ?? null,
      sourceUrl: osm?.metadata.source_url ?? null
    },
    {
      name: "Sites publics",
      status: websites ? "partial" : "unavailable",
      count: websites?.count ?? null,
      detail: websites ? `${websites.metadata.companies ?? "0"} entreprises · ${websites.metadata.descriptions ?? "0"} descriptions · ${websites.metadata.with_services ?? "0"} avec prestations` : "Snapshot absent",
      retrievedAt: websites?.metadata.generated_at ?? null,
      sourceUrl: null
    },
    {
      name: "Annuaire / RNE",
      status: officers?.metadata.bulk_status === "complete" ? "partial" : officers ? "partial" : "unavailable",
      count: officers?.count ?? null,
      detail: officers ? `${officers.metadata.officer_rows ?? "0"} mandats · couverture ${((number(officers.metadata.coverage_ratio) ?? 0) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 4 })} % · plafond API ${officers.metadata.bulk_total_results ?? "non renseigné"}` : "Snapshot absent",
      retrievedAt: officers?.metadata.retrieved_at ?? null,
      sourceUrl: officers?.metadata.source_url ?? null
    },
    {
      name: "BODACC",
      status: bodacc?.metadata.status === "complete" ? "partial" : bodacc ? "partial" : "unavailable",
      count: bodacc?.count ?? null,
      detail: bodacc ? `${bodacc.metadata.indexed_siren_count ?? "0"} SIREN · département ${bodacc.metadata.department_code ?? "?"} · fenêtre datée` : "Snapshot absent",
      retrievedAt: bodacc?.metadata.finished_at ?? bodacc?.metadata.retrieved_at ?? null,
      sourceUrl: bodacc?.metadata.source_url ?? null
    },
    {
      name: "Presse",
      status: press ? "partial" : "unavailable",
      count: press?.count ?? null,
      detail: press ? `${pressLogs?.targetCount ?? press.metadata.target_count ?? "0"} cibles journalisées · ${pressStatusCounts.ok ?? 0} complètes · ${pressStatusCounts.partial ?? 0} partielles · ${pressStatusCounts.error ?? 0} erreurs` : "Cache absent",
      retrievedAt: press?.metadata.retrieved_at ?? null,
      sourceUrl: press?.metadata.source_url ?? null
    }
  ];
  return {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    totals: {
      companies: number(sirene?.metadata.company_count),
      establishments: number(sirene?.metadata.establishment_count),
      geolocated: number(sirene?.metadata.geolocated_count),
      pressMentions: press?.count ?? null,
      bodaccEvents: bodacc?.count ?? null
    },
    sources
  };
}
