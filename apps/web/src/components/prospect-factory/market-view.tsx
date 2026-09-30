"use client";

import { ContextualMapLink } from "./contextual-map-link";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Activity, ArrowRight, Building2, ChevronRight, Layers3, Network, Pencil, Plus, RefreshCw, Search, Trash2, Users, X } from "lucide-react";
import {
  PROSPECT_DEAL_ROLES, PROSPECT_OPERATIONAL_SIGNALS, PROSPECT_QUALIFICATION_STATUSES,
  type AccountPersonaSlot, type MarketAccountListResult, type MarketAccountRow,
  type MarketIcpSummary, type MarketMetrics, type MarketOverview, type MarketSegmentSummary,
  type ProspectActivity, type ProspectContact, type ProspectDealRole, type ProspectOperationalSignal,
  type ProspectPriority, type ProspectQualificationStatus, type TrackedProspect
} from "@/lib/prospect-factory-crm-contract";
import styles from "./market-view.module.css";

export type MarketViewProps = { onOpenProspect: (prospect: TrackedProspect, tab?: "tracking" | "activity", contactId?: string) => void; refreshToken?: number };
type Selection = { kind: "overview" } | { kind: "all" } | { kind: "icp"; icpId: string } | { kind: "segment"; icpId: string; segmentId: string } | { kind: "unclassified" } | { kind: "account"; accountId: string } | { kind: "contact"; accountId: string; contactId: string } | { kind: "slot"; accountId: string; slotId: string } | { kind: "activity"; accountId: string; activityId: string };
type ListScope = { kind: "all" } | { kind: "unclassified" } | { kind: "segment"; icpId: string; segmentId: string };
type Editor = { kind: "icp"; id?: string } | { kind: "segment"; icpId: string; id?: string } | { kind: "account"; accountId: string } | { kind: "contact"; accountId: string; id?: string } | { kind: "slot"; accountId: string; id?: string } | { kind: "icpPersona"; icpId: string; id?: string };
type AccountDetail = { prospect: TrackedProspect; activities: ProspectActivity[] };
type FormValues = Record<string, string>;

function marketNavigationValue(key: string) {
  return typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get(key) ?? "";
}

function listScopeFromValue(value: string | null): ListScope | null {
  if (value === "all" || value === "unclassified") return { kind: value };
  if (value?.startsWith("segment:")) {
    const [, icpId, segmentId] = value.split(":");
    if (icpId && segmentId) return { kind: "segment", icpId, segmentId };
  }
  return null;
}

function listScopeKey(scope: ListScope) { return scope.kind === "segment" ? `s:${scope.segmentId}` : scope.kind; }
function listScopeValue(scope: ListScope) { return scope.kind === "segment" ? `segment:${scope.icpId}:${scope.segmentId}` : scope.kind; }
function initialListScope(): ListScope { return listScopeFromValue(marketNavigationValue("crmMarketScope")) ?? { kind: "all" }; }
function initialExpandedSegments() {
  const scope = listScopeFromValue(marketNavigationValue("crmMarketScope"));
  return new Set(scope ? [listScopeKey(scope)] : []);
}
function initialExpandedIcps() {
  const scope = listScopeFromValue(marketNavigationValue("crmMarketScope"));
  const icpId = scope?.kind === "segment" ? scope.icpId : marketNavigationValue("crmMarketScope").startsWith("icp:") ? marketNavigationValue("crmMarketScope").slice(4) : "";
  return new Set(icpId ? [icpId] : []);
}
function initialListOffsets() {
  const scope = listScopeFromValue(marketNavigationValue("crmMarketScope"));
  const offset = Number(marketNavigationValue("crmMarketOffset"));
  return scope && Number.isSafeInteger(offset) && offset > 0 && offset <= 10_000_000 && offset % pageSize === 0
    ? { [listScopeKey(scope)]: offset } : {};
}

function initialMarketSelection(): Selection {
  if (typeof window === "undefined") return { kind: "overview" };
  const parameters = new URLSearchParams(window.location.search);
  const marketAccountId = parameters.get("crmMarketAccount");
  if (marketAccountId) return { kind: "account", accountId: marketAccountId };
  const scope = parameters.get("crmMarketScope");
  const listScope = listScopeFromValue(scope);
  if (listScope) return listScope;
  if (scope?.startsWith("icp:")) return { kind: "icp", icpId: scope.slice(4) };
  const accountId = parameters.get("crmView") === "market" ? parameters.get("crmAccount") : null;
  if (accountId) return { kind: "account", accountId };
  return { kind: "overview" };
}

const number = new Intl.NumberFormat("fr-FR");
const money = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });
const pageSize = 25;
const statusLabels: Record<ProspectQualificationStatus, string> = { to_qualify: "À qualifier", qualified: "Qualifié", to_contact: "À contacter", contacted: "Contacté", in_conversation: "En discussion", opportunity: "Opportunité", won: "Client", lost: "Perdu", disqualified: "Écarté" };
const priorityLabels: Record<ProspectPriority, string> = { high: "Haute", normal: "Normale", low: "Basse" };
const signalLabels: Record<ProspectOperationalSignal, string> = { multiple_establishments: "Plusieurs établissements", multiple_entities: "Plusieurs sociétés", multiple_territories: "Plusieurs territoires", regular_reporting: "Reporting régulier", consolidation: "Consolidation", finance_admin_team: "Équipe finance/admin", manual_tasks: "Tâches manuelles", spreadsheet_heavy: "Excel ou Sheets", document_flows: "Flux documentaires", multiple_tools: "Outils multiples", regulated_processes: "Processus réglementés", field_teams: "Équipes terrain" };
const roleLabels: Record<ProspectDealRole, string> = { champion: "Champion", economic_decision_maker: "Décideur économique", business_decision_maker: "Décideur métier", user: "Utilisateur", influencer: "Influenceur", gatekeeper: "Gatekeeper", it_security: "IT / Sécurité", procurement: "Achats", unknown: "Inconnu" };
const activityLabels: Record<string, string> = { email: "E-mail", call: "Appel", linkedin_connection: "Ajout LinkedIn", linkedin_message: "Message LinkedIn", meeting: "Rendez-vous", follow_up: "Relance", note: "Note", proposal: "Proposition", other: "Autre", status_change: "Changement d’étape", enrichment: "Enrichissement" };
function niceDate(value: string | null | undefined) { if (!value) return "Non planifiée"; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? value : date.format(parsed); }
function safeWebUrl(value: string | null | undefined) { if (!value) return null; try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:" ? url.href : null; } catch { return null; } }
function accountName(prospect: TrackedProspect) { return prospect.snapshot.commercialName || prospect.snapshot.companyName; }
function lines(value: string) { return value.split(/\r?\n/).map((part) => part.trim()).filter(Boolean); }
function slug(value: string) { return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80); }
function valueOf(value: string | number | null | undefined) { return value === null || value === undefined ? "" : String(value); }
function optionalNumber(value: string) { return value.trim() === "" ? null : Number(value); }
function toggleSet(current: Set<string>, id: string) { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }
async function apiJson<T>(url: string, init?: RequestInit): Promise<T> { const response = await fetch(url, { cache: "no-store", ...init }); const body = await response.json().catch(() => null) as (T & { error?: string }) | null; if (!response.ok) throw new Error(body?.error || `Erreur HTTP ${response.status}`); if (!body) throw new Error("Réponse vide du serveur."); return body; }
function jsonBody(body: unknown): Pick<RequestInit, "headers" | "body"> { return { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }; }
function MetricGrid({ metrics }: { metrics: MarketMetrics }) { const items: Array<[string, string]> = [
  ["Comptes", number.format(metrics.accountCount)], ["Contacts", number.format(metrics.contactCount)], ["Comptes contactés", number.format(metrics.contactedCount)], ["Conversations", number.format(metrics.conversationCount)], ["Réponses", number.format(metrics.responseCount)], ["Taux de réponse", metrics.responseRate === null ? "—" : `${Math.round(metrics.responseRate * 100)} %`], ["Rendez-vous", number.format(metrics.meetingCount)], ["Opportunités", number.format(metrics.opportunityCount)], ["Clients", number.format(metrics.clientCount)], ["CA potentiel", money.format(metrics.potentialValue)], ["Potentiel des comptes gagnés", money.format(metrics.signedValue)], ["Panier moyen des comptes gagnés", metrics.averageWonValue === null ? "—" : money.format(metrics.averageWonValue)]
]; return <div className={styles.summaryGrid}>{items.map(([label, value]) => <div className={styles.metric} key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>; }

export function MarketView({ onOpenProspect, refreshToken = 0 }: MarketViewProps) {
  const [overview, setOverview] = useState<MarketOverview | null>(null);
  const [selection, setSelection] = useState<Selection>(initialMarketSelection);
  const [lastListScope, setLastListScope] = useState<ListScope>(initialListScope);
  const [expandedIcps, setExpandedIcps] = useState<Set<string>>(initialExpandedIcps);
  const [expandedSegments, setExpandedSegments] = useState<Set<string>>(initialExpandedSegments);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [expandedContacts, setExpandedContacts] = useState<Set<string>>(new Set());
  const [pages, setPages] = useState<Record<string, MarketAccountListResult>>({});
  const [offsets, setOffsets] = useState<Record<string, number>>(initialListOffsets);
  const [loadingPages, setLoadingPages] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Record<string, AccountDetail>>({});
  const [slots, setSlots] = useState<Record<string, AccountPersonaSlot[]>>({});
  const [searchDraft, setSearchDraft] = useState(() => marketNavigationValue("crmMarketQuery"));
  const [searchQuery, setSearchQuery] = useState(() => marketNavigationValue("crmMarketQuery"));
  const [status, setStatus] = useState<ProspectQualificationStatus | "">(() => { const value = marketNavigationValue("crmMarketStatus"); return PROSPECT_QUALIFICATION_STATUSES.includes(value as ProspectQualificationStatus) ? value as ProspectQualificationStatus : ""; });
  const [priority, setPriority] = useState<ProspectPriority | "">(() => { const value = marketNavigationValue("crmMarketPriority"); return value === "high" || value === "normal" || value === "low" ? value : ""; });
  const [signal, setSignal] = useState<ProspectOperationalSignal | "">(() => { const value = marketNavigationValue("crmMarketSignal"); return PROSPECT_OPERATIONAL_SIGNALS.includes(value as ProspectOperationalSignal) ? value as ProspectOperationalSignal : ""; });
  const [minFitScore, setMinFitScore] = useState(() => marketNavigationValue("crmMarketFit"));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [form, setForm] = useState<FormValues>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const pageRequests = useRef<Record<string, number>>({});
  const detailRequests = useRef<Record<string, number>>({});
  const requestedOffsets = useRef<Record<string, number>>(offsets);
  const previousListFilters = useRef(JSON.stringify([searchQuery, status, priority, signal, minFitScore]));
  const modalRef = useRef<HTMLDivElement>(null);
  const icpById = useMemo(() => new Map((overview?.icps ?? []).map((icp) => [icp.id, icp])), [overview]);
  const segmentById = useMemo(() => new Map((overview?.icps ?? []).flatMap((icp) => icp.segments.map((segment) => [segment.id, segment] as const))), [overview]);
  const rowById = useMemo(() => new Map(Object.values(pages).flatMap((page) => page.accounts.map((row) => [row.prospect.id, row] as const))), [pages]);
  const selectedAccountId = selection.kind === "account" || selection.kind === "contact" || selection.kind === "slot" || selection.kind === "activity" ? selection.accountId : null;
  const selectedDetail = selectedAccountId ? details[selectedAccountId] : undefined;
  const selectedProspect = selectedDetail?.prospect ?? (selectedAccountId ? rowById.get(selectedAccountId)?.prospect : undefined);
  const selectedSlots = selectedAccountId ? slots[selectedAccountId] ?? rowById.get(selectedAccountId)?.targetPersonas ?? [] : [];
  const selectedIcp = selection.kind === "icp" ? icpById.get(selection.icpId) : undefined;
  const selectedSegment = selection.kind === "segment" ? segmentById.get(selection.segmentId) : undefined;

  const loadOverview = useCallback(async () => { setLoading(true); try { const next = await apiJson<MarketOverview>("/api/prospect-factory/crm/market"); setOverview(next); setError(null); setExpandedIcps((current) => current.size ? current : new Set(next.icps[0] ? [next.icps[0].id] : [])); } catch (caught) { setError(caught instanceof Error ? caught.message : "Chargement du marché impossible."); } finally { setLoading(false); } }, []);
  const loadAccounts = useCallback(async (key: string, offset: number) => {
    const sequence = (pageRequests.current[key] ?? 0) + 1; pageRequests.current[key] = sequence;
    setLoadingPages((current) => new Set(current).add(key));
    const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
    if (key === "unclassified") params.set("unclassified", "true"); else if (key.startsWith("s:")) params.set("segmentId", key.slice(2));
    if (searchQuery) params.set("query", searchQuery); if (status) params.set("status", status); if (priority) params.set("priority", priority);
    if (signal) params.set("signal", signal); if (minFitScore.trim()) params.set("minIcpFitScore", minFitScore.trim());
    try { const next = await apiJson<MarketAccountListResult>(`/api/prospect-factory/crm/market/accounts?${params}`); if (pageRequests.current[key] !== sequence) return; requestedOffsets.current[key] = offset; setPages((current) => ({ ...current, [key]: next })); setOffsets((current) => ({ ...current, [key]: offset })); setError(null); }
    catch (caught) { if (pageRequests.current[key] === sequence) setError(caught instanceof Error ? caught.message : "Chargement des comptes impossible."); }
    finally { if (pageRequests.current[key] === sequence) setLoadingPages((current) => { const next = new Set(current); next.delete(key); return next; }); }
  }, [searchQuery, status, priority, signal, minFitScore]);
  const loadAccount = useCallback(async (id: string) => {
    const sequence = (detailRequests.current[id] ?? 0) + 1; detailRequests.current[id] = sequence;
    try { const [detail, personaResult] = await Promise.all([
      apiJson<AccountDetail>(`/api/prospect-factory/crm/prospects/${encodeURIComponent(id)}`),
      apiJson<{ personas: AccountPersonaSlot[] }>(`/api/prospect-factory/crm/prospects/${encodeURIComponent(id)}/personas`)
    ]); if (detailRequests.current[id] !== sequence) return; setDetails((current) => ({ ...current, [id]: detail })); setSlots((current) => ({ ...current, [id]: personaResult.personas })); setError(null); }
    catch (caught) { if (detailRequests.current[id] === sequence) setError(caught instanceof Error ? caught.message : "Chargement du compte impossible."); }
  }, []);
  useEffect(() => { void loadOverview(); }, [loadOverview, refreshToken, refreshIndex]);
  useEffect(() => {
    const filterKey = JSON.stringify([searchQuery, status, priority, signal, minFitScore]);
    if (previousListFilters.current !== filterKey) {
      previousListFilters.current = filterKey;
      requestedOffsets.current = {};
      setOffsets({});
    }
    for (const key of expandedSegments) void loadAccounts(key, requestedOffsets.current[key] ?? 0);
  }, [expandedSegments, loadAccounts, refreshToken, refreshIndex, searchQuery, status, priority, signal, minFitScore]);
  useEffect(() => { if (selectedAccountId) void loadAccount(selectedAccountId); }, [selectedAccountId, loadAccount, refreshToken]);
  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    if (selectedAccountId) parameters.set("crmMarketAccount", selectedAccountId); else parameters.delete("crmMarketAccount");
    const activeListScope = selection.kind === "all" || selection.kind === "unclassified" || selection.kind === "segment" ? selection : lastListScope;
    const scope = selection.kind === "overview" ? ""
      : selection.kind === "icp" ? `icp:${selection.icpId}`
        : listScopeValue(activeListScope);
    if (scope) parameters.set("crmMarketScope", scope); else parameters.delete("crmMarketScope");
    const listOffset = scope && !scope.startsWith("icp:") ? offsets[listScopeKey(activeListScope)] ?? 0 : 0;
    if (listOffset) parameters.set("crmMarketOffset", String(listOffset)); else parameters.delete("crmMarketOffset");
    for (const [key, value] of [["crmMarketQuery", searchQuery], ["crmMarketStatus", status], ["crmMarketPriority", priority], ["crmMarketSignal", signal], ["crmMarketFit", minFitScore]]) {
      if (value) parameters.set(key, value); else parameters.delete(key);
    }
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${parameters}`);
  }, [selectedAccountId, selection, lastListScope, offsets, searchQuery, status, priority, signal, minFitScore]);
  useEffect(() => { if (!editor) return; const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null; const oldOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; const frame = requestAnimationFrame(() => modalRef.current?.querySelector<HTMLElement>("input, textarea, select, button")?.focus()); const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setEditor(null); }; document.addEventListener("keydown", onKey); return () => { cancelAnimationFrame(frame); document.removeEventListener("keydown", onKey); document.body.style.overflow = oldOverflow; previous?.focus(); }; }, [editor]);

  function selectIcp(icpId: string) { setSelection({ kind: "icp", icpId }); setExpandedIcps((current) => new Set(current).add(icpId)); }
  function selectAll() { const scope: ListScope = { kind: "all" }; setLastListScope(scope); setSelection(scope); setExpandedSegments((current) => new Set(current).add("all")); }
  function selectUnclassified() { const scope: ListScope = { kind: "unclassified" }; setLastListScope(scope); setSelection(scope); setExpandedSegments((current) => new Set(current).add("unclassified")); }
  function selectSegment(icpId: string, segmentId: string) { const scope: ListScope = { kind: "segment", icpId, segmentId }; setLastListScope(scope); setSelection(scope); setExpandedIcps((current) => new Set(current).add(icpId)); setExpandedSegments((current) => new Set(current).add(`s:${segmentId}`)); }
  function selectAccount(accountId: string, sourceScope?: ListScope) { if (sourceScope) setLastListScope(sourceScope); setSelection({ kind: "account", accountId }); setExpandedAccounts((current) => new Set(current).add(accountId)); }
  function returnToResults() {
    setSelection(lastListScope);
    setExpandedSegments((current) => new Set(current).add(listScopeKey(lastListScope)));
    if (lastListScope.kind === "segment") setExpandedIcps((current) => new Set(current).add(lastListScope.icpId));
  }
  function scopeForAccountList(key: string, prospect: TrackedProspect): ListScope {
    if (key === "all" || key === "unclassified") return { kind: key };
    const segmentId = key.startsWith("s:") ? key.slice(2) : "";
    const icpId = segmentById.get(segmentId)?.icpId || prospect.market.icpId;
    return segmentId && icpId ? { kind: "segment", icpId, segmentId } : { kind: "all" };
  }
  function toggleAccount(accountId: string) { setExpandedAccounts((current) => toggleSet(current, accountId)); if (!details[accountId]) void loadAccount(accountId); }
  function refresh() { setRefreshIndex((current) => current + 1); if (selectedAccountId) void loadAccount(selectedAccountId); }
  function setField(key: string, value: string) { setForm((current) => ({ ...current, [key]: value })); }
  function selectedSignals() { return PROSPECT_OPERATIONAL_SIGNALS.filter((signal) => form[`signal:${signal}`] === "true"); }
  function selectedRoles() { return PROSPECT_DEAL_ROLES.filter((role) => form[`role:${role}`] === "true"); }
  function openEditor(next: Editor) {
    let values: FormValues = {};
    if (next.kind === "icp") { const item = next.id ? icpById.get(next.id) : null; if (item) values = { name: item.name, slug: item.slug, description: item.description, qualificationCriteria: item.qualificationCriteria.join("\n"), exclusions: item.exclusions.join("\n"), employeeMin: valueOf(item.employeeMin), employeeMax: valueOf(item.employeeMax), territories: item.territories.join("\n"), ...Object.fromEntries(PROSPECT_OPERATIONAL_SIGNALS.map((signal) => [`weight:${signal}`, valueOf(item.signalWeights[signal])])) }; }
    else if (next.kind === "segment") { const item = next.id ? segmentById.get(next.id) : null; if (item) values = { name: item.name, slug: item.slug, description: item.description, criteria: item.criteria.join("\n") }; }
    else if (next.kind === "account") { const item = details[next.accountId]?.prospect ?? rowById.get(next.accountId)?.prospect; if (item) values = { segmentId: item.market.segmentId ?? "", groupName: item.market.groupName ?? "", siren: item.market.siren ?? "", siret: item.market.siret ?? "", employeeCountEstimate: valueOf(item.market.employeeCountEstimate), establishmentCount: valueOf(item.market.establishmentCount), entityCount: valueOf(item.market.entityCount), ...Object.fromEntries(PROSPECT_OPERATIONAL_SIGNALS.map((signal) => [`signal:${signal}`, item.market.operationalSignals.includes(signal) ? "true" : "false"])) }; }
    else if (next.kind === "contact") { const prospect = details[next.accountId]?.prospect ?? rowById.get(next.accountId)?.prospect; const item = next.id ? prospect?.contacts.find((contact) => contact.id === next.id) : null; if (item) values = { firstName: item.firstName ?? "", lastName: item.lastName ?? "", name: item.name, title: item.verifiedTitle ?? item.inputTitle ?? "", email: item.email ?? "", phone: item.phone ?? "", linkedin: item.linkedin ?? "", seniority: item.seniority ?? "", personaKey: item.personaKey ?? "", decisionScope: item.decisionScope ?? "", evidenceType: item.evidenceType, ...Object.fromEntries(PROSPECT_DEAL_ROLES.map((role) => [`role:${role}`, item.dealRoles.includes(role) ? "true" : "false"])) }; else if (!prospect?.contacts.length && prospect?.legacyContact?.name) values = { name: prospect.legacyContact.name, title: prospect.legacyContact.title ?? "", email: prospect.legacyContact.email ?? "", phone: prospect.legacyContact.phone ?? "", linkedin: prospect.legacyContact.linkedin ?? "" }; }
    else if (next.kind === "slot") { const item = next.id ? slots[next.accountId]?.find((slot) => slot.id === next.id) : null; values = item ? { key: item.key, label: item.label, status: item.status, contactId: item.contactId ?? "", notes: item.notes } : { status: "to_find" }; }
    else { const item = next.id ? icpById.get(next.icpId)?.targetPersonas.find((persona) => persona.id === next.id) : null; if (item) values = { key: item.key, label: item.label, description: item.description, sortOrder: String(item.sortOrder) }; }
    setForm(values); setFormError(null); setEditor(next);
  }
  async function saveEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editor) return; setSaving(true); setFormError(null);
    try {
      if (editor.kind === "icp") { const signalWeights: Partial<Record<ProspectOperationalSignal, number>> = {}; for (const signal of PROSPECT_OPERATIONAL_SIGNALS) { const weight = Number(form[`weight:${signal}`] || 0); if (weight > 0) signalWeights[signal] = weight; } const body = { slug: form.slug?.trim() || slug(form.name || ""), name: form.name?.trim(), description: form.description?.trim() || "", qualificationCriteria: lines(form.qualificationCriteria || ""), exclusions: lines(form.exclusions || ""), employeeMin: optionalNumber(form.employeeMin || ""), employeeMax: optionalNumber(form.employeeMax || ""), territories: lines(form.territories || ""), signalWeights }; await apiJson(`/api/prospect-factory/crm/market/icps${editor.id ? `/${editor.id}` : ""}`, { method: editor.id ? "PATCH" : "POST", ...jsonBody(body) }); }
      else if (editor.kind === "segment") { const body = { icpId: editor.icpId, slug: form.slug?.trim() || slug(form.name || ""), name: form.name?.trim(), description: form.description?.trim() || "", criteria: lines(form.criteria || "") }; await apiJson(`/api/prospect-factory/crm/market/segments${editor.id ? `/${editor.id}` : ""}`, { method: editor.id ? "PATCH" : "POST", ...jsonBody(body) }); }
      else if (editor.kind === "account") { const prospect = details[editor.accountId]?.prospect ?? rowById.get(editor.accountId)?.prospect; if (!prospect) throw new Error("Chargez le compte avant de le classer."); const body = { expectedVersion: prospect.version, market: { segmentId: form.segmentId || null, groupName: form.groupName?.trim() || null, siren: form.siren?.trim() || null, siret: form.siret?.trim() || null, employeeCountEstimate: optionalNumber(form.employeeCountEstimate || ""), establishmentCount: optionalNumber(form.establishmentCount || ""), entityCount: optionalNumber(form.entityCount || ""), operationalSignals: selectedSignals() } }; await apiJson(`/api/prospect-factory/crm/market/accounts/${editor.accountId}`, { method: "PATCH", ...jsonBody(body) }); await loadAccount(editor.accountId); }
      else if (editor.kind === "contact") { const name = [form.firstName, form.lastName].filter(Boolean).join(" ").trim() || form.name?.trim(); const optionalFields = { firstName: form.firstName?.trim() || null, lastName: form.lastName?.trim() || null, verifiedTitle: form.title?.trim() || null, email: form.email?.trim() || null, phone: form.phone?.trim() || null, linkedin: form.linkedin?.trim() || null, seniority: form.seniority?.trim() || null, personaKey: form.personaKey?.trim() || null, decisionScope: form.decisionScope || null }; const body = { name, dealRoles: selectedRoles(), evidenceType: form.evidenceType || "to_confirm", ...Object.fromEntries(Object.entries(optionalFields).filter(([, value]) => Boolean(editor.id) || value !== null)) }; await apiJson(`/api/prospect-factory/crm/prospects/${editor.accountId}/contacts${editor.id ? `/${editor.id}` : ""}`, { method: editor.id ? "PATCH" : "POST", ...jsonBody(body) }); await loadAccount(editor.accountId); }
      else if (editor.kind === "slot") { const body = { key: slug(form.key || form.label || ""), label: form.label?.trim(), status: form.status || "to_find", contactId: form.contactId || null, notes: form.notes?.trim() || "" }; await apiJson(`/api/prospect-factory/crm/prospects/${editor.accountId}/personas${editor.id ? `/${editor.id}` : ""}`, { method: editor.id ? "PATCH" : "POST", ...jsonBody(body) }); await loadAccount(editor.accountId); }
      else { const body = { key: slug(form.key || form.label || ""), label: form.label?.trim(), description: form.description?.trim() || "", sortOrder: Number(form.sortOrder || 0) }; await apiJson(`/api/prospect-factory/crm/market/icps/${editor.icpId}/personas${editor.id ? `/${editor.id}` : ""}`, { method: editor.id ? "PATCH" : "POST", ...jsonBody(body) }); }
      setEditor(null); refresh();
    } catch (caught) { setFormError(caught instanceof Error ? caught.message : "Enregistrement impossible."); }
    finally { setSaving(false); }
  }
  async function deleteEditor() {
    if (!editor || !("id" in editor) || !editor.id) return;
    if (!window.confirm("Supprimer cet élément ? Cette action ne peut pas être annulée.")) return;
    setSaving(true); setFormError(null);
    try { const url = editor.kind === "icp" ? `/api/prospect-factory/crm/market/icps/${editor.id}` : editor.kind === "segment" ? `/api/prospect-factory/crm/market/segments/${editor.id}` : editor.kind === "contact" ? `/api/prospect-factory/crm/prospects/${editor.accountId}/contacts/${editor.id}` : editor.kind === "slot" ? `/api/prospect-factory/crm/prospects/${editor.accountId}/personas/${editor.id}` : editor.kind === "icpPersona" ? `/api/prospect-factory/crm/market/icps/${editor.icpId}/personas/${editor.id}` : null; if (!url) return; await apiJson(url, { method: "DELETE" }); if (editor.kind === "contact" || editor.kind === "slot") await loadAccount(editor.accountId); setSelection(editor.kind === "contact" || editor.kind === "slot" ? { kind: "account", accountId: editor.accountId } : editor.kind === "segment" || editor.kind === "icpPersona" ? { kind: "icp", icpId: editor.icpId } : { kind: "overview" }); setEditor(null); refresh(); }
    catch (caught) { setFormError(caught instanceof Error ? caught.message : "Suppression impossible."); }
    finally { setSaving(false); }
  }

  function treeRow(id: string, label: string, count: number | null, icon: ReactNode, active: boolean, onSelect: () => void, expanded?: boolean, onToggle?: () => void, children?: ReactNode) {
    return <li className={styles.treeNode} key={id}><div className={`${styles.treeRow} ${active ? styles.treeRowActive : ""}`}>
      {onToggle ? <button type="button" className={`${styles.treeToggle} ${expanded ? styles.treeToggleOpen : ""}`} onClick={onToggle} aria-label={`${expanded ? "Replier" : "Déplier"} ${label}`} aria-expanded={expanded}><ChevronRight size={14} /></button> : <span className={styles.treeToggleSpacer} />}
      <button type="button" className={styles.treeSelect} onClick={onSelect} aria-current={active ? "page" : undefined}>{icon}<span title={label}>{label}</span>{count !== null ? <span className={styles.treeCount}>{number.format(count)}</span> : null}</button>
    </div>{expanded && children ? <ul className={`${styles.treeGroup} ${styles.treeChildren}`}>{children}</ul> : null}</li>;
  }
  function accountTree(row: MarketAccountRow, listKey: string) {
    const prospect = details[row.prospect.id]?.prospect ?? row.prospect;
    const sourceScope = scopeForAccountList(listKey, prospect);
    const activities = details[row.prospect.id]?.activities ?? [];
    const personaSlots = slots[row.prospect.id] ?? row.targetPersonas;
    const unfilled = personaSlots.filter((slot) => !slot.contactId && slot.status !== "not_relevant");
    const expanded = expandedAccounts.has(prospect.id);
    const childCount = prospect.contacts.length + unfilled.length + activities.filter((item) => !item.contactId).length;
    const children: ReactNode[] = [];
    for (const contact of prospect.contacts) {
      const contactActivities = activities.filter((item) => item.contactId === contact.id);
      const nestedActivities = contactActivities.map((item) => treeRow(`activity:${item.id}`, item.subject || activityLabels[item.detailType || item.type] || "Activité", null, <Activity size={13} />, selection.kind === "activity" && selection.activityId === item.id, () => { setLastListScope(sourceScope); setSelection({ kind: "activity", accountId: prospect.id, activityId: item.id }); }));
      children.push(treeRow(`contact:${contact.id}`, contact.name, contactActivities.length, <Users size={14} />, selection.kind === "contact" && selection.contactId === contact.id, () => { setLastListScope(sourceScope); setSelection({ kind: "contact", accountId: prospect.id, contactId: contact.id }); setExpandedContacts((current) => new Set(current).add(contact.id)); }, expandedContacts.has(contact.id), () => setExpandedContacts((current) => toggleSet(current, contact.id)), nestedActivities));
    }
    for (const slot of unfilled) children.push(treeRow(`slot:${slot.id}`, `${slot.label} · à rechercher`, null, <Users size={14} />, selection.kind === "slot" && selection.slotId === slot.id, () => { setLastListScope(sourceScope); setSelection({ kind: "slot", accountId: prospect.id, slotId: slot.id }); }));
    for (const item of activities.filter((activity) => !activity.contactId)) children.push(treeRow(`activity:${item.id}`, item.subject || activityLabels[item.detailType || item.type] || "Activité", null, <Activity size={13} />, selection.kind === "activity" && selection.activityId === item.id, () => { setLastListScope(sourceScope); setSelection({ kind: "activity", accountId: prospect.id, activityId: item.id }); }));
    if (expanded && !details[prospect.id]) children.push(<li className={styles.treeHint} key="loading">Chargement des contacts et activités…</li>);
    return treeRow(`account:${prospect.id}`, accountName(prospect), childCount || row.activityCount, <Building2 size={14} />, selection.kind === "account" && selection.accountId === prospect.id, () => selectAccount(prospect.id, sourceScope), expanded, () => toggleAccount(prospect.id), children);
  }
  function treeAccounts(key: string) {
    const page = pages[key]; const currentOffset = offsets[key] ?? 0;
    return <>{loadingPages.has(key) && !page ? <li className={styles.treeHint}>Chargement des comptes…</li> : null}
      {page?.accounts.map((row) => accountTree(row, key))}
      {page && !page.accounts.length ? <li className={styles.treeHint}>Aucun compte dans ce filtre.</li> : null}
      {page && page.total > pageSize ? <li key={`${key}-pager`} className={styles.treeMore}><button type="button" disabled={currentOffset === 0 || loadingPages.has(key)} onClick={() => void loadAccounts(key, currentOffset - pageSize)}>←</button> {Math.floor(currentOffset / pageSize) + 1}/{Math.ceil(page.total / pageSize)} <button type="button" disabled={currentOffset + pageSize >= page.total || loadingPages.has(key)} onClick={() => void loadAccounts(key, currentOffset + pageSize)}>→</button></li> : null}
    </>;
  }
  function breadcrumb() {
    const account = selectedProspect;
    const icp = selection.kind === "icp" ? icpById.get(selection.icpId) : selection.kind === "segment" ? icpById.get(selection.icpId) : account?.market.icpId ? icpById.get(account.market.icpId) : null;
    const segment = selection.kind === "segment" ? segmentById.get(selection.segmentId) : account?.market.segmentId ? segmentById.get(account.market.segmentId) : null;
    const contact = selection.kind === "contact" ? account?.contacts.find((item) => item.id === selection.contactId) : null;
    return <nav className={styles.breadcrumb} aria-label="Fil d’Ariane du marché"><button type="button" onClick={() => setSelection({ kind: "overview" })}>Marché</button>
      {selection.kind === "all" ? <><ChevronRight size={12} /><strong>Tous les comptes</strong></> : null}
      {icp ? <><ChevronRight size={12} /><button type="button" onClick={() => selectIcp(icp.id)}>{icp.name}</button></> : null}
      {segment ? <><ChevronRight size={12} /><button type="button" onClick={() => selectSegment(segment.icpId, segment.id)}>{segment.name}</button></> : null}
      {selection.kind === "unclassified" || account && !segment ? <><ChevronRight size={12} /><button type="button" onClick={selectUnclassified}>Non classés</button></> : null}
      {account ? <><ChevronRight size={12} /><button type="button" onClick={() => selectAccount(account.id)}>{accountName(account)}</button></> : null}
      {contact ? <><ChevronRight size={12} /><strong>{contact.name}</strong></> : null}
      {selection.kind === "slot" ? <><ChevronRight size={12} /><strong>Persona à rechercher</strong></> : null}
      {selection.kind === "activity" ? <><ChevronRight size={12} /><strong>Activité</strong></> : null}
      {selectedAccountId ? <><span aria-hidden="true">·</span><button type="button" onClick={returnToResults}>← Retour aux résultats</button></> : null}
    </nav>;
  }
  function accountCards(key: string) {
    const page = pages[key]; const offset = offsets[key] ?? 0;
    return <>{loadingPages.has(key) && !page ? <p className={styles.empty}>Chargement des comptes…</p> : null}
      {page && !page.accounts.length ? <p className={styles.empty}>Aucun compte ne correspond à ces critères.</p> : null}
      {page?.accounts.length ? <ul className={styles.accountList}>{page.accounts.map(({ prospect, lastActivity, targetPersonas }) => <li className={styles.accountCard} key={prospect.id}>
        <button type="button" onClick={() => selectAccount(prospect.id, scopeForAccountList(key, prospect))}><span><strong>{accountName(prospect)}</strong><small>{[prospect.snapshot.city, prospect.snapshot.territory].filter(Boolean).join(" · ") || prospect.snapshot.country}</small></span><ArrowRight size={16} /></button>
        <div className={styles.accountMeta}><span className={styles.pill}>{statusLabels[prospect.qualification.status]}</span><span className={styles.pill}>Fit {prospect.market.icpFitScore === null ? "à établir" : `${prospect.market.icpFitScore}/100`}</span><span className={styles.pill}>{prospect.contacts.length} contact{prospect.contacts.length > 1 ? "s" : ""}</span><span className={styles.pill}>{targetPersonas.filter((slot) => !slot.contactId && slot.status === "to_find").length} à rechercher</span>{prospect.qualification.status === "opportunity" ? <span className={`${styles.pill} ${styles.pillHigh}`}>Opportunité ouverte</span> : null}</div>
        <p>Dernière activité : {lastActivity ? `${activityLabels[lastActivity.detailType || lastActivity.type] || "Activité"} · ${niceDate(lastActivity.occurredAt)}` : "aucune"} · Prochaine action : {prospect.qualification.nextActionLabel || "à définir"} · {niceDate(prospect.qualification.nextActionAt)}</p>
        {key === "unclassified" ? <button type="button" className={styles.inlineAssign} onClick={() => openEditor({ kind: "account", accountId: prospect.id })}>Classer ce compte <ArrowRight size={14} /></button> : null}
      </li>)}</ul> : null}
      {page ? <div className={styles.pagination}><span>{number.format(page.total)} compte{page.total > 1 ? "s" : ""} · {page.total ? `${offset + 1}–${offset + page.accounts.length}` : "0"}</span><div><button type="button" onClick={() => void loadAccounts(key, offset - pageSize)} disabled={offset === 0 || loadingPages.has(key)}>Précédent</button><button type="button" onClick={() => void loadAccounts(key, offset + pageSize)} disabled={offset + pageSize >= page.total || loadingPages.has(key)}>Suivant</button></div></div> : null}
    </>;
  }
  function activityCards(activities: ProspectActivity[], accountId: string) {
    return activities.length ? <ul className={styles.activityList}>{activities.slice(0, 20).map((item) => <li className={styles.activityCard} key={item.id}><Activity size={16} /><div><button type="button" className={styles.quietButton} onClick={() => setSelection({ kind: "activity", accountId, activityId: item.id })}><strong>{activityLabels[item.detailType || item.type] || "Activité"}{item.subject ? ` · ${item.subject}` : ""}</strong></button><time dateTime={item.occurredAt}>{niceDate(item.occurredAt)}</time>{item.outcome ? <small>Résultat : {item.outcome.replaceAll("_", " ")}</small> : null}{item.body ? <p>{item.body}</p> : null}</div></li>)}</ul> : <p className={styles.empty}>Aucune activité enregistrée.</p>;
  }
  function overviewPanel() {
    return <><div className={styles.detailHeader}><div><span className={styles.eyebrow}>Cartographie de marché</span><h3>Vos ICP</h3><p>Choisissez un ICP, puis un segment pour travailler ses comptes.</p></div><button type="button" className={styles.button} onClick={() => openEditor({ kind: "icp" })}><Plus size={14} /> Nouvel ICP</button></div>
      {overview?.icps.length ? <ul className={styles.segmentList}>{overview.icps.map((icp) => <li className={styles.segmentCard} key={icp.id}><button type="button" onClick={() => selectIcp(icp.id)}><span><strong>{icp.name}</strong><small>{icp.segments.length} segments · {number.format(icp.metrics.accountCount)} comptes · {number.format(icp.metrics.contactCount)} contacts</small></span><ArrowRight size={16} /></button><p>{icp.description}</p><div className={styles.accountMeta}><span className={styles.pill}>{icp.metrics.responseRate === null ? "Réponse —" : `Réponse ${Math.round(icp.metrics.responseRate * 100)} %`}</span><span className={styles.pill}>{icp.metrics.meetingCount} RDV</span><span className={styles.pill}>{icp.metrics.opportunityCount} opportunités</span><span className={styles.pill}>{icp.metrics.clientCount} clients</span><span className={styles.pill}>Potentiel gagné {money.format(icp.metrics.signedValue)}</span></div></li>)}</ul> : <p className={styles.empty}>Aucun ICP configuré.</p>}
      <section className={styles.section}><div className={styles.sectionHeader}><h4>Comptes non classés</h4><span>{number.format(overview?.unclassified.accountCount ?? 0)}</span></div><p className={styles.text}>Classez les comptes existants progressivement, sans modifier leur suivi commercial.</p><div className={styles.actions}><button type="button" className={styles.button} onClick={selectUnclassified}>Voir les non classés <ArrowRight size={14} /></button></div></section>
      <section className={styles.section}><div className={styles.sectionHeader}><h4>Recherche dans tous les comptes</h4></div><p className={styles.text}>Parcourez les comptes classés et non classés dans un même résultat.</p><div className={styles.actions}><button type="button" className={styles.button} onClick={selectAll}>Voir tous les comptes <ArrowRight size={14} /></button></div></section>
    </>;
  }
  function icpPanel(icp: MarketIcpSummary) {
    return <><div className={styles.detailHeader}><div><span className={styles.eyebrow}>Fiche ICP</span><h3>{icp.name}</h3><p>{icp.description}</p></div><div className={styles.actions}><button type="button" className={styles.button} onClick={() => openEditor({ kind: "segment", icpId: icp.id })}><Plus size={14} /> Segment</button><button type="button" className={styles.button} onClick={() => openEditor({ kind: "icp", id: icp.id })}><Pencil size={14} /> Modifier</button></div></div>
      <MetricGrid metrics={icp.metrics} />
      <div className={styles.dataGrid}><div><span>Effectif recherché</span><strong>{icp.employeeMin ?? "—"} à {icp.employeeMax ?? "—"} salariés environ</strong></div><div><span>Territoires</span><strong>{icp.territories.join(" · ") || "Sans limite"}</strong></div></div>
      <section className={styles.section}><div className={styles.sectionHeader}><h4>Critères de qualification</h4></div><div className={styles.tagList}>{icp.qualificationCriteria.length ? icp.qualificationCriteria.map((criterion) => <span className={styles.tag} key={criterion}>{criterion}</span>) : <span className={`${styles.tag} ${styles.tagMuted}`}>À définir</span>}</div></section>
      <section className={styles.section}><div className={styles.sectionHeader}><h4>Exclusions</h4></div><div className={styles.tagList}>{icp.exclusions.length ? icp.exclusions.map((criterion) => <span className={`${styles.tag} ${styles.tagMuted}`} key={criterion}>{criterion}</span>) : <span className={`${styles.tag} ${styles.tagMuted}`}>Aucune exclusion définie</span>}</div></section>
      <section className={styles.section}><div className={styles.sectionHeader}><h4>Signaux de complexité pondérés</h4></div><div className={styles.tagList}>{Object.entries(icp.signalWeights).filter(([, weight]) => weight && weight > 0).map(([signal, weight]) => <span className={styles.tag} key={signal}>{signalLabels[signal as ProspectOperationalSignal]} · {weight}</span>)}</div></section>
      <section className={styles.section}><div className={styles.sectionHeader}><h4>Segments</h4><span>{icp.segments.length}</span></div>{icp.segments.length ? <ul className={styles.segmentList}>{icp.segments.map((segment) => <li className={styles.segmentCard} key={segment.id}><button type="button" onClick={() => selectSegment(icp.id, segment.id)}><span><strong>{segment.name}</strong><small>{number.format(segment.metrics.accountCount)} comptes · {number.format(segment.metrics.contactCount)} contacts · {number.format(segment.metrics.meetingCount)} RDV</small></span><ArrowRight size={16} /></button><p>{segment.description}</p></li>)}</ul> : <p className={styles.empty}>Créez le premier segment de cet ICP.</p>}</section>
      <section className={styles.section}><div className={styles.sectionHeader}><h4>Personas recherchés</h4><button type="button" className={styles.button} onClick={() => openEditor({ kind: "icpPersona", icpId: icp.id })}><Plus size={14} /> Persona</button></div>{icp.targetPersonas.length ? <ul className={styles.peopleList}>{icp.targetPersonas.map((persona) => <li className={styles.personCard} key={persona.id}><button type="button" onClick={() => openEditor({ kind: "icpPersona", icpId: icp.id, id: persona.id })}><span><strong>{persona.label}</strong><small>{persona.description || persona.key}</small></span><Pencil size={14} /></button></li>)}</ul> : <p className={styles.empty}>Aucun persona cible défini.</p>}</section>
    </>;
  }
  function segmentPanel(segment: MarketSegmentSummary) {
    const icp = icpById.get(segment.icpId); const key = `s:${segment.id}`;
    return <><div className={styles.detailHeader}><div><span className={styles.eyebrow}>Segment · {icp?.name}</span><h3>{segment.name}</h3><p>{segment.description}</p></div><button type="button" className={styles.button} onClick={() => openEditor({ kind: "segment", icpId: segment.icpId, id: segment.id })}><Pencil size={14} /> Modifier</button></div>
      <MetricGrid metrics={segment.metrics} />
      <section className={styles.section}><div className={styles.sectionHeader}><h4>Critères du segment</h4></div><div className={styles.tagList}>{segment.criteria.length ? segment.criteria.map((criterion) => <span className={styles.tag} key={criterion}>{criterion}</span>) : <span className={`${styles.tag} ${styles.tagMuted}`}>À définir</span>}</div></section>
      <section className={styles.section}><div className={styles.sectionHeader}><h4>Entreprises</h4><span>{number.format(pages[key]?.total ?? segment.metrics.accountCount)} correspondant aux filtres</span></div>{accountCards(key)}</section>
    </>;
  }
  function accountPanel(prospect: TrackedProspect) {
    const accountSlots = selectedSlots; const activities = selectedDetail?.activities ?? [];
    const sourceContacts = prospect.contacts;
    const missingSlots = accountSlots.filter((slot) => slot.status === "to_find" && !slot.contactId);
    const website = prospect.enrichment.website || prospect.snapshot.website;
    const websiteHref = safeWebUrl(website);
    return <><div className={styles.detailHeader}><div><span className={styles.eyebrow}>Compte · {segmentById.get(prospect.market.segmentId || "")?.name || "Non classé"}</span><h3>{accountName(prospect)}</h3><p>{[prospect.snapshot.vertical, prospect.snapshot.city, prospect.snapshot.territory].filter(Boolean).join(" · ")}</p></div><div className={styles.actions}><button type="button" className={styles.button} onClick={() => openEditor({ kind: "account", accountId: prospect.id })}><Pencil size={14} /> Classer</button><ContextualMapLink accountId={prospect.id} sourceView="market" className={styles.button}><Network size={14} /> Cartographie</ContextualMapLink><button type="button" className={styles.primaryButton} onClick={() => onOpenProspect(prospect)}>Fiche complète <ArrowRight size={14} /></button></div></div>
      <div className={styles.dataGrid}><div><span>Score ICP / Fit</span><strong>{prospect.market.icpFitScore === null ? "À établir" : `${prospect.market.icpFitScore}/100`}{prospect.market.icpFitReason ? ` · ${prospect.market.icpFitReason}` : ""}</strong></div><div><span>Étape · priorité</span><strong>{statusLabels[prospect.qualification.status]} · {priorityLabels[prospect.qualification.priority]}</strong></div><div><span>Dernière activité</span><strong>{activities.length ? niceDate(activities[0].occurredAt) : "Aucune"}</strong></div><div><span>Prochaine action</span><strong>{prospect.qualification.nextActionLabel || "Action à préciser"} · {niceDate(prospect.qualification.nextActionAt)}</strong></div><div><span>Opportunité ouverte</span><strong>{prospect.qualification.status === "opportunity" ? money.format(prospect.qualification.potentialValue ?? 0) : "Aucune"}</strong></div><div><span>Groupe / identifiant</span><strong>{prospect.market.groupName || "Groupe inconnu"} · {prospect.market.siren || prospect.market.siret || "SIREN à trouver"}</strong></div><div><span>Effectif estimé</span><strong>{prospect.market.employeeCountEstimate ?? prospect.snapshot.employeeRange ?? "Non renseigné"}</strong></div><div><span>Établissements / entités</span><strong>{prospect.market.establishmentCount ?? "—"} / {prospect.market.entityCount ?? "—"}</strong></div><div><span>Site web</span><strong>{websiteHref ? <a href={websiteHref} target="_blank" rel="noreferrer">{new URL(websiteHref).hostname}</a> : website || "À trouver"}</strong></div></div>
      <section className={styles.section}><div className={styles.sectionHeader}><h4>Signaux de complexité opérationnelle</h4><span>{prospect.market.operationalSignals.length}</span></div><div className={styles.tagList}>{prospect.market.operationalSignals.length ? prospect.market.operationalSignals.map((signal) => <span className={styles.tag} key={signal}>{signalLabels[signal]}</span>) : <span className={`${styles.tag} ${styles.tagMuted}`}>À rechercher</span>}</div></section>
      <section className={styles.section}><div className={styles.sectionHeader}><h4>Contacts connus</h4><button type="button" className={styles.button} onClick={() => openEditor({ kind: "contact", accountId: prospect.id })}><Plus size={14} /> Contact</button></div>{sourceContacts.length ? <ul className={styles.peopleList}>{sourceContacts.map((contact) => <li className={styles.personCard} key={contact.id}><button type="button" onClick={() => setSelection({ kind: "contact", accountId: prospect.id, contactId: contact.id })}><span><strong>{contact.name}</strong><small>{contact.verifiedTitle || contact.inputTitle || "Fonction à préciser"}{contact.dealRoles.length ? ` · ${contact.dealRoles.map((role) => roleLabels[role]).join(", ")}` : ""}</small></span><ArrowRight size={14} /></button></li>)}</ul> : <p className={styles.empty}>Aucun contact identifié. {prospect.legacyContact?.name ? `Ancien contact : ${prospect.legacyContact.name}.` : ""}</p>}</section>
      <section className={styles.section}><div className={styles.sectionHeader}><h4>Personas à identifier</h4><button type="button" className={styles.button} onClick={() => openEditor({ kind: "slot", accountId: prospect.id })}><Plus size={14} /> Persona</button></div>{missingSlots.length ? <ul className={styles.peopleList}>{missingSlots.map((slot) => <li className={styles.personCard} key={slot.id}><button type="button" onClick={() => setSelection({ kind: "slot", accountId: prospect.id, slotId: slot.id })}><span><strong>{slot.label}</strong><small>{slot.notes || "Personne à rechercher"}</small></span><ArrowRight size={14} /></button></li>)}</ul> : <p className={styles.empty}>Aucun persona manquant identifié. Ajoutez un rôle cible si nécessaire.</p>}</section>
      <section className={styles.section}><div className={styles.sectionHeader}><h4>Activités récentes</h4><button type="button" className={styles.button} onClick={() => onOpenProspect(prospect, "activity")}><Plus size={14} /> Consigner</button></div>{activityCards(activities, prospect.id)}</section>
    </>;
  }
  function contactPanel(prospect: TrackedProspect, contact: ProspectContact) {
    const activities = selectedDetail?.activities.filter((item) => item.contactId === contact.id) ?? [];
    return <><div className={styles.detailHeader}><div><span className={styles.eyebrow}>Contact · {accountName(prospect)}</span><h3>{contact.name}</h3><p>{contact.verifiedTitle || contact.inputTitle || "Poste à préciser"}</p></div><div className={styles.actions}><button type="button" className={styles.button} onClick={() => openEditor({ kind: "contact", accountId: prospect.id, id: contact.id })}><Pencil size={14} /> Modifier</button><button type="button" className={styles.primaryButton} onClick={() => onOpenProspect(prospect, "activity", contact.id)}>Consigner une activité</button></div></div>
      <div className={styles.dataGrid}><div><span>E-mail</span><strong>{contact.email || "À trouver"}</strong></div><div><span>Téléphone</span><strong>{contact.phone || "À trouver"}</strong></div><div><span>LinkedIn</span><strong>{contact.linkedin || "À trouver"}</strong></div><div><span>Niveau</span><strong>{contact.seniority || "À préciser"}</strong></div><div><span>Décision</span><strong>{contact.decisionScope === "headquarters" ? "Siège" : contact.decisionScope === "local" ? "Locale" : contact.decisionScope === "both" ? "Locale et siège" : "À préciser"}</strong></div><div><span>Persona</span><strong>{contact.personaKey || "À rattacher"}</strong></div></div>
      <section className={styles.section}><div className={styles.sectionHeader}><h4>Rôles dans le deal</h4></div><div className={styles.tagList}>{contact.dealRoles.length ? contact.dealRoles.map((role) => <span className={styles.tag} key={role}>{roleLabels[role]}</span>) : <span className={`${styles.tag} ${styles.tagMuted}`}>À qualifier</span>}</div></section>
      <section className={styles.section}><div className={styles.sectionHeader}><h4>Activités avec ce contact</h4><span>{activities.length}</span></div>{activityCards(activities, prospect.id)}</section>
    </>;
  }
  function slotPanel(prospect: TrackedProspect, slot: AccountPersonaSlot) {
    const linked = prospect.contacts.find((item) => item.id === slot.contactId);
    return <><div className={styles.detailHeader}><div><span className={styles.eyebrow}>Persona cible · {accountName(prospect)}</span><h3>{slot.label}</h3><p>{linked ? `Personne identifiée : ${linked.name}` : "Personne à rechercher"}</p></div><button type="button" className={styles.button} onClick={() => openEditor({ kind: "slot", accountId: prospect.id, id: slot.id })}><Pencil size={14} /> Modifier</button></div><div className={styles.dataGrid}><div><span>Statut</span><strong>{slot.status === "to_find" ? "À rechercher" : slot.status === "identified" ? "Identifié" : "Non pertinent"}</strong></div><div><span>Contact associé</span><strong>{linked?.name || "Aucun"}</strong></div></div><section className={styles.section}><div className={styles.sectionHeader}><h4>Notes</h4></div><p className={styles.text}>{slot.notes || "Aucune note."}</p></section></>;
  }
  function activityPanel(prospect: TrackedProspect, activity: ProspectActivity) {
    const contact = prospect.contacts.find((item) => item.id === activity.contactId);
    return <><div className={styles.detailHeader}><div><span className={styles.eyebrow}>Activité commerciale</span><h3>{activityLabels[activity.detailType || activity.type] || "Activité"}{activity.subject ? ` · ${activity.subject}` : ""}</h3><p>{niceDate(activity.occurredAt)} · {contact?.name || "Compte général"}</p></div><button type="button" className={styles.button} onClick={() => onOpenProspect(prospect)}>Historique complet <ArrowRight size={14} /></button></div><div className={styles.dataGrid}><div><span>Résultat</span><strong>{activity.outcome?.replaceAll("_", " ") || "Non renseigné"}</strong></div><div><span>Prochaine action</span><strong>{activity.nextActionLabel || "À préciser"} · {niceDate(activity.nextActionAt)}</strong></div></div><section className={styles.section}><div className={styles.sectionHeader}><h4>Compte rendu</h4></div><p className={styles.text}>{activity.body || "Aucune note."}</p></section></>;
  }
  function detailPanel() {
    if (selection.kind === "overview") return overviewPanel();
    if (selection.kind === "icp") return selectedIcp ? icpPanel(selectedIcp) : <p className={styles.empty}>ICP introuvable.</p>;
    if (selection.kind === "segment") return selectedSegment ? segmentPanel(selectedSegment) : <p className={styles.empty}>Segment introuvable.</p>;
    if (selection.kind === "all") return <><div className={styles.detailHeader}><div><span className={styles.eyebrow}>Tous les comptes</span><h3>Entreprises du marché</h3><p>Recherche et filtres sur l’ensemble du suivi commercial.</p></div></div><section className={styles.section}><div className={styles.sectionHeader}><h4>Entreprises</h4><span>{number.format(pages.all?.total ?? overview?.totalAccounts ?? 0)} correspondant aux filtres</span></div>{accountCards("all")}</section></>;
    if (selection.kind === "unclassified") return <><div className={styles.detailHeader}><div><span className={styles.eyebrow}>À classer</span><h3>Comptes non classés</h3><p>Ouvrez un compte, puis choisissez son segment. Le suivi commercial enregistré reste associé au compte.</p></div></div>{overview ? <MetricGrid metrics={overview.unclassified} /> : null}<section className={styles.section}><div className={styles.sectionHeader}><h4>Entreprises</h4><span>{number.format(pages.unclassified?.total ?? overview?.unclassified.accountCount ?? 0)} correspondant aux filtres</span></div>{accountCards("unclassified")}</section></>;
    if (!selectedProspect) return <p className={styles.empty}>Chargement du compte…</p>;
    if (selection.kind === "account") return accountPanel(selectedProspect);
    if (selection.kind === "contact") { const contact = selectedProspect.contacts.find((item) => item.id === selection.contactId); return contact ? contactPanel(selectedProspect, contact) : <p className={styles.empty}>Contact introuvable.</p>; }
    if (selection.kind === "slot") { const slot = selectedSlots.find((item) => item.id === selection.slotId); return slot ? slotPanel(selectedProspect, slot) : <p className={styles.empty}>Persona introuvable.</p>; }
    const activity = selectedDetail?.activities.find((item) => item.id === selection.activityId);
    return activity ? activityPanel(selectedProspect, activity) : <p className={styles.empty}>Activité introuvable ou chargement en cours.</p>;
  }

  function input(label: string, key: string, options: { required?: boolean; type?: string; placeholder?: string; maxLength?: number; full?: boolean } = {}) {
    return <label className={options.full ? styles.fullField : undefined} key={key}>{label}<input type={options.type || "text"} value={form[key] || ""} onChange={(event) => setField(key, event.target.value)} placeholder={options.placeholder} required={options.required} maxLength={options.maxLength} /></label>;
  }
  function textarea(label: string, key: string, hint?: string) { return <label className={styles.fullField} key={key}>{label}<textarea value={form[key] || ""} onChange={(event) => setField(key, event.target.value)} rows={3} />{hint ? <span className={styles.formHint}>{hint}</span> : null}</label>; }
  function formFields() {
    if (!editor) return null;
    if (editor.kind === "icp") return <>
      {input("Nom de l’ICP", "name", { required: true, full: true, maxLength: 180 })}
      {input("Identifiant court", "slug", { placeholder: "Généré depuis le nom", maxLength: 100 })}
      {textarea("Description", "description")}
      {input("Effectif minimum indicatif", "employeeMin", { type: "number" })}
      {input("Effectif maximum indicatif", "employeeMax", { type: "number" })}
      {textarea("Territoires", "territories", "Un territoire par ligne.")}
      {textarea("Critères de qualification", "qualificationCriteria", "Un critère par ligne.")}
      {textarea("Exclusions", "exclusions", "Une exclusion par ligne.")}
      <div className={styles.fullField}><span className={styles.eyebrow}>Poids des signaux opérationnels</span><div className={styles.weightsGrid}>{PROSPECT_OPERATIONAL_SIGNALS.map((signal) => <label key={signal}>{signalLabels[signal]}<input type="number" min="0" max="100" step="1" value={form[`weight:${signal}`] || ""} onChange={(event) => setField(`weight:${signal}`, event.target.value)} placeholder="0" /></label>)}</div><p className={styles.formHint}>Laissez vide ou 0 pour ignorer un signal dans le score ICP.</p></div>
    </>;
    if (editor.kind === "segment") return <>
      {input("Nom du segment", "name", { required: true, full: true, maxLength: 180 })}
      {input("Identifiant court", "slug", { placeholder: "Généré depuis le nom", maxLength: 100 })}
      {textarea("Description", "description")}
      {textarea("Critères du segment", "criteria", "Un critère par ligne.")}
    </>;
    if (editor.kind === "account") return <>
      <label className={styles.fullField}>ICP → Segment<select value={form.segmentId || ""} onChange={(event) => setField("segmentId", event.target.value)}><option value="">Non classé</option>{overview?.icps.map((icp) => <optgroup key={icp.id} label={icp.name}>{icp.segments.map((segment) => <option key={segment.id} value={segment.id}>{segment.name}</option>)}</optgroup>)}</select></label>
      {input("Groupe éventuel", "groupName", { maxLength: 180 })}
      {input("SIREN", "siren", { maxLength: 9 })}
      {input("SIRET", "siret", { maxLength: 14 })}
      {input("Salariés estimés", "employeeCountEstimate", { type: "number" })}
      {input("Nombre d’établissements", "establishmentCount", { type: "number" })}
      {input("Nombre d’entités", "entityCount", { type: "number" })}
      <div className={styles.fullField}><span className={styles.eyebrow}>Signaux de complexité observés</span><div className={styles.checkGrid}>{PROSPECT_OPERATIONAL_SIGNALS.map((signal) => <label className={styles.checkItem} key={signal}><input type="checkbox" checked={form[`signal:${signal}`] === "true"} onChange={(event) => setField(`signal:${signal}`, event.target.checked ? "true" : "false")} />{signalLabels[signal]}</label>)}</div></div>
    </>;
    if (editor.kind === "contact") {
      const prospect = details[editor.accountId]?.prospect; const personas = prospect?.market.icpId ? icpById.get(prospect.market.icpId)?.targetPersonas ?? [] : [];
      return <>
        {input("Prénom", "firstName", { maxLength: 120 })}
        {input("Nom", "lastName", { maxLength: 120 })}
        {input("Nom complet si prénom/nom inconnus", "name", { full: true, required: !form.firstName?.trim() && !form.lastName?.trim(), maxLength: 180 })}
        {input("Poste", "title", { maxLength: 180 })}
        {input("E-mail", "email", { type: "email", maxLength: 320 })}
        {input("Téléphone", "phone", { type: "tel", maxLength: 60 })}
        {input("LinkedIn", "linkedin", { type: "url", full: true, maxLength: 2048 })}
        {input("Niveau hiérarchique", "seniority", { maxLength: 120, placeholder: "Direction, manager…" })}
        <label>Persona<select value={form.personaKey || ""} onChange={(event) => setField("personaKey", event.target.value)}><option value="">À préciser</option>{personas.map((persona) => <option key={persona.id} value={persona.key}>{persona.label}</option>)}</select></label>
        <label>Périmètre de décision<select value={form.decisionScope || ""} onChange={(event) => setField("decisionScope", event.target.value)}><option value="">À préciser</option><option value="local">Local</option><option value="headquarters">Siège</option><option value="both">Local et siège</option><option value="unknown">Inconnu</option></select></label>
        <label>Fiabilité<select value={form.evidenceType || "to_confirm"} onChange={(event) => setField("evidenceType", event.target.value)}><option value="to_confirm">À confirmer</option><option value="official">Source officielle</option><option value="apollo_input">Source Apollo</option></select></label>
        <div className={styles.fullField}><span className={styles.eyebrow}>Rôles dans le deal · cumulables</span><div className={styles.checkGrid}>{PROSPECT_DEAL_ROLES.map((role) => <label className={styles.checkItem} key={role}><input type="checkbox" checked={form[`role:${role}`] === "true"} onChange={(event) => setField(`role:${role}`, event.target.checked ? "true" : "false")} />{roleLabels[role]}</label>)}</div></div>
      </>;
    }
    if (editor.kind === "slot") {
      const prospect = details[editor.accountId]?.prospect; const personas = prospect?.market.icpId ? icpById.get(prospect.market.icpId)?.targetPersonas ?? [] : [];
      return <>
        <label className={styles.fullField}>Persona de l’ICP<select value={form.key || ""} onChange={(event) => { const persona = personas.find((item) => item.key === event.target.value); setForm((current) => ({ ...current, key: event.target.value, label: persona?.label || current.label || "" })); }}><option value="">Choisir ou saisir ci-dessous</option>{personas.map((persona) => <option key={persona.id} value={persona.key}>{persona.label}</option>)}</select></label>
        {input("Clé du persona", "key", { required: true, maxLength: 100 })}
        {input("Nom du rôle", "label", { required: true, maxLength: 180 })}
        <label>Statut<select value={form.status || "to_find"} onChange={(event) => setField("status", event.target.value)}><option value="to_find">À rechercher</option><option value="identified">Identifié</option><option value="not_relevant">Non pertinent</option></select></label>
        <label>Contact lié<select value={form.contactId || ""} onChange={(event) => setField("contactId", event.target.value)}><option value="">Aucun</option>{prospect?.contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></label>
        {textarea("Notes", "notes")}
      </>;
    }
    return <>
      {input("Clé du persona", "key", { required: true, maxLength: 100 })}
      {input("Nom du rôle", "label", { required: true, maxLength: 180 })}
      {input("Ordre d’affichage", "sortOrder", { type: "number" })}
      {textarea("Description", "description")}
    </>;
  }
  function editorTitle() { if (!editor) return ""; const noun = editor.kind === "icp" ? "ICP" : editor.kind === "segment" ? "segment" : editor.kind === "account" ? "classification du compte" : editor.kind === "contact" ? "contact" : "persona"; return `${"id" in editor && editor.id || editor.kind === "account" ? "Modifier" : "Ajouter"} ${noun}`; }
  const modal = editor && typeof document !== "undefined" ? createPortal(<div className={styles.modalOverlay} onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}><div className={styles.modal} ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="market-editor-title" onKeyDown={(event) => { if (event.key !== "Tab") return; const all = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')].filter((element) => element.getClientRects().length > 0); const first = all[0], last = all.at(-1); if (first && last && event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (first && last && !event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }}>
    <header className={styles.modalHeader}><div><h3 id="market-editor-title">{editorTitle()}</h3><p>Les changements sont enregistrés dans le suivi commercial.</p></div><button type="button" className={styles.modalClose} onClick={() => setEditor(null)} aria-label="Fermer"><X size={18} /></button></header>
    <form onSubmit={(event) => void saveEditor(event)}><div className={styles.formGrid}>{formFields()}</div>{formError ? <p className={styles.error} role="alert">{formError}</p> : null}<div className={styles.formActions}>{"id" in editor && editor.id ? <button type="button" className={styles.button} onClick={() => void deleteEditor()} disabled={saving}><Trash2 size={14} /> Supprimer</button> : null}<button type="button" className={styles.button} onClick={() => setEditor(null)} disabled={saving}>Annuler</button><button type="submit" className={styles.primaryButton} disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer"}</button></div></form>
  </div></div>, document.body) : null;

  return <div className={styles.market}>
    <div className={styles.heading}><div><h2>Vue Marché</h2><p>ICP → segment → compte → contact → activités. Dépliez l’arbre pour explorer, sélectionnez un niveau pour voir sa fiche.</p></div><div className={styles.headingActions}><button type="button" className={styles.button} onClick={refresh} disabled={loading}><RefreshCw size={14} /> Actualiser</button><button type="button" className={styles.primaryButton} onClick={() => openEditor({ kind: "icp" })}><Plus size={14} /> ICP</button></div></div>
    <div className={styles.toolbar}><form className={styles.search} onSubmit={(event) => { event.preventDefault(); setSearchQuery(searchDraft.trim().slice(0, 120)); selectAll(); }} role="search"><Search size={16} /><input type="search" aria-label="Rechercher un compte dans le marché" placeholder="Entreprise, contact, ville…" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} /><button type="submit" aria-label="Lancer la recherche"><ArrowRight size={16} /></button></form>
      <label>Étape<select value={status} onChange={(event) => setStatus(event.target.value as ProspectQualificationStatus | "")}><option value="">Toutes</option>{PROSPECT_QUALIFICATION_STATUSES.map((item) => <option value={item} key={item}>{statusLabels[item]}</option>)}</select></label>
      <label>Priorité<select value={priority} onChange={(event) => setPriority(event.target.value as ProspectPriority | "")}><option value="">Toutes</option>{Object.entries(priorityLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      <label>Signal opérationnel<select value={signal} onChange={(event) => setSignal(event.target.value as ProspectOperationalSignal | "")}><option value="">Tous</option>{PROSPECT_OPERATIONAL_SIGNALS.map((item) => <option key={item} value={item}>{signalLabels[item]}</option>)}</select></label>
      <label>Fit ICP minimum<select value={minFitScore} onChange={(event) => setMinFitScore(event.target.value)}><option value="">Tous</option>{[20, 40, 60, 80].map((score) => <option key={score} value={score}>{score}/100</option>)}</select></label>
    </div>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    <div className={styles.layout}>
      <aside className={styles.sidebar} aria-label="Arborescence du marché"><div className={styles.sidebarHeader}><strong>Marché</strong><span>{loading ? "Chargement…" : `${number.format(overview?.totalAccounts ?? 0)} comptes`}</span></div>
        <nav className={styles.tree} aria-label="ICP, segments, entreprises et contacts"><ul className={styles.treeGroup}>
          {treeRow("overview", "Tous les ICP", overview?.icps.length ?? 0, <Layers3 size={14} />, selection.kind === "overview", () => setSelection({ kind: "overview" }))}
          {treeRow("all", "Tous les comptes", overview?.totalAccounts ?? 0, <Building2 size={14} />, selection.kind === "all", selectAll, expandedSegments.has("all"), () => setExpandedSegments((current) => toggleSet(current, "all")), treeAccounts("all"))}
          {treeRow("unclassified", "Non classés", overview?.unclassified.accountCount ?? 0, <Layers3 size={14} />, selection.kind === "unclassified", selectUnclassified, expandedSegments.has("unclassified"), () => setExpandedSegments((current) => toggleSet(current, "unclassified")), treeAccounts("unclassified"))}
          {overview?.icps.map((icp) => {
            const segments = icp.segments.map((segment) => treeRow(
              `segment:${segment.id}`, segment.name, segment.metrics.accountCount,
              expandedSegments.has(`s:${segment.id}`) ? <Layers3 size={14} /> : <Layers3 size={14} />,
              selection.kind === "segment" && selection.segmentId === segment.id,
              () => selectSegment(icp.id, segment.id), expandedSegments.has(`s:${segment.id}`),
              () => setExpandedSegments((current) => toggleSet(current, `s:${segment.id}`)), treeAccounts(`s:${segment.id}`)
            ));
            return treeRow(
              `icp:${icp.id}`, icp.name, icp.metrics.accountCount,
              expandedIcps.has(icp.id) ? <Layers3 size={14} /> : <Layers3 size={14} />,
              selection.kind === "icp" && selection.icpId === icp.id,
              () => selectIcp(icp.id), expandedIcps.has(icp.id),
              () => setExpandedIcps((current) => toggleSet(current, icp.id)), segments
            );
          })}
        </ul></nav>
      </aside>
      <section className={styles.detail} aria-live="polite">{breadcrumb()}{detailPanel()}</section>
    </div>{modal}
  </div>;
}

