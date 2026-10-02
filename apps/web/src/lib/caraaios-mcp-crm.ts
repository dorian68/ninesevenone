import "server-only";

import { createHash } from "node:crypto";

import { getAccountMap } from "@/lib/account-map-db";
import { getCompanyIcps } from "@/lib/caraaios-mcp-icp";
import { getCaraaiosCompanyNotes } from "@/lib/caraaios-mcp-research";
import { listCompanySignals } from "@/lib/company-signals";
import {
  addProspect, getProspect, listProspects, listProspectContacts,
  updateProspectWithAudit, withAccountMapDatabase
} from "@/lib/prospect-factory-crm-db";
import type { TrackedProspect } from "@/lib/prospect-factory-crm-contract";

export class CaraaiosMcpConflict extends Error {
  constructor(message: string, public readonly candidates: string[] = []) {
    super(message);
    this.name = "CaraaiosMcpConflict";
  }
}

export type CompanyIdentity = {
  company_id?: string;
  name: string;
  domain?: string;
  linkedin_url?: string;
  country?: string;
  territory?: string;
};

type CompanyRow = {
  id: string;
  company_name: string;
  website: string | null;
  source_website: string | null;
  linkedin: string | null;
};

type McpMapAnnotation =
  | { mcp_type: "buying_role"; role: string; opportunity_id: string }
  | { mcp_type: "relationship"; kind: string; from_ref: string; to_ref: string; notes: string | null };

function mcpMapAnnotation(value: unknown): McpMapAnnotation | null {
  if (typeof value !== "string") return null;
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const item = parsed as Record<string, unknown>;
  if (item.mcp_type === "buying_role" && typeof item.role === "string"
    && typeof item.opportunity_id === "string") {
    return { mcp_type: "buying_role", role: item.role, opportunity_id: item.opportunity_id };
  }
  if (item.mcp_type === "relationship" && typeof item.kind === "string"
    && typeof item.from_ref === "string" && typeof item.to_ref === "string"
    && (item.notes === null || typeof item.notes === "string")) {
    return { mcp_type: "relationship", kind: item.kind, from_ref: item.from_ref,
      to_ref: item.to_ref, notes: item.notes };
  }
  return null;
}

function normalizedName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
}

function normalizedDomain(value?: string | null): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch { return null; }
}

export function isValidCaraaiosDomain(value: string): boolean {
  const domain = normalizedDomain(value);
  return Boolean(domain && domain.includes(".") && !domain.includes(" "));
}

function normalizedLinkedin(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["linkedin.com", "www.linkedin.com"].includes(url.hostname.toLowerCase())) return null;
    return `https://www.linkedin.com${url.pathname.replace(/\/+$/, "").toLowerCase()}`;
  } catch { return null; }
}

function companyRows(): CompanyRow[] {
  return withAccountMapDatabase((db) => db.prepare(`SELECT id,company_name,website,source_website,linkedin
    FROM prospect_factory_prospects`).all() as CompanyRow[]);
}

function matchingCompanyIds(identity: CompanyIdentity): string[] {
  const name = normalizedName(identity.name);
  const domain = normalizedDomain(identity.domain);
  const linkedin = normalizedLinkedin(identity.linkedin_url);
  const rows = companyRows();
  const byName = rows.filter((row) => normalizedName(row.company_name) === name);
  const byDomain = domain ? rows.filter((row) =>
    normalizedDomain(row.website) === domain || normalizedDomain(row.source_website) === domain) : [];
  const byLinkedin = linkedin ? rows.filter((row) => normalizedLinkedin(row.linkedin) === linkedin) : [];
  const candidates = new Map([...byName, ...byDomain, ...byLinkedin].map((row) => [row.id, row]));
  if (byDomain.length && byName.length && !byDomain.some((row) => byName.some((other) => other.id === row.id))) {
    throw new CaraaiosMcpConflict("Le domaine et le nom désignent des comptes CRM différents.", [...candidates.keys()]);
  }
  if (byLinkedin.length && byName.length && !byLinkedin.some((row) => byName.some((other) => other.id === row.id))) {
    throw new CaraaiosMcpConflict("L’URL LinkedIn et le nom désignent des comptes CRM différents.", [...candidates.keys()]);
  }
  if (candidates.size > 1) throw new CaraaiosMcpConflict("Plusieurs comptes correspondent ; choisir company_id.", [...candidates.keys()]);
  return [...candidates.keys()];
}

export function resolveCaraaiosCompany(identity: CompanyIdentity): TrackedProspect | null {
  if (identity.company_id) {
    const byId = getProspect(identity.company_id);
    if (!byId) return null;
    if (normalizedName(byId.snapshot.companyName) !== normalizedName(identity.name)) {
      throw new CaraaiosMcpConflict("Le nom fourni contredit le compte demandé.", [byId.id]);
    }
    const inputDomain = normalizedDomain(identity.domain);
    const knownDomain = normalizedDomain(byId.enrichment.website ?? byId.snapshot.website);
    if (inputDomain && knownDomain && inputDomain !== knownDomain) {
      throw new CaraaiosMcpConflict("Le domaine fourni contredit le compte demandé.", [byId.id]);
    }
    return byId;
  }
  const matches = matchingCompanyIds(identity);
  return matches.length ? getProspect(matches[0]) : null;
}

export function upsertCaraaiosCompany(identity: CompanyIdentity): { company: TrackedProspect; created: boolean; updated: boolean } {
  const existing = resolveCaraaiosCompany(identity);
  if (existing) {
    const website = normalizedDomain(identity.domain);
    const linkedin = normalizedLinkedin(identity.linkedin_url);
    const enrichment: { website?: string; linkedin?: string } = {};
    if (website && !existing.enrichment.website && !existing.snapshot.website) enrichment.website = `https://${website}`;
    if (linkedin && !existing.enrichment.linkedin) enrichment.linkedin = linkedin;
    if (!Object.keys(enrichment).length) return { company: existing, created: false, updated: false };
    const result = updateProspectWithAudit(existing.id, { expectedVersion: existing.version, enrichment }, "MCP");
    if (!result) throw new Error("Le compte a disparu pendant sa mise à jour.");
    return { company: result.prospect, created: false, updated: true };
  }
  const domain = normalizedDomain(identity.domain);
  const key = domain ? `domain:${domain}` : `name:${normalizedName(identity.name)}:${(identity.country ?? "unknown").toLowerCase()}`;
  const warehouseId = `mcp:${createHash("sha256").update(key).digest("hex")}`;
  const company = addProspect({
    warehouseId,
    snapshot: {
      dedupeKey: key,
      companyName: identity.name.trim(), commercialName: null,
      country: identity.country?.trim() || "unknown",
      territory: identity.territory?.trim() || "unknown",
      region: null, city: null, vertical: null,
      recordOrigin: "caraaios_mcp", sourceUrls: domain ? `https://${domain}` : "",
      leadScore: 0, certification: "bronze",
      website: domain ? `https://${domain}` : null
    },
    enrichment: { linkedin: normalizedLinkedin(identity.linkedin_url) }
  });
  return { company, created: true, updated: false };
}

export function searchCaraaiosCompanies(query: string, limit = 20) {
  const result = listProspects({ query, limit });
  return {
    total: result.total,
    companies: result.prospects.map((company) => ({
      company_id: company.id, name: company.snapshot.companyName,
      website: company.enrichment.website ?? company.snapshot.website,
      country: company.snapshot.country, qualification_status: company.qualification.status,
      contact_count: company.contacts.length
    }))
  };
}

export function getCaraaiosCompany(companyId: string) {
  const company = getProspect(companyId);
  if (!company) return null;
  return {
    company_id: company.id, name: company.snapshot.companyName,
    domain: normalizedDomain(company.enrichment.website ?? company.snapshot.website),
    country: company.snapshot.country, territory: company.snapshot.territory,
    website: company.enrichment.website ?? company.snapshot.website,
    qualification: company.qualification, market: company.market,
    research: company.research, contact_count: company.contacts.length,
    created_at: company.createdAt, updated_at: company.updatedAt
  };
}

export function searchCaraaiosContacts(query: string, companyId?: string, limit = 30) {
  const search = `%${query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  return withAccountMapDatabase((db) => db.prepare(`SELECT c.id,c.prospect_id,c.name,c.input_title,c.verified_title,c.email,c.linkedin,p.company_name
    FROM prospect_factory_contacts c JOIN prospect_factory_prospects p ON p.id=c.prospect_id
    WHERE (? IS NULL OR c.prospect_id=?) AND (c.name LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR c.email LIKE ? ESCAPE '\\' COLLATE NOCASE OR c.input_title LIKE ? ESCAPE '\\' COLLATE NOCASE)
    ORDER BY c.name COLLATE NOCASE LIMIT ?`)
    .all(companyId ?? null, companyId ?? null, search, search, search, limit));
}

export function getCaraaiosContact(contactId: string, companyId?: string) {
  const row = withAccountMapDatabase((db) => db.prepare(`SELECT prospect_id FROM prospect_factory_contacts
    WHERE id=? AND (? IS NULL OR prospect_id=?)`).get(contactId, companyId ?? null, companyId ?? null) as
    { prospect_id: string } | undefined);
  if (!row) return null;
  const contact = listProspectContacts(row.prospect_id).find((item) => item.id === contactId);
  return contact ? { company_id: row.prospect_id, contact } : null;
}

export function getCaraaiosCompanyMap(companyId: string, options: {
  include_people?: boolean; include_relationships?: boolean; include_evidence?: boolean;
  include_research?: boolean; include_buying_committee?: boolean; include_signals?: boolean;
} = {}) {
  const company = getCaraaiosCompany(companyId);
  if (!company) return null;
  const map = getAccountMap(companyId);
  if (!map) return null;
  const contacts = new Map(listProspectContacts(companyId).map((contact) => [contact.id, contact]));
  const people = options.include_people === false ? undefined : map.nodes.filter((node) => node.kind === "person").map((node) => ({
    ...node, contact: node.contactId ? contacts.get(node.contactId) ?? null : null
  }));
  const annotations = map.claims.flatMap((claim) => {
    const value = mcpMapAnnotation(claim.value);
    return value ? [{ claim, value }] : [];
  });
  const originalBuyingRoles = annotations.flatMap(({ claim, value }) => {
    if (value.mcp_type !== "buying_role") return [];
    const mapped = map.stakeholderRoles.find((role) =>
      role.personNodeId === claim.subjectNodeId && role.opportunityId === value.opportunity_id);
    return [{
      id: claim.id, personNodeId: claim.subjectNodeId, opportunityId: value.opportunity_id,
      role: value.role, mapRole: mapped?.role ?? null, mapRoleId: mapped?.id ?? null,
      evidenceStatus: claim.evidenceStatus, sourceId: claim.sourceId, sourceIds: claim.sourceIds,
      origin: "mcp_import" as const
    }];
  });
  const representedRoleIds = new Set(originalBuyingRoles.map((role) => role.mapRoleId));
  const buyingCommittee = [...originalBuyingRoles, ...map.stakeholderRoles
    .filter((role) => !representedRoleIds.has(role.id))
    .map((role) => ({ ...role, mapRole: role.role, mapRoleId: role.id, origin: "crm_ui" as const }))];
  const relationshipObservations = annotations.flatMap(({ claim, value }) =>
    value.mcp_type === "relationship" ? [{
      id: claim.id, fromRef: value.from_ref, toRef: value.to_ref, kind: value.kind,
      notes: value.notes, evidenceStatus: claim.evidenceStatus,
      sourceId: claim.sourceId, sourceIds: claim.sourceIds
    }] : []);
  return {
    company,
    people,
    units: map.nodes.filter((node) => node.kind !== "person"),
    relationships: options.include_relationships === false ? undefined : map.relations,
    relationship_observations: options.include_relationships === false ? undefined : relationshipObservations,
    buying_committee: options.include_buying_committee === false ? undefined : buyingCommittee,
    hypotheses_and_facts: options.include_research === false ? undefined : map.claims,
    notes: options.include_research === false ? undefined : getCaraaiosCompanyNotes(companyId),
    open_questions: options.include_research === false ? undefined : map.questions,
    sources: options.include_evidence === false ? undefined : map.sources,
    evidence: options.include_evidence === false ? undefined : map.evidenceLinks,
    opportunities: map.opportunities,
    icps: getCompanyIcps(companyId)?.associations ?? [],
    signals: options.include_signals === false ? undefined : listCompanySignals(companyId, { limit: 50 })
  };
}
