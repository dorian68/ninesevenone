"use client";

import { type FormEvent, type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Activity, ArrowLeft, ArrowRight, BadgeCheck, BarChart3, CircleAlert, Clock3, Database, Download, Filter, LogIn, LogOut, Mail, Phone, RefreshCw, Save, Search, ShieldCheck, Users, X } from "lucide-react";
import type { ProspectFactoryFacetOption, ProspectFactoryFacetsResponse, ProspectFactoryFilters, ProspectFactoryRow, ProspectFactorySearchResponse, ProspectQualitySnapshot } from "@/lib/prospect-factory-contract";
import type { ProspectActivityStats, ProspectPipelineCounts, ProspectPriority, ProspectQualificationConfidence, ProspectQualificationStatus, ProspectQualificationTier, TrackedProspect } from "@/lib/prospect-factory-crm-contract";
import { ProspectCrmDrawer } from "./prospect-crm-drawer";
import { MarketView } from "./market-view";
import { AccountMapWorkspace } from "./account-map";
import styles from "./prospect-factory.module.css";

type OverviewResponse = {
  status: { databaseSizeBytes: number | null };
  snapshot: ProspectQualitySnapshot;
};

type View = "explore" | "tracking" | "quality" | "segments";
type SavedSegment = { id: string; name: string; filters: ProspectFactoryFilters; createdAt: string };
type TrackingResponse = {
  prospects: TrackedProspect[];
  total: number;
  limit: number;
  offset: number;
  counts: ProspectPipelineCounts;
  filterOptions: Pick<ProspectFactoryFacetsResponse, "countries" | "territories" | "verticals" | "origins" | "certifications" | "contacts">;
};
type TrackingStatsResponse = ProspectActivityStats & {
  target?: {
    newContactsApproached?: number;
    approachedProspects?: number;
    remaining?: number;
    met?: boolean;
  };
};
type LocalColumn = "company" | "location" | "activity" | "size" | "capital" | "persona" | "icp" | "contact" | "quality" | "score" | "source";
type LocalSort = { column: LocalColumn; direction: "asc" | "desc" };

const number = new Intl.NumberFormat("fr-FR");
const compact = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });
const currency = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });

function percent(value: number, total: number) {
  if (!total) return "0 %";
  return `${Math.round((value / total) * 100)} %`;
}

const qualificationLabels: Record<ProspectQualificationStatus, string> = {
  to_qualify: "À qualifier",
  qualified: "Qualifié",
  to_contact: "À contacter",
  contacted: "Contacté",
  in_conversation: "En discussion",
  opportunity: "Opportunité",
  won: "Gagné",
  lost: "Perdu",
  disqualified: "Écarté"
};

const trackingBoardStatuses: ProspectQualificationStatus[] = [
  "to_qualify", "qualified", "to_contact", "contacted", "in_conversation", "opportunity", "won", "lost", "disqualified"
];

const priorityLabels: Record<ProspectPriority, string> = { high: "Haute", normal: "Normale", low: "Basse" };
const tierLabels: Record<ProspectQualificationTier, string> = { A: "Tier A", B: "Tier B", C: "Tier C" };
const confidenceLabels: Record<ProspectQualificationConfidence, string> = { high: "Confiance élevée", medium: "Confiance moyenne", low: "À confirmer" };
const activityRequiredStatuses = new Set<ProspectQualificationStatus>(["contacted", "in_conversation", "opportunity", "won", "lost"]);

function statusRequiresLoggedActivity(status: ProspectQualificationStatus) {
  return activityRequiredStatuses.has(status);
}

function qualificationScoreLabel(value: number | null | undefined) {
  return typeof value === "number" ? `${value}/100` : "Score à établir";
}

function qualificationTierLabel(value: ProspectQualificationTier | null | undefined) {
  return value ? tierLabels[value] : "Tier à établir";
}

function qualificationConfidenceLabel(value: ProspectQualificationConfidence | null | undefined) {
  return value ? confidenceLabels[value] : "Confiance à confirmer";
}

const localColumnDefinitions: Array<{ key: LocalColumn; label: string; placeholder: string }> = [
  { key: "company", label: "Entreprise", placeholder: "Nom, SIREN…" },
  { key: "location", label: "Localisation", placeholder: "Ville, région…" },
  { key: "activity", label: "Activité", placeholder: "Secteur, taille…" },
  { key: "size", label: "Effectif", placeholder: "Nombre, tranche, année…" },
  { key: "capital", label: "Capital social", placeholder: "Montant, source…" },
  { key: "persona", label: "Persona", placeholder: "Décideur, fonction…" },
  { key: "icp", label: "ICP", placeholder: "Profil idéal…" },
  { key: "contact", label: "Contact", placeholder: "Email, téléphone…" },
  { key: "quality", label: "Qualité", placeholder: "Gold, raison…" },
  { key: "score", label: "Score", placeholder: "Score, segment…" },
  { key: "source", label: "Source", placeholder: "Source, date…" }
];

const emptyLocalColumnFilters: Record<LocalColumn, string> = {
  company: "",
  location: "",
  activity: "",
  size: "",
  capital: "",
  persona: "",
  icp: "",
  contact: "",
  quality: "",
  score: "",
  source: ""
};

const localCollator = new Intl.Collator("fr-FR", { numeric: true, sensitivity: "base" });

function normalizeLocalSearch(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr-FR");
}

function localColumnValue(row: ProspectFactoryRow, column: LocalColumn) {
  switch (column) {
    case "company": return [row.commercialName, row.companyName, row.dedupeKey, row.siren, row.siret].filter(Boolean).join(" ");
    case "location": return [row.city, row.region, row.territory, row.country].filter(Boolean).join(" ");
    case "activity": return [row.vertical, row.activityCategory, row.activityDetail, row.employeeRange, row.employeeYear, row.persona, row.icp, row.approachAngle, row.legalCategory, row.employerStatus].filter(Boolean).join(" ");
    case "size": return [row.employeeCount, row.employeeRange, row.employeeMin, row.employeeMax, row.employeeYear, row.employeeScope, row.employeeDataType, row.employeeDataStatus].filter(Boolean).join(" ");
    case "capital": return [row.capitalSocial, row.capitalCurrency, row.capitalReferenceDate, row.capitalSource].filter((value) => value !== null && value !== undefined && value !== "").join(" ");
    case "persona": return [row.persona, row.contactType, row.contactName].filter(Boolean).join(" ");
    case "icp": return [row.icp, row.approachAngle].filter(Boolean).join(" ");
    case "contact": return [row.contactName, row.email, row.phone, row.website, row.fax, row.address, row.postalCode, row.contactType, row.websiteStatus].filter(Boolean).join(" ");
    case "quality": return [row.certification, certificationLabel(row.certification), row.dataQuality, row.employeeDataStatus, ...row.qualityReasons].filter(Boolean).join(" ");
    case "score": return [row.leadScore, row.prioritySegment].filter((value) => value !== null && value !== undefined).join(" ");
    case "source": return [row.recordOrigin, row.sourceType, row.sourceReferenceDate, row.retrievedAt, row.sourceCount, row.creationDate].filter(Boolean).join(" ");
  }
}

function localSortValue(row: ProspectFactoryRow, column: LocalColumn) {
  if (column === "score") return row.leadScore;
  if (column === "capital") return row.capitalSocial;
  return localColumnValue(row, column);
}

function localColumnFacetValue(row: ProspectFactoryRow, column: LocalColumn) {
  switch (column) {
    case "company": return row.commercialName || row.companyName || "Entreprise inconnue";
    case "location": return [row.city, row.region].filter(Boolean).join(", ") || row.territory || "Localisation inconnue";
    case "activity": return row.vertical || "Non classé";
    case "size": return row.employeeCount ? `${row.employeeCount} salarié${row.employeeCount === "1" ? "" : "s"}` : row.employeeRange || "Effectif non renseigné";
    case "capital": return row.capitalSocial === null || row.capitalSocial === undefined ? "Capital non renseigné" : `${row.capitalSocial} ${row.capitalCurrency || "EUR"}`;
    case "persona": return row.persona || "Persona non renseigné";
    case "icp": return row.icp || "ICP non renseigné";
    case "contact": return row.email || row.phone || row.website || "À enrichir";
    case "quality": return certificationLabel(row.certification);
    case "score": return row.leadScore === null || row.leadScore === undefined ? "Score inconnu" : String(row.leadScore);
    case "source": return row.recordOrigin || "Source inconnue";
  }
}

function formatOptionalDate(value: string | null | undefined) {
  if (!value) return "Aucune action planifiée";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : date.format(parsed);
}

const emptyFilters: ProspectFactoryFilters = { country: "France", territory: "Guadeloupe", certification: "gold", contact: "any", minScore: 0 };

function paramsFor(filters: ProspectFactoryFilters, options: { cursor?: string | null; count?: boolean; limit?: number } = {}) {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== "" && value !== 0) parameters.set(key, String(value));
  if (options.cursor) parameters.set("cursor", options.cursor);
  if (options.count) parameters.set("count", "1");
  parameters.set("limit", String(options.limit ?? 50));
  return parameters;
}

function certificationLabel(value: string) {
  if (value === "gold") return "Gold · à revalider";
  if (value === "silver") return "Silver · enrichissable";
  if (value === "bronze") return "Bronze · analytique";
  return "Bloqué";
}

function contactLabel(value: string) {
  if (value === "email") return "Email plausible";
  if (value === "phone") return "Téléphone plausible";
  if (value === "website") return "Site observé";
  if (value === "no_website") return "Sans site observé";
  return "Au moins un contact";
}

function trackingContactLabel(value: string) {
  if (value === "email") return "E-mail renseigné";
  if (value === "phone") return "Téléphone renseigné";
  if (value === "website") return "Site renseigné";
  if (value === "no_website") return "Sans site renseigné";
  return "Au moins un contact renseigné";
}

function optionLabel(label: string, count: number) {
  return `${label} · ${number.format(count)}`;
}

function readSegments() {
  try {
    return JSON.parse(window.localStorage.getItem("guad-prospect-segments") ?? "[]") as SavedSegment[];
  } catch {
    return [];
  }
}

function filtersFromLocation() {
  const parameters = new URLSearchParams(window.location.search);
  const certification = parameters.get("certification");
  const contact = parameters.get("contact");
  const minScore = Number(parameters.get("minScore") ?? 0);
  return {
    country: parameters.get("country") || undefined,
    territory: parameters.get("territory") || undefined,
    vertical: parameters.get("vertical") || undefined,
    origin: parameters.get("origin") || undefined,
    certification: certification && ["gold", "silver", "bronze", "blocked"].includes(certification) ? certification as ProspectFactoryFilters["certification"] : undefined,
    contact: contact && ["any", "email", "phone", "website", "no_website"].includes(contact) ? contact as ProspectFactoryFilters["contact"] : undefined,
    minScore: Number.isFinite(minScore) ? Math.min(100, Math.max(0, minScore)) : 0,
    query: parameters.get("query")?.slice(0, 120) || undefined
  } satisfies ProspectFactoryFilters;
}

function pageSizeFromLocation() {
  const parsed = Number(new URLSearchParams(window.location.search).get("limit") ?? 50);
  return [25, 50, 100].includes(parsed) ? parsed : 50;
}

function fallbackFacet(rows: ProspectQualitySnapshot["dimensions"]["countries"] | undefined) {
  return rows?.map((item) => ({ value: item.value, count: item.total })) ?? [];
}

function facetOptions(dynamic: ProspectFactoryFacetOption[] | undefined, fallback: ProspectFactoryFacetOption[], selected?: string) {
  const options = dynamic ?? fallback;
  return selected && !options.some((item) => item.value === selected) ? [{ value: selected, count: 0 }, ...options] : options;
}

function trackedToFactoryRow(prospect: TrackedProspect): ProspectFactoryRow {
  return {
    warehouseId: prospect.warehouseId,
    dedupeKey: prospect.dedupeKey,
    companyName: prospect.snapshot.companyName,
    commercialName: prospect.snapshot.commercialName,
    country: prospect.snapshot.country,
    territory: prospect.snapshot.territory,
    region: prospect.snapshot.region,
    city: prospect.snapshot.city,
    vertical: prospect.snapshot.vertical,
    activityDetail: prospect.snapshot.activityDetail,
    employeeRange: prospect.snapshot.employeeRange,
    employeeCount: prospect.market.employeeCountEstimate === null ? null : String(prospect.market.employeeCountEstimate),
    contactName: prospect.enrichment.contactName ?? prospect.snapshot.contactName,
    email: prospect.enrichment.email ?? prospect.snapshot.email,
    phone: prospect.enrichment.phone ?? prospect.snapshot.phone,
    website: prospect.enrichment.website ?? prospect.snapshot.website,
    leadScore: prospect.snapshot.leadScore,
    prioritySegment: null,
    certification: prospect.snapshot.certification,
    qualityReasons: [],
    recordOrigin: prospect.snapshot.recordOrigin,
    sourceType: prospect.snapshot.recordOrigin,
    sourceUrls: prospect.snapshot.sourceUrls,
    sourceReferenceDate: null,
    retrievedAt: null,
    administrativeStatus: null,
    siren: prospect.market.siren,
    siret: prospect.market.siret,
    businessId: null,
    tracking: {
      id: prospect.id,
      status: prospect.qualification.status,
      priority: prospect.qualification.priority,
      nextActionAt: prospect.qualification.nextActionAt,
      updatedAt: prospect.updatedAt
    }
  };
}

type ManualProspectFormProps = {
  onClose: () => void;
  onCreated: (prospect: TrackedProspect) => void;
};

function ManualProspectForm({ onClose, onCreated }: ManualProspectFormProps) {
  const [companyName, setCompanyName] = useState("");
  const [commercialName, setCommercialName] = useState("");
  const [country, setCountry] = useState("");
  const [territory, setTerritory] = useState("");
  const [region, setRegion] = useState("");
  const [city, setCity] = useState("");
  const [vertical, setVertical] = useState("");
  const [activityDetail, setActivityDetail] = useState("");
  const [employeeRange, setEmployeeRange] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<ProspectQualificationStatus>("to_qualify");
  const [priority, setPriority] = useState<ProspectPriority>("normal");
  const [owner, setOwner] = useState("");
  const [campaign, setCampaign] = useState("");
  const [potentialValue, setPotentialValue] = useState("");
  const [probability, setProbability] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const closeHandlerRef = useRef(onClose);

  useEffect(() => {
    closeHandlerRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeHandlerRef.current();
    };
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onDocumentKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus();
    };
  }, []);

  function requestClose() {
    closeHandlerRef.current();
  }

  function trapFocus(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
      .filter((element) => element.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (statusRequiresLoggedActivity(status)) {
      setError("Pour définir ce statut, créez d’abord la fiche puis consignez l’activité réelle dans son historique.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/prospect-factory/crm/prospects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manual: true, companyName, commercialName: commercialName || undefined, country: country || undefined, territory: territory || undefined, region: region || undefined, city: city || undefined, vertical: vertical || undefined, activityDetail: activityDetail || undefined, employeeRange: employeeRange || undefined, contactName: contactName || undefined, email: email || undefined, phone: phone || undefined, website: website || undefined, status, priority, notes, owner: owner || undefined, campaign: campaign || undefined, potentialValue: potentialValue === "" ? undefined : Number(potentialValue), probability: probability === "" ? undefined : Number(probability) })
      });
      const payload = await response.json() as { prospect?: TrackedProspect; error?: string };
      if (!response.ok || !payload.prospect) throw new Error(payload.error ?? "Le prospect n’a pas pu être enregistré.");
      onCreated(payload.prospect);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Le prospect n’a pas pu être enregistré.");
    } finally {
      setSaving(false);
    }
  }

  return <div className={styles.manualOverlay} role="presentation" onClick={(event) => { if (event.target === event.currentTarget) requestClose(); }}><section className={styles.manualCard} role="dialog" aria-modal="true" aria-labelledby="manual-prospect-title" onKeyDown={trapFocus} onClick={(event) => event.stopPropagation()}><header className={styles.manualHeader}><div><span>Ajout CRM</span><h2 id="manual-prospect-title">Ajouter un prospect</h2><p>Crée une fiche indépendante du référentiel initial, conservée dans le suivi commercial.</p></div><button ref={closeButtonRef} type="button" className={styles.iconButton} onClick={requestClose} aria-label="Fermer"><X size={18} /></button></header><form onSubmit={(event) => void submit(event)}><div className={styles.manualFormGrid}><div className={styles.manualSectionTitle}><span>Compte</span><p>Identité, localisation et activité observée.</p></div><label className={styles.manualFullField}>Entreprise<input value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Nom de l’entreprise" maxLength={240} required autoFocus /></label><label>Nom commercial<input value={commercialName} onChange={(event) => setCommercialName(event.target.value)} placeholder="Optionnel" maxLength={240} /></label><label>Pays<input value={country} onChange={(event) => setCountry(event.target.value)} placeholder="Ex. États-Unis" maxLength={120} required /></label><label>Territoire<input value={territory} onChange={(event) => setTerritory(event.target.value)} placeholder="Ex. Californie ou Guadeloupe" maxLength={120} required /></label><label>Région / État<input value={region} onChange={(event) => setRegion(event.target.value)} placeholder="Ex. West Coast" maxLength={120} /></label><label>Ville<input value={city} onChange={(event) => setCity(event.target.value)} placeholder="Ex. Les Abymes" maxLength={120} /></label><label>Activité<input value={vertical} onChange={(event) => setVertical(event.target.value)} placeholder="Ex. BTP, conseil…" maxLength={180} /></label><label>Détail d’activité<input value={activityDetail} onChange={(event) => setActivityDetail(event.target.value)} placeholder="Produits, modèle économique…" maxLength={500} /></label><label>Tranche d’effectif<input value={employeeRange} onChange={(event) => setEmployeeRange(event.target.value)} placeholder="Ex. 51–100" maxLength={80} /></label><div className={styles.manualSectionTitle}><span>Contact et pilotage</span><p>Les champs de recherche détaillée restent disponibles dans la fiche après création.</p></div><label>Contact<input value={contactName} onChange={(event) => setContactName(event.target.value)} placeholder="Nom du contact" maxLength={180} /></label><label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="contact@entreprise.fr" maxLength={320} /></label><label>Téléphone<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+590 …" maxLength={60} /></label><label>Site web<input type="url" value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="https://…" maxLength={2_048} /></label><label>Étape<select value={status} onChange={(event) => setStatus(event.target.value as ProspectQualificationStatus)}>{(Object.keys(qualificationLabels) as ProspectQualificationStatus[]).map((value) => <option key={value} value={value} disabled={statusRequiresLoggedActivity(value)}>{qualificationLabels[value]}{statusRequiresLoggedActivity(value) ? " · via activité" : ""}</option>)}</select></label><label>Priorité<select value={priority} onChange={(event) => setPriority(event.target.value as ProspectPriority)}><option value="high">Haute</option><option value="normal">Normale</option><option value="low">Basse</option></select></label><label>Responsable<input value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="Qui suit cette fiche ?" maxLength={180} /></label><label>Campagne<input value={campaign} onChange={(event) => setCampaign(event.target.value)} placeholder="Ex. BTP · septembre" maxLength={180} /></label><label>Valeur potentielle (€)<input type="number" min="0" max="1000000000" step="100" value={potentialValue} onChange={(event) => setPotentialValue(event.target.value)} placeholder="Ex. 5000" /></label><label>Probabilité (%)<input type="number" min="0" max="100" step="5" value={probability} onChange={(event) => setProbability(event.target.value)} placeholder="Ex. 40" /></label><label className={styles.manualFullField}>Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Contexte, besoin, prochaine information utile…" rows={4} maxLength={20_000} /></label></div>{error ? <div className={styles.alert} role="alert"><CircleAlert size={17} />{error}</div> : null}<footer className={styles.manualActions}><button type="button" className={styles.secondary} onClick={requestClose} disabled={saving}>Annuler</button><button type="submit" className={styles.primary} disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer dans le suivi"}</button></footer></form></section></div>;
}

export function ProspectFactory() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [token, setToken] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [view, setView] = useState<View>("explore");
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProspectFactoryFilters>(emptyFilters);
  const [applied, setApplied] = useState<ProspectFactoryFilters>(emptyFilters);
  const [result, setResult] = useState<ProspectFactorySearchResponse | null>(null);
  const [rows, setRows] = useState<ProspectFactorySearchResponse["rows"]>([]);
  const [pageSize, setPageSize] = useState(50);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [segments, setSegments] = useState<SavedSegment[]>([]);
  const [segmentName, setSegmentName] = useState("");
  const [namingSegment, setNamingSegment] = useState(false);
  const [qualityDimension, setQualityDimension] = useState<keyof ProspectQualitySnapshot["dimensions"]>("origins");
  const [facets, setFacets] = useState<ProspectFactoryFacetsResponse | null>(null);
  const [facetsLoading, setFacetsLoading] = useState(false);
  const [facetsError, setFacetsError] = useState<string | null>(null);
  const [facetsNotice, setFacetsNotice] = useState<string | null>(null);
  const [tracking, setTracking] = useState<TrackingResponse | null>(null);
  const [trackingStats, setTrackingStats] = useState<TrackingStatsResponse | null>(null);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [trackingStatsError, setTrackingStatsError] = useState<string | null>(null);
  const [trackingStatus, setTrackingStatus] = useState<ProspectQualificationStatus | "">("");
  const [trackingViewMode, setTrackingViewMode] = useState<"rows" | "kanban" | "market" | "map">("market");
  const [marketRefreshToken, setMarketRefreshToken] = useState(0);
  const [trackingPriority, setTrackingPriority] = useState<ProspectPriority | "">("");
  const [trackingDraftFilters, setTrackingDraftFilters] = useState<ProspectFactoryFilters>({});
  const [trackingAppliedFilters, setTrackingAppliedFilters] = useState<ProspectFactoryFilters>({});
  const [trackingOffset, setTrackingOffset] = useState(0);
  const [trackingPageSize, setTrackingPageSize] = useState(25);
  const [selectedProspect, setSelectedProspect] = useState<ProspectFactoryRow | null>(null);
  const [selectedProspectTab, setSelectedProspectTab] = useState<"tracking" | "activity" | undefined>(undefined);
  const [selectedActivityContactId, setSelectedActivityContactId] = useState<string | null>(null);
  const [manualProspectOpen, setManualProspectOpen] = useState(false);
  const [dismissBusyId, setDismissBusyId] = useState<string | null>(null);
  const [localColumnFilters, setLocalColumnFilters] = useState<Record<LocalColumn, string>>(emptyLocalColumnFilters);
  const [localSort, setLocalSort] = useState<LocalSort | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const facetRequestRef = useRef<AbortController | null>(null);
  const trackingRequestRef = useRef<AbortController | null>(null);
  const facetFilterKey = useMemo(() => JSON.stringify({ ...draft, query: undefined }), [draft]);

  const loadOverview = useCallback(async () => {
    setOverviewError(null);
    try {
      const response = await fetch("/api/prospect-factory/overview", { cache: "no-store" });
      const payload = await response.json() as OverviewResponse & { error?: string };
      if (response.status === 401 || response.status === 403) {
        setAuthenticated(response.status !== 401);
        setAuthorized(false);
        throw new Error(payload.error ?? "Accès refusé.");
      }
      if (!response.ok) throw new Error(payload.error ?? "Prospect Factory indisponible.");
      setOverview(payload);
    } catch (error) {
      setOverviewError(error instanceof Error ? error.message : "Chargement impossible.");
    }
  }, []);

  const loadTracking = useCallback(async () => {
    trackingRequestRef.current?.abort();
    const controller = new AbortController();
    trackingRequestRef.current = controller;
    const parameters = new URLSearchParams({ limit: String(trackingPageSize), offset: String(trackingOffset) });
    if (trackingStatus) parameters.set("status", trackingStatus);
    if (trackingPriority) parameters.set("priority", trackingPriority);
    for (const [key, value] of Object.entries(trackingAppliedFilters)) {
      if (value !== undefined && value !== "" && value !== 0) parameters.set(key, String(value));
    }
    setTrackingLoading(true);
    setTrackingError(null);
    setTrackingStatsError(null);
    try {
      const responsePromise = fetch(`/api/prospect-factory/crm/prospects?${parameters}`, { signal: controller.signal, cache: "no-store" });
      const statsPromise = fetch("/api/prospect-factory/crm/stats", { signal: controller.signal, cache: "no-store" }).catch((caught: unknown) => caught);
      const response = await responsePromise;
      const payload = await response.json() as TrackingResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Chargement du suivi impossible.");
      setTracking(payload);
      const statsResponse = await statsPromise;
      if (statsResponse instanceof Response && statsResponse.ok) {
        const statsPayload = await statsResponse.json() as TrackingStatsResponse;
        setTrackingStats(statsPayload);
      } else if (statsResponse instanceof Response) {
        const statsPayload = await statsResponse.json().catch(() => null) as { error?: string } | null;
        setTrackingStats(null);
        setTrackingStatsError(statsPayload?.error ?? "L’indicateur hebdomadaire est momentanément indisponible.");
      } else if (!(statsResponse instanceof DOMException && statsResponse.name === "AbortError")) {
        setTrackingStats(null);
        setTrackingStatsError("L’indicateur hebdomadaire est momentanément indisponible.");
      }
    } catch (error) {
      if (!controller.signal.aborted) setTrackingError(error instanceof Error ? error.message : "Chargement du suivi impossible.");
    } finally {
      if (trackingRequestRef.current === controller) setTrackingLoading(false);
    }
  }, [trackingAppliedFilters, trackingOffset, trackingPageSize, trackingPriority, trackingStatus]);

  const search = useCallback(async (filters: ProspectFactoryFilters, cursor: string | null = null, limit = 50, targetPage = 0) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    setLoading(true);
    setSearchError(null);
    try {
      const response = await fetch(`/api/prospect-factory/prospects?${paramsFor(filters, { cursor, count: !cursor, limit })}`, { signal: controller.signal, cache: "no-store" });
      const payload = await response.json() as ProspectFactorySearchResponse & { error?: string };
      if (response.status === 401 || response.status === 403) {
        setAuthenticated(response.status !== 401);
        setAuthorized(false);
      }
      if (!response.ok) throw new Error(payload.error ?? "Recherche impossible.");
      setResult((current) => cursor ? { ...payload, total: current?.total ?? null } : payload);
      setRows(payload.rows);
      setPageIndex(targetPage);
    } catch (error) {
      if (controller.signal.aborted) return;
      setSearchError(error instanceof Error ? error.message : "Recherche impossible.");
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const initial = window.location.search ? filtersFromLocation() : emptyFilters;
      const initialPageSize = pageSizeFromLocation();
      setSegments(readSegments());
      setDraft(initial);
      setApplied(initial);
      setPageSize(initialPageSize);
      fetch("/api/admin/session", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error("Vérification de session impossible.");
        const session = await response.json() as { configured: boolean; authenticated: boolean; role: string | null };
        const canAccess = session.authenticated && (session.role === "SUPER_ADMIN" || session.role === "DATA_ADMIN");
        setConfigured(session.configured);
        setAuthenticated(session.authenticated);
        setAuthorized(canAccess);
        if (canAccess) await Promise.all([loadOverview(), search(initial, null, initialPageSize, 0)]);
      }).catch((error: unknown) => { setConfigured(false); setAuthError(error instanceof Error ? error.message : "Session indisponible."); });
    }, 0);
    return () => { window.clearTimeout(timer); requestRef.current?.abort(); facetRequestRef.current?.abort(); trackingRequestRef.current?.abort(); };
  }, [loadOverview, search]);

  useEffect(() => {
    if (!authorized) return;
    const structuralFilters = JSON.parse(facetFilterKey) as ProspectFactoryFilters;
    const timer = window.setTimeout(() => {
      facetRequestRef.current?.abort();
      const controller = new AbortController();
      facetRequestRef.current = controller;
      setFacetsLoading(true);
      setFacetsError(null);
      fetch(`/api/prospect-factory/facets?${paramsFor(structuralFilters)}`, { signal: controller.signal, cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json() as ProspectFactoryFacetsResponse & { error?: string };
          if (response.status === 401 || response.status === 403) {
            setAuthenticated(response.status !== 401);
            setAuthorized(false);
          }
          if (!response.ok) throw new Error(payload.error ?? "Actualisation des filtres impossible.");
          setFacets(payload);
          const checks = [
            ["country", "countries", "pays"],
            ["territory", "territories", "territoire"],
            ["vertical", "verticals", "vertical"],
            ["origin", "origins", "source"],
            ["certification", "certifications", "certification"],
            ["contact", "contacts", "contact"]
          ] as const;
          const incompatible = checks.filter(([filterKey, facetKey]) => {
            const selected = structuralFilters[filterKey];
            return selected && !payload[facetKey].some((option) => option.value === selected && option.count > 0);
          });
          setFacetsNotice(incompatible.length ? `Combinaison sans résultat pour : ${incompatible.map(([, , label]) => label).join(", ")}. Modifiez l’un de ces filtres.` : null);
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setFacetsError(error instanceof Error ? error.message : "Actualisation des filtres impossible.");
        })
        .finally(() => {
          if (facetRequestRef.current === controller) setFacetsLoading(false);
        });
    }, 350);
    return () => { window.clearTimeout(timer); facetRequestRef.current?.abort(); };
  }, [authorized, facetFilterKey]);

  useEffect(() => {
    if (!authorized) return;
    const timer = window.setTimeout(() => { void loadTracking(); }, 0);
    return () => window.clearTimeout(timer);
  }, [authorized, loadTracking]);

  const applyFilters = () => {
    setApplied(draft);
    setPageCursors([null]);
    setPageIndex(0);
    window.history.replaceState(null, "", `${window.location.pathname}?${paramsFor(draft, { limit: pageSize })}`);
    void search(draft, null, pageSize, 0);
  };

  const clearFilters = () => {
    const cleared: ProspectFactoryFilters = { minScore: 0 };
    setDraft(cleared);
    setApplied(cleared);
    setPageCursors([null]);
    setPageIndex(0);
    setNamingSegment(false);
    setSearchError(null);
    window.history.replaceState(null, "", `${window.location.pathname}?limit=${pageSize}`);
    void search(cleared, null, pageSize, 0);
  };

  const applyTrackingFilters = () => {
    setTrackingAppliedFilters({ ...trackingDraftFilters });
    setTrackingOffset(0);
  };

  const clearTrackingFilters = () => {
    setTrackingDraftFilters({});
    setTrackingAppliedFilters({});
    setTrackingStatus("");
    setTrackingPriority("");
    setTrackingOffset(0);
  };

  const changeTrackingView = (nextView: "rows" | "kanban" | "market" | "map") => {
    if (nextView === "kanban" && trackingStatus) {
      setTrackingStatus("");
      setTrackingOffset(0);
    }
    setTrackingViewMode(nextView);
  };

  const changePageSize = (nextSize: number) => {
    setPageSize(nextSize);
    setPageCursors([null]);
    setPageIndex(0);
    window.history.replaceState(null, "", `${window.location.pathname}?${paramsFor(applied, { limit: nextSize })}`);
    void search(applied, null, nextSize, 0);
  };

  const nextPage = () => {
    if (!result?.nextCursor || loading) return;
    const targetPage = pageIndex + 1;
    setPageCursors((current) => [...current.slice(0, targetPage), result.nextCursor]);
    void search(applied, result.nextCursor, pageSize, targetPage);
  };

  const previousPage = () => {
    if (pageIndex === 0 || loading) return;
    const targetPage = pageIndex - 1;
    void search(applied, pageCursors[targetPage] ?? null, pageSize, targetPage);
  };

  const saveSegment = () => {
    const suggested = [draft.country, draft.territory, draft.vertical, draft.certification].filter(Boolean).join(" · ") || "Nouveau segment";
    const name = (segmentName || suggested).trim();
    if (!name) return;
    const next = [{ id: crypto.randomUUID(), name, filters: draft, createdAt: new Date().toISOString() }, ...segments].slice(0, 30);
    window.localStorage.setItem("guad-prospect-segments", JSON.stringify(next));
    setSegments(next);
    setSegmentName("");
    setNamingSegment(false);
  };

  const refreshCrm = () => {
    void loadTracking();
    setMarketRefreshToken((current) => current + 1);
    if (view === "explore") void search(applied, pageCursors[pageIndex] ?? null, pageSize, pageIndex);
  };

  async function dismissFromExplorer(row: ProspectFactoryRow) {
    if (row.tracking) return;
    setDismissBusyId(row.warehouseId);
    setSearchError(null);
    try {
      const response = await fetch("/api/prospect-factory/crm/prospects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warehouseId: row.warehouseId, qualification: { status: "disqualified", priority: "low" } })
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "L’entreprise n’a pas pu être écartée.");
      await refreshCrm();
    } catch (caught) {
      setSearchError(caught instanceof Error ? caught.message : "L’entreprise n’a pas pu être écartée.");
    } finally {
      setDismissBusyId(null);
    }
  }

  const setLocalColumnFilter = (column: LocalColumn, value: string) => {
    setLocalColumnFilters((current) => ({ ...current, [column]: value.slice(0, 120) }));
  };

  const toggleLocalSort = (column: LocalColumn) => {
    setLocalSort((current) => {
      if (!current || current.column !== column) return { column, direction: "asc" };
      if (current.direction === "asc") return { column, direction: "desc" };
      return null;
    });
  };

  const clearLocalOrganization = () => {
    setLocalColumnFilters({ ...emptyLocalColumnFilters });
    setLocalSort(null);
  };

  const countries = facetOptions(facets?.countries, fallbackFacet(overview?.snapshot.dimensions.countries), draft.country);
  const territories = facetOptions(facets?.territories, fallbackFacet(overview?.snapshot.dimensions.territories), draft.territory);
  const verticals = facetOptions(facets?.verticals, fallbackFacet(overview?.snapshot.dimensions.verticals), draft.vertical);
  const origins = facetOptions(facets?.origins, fallbackFacet(overview?.snapshot.dimensions.origins), draft.origin);
  const certifications = facetOptions(facets?.certifications, overview ? (["gold", "silver", "bronze", "blocked"] as const).map((value) => ({ value, count: overview.snapshot.summary[value] })) : [], draft.certification);
  const contacts = facetOptions(facets?.contacts, [], draft.contact);
  const summary = overview?.snapshot.summary;
  const qualityRows = overview?.snapshot.dimensions[qualityDimension] ?? [];
  const resultLabel = result?.total === null || result?.total === undefined ? `${number.format(rows.length)} affichés` : `${number.format(result.total)} correspondances`;
  const firstVisible = rows.length ? pageIndex * pageSize + 1 : 0;
  const lastVisible = pageIndex * pageSize + rows.length;
  const activeFilters = useMemo(() => Object.values(applied).filter((value) => value !== undefined && value !== "" && value !== 0).length, [applied]);
  const hasDraftFilters = useMemo(() => Object.values(draft).some((value) => value !== undefined && value !== "" && value !== 0), [draft]);
  const trackingActiveFilterCount = Object.values(trackingAppliedFilters).filter((value) => value !== undefined && value !== "" && value !== 0).length + Number(Boolean(trackingStatus)) + Number(Boolean(trackingPriority));
  const hasTrackingFilters = trackingActiveFilterCount > 0 || Object.values(trackingDraftFilters).some((value) => value !== undefined && value !== "" && value !== 0);
  const localVisibleRows = useMemo(() => {
    const activeLocalFilters = Object.entries(localColumnFilters).filter(([, value]) => value.trim()) as Array<[LocalColumn, string]>;
    const filtered = rows.filter((row) => row.tracking?.status !== "disqualified" && activeLocalFilters.every(([column, value]) => normalizeLocalSearch(localColumnValue(row, column)).includes(normalizeLocalSearch(value))));
    if (!localSort) return filtered;
    const sorted = [...filtered];
    sorted.sort((left, right) => {
      const leftValue = localSortValue(left, localSort.column);
      const rightValue = localSortValue(right, localSort.column);
      const leftEmpty = leftValue === null || leftValue === undefined || leftValue === "";
      const rightEmpty = rightValue === null || rightValue === undefined || rightValue === "";
      if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
      const comparison = typeof leftValue === "number" && typeof rightValue === "number"
        ? leftValue - rightValue
        : localCollator.compare(String(leftValue ?? ""), String(rightValue ?? ""));
      return comparison * (localSort.direction === "asc" ? 1 : -1);
    });
    return sorted;
  }, [localColumnFilters, localSort, rows]);
  const localColumnOptions = useMemo(() => {
    const options = {} as Record<LocalColumn, string[]>;
    for (const { key } of localColumnDefinitions) {
      const unique = new Map<string, string>();
      for (const row of rows.filter((item) => item.tracking?.status !== "disqualified")) {
        const value = localColumnFacetValue(row, key).trim();
        if (value) unique.set(normalizeLocalSearch(value), value);
      }
      options[key] = [...unique.values()].sort((left, right) => localCollator.compare(left, right)).slice(0, 100);
    }
    return options;
  }, [rows]);
  const trackingBoardColumns = useMemo(() => trackingBoardStatuses.map((status) => ({
    status,
    prospects: (tracking?.prospects ?? []).filter((prospect) => prospect.qualification.status === status)
  })), [tracking?.prospects]);
  const localFilterCount = useMemo(() => Object.values(localColumnFilters).filter((value) => value.trim()).length, [localColumnFilters]);
  const hasLocalOrganization = localFilterCount > 0 || localSort !== null;
  const localFilterSummary = localFilterCount ? ` · ${localFilterCount} recherche${localFilterCount > 1 ? "s" : ""}` : "";
  const trackingFirst = tracking?.prospects.length ? tracking.offset + 1 : 0;
  const trackingLast = tracking ? tracking.offset + tracking.prospects.length : 0;
  const trackingPage = Math.floor(trackingOffset / trackingPageSize) + 1;
  const pipelineCounts = tracking?.counts.byStatus;
  const tierCounts = tracking?.counts.byTier;
  const trackedTotal = tracking?.counts.total ?? 0;
  const contactedCount = (pipelineCounts?.contacted ?? 0) + (pipelineCounts?.in_conversation ?? 0) + (pipelineCounts?.opportunity ?? 0) + (pipelineCounts?.won ?? 0) + (pipelineCounts?.lost ?? 0);
  const opportunityCount = (pipelineCounts?.opportunity ?? 0) + (pipelineCounts?.won ?? 0);
  const weeklyTarget = trackingStats?.target?.newContactsApproached ?? 50;
  const weeklyNewContacts = trackingStats?.newContactsApproached ?? null;
  const weeklyNewAccounts = trackingStats?.newAccountsApproached ?? null;
  const weeklyFollowUps = trackingStats?.followUpApproachEvents ?? null;
  const weeklyApproachEvents = trackingStats?.approachEvents ?? null;
  const weeklyRemaining = weeklyNewContacts === null ? null : Math.max(0, weeklyTarget - weeklyNewContacts);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setAuthError(null);
    try {
      const response = await fetch("/api/admin/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const payload = await response.json().catch(() => null) as { error?: string; role?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Authentification refusée.");
      const canAccess = payload?.role === "SUPER_ADMIN" || payload?.role === "DATA_ADMIN";
      setAuthenticated(true);
      setAuthorized(canAccess);
      setToken("");
      if (!canAccess) throw new Error("Le rôle MODERATOR ne donne pas accès aux données prospects.");
      await Promise.all([loadOverview(), search(applied, null, pageSize, 0)]);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Authentification refusée.");
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    requestRef.current?.abort();
    trackingRequestRef.current?.abort();
    await fetch("/api/admin/session", { method: "DELETE" });
    setAuthenticated(false);
    setAuthorized(false);
    setOverview(null);
    setRows([]);
    setResult(null);
    setTracking(null);
    setTrackingStats(null);
    setSelectedProspect(null);
    setSelectedProspectTab(undefined);
    setSelectedActivityContactId(null);
  }

  if (configured === null) return <main className={styles.authShell}><section className={styles.authCard}><RefreshCw className={styles.spin} size={22} /><h1>Vérification de l’accès</h1><p>Connexion sécurisée à Prospect Factory…</p></section></main>;
  if (!configured || !authorized) return <main className={styles.authShell}><section className={styles.authCard} aria-labelledby="prospect-login-title"><span className={styles.authIcon}><ShieldCheck size={24} /></span><span className={styles.authEyebrow}>Données commerciales protégées</span><h1 id="prospect-login-title">Ouvrir Prospect Factory</h1><p>{!configured ? "L’administrateur doit définir ADMIN_ACCESS_TOKEN et ADMIN_SESSION_SECRET côté serveur." : authenticated ? "Votre rôle ne permet pas de consulter ni d’exporter les prospects." : "Une session DATA_ADMIN ou SUPER_ADMIN est requise. Les données ne sont jamais mises en cache dans le navigateur."}</p>{configured && !authenticated ? <form onSubmit={(event) => void login(event)}><label>Jeton d’accès<input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="current-password" required /></label><button type="submit" disabled={loading}><LogIn size={16} />{loading ? "Vérification…" : "Ouvrir la session"}</button></form> : null}{configured && authenticated ? <button className={styles.logoutButton} type="button" onClick={() => void logout()}><LogOut size={16} /> Changer de session</button> : null}{authError ? <div className={styles.alert} role="alert"><CircleAlert size={17} />{authError}</div> : null}<Link href="/"><ArrowLeft size={15} /> Retour à GUAD</Link></section></main>;

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}><Link href="/" aria-label="Retour à la carte"><ArrowLeft size={18} /></Link><span className={styles.mark}><Database size={18} /></span><div><strong>GUAD · Prospect Factory</strong><small>Explorer, certifier, activer</small></div></div>
        <div className={styles.dataset}><span className={styles.online} />{summary ? `${number.format(summary.total)} prospects uniques` : "Connexion à DuckDB…"}{overview?.status.databaseSizeBytes ? ` · ${(overview.status.databaseSizeBytes / 1024 ** 3).toFixed(1)} Go` : ""}<button type="button" onClick={() => void logout()} aria-label="Fermer la session"><LogOut size={15} /></button></div>
      </header>
      <nav className={styles.tabs} aria-label="Sections Prospect Factory">
        <button type="button" className={view === "explore" ? styles.activeTab : ""} onClick={() => setView("explore")}><Search size={16} /> Explorer</button>
        <button type="button" className={view === "tracking" ? styles.activeTab : ""} onClick={() => setView("tracking")}><Users size={16} /> Suivi commercial <span>{tracking?.counts.total ?? 0}</span></button>
        <button type="button" className={view === "quality" ? styles.activeTab : ""} onClick={() => setView("quality")}><ShieldCheck size={16} /> Qualité des données</button>
        <button type="button" className={view === "segments" ? styles.activeTab : ""} onClick={() => setView("segments")}><Save size={16} /> Ciblages enregistrés <span>{segments.length}</span></button>
      </nav>

      {overviewError ? <div className={styles.alert}><CircleAlert size={18} />{overviewError}</div> : null}

      {view === "explore" ? <div className={styles.workspace}>
        <aside className={styles.filters}>
          <div className={styles.sectionTitle}><div><span>Filtres serveur</span><h2>Construire un ciblage</h2></div><div className={styles.filterActions}>{activeFilters ? <b>{activeFilters}</b> : null}<button type="button" onClick={clearFilters} disabled={!hasDraftFilters || loading} aria-label="Effacer tous les filtres"><X size={13} /> Tout effacer</button></div></div>
          <label>Entreprise, activité ou identifiant<input value={draft.query ?? ""} onChange={(event) => setDraft({ ...draft, query: event.target.value })} placeholder="Nom, ville, activité, contact, SIREN…" /></label>
          <div className={styles.facetStatus} aria-live="polite">{facetsLoading ? <><RefreshCw className={styles.spin} size={13} /> Mise à jour des valeurs compatibles…</> : facets ? <><BadgeCheck size={13} /> Valeurs compatibles · {facets.cached ? "cache" : `${number.format(facets.elapsedMs)} ms`}</> : "Préparation des filtres…"}</div>
          {draft.query ? <p className={styles.facetHint}>Les listes reflètent les filtres structurés ; le texte s’applique à la recherche.</p> : null}
          {facetsNotice ? <p className={styles.facetNotice}>{facetsNotice}</p> : null}
          {facetsError ? <p className={styles.facetError}>{facetsError}</p> : null}
          <label>Pays<select aria-label="Pays" aria-busy={facetsLoading} value={draft.country ?? ""} onChange={(event) => setDraft({ ...draft, country: event.target.value || undefined, territory: undefined })}><option value="">Tous les pays</option>{countries.map((item) => <option key={item.value} value={item.value} disabled={item.count === 0 && item.value !== draft.country}>{optionLabel(item.value, item.count)}</option>)}</select></label>
          <label>Territoire<select aria-label="Territoire" aria-busy={facetsLoading} value={draft.territory ?? ""} onChange={(event) => setDraft({ ...draft, territory: event.target.value || undefined })}><option value="">Tous les territoires</option>{territories.map((item) => <option key={item.value} value={item.value} disabled={item.count === 0 && item.value !== draft.territory}>{optionLabel(item.value, item.count)}</option>)}</select></label>
          <label>Vertical<select aria-label="Vertical" aria-busy={facetsLoading} value={draft.vertical ?? ""} onChange={(event) => setDraft({ ...draft, vertical: event.target.value || undefined })}><option value="">Tous les verticals</option>{verticals.map((item) => <option key={item.value} value={item.value} disabled={item.count === 0 && item.value !== draft.vertical}>{optionLabel(item.value, item.count)}</option>)}</select></label>
          <label>Source<select aria-label="Source" aria-busy={facetsLoading} value={draft.origin ?? ""} onChange={(event) => setDraft({ ...draft, origin: event.target.value || undefined })}><option value="">Toutes les sources</option>{origins.map((item) => <option key={item.value} value={item.value} disabled={item.count === 0 && item.value !== draft.origin}>{optionLabel(item.value, item.count)}</option>)}</select></label>
          <div className={styles.twoColumns}>
            <label>Certification<select aria-label="Certification" aria-busy={facetsLoading} value={draft.certification ?? ""} onChange={(event) => setDraft({ ...draft, certification: event.target.value as ProspectFactoryFilters["certification"] || undefined })}><option value="">Tous niveaux</option>{certifications.map((item) => <option key={item.value} value={item.value} disabled={item.count === 0 && item.value !== draft.certification}>{optionLabel(item.value === "gold" ? "Gold" : item.value === "silver" ? "Silver" : item.value === "bronze" ? "Bronze" : "Bloqué", item.count)}</option>)}</select></label>
            <label>Contact<select aria-label="Contact" aria-busy={facetsLoading} value={draft.contact ?? ""} onChange={(event) => setDraft({ ...draft, contact: event.target.value as ProspectFactoryFilters["contact"] || undefined })}><option value="">Tous, avec ou sans contact</option>{contacts.map((item) => <option key={item.value} value={item.value} disabled={item.count === 0 && item.value !== draft.contact}>{optionLabel(contactLabel(item.value), item.count)}</option>)}</select></label>
          </div>
          <label>Score minimum <strong>{draft.minScore ?? 0}</strong><input type="range" min="0" max="100" step="5" value={draft.minScore ?? 0} onChange={(event) => setDraft({ ...draft, minScore: Number(event.target.value) })} /></label>
          <button type="button" className={styles.primary} onClick={applyFilters} disabled={loading}><Filter size={16} />{loading ? "Calcul…" : "Appliquer les filtres"}</button>
          {namingSegment ? <div className={styles.segmentComposer}><label>Nom du ciblage<input autoFocus value={segmentName} maxLength={80} onChange={(event) => setSegmentName(event.target.value)} placeholder="Ex. Artisans Guadeloupe Gold" /></label><div><button type="button" className={styles.primary} onClick={saveSegment}><Save size={15} /> Enregistrer</button><button type="button" className={styles.iconButton} onClick={() => setNamingSegment(false)} aria-label="Annuler"><X size={16} /></button></div></div> : <button type="button" className={styles.secondary} onClick={() => setNamingSegment(true)}><Save size={16} /> Enregistrer le ciblage</button>}
          <p className={styles.help}>Les filtres se recroisent automatiquement. Seules {pageSize} lignes sont transmises au navigateur par page.</p>
        </aside>

        <section className={styles.results}>
          <div className={styles.resultHeader}><div><span>Résultats dédupliqués</span><h1>{resultLabel}</h1><p>{result ? `Requête ${result.cached ? "mise en cache" : "calculée"} en ${number.format(result.elapsedMs)} ms` : "Chargement…"}</p></div><a className={styles.export} href={`/api/prospect-factory/export?${paramsFor(applied, { limit: 5000 })}`}><Download size={16} /> Exporter 5 000</a></div>
          {searchError ? <div className={styles.alert}><CircleAlert size={17} />{searchError}</div> : null}
          <div className={styles.localToolbar} aria-label="Organisation locale des lignes"><div className={styles.localToolbarHeading}><Filter size={16} /><div><strong>Organisation locale</strong><span>{number.format(localVisibleRows.length)} visible(s) sur {number.format(rows.length)} chargée(s){localFilterSummary}</span></div></div><p>Recherche par colonne · cliquez sur un en-tête pour trier.</p><button type="button" className={styles.localClear} onClick={clearLocalOrganization} disabled={!hasLocalOrganization}><X size={14} /> Effacer</button></div>
          <div className={styles.tableWrap} aria-busy={loading}><table><thead><tr>{localColumnDefinitions.map(({ key, label }) => <th key={key} scope="col"><button type="button" className={`${styles.sortButton} ${localSort?.column === key ? styles.sorted : ""}`} onClick={() => toggleLocalSort(key)} aria-label={`Trier par ${label}`}><span>{label}</span><span className={styles.sortGlyph} aria-hidden="true">{localSort?.column === key ? localSort.direction === "asc" ? "↑" : "↓" : "↕"}</span></button></th>)}<th scope="col">Action</th></tr><tr className={styles.columnSearchRow}>{localColumnDefinitions.map(({ key, label, placeholder }) => <th key={key} scope="col"><label className={styles.columnSearch}><Search size={13} aria-hidden="true" /><span className={styles.srOnly}>Rechercher dans {label}</span><input type="search" value={localColumnFilters[key]} onChange={(event) => setLocalColumnFilter(key, event.target.value)} placeholder={placeholder} aria-label={`Rechercher dans ${label}`} /><select value={localColumnOptions[key].includes(localColumnFilters[key]) ? localColumnFilters[key] : ""} onChange={(event) => setLocalColumnFilter(key, event.target.value)} aria-label={`Valeur unique de ${label}`}><option value="">Toutes les valeurs</option>{localColumnOptions[key].map((value) => <option key={`${key}-${value}`} value={value}>{value}</option>)}</select></label></th>)}<th /></tr></thead><tbody>
            {localVisibleRows.map((row) => <tr key={row.warehouseId} className={styles.selectableRow} onClick={() => setSelectedProspect(row)}><td><button type="button" className={styles.prospectLink} onClick={() => setSelectedProspect(row)} aria-label={`Ouvrir la fiche de ${row.commercialName || row.companyName}`}><strong>{row.commercialName || row.companyName}</strong><small>{row.dedupeKey}</small></button>{row.tracking ? <span className={`${styles.pipelineBadge} ${styles[row.tracking.status]}`}>{qualificationLabels[row.tracking.status]}</span> : null}</td><td>{[row.city, row.region].filter(Boolean).join(", ") || row.territory}<small>{row.country}</small></td><td>{row.vertical || "Non classé"}<small>{row.activityDetail || row.activityCategory || "Détail non renseigné"}</small></td><td><strong>{row.employeeCount ? `${row.employeeCount} salarié${row.employeeCount === "1" ? "" : "s"}` : row.employeeRange || "Non renseigné"}</strong><small>{[row.employeeYear, row.employeeScope].filter(Boolean).join(" · ") || row.employeeDataStatus || "Effectif à confirmer"}</small></td><td><strong>{row.capitalSocial === null || row.capitalSocial === undefined ? "Non renseigné" : currency.format(row.capitalSocial)}</strong><small>{[row.capitalReferenceDate, row.capitalSource].filter(Boolean).join(" · ") || "Capital à vérifier"}</small></td><td><strong>{row.persona || "Non renseigné"}</strong><small>{row.contactType || "Persona à préciser"}</small></td><td><strong>{row.icp || "Non renseigné"}</strong><small>{row.approachAngle || "ICP à préciser"}</small></td><td><span className={styles.contact}>{row.email ? <Mail size={14} /> : null}{row.phone ? <Phone size={14} /> : null}{row.email || row.phone || row.website || "À enrichir"}</span><small>{row.contactName}</small></td><td><span className={`${styles.badge} ${styles[row.certification]}`}>{certificationLabel(row.certification)}</span><small>{row.qualityReasons.slice(0, 2).join(" · ")}</small></td><td><strong>{row.leadScore}</strong><small>{row.prioritySegment}</small></td><td>{row.recordOrigin}<small>{row.sourceReferenceDate || row.retrievedAt || "Date inconnue"}</small></td><td><button type="button" className={styles.dismissButton} onClick={(event) => { event.stopPropagation(); void dismissFromExplorer(row); }} disabled={Boolean(row.tracking) || dismissBusyId === row.warehouseId} aria-label={`Écarter ${row.commercialName || row.companyName}`}>{dismissBusyId === row.warehouseId ? "…" : row.tracking?.status === "disqualified" ? "Écarté" : "Ne m’intéresse pas"}</button></td></tr>)}
            {!loading && !localVisibleRows.length ? <tr><td colSpan={12} className={styles.empty}>{rows.length ? "Aucune ligne ne correspond à votre organisation locale." : "Aucun prospect ne correspond à ces filtres."}</td></tr> : null}
          </tbody></table></div>
          <div className={styles.pagination} aria-label="Pagination des prospects">
            <label>Lignes par page<select aria-label="Nombre de lignes par page" value={pageSize} onChange={(event) => changePageSize(Number(event.target.value))} disabled={loading}><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label>
            <p><strong>{firstVisible ? `${number.format(firstVisible)}–${number.format(lastVisible)}` : "0"}</strong>{result?.total !== null && result?.total !== undefined ? ` sur ${number.format(result.total)}` : ""}<span>Page {pageIndex + 1}</span></p>
            <div><button type="button" onClick={previousPage} disabled={loading || pageIndex === 0}><ArrowLeft size={15} /> Précédente</button><button type="button" onClick={nextPage} disabled={loading || !result?.nextCursor}>Suivante {loading ? <RefreshCw className={styles.spin} size={15} /> : <ArrowRight size={15} />}</button></div>
          </div>
        </section>
      </div> : null}

      {view === "tracking" ? <section className={styles.trackingPage}>
        <header className={styles.pageHeading}><div><span>Espace de travail</span><h1>Suivi commercial <em>{number.format(tracking?.counts.total ?? 0)} prospects</em></h1></div><div className={styles.pageHeadingActions}><button type="button" className={styles.primary} onClick={() => setManualProspectOpen(true)}><Users size={16} /> Ajouter un prospect</button><button type="button" className={styles.refreshTracking} onClick={refreshCrm} disabled={trackingLoading} aria-label="Actualiser le suivi"><RefreshCw className={trackingLoading ? styles.spin : ""} size={16} /><span>Actualiser</span></button></div></header>
        <div className={styles.trackingViewBar}>
          <div><strong>Mes prospects</strong><span>{trackingViewMode === "rows" ? "Liste détaillée" : trackingViewMode === "kanban" ? "Pipeline par étape commerciale" : trackingViewMode === "market" ? "ICP, segments et comptes" : "Organisation et décision par compte"}</span></div>
          <div className={styles.trackingViewSwitch} role="group" aria-label="Choisir la présentation du suivi commercial">
            <button type="button" aria-pressed={trackingViewMode === "rows"} onClick={() => changeTrackingView("rows")}>Liste</button>
            <button type="button" aria-pressed={trackingViewMode === "kanban"} onClick={() => changeTrackingView("kanban")}>Kanban</button>
            <button type="button" aria-pressed={trackingViewMode === "market"} onClick={() => changeTrackingView("market")}>Vue Marché</button>
            <button type="button" aria-pressed={trackingViewMode === "map"} onClick={() => changeTrackingView("map")}>Cartographie</button>
          </div>
        </div>
        <details className={styles.trackingInsights}>
          <summary><span><BarChart3 size={16} /> Tableau de bord</span><span className={styles.insightsHighlights}><strong className={(tracking?.counts.overdueNextActions ?? 0) > 0 ? styles.insightsAlert : ""}>{number.format(tracking?.counts.overdueNextActions ?? 0)} en retard</strong><strong>{weeklyNewContacts === null ? "—" : number.format(weeklyNewContacts)} / {weeklyTarget} contacts cette semaine</strong></span><span className={styles.insightsToggle}>Détails</span></summary>
          <div className={styles.trackingInsightsContent}>
        <section className={styles.trackingLeadMetrics} aria-label="Rythme hebdomadaire de prospection">
          <article className={styles.weeklyGoal}>
            <div><span>Nouveaux contacts approchés</span><strong>{weeklyNewContacts === null ? `— / ${weeklyTarget}` : `${number.format(weeklyNewContacts)} / ${weeklyTarget}`}</strong><small>Semaine ISO · {trackingStats?.reportingTimezone ?? "Europe/Paris"} · premières approches uniquement</small></div>
            {weeklyNewContacts !== null ? <div className={styles.goalProgress} aria-label={`${weeklyNewContacts} nouveaux contacts approchés sur un objectif de ${weeklyTarget}`}><span style={{ width: `${Math.min(100, Math.round((weeklyNewContacts / weeklyTarget) * 100))}%` }} /><small>{weeklyRemaining === 0 ? "Objectif atteint" : `${number.format(weeklyRemaining ?? 0)} restant${weeklyRemaining === 1 ? "" : "s"}`}</small></div> : <small className={styles.goalUnavailable}>Chargement de l’indicateur…</small>}
          </article>
          <article><span>Relances réalisées</span><strong>{weeklyFollowUps === null ? "—" : number.format(weeklyFollowUps)}</strong><small>{weeklyApproachEvents === null ? "Comptées séparément des nouveaux contacts" : `${number.format(weeklyApproachEvents)} action${weeklyApproachEvents > 1 ? "s" : ""} d’approche au total`}</small></article>
          <article><span>Comptes approchés</span><strong>{weeklyNewAccounts === null ? "—" : number.format(weeklyNewAccounts)}</strong><small>Indicateur secondaire : un même compte peut avoir plusieurs contacts</small></article>
        </section>
        {trackingStatsError ? <div className={styles.statsNotice} role="status"><CircleAlert size={16} aria-hidden="true" />{trackingStatsError}</div> : null}
        <section className={styles.tierSummary} aria-label="Répartition de la qualification">
          <header><span>Qualification sourcée</span><p>Le tier complète le statut commercial ; il ne le remplace pas.</p></header>
          <article className={styles.tierSummaryA}><span>Tier A</span><strong>{number.format(tierCounts?.A ?? 0)}</strong><small>priorisation forte</small></article>
          <article className={styles.tierSummaryB}><span>Tier B</span><strong>{number.format(tierCounts?.B ?? 0)}</strong><small>enrichissement ciblé</small></article>
          <article className={styles.tierSummaryPending}><span>À scorer</span><strong>{number.format(tierCounts?.unscored ?? 0)}</strong><small>preuve à compléter</small></article>
        </section>
        <div className={styles.pipelineSummary} aria-label="Indicateurs du suivi commercial">
          <article><span>Prospects suivis</span><strong>{number.format(tracking?.counts.total ?? 0)}</strong><small>fiches dans le pipeline</small></article>
          <article><span>À qualifier</span><strong>{number.format(tracking?.counts.byStatus.to_qualify ?? 0)}</strong><small>à examiner en priorité</small></article>
          <article><span>En discussion</span><strong>{number.format(tracking?.counts.byStatus.in_conversation ?? 0)}</strong><small>échanges en cours</small></article>
          <article><span>Opportunités</span><strong>{number.format(tracking?.counts.byStatus.opportunity ?? 0)}</strong><small>potentiel commercial confirmé</small></article>
          <article><span>Actions en retard</span><strong>{number.format(tracking?.counts.overdueNextActions ?? 0)}</strong><small>relances à traiter</small></article>
          <article><span>Sans prochaine action</span><strong>{number.format(tracking?.counts.withoutNextAction ?? 0)}</strong><small>fiches à planifier</small></article>
          <article><span>Taux contacté</span><strong>{percent(contactedCount, trackedTotal)}</strong><small>{number.format(contactedCount)} fiche(s) avec échange</small></article>
          <article><span>Taux opportunité</span><strong>{percent(opportunityCount, trackedTotal)}</strong><small>{number.format(opportunityCount)} opportunité(s) ou client(s)</small></article>
          <article><span>Pipeline brut</span><strong>{currency.format(tracking?.counts.pipelineValue ?? 0)}</strong><small>valeur des affaires ouvertes</small></article>
          <article><span>Pipeline pondéré</span><strong>{currency.format(tracking?.counts.weightedPipelineValue ?? 0)}</strong><small>valeur × probabilité</small></article>
          <article><span>Gagné</span><strong>{currency.format(tracking?.counts.wonValue ?? 0)}</strong><small>valeur des affaires gagnées</small></article>
        </div>
          </div>
        </details>
        {trackingViewMode === "market" ? <MarketView onOpenProspect={(prospect, tab, contactId) => { setSelectedProspectTab(tab); setSelectedActivityContactId(contactId ?? null); setSelectedProspect(trackedToFactoryRow(prospect)); }} refreshToken={marketRefreshToken} /> : trackingViewMode === "map" ? <AccountMapWorkspace /> : <>
        {trackingViewMode === "rows" ? <div className={styles.stageRail} aria-label="Filtrer par étape commerciale">
          <button type="button" className={!trackingStatus ? styles.activeStage : ""} onClick={() => { setTrackingStatus(""); setTrackingOffset(0); }}>Toutes <span>{tracking?.counts.total ?? 0}</span></button>
          {(Object.keys(qualificationLabels) as ProspectQualificationStatus[]).map((status) => <button type="button" key={status} className={trackingStatus === status ? styles.activeStage : ""} onClick={() => { setTrackingStatus(status); setTrackingOffset(0); }}>{qualificationLabels[status]} <span>{tracking?.counts.byStatus[status] ?? 0}</span></button>)}
        </div> : null}
        <div className={styles.trackingSearch} role="search">
          <Search size={17} aria-hidden="true" />
          <input type="search" aria-label="Rechercher un prospect dans le suivi" value={trackingDraftFilters.query ?? ""} onChange={(event) => setTrackingDraftFilters({ ...trackingDraftFilters, query: event.target.value.slice(0, 120) })} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); applyTrackingFilters(); } }} placeholder="Rechercher une entreprise, un contact, une ville…" />
          {trackingDraftFilters.query ? <button type="button" className={styles.trackingSearchClear} aria-label="Effacer la recherche" onClick={() => { setTrackingDraftFilters({ ...trackingDraftFilters, query: undefined }); setTrackingAppliedFilters({ ...trackingAppliedFilters, query: undefined }); setTrackingOffset(0); }}><X size={15} /></button> : null}
          <button type="button" className={styles.trackingSearchSubmit} onClick={applyTrackingFilters} disabled={trackingLoading}>Rechercher</button>
        </div>
        <details className={styles.trackingFilters}>
          <summary><span><Filter size={16} /> Filtres avancés</span><strong>{trackingActiveFilterCount ? `${trackingActiveFilterCount} actif${trackingActiveFilterCount > 1 ? "s" : ""}` : "Pays, secteur, score, priorité…"}</strong></summary>
        <div className={styles.trackingToolbar}>
          <div className={styles.trackingFilterHead}>
            <div><span>Affiner le suivi</span><strong>{trackingActiveFilterCount ? `${trackingActiveFilterCount} filtre${trackingActiveFilterCount > 1 ? "s" : ""} actif${trackingActiveFilterCount > 1 ? "s" : ""}` : "Choisissez vos critères"}</strong></div>
            <button type="button" onClick={clearTrackingFilters} disabled={!hasTrackingFilters}><X size={14} /> Tout effacer</button>
          </div>
          <div className={styles.trackingFilterGrid} aria-busy={trackingLoading}>
            <label>Pays<select value={trackingDraftFilters.country ?? ""} onChange={(event) => setTrackingDraftFilters({ ...trackingDraftFilters, country: event.target.value || undefined, territory: undefined })}><option value="">Tous les pays</option>{(tracking?.filterOptions.countries ?? []).map((item) => <option key={item.value} value={item.value}>{optionLabel(item.value, item.count)}</option>)}</select></label>
            <label>Territoire<select value={trackingDraftFilters.territory ?? ""} onChange={(event) => setTrackingDraftFilters({ ...trackingDraftFilters, territory: event.target.value || undefined })}><option value="">Tous les territoires</option>{(tracking?.filterOptions.territories ?? []).map((item) => <option key={item.value} value={item.value}>{optionLabel(item.value, item.count)}</option>)}</select></label>
            <label>Vertical<select value={trackingDraftFilters.vertical ?? ""} onChange={(event) => setTrackingDraftFilters({ ...trackingDraftFilters, vertical: event.target.value || undefined })}><option value="">Tous les secteurs</option>{(tracking?.filterOptions.verticals ?? []).map((item) => <option key={item.value} value={item.value}>{optionLabel(item.value, item.count)}</option>)}</select></label>
            <label>Source<select value={trackingDraftFilters.origin ?? ""} onChange={(event) => setTrackingDraftFilters({ ...trackingDraftFilters, origin: event.target.value || undefined })}><option value="">Toutes les sources</option>{(tracking?.filterOptions.origins ?? []).map((item) => <option key={item.value} value={item.value}>{optionLabel(item.value, item.count)}</option>)}</select></label>
            <label>Certification<select value={trackingDraftFilters.certification ?? ""} onChange={(event) => setTrackingDraftFilters({ ...trackingDraftFilters, certification: event.target.value as ProspectFactoryFilters["certification"] || undefined })}><option value="">Tous niveaux</option>{(tracking?.filterOptions.certifications ?? []).map((item) => <option key={item.value} value={item.value}>{optionLabel(certificationLabel(item.value), item.count)}</option>)}</select></label>
            <label>Contact<select value={trackingDraftFilters.contact ?? ""} onChange={(event) => setTrackingDraftFilters({ ...trackingDraftFilters, contact: event.target.value as ProspectFactoryFilters["contact"] || undefined })}><option value="">Avec ou sans coordonnées</option>{(tracking?.filterOptions.contacts ?? []).map((item) => <option key={item.value} value={item.value}>{optionLabel(trackingContactLabel(item.value), item.count)}</option>)}</select></label>
            <label>Priorité<select value={trackingPriority} onChange={(event) => { setTrackingPriority(event.target.value as ProspectPriority | ""); setTrackingOffset(0); }}><option value="">Toutes</option><option value="high">Haute</option><option value="normal">Normale</option><option value="low">Basse</option></select></label>
            <label className={styles.trackingScoreFilter}>Score minimum <strong>{trackingDraftFilters.minScore ?? 0}</strong><input type="range" min="0" max="100" step="5" value={trackingDraftFilters.minScore ?? 0} onChange={(event) => setTrackingDraftFilters({ ...trackingDraftFilters, minScore: Number(event.target.value) })} /></label>
          </div>
          <div className={styles.trackingFilterFoot}>
            <p>Les critères s’appliquent à toutes les lignes du suivi, même sur les pages suivantes. Le contact indique une coordonnée renseignée.</p>
            <button type="button" className={styles.primary} onClick={applyTrackingFilters} disabled={trackingLoading}><Filter size={15} /> Appliquer les filtres</button>
          </div>
        </div>
        </details>
        {trackingError ? <div className={styles.alert} role="alert"><CircleAlert size={17} />{trackingError}</div> : null}
        {trackingViewMode === "kanban" ? <div className={styles.trackingBoardWrap} aria-busy={trackingLoading}>
          {tracking?.prospects.length ? <>
            <p className={styles.trackingBoardNote}>Page {trackingPage} · {number.format(tracking.prospects.length)} cartes affichées sur {number.format(tracking.total)} prospects correspondant aux filtres. Utilisez la pagination pour parcourir la suite; cliquez sur une carte pour ouvrir sa fiche.</p>
            <div className={styles.trackingBoard} role="region" aria-label="Pipeline commercial par étape">
              {trackingBoardColumns.map(({ status, prospects }) => <section className={styles.trackingBoardColumn} key={status} aria-labelledby={`tracking-stage-${status}`}>
                <header><div><h3 id={`tracking-stage-${status}`}>{qualificationLabels[status]}</h3><span>{prospects.length} sur cette page</span></div><span className={`${styles.pipelineBadge} ${styles[status]}`}>{number.format(prospects.length)}</span></header>
                <div className={styles.trackingBoardCards}>
                  {prospects.map((prospect) => {
                    const name = prospect.snapshot.commercialName || prospect.snapshot.companyName;
                    const contactName = prospect.enrichment.contactName ?? prospect.contacts[0]?.name ?? prospect.snapshot.contactName;
                    const location = [prospect.snapshot.city, prospect.snapshot.territory, prospect.snapshot.country].filter(Boolean).join(" · ");
                    return <button type="button" className={styles.trackingBoardCard} key={prospect.id} onClick={() => setSelectedProspect(trackedToFactoryRow(prospect))} aria-label={`Ouvrir ${name}, ${qualificationLabels[status]}`}>
                      <strong>{name}</strong>
                      {location ? <small>{location}</small> : null}
                      <span className={styles.trackingBoardContact}>{contactName || "Contact non identifié"}</span>
                      <span className={styles.trackingBoardPriority}>Priorité {priorityLabels[prospect.qualification.priority].toLowerCase()}</span>
                      <span className={styles.trackingBoardAction}><Clock3 size={14} /><span><small>Prochaine action · {formatOptionalDate(prospect.qualification.nextActionAt)}</small><strong>{prospect.qualification.nextActionLabel || "À planifier"}</strong></span></span>
                      {prospect.qualification.potentialValue !== null ? <span className={styles.trackingBoardValue}>{currency.format(prospect.qualification.potentialValue)}{prospect.qualification.probability !== null ? ` · ${prospect.qualification.probability}%` : ""}</span> : null}
                    </button>;
                  })}
                  {!prospects.length ? <p className={styles.trackingBoardEmpty}>Aucune carte sur cette page</p> : null}
                </div>
              </section>)}
            </div>
          </> : !trackingLoading ? <div className={styles.emptyState}><Users size={28} /><h2>{tracking?.total ? "Aucun prospect dans ce filtre" : "Votre suivi commercial est vide"}</h2><p>{tracking?.total ? "Modifiez les critères du pipeline." : "Ouvrez une ligne dans Explorer, puis ajoutez-la au suivi."}</p><button type="button" onClick={() => setView("explore")}>Explorer les prospects <ArrowRight size={15} /></button></div> : null}
        </div> : <div className={styles.trackingList} aria-busy={trackingLoading}>
          {tracking?.prospects.map((prospect) => {
            const name = prospect.snapshot.commercialName || prospect.snapshot.companyName;
            const effectiveEmail = prospect.enrichment.email ?? prospect.snapshot.email;
            const effectivePhone = prospect.enrichment.phone ?? prospect.snapshot.phone;
            const statusLabel = qualificationLabels[prospect.qualification.status];
            const scoreLabel = qualificationScoreLabel(prospect.qualification.scoreTotal);
            const tierLabel = qualificationTierLabel(prospect.qualification.tier);
            const confidenceLabel = qualificationConfidenceLabel(prospect.qualification.confidence);
            return <button type="button" className={styles.trackingCard} key={prospect.id} onClick={() => setSelectedProspect(trackedToFactoryRow(prospect))} aria-label={`Ouvrir la fiche de ${name} : statut ${statusLabel}, ${scoreLabel}, ${tierLabel}, ${confidenceLabel}`}>
              <span className={styles.trackingIdentity}><strong>{name}</strong><small>{[prospect.snapshot.city, prospect.snapshot.territory, prospect.snapshot.country].filter(Boolean).join(" · ")}</small><span className={styles.trackingIdentityMeta}><span className={`${styles.tierBadge} ${prospect.qualification.tier ? styles[`tier${prospect.qualification.tier}`] : styles.tierPending}`}>{tierLabel}</span><small>{scoreLabel}</small></span></span>
              <span className={styles.trackingStatus}><small className={styles.trackingEyebrow}>Étape</small><span className={`${styles.pipelineBadge} ${styles[prospect.qualification.status]}`}>{statusLabel}</span><small>Priorité {priorityLabels[prospect.qualification.priority].toLowerCase()}{prospect.qualification.potentialValue !== null ? ` · ${currency.format(prospect.qualification.potentialValue)}` : ""}</small></span>
              <span className={styles.trackingContact}><small className={styles.trackingEyebrow}>Contact</small><strong>{prospect.enrichment.contactName ?? prospect.contacts[0]?.name ?? prospect.snapshot.contactName ?? "À identifier"}</strong><small>{effectiveEmail || effectivePhone || "Coordonnées à compléter"}</small></span>
              <span className={styles.nextAction}><Clock3 size={16} /><span><small className={styles.trackingEyebrow}>Prochaine action · {formatOptionalDate(prospect.qualification.nextActionAt)}</small><strong>{prospect.qualification.nextActionLabel || "À planifier"}</strong><small>{prospect.qualification.lastContactedAt ? `Dernier échange ${formatOptionalDate(prospect.qualification.lastContactedAt)}` : "Aucun échange enregistré"}</small></span></span>
              <ArrowRight size={17} />
            </button>;
          })}
          {!trackingLoading && !tracking?.prospects.length ? <div className={styles.emptyState}><Users size={28} /><h2>{tracking?.total ? "Aucun prospect dans ce filtre" : "Votre suivi commercial est vide"}</h2><p>{tracking?.total ? "Modifiez les critères du pipeline." : "Ouvrez une ligne dans Explorer, puis ajoutez-la au suivi."}</p><button type="button" onClick={() => setView("explore")}>Explorer les prospects <ArrowRight size={15} /></button></div> : null}
        </div>}
        <div className={styles.trackingPagination} aria-label="Pagination du suivi commercial">
          <label>Lignes par page<select aria-label="Nombre de prospects suivis par page" value={trackingPageSize} onChange={(event) => { setTrackingPageSize(Number(event.target.value)); setTrackingOffset(0); }} disabled={trackingLoading}><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label>
          <p><strong>{trackingFirst ? `${number.format(trackingFirst)}–${number.format(trackingLast)}` : "0"}</strong>{tracking ? ` sur ${number.format(tracking.total)}` : ""}<span>Page {trackingPage}</span></p>
          <div><button type="button" onClick={() => setTrackingOffset(Math.max(0, trackingOffset - trackingPageSize))} disabled={trackingLoading || trackingOffset === 0}><ArrowLeft size={15} /> Précédente</button><button type="button" onClick={() => setTrackingOffset(trackingOffset + trackingPageSize)} disabled={trackingLoading || !tracking || trackingLast >= tracking.total}>Suivante <ArrowRight size={15} /></button></div>
        </div>
        </>}
      </section> : null}

      {view === "quality" ? <section className={styles.qualityPage}>
        <header className={styles.pageHeading}><div><span>Certification technique</span><h1>Ce que la base permet réellement</h1><p>Les validations de forme ne sont jamais présentées comme une preuve de délivrabilité ou de consentement.</p></div><div className={styles.snapshot}><Activity size={18} /><span>Snapshot du {overview ? date.format(new Date(overview.snapshot.generatedAt)) : "…"}</span><small>Calcul complet hors ligne : {overview ? `${number.format(overview.snapshot.elapsedMs)} ms` : "…"}</small></div></header>
        {summary ? <div className={styles.metrics}>
          <article><span>Stock dédupliqué</span><strong>{compact.format(summary.total)}</strong><small>{number.format(summary.distinctDedupeKeys)} clés distinctes</small></article>
          <article><span>Enrichissables</span><strong>{compact.format(summary.enrichable)}</strong><small>identité, provenance et clé de jointure</small></article>
          <article><span>Contacts candidats</span><strong>{compact.format(summary.contactCandidate)}</strong><small>{percent(summary.contactCandidate, summary.total)} du stock · syntaxe plausible</small></article>
          <article><span>Sites observés</span><strong>{compact.format(summary.websiteObserved)}</strong><small>{percent(summary.websiteObserved, summary.total)} du stock · rattachement à confirmer</small></article>
          <article><span>Identité exploitable</span><strong>{compact.format(summary.identified)}</strong><small>{percent(summary.identified, summary.total)} avec nom et clé de déduplication</small></article>
          <article><span>Provenance traçable</span><strong>{compact.format(summary.traceable)}</strong><small>{percent(summary.traceable, summary.total)} avec source et date documentées</small></article>
          <article><span>E-mails plausibles</span><strong>{compact.format(summary.emailValidShape)}</strong><small>validation de forme uniquement</small></article>
          <article><span>Téléphones plausibles</span><strong>{compact.format(summary.phoneValidShape)}</strong><small>attribution et validité à confirmer</small></article>
        </div> : null}
        <div className={styles.qualityGrid}>
          <section className={styles.levels}><h2>Niveaux d’usage</h2>{(["gold", "silver", "bronze", "blocked"] as const).map((level) => <article key={level}><span className={`${styles.badge} ${styles[level]}`}>{certificationLabel(level)}</span><strong>{summary ? number.format(summary[level]) : "…"}</strong><p>{overview?.snapshot.definitions[level]}</p></article>)}</section>
          <section className={styles.coverage}><div className={styles.coverageHead}><div><span>Contrôle par dimension</span><h2>La moyenne globale ne masque pas les sources</h2></div><select aria-label="Dimension de qualité" value={qualityDimension} onChange={(event) => setQualityDimension(event.target.value as typeof qualityDimension)}><option value="origins">Sources</option><option value="countries">Pays</option><option value="territories">Territoires</option><option value="verticals">Verticals</option></select></div>
            <div className={styles.tableWrap}><table><thead><tr><th>Dimension</th><th>Total</th><th>Enrichissable</th><th>Email</th><th>Téléphone</th><th>Gold*</th></tr></thead><tbody>{qualityRows.slice(0, 100).map((item) => <tr key={item.value}><td><strong>{item.value}</strong></td><td>{number.format(item.total)}</td><td>{number.format(item.enrichable)}</td><td>{number.format(item.emailCandidates)}</td><td>{number.format(item.phoneCandidates)}</td><td>{number.format(item.gold)}</td></tr>)}</tbody></table></div><p className={styles.footnote}>* Gold signifie « candidat techniquement activable sous revalidation », jamais « contact vérifié ».</p>
          </section>
        </div>
      </section> : null}

      {view === "segments" ? <section className={styles.segmentsPage}><div className={styles.pageHeading}><div><span>Requêtes Explorer réutilisables</span><h1>Ciblages enregistrés</h1><p>Un ciblage conserve les filtres d’Explorer. Les segments ICP se gèrent dans la Vue Marché du suivi commercial.</p></div></div>{segments.length ? <div className={styles.segmentGrid}>{segments.map((segment) => <article key={segment.id}><BadgeCheck size={20} /><div><h2>{segment.name}</h2><p>{Object.entries(segment.filters).filter(([, value]) => value !== undefined && value !== "" && value !== 0).map(([key, value]) => `${key}: ${value}`).join(" · ") || "Sans filtre"}</p><small>Créé le {date.format(new Date(segment.createdAt))}</small></div><button type="button" onClick={() => { setDraft(segment.filters); setApplied(segment.filters); setPageCursors([null]); setPageIndex(0); setView("explore"); void search(segment.filters, null, pageSize, 0); }}>Ouvrir <ArrowRight size={15} /></button></article>)}</div> : <div className={styles.emptyState}><BarChart3 size={28} /><h2>Aucun ciblage enregistré</h2><p>Configurez les filtres dans Explorer, puis enregistrez la définition.</p></div>}</section> : null}
      {manualProspectOpen ? <ManualProspectForm onClose={() => setManualProspectOpen(false)} onCreated={(prospect) => { setManualProspectOpen(false); setSelectedProspect(trackedToFactoryRow(prospect)); refreshCrm(); }} /> : null}
      {selectedProspect ? <ProspectCrmDrawer prospect={selectedProspect} trackingId={selectedProspect.tracking?.id ?? null} initialTab={selectedProspectTab} initialContactId={selectedActivityContactId} onClose={() => { setSelectedProspect(null); setSelectedProspectTab(undefined); setSelectedActivityContactId(null); }} onChanged={refreshCrm} /> : null}
    </main>
  );
}
