"use client";

import { type FormEvent, type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  CircleAlert,
  Clock3,
  ExternalLink,
  LoaderCircle,
  Mail,
  MapPin,
  MessageSquareText,
  Network,
  Phone,
  Plus,
  Save,
  Search,
  Users,
  X
} from "lucide-react";
import type { ProspectFactoryRow } from "@/lib/prospect-factory-contract";
import { slugify } from "@/lib/slug";
import {
  PROSPECT_ACTIVITY_DETAIL_TYPES,
  PROSPECT_ACTIVITY_OUTCOMES,
  PROSPECT_PRIORITIES,
  PROSPECT_QUALIFICATION_STATUSES,
  type ProspectActivity,
  type ProspectActivityDirection,
  type ProspectActivityDetailType,
  type ProspectActivityOutcome,
  type ProspectActivityType,
  type ProspectBuyingCommitteeRole,
  type ProspectDealRole,
  type ProspectDecisionScope,
  type ProspectEvidenceType,
  type ProspectEnrichment,
  type ProspectObservationKind,
  type ProspectObservationStatus,
  type ProspectPriority,
  type ProspectQualification,
  type ProspectQualificationConfidence,
  type ProspectQualificationStatus,
  type ProspectQualificationTier,
  type ProspectResearchSourceType,
  type TrackedProspect
} from "@/lib/prospect-factory-crm-contract";
import styles from "./prospect-crm-drawer.module.css";
import { ContextualMapLink } from "./contextual-map-link";
import { CompanySignals } from "./company-signals";
import { CompanyOutreach } from "./company-outreach";
import type { MapReturnView } from "./prospect-navigation";

type DrawerTab = "tracking" | "research" | "copywriting" | "record" | "activity";
type EditableActivityType = Extract<ProspectActivityType, "note" | "call" | "email" | "meeting">;

type ProspectDetailResponse = {
  prospect: TrackedProspect;
  canonical: ProspectFactoryRow | null;
  activities: ProspectActivity[];
};

type ApiFailurePayload = {
  error?: string;
  code?: string;
  current?: TrackedProspect;
};

export type ProspectCrmDrawerProps = {
  prospect: ProspectFactoryRow;
  trackingId?: string | null;
  initialTab?: DrawerTab;
  initialContactId?: string | null;
  mapReturnView?: MapReturnView;
  onClose: () => void;
  onChanged: () => void;
};

const statusLabels: Record<ProspectQualificationStatus, string> = {
  to_qualify: "À qualifier",
  qualified: "Qualifié",
  to_contact: "À contacter",
  contacted: "Contacté",
  in_conversation: "En échange",
  opportunity: "Opportunité",
  won: "Gagné · client",
  lost: "Perdu",
  disqualified: "Écarté"
};

const priorityLabels: Record<ProspectPriority, string> = {
  high: "Haute",
  normal: "Normale",
  low: "Basse"
};

const activityRequiredStatuses = new Set<ProspectQualificationStatus>(["contacted", "in_conversation", "opportunity", "won", "lost"]);

function statusRequiresLoggedActivity(status: ProspectQualificationStatus) {
  return activityRequiredStatuses.has(status);
}

const tierLabels: Record<ProspectQualificationTier, string> = {
  A: "Tier A · à prioriser",
  B: "Tier B · à enrichir",
  C: "Tier C · pause par défaut"
};

const confidenceLabels: Record<ProspectQualificationConfidence, string> = {
  high: "Confiance élevée",
  medium: "Confiance moyenne",
  low: "À confirmer"
};

const evidenceTypeLabels: Record<ProspectEvidenceType, string> = {
  official: "Source officielle",
  apollo_input: "Fourni par Apollo · non confirmé",
  to_confirm: "À confirmer"
};

const observationStatusLabels: Record<ProspectObservationStatus, string> = {
  observed: "Fait observé",
  hypothesis: "Hypothèse",
  to_confirm: "À confirmer"
};

const observationKindLabels: Record<ProspectObservationKind, string> = {
  business_fact: "Fait métier",
  pain_signal: "Signal de douleur",
  trigger: "Trigger",
  buying_committee: "Buying committee",
  other: "Autre"
};

const buyingCommitteeLabels: Record<ProspectBuyingCommitteeRole, string> = {
  user: "Utilisateur",
  champion: "Champion",
  sponsor: "Sponsor",
  economic_buyer: "Acheteur économique",
  technical_buyer: "Acheteur technique",
  procurement: "Achats",
  blocker: "Bloqueur"
};

const researchSourceTypeLabels: Record<ProspectResearchSourceType, string> = {
  official_website: "Site officiel",
  report: "Rapport",
  press_release: "Communiqué",
  investor: "Investisseur",
  regulatory: "Réglementaire",
  secondary: "Source secondaire"
};

const activityTypeLabels: Record<EditableActivityType | "status_change" | "enrichment", string> = {
  note: "Note",
  call: "Appel",
  email: "E-mail",
  meeting: "Rendez-vous",
  status_change: "Changement de statut",
  enrichment: "Enrichissement"
};

const dealRoleLabels: Record<ProspectDealRole, string> = {
  champion: "Champion",
  economic_decision_maker: "Décideur économique",
  business_decision_maker: "Décideur métier",
  user: "Utilisateur",
  influencer: "Influenceur",
  gatekeeper: "Gatekeeper",
  it_security: "IT / sécurité",
  procurement: "Achats",
  unknown: "Rôle inconnu"
};

const decisionScopeLabels: Record<ProspectDecisionScope, string> = {
  local: "Décision locale",
  headquarters: "Décision au siège",
  both: "Local et siège",
  unknown: "Niveau de décision à confirmer"
};

const activityDetailLabels: Record<ProspectActivityDetailType, string> = {
  email: "E-mail",
  call: "Appel",
  linkedin_connection: "Ajout LinkedIn",
  linkedin_message: "Message LinkedIn",
  meeting: "Rendez-vous",
  follow_up: "Relance",
  note: "Note",
  proposal: "Proposition",
  other: "Autre"
};

function baseActivityType(detailType: ProspectActivityDetailType): EditableActivityType {
  if (detailType === "call") return "call";
  if (detailType === "meeting") return "meeting";
  if (detailType === "note" || detailType === "other") return "note";
  return "email";
}

const outcomeLabels: Record<ProspectActivityOutcome, string> = {
  reached: "Contact établi",
  no_answer: "Sans réponse",
  replied: "Réponse reçue",
  interested: "Intéressé",
  follow_up: "À relancer",
  meeting_booked: "Rendez-vous pris",
  not_interested: "Non intéressé",
  wrong_contact: "Mauvais contact",
  other: "Autre"
};

const directionLabels: Record<ProspectActivityDirection, string> = {
  inbound: "Entrant",
  outbound: "Sortant",
  internal: "Interne"
};

const certificationLabels: Record<ProspectFactoryRow["certification"], string> = {
  gold: "Gold · à revalider",
  silver: "Silver · enrichissable",
  bronze: "Bronze · analytique",
  blocked: "Bloqué"
};

const dateTime = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });
const dateOnly = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "Europe/Paris" });

const emptyEnrichment: ProspectEnrichment = {
  contactName: null,
  email: null,
  phone: null,
  website: null,
  jobTitle: null,
  linkedin: null,
  address: null
};

const emptyQualification: ProspectQualification = {
  status: "to_qualify",
  priority: "normal",
  tags: [],
  notes: "",
  nextActionLabel: null,
  nextActionAt: null,
  lastContactedAt: null,
  owner: null,
  campaign: null,
  potentialValue: null,
  probability: null,
  expectedCloseAt: null,
  disqualificationReason: null,
  fitScore: null,
  painScore: null,
  timingScore: null,
  personaScore: null,
  scoreTotal: null,
  tier: null,
  confidence: null,
  scoreReason: null
};

class ApiFailure extends Error {
  code?: string;
  current?: TrackedProspect;

  constructor(message: string, payload?: ApiFailurePayload) {
    super(message);
    this.name = "ApiFailure";
    this.code = payload?.code;
    this.current = payload?.current;
  }
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => null) as (T & ApiFailurePayload) | null;
  if (!response.ok) throw new ApiFailure(payload?.error ?? "L’opération n’a pas abouti.", payload ?? undefined);
  if (!payload) throw new ApiFailure("La réponse du serveur est vide.");
  return payload;
}

function nullable(value: string) {
  return value.trim() || null;
}

function localDateTime(value: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const offset = parsed.getTimezoneOffset() * 60_000;
  return new Date(parsed.getTime() - offset).toISOString().slice(0, 16);
}

function isoDateTime(value: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function safeHttpUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeResearchUrl(value: string | null | undefined) {
  const href = safeHttpUrl(value);
  if (!href) return null;
  try {
    const hostname = new URL(href).hostname.toLowerCase();
    return hostname === "linkedin.com" || hostname.endsWith(".linkedin.com") ? null : href;
  } catch {
    return null;
  }
}

function sourceLinks(value: string) {
  let candidates: string[] = [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) candidates = parsed.filter((item): item is string => typeof item === "string");
  } catch {
    candidates = value.split(/[\s,;|]+/);
  }
  return [...new Set(candidates.map((item) => safeResearchUrl(item)).filter((item): item is string => Boolean(item)))].slice(0, 3);
}

function tagsFromInput(value: string) {
  return [...new Set(value.split(",").map((tag) => tag.trim().slice(0, 60)).filter(Boolean))].slice(0, 20);
}

function displayDate(value: string | null, withTime = true) {
  if (!value) return "Non renseigné";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Date inconnue";
  return withTime ? dateTime.format(parsed) : dateOnly.format(parsed);
}

function displayScore(value: number | null | undefined, maximum: number) {
  return typeof value === "number" ? `${value}/${maximum}` : `—/${maximum}`;
}

function scoreLabel(value: number | null | undefined) {
  return typeof value === "number" ? `${value}/100` : "Score à établir";
}

function tierLabel(value: ProspectQualificationTier | null | undefined) {
  return value ? tierLabels[value] : "Tier à établir";
}

function confidenceLabel(value: ProspectQualificationConfidence | null | undefined) {
  return value ? confidenceLabels[value] : "Confiance à confirmer";
}

function sourceDomain(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

export function ProspectCrmDrawer({ prospect: row, trackingId, initialTab, initialContactId, mapReturnView = "market", onClose, onChanged }: ProspectCrmDrawerProps) {
  const effectiveTrackingId = trackingId ?? row.tracking?.id ?? null;
  const [tab, setTab] = useState<DrawerTab>(initialTab ?? (effectiveTrackingId ? "tracking" : "record"));
  const [prospect, setProspect] = useState<TrackedProspect | null>(null);
  const [canonical, setCanonical] = useState<ProspectFactoryRow>(row);
  const [activities, setActivities] = useState<ProspectActivity[]>([]);
  const [enrichment, setEnrichment] = useState<ProspectEnrichment>(emptyEnrichment);
  const [qualification, setQualification] = useState<ProspectQualification>(emptyQualification);
  const [tagsInput, setTagsInput] = useState("");
  const [activityDetailType, setActivityDetailType] = useState<ProspectActivityDetailType>("note");
  const [activityDirection, setActivityDirection] = useState<Extract<ProspectActivityDirection, "inbound" | "outbound">>("outbound");
  const [activityOutcome, setActivityOutcome] = useState<ProspectActivityOutcome | "">("");
  const [activityContactId, setActivityContactId] = useState(initialContactId ?? "");
  const [activitySubject, setActivitySubject] = useState("");
  const [activityBody, setActivityBody] = useState("");
  const [activityOccurredAt, setActivityOccurredAt] = useState(() => localDateTime(new Date().toISOString()));
  const [activityStatusAfter, setActivityStatusAfter] = useState<ProspectQualificationStatus | "">("");
  const [activityNextActionAt, setActivityNextActionAt] = useState("");
  const [activityNextActionLabel, setActivityNextActionLabel] = useState("");
  const [loading, setLoading] = useState(Boolean(effectiveTrackingId));
  const [saving, setSaving] = useState<"tracking" | "record" | "qualification" | "activity" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const returnFocusLabelRef = useRef<string | null>(null);
  const closeHandlerRef = useRef(onClose);
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);

  const companyName = canonical.commercialName || canonical.companyName;
  const activityType = baseActivityType(activityDetailType);
  const links = useMemo(() => sourceLinks(canonical.sourceUrls), [canonical.sourceUrls]);
  const visibleResearchSources = prospect?.researchSources.filter((source) => Boolean(safeResearchUrl(source.url))) ?? [];
  const publicCompanyHref = canonical.siren
    ? `/entreprises/${slugify(canonical.city || canonical.territory || "guadeloupe")}/${slugify(companyName)}-${canonical.siren}`
    : null;
  const googleMapsHref = safeResearchUrl(canonical.googleMapsUrl);

  function hydrate(next: TrackedProspect) {
    setProspect(next);
    setEnrichment(next.enrichment);
    setQualification(next.qualification);
    setTagsInput(next.qualification.tags.join(", "));
  }

  useEffect(() => {
    closeHandlerRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [tab]);

  function requestClose() {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    window.setTimeout(() => closeHandlerRef.current(), 220);
  }

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    returnFocusLabelRef.current = returnFocusRef.current?.getAttribute("aria-label") ?? null;
    const overlay = overlayRef.current;
    const inertSiblings = [...document.body.children].filter((element) => element !== overlay).map((element) => ({ element, wasInert: element.hasAttribute("inert") }));
    inertSiblings.forEach(({ element }) => element.setAttribute("inert", ""));
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
      }
    };
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onDocumentKeyDown);
      document.body.style.overflow = previousOverflow;
      inertSiblings.forEach(({ element, wasInert }) => { if (!wasInert) element.removeAttribute("inert"); });
      const original = returnFocusRef.current;
      const replacement = !original?.isConnected && returnFocusLabelRef.current
        ? [...document.querySelectorAll<HTMLElement>("[aria-label]")].find((element) => element.getAttribute("aria-label") === returnFocusLabelRef.current)
        : null;
      (original?.isConnected ? original : replacement)?.focus();
    };
  }, []);

  useEffect(() => {
    if (!effectiveTrackingId) return;
    const controller = new AbortController();
    void apiJson<ProspectDetailResponse>(`/api/prospect-factory/crm/prospects/${encodeURIComponent(effectiveTrackingId)}`, { signal: controller.signal })
      .then((payload) => {
        setError(null);
        hydrate(payload.prospect);
        if (payload.canonical) setCanonical({
          ...payload.canonical,
          siren: payload.prospect.market.siren ?? payload.canonical.siren,
          siret: payload.prospect.market.siret ?? payload.canonical.siret,
          employeeCount: payload.prospect.market.employeeCountEstimate === null ? payload.canonical.employeeCount : String(payload.prospect.market.employeeCountEstimate)
        });
        setActivities(payload.activities);
      })
      .catch((caught: unknown) => {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) setError(caught instanceof Error ? caught.message : "Chargement de la fiche impossible.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [effectiveTrackingId]);

  function trapFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.hasAttribute("hidden") && element.getClientRects().length > 0);
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

  function navigateTabs(event: ReactKeyboardEvent<HTMLElement>) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const order: DrawerTab[] = ["tracking", "research", "copywriting", "record", "activity"];
    const currentIndex = order.indexOf(tab);
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? order.length - 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (currentIndex - 1 + order.length) % order.length : (currentIndex + 1) % order.length;
    const next = order[nextIndex];
    setTab(next);
    window.requestAnimationFrame(() => document.getElementById(`prospect-tab-${next}`)?.focus());
  }

  function notify(next: TrackedProspect, message: string) {
    hydrate(next);
    onChanged();
    setAnnouncement(message);
  }

  async function addToTracking() {
    setSaving("tracking");
    setError(null);
    try {
      const payload = await apiJson<ProspectDetailResponse & { created: boolean }>("/api/prospect-factory/crm/prospects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warehouseId: canonical.warehouseId })
      });
      notify(payload.prospect, payload.created ? "Prospect ajouté au suivi commercial." : "Ce prospect était déjà dans le suivi.");
      setActivities(payload.activities);
      if (payload.canonical) setCanonical(payload.canonical);
      setTab("tracking");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ajout au suivi impossible.");
    } finally {
      setSaving(null);
    }
  }

  async function updateTracked(body: { enrichment?: Partial<ProspectEnrichment>; qualification?: Partial<ProspectQualification> }, message: string) {
    if (!prospect) return;
    setError(null);
    try {
      const payload = await apiJson<{ prospect: TrackedProspect; activities?: ProspectActivity[] }>(`/api/prospect-factory/crm/prospects/${encodeURIComponent(prospect.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, expectedVersion: prospect.version })
      });
      if (payload.activities?.length) {
        const addedIds = new Set(payload.activities.map((item) => item.id));
        setActivities((current) => [...payload.activities!, ...current.filter((item) => !addedIds.has(item.id))]);
      }
      notify(payload.prospect, message);
    } catch (caught) {
      if (caught instanceof ApiFailure && caught.code === "VERSION_CONFLICT" && caught.current) {
        hydrate(caught.current);
        onChanged();
        setError("Cette fiche a été modifiée ailleurs. Les dernières valeurs ont été rechargées ; vérifiez-les avant de recommencer.");
      } else {
        setError(caught instanceof Error ? caught.message : "Enregistrement impossible.");
      }
    }
  }

  async function saveEnrichment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prospect) return;
    setSaving("record");
    await updateTracked({ enrichment: {
      contactName: nullable(enrichment.contactName ?? ""),
      jobTitle: nullable(enrichment.jobTitle ?? ""),
      email: nullable(enrichment.email ?? ""),
      phone: nullable(enrichment.phone ?? ""),
      website: nullable(enrichment.website ?? ""),
      address: nullable(enrichment.address ?? "")
    } }, "Enrichissement enregistré.");
    setSaving(null);
  }

  async function saveQualification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prospect) return;
    if (qualification.status !== prospect.qualification.status && statusRequiresLoggedActivity(qualification.status)) {
      setError("Pour passer à cette étape, consignez l’activité réelle dans l’historique afin de conserver la date d’action.");
      return;
    }
    setSaving("qualification");
    await updateTracked({ qualification: {
      status: qualification.status,
      priority: qualification.priority,
      tags: tagsFromInput(tagsInput),
      notes: qualification.notes,
      nextActionLabel: nullable(qualification.nextActionLabel ?? ""),
      nextActionAt: isoDateTime(localDateTime(qualification.nextActionAt)),
      owner: nullable(qualification.owner ?? ""),
      campaign: nullable(qualification.campaign ?? ""),
      potentialValue: qualification.potentialValue === null || qualification.potentialValue === undefined ? null : Number(qualification.potentialValue),
      probability: qualification.probability === null || qualification.probability === undefined ? null : Number(qualification.probability),
      expectedCloseAt: isoDateTime(localDateTime(qualification.expectedCloseAt)),
      disqualificationReason: nullable(qualification.disqualificationReason ?? "")
    } }, "Qualification commerciale enregistrée.");
    setSaving(null);
  }

  async function addActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prospect) return;
    const requiresContact = activityType !== "note" && activityDirection === "outbound" && prospect.contacts.length > 1;
    if (requiresContact && !activityContactId) {
      setError("Sélectionnez le contact concerné pour distinguer cette approche des autres contacts du compte.");
      return;
    }
    setSaving("activity");
    setError(null);
    try {
      const nextActionAt = isoDateTime(activityNextActionAt);
      const payload = await apiJson<{ activity: ProspectActivity; prospect: TrackedProspect }>(`/api/prospect-factory/crm/prospects/${encodeURIComponent(prospect.id)}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: activityType,
          detailType: activityDetailType,
          direction: activityType === "note" ? "internal" : activityDirection,
          contactId: activityType === "note" ? null : activityContactId || undefined,
          outcome: activityOutcome || undefined,
          subject: nullable(activitySubject),
          body: activityBody.trim(),
          occurredAt: isoDateTime(activityOccurredAt) ?? undefined,
          nextActionLabel: activityNextActionLabel.trim() || undefined,
          nextActionAt: nextActionAt ?? undefined,
          statusAfter: activityStatusAfter || undefined
        })
      });
      setActivities((current) => [payload.activity, ...current.filter((item) => item.id !== payload.activity.id)]);
      notify(payload.prospect, "Activité ajoutée à l’historique.");
      setActivityBody("");
      setActivitySubject("");
      setActivityOutcome("");
      setActivityContactId("");
      setActivityStatusAfter("");
      setActivityNextActionAt("");
      setActivityNextActionLabel("");
      setActivityOccurredAt(localDateTime(new Date().toISOString()));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ajout de l’activité impossible.");
    } finally {
      setSaving(null);
    }
  }

  if (typeof document === "undefined") return null;

  const panel = (
    <div className={`${styles.overlay} ${closing ? styles.overlayClosing : ""}`} ref={overlayRef} onClick={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <section className={`${styles.drawer} ${closing ? styles.drawerClosing : ""}`} role="dialog" aria-modal="true" aria-labelledby="prospect-drawer-title" aria-describedby="prospect-drawer-description" onKeyDown={trapFocus} onClick={(event) => event.stopPropagation()}>
        <header className={styles.header}>
          <div className={styles.heading}>
            <span className={styles.eyebrow}>Fiche prospect</span>
            <h2 id="prospect-drawer-title">{companyName}</h2>
            <p id="prospect-drawer-description"><MapPin size={14} aria-hidden="true" /> {[canonical.city, canonical.region, canonical.country].filter(Boolean).join(" · ") || "Localisation inconnue"}</p>
          </div>
          <button ref={closeButtonRef} className={styles.close} type="button" onClick={requestClose} aria-label={`Fermer la fiche de ${companyName}`}><X size={20} aria-hidden="true" /></button>
        </header>

        <div className={styles.workspace}>
          <aside className={styles.rail} aria-label="Repères du prospect">
            <div className={styles.summary}>
              <div className={styles.badges}>
                <span className={`${styles.badge} ${styles[canonical.certification]}`}><BadgeCheck size={14} aria-hidden="true" /> Qualité · {certificationLabels[canonical.certification]}</span>
                {prospect ? <span className={`${styles.badge} ${styles.commercial}`}><BriefcaseBusiness size={14} aria-hidden="true" /> {statusLabels[prospect.qualification.status]}</span> : loading ? <span className={styles.untracked}><LoaderCircle className={styles.spin} size={14} aria-hidden="true" /> Chargement du suivi…</span> : <span className={styles.untracked}>Pas encore suivi</span>}
                {prospect ? <span className={`${styles.badge} ${prospect.qualification.tier ? styles[`tier${prospect.qualification.tier}`] : styles.tierPending}`}>{scoreLabel(prospect.qualification.scoreTotal)} · {tierLabel(prospect.qualification.tier)}</span> : null}
              </div>
              {prospect ? <p className={styles.tracked}><BadgeCheck size={15} aria-hidden="true" /> Dans le suivi depuis le {displayDate(prospect.createdAt, false)}</p> : loading ? null : <button className={styles.addButton} type="button" onClick={() => void addToTracking()} disabled={saving === "tracking"}>{saving === "tracking" ? <LoaderCircle className={styles.spin} size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />} Ajouter au suivi</button>}
            </div>

            {prospect ? <dl className={styles.railFacts}>
              <div><dt>Priorité</dt><dd>{priorityLabels[prospect.qualification.priority]}</dd></div>
              <div><dt>Prochaine action</dt><dd>{prospect.qualification.nextActionLabel || "À définir"} · {displayDate(prospect.qualification.nextActionAt)}</dd></div>
              <div><dt>Responsable</dt><dd>{prospect.qualification.owner || "À attribuer"}</dd></div>
            </dl> : null}

            <nav className={styles.tabs} role="tablist" aria-label="Sections de la fiche prospect" onKeyDown={navigateTabs}>
              <button id="prospect-tab-tracking" type="button" role="tab" aria-selected={tab === "tracking"} aria-controls="prospect-panel-tracking" tabIndex={tab === "tracking" ? 0 : -1} className={tab === "tracking" ? styles.activeTab : ""} onClick={() => setTab("tracking")}><BriefcaseBusiness size={17} aria-hidden="true" /> Suivi commercial</button>
              <button id="prospect-tab-research" type="button" role="tab" aria-selected={tab === "research"} aria-controls="prospect-panel-research" tabIndex={tab === "research" ? 0 : -1} className={tab === "research" ? styles.activeTab : ""} onClick={() => setTab("research")}><Search size={17} aria-hidden="true" /> Recherche</button>
              <button id="prospect-tab-copywriting" type="button" role="tab" aria-selected={tab === "copywriting"} aria-controls="prospect-panel-copywriting" tabIndex={tab === "copywriting" ? 0 : -1} className={tab === "copywriting" ? styles.activeTab : ""} onClick={() => setTab("copywriting")}><MessageSquareText size={17} aria-hidden="true" /> Copywriting</button>
              <button id="prospect-tab-record" type="button" role="tab" aria-selected={tab === "record"} aria-controls="prospect-panel-record" tabIndex={tab === "record" ? 0 : -1} className={tab === "record" ? styles.activeTab : ""} onClick={() => setTab("record")}><Building2 size={17} aria-hidden="true" /> Fiche entreprise</button>
              <button id="prospect-tab-activity" type="button" role="tab" aria-selected={tab === "activity"} aria-controls="prospect-panel-activity" tabIndex={tab === "activity" ? 0 : -1} className={tab === "activity" ? styles.activeTab : ""} onClick={() => setTab("activity")}><Activity size={17} aria-hidden="true" /> Activité <span>{activities.length}</span></button>
            </nav>
            {effectiveTrackingId ? <ContextualMapLink accountId={effectiveTrackingId} sourceView={mapReturnView} drawerId={effectiveTrackingId} drawerTab={tab} className={styles.mapLink}><Network size={16} aria-hidden="true" /> Ouvrir la cartographie <ExternalLink size={13} aria-hidden="true" /></ContextualMapLink> : null}
          </aside>

          <div className={styles.main}>
            {error ? <div className={styles.error} role="alert"><CircleAlert size={17} aria-hidden="true" /><span>{error}</span></div> : null}
            <p className={styles.srOnly} aria-live="polite" aria-atomic="true">{announcement}</p>

            <div className={styles.content} ref={contentRef} aria-busy={loading}>
          {loading ? <div className={styles.loading}><LoaderCircle className={styles.spin} size={22} aria-hidden="true" /><span>Chargement du suivi…</span></div> : null}

          {tab === "record" ? <div id="prospect-panel-record" role="tabpanel" aria-labelledby="prospect-tab-record" className={`${styles.panel} ${styles.recordPanel}`}>
            <section className={styles.card} aria-labelledby="canonical-data-title">
              <div className={styles.cardHeading}><div><span>Données du référentiel</span><h3 id="canonical-data-title">Identité et valeurs observées</h3></div><span className={styles.score}>Score référentiel · {canonical.leadScore}/100</span></div>
              <dl className={styles.facts}>
                <div><dt>Entreprise</dt><dd>{canonical.companyName}</dd></div>
                <div><dt>Identifiant</dt><dd>{canonical.siren || canonical.siret || canonical.businessId || canonical.dedupeKey}</dd></div>
                <div><dt>Activité</dt><dd>{canonical.vertical || canonical.activityDetail || "Non classée"}</dd></div>
                <div><dt>Effectif</dt><dd>{canonical.employeeCount ? `${canonical.employeeCount} salarié${canonical.employeeCount === "1" ? "" : "s"}` : canonical.employeeRange || "Inconnu"}</dd></div>
                <div><dt>Contact observé</dt><dd>{canonical.contactName || "Non renseigné"}</dd></div>
                <div><dt>E-mail observé</dt><dd>{canonical.email || "Non renseigné"}</dd></div>
                <div><dt>Téléphone observé</dt><dd>{canonical.phone || "Non renseigné"}</dd></div>
                <div><dt>Fax observé</dt><dd>{canonical.fax || "Non renseigné"}</dd></div>
                <div><dt>Site observé</dt><dd>{canonical.website || "Non renseigné"}</dd></div>
                <div><dt>Capital social</dt><dd>{canonical.capitalSocial === null || canonical.capitalSocial === undefined ? "Non renseigné" : `${new Intl.NumberFormat("fr-FR", { style: "currency", currency: canonical.capitalCurrency || "EUR", maximumFractionDigits: 0 }).format(canonical.capitalSocial)}${canonical.capitalReferenceDate ? ` · ${canonical.capitalReferenceDate}` : ""}`}</dd></div>
              </dl>
              <div className={styles.provenance}><span>Source : {canonical.recordOrigin} · {canonical.sourceType}</span>{links.map((link, index) => <a href={link} target="_blank" rel="noreferrer" key={link}>Ouvrir la source {index + 1}<ExternalLink size={12} aria-hidden="true" /></a>)}</div>
            </section>

            <section className={styles.card} aria-labelledby="targeting-data-title">
              <div className={styles.cardHeading}><div><span>Qualification data</span><h3 id="targeting-data-title">Données de ciblage</h3></div>{publicCompanyHref ? <a className={styles.detailLink} href={publicCompanyHref} target="_blank" rel="noreferrer">Fiche entreprise <ExternalLink size={13} aria-hidden="true" /></a> : null}</div>
              <dl className={styles.facts}>
                <div><dt>Catégorie d’activité</dt><dd>{canonical.activityCategory || "Non renseignée"}</dd></div>
                <div><dt>Type de contact</dt><dd>{canonical.contactType || "Non renseigné"}</dd></div>
                <div><dt>Persona cible</dt><dd>{canonical.persona || "Non renseigné"}</dd></div>
                <div><dt>ICP</dt><dd>{canonical.icp || "Non renseigné"}</dd></div>
                <div><dt>Angle d’approche</dt><dd>{canonical.approachAngle || "Non renseigné"}</dd></div>
                <div><dt>Adresse publiée</dt><dd>{[canonical.address, canonical.postalCode, canonical.city].filter(Boolean).join(" · ") || "Non renseignée"}</dd></div>
                <div><dt>Date de création</dt><dd>{canonical.creationDate || "Non renseignée"}</dd></div>
                <div><dt>Statut administratif</dt><dd>{canonical.administrativeStatus || "Non renseigné"}</dd></div>
                <div><dt>Effectif et fraîcheur</dt><dd>{[canonical.employeeCount ? `${canonical.employeeCount} salarié${canonical.employeeCount === "1" ? "" : "s"}` : canonical.employeeRange, canonical.employeeYear].filter(Boolean).join(" · ") || "Non renseigné"}</dd></div>
                <div><dt>Statut du site</dt><dd>{canonical.websiteStatus || canonical.noWebsiteSignal || "Non renseigné"}</dd></div>
                <div><dt>Présence Google</dt><dd>{canonical.googleReviewCount ? `${canonical.googleReviewCount} avis${canonical.googleRating ? ` · ${canonical.googleRating}/5` : ""}` : "Non observée"}{googleMapsHref ? <a className={styles.detailLink} href={googleMapsHref} target="_blank" rel="noreferrer">Ouvrir la fiche <ExternalLink size={12} aria-hidden="true" /></a> : null}</dd></div>
                <div><dt>Sources rattachées</dt><dd>{canonical.sourceCount === null || canonical.sourceCount === undefined ? "Non renseigné" : String(canonical.sourceCount)}</dd></div>
                <div><dt>Source du capital</dt><dd>{canonical.capitalSource || "Non renseignée"}</dd></div>
              </dl>
              {canonical.approachAngle || canonical.dataQuality || canonical.employeeDataStatus ? <p className={styles.dataNote}>{[canonical.dataQuality, canonical.employeeDataStatus].filter(Boolean).join(" · ")}</p> : null}
            </section>

            <form className={styles.card} onSubmit={(event) => void saveEnrichment(event)} aria-labelledby="enrichment-title">
              <div className={styles.cardHeading}><div><span>Couche commerciale</span><h3 id="enrichment-title">Coordonnées enrichies</h3></div></div>
              {!prospect ? <p className={styles.gate}>Ajoutez d’abord ce prospect au suivi pour conserver vos enrichissements sans modifier le référentiel source.</p> : null}
              <div className={styles.formGrid}>
                <label>Nom du contact<span className={styles.inputIcon}><Users size={15} aria-hidden="true" /><input maxLength={180} placeholder={canonical.contactName || "Nom à identifier"} value={enrichment.contactName ?? ""} onChange={(event) => setEnrichment({ ...enrichment, contactName: event.target.value })} disabled={!prospect} autoComplete="off" /></span></label>
                <label>Fonction<span className={styles.inputIcon}><BriefcaseBusiness size={15} aria-hidden="true" /><input maxLength={180} value={enrichment.jobTitle ?? ""} onChange={(event) => setEnrichment({ ...enrichment, jobTitle: event.target.value })} disabled={!prospect} autoComplete="off" /></span></label>
                <label>E-mail<span className={styles.inputIcon}><Mail size={15} aria-hidden="true" /><input type="email" maxLength={320} placeholder={canonical.email || "nom@entreprise.fr"} value={enrichment.email ?? ""} onChange={(event) => setEnrichment({ ...enrichment, email: event.target.value })} disabled={!prospect} autoComplete="off" /></span></label>
                <label>Téléphone<span className={styles.inputIcon}><Phone size={15} aria-hidden="true" /><input type="tel" maxLength={60} placeholder={canonical.phone || "+590 …"} value={enrichment.phone ?? ""} onChange={(event) => setEnrichment({ ...enrichment, phone: event.target.value })} disabled={!prospect} autoComplete="off" /></span></label>
                <label>Site web<input type="url" maxLength={2048} placeholder={canonical.website || "https://…"} value={enrichment.website ?? ""} onChange={(event) => setEnrichment({ ...enrichment, website: event.target.value })} disabled={!prospect} autoComplete="off" /></label>
                <label className={styles.fullField}>Adresse<input maxLength={500} value={enrichment.address ?? ""} onChange={(event) => setEnrichment({ ...enrichment, address: event.target.value })} disabled={!prospect} autoComplete="off" /></label>
              </div>
              <div className={styles.formActions}><button className={styles.saveButton} type="submit" disabled={!prospect || saving === "record"}>{saving === "record" ? <LoaderCircle className={styles.spin} size={16} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />} Enregistrer la fiche</button></div>
            </form>
          </div> : null}

          {tab === "tracking" ? <div id="prospect-panel-tracking" role="tabpanel" aria-labelledby="prospect-tab-tracking" className={`${styles.panel} ${styles.trackingPanel}`}>
            <form className={styles.card} onSubmit={(event) => void saveQualification(event)} aria-labelledby="qualification-title">
              <div className={styles.cardHeading}><div><span>Suivi commercial</span><h3 id="qualification-title">Statut, priorité et prochaine action</h3></div><button className={styles.inlineAction} type="button" onClick={() => setTab("activity")}><Activity size={15} aria-hidden="true" /> Consigner un échange</button></div>
              {!prospect ? <p className={styles.gate}>Ajoutez ce prospect au suivi pour définir son étape, sa priorité et sa prochaine action.</p> : null}
              <div className={styles.formGrid}>
                <label>Étape commerciale<select value={qualification.status} onChange={(event) => setQualification({ ...qualification, status: event.target.value as ProspectQualificationStatus })} disabled={!prospect}>{PROSPECT_QUALIFICATION_STATUSES.map((value) => <option key={value} value={value} disabled={statusRequiresLoggedActivity(value) && value !== qualification.status}>{statusLabels[value]}{statusRequiresLoggedActivity(value) && value !== qualification.status ? " · via activité" : ""}</option>)}</select><span className={styles.fieldHint}>Les étapes liées à un échange se mettent à jour depuis l’activité, avec sa date réelle.</span></label>
                <label>Priorité<select value={qualification.priority} onChange={(event) => setQualification({ ...qualification, priority: event.target.value as ProspectPriority })} disabled={!prospect}>{PROSPECT_PRIORITIES.map((value) => <option key={value} value={value}>{priorityLabels[value]}</option>)}</select></label>
                <label className={styles.fullField}>Tags <span className={styles.labelHint}>séparés par des virgules</span><input maxLength={1_220} value={tagsInput} onChange={(event) => setTagsInput(event.target.value)} placeholder="Décideur, marché public, chaud…" disabled={!prospect} /></label>
                <label className={styles.fullField}>Notes commerciales<textarea rows={6} maxLength={20_000} value={qualification.notes} onChange={(event) => setQualification({ ...qualification, notes: event.target.value })} placeholder="Besoin, contexte, objections, potentiel…" disabled={!prospect} /></label>
                <label>Responsable<input maxLength={180} value={qualification.owner ?? ""} onChange={(event) => setQualification({ ...qualification, owner: event.target.value })} placeholder="Qui suit cette fiche ?" disabled={!prospect} /></label>
                <label>Campagne<input maxLength={180} value={qualification.campaign ?? ""} onChange={(event) => setQualification({ ...qualification, campaign: event.target.value })} placeholder="Ex. BTP · septembre" disabled={!prospect} /></label>
                <label>Valeur potentielle (€)<input type="number" min="0" max="1000000000" step="100" value={qualification.potentialValue ?? ""} onChange={(event) => setQualification({ ...qualification, potentialValue: event.target.value === "" ? null : Number(event.target.value) })} placeholder="Ex. 5000" disabled={!prospect} /></label>
                <label>Probabilité (%)<input type="number" min="0" max="100" step="5" value={qualification.probability ?? ""} onChange={(event) => setQualification({ ...qualification, probability: event.target.value === "" ? null : Number(event.target.value) })} placeholder="Ex. 40" disabled={!prospect} /></label>
                <label>Prochaine action à réaliser<input maxLength={240} value={qualification.nextActionLabel ?? ""} onChange={(event) => setQualification({ ...qualification, nextActionLabel: event.target.value })} placeholder="Ex. Relancer le RAF sur le reporting" disabled={!prospect} /></label>
                <label>Date de prochaine action (Europe/Paris)<input type="datetime-local" value={localDateTime(qualification.nextActionAt)} onChange={(event) => setQualification({ ...qualification, nextActionAt: isoDateTime(event.target.value) })} disabled={!prospect} /></label>
                <label>Date de clôture prévue (Europe/Paris)<input type="datetime-local" value={localDateTime(qualification.expectedCloseAt)} onChange={(event) => setQualification({ ...qualification, expectedCloseAt: isoDateTime(event.target.value) })} disabled={!prospect} /></label>
                <label className={styles.fullField}>Motif de perte ou d’écartement<input maxLength={500} value={qualification.disqualificationReason ?? ""} onChange={(event) => setQualification({ ...qualification, disqualificationReason: event.target.value })} placeholder="Ex. hors cible, budget absent, opposition…" disabled={!prospect} /></label>
                <div className={styles.readOnlyFact}><span>Dernier échange</span><strong>{displayDate(qualification.lastContactedAt)}</strong></div>
              </div>
              <div className={styles.formActions}><button className={styles.saveButton} type="submit" disabled={!prospect || saving === "qualification"}>{saving === "qualification" ? <LoaderCircle className={styles.spin} size={16} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />} Enregistrer le suivi commercial</button></div>
            </form>
          </div> : null}

          {tab === "research" ? <div id="prospect-panel-research" role="tabpanel" aria-labelledby="prospect-tab-research" className={`${styles.panel} ${styles.researchPanel}`}>
            <section className={`${styles.card} ${styles.qualificationOverview}`} aria-labelledby="research-score-title">
              <div className={styles.cardHeading}><div><span>Décision de qualification</span><h3 id="research-score-title">Score, tier et niveau de preuve</h3></div></div>
              {!prospect ? <p className={styles.gate}>Ajoutez ce prospect au suivi pour consulter ou importer sa qualification sourcée.</p> : <>
                <div className={styles.scoreHero}>
                  <div><span>Score de qualification</span><strong>{scoreLabel(prospect.qualification.scoreTotal)}</strong><small>Distinct du score technique du référentiel</small></div>
                  <span className={`${styles.tierBadge} ${prospect.qualification.tier ? styles[`tier${prospect.qualification.tier}`] : styles.tierPending}`}>{tierLabel(prospect.qualification.tier)}</span>
                  <span className={styles.confidenceBadge}>{confidenceLabel(prospect.qualification.confidence)}</span>
                </div>
                <div className={styles.scoreBreakdown} aria-label="Détail du score de qualification">
                  <div><span>Fit</span><strong>{displayScore(prospect.qualification.fitScore, 30)}</strong><small>adéquation compte</small></div>
                  <div><span>Pain</span><strong>{displayScore(prospect.qualification.painScore, 30)}</strong><small>douleur observable</small></div>
                  <div><span>Timing</span><strong>{displayScore(prospect.qualification.timingScore, 20)}</strong><small>signal daté</small></div>
                  <div><span>Persona</span><strong>{displayScore(prospect.qualification.personaScore, 20)}</strong><small>rôle dans l’achat</small></div>
                </div>
                {prospect.qualification.scoreReason ? <p className={styles.scoreReason}>{prospect.qualification.scoreReason}</p> : <p className={styles.dataNote}>Aucune justification de score importée : conservez le score à confirmer jusqu’à une recherche sourcée.</p>}
              </>}
            </section>

            <CompanySignals companyId={prospect?.id ?? null} />

            <section className={styles.card} aria-labelledby="research-account-title">
              <div className={styles.cardHeading}><div><span>Recherche compte</span><h3 id="research-account-title">Synthèse, hypothèse et prochaines vérifications</h3></div></div>
              {!prospect ? <p className={styles.gate}>Les résultats de recherche apparaîtront ici après l’import de qualification.</p> : <dl className={styles.researchFacts}>
                <div><dt>Synthèse de l’activité</dt><dd>{prospect.research.businessSummary || "Non trouvée"}</dd></div>
                <div><dt>Hypothèse d’offre</dt><dd>{prospect.research.offerHypothesis || "À formuler après analyse"}</dd></div>
                <div><dt>À vérifier ensuite</dt><dd>{prospect.research.nextVerification || "Aucune vérification recommandée"}</dd></div>
                <div><dt>Prochaine action recommandée</dt><dd>{displayDate(prospect.research.recommendedNextActionAt)}</dd></div>
                <div><dt>Dernière recherche</dt><dd>{displayDate(prospect.research.lastResearchedAt)}</dd></div>
                <div><dt>Dernière qualification</dt><dd>{displayDate(prospect.research.lastQualifiedAt)}</dd></div>
                <div><dt>Source d’entrée</dt><dd>{prospect.research.sourceInput ? `${prospect.research.sourceInput.type === "apollo_screenshot" ? "Capture Apollo" : prospect.research.sourceInput.type === "apollo_export" ? "Export Apollo" : "Liste manuelle"} · ${prospect.research.sourceInput.extractionStatus === "extracted" ? "extrait" : prospect.research.sourceInput.extractionStatus === "ambiguous" ? "ambigu" : "exclu"}${prospect.research.sourceInput.rowOrRecord ? ` · ligne ${prospect.research.sourceInput.rowOrRecord}` : ""}` : "Non renseignée"}</dd></div>
                <div><dt>Fuseau de reporting</dt><dd>{prospect.research.reportingTimezone || "Europe/Paris"}</dd></div>
              </dl>}
            </section>

            <section className={styles.card} aria-labelledby="observations-title">
              <div className={styles.cardHeading}><div><span>Preuves et signaux</span><h3 id="observations-title">Faits, hypothèses et éléments à confirmer</h3></div>{prospect ? <span className={styles.counter}>{prospect.observations.length}</span> : null}</div>
              {!prospect ? <p className={styles.gate}>Les signaux observés seront visibles ici, séparés des hypothèses.</p> : prospect.observations.length ? <ul className={styles.observationList}>{prospect.observations.map((observation) => {
                const href = safeResearchUrl(observation.sourceUrl);
                return <li key={observation.id} className={styles[`observation${observation.evidenceStatus}`]}><div className={styles.observationHeading}><span>{observationStatusLabels[observation.evidenceStatus]}</span><small>{observationKindLabels[observation.kind]}{observation.category ? ` · ${observation.category}` : ""}</small></div><p>{observation.statement}</p><div className={styles.observationMeta}>{observation.occurredAt ? <time dateTime={observation.occurredAt}>Événement : {displayDate(observation.occurredAt, false)}</time> : null}{observation.publishedAt ? <time dateTime={observation.publishedAt}>Publié : {displayDate(observation.publishedAt, false)}</time> : null}<time dateTime={observation.researchedAt}>Recherché : {displayDate(observation.researchedAt, false)}</time>{href ? <a href={href} target="_blank" rel="noreferrer">Voir la preuve <ExternalLink size={12} aria-hidden="true" /></a> : null}</div></li>;
              })}</ul> : <p className={styles.emptyResearch}>Aucun signal de recherche enregistré. Ne déduisez pas une douleur sans preuve.</p>}
            </section>

            <div className={styles.researchSplit}>
              <section className={styles.card} aria-labelledby="contacts-title">
                <div className={styles.cardHeading}><div><span>Contacts rattachés</span><h3 id="contacts-title">Buying committee</h3></div>{prospect ? <span className={styles.counter}>{prospect.contacts.length}</span> : null}</div>
                {!prospect ? <p className={styles.gate}>Les contacts importés apparaîtront ici.</p> : prospect.contacts.length ? <ul className={styles.contactList}>{prospect.contacts.map((contact) => {
                  const href = safeResearchUrl(contact.sourceUrl);
                   const linkedinHref = safeResearchUrl(contact.linkedin);
                   return <li key={contact.id}><div><strong>{contact.name}</strong><small>{contact.verifiedTitle || contact.inputTitle || "Fonction non renseignée"}</small>{contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : null}{contact.phone ? <a href={`tel:${contact.phone}`}>{contact.phone}</a> : null}</div><div><span className={styles.contactEvidence}>{evidenceTypeLabels[contact.evidenceType]}</span>{contact.dealRoles.map((role) => <span className={styles.committeeRole} key={role}>{dealRoleLabels[role]}</span>)}{contact.buyingCommitteeRole && !contact.dealRoles.length ? <span className={styles.committeeRole}>{buyingCommitteeLabels[contact.buyingCommitteeRole]}</span> : null}{contact.decisionScope ? <span className={styles.committeeRole}>{decisionScopeLabels[contact.decisionScope]}</span> : null}{contact.seniority ? <small>{contact.seniority}</small> : null}{contact.sourceRowOrRecord ? <small>Réf. {contact.sourceRowOrRecord}</small> : null}{linkedinHref ? <a href={linkedinHref} target="_blank" rel="noreferrer">LinkedIn <ExternalLink size={12} aria-hidden="true" /></a> : null}{href ? <a href={href} target="_blank" rel="noreferrer">Source <ExternalLink size={12} aria-hidden="true" /></a> : null}</div></li>;
                 })}</ul> : prospect.legacyContact ? <div className={styles.legacyContact}><strong>{prospect.legacyContact.name}</strong><small>{prospect.legacyContact.title || "Fonction à préciser"}</small><p>Contact présent sur la fiche historique, à rattacher au compte pour suivre ses échanges séparément.</p>{prospect.legacyContact.email ? <a href={`mailto:${prospect.legacyContact.email}`}>{prospect.legacyContact.email}</a> : null}</div> : <p className={styles.emptyResearch}>Aucun contact lié à ce compte.</p>}
              </section>

              <section className={styles.card} aria-labelledby="sources-title">
                <div className={styles.cardHeading}><div><span>Journal de sources</span><h3 id="sources-title">Preuves consultables</h3></div>{prospect ? <span className={styles.counter}>{visibleResearchSources.length}</span> : null}</div>
                {!prospect ? <p className={styles.gate}>Les sources de recherche apparaîtront ici.</p> : visibleResearchSources.length ? <ul className={styles.sourceList}>{visibleResearchSources.map((source) => {
                  const href = safeResearchUrl(source.url);
                  return href ? <li key={source.id}><a href={href} target="_blank" rel="noreferrer"><strong>{sourceDomain(href)}</strong><ExternalLink size={12} aria-hidden="true" /></a><span>{researchSourceTypeLabels[source.sourceType]}</span><p>{source.supportedClaim}</p><small>{source.publishedAt ? `Publié : ${displayDate(source.publishedAt, false)} · ` : ""}Recherché : {displayDate(source.researchedAt, false)}</small></li> : null;
                })}</ul> : <p className={styles.emptyResearch}>Aucune source exploitable enregistrée.</p>}
              </section>
            </div>


          </div> : null}

          {tab === "copywriting" ? <div id="prospect-panel-copywriting" role="tabpanel" aria-labelledby="prospect-tab-copywriting" className={styles.panel}>
            <CompanyOutreach companyId={prospect?.id ?? null} contacts={prospect?.contacts ?? []}
              initialContactId={initialContactId} />
          </div> : null}

          {tab === "activity" ? <div id="prospect-panel-activity" role="tabpanel" aria-labelledby="prospect-tab-activity" className={`${styles.panel} ${styles.activityPanel}`}>
            <form className={styles.card} onSubmit={(event) => void addActivity(event)} aria-labelledby="new-activity-title">
              <div className={styles.cardHeading}><div><span>Journal commercial</span><h3 id="new-activity-title">Ajouter une activité</h3></div></div>
              {!prospect ? <p className={styles.gate}>Ajoutez ce prospect au suivi pour consigner vos échanges.</p> : null}
              <div className={styles.formGrid}>
                <label>Type<select value={activityDetailType} onChange={(event) => setActivityDetailType(event.target.value as ProspectActivityDetailType)} disabled={!prospect}>{PROSPECT_ACTIVITY_DETAIL_TYPES.map((value) => <option key={value} value={value}>{activityDetailLabels[value]}</option>)}</select></label>
                <label>Sens<select value={activityType === "note" ? "internal" : activityDirection} onChange={(event) => setActivityDirection(event.target.value as typeof activityDirection)} disabled={!prospect || activityType === "note"}><option value="internal">Interne</option><option value="outbound">Sortant</option><option value="inbound">Entrant</option></select></label>
                <label>Contact concerné<select value={activityContactId} onChange={(event) => setActivityContactId(event.target.value)} disabled={!prospect || activityType === "note"} required={Boolean(prospect && prospect.contacts.length > 1 && activityType !== "note" && activityDirection === "outbound")}><option value="">Compte général{prospect?.contacts.length ? " · non attribué" : ""}</option>{prospect?.contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}{contact.verifiedTitle || contact.inputTitle ? ` · ${contact.verifiedTitle || contact.inputTitle}` : ""}</option>)}</select>{prospect && prospect.contacts.length > 1 && activityType !== "note" && activityDirection === "outbound" ? <span className={styles.fieldHint}>Requis pour compter la première approche du bon contact.</span> : null}</label>
                <label>Date et heure (Europe/Paris)<input type="datetime-local" value={activityOccurredAt} onChange={(event) => setActivityOccurredAt(event.target.value)} disabled={!prospect} /></label>
                <label>Résultat<select value={activityOutcome} onChange={(event) => setActivityOutcome(event.target.value as ProspectActivityOutcome | "")} disabled={!prospect}><option value="">Non renseigné</option>{PROSPECT_ACTIVITY_OUTCOMES.map((value) => <option key={value} value={value}>{outcomeLabels[value]}</option>)}</select></label>
                <label className={styles.fullField}>Objet<input maxLength={240} value={activitySubject} onChange={(event) => setActivitySubject(event.target.value)} placeholder="Ex. Prise de contact, démonstration, devis…" disabled={!prospect} /></label>
                <label>Étape après l’activité<select value={activityStatusAfter} onChange={(event) => setActivityStatusAfter(event.target.value as ProspectQualificationStatus | "")} disabled={!prospect}><option value="">Conserver l’étape</option>{PROSPECT_QUALIFICATION_STATUSES.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></label>
                <label>Planifier une prochaine action<input type="datetime-local" value={activityNextActionAt} onChange={(event) => setActivityNextActionAt(event.target.value)} disabled={!prospect} /></label>
                <label className={styles.fullField}>Prochaine action à réaliser<input maxLength={240} value={activityNextActionLabel} onChange={(event) => setActivityNextActionLabel(event.target.value)} placeholder="Ex. Envoyer une proposition ou relancer la direction" disabled={!prospect} /></label>
                <label className={styles.fullField}>Compte rendu<textarea rows={4} maxLength={10_000} value={activityBody} onChange={(event) => setActivityBody(event.target.value)} placeholder="Ce qui a été dit, décision et contexte utile…" disabled={!prospect} required={activityType === "note"} /></label>
              </div>
              <div className={styles.formActions}><button className={styles.saveButton} type="submit" disabled={!prospect || saving === "activity"}>{saving === "activity" ? <LoaderCircle className={styles.spin} size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />} Ajouter à l’historique</button></div>
            </form>

            <section className={styles.card} aria-labelledby="timeline-title">
              <div className={styles.cardHeading}><div><span>Historique</span><h3 id="timeline-title">{activities.length} activité{activities.length > 1 ? "s" : ""}</h3></div></div>
              {activities.length ? <ol className={styles.timeline}>{activities.map((item) => <li key={item.id}>
                <span className={styles.timelineIcon}>{item.type === "email" ? <Mail size={15} aria-hidden="true" /> : item.type === "call" ? <Phone size={15} aria-hidden="true" /> : item.type === "meeting" ? <Clock3 size={15} aria-hidden="true" /> : item.type === "status_change" ? <BriefcaseBusiness size={15} aria-hidden="true" /> : <MessageSquareText size={15} aria-hidden="true" />}</span>
                <div><div className={styles.timelineHeading}><strong>{item.detailType ? activityDetailLabels[item.detailType] : activityTypeLabels[item.type]}</strong><time dateTime={item.occurredAt}>{displayDate(item.occurredAt)}</time></div>{item.contactId && prospect?.contacts.find((contact) => contact.id === item.contactId) ? <span className={styles.outcome}>{prospect.contacts.find((contact) => contact.id === item.contactId)?.name}</span> : null}{item.direction ? <span className={styles.outcome}>{directionLabels[item.direction]}</span> : null}{item.outcome ? <span className={styles.outcome}>{outcomeLabels[item.outcome]}</span> : null}{item.subject ? <h4>{item.subject}</h4> : null}{item.body ? <p>{item.body}</p> : null}{item.nextActionLabel || item.nextActionAt ? <p>À faire : {item.nextActionLabel || "Action à préciser"}{item.nextActionAt ? ` · ${displayDate(item.nextActionAt)}` : ""}</p> : null}<small>Enregistré le {displayDate(item.recordedAt || item.createdAt)} · {item.source === "import" ? "import" : item.source === "automation" ? "automatisation" : item.source === "api" ? "API" : "interface"} · {item.actorRole}</small></div>
              </li>)}</ol> : <div className={styles.emptyTimeline}><Clock3 size={22} aria-hidden="true" /><p>Aucun échange consigné pour le moment.</p></div>}
            </section>
          </div> : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );

  return createPortal(panel, document.body);
}
