"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import type { Route } from "next";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, ArrowRight, Building2, CircleAlert, CircleHelp, ExternalLink, FileJson2, Filter, Network, Plus, RefreshCw, Save, Search, Trash2, UserRound, X } from "lucide-react";
import type { TrackedProspect } from "@/lib/prospect-factory-crm-contract";
import { MAP_STAKEHOLDER_ROLES, type AccountMapSnapshot as MapData, type AccountMapNode as MapNode, type AccountMapRelation as MapRelation, type AccountMapOpportunity as MapOpportunity, type MapEvidenceStatus as EvidenceStatus, type MapView } from "@/lib/account-map-contract";
import type { MapCanvasEdge, MapCanvasNode } from "./account-map-canvas";
import { ContextualMapLink } from "./contextual-map-link";
import { accountMapReturnUrl, withAccountMapNavigation, type AccountMapNavigationState } from "./prospect-navigation";
import styles from "./account-map.module.css";

const Canvas = dynamic(() => import("./account-map-canvas"), { ssr: false, loading: () => <div className={styles.canvasLoading}>Chargement du graphe…</div> });

type MapResponse = { map: MapData };
type DetailResponse = { prospect: TrackedProspect };
type Selection = { type: "node"; id: string | null; createKind?: MapNode["kind"] } | { type: "relation"; id: string | null; fromNodeId?: string; toNodeId?: string } | null;
type NodeDraft = { kind: MapNode["kind"]; contactId: string; name: string; title: string; unitKind: string; notes: string; resolvedContactId: string };
type RelationDraft = { fromNodeId: string; toNodeId: string; kind: string; label: string; evidenceStatus: EvidenceStatus; sourceId: string; opportunityId: string; notes: string; locator: string; excerpt: string; justification: string; verificationQuestion: string };
type ImportItem = { id: string; kind: string; label: string; action: "create" | "enrich" | "possible_duplicate" | "conflict" | "reject"; detail: string; defaultAccepted: boolean; candidateContactId?: string; matchBasis?: "name" | "email" | "linkedin" };
type ImportPreview = { batchId: string; fingerprint: string; items: ImportItem[]; warnings: string[]; questions: string[] };

const base = (id: string) => `/api/prospect-factory/crm/prospects/${encodeURIComponent(id)}/map`;
const createDistinctChoice = "__create_distinct__";
const statusLabels: Record<EvidenceStatus, string> = { observed: "Observé", confirmed: "Confirmé", hypothesis: "Hypothèse", contradictory: "Contradictoire", obsolete: "Obsolète" };
const statusOptions = Object.entries(statusLabels) as Array<[EvidenceStatus, string]>;
const kindLabels: Record<MapNode["kind"], string> = { person: "Personne", unit: "Unité", role_slot: "Fonction à identifier" };
const unitKinds = [
  ["company", "Société"], ["group", "Groupe"], ["headquarters", "Siège"], ["subsidiary", "Filiale"], ["establishment", "Établissement"], ["department", "Service"], ["external", "Structure externe"]
] as const;
const stakeholderLabels: Record<(typeof MAP_STAKEHOLDER_ROLES)[number], string> = { user: "Utilisateur", process_owner: "Responsable du processus", influencer: "Influenceur", potential_relay: "Relais potentiel", confirmed_champion: "Champion confirmé", economic_decision_maker: "Décideur économique", technical_validator: "Validateur technique", security_validator: "Validateur sécurité", procurement: "Achats", access_facilitator: "Facilitateur d’accès", unknown: "Inconnu" };
const fictionalImportExample = {
  schema_version: "account_map.v1", account_id: "<UUID_DU_COMPTE>", opportunity_id: null, import_batch_id: "<NOUVEL_UUID_DU_LOT>",
  sources: [{ source_id: "src:demo-note", kind: "meeting_note", label: "Note fictive", collected_at: "2026-09-28T09:00:00Z" }],
  units: [], people: [], role_slots: [{ temp_id: "tmp:slot:reporting", label: "Responsable reporting à identifier", opportunity_id: null, evidence: { status: "observed", source_ids: ["src:demo-note"], locator: "ligne 1", excerpt: "Fonction reporting à identifier" } }],
  relations: [], opportunity_roles: [], power_claims: [], claims: [], hypotheses: [], open_questions: [], warnings: []
};
const relationKinds = [
  ["unqualified", "Lien à qualifier"], ["works_in", "travaille dans"], ["reports_to", "dépend hiérarchiquement de"], ["functional_reports_to", "dépend fonctionnellement de"], ["part_of", "appartient à"], ["can_introduce", "peut présenter"], ["advises", "conseille"]
] as const;
const knownKind = (kind: string, fromKind?: MapNode["kind"]) => kind === "works_in" && fromKind === "role_slot"
  ? "fonction recherchée dans" : relationKinds.find(([key]) => key === kind)?.[1] || kind.replaceAll("_", " ");
const relationStatusLabel = (relation: MapRelation) => relation.kind === "unqualified" && relation.evidenceStatus === "hypothesis" ? "À qualifier" : statusLabels[relation.evidenceStatus];
function allowedRelationKinds(fromKind?: MapNode["kind"], toKind?: MapNode["kind"]) {
  if (!fromKind || !toKind) return [];
  if ((fromKind === "person" || fromKind === "role_slot") && toKind === "unit") return ["unqualified", "works_in"];
  if (fromKind === "unit" && toKind === "unit") return ["unqualified", "part_of"];
  if (fromKind === "person" && toKind === "person") return ["unqualified", "reports_to", "functional_reports_to", "can_introduce", "advises"];
  return ["unqualified"];
}
const claimText = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value) || "Valeur non renseignée";
function proposalForItem(document: Record<string, unknown> | null, item: ImportItem): unknown {
  if (!document) return null;
  const list = (key: string): Array<Record<string, unknown>> => Array.isArray(document[key]) ? document[key] as Array<Record<string, unknown>> : [];
  const after = (prefix: string) => item.id.slice(prefix.length);
  if (item.id.startsWith("source:")) return list("sources").find((entry) => entry.source_id === after("source:"));
  if (item.id.startsWith("unit:")) return list("units").find((entry) => entry.temp_id === after("unit:"));
  if (item.id.startsWith("person:")) return list("people").find((entry) => entry.temp_id === after("person:"));
  if (item.id.startsWith("affiliation:")) {
    const encoded = after("affiliation:"); const cut = encoded.lastIndexOf(":");
    const person = list("people").find((entry) => entry.temp_id === encoded.slice(0, cut));
    return Array.isArray(person?.affiliations) ? person.affiliations[Number(encoded.slice(cut + 1))] : null;
  }
  if (item.id.startsWith("slot:")) return list("role_slots").find((entry) => entry.temp_id === after("slot:"));
  const indexed: Record<string, string> = { relation: "relations", role: "opportunity_roles", power: "power_claims", claim: "claims", hypothesis: "hypotheses", question: "open_questions" };
  const [prefix, index] = item.id.split(":");
  return indexed[prefix] ? list(indexed[prefix])[Number(index)] : null;
}
const defaultNodeDraft = (kind: MapNode["kind"]): NodeDraft => ({ kind, contactId: "", name: "", title: "", unitKind: "department", notes: "", resolvedContactId: "" });
const defaultRelationDraft = (opportunityId: string | null): RelationDraft => ({ fromNodeId: "", toNodeId: "", kind: "", label: "", evidenceStatus: "hypothesis", sourceId: "", opportunityId: opportunityId || "", notes: "", locator: "", excerpt: "", justification: "", verificationQuestion: "" });
type OptimisticLink = { id: string; source: string; target: string; view: MapView; opportunityId: string | null };
async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const result = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(result?.error || `Erreur HTTP ${response.status}`);
  if (!result) throw new Error("Réponse vide du serveur.");
  return result;
}
async function fetchAccountMap(accountId: string) {
  const [mapResult, detail] = await Promise.all([
    apiJson<MapResponse>(base(accountId)),
    apiJson<DetailResponse>(`/api/prospect-factory/crm/prospects/${encodeURIComponent(accountId)}`).catch(() => null)
  ]);
  return { map: mapResult.map, prospect: detail?.prospect || null };
}
function jsonInit(method: string, value: unknown): RequestInit { return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }; }
function sameContext(row: { view: MapView; opportunityId: string | null }, view: MapView, opportunityId: string | null) { return row.view === view && row.opportunityId === (view === "decision" ? opportunityId : null); }
function autoPosition(index: number) {
  const column = index % 4;
  return { x: 36 + column * 250, y: 50 + Math.floor(index / 4) * 320 + (column % 2) * 160 };
}

const compactMapQuery = "(max-width: 760px)";
function subscribeCompactMap(onChange: () => void) {
  const media = window.matchMedia(compactMapQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
function getCompactMap() { return window.matchMedia(compactMapQuery).matches; }
function getServerCompactMap() { return false; }
function initialMapValue(key: string, returnTo?: string) {
  if (typeof window === "undefined") return "";
  const direct = new URLSearchParams(window.location.search).get(key);
  if (direct !== null) return direct;
  return returnTo ? new URL(returnTo, "https://guad.invalid").searchParams.get(key) || "" : "";
}

/** Full account map. It is also embedded in the fourth Suivi commercial view. */
export function AccountMap({ accountId, embedded = false, returnTo }: { accountId: string; embedded?: boolean; returnTo?: string }) {
  const [map, setMap] = useState<MapData | null>(null);
  const [prospect, setProspect] = useState<TrackedProspect | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [optimisticLinks, setOptimisticLinks] = useState<OptimisticLink[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<MapView>(() => initialMapValue("crmMapMode", returnTo) === "decision" ? "decision" : "organization");
  const [opportunityId, setOpportunityId] = useState<string | null>(() => initialMapValue("crmMapOpportunity", returnTo) || null);
  const compactMap = useSyncExternalStore(subscribeCompactMap, getCompactMap, getServerCompactMap);
  const [presentationChoice, setPresentationChoice] = useState<"graph" | "table" | null>(() => { const value = initialMapValue("crmMapPresentation", returnTo); return value === "graph" || value === "table" ? value : null; });
  const presentation = presentationChoice || (compactMap ? "table" : "graph");
  const [query, setQuery] = useState(() => initialMapValue("crmMapNodeQuery", returnTo));
  const [kindFilter, setKindFilter] = useState<MapNode["kind"] | "">(() => { const value = initialMapValue("crmMapKind", returnTo); return value === "person" || value === "unit" || value === "role_slot" ? value : ""; });
  const [statusFilter, setStatusFilter] = useState<EvidenceStatus | "">(() => { const value = initialMapValue("crmMapStatus", returnTo); return value in statusLabels ? value as EvidenceStatus : ""; });
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [nodeDraft, setNodeDraft] = useState<NodeDraft>(defaultNodeDraft("unit"));
  const [relationDraft, setRelationDraft] = useState<RelationDraft>(defaultRelationDraft(null));
  const [newOpportunity, setNewOpportunity] = useState("");
  const [newQuestion, setNewQuestion] = useState("");
  const [newQuestionAction, setNewQuestionAction] = useState("");
  const [nextActionDate, setNextActionDate] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const parsedImportDocument = useMemo<Record<string, unknown> | null>(() => { try { const value: unknown = JSON.parse(importText); return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; } catch { return null; } }, [importText]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(new Set());
  const [contactResolutions, setContactResolutions] = useState<Record<string, string>>({});
  const [roleDraft, setRoleDraft] = useState<(typeof MAP_STAKEHOLDER_ROLES)[number]>("unknown");
  const [roleStatus, setRoleStatus] = useState<"observed" | "hypothesis">("hypothesis");
  const [roleSourceId, setRoleSourceId] = useState("");
  const [roleNotes, setRoleNotes] = useState("");
  const [newSourceOpen, setNewSourceOpen] = useState(false);
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceKind, setSourceKind] = useState("meeting_note");
  const [sourceReference, setSourceReference] = useState("");
  const [sourceExcerpt, setSourceExcerpt] = useState("");
  const [confirmationSourceId, setConfirmationSourceId] = useState("");
  const [confirmationNote, setConfirmationNote] = useState("");
  const [confirmationLocator, setConfirmationLocator] = useState("");
  const [confirmationExcerpt, setConfirmationExcerpt] = useState("");
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const viewportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectingKeys = useRef<Set<string>>(new Set());
  const importDialogRef = useRef<HTMLElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);

  const loadMap = useCallback(async () => {
    try {
      const result = await fetchAccountMap(accountId);
      setMap(result.map);
      setProspect(result.prospect);
      setOpportunityId((current) => current && result.map.opportunities.some((item) => item.id === current) ? current : result.map.opportunities[0]?.id || null);
      setError(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Chargement de la carte impossible."); }
    finally { setLoading(false); }
  }, [accountId]);
  useEffect(() => {
    let cancelled = false;
    void fetchAccountMap(accountId).then((result) => {
      if (cancelled) return;
      setMap(result.map); setProspect(result.prospect);
      setOpportunityId((current) => current && result.map.opportunities.some((item) => item.id === current) ? current : result.map.opportunities[0]?.id || null); setError(null);
    }).catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Chargement de la carte impossible."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accountId]);
  const navigationState: AccountMapNavigationState = { mode: view, presentation: presentationChoice, opportunityId, nodeQuery: query, kind: kindFilter, status: statusFilter };
  const backHref = withAccountMapNavigation(returnTo || accountMapReturnUrl(accountId, "map"), navigationState);
  useEffect(() => {
    const current = `${window.location.pathname}${window.location.search}`;
    const next = withAccountMapNavigation(current, { mode: view, presentation: presentationChoice, opportunityId, nodeQuery: query, kind: kindFilter, status: statusFilter });
    if (next !== current) window.history.replaceState(window.history.state, "", next);
  }, [view, presentationChoice, opportunityId, query, kindFilter, statusFilter]);
  useEffect(() => () => { if (viewportTimer.current) clearTimeout(viewportTimer.current); }, []);
  useEffect(() => {
    if (!selection || !window.matchMedia(compactMapQuery).matches) return;
    inspectorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    inspectorRef.current?.focus({ preventScroll: true });
  }, [selection]);
  useEffect(() => {
    if (!showImport) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => importDialogRef.current?.querySelector<HTMLElement>("textarea")?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setShowImport(false); return; }
      if (event.key !== "Tab" || !importDialogRef.current) return;
      const focusable = [...importDialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])')];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("keydown", keydown); document.body.style.overflow = oldOverflow; previousFocus?.focus(); };
  }, [showImport]);

  const selectedOpportunity = map?.opportunities.find((item) => item.id === opportunityId) || null;
  const relationFromKind = map?.nodes.find((node) => node.id === relationDraft.fromNodeId)?.kind;
  const relationToKind = map?.nodes.find((node) => node.id === relationDraft.toNodeId)?.kind;
  const relationKindChoices = allowedRelationKinds(relationFromKind, relationToKind);
  const visibleNodes = useMemo(() => {
    if (!map) return [];
    const needle = query.trim().toLocaleLowerCase("fr");
    return map.nodes.filter((node) => {
      const inContext = node.kind !== "role_slot" || node.opportunityId === null || (view === "decision" && node.opportunityId === opportunityId);
      return inContext && (!kindFilter || node.kind === kindFilter) && (!needle || `${node.name} ${node.title || ""} ${node.notes || ""}`.toLocaleLowerCase("fr").includes(needle));
    });
  }, [map, kindFilter, query, view, opportunityId]);
  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const searchedNodeId = query.trim() ? visibleNodes[0]?.id || null : focusNodeId;
  const visibleRelations = useMemo(() => {
    if (!map) return [];
    return map.relations.filter((relation) => visibleIds.has(relation.fromNodeId) && visibleIds.has(relation.toNodeId) && (!statusFilter || relation.evidenceStatus === statusFilter) && (view === "organization" ? !relation.opportunityId : !relation.opportunityId || relation.opportunityId === opportunityId));
  }, [map, visibleIds, statusFilter, view, opportunityId]);
  const stableNodePositions = useMemo(() => new Map((map?.nodes || []).slice()
    .sort((left, right) => Number(right.isRoot) - Number(left.isRoot) || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    .map((node, index) => [node.id, autoPosition(index)] as const)), [map]);
  const canvasNodes = useMemo<MapCanvasNode[]>(() => visibleNodes.map((node) => {
    const layout = map?.layouts.find((row) => sameContext(row, view, opportunityId))?.positions.find((row) => row.nodeId === node.id);
    const local = positions[`${view}:${opportunityId || ""}:${node.id}`];
    const role = view === "decision" ? map?.stakeholderRoles.find((item) => item.opportunityId === opportunityId && item.personNodeId === node.id) : null;
    const resolvedContact = node.resolvedContactId ? map?.availableContacts.find((contact) => contact.id === node.resolvedContactId) : null;
    return { id: node.id, kind: node.kind, name: node.name, title: node.kind === "role_slot" && node.resolvedContactId ? `Contact lié : ${resolvedContact?.name || "fiche CRM"}` : role ? `${node.title || ""}${node.title ? " · " : ""}${stakeholderLabels[role.role]}` : node.title, unitKind: node.unitKind, status: node.kind === "role_slot" ? node.resolvedContactId ? "Identifiée" : "À identifier" : null, position: local || (layout ? { x: layout.x, y: layout.y } : stableNodePositions.get(node.id) || autoPosition(0)) };
  }), [visibleNodes, map, view, opportunityId, positions, stableNodePositions]);
  const canvasEdges: MapCanvasEdge[] = visibleRelations.map((relation) => ({ id: relation.id, source: relation.fromNodeId, target: relation.toNodeId, kind: relation.kind, label: relation.kind === "unqualified" ? "Lien à qualifier" : `${relation.label || knownKind(relation.kind, map?.nodes.find((node) => node.id === relation.fromNodeId)?.kind)} · ${statusLabels[relation.evidenceStatus]}`, status: relation.evidenceStatus }));
  for (const link of optimisticLinks) {
    if (link.view === view && link.opportunityId === (view === "decision" ? opportunityId : null) && visibleIds.has(link.source) && visibleIds.has(link.target)) canvasEdges.push({ id: link.id, source: link.source, target: link.target, kind: "unqualified", label: "Lien à qualifier", status: "saving" });
  }
  const contextViewport = map?.layouts.find((row) => sameContext(row, view, opportunityId))?.viewport;
  const currentNode = selection?.type === "node" && selection.id ? map?.nodes.find((node) => node.id === selection.id) : null;
  const currentRelation = selection?.type === "relation" && selection.id ? map?.relations.find((relation) => relation.id === selection.id) : null;
  const unresolved = map?.nodes.filter((node) => node.kind === "role_slot" && !node.resolvedContactId) || [];
  const openQuestions = map?.questions.filter((question) => question.status === "open") || [];
  const unusedContacts = map?.availableContacts.filter((contact) => !map.nodes.some((node) => node.kind === "person" && node.contactId === contact.id)) || [];

  function chooseNode(node: MapNode) {
    setSelection({ type: "node", id: node.id }); setFocusNodeId(node.id);
    setConfirmationSourceId(""); setConfirmationNote(""); setConfirmationLocator(""); setConfirmationExcerpt("");
    setNodeDraft({ kind: node.kind, contactId: node.contactId || "", name: node.name, title: node.title || "", unitKind: node.unitKind || "department", notes: node.notes || "", resolvedContactId: node.resolvedContactId || "" });
  }
  function chooseRelation(relation: MapRelation) {
    setSelection({ type: "relation", id: relation.id });
    setRelationDraft({ fromNodeId: relation.fromNodeId, toNodeId: relation.toNodeId, kind: relation.kind, label: relation.label || "", evidenceStatus: relation.evidenceStatus, sourceId: relation.sourceId || "", opportunityId: relation.opportunityId || "", notes: relation.notes || "", locator: relation.locator || "", excerpt: relation.excerpt || "", justification: relation.justification || "", verificationQuestion: relation.verificationQuestion || "" });
    setConfirmationSourceId(relation.sourceId || ""); setConfirmationNote(""); setConfirmationLocator(relation.locator || ""); setConfirmationExcerpt(relation.excerpt || "");
  }
  function startNode(kind: MapNode["kind"]) {
    setNodeDraft(defaultNodeDraft(kind)); setSelection({ type: "node", id: null, createKind: kind });
  }
  function startRelation() {
    setConnectionError(null);
    setRelationDraft(defaultRelationDraft(view === "decision" ? opportunityId : null));
    setSelection({ type: "relation", id: null });
  }
  async function createLink(fromNodeId: string, toNodeId: string) {
    if (!map?.nodes.some((node) => node.id === fromNodeId) || !map.nodes.some((node) => node.id === toNodeId)) { setConnectionError("Choisissez deux éléments de cette carte."); return; }
    if (fromNodeId === toNodeId) { setConnectionError("Choisissez deux éléments distincts."); return; }
    if (view === "decision" && !opportunityId) { setConnectionError("Choisissez une opportunité pour cette vue."); return; }
    const contextOpportunityId = view === "decision" ? opportunityId : null;
    const key = `${contextOpportunityId || "organization"}:${[fromNodeId, toNodeId].sort().join(":")}`;
    if (connectingKeys.current.has(key)) return;
    const existing = map.relations.find((item) => item.kind === "unqualified" && item.opportunityId === contextOpportunityId
      && ((item.fromNodeId === fromNodeId && item.toNodeId === toNodeId)
        || (item.fromNodeId === toNodeId && item.toNodeId === fromNodeId)));
    if (existing) { chooseRelation(existing); return; }
    connectingKeys.current.add(key);
    const id = `saving:${crypto.randomUUID()}`;
    setConnectionError(null); setError(null);
    setOptimisticLinks((items) => [...items, { id, source: fromNodeId, target: toNodeId, view, opportunityId: contextOpportunityId }]);
    // A new draft should remain visible even when an evidence filter was active.
    setStatusFilter("");
    try {
      const result = await apiJson<{ relation: MapRelation }>(`${base(accountId)}/relations`, jsonInit("POST", { fromNodeId, toNodeId, kind: "unqualified", opportunityId: contextOpportunityId }));
      setMap((current) => current ? { ...current, relations: [...current.relations.filter((item) => item.id !== result.relation.id), result.relation] } : current);
    } catch (caught) {
      setConnectionError(caught instanceof Error ? `Lien non créé : ${caught.message}` : "Lien non créé. Réessayez.");
    } finally {
      setOptimisticLinks((items) => items.filter((item) => item.id !== id));
      connectingKeys.current.delete(key);
    }
  }
  function updateRelationEndpoint(side: "fromNodeId" | "toNodeId", id: string) {
    setRelationDraft((draft) => {
      const next = { ...draft, [side]: id };
      const fromKind = map?.nodes.find((node) => node.id === next.fromNodeId)?.kind;
      const toKind = map?.nodes.find((node) => node.id === next.toNodeId)?.kind;
      return { ...next, kind: allowedRelationKinds(fromKind, toKind).includes(next.kind) ? next.kind : "unqualified" };
    });
  }
  function reverseRelation() {
    setRelationDraft((draft) => {
      const next = { ...draft, fromNodeId: draft.toNodeId, toNodeId: draft.fromNodeId };
      const fromKind = map?.nodes.find((node) => node.id === next.fromNodeId)?.kind;
      const toKind = map?.nodes.find((node) => node.id === next.toNodeId)?.kind;
      return { ...next, kind: allowedRelationKinds(fromKind, toKind).includes(next.kind) ? next.kind : "unqualified" };
    });
  }
  function switchMapView(next: MapView) {
    if (next === view) return;
    setSelection(null); setConnectionError(null); setView(next);
  }
  function switchOpportunity(next: string | null) {
    if (next === opportunityId) return;
    setSelection(null); setConnectionError(null); setOpportunityId(next);
  }

  async function saveNode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selection || selection.type !== "node") return;
    setBusy(true); setError(null);
    try {
      if (currentNode) {
        const payload = currentNode.kind === "person"
          ? { expectedVersion: currentNode.version, notes: nodeDraft.notes.trim() }
          : currentNode.kind === "unit"
            ? { expectedVersion: currentNode.version, name: nodeDraft.name.trim(), title: nodeDraft.title.trim() || null, unitKind: nodeDraft.unitKind, notes: nodeDraft.notes.trim() }
            : { expectedVersion: currentNode.version, name: nodeDraft.name.trim(), notes: nodeDraft.notes.trim(), resolvedContactId: nodeDraft.resolvedContactId || null };
        await apiJson(`${base(accountId)}/nodes/${encodeURIComponent(currentNode.id)}`, jsonInit("PATCH", payload));
      } else if (nodeDraft.kind === "person") {
        let contactId = nodeDraft.contactId;
        if (!contactId) {
          if (!nodeDraft.name.trim()) throw new Error("Indiquez un nom ou choisissez un contact CRM.");
          const created = await apiJson<{ contact: { id: string } }>(`/api/prospect-factory/crm/prospects/${encodeURIComponent(accountId)}/contacts`, jsonInit("POST", { name: nodeDraft.name.trim(), verifiedTitle: nodeDraft.title.trim() || null, evidenceType: "to_confirm" }));
          contactId = created.contact.id;
        }
        await apiJson(`${base(accountId)}/nodes`, jsonInit("POST", { kind: "person", contactId }));
      } else {
        if (!nodeDraft.name.trim()) throw new Error("Le libellé est nécessaire.");
        const payload = nodeDraft.kind === "unit"
          ? { kind: "unit", name: nodeDraft.name.trim(), title: nodeDraft.title.trim() || null, unitKind: nodeDraft.unitKind, notes: nodeDraft.notes.trim() }
          : { kind: "role_slot", name: nodeDraft.name.trim(), notes: nodeDraft.notes.trim(), opportunityId: view === "decision" ? opportunityId : null };
        await apiJson(`${base(accountId)}/nodes`, jsonInit("POST", payload));
      }
      setSelection(null); setNotice("Nœud enregistré."); await loadMap();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Enregistrement impossible."); }
    finally { setBusy(false); }
  }
  async function addExistingContact(contactId: string) {
    setBusy(true); setError(null);
    try { await apiJson(`${base(accountId)}/nodes`, jsonInit("POST", { kind: "person", contactId })); await loadMap(); setNotice("Contact ajouté à la carte."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Ajout impossible."); }
    finally { setBusy(false); }
  }
  async function attachLegacyContact() {
    if (!prospect?.legacyContact) return;
    setBusy(true); setError(null);
    try {
      await apiJson(`/api/prospect-factory/crm/prospects/${encodeURIComponent(accountId)}/contacts`, jsonInit("POST", {
        name: prospect.legacyContact.name,
        evidenceType: "to_confirm"
      }));
      await loadMap();
      setNotice("Contact historique rattaché à la fiche CRM et à la carte.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Le contact historique n’a pas pu être rattaché."); }
    finally { setBusy(false); }
  }
  async function saveRelation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selection || selection.type !== "relation" || !currentRelation) return;
    setBusy(true); setError(null);
    try {
      if (!relationDraft.fromNodeId || !relationDraft.toNodeId || relationDraft.fromNodeId === relationDraft.toNodeId) throw new Error("Choisissez deux nœuds distincts.");
      if (!relationKindChoices.includes(relationDraft.kind)) throw new Error("Choisissez une nature de lien compatible avec ces deux types de nœuds.");
      if (["observed", "confirmed"].includes(relationDraft.evidenceStatus) && !relationDraft.sourceId) throw new Error("Cette relation demande une source.");
      const revalidate = currentRelation?.evidenceStatus === "confirmed" && relationDraft.evidenceStatus === "confirmed";
      if (revalidate && !window.confirm("Cette relation est confirmée. Enregistrer vos changements et renouveler explicitement sa validation ?")) return;
      const payload = { fromNodeId: relationDraft.fromNodeId, toNodeId: relationDraft.toNodeId, kind: relationDraft.kind, label: relationDraft.label.trim() || null, evidenceStatus: relationDraft.evidenceStatus, sourceId: relationDraft.sourceId || null, opportunityId: relationDraft.opportunityId || null, notes: relationDraft.notes.trim(), locator: relationDraft.locator.trim() || null, excerpt: relationDraft.excerpt.trim() || null, justification: relationDraft.justification.trim() || null, verificationQuestion: relationDraft.verificationQuestion.trim() || null, ...(currentRelation ? { expectedVersion: currentRelation.version } : {}), ...(revalidate ? { revalidate: true as const } : {}) };
      const result = await apiJson<{ relation: MapRelation }>(currentRelation ? `${base(accountId)}/relations/${encodeURIComponent(currentRelation.id)}` : `${base(accountId)}/relations`, jsonInit(currentRelation ? "PATCH" : "POST", payload));
      await loadMap();
      const saved = result.relation;
      const from = map?.nodes.find((node) => node.id === saved.fromNodeId);
      const to = map?.nodes.find((node) => node.id === saved.toNodeId);
      const needle = query.trim().toLocaleLowerCase("fr");
      if (needle && [from, to].some((node) => !node || !`${node.name} ${node.title || ""} ${node.notes || ""}`.toLocaleLowerCase("fr").includes(needle))) setQuery("");
      if (kindFilter && (from?.kind !== kindFilter || to?.kind !== kindFilter)) setKindFilter("");
      if (statusFilter && statusFilter !== saved.evidenceStatus) setStatusFilter("");
      const visibleInCurrentView = view === "organization" ? !saved.opportunityId
        : !saved.opportunityId || saved.opportunityId === opportunityId;
      if (!visibleInCurrentView) {
        setView(saved.opportunityId ? "decision" : "organization");
        if (saved.opportunityId) setOpportunityId(saved.opportunityId);
      }
      setSelection(null); setConnectionError(null); setNotice("Relation mise à jour.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Enregistrement impossible."); }
    finally { setBusy(false); }
  }
  async function deleteSelected() {
    if (!selection?.id || (selection.type === "node" && (currentNode?.kind === "person" || currentNode?.isRoot))) return;
    if (!window.confirm(selection.type === "relation" ? "Supprimer ce lien de la cartographie ?" : "Supprimer ce nœud ? Les liens, preuves et questions associés doivent d’abord être retirés. Les fiches contacts et activités CRM sont conservées.")) return;
    setBusy(true); setError(null);
    try { await apiJson(`${base(accountId)}/${selection.type === "node" ? "nodes" : "relations"}/${encodeURIComponent(selection.id)}`, { method: "DELETE" }); setSelection(null); await loadMap(); setNotice("Élément retiré de la carte."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Suppression impossible."); }
    finally { setBusy(false); }
  }
  async function createOpportunity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!newOpportunity.trim()) return;
    setBusy(true); setError(null);
    try { const result = await apiJson<{ opportunity: MapOpportunity }>(`${base(accountId)}/opportunities`, jsonInit("POST", { name: newOpportunity.trim() })); setNewOpportunity(""); await loadMap(); setView("decision"); setOpportunityId(result.opportunity.id); setNotice("Contexte d’opportunité créé."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Création impossible."); }
    finally { setBusy(false); }
  }
  async function addSource() {
    if (!sourceLabel.trim()) { setError("Donnez un nom à la source."); return; }
    setBusy(true); setError(null);
    try {
      const result = await apiJson<{ source: { id: string } }>(`${base(accountId)}/sources`, jsonInit("POST", { kind: sourceKind, label: sourceLabel.trim(), reference: sourceReference.trim() || null, excerpt: sourceExcerpt.trim() || null }));
      await loadMap(); setNewSourceOpen(false); setSourceLabel(""); setSourceReference(""); setSourceExcerpt("");
      setRelationDraft((draft) => ({ ...draft, sourceId: result.source.id })); setRoleSourceId(result.source.id); setNotice("Source ajoutée. Associez-la à l’information concernée.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Source non enregistrée."); }
    finally { setBusy(false); }
  }
  async function addStakeholderRole(asConfirmedChampion = false) {
    if (!currentNode || currentNode.kind !== "person" || !opportunityId) return;
    const status = asConfirmedChampion ? "confirmed" : roleStatus;
    if ((status === "observed" || status === "confirmed") && !roleSourceId) { setError("Ce rôle demande une source consultable."); return; }
    if ((status === "hypothesis" || asConfirmedChampion) && !roleNotes.trim()) { setError(asConfirmedChampion ? "Documentez la vérification du soutien actif dans les notes." : "Expliquez la piste à vérifier dans les notes."); return; }
    if (asConfirmedChampion) {
      const source = map?.sources.find((item) => item.id === roleSourceId);
      if (!source || !(source.reference || source.locator || source.excerpt)) { setError("La source du champion doit inclure une référence, un extrait ou un repère consultable."); return; }
    }
    setBusy(true); setError(null);
    try {
      await apiJson(`${base(accountId)}/stakeholders`, jsonInit("POST", { opportunityId, personNodeId: currentNode.id, role: asConfirmedChampion ? "confirmed_champion" : roleDraft, evidenceStatus: status, sourceId: roleSourceId || null, notes: roleNotes.trim() }));
      await loadMap(); setRoleNotes(""); setRoleDraft("unknown"); setNotice("Rôle enregistré pour cette opportunité.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Rôle non enregistré."); }
    finally { setBusy(false); }
  }
  async function confirmEvidence(resource: "relations" | "claims" | "stakeholders", id: string, version: number, existingSourceId: string | null, existingText: string) {
    const sourceId = confirmationSourceId || existingSourceId;
    const source = map?.sources.find((item) => item.id === sourceId);
    if (!source) { setError("Choisissez une source pour confirmer cette information."); return; }
    if (!confirmationNote.trim()) { setError("Indiquez ce que vous avez vérifié dans la note de validation."); return; }
    const trace = source.reference || source.locator || source.excerpt || (resource !== "stakeholders" && (confirmationLocator.trim() || confirmationExcerpt.trim()));
    if (!trace) { setError("Ajoutez une référence, un extrait ou un repère consultable à la source."); return; }
    const validationText = `${existingText ? `${existingText.trim()}\n` : ""}Validation : ${confirmationNote.trim()}`;
    const detail = resource === "relations" ? { notes: validationText, locator: confirmationLocator.trim() || null, excerpt: confirmationExcerpt.trim() || null }
      : resource === "claims" ? { justification: validationText, locator: confirmationLocator.trim() || null, excerpt: confirmationExcerpt.trim() || null }
        : { notes: validationText };
    setBusy(true); setError(null);
    try {
      await apiJson(`${base(accountId)}/${resource}/${encodeURIComponent(id)}`, jsonInit("PATCH", { expectedVersion: version, revalidate: true, evidenceStatus: "confirmed", sourceId, ...detail }));
      await loadMap(); if (resource === "relations") setSelection(null);
      setConfirmationNote(""); setNotice("Information confirmée avec source et validation traçable.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Confirmation impossible."); }
    finally { setBusy(false); }
  }
  async function markClaimObsolete(claim: MapData["claims"][number]) {
    if (!window.confirm(`Marquer « ${claim.field} » comme obsolète ? La valeur et sa source resteront consultables dans la fiche.`)) return;
    setBusy(true); setError(null);
    try {
      await apiJson(`${base(accountId)}/claims/${encodeURIComponent(claim.id)}`, jsonInit("PATCH", { expectedVersion: claim.version, evidenceStatus: "obsolete" }));
      await loadMap(); setNotice("Information marquée obsolète ; sa source reste visible.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Mise à jour impossible."); }
    finally { setBusy(false); }
  }
  async function createQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!newQuestion.trim()) return;
    setBusy(true); setError(null);
    try {
      await apiJson(`${base(accountId)}/questions`, jsonInit("POST", { question: newQuestion.trim(), nextAction: newQuestionAction.trim() || null, opportunityId: view === "decision" ? opportunityId : null, subjectNodeId: currentNode?.id || null }));
      setNewQuestion(""); setNewQuestionAction(""); await loadMap(); setNotice("Question ajoutée.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Question non enregistrée."); }
    finally { setBusy(false); }
  }
  async function answerQuestion(id: string, version: number) {
    setBusy(true); setError(null);
    try { await apiJson(`${base(accountId)}/questions/${encodeURIComponent(id)}`, jsonInit("PATCH", { expectedVersion: version, status: "answered" })); await loadMap(); setNotice("Question marquée comme vérifiée."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Mise à jour impossible."); }
    finally { setBusy(false); }
  }
  async function promoteQuestionAction(question: MapData["questions"][number]) {
    if (!prospect) { setError("La fiche CRM du compte doit être chargée avant de planifier une action."); return; }
    const label = question.nextAction || question.question;
    if (prospect.qualification.nextActionLabel && prospect.qualification.nextActionLabel !== label && !window.confirm(`Remplacer la prochaine action actuelle « ${prospect.qualification.nextActionLabel} » par « ${label} » ?`)) return;
    const due = nextActionDate ? new Date(nextActionDate) : null;
    if (due && Number.isNaN(due.getTime())) { setError("Échéance invalide."); return; }
    setBusy(true); setError(null);
    try {
      await apiJson(`/api/prospect-factory/crm/prospects/${encodeURIComponent(accountId)}`, jsonInit("PATCH", { expectedVersion: prospect.version, qualification: { nextActionLabel: label, nextActionAt: due ? due.toISOString() : null } }));
      await loadMap(); setNotice("Prochaine action enregistrée dans le suivi commercial.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Prochaine action non enregistrée."); }
    finally { setBusy(false); }
  }
  async function saveLayout(nextPositions: Array<{ nodeId: string; x: number; y: number }>, viewport?: { x: number; y: number; zoom: number }) {
    try { await apiJson(`${base(accountId)}/layout`, jsonInit("POST", { view, opportunityId: view === "decision" ? opportunityId : null, positions: nextPositions, ...(viewport ? { viewport } : {}) })); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Disposition non sauvegardée."); }
  }
  function movedNode(id: string, position: { x: number; y: number }) {
    setPositions((current) => ({ ...current, [`${view}:${opportunityId || ""}:${id}`]: position }));
    void saveLayout([{ nodeId: id, ...position }]);
  }
  function movedViewport(viewport: { x: number; y: number; zoom: number }) {
    if (viewportTimer.current) clearTimeout(viewportTimer.current);
    viewportTimer.current = setTimeout(() => { void saveLayout([], viewport); }, 700);
  }
  function confirmationFields() {
    return <div className={styles.confirmationBox}>
      <strong>Validation après vérification</strong>
      <p>Choisissez une source consultable. La confirmation enregistrera votre session et la date.</p>
      <label>Source de validation<select value={confirmationSourceId} onChange={(event) => setConfirmationSourceId(event.target.value)}><option value="">Source déjà liée, si elle existe</option>{map?.sources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}</select></label>
      <label>Repère dans la source<input value={confirmationLocator} onChange={(event) => setConfirmationLocator(event.target.value)} placeholder="Ex. page 2, ligne 4" /></label>
      <label>Extrait justificatif<input value={confirmationExcerpt} onChange={(event) => setConfirmationExcerpt(event.target.value)} placeholder="Court extrait réellement lisible" /></label>
      <label>Note de vérification<textarea value={confirmationNote} onChange={(event) => setConfirmationNote(event.target.value)} rows={3} placeholder="Comment et quand cette information a été vérifiée" /></label>
    </div>;
  }

  async function previewImport() {
    setBusy(true); setError(null);
    try {
      const document = JSON.parse(importText) as Record<string, unknown>;
      const result = await apiJson<{ preview: ImportPreview }>(`${base(accountId)}/imports/preview`, jsonInit("POST", document));
      setPreview(result.preview); setAcceptedIds(new Set(result.preview.items.filter((item) => item.defaultAccepted).map((item) => item.id))); setContactResolutions({});
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Prévisualisation impossible."); }
    finally { setBusy(false); }
  }
  async function applyImport() {
    if (!preview) return;
    const acceptedDuplicates = preview.items.filter((item) => item.kind === "person" && item.action === "possible_duplicate" && acceptedIds.has(item.id));
    const unresolvedDuplicates = acceptedDuplicates.filter((item) => {
      const choice = contactResolutions[item.id.replace(/^person:/, "")];
      return !choice || (choice === createDistinctChoice && item.matchBasis !== "name");
    });
    if (unresolvedDuplicates.length) { setError("Pour chaque personne potentiellement en doublon acceptée, choisissez un contact existant ou, seulement pour une homonymie, créez explicitement une personne distincte."); return; }
    const distinctCount = acceptedDuplicates.filter((item) => contactResolutions[item.id.replace(/^person:/, "")] === createDistinctChoice).length;
    if (distinctCount && !window.confirm(`Créer ${distinctCount} contact(s) distinct(s) malgré un nom identique ? Aucun contact CRM existant ne sera fusionné.`)) return;
    setBusy(true); setError(null);
    try {
      const document = JSON.parse(importText) as Record<string, unknown>;
      const resolvedContacts = Object.fromEntries(Object.entries(contactResolutions).filter(([, value]) => value && value !== createDistinctChoice));
      const result = await apiJson<{ result: { created: number; updated: number; rejected: number; idempotent: boolean } }>(`${base(accountId)}/imports/apply`, jsonInit("POST", { document, fingerprint: preview.fingerprint, acceptedIds: [...acceptedIds], contactResolutions: resolvedContacts }));
      setShowImport(false); setPreview(null); setImportText(""); await loadMap();
      setNotice(result.result.idempotent ? "Ce lot avait déjà été appliqué ; aucun doublon créé." : `Import appliqué : ${result.result.created} création(s), ${result.result.updated} enrichissement(s).`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Import impossible."); }
    finally { setBusy(false); }
  }

  if (loading && !map) return <div className={styles.loading} role="status">{!embedded ? <Link href={backHref as Route} className={styles.backLink}><ArrowLeft size={15} /> Retour au suivi commercial</Link> : null}<RefreshCw size={19} className={styles.spin} /> Chargement de la cartographie…</div>;
  if (!map) return <div className={styles.loading}>{!embedded ? <Link href={backHref as Route} className={styles.backLink}><ArrowLeft size={15} /> Retour au suivi commercial</Link> : null}<CircleAlert size={19} /> {error || "Cartographie indisponible."} <button type="button" onClick={() => { setLoading(true); void loadMap(); }}>Réessayer</button></div>;

  return <section className={`${styles.root} ${embedded ? styles.embedded : ""}`} aria-label={`Cartographie de ${map.accountName}`}>
    <header className={styles.header}>
      <div className={styles.heading}>
        {!embedded ? <Link href={backHref as Route} className={styles.backLink}><ArrowLeft size={15} /> Retour au suivi commercial</Link> : null}
        <span className={styles.eyebrow}><Network size={14} /> Cartographie du compte</span>
        <h1>{map.accountName}</h1>
        <p>Personnes, unités et liens · {map.nodes.length} nœud{map.nodes.length > 1 ? "s" : ""} · {map.relations.length} lien{map.relations.length > 1 ? "s" : ""}</p>
      </div>
      <div className={styles.headerActions}>
        {embedded ? <ContextualMapLink accountId={accountId} sourceView="map" className={styles.button}><ExternalLink size={15} /> Plein écran</ContextualMapLink> : null}
        <button type="button" className={styles.button} onClick={() => { setLoading(true); void loadMap(); }} disabled={loading}><RefreshCw size={15} /> Actualiser</button>
        <button type="button" className={styles.primaryButton} onClick={() => { setShowImport(true); setPreview(null); setError(null); }}><FileJson2 size={15} /> Importer un JSON</button>
      </div>
    </header>

    {error ? <div className={styles.alert} role="alert"><CircleAlert size={16} /> {error}<button type="button" aria-label="Masquer l’erreur" onClick={() => setError(null)}><X size={15} /></button></div> : null}
    {notice ? <div className={styles.notice} role="status">{notice}<button type="button" aria-label="Masquer la confirmation" onClick={() => setNotice(null)}><X size={15} /></button></div> : null}

    <div className={styles.contextBar}>
      <div className={styles.segmented} role="group" aria-label="Type de cartographie">
        <button type="button" aria-pressed={view === "organization"} onClick={() => switchMapView("organization")}>Organisation</button>
        <button type="button" aria-pressed={view === "decision"} onClick={() => switchMapView("decision")}>Décision commerciale</button>
      </div>
      {view === "decision" ? <div className={styles.opportunityPicker}>
        <label htmlFor={`map-opportunity-${accountId}`}>Opportunité</label>
        <select id={`map-opportunity-${accountId}`} value={opportunityId || ""} onChange={(event) => switchOpportunity(event.target.value || null)}>
          <option value="">{map.opportunities.length ? "Choisir une opportunité" : "À créer"}</option>
          {map.opportunities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </div> : null}
      {view === "decision" ? <form className={styles.opportunityCreate} onSubmit={(event) => void createOpportunity(event)}>
        <label className={styles.srOnly} htmlFor={`new-opportunity-${accountId}`}>Nom de la nouvelle opportunité</label>
        <input id={`new-opportunity-${accountId}`} value={newOpportunity} onChange={(event) => setNewOpportunity(event.target.value)} placeholder="Nouveau projet / opportunité" maxLength={160} />
        <button type="submit" disabled={busy || !newOpportunity.trim()} aria-label="Créer l’opportunité"><Plus size={16} /></button>
      </form> : null}
    </div>

      <details className={styles.summaryDetails}><summary>Synthèse du compte · {openQuestions.length} question(s) ouverte(s) · {unresolved.length} fonction(s) à identifier</summary><div className={styles.summary} aria-label="Synthèse du compte">
      <div><span>Ce que je sais</span><strong>{map.nodes.filter((node) => node.kind === "person").length} personne(s) placée(s)</strong><small>{map.relations.filter((relation) => relation.evidenceStatus === "confirmed" || relation.evidenceStatus === "observed").length} lien(s) sourcé(s)</small></div>
      <div><span>À préciser</span><strong>{openQuestions.length + map.relations.filter((relation) => relation.evidenceStatus === "hypothesis").length} point(s)</strong><small>Liens à qualifier et questions ouvertes</small></div>
      <div><span>Fonctions à identifier</span><strong>{unresolved.length}</strong><small>{unresolved.slice(0, 2).map((node) => node.name).join(" · ") || "Aucune pour l’instant"}</small></div>
      <div><span>Prochaine action</span><strong>{prospect?.qualification.nextActionLabel || openQuestions[0]?.nextAction || openQuestions[0]?.question || "À définir"}</strong><small>{prospect?.qualification.nextActionAt ? new Date(prospect.qualification.nextActionAt).toLocaleDateString("fr-FR") : prospect?.qualification.nextActionLabel ? "Échéance à définir" : "À confirmer dans le suivi commercial"}</small></div>
    </div></details>

    <div className={styles.toolbar}>
      <label className={styles.search}><Search size={16} /><span className={styles.srOnly}>Rechercher dans la carte</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher une personne, une fonction, un service…" /></label>
      <label><Filter size={14} /><span className={styles.srOnly}>Type de nœud</span><select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)}><option value="">Tous les nœuds</option>{Object.entries(kindLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
      <label><span className={styles.srOnly}>Fiabilité des liens</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="">Tous les liens</option>{statusOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <div className={styles.segmented} role="group" aria-label="Présentation de la cartographie"><button type="button" aria-pressed={presentation === "graph"} onClick={() => setPresentationChoice("graph")}>Graphe</button><button type="button" aria-pressed={presentation === "table"} onClick={() => setPresentationChoice("table")}>Tableau</button></div>
    </div>

    <div className={styles.workArea}>
      <div className={styles.mainColumn}>
        <div className={styles.addBar}>
          <button type="button" onClick={() => startNode("person")}><Plus size={14} /> Personne</button>
          <button type="button" onClick={() => startNode("unit")}><Plus size={14} /> Unité</button>
          <button type="button" onClick={() => startNode("role_slot")}><Plus size={14} /> Fonction à identifier</button>
          <button type="button" onClick={() => startRelation()} disabled={map.nodes.length < 2 || (view === "decision" && !opportunityId)}><Plus size={14} /> Lien</button>
        </div>
        {connectionError ? <div className={styles.alert} role="alert"><CircleAlert size={16} /> {connectionError}<button type="button" aria-label="Masquer cette erreur" onClick={() => setConnectionError(null)}><X size={15} /></button></div> : null}
        {presentation === "graph" ? <>
          <div className={styles.canvasFrame}>
            {view === "decision" && !opportunityId ? <div className={styles.canvasEmpty}><CircleHelp size={24} /><strong>Choisissez ou créez une opportunité</strong><p>Les rôles et relations de décision sont propres au projet sélectionné.</p></div> : map.nodes.length ? <Canvas key={`${view}:${opportunityId || ""}:${canvasNodes.map((node) => `${node.id}:${node.name}:${node.title || ""}`).join("|")}`} nodes={canvasNodes} edges={canvasEdges} focusNodeId={searchedNodeId} selectedNodeId={selection?.type === "node" ? selection.id : null} initialViewport={contextViewport || (compactMap ? { x: 20, y: 20, zoom: .75 } : null)} onSelectNode={(id) => { const node = map.nodes.find((item) => item.id === id); if (node) chooseNode(node); }} onSelectEdge={(id) => { if (id.startsWith("saving:")) return; const edge = map.relations.find((item) => item.id === id); if (edge) chooseRelation(edge); }} onConnect={(connection) => { if (connection.source && connection.target) void createLink(connection.source, connection.target); }} onMoveNode={movedNode} onViewportChange={movedViewport} /> : <div className={styles.canvasEmpty}><Network size={25} /><strong>Votre carte commence ici</strong><p>Ajoutez un contact CRM, une unité ou une fonction à identifier. Aucun lien hiérarchique n’est créé automatiquement.</p></div>}
          </div>
          <div className={styles.legend} aria-label="Légende des liens"><strong>Légende</strong><span><i className={styles.legendSolid} /> Confirmé</span><span><i className={styles.legendObserved} /> Observé dans une source</span><span><i className={styles.legendDashed} /> Hypothèse ou lien à qualifier</span><span><i className={styles.legendDotted} /> Contradictoire / obsolète</span><small>La position des cartes n’est pas une preuve de hiérarchie.</small></div>
        </> : <div className={styles.tableWrap}>
          <table><caption>Nœuds de la cartographie</caption><thead><tr><th scope="col">Élément</th><th scope="col">Type</th><th scope="col">Détail</th><th scope="col">Relations visibles</th></tr></thead><tbody>
            {visibleNodes.map((node) => <tr key={node.id}><td><button type="button" onClick={() => chooseNode(node)}>{node.name}</button></td><td>{kindLabels[node.kind]}{node.unitKind ? ` · ${unitKinds.find(([key]) => key === node.unitKind)?.[1] || node.unitKind}` : ""}</td><td>{node.kind === "role_slot" && node.resolvedContactId ? `Contact lié : ${map.availableContacts.find((contact) => contact.id === node.resolvedContactId)?.name || "fiche CRM"}` : node.title || node.notes || "—"}</td><td>{visibleRelations.filter((relation) => relation.fromNodeId === node.id || relation.toNodeId === node.id).map((relation) => <button key={relation.id} type="button" onClick={() => chooseRelation(relation)}>{relation.kind === "unqualified" ? "Lien à qualifier" : `${knownKind(relation.kind, map.nodes.find((item) => item.id === relation.fromNodeId)?.kind)} · ${relationStatusLabel(relation)}`}</button>)}</td></tr>)}
            {!visibleNodes.length ? <tr><td colSpan={4}>Aucun nœud dans ce filtre.</td></tr> : null}
          </tbody></table>
          <table><caption>Relations dirigées</caption><thead><tr><th scope="col">De</th><th scope="col">Relation</th><th scope="col">Vers</th><th scope="col">Fiabilité</th><th scope="col">Source</th></tr></thead><tbody>
            {visibleRelations.map((relation) => <tr key={relation.id}><td>{map.nodes.find((node) => node.id === relation.fromNodeId)?.name || "—"}</td><td><button type="button" onClick={() => chooseRelation(relation)}>{relation.label || knownKind(relation.kind, map.nodes.find((node) => node.id === relation.fromNodeId)?.kind)}</button></td><td>{map.nodes.find((node) => node.id === relation.toNodeId)?.name || "—"}</td><td>{relationStatusLabel(relation)}</td><td>{map.sources.find((source) => source.id === relation.sourceId)?.label || "À documenter"}</td></tr>)}
            {!visibleRelations.length ? <tr><td colSpan={5}>Aucune relation dans ce filtre.</td></tr> : null}
          </tbody></table>
        </div>}
        {prospect?.legacyContact ? <details className={styles.available} open><summary>Contact historique à rattacher</summary><p>Cette personne est enregistrée dans les anciens champs de la fiche société. Elle reste visible ici jusqu’à son rattachement aux contacts CRM.</p><div><button type="button" disabled={busy} onClick={() => void attachLegacyContact()}><UserRound size={14} /> {prospect.legacyContact.name}<small>{prospect.legacyContact.title || "Poste à préciser"}</small><Plus size={13} /></button></div></details> : null}
        {unusedContacts.length ? <details className={styles.available}><summary>Contacts CRM à placer ({unusedContacts.length})</summary><p>Un contact ajouté ici reste lié à sa fiche et à ses activités existantes.</p><div>{unusedContacts.map((contact) => <button key={contact.id} type="button" disabled={busy} onClick={() => void addExistingContact(contact.id)}><UserRound size={14} /> {contact.name}<small>{contact.verifiedTitle || contact.inputTitle || "Poste à préciser"}</small><Plus size={13} /></button>)}</div></details> : null}
        <details className={styles.questions}><summary>Questions ouvertes ({openQuestions.length})</summary><label className={styles.actionDue}>Échéance facultative pour une action du suivi<input type="datetime-local" value={nextActionDate} onChange={(event) => setNextActionDate(event.target.value)} /></label><ul>{openQuestions.map((item) => <li key={item.id}><span>{item.question}{item.nextAction ? <small>Prochaine piste : {item.nextAction}</small> : null}</span><div><button type="button" onClick={() => void promoteQuestionAction(item)} disabled={busy || !prospect}>Définir comme prochaine action du suivi</button><button type="button" onClick={() => void answerQuestion(item.id, item.version)} disabled={busy}>Vérifiée</button></div></li>)}{!openQuestions.length ? <li>Aucune question pour l’instant.</li> : null}</ul><form onSubmit={(event) => void createQuestion(event)}><label>Nouvelle question<input value={newQuestion} onChange={(event) => setNewQuestion(event.target.value)} placeholder="Que reste-t-il à vérifier ?" maxLength={2000} /></label><label>Prochaine piste, facultative<input value={newQuestionAction} onChange={(event) => setNewQuestionAction(event.target.value)} placeholder="Ex. demander au RAF" maxLength={2000} /></label><button type="submit" disabled={busy || !newQuestion.trim()}><Plus size={14} /> Ajouter</button></form></details>
      </div>

      <aside ref={inspectorRef} tabIndex={-1} className={`${styles.inspector} ${!selection ? styles.inspectorIdle : ""}`} aria-label="Éditeur de la cartographie">
        {!selection ? <div className={styles.inspectorEmpty}><Network size={24} /><h2>Explorer la carte</h2><p>Sélectionnez une personne, une unité ou un lien pour voir ses détails. Tirez d’une poignée vers une autre carte pour ajouter un lien directement ; cliquez dessus quand vous souhaitez préciser sa nature.</p><small>Les informations inconnues peuvent rester inconnues.</small></div> : selection.type === "node" ? <form onSubmit={(event) => void saveNode(event)}>
          <div className={styles.inspectorHeader}><span>{selection.id ? "Modifier le nœud" : "Ajouter un nœud"}</span><button type="button" onClick={() => setSelection(null)} aria-label="Fermer l’éditeur"><X size={17} /></button></div>
          <h2>{kindLabels[nodeDraft.kind]}</h2>
          {nodeDraft.kind === "person" && !selection.id ? <label>Contact CRM existant<select value={nodeDraft.contactId} onChange={(event) => { const contact = map.availableContacts.find((item) => item.id === event.target.value); setNodeDraft((draft) => ({ ...draft, contactId: event.target.value, name: contact?.name || draft.name, title: contact?.verifiedTitle || contact?.inputTitle || draft.title })); }}><option value="">Créer un nouveau contact</option>{unusedContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></label> : null}
          <label>{nodeDraft.kind === "role_slot" ? "Fonction recherchée" : "Nom"}<input value={nodeDraft.name} onChange={(event) => setNodeDraft((draft) => ({ ...draft, name: event.target.value }))} required={!nodeDraft.contactId} maxLength={180} readOnly={Boolean(selection.id && nodeDraft.kind === "person")} disabled={nodeDraft.kind === "person" && !selection.id && Boolean(nodeDraft.contactId)} /></label>
          {nodeDraft.kind === "unit" ? <label>Catégorie<select value={nodeDraft.unitKind} onChange={(event) => setNodeDraft((draft) => ({ ...draft, unitKind: event.target.value }))}>{unitKinds.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label> : null}
          {nodeDraft.kind !== "role_slot" ? <label>Poste ou précision<input value={nodeDraft.title} onChange={(event) => setNodeDraft((draft) => ({ ...draft, title: event.target.value }))} maxLength={180} readOnly={Boolean(selection.id && nodeDraft.kind === "person")} /></label> : null}
          {nodeDraft.kind === "role_slot" && selection.id ? <label>Résoudre avec un contact<select value={nodeDraft.resolvedContactId} onChange={(event) => setNodeDraft((draft) => ({ ...draft, resolvedContactId: event.target.value }))}><option value="">Toujours à identifier</option>{map.availableContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></label> : null}
          <label>Notes<textarea value={nodeDraft.notes} onChange={(event) => setNodeDraft((draft) => ({ ...draft, notes: event.target.value }))} rows={5} placeholder="Informations utiles et points à vérifier" /></label>
          {currentNode ? <div className={styles.evidenceBox}>
            <strong>Fiche liée</strong>
            <p>{currentNode.contactId ? "Identité et poste synchronisés avec la fiche contact CRM. Modifiez-les dans le suivi commercial." : currentNode.kind === "role_slot" ? "Fonction recherchée, exclue des statistiques de contacts." : "Unité organisationnelle."}</p>
            {map.claims.filter((claim) => claim.subjectNodeId === currentNode.id).map((claim) => <div className={styles.evidenceItem} key={claim.id}>
              <strong>{claim.field}</strong><p>{claimText(claim.value)}</p>
              <small>{statusLabels[claim.evidenceStatus]} · {map.sources.find((source) => source.id === claim.sourceId)?.label || "Source à vérifier"}{claim.validatedBy ? claim.evidenceStatus === "obsolete" ? ` · validation antérieure par ${claim.validatedBy}` : ` · validé par ${claim.validatedBy}` : ""}</small>
              {claim.excerpt ? <small>« {claim.excerpt} »</small> : null}
              {claim.evidenceStatus !== "confirmed" ? <button type="button" className={styles.button} onClick={() => void confirmEvidence("claims", claim.id, claim.version, claim.sourceId, claim.justification || "")} disabled={busy}>Confirmer après vérification</button> : <button type="button" className={styles.button} onClick={() => void markClaimObsolete(claim)} disabled={busy}>Marquer obsolète</button>}
            </div>)}
          </div> : <p className={styles.hint}>Une personne réelle crée ou relie une fiche contact CRM. Une fonction recherchée n’en crée pas.</p>}
          {currentNode?.kind === "person" && opportunityId && view === "decision" ? <div className={styles.roleBox}>
            <strong>Rôles dans « {selectedOpportunity?.name} »</strong>
            {map.stakeholderRoles.filter((item) => item.personNodeId === currentNode.id && item.opportunityId === opportunityId).map((item) => <div className={styles.evidenceItem} key={item.id}><p>{stakeholderLabels[item.role]} · {statusLabels[item.evidenceStatus]}</p><small>{map.sources.find((source) => source.id === item.sourceId)?.label || "Source à vérifier"}{item.validatedBy ? ` · validé par ${item.validatedBy}` : ""}</small>{item.evidenceStatus !== "confirmed" ? <button type="button" className={styles.button} onClick={() => void confirmEvidence("stakeholders", item.id, item.version, item.sourceId, item.notes)} disabled={busy}>Confirmer après vérification</button> : null}</div>)}
            <label>Ajouter un rôle<select value={roleDraft} onChange={(event) => setRoleDraft(event.target.value as typeof roleDraft)}>{MAP_STAKEHOLDER_ROLES.filter((role) => role !== "confirmed_champion").map((role) => <option key={role} value={role}>{stakeholderLabels[role]}</option>)}</select></label>
            <label>Statut<select value={roleStatus} onChange={(event) => setRoleStatus(event.target.value as typeof roleStatus)}><option value="hypothesis">Hypothèse à vérifier</option><option value="observed">Observé dans une source</option></select></label>
            <label>Source<select value={roleSourceId} onChange={(event) => setRoleSourceId(event.target.value)}><option value="">Aucune</option>{map.sources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}</select></label>
            <button type="button" className={styles.button} onClick={() => setNewSourceOpen((open) => !open)}><Plus size={14} /> Nouvelle source</button>
            {newSourceOpen ? <div className={styles.sourceBox}><label>Type<select value={sourceKind} onChange={(event) => setSourceKind(event.target.value)}><option value="meeting_note">Note de rendez-vous</option><option value="screenshot">Capture fournie</option><option value="document">Document</option><option value="web_page">Page web</option><option value="crm_note">Note CRM</option><option value="other">Autre</option></select></label><label>Libellé<input value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} maxLength={240} /></label><label>Référence privée ou URL connue<input value={sourceReference} onChange={(event) => setSourceReference(event.target.value)} maxLength={2000} /></label><label>Extrait lisible<textarea value={sourceExcerpt} onChange={(event) => setSourceExcerpt(event.target.value)} rows={3} /></label><button type="button" className={styles.button} onClick={() => void addSource()} disabled={busy}>Enregistrer la source</button></div> : null}
            <label>Justification ou notes<textarea value={roleNotes} onChange={(event) => setRoleNotes(event.target.value)} rows={3} placeholder="Ce qui étaye ce rôle et ce qui reste à vérifier" /></label>
            <button type="button" className={styles.button} onClick={() => void addStakeholderRole()} disabled={busy}><Plus size={14} /> Ajouter ce rôle</button>
            <button type="button" className={styles.button} onClick={() => void addStakeholderRole(true)} disabled={busy || !roleSourceId}>Confirmer un champion après vérification</button>
            <small>Réservez « champion confirmé » à un soutien actif vérifié, avec source et note.</small>
          </div> : null}
          {currentNode && (map.claims.some((claim) => claim.subjectNodeId === currentNode.id && claim.evidenceStatus !== "confirmed") || map.stakeholderRoles.some((role) => role.personNodeId === currentNode.id && role.opportunityId === opportunityId && role.evidenceStatus !== "confirmed")) ? confirmationFields() : null}
          <div className={styles.formActions}><button type="submit" className={styles.primaryButton} disabled={busy}><Save size={14} /> Enregistrer</button>{selection.id && currentNode?.kind !== "person" && !currentNode?.isRoot ? <button type="button" className={styles.dangerButton} onClick={() => void deleteSelected()} disabled={busy}><Trash2 size={14} /> Supprimer</button> : null}</div>
        </form> : !selection.id ? <form onSubmit={(event) => { event.preventDefault(); if (relationDraft.fromNodeId && relationDraft.toNodeId) { void createLink(relationDraft.fromNodeId, relationDraft.toNodeId); setSelection(null); } }}>
          <div className={styles.inspectorHeader}><span>Créer un lien</span><button type="button" onClick={() => setSelection(null)} aria-label="Fermer l’éditeur"><X size={17} /></button></div>
          <h2>Relier deux éléments</h2>
          <p className={styles.hint}>Le lien apparaît tout de suite. Sa nature et ses sources peuvent être ajoutées plus tard en cliquant dessus.</p>
          <label>De<select value={relationDraft.fromNodeId} onChange={(event) => updateRelationEndpoint("fromNodeId", event.target.value)} required><option value="">Choisir un nœud</option>{map.nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
          <label>Vers<select value={relationDraft.toNodeId} onChange={(event) => updateRelationEndpoint("toNodeId", event.target.value)} required><option value="">Choisir un nœud</option>{map.nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
          {relationDraft.fromNodeId && relationDraft.toNodeId ? <button type="button" className={styles.button} onClick={reverseRelation}>Inverser le sens</button> : null}
          <div className={styles.formActions}><button type="submit" className={styles.primaryButton} disabled={!relationDraft.fromNodeId || !relationDraft.toNodeId || relationDraft.fromNodeId === relationDraft.toNodeId}><Plus size={14} /> Créer le lien</button></div>
        </form> : <form noValidate onSubmit={(event) => void saveRelation(event)}>
          <div className={styles.inspectorHeader}><span>Modifier le lien</span><button type="button" onClick={() => setSelection(null)} aria-label="Fermer l’éditeur"><X size={17} /></button></div>
          <h2>{relationDraft.kind === "unqualified" ? "Lien à qualifier" : "Relation"}</h2>
          {relationDraft.kind === "unqualified" ? <p className={styles.hint}>Ce lien indique seulement que deux éléments sont reliés sur votre carte. Il n’affirme aucune affiliation ni hiérarchie.</p> : null}
          {error ? <div className={styles.alert} role="alert"><CircleAlert size={16} /> {error}</div> : null}
          <label>De<select value={relationDraft.fromNodeId} onChange={(event) => updateRelationEndpoint("fromNodeId", event.target.value)} required><option value="">Choisir un nœud</option>{map.nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
          <label>Vers<select value={relationDraft.toNodeId} onChange={(event) => updateRelationEndpoint("toNodeId", event.target.value)} required><option value="">Choisir un nœud</option>{map.nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
          {relationDraft.fromNodeId && relationDraft.toNodeId ? <button type="button" className={styles.button} onClick={reverseRelation}>Inverser le sens</button> : null}
          {relationFromKind === "unit" && (relationToKind === "person" || relationToKind === "role_slot") ? <p className={styles.hint}>Pour « travaille dans », inversez le sens : la personne ou la fonction doit être dans « De ».</p> : null}
          <label>Nature<select value={relationDraft.kind} onChange={(event) => setRelationDraft((draft) => ({ ...draft, kind: event.target.value }))} required>{relationKindChoices.map((kind) => <option key={kind} value={kind}>{knownKind(kind, relationFromKind)}</option>)}</select></label>
          <label>Libellé sur le graphe<input value={relationDraft.label} onChange={(event) => setRelationDraft((draft) => ({ ...draft, label: event.target.value }))} placeholder={relationDraft.kind ? knownKind(relationDraft.kind, relationFromKind) : "Choisir d’abord la nature"} maxLength={100} /></label>
          <label>Fiabilité<select value={relationDraft.evidenceStatus} onChange={(event) => setRelationDraft((draft) => ({ ...draft, evidenceStatus: event.target.value as EvidenceStatus }))}>{statusOptions.filter(([key]) => key !== "confirmed" || currentRelation?.evidenceStatus === "confirmed").map(([key, label]) => <option key={key} value={key}>{relationDraft.kind === "unqualified" && key === "hypothesis" ? "À qualifier" : label}</option>)}</select></label>
          <label>Source<select value={relationDraft.sourceId} onChange={(event) => setRelationDraft((draft) => ({ ...draft, sourceId: event.target.value }))}><option value="">Aucune source</option>{map.sources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}</select></label>
          <p className={styles.hint}>Pour « Observé » ou « Confirmé », la source doit contenir une référence, un extrait ou un repère consultable.</p>
          <div className={styles.sourceBox}><button type="button" className={styles.button} onClick={() => setNewSourceOpen((open) => !open)}><Plus size={14} /> Ajouter une source</button>{newSourceOpen ? <div><label>Type<select value={sourceKind} onChange={(event) => setSourceKind(event.target.value)}><option value="meeting_note">Note de rendez-vous</option><option value="screenshot">Capture fournie</option><option value="document">Document</option><option value="web_page">Page web</option><option value="crm_note">Note CRM</option><option value="other">Autre</option></select></label><label>Libellé<input value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} maxLength={240} /></label><label>Référence privée ou URL connue<input value={sourceReference} onChange={(event) => setSourceReference(event.target.value)} maxLength={2000} /></label><label>Extrait lisible<textarea value={sourceExcerpt} onChange={(event) => setSourceExcerpt(event.target.value)} rows={3} /></label><button type="button" className={styles.button} onClick={() => void addSource()} disabled={busy}>Enregistrer la source</button></div> : null}</div>
          <label>Contexte<select value={relationDraft.opportunityId} onChange={(event) => setRelationDraft((draft) => ({ ...draft, opportunityId: event.target.value }))}><option value="">Organisation du compte</option>{map.opportunities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Repère dans la source<input value={relationDraft.locator} onChange={(event) => setRelationDraft((draft) => ({ ...draft, locator: event.target.value }))} placeholder="Page, zone ou ligne consultable" /></label>
          <label>Extrait justificatif<input value={relationDraft.excerpt} onChange={(event) => setRelationDraft((draft) => ({ ...draft, excerpt: event.target.value }))} placeholder="Texte réellement lisible" /></label>
          {relationDraft.evidenceStatus === "hypothesis" ? <><label>Pourquoi cette hypothèse ? (facultatif)<textarea value={relationDraft.justification} onChange={(event) => setRelationDraft((draft) => ({ ...draft, justification: event.target.value }))} rows={3} /></label><label>Question de vérification (facultatif)<input value={relationDraft.verificationQuestion} onChange={(event) => setRelationDraft((draft) => ({ ...draft, verificationQuestion: event.target.value }))} /></label></> : null}
          <label>Notes<textarea value={relationDraft.notes} onChange={(event) => setRelationDraft((draft) => ({ ...draft, notes: event.target.value }))} rows={4} /></label>
          {currentRelation?.sourceId ? <div className={styles.evidenceBox}><strong>Preuve liée</strong><p>{map.sources.find((item) => item.id === currentRelation.sourceId)?.label || currentRelation.sourceId}</p>{currentRelation.excerpt ? <p>« {currentRelation.excerpt} »</p> : null}{currentRelation.validatedBy ? <p>Validé par {currentRelation.validatedBy} le {currentRelation.validatedAt ? new Date(currentRelation.validatedAt).toLocaleDateString("fr-FR") : "date inconnue"}</p> : null}</div> : null}
          {currentRelation && currentRelation.evidenceStatus !== "confirmed" ? <>{confirmationFields()}<button type="button" className={styles.button} onClick={() => void confirmEvidence("relations", currentRelation.id, currentRelation.version, currentRelation.sourceId, currentRelation.notes)} disabled={busy}>Confirmer après vérification</button></> : null}
          <p className={styles.hint}>Le sens du lien va de « De » vers « Vers ». Une relation non qualifiée peut rester telle quelle jusqu’à ce que vous disposiez de plus d’informations.</p>
          <div className={styles.formActions}><button type="submit" className={styles.primaryButton} disabled={busy}><Save size={14} /> Enregistrer</button><button type="button" className={styles.dangerButton} onClick={() => void deleteSelected()} disabled={busy}><Trash2 size={14} /> Retirer</button></div>
        </form>}
      </aside>
    </div>

    {showImport ? <div className={styles.importOverlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowImport(false); }}><section ref={importDialogRef} className={styles.importDialog} role="dialog" aria-modal="true" aria-labelledby="map-import-title">
      <header><div><span className={styles.eyebrow}><FileJson2 size={14} /> Import contrôlé</span><h2 id="map-import-title">Proposition de cartographie</h2><p>Collez le JSON `account_map.v1` préparé depuis vos captures. Les changements ne sont enregistrés qu’après votre validation.</p></div><button type="button" onClick={() => setShowImport(false)} aria-label="Fermer l’import"><X size={19} /></button></header>
      {error ? <div className={styles.alert} role="alert"><CircleAlert size={16} /> {error}</div> : null}
      <details className={styles.importHelp}><summary>Voir un exemple JSON entièrement fictif</summary><p>Remplacez les deux UUID entre chevrons et n’utilisez que des éléments réellement observés pour votre compte. Chaque source a un <code>source_id</code> ; les nouveaux objets utilisent un <code>tmp:*</code> propre au lot.</p><pre>{JSON.stringify(fictionalImportExample, null, 2)}</pre></details>
      <label className={styles.importEditor}>Document JSON<textarea value={importText} onChange={(event) => { setImportText(event.target.value); setPreview(null); }} rows={12} spellCheck={false} placeholder='{"schema_version":"account_map.v1", ...}' /></label>
      <div className={styles.importActions}><button type="button" className={styles.button} onClick={() => void previewImport()} disabled={busy || !importText.trim()}>Prévisualiser</button>{preview ? <button type="button" className={styles.primaryButton} onClick={() => void applyImport()} disabled={busy || !acceptedIds.size}>Appliquer {acceptedIds.size} proposition{acceptedIds.size > 1 ? "s" : ""}</button> : null}</div>
      {preview ? <div className={styles.preview}>
        <h3>Prévisualisation · {preview.items.length} proposition(s)</h3>
        <p>Corriger le JSON puis relancer la prévisualisation si nécessaire. Les lignes rejetées ne sont pas appliquées.</p>
        <ul>{preview.items.map((item) => {
          const resolutionKey = item.id.replace(/^person:/, "");
          const proposal = proposalForItem(parsedImportDocument, item);
          return <li key={item.id}>
            <label><input type="checkbox" checked={acceptedIds.has(item.id)} disabled={item.action === "reject"} onChange={() => setAcceptedIds((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} /><span><strong>{item.label}</strong><small>{item.action.replaceAll("_", " ")} · {item.detail}</small></span></label>
            {item.kind === "person" && item.action === "possible_duplicate" ? <select aria-label={`Décision de rapprochement pour ${item.label}`} value={contactResolutions[resolutionKey] || ""} onChange={(event) => setContactResolutions((current) => ({ ...current, [resolutionKey]: event.target.value }))}>
              <option value="">Décision requise pour accepter</option>
              {item.matchBasis === "name" ? <option value={createDistinctChoice}>Personne distincte malgré ce nom — créer</option> : null}
              {map.availableContacts.map((contact) => <option key={contact.id} value={contact.id}>Rattacher à {contact.name}</option>)}
            </select> : null}
            {proposal ? <details className={styles.previewDetail}><summary>Champs et preuve proposés</summary><pre>{JSON.stringify(proposal, null, 2)}</pre></details> : null}
          </li>;
        })}</ul>
        {preview.warnings.length ? <div className={styles.previewWarnings}><strong>Avertissements</strong>{preview.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div> : null}
        {preview.questions.length ? <div className={styles.previewWarnings}><strong>Questions ouvertes</strong>{preview.questions.map((question, index) => <p key={index}>{question}</p>)}</div> : null}
      </div> : null}
    </section></div> : null}
  </section>;
}

type MarketAccountResult = { accounts: Array<{ prospect: TrackedProspect }>; total: number };

/** Additional Suivi commercial view: choose an account, then work on its map. */
export function AccountMapWorkspace() {
  const [query, setQuery] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("crmMapQuery") ?? "");
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string; secondary: string }>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const parameters = new URLSearchParams(window.location.search);
    return parameters.get("crmMapAccount") || (parameters.get("crmView") === "map" ? parameters.get("crmAccount") : null);
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    if (query) parameters.set("crmMapQuery", query); else parameters.delete("crmMapQuery");
    if (selectedId) parameters.set("crmMapAccount", selectedId); else parameters.delete("crmMapAccount");
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${parameters}`);
  }, [query, selectedId]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: "50", offset: "0" }); if (query.trim()) params.set("query", query.trim());
        const result = await apiJson<MarketAccountResult>(`/api/prospect-factory/crm/market/accounts?${params}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        const next = result.accounts.map(({ prospect }) => ({ id: prospect.id, name: prospect.snapshot.commercialName || prospect.snapshot.companyName, secondary: [prospect.snapshot.city, prospect.snapshot.territory].filter(Boolean).join(" · ") }));
        setAccounts(next); setSelectedId((current) => current || next[0]?.id || null); setError(null);
      } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Liste des comptes indisponible."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, query ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  return <section className={styles.workspaceRoot} aria-label="Vue Cartographie du suivi commercial">
    <aside className={styles.accountRail}><div className={styles.accountRailHeader}><span className={styles.eyebrow}><Network size={14} /> Comptes CRM</span><h2>Cartographie</h2><p>Choisissez un compte pour explorer son organisation et sa décision commerciale. Les 50 premiers résultats sont affichés ; la recherche porte sur tous les comptes.</p></div><label className={styles.accountSearch}><Search size={15} /><span className={styles.srOnly}>Rechercher un compte</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un compte…" /></label>{error ? <p className={styles.railError}>{error}</p> : null}{selectedId && accounts.length > 0 && !accounts.some((item) => item.id === selectedId) ? <p className={styles.railError}>La carte ouverte reste affichée. Choisissez un résultat pour changer de compte.</p> : null}<div className={styles.accountList} aria-busy={loading}>{accounts.map((item) => <button key={item.id} type="button" aria-current={selectedId === item.id ? "page" : undefined} onClick={() => setSelectedId(item.id)}><Building2 size={15} /><span><strong>{item.name}</strong><small>{item.secondary || "Localisation à préciser"}</small></span><ArrowRight size={14} /></button>)}{!accounts.length && !loading ? <p>Aucun compte trouvé.</p> : null}</div></aside>
    <div className={styles.workspaceMap}>{selectedId ? <AccountMap key={selectedId} accountId={selectedId} embedded /> : <div className={styles.canvasEmpty}><CircleHelp size={25} /><strong>Choisissez un compte</strong><p>La carte est liée à un compte du CRM.</p></div>}</div>
  </section>;
}
