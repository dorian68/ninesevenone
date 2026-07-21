"use client";

import { BarChart3, Bookmark, Database, Download, FileText, Search, Target, X } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useEffect, useMemo, useState } from "react";
import type { BusinessIntelligenceDossier, DossierEvidence } from "@/lib/business-intelligence-dossier-types";

type Candidate = {
  establishmentId: string;
  siren: string;
  siret: string;
  name: string;
  legalName: string;
  commune: string;
  sector: string;
  nafCode: string;
  address: string;
  description: string;
  workforceBand?: string | null;
  workforceYear?: number | null;
  isHeadOffice?: boolean;
  url: string;
};

type Mode = "prospecting" | "cv" | "proposal";

type WorkspaceData = {
  savedSearches: Array<{ id: string; name: string; query: string; sector: string; commune: string; updatedAt: string }>;
  shortlists: Array<{ id: string; name: string; items: Candidate[]; updatedAt: string }>;
  drafts: Array<{ id: string; type: "cv" | "proposal"; title: string; targetSiren: string | null; content: string; updatedAt: string }>;
  metadata?: { persistence?: string; retentionDays?: number };
};

type CompanyInsight = {
  retrievedAt: string;
  statuses?: Array<{ source: string; status: "ok" | "empty" | "unavailable"; detail?: string }>;
  companyProfile?: {
    summary: string;
    activity: { code: string | null; label: string | null };
    services: Array<{ label: string; source: string; confidence: "high" | "medium" | "low" }>;
    signals: Array<{ label: string; detail: string | null; source: string; confidence: "high" | "medium" | "low" }>;
    size: { workforceBand: string | null; workforceYear: number | string | null; companyCategory: string | null; establishmentCount: number; employerEstablishmentCount: number };
    coverage: { observedSources: number; evidenceCount: number };
  };
  bodacc?: { total: number };
  publicContracts?: { total: number; totalAmount: number | null };
  press?: { total: number; cacheStatus?: string };
  recruitment?: { status: "ok" | "empty" | "unavailable"; total: number };
  websites?: { descriptionsCount: number; offeringsCount: number; accessibleSitesCount: number };
  annuaire?: { dirigeants?: Array<unknown>; financials?: Array<unknown>; labels?: string[] };
  patents?: { total: number; grantedCount: number; technologySectionCount: number };
  financialRatios?: { total: number; latestClosingDate: string | null };
  publicGrants?: { total: number; totalAmount: number | null };
  ademeAids?: { total: number; totalAmount: number | null };
  fondsVert?: { total: number; totalAmount: number | null };
  franceRelance?: { total: number; descriptionCount: number };
  trainingOrganizations?: { total: number; qualityCount: number };
  rge?: { total: number; activeCount: number; domains: string[] };
  environmentalCompliance?: { total: number; inspectionCount: number };
  osmPresence?: { total: number; categories: string[]; openingHoursCount: number };
};

function buildSecondaryFacts(insight: CompanyInsight) {
  const facts: Array<{ label: string; value: string }> = [];
  const addCount = (label: string, value: number | undefined, suffix = "") => {
    if (value && value > 0) facts.push({ label, value: String(value) + suffix });
  };
  addCount("Dirigeants publics", insight.annuaire?.dirigeants?.length, " mandat(s)");
  addCount("Brevets", insight.patents?.total, " famille(s)");
  addCount("Exercices financiers", insight.financialRatios?.total, insight.financialRatios?.latestClosingDate ? " · dernier " + insight.financialRatios.latestClosingDate : "");
  addCount("Subventions publiques", insight.publicGrants?.total, " convention(s)");
  addCount("Aides ADEME", insight.ademeAids?.total, " dossier(s)");
  addCount("Projets Fonds vert", insight.fondsVert?.total, " projet(s)");
  addCount("Projets France Relance", insight.franceRelance?.total, " projet(s)");
  addCount("Profils de formation", insight.trainingOrganizations?.total, " profil(s)");
  addCount("Qualifications RGE actives", insight.rge?.activeCount);
  addCount("Installations ICPE", insight.environmentalCompliance?.total);
  addCount("Catégories OSM", insight.osmPresence?.categories.length);
  const unavailable = insight.statuses?.filter((source) => source.status === "unavailable").length ?? 0;
  addCount("Sources indisponibles", unavailable);
  return facts;
}

function csvCell(value: string | number | null | undefined) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function downloadText(filename: string, content: string, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function dossierDate(value: string | null | undefined) {
  if (!value) return "date non renseignée";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(parsed);
}

function dossierConfidence(value: DossierEvidence["confidence"]) {
  return value === "high" ? "élevée" : value === "medium" ? "moyenne" : "faible";
}

function dossierMarkdown(dossier: BusinessIntelligenceDossier) {
  const lines = [
    `# Dossier BI · SIREN ${dossier.siren}`,
    "",
    `Récupéré le ${dossierDate(dossier.retrievedAt)}.`,
    "",
    "## Synthèse",
    "",
    dossier.summary,
    "",
    `Description : ${dossier.description.evidence} Source ${dossier.description.source}, confiance ${dossier.description.confidence}, référence ${dossierDate(dossier.description.referenceDate)}.`,
    "",
    "## Faits saillants",
    "",
    ...dossier.highlights.map((item) => `- ${item.label} : ${item.value} — ${item.source} · confiance ${dossierConfidence(item.confidence)} · ${dossierDate(item.referenceDate)}`),
    ""
  ];
  for (const section of dossier.sections) {
    lines.push(`## ${section.title}`, "", section.intro, "", ...section.evidence.map((item) => `- ${item.label} : ${item.value} — ${item.source} · confiance ${dossierConfidence(item.confidence)} · ${dossierDate(item.referenceDate)}${item.scope ? ` · ${item.scope}` : ""}`), "");
  }
  if (dossier.governance.edges.length) {
    lines.push("## Mandats légaux publiés", "", ...dossier.governance.edges.map((edge) => `- ${edge.from} → ${edge.to} : ${edge.role} — ${edge.source} · ${dossierDate(edge.referenceDate)}`), "", dossier.governance.note, "");
  }
  if (dossier.press.length) {
    lines.push("## Mentions média", "", ...dossier.press.map((mention) => `- ${mention.title} — ${mention.source}${mention.publishedAt ? ` · ${dossierDate(mention.publishedAt)}` : ""} · ${mention.url}`), "");
  }
  if (dossier.timeline.length) {
    lines.push("## Chronologie publique", "", ...dossier.timeline.map((event) => `- ${dossierDate(event.date)} · ${event.label}${event.detail ? ` — ${event.detail}` : ""} · ${event.source}`), "");
  }
  lines.push("## Limites", "", ...dossier.limits.map((limit) => `- ${limit}`), "");
  lines.push("## Couverture des sources", "", ...dossier.coverage.sources.map((source) => `- ${source.source} : ${source.status}${source.detail ? ` — ${source.detail}` : ""}`));
  return lines.join("\n");
}

function DossierEvidenceRow({ item }: { item: DossierEvidence }) {
  return <article className="dossier-evidence" data-kind={item.kind}>
    <div className="dossier-evidence-main"><strong>{item.label}</strong><span>{item.value}</span></div>
    <div className="dossier-evidence-meta"><span>{item.source}</span><span>Confiance {dossierConfidence(item.confidence)}</span><span>{dossierDate(item.referenceDate)}</span>{item.scope ? <span>{item.scope}</span> : null}{item.sourceUrl ? <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">Source ↗</a> : null}</div>
  </article>;
}

export function StudioTools() {
  const [mode, setMode] = useState<Mode>("prospecting");
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("");
  const [commune, setCommune] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Candidate[]>([]);
  const [sectors, setSectors] = useState<string[]>([]);
  const [communes, setCommunes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [cvName, setCvName] = useState("");
  const [cvRole, setCvRole] = useState("");
  const [cvSummary, setCvSummary] = useState("");
  const [cvSkills, setCvSkills] = useState("");
  const [cvExperience, setCvExperience] = useState("");
  const [cvOutput, setCvOutput] = useState("");
  const [proposalTitle, setProposalTitle] = useState("");
  const [proposalObjective, setProposalObjective] = useState("");
  const [proposalServices, setProposalServices] = useState("");
  const [proposalDeliverables, setProposalDeliverables] = useState("");
  const [proposalBudget, setProposalBudget] = useState("");
  const [proposalTiming, setProposalTiming] = useState("");
  const [proposalOutput, setProposalOutput] = useState("");
  const [focusedCandidate, setFocusedCandidate] = useState<Candidate | null>(null);
  const [focusedInsight, setFocusedInsight] = useState<CompanyInsight | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [focusedDossier, setFocusedDossier] = useState<BusinessIntelligenceDossier | null>(null);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [dossierError, setDossierError] = useState<string | null>(null);
  const [cvTarget, setCvTarget] = useState<Candidate | null>(null);
  const [proposalTarget, setProposalTarget] = useState<Candidate | null>(null);
  const [savedSearches, setSavedSearches] = useState<WorkspaceData["savedSearches"]>([]);
  const [savedShortlists, setSavedShortlists] = useState<WorkspaceData["shortlists"]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceStatus, setWorkspaceStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/prospecting/options")
      .then((response) => response.ok ? response.json() as Promise<{ sectors: string[]; communes: string[] }> : Promise.reject(new Error("Options indisponibles")))
      .then((data) => { setSectors(data.sectors); setCommunes(data.communes); })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/workspace", { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<WorkspaceData> : Promise.reject(new Error("Espace de travail indisponible")))
      .then((data) => {
        setSavedSearches(data.savedSearches ?? []);
        setSavedShortlists(data.shortlists ?? []);
        const latest = data.shortlists?.[0]?.items ?? [];
        if (latest.length) setSelected(latest);
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setWorkspaceStatus("Espace de travail temporairement indisponible");
      })
      .finally(() => {
        if (!controller.signal.aborted) setWorkspaceLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (mode !== "prospecting") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setRequestError(null);
      try {
        const params = new URLSearchParams({ q: query, sector, commune, limit: "60" });
        const response = await fetch(`/api/prospecting?${params.toString()}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Recherche territoriale indisponible");
        const data = await response.json() as { results: Candidate[] };
        setCandidates(data.results);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setRequestError(error instanceof Error ? error.message : "Erreur de recherche");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [commune, mode, query, sector]);

  const selectedSirens = useMemo(() => new Set(selected.map((item) => item.siren)), [selected]);
  const secondaryFacts = focusedInsight ? buildSecondaryFacts(focusedInsight) : [];

  function toggleCandidate(candidate: Candidate) {
    setSelected((current) => selectedSirens.has(candidate.siren)
      ? current.filter((item) => item.siren !== candidate.siren)
      : current.length >= 50 ? current : [...current, candidate]);
  }

  function exportShortlist() {
    const header = ["siren", "siret", "nom", "raison_sociale", "commune", "secteur", "naf", "adresse", "effectif", "siege", "url"];
    const rows = selected.map((item) => [item.siren, item.siret, item.name, item.legalName, item.commune, item.sector, item.nafCode, item.address, item.workforceBand, item.isHeadOffice ? "oui" : "non", `${window.location.origin}${item.url}`]);
    downloadText("guadeloupe-prospection.csv", [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n"), "text/csv;charset=utf-8");
  }

  async function saveSearch() {
    const name = [query.trim(), sector, commune].filter(Boolean).join(" · ") || "Exploration Guadeloupe";
    const response = await fetch("/api/workspace/saved-searches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, query, sector, commune })
    });
    if (!response.ok) {
      setWorkspaceStatus("Impossible d’enregistrer cette recherche");
      return;
    }
    const data = await response.json() as { savedSearch?: WorkspaceData["savedSearches"][number] };
    if (data.savedSearch) setSavedSearches((current) => [data.savedSearch!, ...current.filter((item) => item.id !== data.savedSearch?.id)].slice(0, 30));
    setWorkspaceStatus("Recherche enregistrée dans votre espace");
  }

  async function saveShortlist() {
    if (!selected.length) return;
    const response = await fetch("/api/workspace/shortlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `Shortlist · ${new Date().toLocaleDateString("fr-FR")}`,
        items: selected
      })
    });
    if (!response.ok) {
      setWorkspaceStatus("Impossible d’enregistrer cette shortlist");
      return;
    }
    const data = await response.json() as { shortlist?: WorkspaceData["shortlists"][number] };
    if (data.shortlist) setSavedShortlists((current) => [data.shortlist!, ...current.filter((item) => item.id !== data.shortlist?.id)].slice(0, 30));
    setWorkspaceStatus("Shortlist enregistrée dans votre espace");
  }

  async function saveDraft(type: "cv" | "proposal", content: string, title: string, targetSiren: string | null) {
    if (!content.trim()) return;
    const response = await fetch("/api/workspace/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, title: title.trim() || (type === "cv" ? "CV ciblé" : "Proposition commerciale"), targetSiren, content })
    });
    setWorkspaceStatus(response.ok ? "Brouillon enregistré dans votre espace" : "Impossible d’enregistrer ce brouillon");
  }

  async function clearWorkspace() {
    if (!window.confirm("Supprimer les recherches, shortlists et brouillons de cet espace ?")) return;
    const response = await fetch("/api/workspace", { method: "DELETE" });
    if (!response.ok) {
      setWorkspaceStatus("Impossible de supprimer l’espace");
      return;
    }
    setSavedSearches([]);
    setSavedShortlists([]);
    setSelected([]);
    setWorkspaceStatus("Espace de travail supprimé");
  }

  function restoreSearch(search: WorkspaceData["savedSearches"][number]) {
    setQuery(search.query);
    setSector(search.sector);
    setCommune(search.commune);
    setMode("prospecting");
    setWorkspaceStatus(`Recherche restaurée : ${search.name}`);
  }

  async function inspectCandidate(candidate: Candidate) {
    setFocusedCandidate(candidate);
    setFocusedInsight(null);
    setInsightError(null);
    setFocusedDossier(null);
    setDossierError(null);
    setInsightLoading(true);
    try {
      const response = await fetch(`/api/companies/${candidate.siren}/intelligence`);
      if (!response.ok) throw new Error("Profil BI indisponible");
      setFocusedInsight(await response.json() as CompanyInsight);
    } catch (error) {
      setInsightError(error instanceof Error ? error.message : "Profil BI indisponible");
    } finally {
      setInsightLoading(false);
    }
  }

  async function loadDossier() {
    if (!focusedCandidate) return;
    setDossierLoading(true);
    setDossierError(null);
    try {
      const response = await fetch(`/api/companies/${focusedCandidate.siren}/dossier`);
      if (!response.ok) throw new Error("Dossier BI indisponible");
      setFocusedDossier(await response.json() as BusinessIntelligenceDossier);
    } catch (error) {
      setDossierError(error instanceof Error ? error.message : "Dossier BI indisponible");
    } finally {
      setDossierLoading(false);
    }
  }

  function targetCv(candidate: Candidate) {
    setCvTarget(candidate);
    setMode("cv");
  }

  function targetProposal(candidate: Candidate) {
    setProposalTarget(candidate);
    setMode("proposal");
  }

  function generateCv() {
    const target = cvTarget ?? focusedCandidate ?? selected[0] ?? null;
    const targetData = target && focusedCandidate?.siren === target.siren ? focusedInsight : null;
    const targetInsight = targetData?.companyProfile;
    const targetContext = target ? [
      "ENTREPRISE CIBLE",
      `${target.name} · ${target.commune} · ${target.sector} · NAF ${target.nafCode}`,
      targetInsight?.activity.label ? `Activité publiée : ${targetInsight.activity.label}${targetInsight.activity.code ? ` (${targetInsight.activity.code})` : ""}.` : target.description,
      targetInsight?.size.workforceBand ? `Taille publiée : ${targetInsight.size.workforceBand}${targetInsight.size.workforceYear ? ` · année ${targetInsight.size.workforceYear}` : ""} · ${targetInsight.size.establishmentCount} implantation(s).` : null,
      targetInsight?.services.length ? `Services explicitement observés : ${targetInsight.services.slice(0, 8).map((item) => item.label).join(", ")}.` : "Aucun service additionnel n’a été confirmé dans les sources consultées.",
      targetData?.publicContracts && targetData.publicContracts.total > 0 ? `Commande publique publiée : ${targetData.publicContracts.total} marché(s) rattaché(s) par SIRET.` : null,
      targetData?.press && targetData.press.total > 0 ? `Presse indexée : ${targetData.press.total} mention(s) dans le cache média (${targetData.press.cacheStatus ?? "statut non renseigné"}).` : null,
      targetData?.recruitment?.status === "ok" && targetData.recruitment.total > 0 ? `Recrutement : ${targetData.recruitment.total} offre(s) avec identifiant SIREN/SIRET correspondant.` : null,
      targetData?.annuaire?.dirigeants?.length ? `Gouvernance publique : ${targetData.annuaire.dirigeants.length} mandat(s) publié(s).` : null,
      targetData?.patents?.total ? `Innovation publiée : ${targetData.patents.total} famille(s) de brevets, dont ${targetData.patents.grantedCount} accordée(s).` : null,
      targetData?.financialRatios?.total && targetData.financialRatios.latestClosingDate ? `Données financières publiées : ${targetData.financialRatios.total} exercice(s), dernier arrêté ${targetData.financialRatios.latestClosingDate}.` : null,
      targetData?.publicGrants?.total ? `Subventions publiques rattachées : ${targetData.publicGrants.total} convention(s).` : null,
      targetData?.ademeAids?.total ? `Aides ADEME rattachées : ${targetData.ademeAids.total} dossier(s).` : null,
      targetData?.fondsVert?.total ? `Projets Fonds vert rattachés : ${targetData.fondsVert.total} projet(s).` : null,
      targetData?.trainingOrganizations?.total ? `Formation déclarée : ${targetData.trainingOrganizations.total} profil(s), dont ${targetData.trainingOrganizations.qualityCount} certifié(s) qualité.` : null,
      targetData?.rge?.activeCount ? `Qualification RGE active : ${targetData.rge.activeCount} qualification(s).` : null,
      targetData?.environmentalCompliance?.total ? `ICPE publiée : ${targetData.environmentalCompliance.total} installation(s) rattachée(s).` : null,
      "Vérifier les informations avant toute prise de contact."
    ].filter((line): line is string => Boolean(line)) : [];
    const territory = selected.slice(0, 5).map((item) => `- ${item.name} · ${item.sector} · ${item.commune}`).join("\n");
    const skills = cvSkills.split(/[;,\n]/).map((value) => value.trim()).filter(Boolean).map((value) => `- ${value}`).join("\n");
    const experiences = cvExperience.trim() || "À compléter avec des expériences vérifiables.";
    const output = [
      cvName.trim() || "NOM PRÉNOM",
      cvRole.trim() || "INTITULÉ CIBLÉ",
      "",
      "PROFIL",
      cvSummary.trim() || "Résumé professionnel à compléter.",
      "",
      "COMPÉTENCES",
      skills || "- À compléter",
      "",
      "EXPÉRIENCES",
      experiences,
      targetContext.length ? "" : null,
      ...targetContext,
      selected.length ? "REPÈRES TERRITORIAUX UTILISÉS POUR LE CIBLAGE" : "",
      territory,
      "",
      "NOTE DE TRANSPARENCE",
      "Brouillon local construit à partir des informations saisies et de noms/secteurs publics sélectionnés. Aucun diplôme, poste, résultat ou compétence n’est inventé."
    ].filter((line, index, lines) => line !== null && (line !== "" || lines[index - 1] !== "")).join("\n");
    setCvOutput(output);
  }

  function generateProposal() {
    const target = proposalTarget ?? focusedCandidate ?? selected[0] ?? null;
    const targetData = target && focusedCandidate?.siren === target.siren ? focusedInsight : null;
    const targetInsight = targetData?.companyProfile;
    const activityLine = targetInsight?.activity.label
      ? "Activité publiée : " + targetInsight.activity.label + (targetInsight.activity.code ? " (" + targetInsight.activity.code + ")" : "") + "."
      : target?.description;
    const observedFacts = target ? [
      target.name + " · " + target.commune + " · " + target.sector + " · NAF " + target.nafCode,
      activityLine,
      targetInsight?.size.workforceBand
        ? "Taille publiée : " + targetInsight.size.workforceBand + (targetInsight.size.workforceYear ? " · année " + targetInsight.size.workforceYear : "") + " · " + targetInsight.size.establishmentCount + " implantation(s)."
        : null,
      targetInsight?.services.length
        ? "Prestations explicitement observées : " + targetInsight.services.slice(0, 8).map((item) => item.label).join(", ") + "."
        : null,
      targetData?.publicContracts && targetData.publicContracts.total > 0
        ? "Commande publique publiée : " + targetData.publicContracts.total + " marché(s) rattaché(s) par SIRET."
        : null,
      targetData?.press && targetData.press.total > 0
        ? "Presse indexée : " + targetData.press.total + " mention(s) dans le cache média (" + (targetData.press.cacheStatus ?? "statut non renseigné") + ")."
        : null,
      targetData?.recruitment?.status === "ok" && targetData.recruitment.total > 0
        ? "Recrutement : " + targetData.recruitment.total + " offre(s) avec identifiant SIREN/SIRET correspondant."
        : null,
      targetData?.annuaire?.dirigeants?.length ? `Gouvernance publique : ${targetData.annuaire.dirigeants.length} mandat(s) publié(s).` : null,
      targetData?.patents?.total ? `Innovation publiée : ${targetData.patents.total} famille(s) de brevets, dont ${targetData.patents.grantedCount} accordée(s).` : null,
      targetData?.financialRatios?.total && targetData.financialRatios.latestClosingDate ? `Données financières publiées : ${targetData.financialRatios.total} exercice(s), dernier arrêté ${targetData.financialRatios.latestClosingDate}.` : null,
      targetData?.publicGrants?.total ? `Subventions publiques rattachées : ${targetData.publicGrants.total} convention(s).` : null,
      targetData?.ademeAids?.total ? `Aides ADEME rattachées : ${targetData.ademeAids.total} dossier(s).` : null,
      targetData?.fondsVert?.total ? `Projets Fonds vert rattachés : ${targetData.fondsVert.total} projet(s).` : null,
      targetData?.trainingOrganizations?.total ? `Formation déclarée : ${targetData.trainingOrganizations.total} profil(s), dont ${targetData.trainingOrganizations.qualityCount} certifié(s) qualité.` : null,
      targetData?.rge?.activeCount ? `Qualification RGE active : ${targetData.rge.activeCount} qualification(s).` : null,
      targetData?.environmentalCompliance?.total ? `ICPE publiée : ${targetData.environmentalCompliance.total} installation(s) rattachée(s).` : null,
    ].filter((line): line is string => Boolean(line)) : ["Aucune entreprise cible sélectionnée."];
    const output = [
      proposalTitle.trim() || (target ? "Proposition commerciale · " + target.name : "PROPOSITION COMMERCIALE"),
      "",
      "DESTINATAIRE / CONTEXTE PUBLIC OBSERVÉ",
      ...observedFacts,
      "",
      "OBJECTIF OU BESOIN À VALIDER",
      proposalObjective.trim() || "À préciser avec le prospect; aucun besoin n'est déduit automatiquement.",
      "",
      "PÉRIMÈTRE PROPOSÉ",
      proposalServices.trim() || "À compléter avec les prestations réellement proposées.",
      "",
      "LIVRABLES",
      proposalDeliverables.trim() || "À compléter.",
      "",
      "BUDGET / MODALITÉS",
      proposalBudget.trim() || "À compléter.",
      "",
      "DÉLAI INDICATIF",
      proposalTiming.trim() || "À compléter après validation du besoin.",
      "",
      "SOURCES ET TRANSPARENCE",
      targetData
        ? "Profil BI agrégé le " + targetData.retrievedAt.slice(0, 10) + " à partir de sources publiques; couverture observée : " + (targetInsight?.coverage.observedSources ?? 0) + " source(s)."
        : "Contexte limité aux informations SIRENE publiques sélectionnées.",
      "Ces éléments sont des signaux de qualification, pas une confirmation du besoin, du budget ou de la décision d'achat. Vérifier les informations avant envoi."
    ].join("\n");
    setProposalOutput(output);
  }

  return (
    <main className="studio-page">
      <header className="studio-header">
        <div>
          <Link className="small muted" href="/">← Retour à la carte</Link>
          <span className="panel-kicker"><Target size={15} aria-hidden="true" /> Studio de ciblage</span>
          <h1>Transformer la donnée en action</h1>
          <p className="muted">Shortlist professionnelle, export public et brouillon de CV ciblé à partir d’informations vérifiables.</p>
        </div>
        <div className="studio-source-note">SIRENE · établissements actifs · identifiants publics</div>
      </header>

      <div className="studio-tabs" role="tablist" aria-label="Outils territoriaux">
        <button type="button" role="tab" aria-selected={mode === "prospecting"} onClick={() => setMode("prospecting")}><Target size={16} aria-hidden="true" /> Prospection</button>
        <button type="button" role="tab" aria-selected={mode === "cv"} onClick={() => setMode("cv")}><FileText size={16} aria-hidden="true" /> CV ciblé</button>
        <button type="button" role="tab" aria-selected={mode === "proposal"} onClick={() => setMode("proposal")}><FileText size={16} aria-hidden="true" /> Proposition</button>
      </div>

      {mode === "prospecting" ? <section className="studio-grid" aria-label="Prospection territoriale">
        <div className="studio-main">
          <div className="studio-toolbar">
            <label><span className="label">Recherche entreprise ou secteur</span><div className="studio-input-wrap"><Search size={17} aria-hidden="true" /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ex. restauration, numérique, atelier" /></div></label>
            <label><span className="label">Secteur</span><select className="input" value={sector} onChange={(event) => setSector(event.target.value)}><option value="">Tous</option>{sectors.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <label><span className="label">Commune</span><select className="input" value={commune} onChange={(event) => setCommune(event.target.value)}><option value="">Toutes</option>{communes.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <button className="button" type="button" onClick={() => void saveSearch()} title="Enregistrer la recherche dans l’espace de travail"><Bookmark size={16} aria-hidden="true" /> Enregistrer</button>
          </div>
          <div className="studio-result-heading"><div><h2>Entreprises à qualifier</h2><p className="small muted">{loading ? "Recherche…" : `${candidates.length} établissement(s) affiché(s)`}</p></div><span className="badge">Données publiques</span></div>
          {requestError ? <p className="studio-error" role="alert">{requestError}</p> : null}
          <div className="candidate-list" role="list">
            {candidates.map((candidate) => <article className="candidate-row" key={candidate.establishmentId} role="listitem">
              <div className="candidate-copy"><div className="candidate-heading"><h3>{candidate.name}</h3>{candidate.isHeadOffice ? <span className="badge">Siège</span> : null}</div><p className="small muted">{candidate.commune} · {candidate.sector} · NAF {candidate.nafCode}</p><p className="small">{candidate.description}</p><p className="small muted">SIREN {candidate.siren} · {candidate.workforceBand ?? "Effectif non renseigné"}</p></div>
              <div className="candidate-actions"><button className="button" type="button" onClick={() => toggleCandidate(candidate)}>{selectedSirens.has(candidate.siren) ? "Retirer" : "Ajouter"}</button><button className="button" type="button" onClick={() => inspectCandidate(candidate)}><BarChart3 size={15} aria-hidden="true" /> {focusedCandidate?.siren === candidate.siren && insightLoading ? "Analyse…" : "BI"}</button><Link className="button" href={candidate.url as Route}>Fiche <span aria-hidden="true">↗</span></Link></div>
            </article>)}
            {!loading && !candidates.length ? <p className="empty-state">Aucun établissement correspondant dans l’index actif. Élargissez la commune ou la recherche.</p> : null}
          </div>
        </div>
        <aside className="studio-aside">
          <div className="studio-aside-heading"><div><span className="detail-eyebrow">Ma shortlist</span><h2>{selected.length} / 50</h2></div><button className="icon-button" type="button" onClick={() => setSelected([])} aria-label="Vider la shortlist" title="Vider la shortlist"><X size={17} aria-hidden="true" /></button></div>
          <p className="small muted">La sélection est conservée dans un espace anonyme pendant 180 jours. Elle ne contient que des identifiants et informations professionnelles publiques.</p>
          <div className="shortlist-list">{selected.map((candidate) => <div className="shortlist-item" key={candidate.establishmentId}><span>{candidate.name}</span><small>{candidate.commune} · {candidate.sector}</small></div>)}</div>
          <div className="candidate-actions studio-action-row"><button className="button primary" type="button" disabled={!selected.length} onClick={() => void saveShortlist()}><Bookmark size={16} aria-hidden="true" /> Enregistrer</button><button className="button" type="button" disabled={!selected.length} onClick={exportShortlist}><Download size={16} aria-hidden="true" /> Exporter CSV</button></div>
          <details className="profile-proof-details workspace-details">
            <summary>{workspaceLoading ? "Chargement de l’espace…" : `Espace de travail · ${savedSearches.length} recherche(s), ${savedShortlists.length} shortlist(s)`}</summary>
            {savedSearches.length ? <div className="workspace-items"><strong>Recherches enregistrées</strong>{savedSearches.slice(0, 8).map((search) => <button className="workspace-item" type="button" key={search.id} onClick={() => restoreSearch(search)}><span>{search.name}</span><small>{search.query || search.sector || search.commune || "Territoire complet"}</small></button>)}</div> : null}
            {savedShortlists.length ? <div className="workspace-items"><strong>Shortlists enregistrées</strong>{savedShortlists.slice(0, 8).map((shortlist) => <button className="workspace-item" type="button" key={shortlist.id} onClick={() => { setSelected(shortlist.items); setWorkspaceStatus(`Shortlist restaurée : ${shortlist.name}`); }}><span>{shortlist.name}</span><small>{shortlist.items.length} entreprise(s)</small></button>)}</div> : null}
            {!savedSearches.length && !savedShortlists.length ? <p className="small muted">Aucun élément enregistré.</p> : null}
            <button className="button" type="button" onClick={() => void clearWorkspace()}>Supprimer mes données</button>
          </details>
          {workspaceStatus ? <p className="small" role="status">{workspaceStatus}</p> : null}
          {focusedCandidate ? <div className="studio-insight" aria-live="polite">
            <div className="studio-aside-heading"><div><span className="detail-eyebrow">Lecture BI</span><h2>{focusedCandidate.name}</h2></div><span className="badge">À la demande</span></div>
            {insightLoading ? <p className="small muted">Agrégation des sources publiques…</p> : null}
            {insightError ? <p className="studio-error" role="alert">{insightError}</p> : null}
            {focusedInsight?.companyProfile ? <>
              <p className="small">{focusedInsight.companyProfile.summary}</p>
              <p className="small muted">{focusedInsight.companyProfile.size.workforceBand ?? "Effectif non renseigné"} · {focusedInsight.companyProfile.size.establishmentCount} implantation(s) · {focusedInsight.companyProfile.coverage.observedSources} source(s) avec donnée</p>
              <dl className="studio-facts">
                <div><dt>Prestations observées</dt><dd>{focusedInsight.companyProfile.services.length}</dd></div>
                <div><dt>Événements BODACC</dt><dd>{focusedInsight.bodacc?.total ?? 0}</dd></div>
                <div><dt>Marchés publics</dt><dd>{focusedInsight.publicContracts?.total ?? 0}</dd></div>
                <div><dt>Mentions presse</dt><dd>{focusedInsight.press?.total ?? 0}</dd></div>
                <div><dt>Offres identifiées</dt><dd>{focusedInsight.recruitment?.status === "ok" ? focusedInsight.recruitment.total : "NC"}</dd></div>
                <div><dt>Sites accessibles</dt><dd>{focusedInsight.websites?.accessibleSitesCount ?? 0}</dd></div>
              </dl>
              {secondaryFacts.length ? <details className="profile-proof-details">
                <summary>Autres signaux BI ({secondaryFacts.length})</summary>
                <dl className="studio-facts">
                  {secondaryFacts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
                </dl>
              </details> : null}
              {focusedInsight.companyProfile.services.length ? <div className="studio-insight-chips">{focusedInsight.companyProfile.services.slice(0, 8).map((item) => <span className="badge" key={`${item.source}-${item.label}`}>{item.label}</span>)}</div> : null}
              {focusedInsight.companyProfile.signals.length ? <p className="small muted">Signaux : {focusedInsight.companyProfile.signals.slice(0, 3).map((item) => item.label).join(" · ")}</p> : null}
              <div className="candidate-actions dossier-actions">
                <button className="button primary" type="button" onClick={() => void loadDossier()} disabled={dossierLoading}><Database size={15} aria-hidden="true" /> {dossierLoading ? "Chargement…" : focusedDossier ? "Actualiser le dossier" : "Ouvrir le dossier BI"}</button>
                {focusedDossier ? <button className="button" type="button" onClick={() => downloadText(`dossier-bi-${focusedDossier.siren}.md`, dossierMarkdown(focusedDossier), "text/markdown;charset=utf-8")}><Download size={15} aria-hidden="true" /> Exporter Markdown</button> : null}
              </div>
              {dossierError ? <p className="studio-error" role="alert">{dossierError}</p> : null}
              {focusedDossier ? <section className="dossier-readout" aria-label={`Dossier BI de ${focusedCandidate.name}`}>
                <div className="dossier-heading"><div><span className="detail-eyebrow">Dossier sourcé</span><h3>{focusedCandidate.name}</h3></div><span className="badge">{focusedDossier.coverage.observedSources}/{focusedDossier.coverage.totalSources} sources observées</span></div>
                <p className="small">{focusedDossier.description.evidence} Source : {focusedDossier.description.source}. Confiance : {focusedDossier.description.confidence}. Récupéré le {dossierDate(focusedDossier.retrievedAt)}.</p>
                <div className="dossier-highlights">
                  {focusedDossier.highlights.slice(0, 4).map((item) => <DossierEvidenceRow key={item.id} item={item} />)}
                </div>
                <div className="dossier-sections">
                  {focusedDossier.sections.map((section, index) => <details className="dossier-block" key={section.id} open={index === 0}>
                    <summary>{section.title} <span>{section.evidence.length} preuve(s)</span></summary>
                    <p className="small muted">{section.intro}</p>
                    <div className="dossier-evidence-list">{section.evidence.map((item) => <DossierEvidenceRow key={item.id} item={item} />)}</div>
                  </details>)}
                  {focusedDossier.governance.edges.length ? <details className="dossier-block">
                    <summary>Mandats légaux publiés <span>{focusedDossier.governance.edges.length}</span></summary>
                    <div className="dossier-governance-list">{focusedDossier.governance.edges.map((edge) => <div className="dossier-governance-row" key={edge.id}><strong>{edge.from}</strong><span>{edge.role} → {edge.to}</span><small>{edge.source} · {dossierDate(edge.referenceDate)}</small></div>)}</div>
                    <p className="small muted">{focusedDossier.governance.note}</p>
                  </details> : null}
                  {focusedDossier.press.length ? <details className="dossier-block">
                    <summary>Mentions média <span>{focusedDossier.press.length}</span></summary>
                    <div className="dossier-press-list">{focusedDossier.press.map((mention) => <article key={mention.url}><a href={mention.url} target="_blank" rel="noopener noreferrer"><strong>{mention.title}</strong></a><small>{mention.source}{mention.domain ? ` · ${mention.domain}` : ""}{mention.publishedAt ? ` · ${dossierDate(mention.publishedAt)}` : ""}</small></article>)}</div>
                    <p className="small muted">La veille média dépend des index disponibles et ne constitue pas une couverture exhaustive.</p>
                  </details> : null}
                  {focusedDossier.timeline.length ? <details className="dossier-block">
                    <summary>Chronologie publique <span>{focusedDossier.timeline.length}</span></summary>
                    <div className="dossier-timeline-list">{focusedDossier.timeline.map((event) => <article key={event.id}><time dateTime={event.date}>{dossierDate(event.date)}</time><div><strong>{event.label}</strong>{event.detail ? <p>{event.detail}</p> : null}<small>{event.source}</small></div></article>)}</div>
                  </details> : null}
                  <details className="dossier-block">
                    <summary>Limites et couverture <span>{focusedDossier.coverage.totalSources}</span></summary>
                    <ul className="dossier-limits">{focusedDossier.limits.map((limit) => <li key={limit}>{limit}</li>)}</ul>
                    <div className="dossier-source-list">{focusedDossier.coverage.sources.map((source) => <div key={source.source} data-status={source.status}><strong>{source.source}</strong><span>{source.status}</span>{source.detail ? <small>{source.detail}</small> : null}</div>)}</div>
                  </details>
                </div>
              </section> : null}
              <div className="candidate-actions"><button className="button primary" type="button" onClick={() => targetProposal(focusedCandidate)}><FileText size={15} aria-hidden="true" /> Proposition</button><button className="button" type="button" onClick={() => targetCv(focusedCandidate)}><FileText size={15} aria-hidden="true" /> Cibler le CV</button><Link className="button" href={focusedCandidate.url as Route}>Fiche ↗</Link></div>
            </> : null}
          </div> : null}
        </aside>
      </section> : mode === "cv" ? <section className="cv-layout" aria-label="Générateur de CV ciblé">
        <div className="cv-form">
          <div className="studio-result-heading"><div><h2>Construire un brouillon ciblé</h2><p className="small muted">Les champs personnels viennent de vous. Les entreprises sélectionnées servent uniquement de repères de ciblage.</p></div></div>
          {cvTarget ? <div className="cv-target-banner"><span className="detail-eyebrow">Cible sélectionnée</span><strong>{cvTarget.name}</strong><span className="small muted">{cvTarget.commune} · {cvTarget.sector} · SIREN {cvTarget.siren}</span>{focusedInsight?.companyProfile ? <p className="small">{focusedInsight.companyProfile.summary}</p> : <p className="small muted">Analyse BI non chargée pour cette cible. Le brouillon restera limité aux données SIRENE publiées.</p>}</div> : null}
          <label><span className="label">Nom affiché</span><input className="input" value={cvName} onChange={(event) => setCvName(event.target.value)} placeholder="Votre nom" /></label>
          <label><span className="label">Poste recherché</span><input className="input" value={cvRole} onChange={(event) => setCvRole(event.target.value)} placeholder="Ex. chargé de projet" /></label>
          <label><span className="label">Résumé professionnel</span><textarea className="input studio-textarea" value={cvSummary} onChange={(event) => setCvSummary(event.target.value)} placeholder="Votre expérience, votre valeur et le contexte recherché." /></label>
          <label><span className="label">Compétences</span><textarea className="input studio-textarea" value={cvSkills} onChange={(event) => setCvSkills(event.target.value)} placeholder="Une compétence par ligne ou séparée par des virgules." /></label>
          <label><span className="label">Expériences vérifiables</span><textarea className="input studio-textarea studio-textarea-large" value={cvExperience} onChange={(event) => setCvExperience(event.target.value)} placeholder="Périodes, employeurs, réalisations et résultats que vous pouvez justifier." /></label>
          <button className="button primary" type="button" onClick={generateCv}><FileText size={16} aria-hidden="true" /> Générer le brouillon</button>
        </div>
        <aside className="cv-preview">
          <div className="studio-aside-heading"><div><span className="detail-eyebrow">Sortie locale</span><h2>CV ciblé</h2></div><span className="badge">Sans envoi</span></div>
          {cvOutput ? <><pre className="cv-output">{cvOutput}</pre><div className="candidate-actions"><button className="button primary" type="button" onClick={() => void saveDraft("cv", cvOutput, cvName || "CV ciblé", cvTarget?.siren ?? focusedCandidate?.siren ?? null)}><Bookmark size={16} aria-hidden="true" /> Enregistrer</button><button className="button" type="button" onClick={() => downloadText("cv-cible-guadeloupe.txt", cvOutput)}><Download size={16} aria-hidden="true" /> Télécharger le texte</button></div></> : <p className="empty-state">Le brouillon apparaîtra ici après génération.</p>}
        </aside>
      </section> : <section className="cv-layout" aria-label="Préparation de proposition commerciale">
        <div className="cv-form">
          <div className="studio-result-heading"><div><h2>Préparer une proposition commerciale</h2><p className="small muted">Le contexte public est prérempli; votre offre et les conditions restent sous votre contrôle.</p></div></div>
          {proposalTarget ? <div className="cv-target-banner"><span className="detail-eyebrow">Cible sélectionnée</span><strong>{proposalTarget.name}</strong><span className="small muted">{proposalTarget.commune} · {proposalTarget.sector} · SIREN {proposalTarget.siren}</span>{focusedInsight?.companyProfile ? <p className="small">{focusedInsight.companyProfile.summary}</p> : <p className="small muted">Analyse BI non chargée pour cette cible. Le brief restera limité aux données publiques de base.</p>}</div> : null}
          <label><span className="label">Objet de la proposition</span><input className="input" value={proposalTitle} onChange={(event) => setProposalTitle(event.target.value)} placeholder="Ex. Accompagnement de la présence numérique" /></label>
          <label><span className="label">Objectif ou besoin à valider</span><textarea className="input studio-textarea" value={proposalObjective} onChange={(event) => setProposalObjective(event.target.value)} placeholder="Ce que le prospect a exprimé ou ce que vous devez confirmer." /></label>
          <label><span className="label">Prestations proposées</span><textarea className="input studio-textarea" value={proposalServices} onChange={(event) => setProposalServices(event.target.value)} placeholder="Une prestation par ligne; ne conserver que ce que vous pouvez réellement délivrer." /></label>
          <label><span className="label">Livrables</span><textarea className="input studio-textarea" value={proposalDeliverables} onChange={(event) => setProposalDeliverables(event.target.value)} placeholder="Livrables, jalons et critères de validation." /></label>
          <label><span className="label">Budget / modalités</span><input className="input" value={proposalBudget} onChange={(event) => setProposalBudget(event.target.value)} placeholder="Ex. Forfait, régie ou budget à définir" /></label>
          <label><span className="label">Délai indicatif</span><input className="input" value={proposalTiming} onChange={(event) => setProposalTiming(event.target.value)} placeholder="Ex. 6 semaines après validation" /></label>
          <button className="button primary" type="button" onClick={generateProposal}><FileText size={16} aria-hidden="true" /> Générer la proposition</button>
        </div>
        <aside className="cv-preview">
          <div className="studio-aside-heading"><div><span className="detail-eyebrow">Sortie locale</span><h2>Proposition commerciale</h2></div><span className="badge">Sans envoi</span></div>
          {proposalOutput ? <><pre className="cv-output">{proposalOutput}</pre><div className="candidate-actions"><button className="button primary" type="button" onClick={() => void saveDraft("proposal", proposalOutput, proposalTitle || "Proposition commerciale", proposalTarget?.siren ?? focusedCandidate?.siren ?? null)}><Bookmark size={16} aria-hidden="true" /> Enregistrer</button><button className="button" type="button" onClick={() => downloadText("proposition-commerciale-guadeloupe.txt", proposalOutput)}><Download size={16} aria-hidden="true" /> Télécharger le texte</button></div></> : <p className="empty-state">La proposition apparaîtra ici après génération.</p>}
        </aside>
      </section>}
    </main>
  );
}
