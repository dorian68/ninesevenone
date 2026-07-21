import "server-only";
import { getBusinessIntelligence } from "@/lib/business-intelligence";
import type {
  BusinessIntelligenceDossier,
  DossierConfidence,
  DossierEvidence,
  DossierSection
} from "@/lib/business-intelligence-dossier-types";

type Intelligence = Awaited<ReturnType<typeof getBusinessIntelligence>>;

const SOURCE_URLS: Record<string, string> = {
  SIRENE: "https://www.insee.fr/fr/information/2015441",
  Annuaire: "https://annuaire-entreprises.data.gouv.fr/",
  "Sites publics": "https://www.openstreetmap.org/",
  OSM: "https://www.openstreetmap.org/",
  RNA: "https://www.data.gouv.fr/datasets/rna-agrege-a-lechelle-nationale",
  "Organismes de formation": "https://www.data.gouv.fr/datasets/liste-publique-des-organismes-de-formation-l-6351-7-1-du-code-du-travail",
  "Index égalité": "https://www.data.gouv.fr/datasets/index-egalite-professionnelle-f-h-des-entreprises-de-50-salaries-ou-plus",
  "Conventions & OPCO": "https://www.data.gouv.fr/datasets/liste-des-conventions-collectives-par-entreprise-siret",
  Brevets: "https://www.data.gouv.fr/datasets/familles-de-brevets",
  "Ratios financiers": "https://www.data.gouv.fr/datasets/ratios-financiers-bce-inpi",
  "Bilans détaillés": "https://www.data.gouv.fr/datasets/donnees-financieres-detaillees-des-entreprises-format-parquet",
  "Géorisques ICPE": "https://www.georisques.gouv.fr/donnees/bases-de-donnees/installations-industrielles",
  SCDL: "https://schema.data.gouv.fr/scdl/subventions/",
  "ADEME Aides": "https://data.ademe.fr/datasets/les-aides-financieres-de-l-ademe",
  "Fonds vert": "https://www.data.gouv.fr/datasets/fonds-vert-liste-des-projets-subventionnes",
  "France Relance": "https://www.data.gouv.fr/datasets/plan-de-relance-projets-industriels-liste-geolocalisation-et-description-synthetique-des-projets",
  "ADEME RGE": "https://data.ademe.fr/datasets/historique-rge",
  BODACC: "https://www.bodacc.fr/",
  DECP: "https://data.economie.gouv.fr/explore/dataset/decp_augmente/",
  Presse: "https://news.google.com/"
};

function clean(value: unknown) {
  return typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim() : null;
}

function short(value: unknown, max = 520) {
  const result = clean(value);
  return result ? result.slice(0, max) : null;
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function currency(value: unknown) {
  const parsed = number(value);
  return parsed === null ? null : `${parsed.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €`;
}

function date(value: unknown) {
  return clean(value);
}

function latestDate(...values: unknown[]) {
  return values
    .map((value) => date(value))
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
}

function confidence(value: unknown): DossierConfidence {
  const parsed = number(value);
  if (typeof value === "string" && ["high", "medium", "low"].includes(value)) return value as DossierConfidence;
  if ((parsed ?? 0) >= 0.8) return "high";
  if ((parsed ?? 0) >= 0.6) return "medium";
  return "low";
}

function sourceUrl(data: Intelligence, source: string) {
  return data.companyProfile.coverage.sources.find((item) => item.source === source)?.sourceUrl
    ?? SOURCE_URLS[source]
    ?? null;
}

function descriptionSourceLabel(source: Intelligence["companyProfile"]["descriptionSource"]) {
  if (source === "official_website") return "Site professionnel public";
  if (source === "bodacc") return "BODACC";
  if (source === "naf_generated") return "Activité NAF publiée";
  return "Donnée structurée publique";
}

function addEvidence(
  target: DossierEvidence[],
  input: Omit<DossierEvidence, "kind"> & { kind?: DossierEvidence["kind"] }
) {
  const value = short(input.value);
  if (!value) return;
  target.push({ ...input, value, kind: input.kind ?? "fact" });
}

function addCount(
  target: DossierEvidence[],
  input: {
    id: string;
    label: string;
    count: number | null | undefined;
    source: string;
    sourceUrl?: string | null;
    referenceDate?: string | null;
    confidence?: DossierConfidence;
    suffix?: string;
    scope?: string | null;
  }
) {
  if (!input.count || input.count <= 0) return;
  addEvidence(target, {
    id: input.id,
    label: input.label,
    value: `${input.count.toLocaleString("fr-FR")}${input.suffix ?? ""}`,
    source: input.source,
    sourceUrl: input.sourceUrl ?? null,
    referenceDate: input.referenceDate ?? null,
    confidence: input.confidence ?? "high",
    scope: input.scope ?? null
  });
}

function buildIdentitySection(data: Intelligence): DossierSection {
  const profile = data.companyProfile;
  const evidence: DossierEvidence[] = [];
  const descriptionProof = profile.proofs.find((proof) => proof.label === "Description publiée" || proof.label === "Activité BODACC");
  addEvidence(evidence, {
    id: "description",
    label: "Description de l’activité",
    value: profile.summary,
    source: descriptionSourceLabel(profile.descriptionSource),
    sourceUrl: descriptionProof?.sourceUrl ?? sourceUrl(data, "Sites publics"),
    referenceDate: descriptionProof?.referenceDate ?? profile.coverage.generatedAt,
    confidence: profile.descriptionConfidence
  });
  if (profile.activity.label || profile.activity.code) {
    addEvidence(evidence, {
      id: "naf",
      label: "Activité principale publiée",
      value: [profile.activity.label, profile.activity.code].filter(Boolean).join(" · "),
      source: "SIRENE / Annuaire des Entreprises",
      sourceUrl: sourceUrl(data, "SIRENE"),
      referenceDate: profile.size.sourceReferenceDate,
      confidence: "high"
    });
  }
  profile.services.forEach((service, index) => addEvidence(evidence, {
    id: `service-${index}`,
    label: "Prestation ou spécialité observée",
    value: service.label,
    source: service.source,
    sourceUrl: service.sourceUrl,
    referenceDate: profile.coverage.generatedAt,
    confidence: service.confidence
  }));
  data.websites.descriptions.slice(0, 5).forEach((description, index) => addEvidence(evidence, {
    id: `website-description-${index}`,
    label: "Description publiée sur un site",
    value: description.text,
    source: description.siteName ? `Site professionnel public · ${description.siteName}` : "Site professionnel public",
    sourceUrl: description.url,
    referenceDate: description.fetchedAt,
    confidence: confidence(description.confidence)
  }));
  return {
    id: "identity-activity",
    title: "Activité et prestations",
    intro: "Les éléments ci-dessous décrivent ce qui est publié ou observé, sans ajouter de service non confirmé.",
    evidence
  };
}

function buildScaleSection(data: Intelligence): DossierSection {
  const profile = data.companyProfile;
  const evidence: DossierEvidence[] = [];
  addEvidence(evidence, {
    id: "workforce",
    label: "Tranche d’effectif publiée",
    value: profile.size.workforceBand ?? "Effectif non renseigné",
    source: profile.size.source,
    sourceUrl: sourceUrl(data, "SIRENE"),
    referenceDate: profile.size.sourceReferenceDate,
    confidence: profile.size.workforceBand ? "high" : "low",
    kind: profile.size.workforceBand ? "fact" : "absence"
  });
  if (profile.size.companyCategory) addEvidence(evidence, {
    id: "company-category",
    label: "Catégorie d’entreprise",
    value: profile.size.companyCategory,
    source: profile.size.source,
    sourceUrl: sourceUrl(data, "SIRENE"),
    referenceDate: profile.size.sourceReferenceDate,
    confidence: "high"
  });
  addEvidence(evidence, {
    id: "establishments",
    label: "Implantations actives",
    value: `${profile.size.establishmentCount.toLocaleString("fr-FR")} établissement(s), dont ${profile.size.employerEstablishmentCount.toLocaleString("fr-FR")} employeur(s) déclaré(s)`,
    source: profile.size.source,
    sourceUrl: sourceUrl(data, "SIRENE"),
    referenceDate: profile.size.sourceReferenceDate,
    confidence: "high",
    scope: "Périmètre Guadeloupe indexé"
  });

  const latestRatio = [...data.financialRatios.exercises].sort((left, right) => String(right.closingDate ?? "").localeCompare(String(left.closingDate ?? "")))[0];
  const latestStatement = [...data.detailedFinancials.statements].sort((left, right) => String(right.closingDate ?? "").localeCompare(String(left.closingDate ?? "")))[0];
  const financialSource = data.financialRatios.total ? "Ratios financiers BCE / INPI" : "Bilans détaillés BCE / INPI";
  const financialUrl = data.financialRatios.total ? data.financialRatios.sourceUrl : data.detailedFinancials.sourceUrl;
  const financialDate = latestDate(latestRatio?.closingDate, latestStatement?.closingDate);
  if (latestRatio?.revenue !== null && latestRatio?.revenue !== undefined) addEvidence(evidence, {
    id: "revenue",
    label: "Chiffre d’affaires publié",
    value: currency(latestRatio.revenue) ?? "Non affiché",
    source: financialSource,
    sourceUrl: financialUrl,
    referenceDate: financialDate,
    confidence: "high",
    scope: "Unité légale nationale · exercice publié"
  });
  if (latestRatio?.netIncome !== null && latestRatio?.netIncome !== undefined) addEvidence(evidence, {
    id: "net-income",
    label: "Résultat net publié",
    value: currency(latestRatio.netIncome) ?? "Non affiché",
    source: financialSource,
    sourceUrl: financialUrl,
    referenceDate: financialDate,
    confidence: "high",
    scope: "Unité légale nationale · exercice publié"
  });
  addCount(evidence, {
    id: "financial-exercises",
    label: "Exercices financiers indexés",
    count: data.financialRatios.total || data.detailedFinancials.total,
    source: financialSource,
    sourceUrl: financialUrl,
    referenceDate: latestDate(data.financialRatios.latestClosingDate, data.detailedFinancials.latestClosingDate),
    suffix: " exercice(s)",
    scope: "Unité légale nationale"
  });
  if (data.financialRatios.partiallyConfidentialCount > 0) addEvidence(evidence, {
    id: "financial-confidentiality",
    label: "Confidentialité partielle",
    value: `${data.financialRatios.partiallyConfidentialCount.toLocaleString("fr-FR")} exercice(s) comportent des montants non affichés dans la source publique.`,
    source: "Ratios financiers BCE / INPI",
    sourceUrl: data.financialRatios.sourceUrl,
    referenceDate: data.financialRatios.sourceUpdatedAt,
    confidence: "high",
    kind: "warning",
    scope: "Unité légale nationale"
  });
  addCount(evidence, {
    id: "public-contracts",
    label: "Marchés publics rattachés",
    count: data.publicContracts.total,
    source: "DECP",
    sourceUrl: data.publicContracts.contracts[0]?.sourceUrl ?? sourceUrl(data, "DECP"),
    referenceDate: data.publicContracts.latestDate,
    suffix: " marché(s)",
    scope: "Rattachement par SIRET publié"
  });
  if (data.publicContracts.totalAmount !== null) addEvidence(evidence, {
    id: "public-contract-amount",
    label: "Montant de marchés publié",
    value: currency(data.publicContracts.totalAmount) ?? "Non affiché",
    source: "DECP",
    sourceUrl: data.publicContracts.contracts[0]?.sourceUrl ?? sourceUrl(data, "DECP"),
    referenceDate: data.publicContracts.latestDate,
    confidence: "high",
    scope: "Montants présents dans les avis rattachés"
  });
  if (data.recruitment.status === "ok") addCount(evidence, {
    id: "recruitment",
    label: "Offres d’emploi rattachées",
    count: data.recruitment.total,
    source: "France Travail",
    sourceUrl: data.recruitment.sourceUrl,
    referenceDate: data.recruitment.retrievedAt,
    suffix: " offre(s)",
    confidence: "medium",
    scope: "Correspondance SIREN/SIRET publiée"
  });
  return {
    id: "scale-finance",
    title: "Taille, implantation et activité économique",
    intro: "Les effectifs et indicateurs financiers restent rattachés à leur périmètre exact : établissement guadeloupéen ou unité légale nationale.",
    evidence
  };
}

function buildSignalSection(data: Intelligence): DossierSection {
  const evidence: DossierEvidence[] = [];
  addCount(evidence, { id: "bodacc", label: "Annonces commerciales", count: data.bodacc.total, source: "BODACC", sourceUrl: data.bodacc.sourceUrl, referenceDate: data.bodacc.retrievedAt, suffix: " annonce(s)" });
  addCount(evidence, { id: "press", label: "Mentions média indexées", count: data.press.total, source: "Veille média", sourceUrl: sourceUrl(data, "Presse"), referenceDate: data.press.fetchedAt, suffix: " mention(s)", confidence: "low" });
  addCount(evidence, { id: "patents", label: "Familles de brevets", count: data.patents.total, source: "Données brevets", sourceUrl: data.patents.familiesSourceUrl, referenceDate: data.patents.familiesSourceUpdatedAt, suffix: " famille(s)" });
  addCount(evidence, { id: "grants", label: "Subventions publiques", count: data.publicGrants.total, source: "SCDL", sourceUrl: data.publicGrants.schemaUrl, referenceDate: latestDate(data.publicGrants.latestDate, data.publicGrants.sourceReferenceDate), suffix: " convention(s)" });
  if (data.publicGrants.totalAmount !== null) addEvidence(evidence, { id: "grant-amount", label: "Montant de subventions publié", value: currency(data.publicGrants.totalAmount) ?? "Non affiché", source: "SCDL", sourceUrl: data.publicGrants.schemaUrl, referenceDate: data.publicGrants.latestDate, confidence: "high", scope: "Montants attribués ou publiés, pas une preuve de versement" });
  addCount(evidence, { id: "ademe-aids", label: "Aides ADEME", count: data.ademeAids.total, source: "ADEME Aides", sourceUrl: data.ademeAids.sourceUrl, referenceDate: data.ademeAids.sourceUpdatedAt, suffix: " dossier(s)" });
  addCount(evidence, { id: "fonds-vert", label: "Projets Fonds vert", count: data.fondsVert.total, source: "Fonds vert", sourceUrl: data.fondsVert.sourceUrl, referenceDate: data.fondsVert.sourceUpdatedAt, suffix: " projet(s)" });
  addCount(evidence, { id: "france-relance", label: "Projets France Relance", count: data.franceRelance.total, source: "France Relance", sourceUrl: data.franceRelance.sourceUrl, referenceDate: data.franceRelance.latestDate, suffix: " projet(s)" });
  addCount(evidence, { id: "training", label: "Profils d’organisme de formation", count: data.trainingOrganizations.total, source: "Organismes de formation", sourceUrl: data.trainingOrganizations.sourceUrl, referenceDate: data.trainingOrganizations.sourceUpdatedAt, suffix: " profil(s)" });
  addCount(evidence, { id: "rge", label: "Qualifications RGE actives", count: data.rge.activeCount, source: "ADEME RGE", sourceUrl: data.rge.sourceUrl, referenceDate: data.rge.sourceUpdatedAt, suffix: " qualification(s)" });
  addCount(evidence, { id: "icpe", label: "Installations ICPE", count: data.environmentalCompliance.total, source: "Géorisques ICPE", sourceUrl: data.environmentalCompliance.sourceUrl, referenceDate: data.environmentalCompliance.sourceUpdatedAt, suffix: " installation(s)" });
  addCount(evidence, { id: "osm", label: "Présences locales OSM", count: data.osmPresence.total, source: "OpenStreetMap", sourceUrl: data.osmPresence.sourceUrl, referenceDate: data.osmPresence.sourceReferenceDate, suffix: " présence(s)", confidence: "medium" });
  addCount(evidence, { id: "association", label: "Profils RNA rattachés", count: data.association.total, source: "RNA", sourceUrl: data.association.sourceUrl, referenceDate: data.association.sourceReferenceDate, suffix: " profil(s)" });
  addCount(evidence, { id: "equality", label: "Déclarations égalité professionnelle", count: data.professionalEquality.total, source: "Index égalité", sourceUrl: data.professionalEquality.sourceUrl, referenceDate: data.professionalEquality.sourceUpdatedAt, suffix: " déclaration(s)" });
  addCount(evidence, { id: "agreements", label: "Établissements avec conventions / OPCO", count: data.collectiveAgreements.total, source: "Conventions & OPCO", sourceUrl: data.collectiveAgreements.idccSourceUrl, referenceDate: latestDate(data.collectiveAgreements.sourceUpdatedAt, data.collectiveAgreements.siroSourceUpdatedAt), suffix: " établissement(s)" });
  return {
    id: "signals",
    title: "Signaux publics et écosystème",
    intro: "Ces signaux servent à qualifier l’entreprise et ses activités publiques ; ils ne constituent pas une notation commerciale ou financière.",
    evidence
  };
}

function buildGovernance(data: Intelligence): BusinessIntelligenceDossier["governance"] {
  const nodeLabels = new Map(data.governanceNetwork.nodes.map((node) => [node.id, node.label]));
  return {
    edges: data.governanceNetwork.edges.map((edge) => ({
      id: edge.id,
      from: nodeLabels.get(edge.source) ?? edge.source,
      to: nodeLabels.get(edge.target) ?? edge.target,
      role: edge.role,
      referenceDate: edge.sourceUpdatedAt,
      source: "RNE via Annuaire des Entreprises",
      sourceUrl: data.annuaire.sourceUrl ?? sourceUrl(data, "Annuaire")
    })),
    note: data.governanceNetwork.note
  };
}

export function buildBusinessIntelligenceDossier(data: Intelligence): BusinessIntelligenceDossier {
  const sections = [buildIdentitySection(data), buildScaleSection(data), buildSignalSection(data)];
  const governance = buildGovernance(data);
  const descriptionProof = data.companyProfile.proofs.find((proof) => proof.label === "Description publiée" || proof.label === "Activité BODACC");
  const coverage = {
    observedSources: data.companyProfile.coverage.observedSources,
    totalSources: data.companyProfile.coverage.sources.length,
    evidenceCount: sections.reduce((total, section) => total + section.evidence.length, 0) + data.timeline.length + data.press.mentions.length + governance.edges.length,
    sources: data.companyProfile.coverage.sources
  };
  const highlights = sections.flatMap((section) => section.evidence).filter((item) => item.kind === "fact").slice(0, 8);
  const limits = [
    "Les descriptions et prestations sont reprises de données publiques observées ou d’une formulation NAF factuelle ; elles ne remplacent pas une validation humaine.",
    "Le réseau de gouvernance restitue des mandats légaux publiés. Il ne déduit ni hiérarchie opérationnelle, ni équipes, ni bénéficiaires effectifs.",
    "Les données financières sont rattachées à l’unité légale nationale et les montants confidentiels ou partiellement confidentiels ne sont pas reconstruits.",
    "Les mentions de presse dépendent des fournisseurs et des requêtes disponibles ; une absence de résultat ne prouve pas une absence de couverture.",
    "Aucune donnée personnelle non nécessaire, adresse privée ou contact personnel n’est exposé dans ce dossier."
  ];
  if (data.press.cacheStatus === "partial" || data.press.cacheStatus === "error") limits.push("Le snapshot média courant est partiel ou en erreur fournisseur ; consulter la date et le statut de la source avant toute conclusion.");
  if (data.recruitment.status === "unavailable") limits.push("Le flux France Travail n’est pas disponible dans cette configuration ; aucune absence d’offre ne peut être déduite.");
  return {
    version: "1",
    siren: data.siren,
    retrievedAt: data.retrievedAt,
    summary: data.companyProfile.summary,
    description: {
      text: data.companyProfile.summary,
      source: descriptionSourceLabel(data.companyProfile.descriptionSource),
      sourceUrl: descriptionProof?.sourceUrl ?? sourceUrl(data, "Sites publics"),
      evidence: data.companyProfile.descriptionEvidence,
      confidence: data.companyProfile.descriptionConfidence,
      referenceDate: descriptionProof?.referenceDate ?? data.companyProfile.coverage.generatedAt
    },
    highlights,
    sections,
    timeline: data.timeline.slice(0, 40),
    press: data.press.mentions.slice(0, 30),
    governance,
    coverage,
    limits
  };
}
