export type CompanyProfileConfidence = "high" | "medium" | "low";
export type CompanyProfileDescriptionSource = "official_website" | "bodacc" | "structured_public" | "naf_generated";
type ProfileSourceStatus = { source: string; status: "ok" | "empty" | "unavailable"; detail?: string };

export type CompanyProfile = {
  summary: string;
  descriptionSource: CompanyProfileDescriptionSource;
  descriptionConfidence: CompanyProfileConfidence;
  descriptionEvidence: string;
  activity: {
    code: string | null;
    label: string | null;
  };
  services: Array<{
    label: string;
    source: string;
    sourceUrl: string | null;
    confidence: CompanyProfileConfidence;
  }>;
  size: {
    workforceBand: string | null;
    workforceYear: number | string | null;
    companyCategory: string | null;
    establishmentCount: number;
    employerEstablishmentCount: number;
    source: string;
    sourceReferenceDate: string | null;
  };
  signals: Array<{
    label: string;
    detail: string | null;
    source: string;
    sourceUrl: string | null;
    referenceDate: string | null;
    confidence: CompanyProfileConfidence;
  }>;
  proofs: Array<{
    label: string;
    detail: string;
    source: string;
    sourceUrl: string | null;
    referenceDate: string | null;
    confidence: CompanyProfileConfidence;
  }>;
  coverage: {
    observedSources: number;
    evidenceCount: number;
    generatedAt: string;
    sources: Array<{
      source: string;
      status: "ok" | "empty" | "unavailable";
      detail: string | null;
      sourceUrl: string | null;
    }>;
  };
};

type ProfileInput = {
  retrievedAt: string;
  officialProfile: {
    primaryActivityCode: string | null;
    primaryActivityLabel: string | null;
    workforceBand: string | null;
    workforceYear: number | null;
    companyCategory: string | null;
    establishmentCount: number;
    employerEstablishmentCount: number;
    source: string;
    sourceReferenceDate: string | null;
  };
  annuaire: {
    total: number;
    naf25?: string | null;
    workforceBand?: string | null;
    workforceYear?: string | null;
    companyCategory?: string | null;
    labels: string[];
    aidSignals: string[];
    dirigeants?: Array<unknown>;
    dirigeantsSource?: string;
    sourceReferenceDate?: string | null;
    sourceUrl?: string;
  };
  websites: {
    descriptions: Array<{
      text: string;
      source: string | null;
      confidence: number | null;
      url: string | null;
      fetchedAt: string;
    }>;
    offerings: Array<{
      name: string;
      source: string;
      confidence: number;
      url: string | null;
    }>;
    accessibleSitesCount: number;
    generatedAt: string | null;
  };
  osmPresence: {
    services: Array<{ key: string; value: string; sourceUrl: string | null }>;
    categories: string[];
    websites: string[];
    publicEmails?: string[];
    sourceReferenceDate: string | null;
    sourceUrl: string;
  };
  trainingOrganizations: {
    profiles: Array<{
      specialties: Array<{ label: string | null }>;
      sourceUpdatedAt: string;
      resourceUrl: string;
    }>;
  };
  rge: {
    domains: string[];
    qualifications: Array<{ qualificationName: string; sourceUpdatedAt: string | null }>;
    sourceUpdatedAt: string | null;
    sourceUrl: string;
  };
  bodacc: {
    activities: string[];
    total: number;
  };
  patents: {
    total: number;
    technologySections: string[];
    latestApplicationDate: string | null;
    sourceUpdatedAt: string | null;
    sourceUrl: string;
  };
  publicContracts: {
    total: number;
    latestDate: string | null;
    sourceUrl: string | null;
  };
  press: {
    total: number;
    latestPublishedAt: string | null;
  };
  environmentalCompliance: {
    total: number;
    sourceUpdatedAt: string | null;
    sourceUrl: string;
  };
  sourceStatuses?: ProfileSourceStatus[];
};

const sourceUrls: Record<string, string> = {
  SIRENE: "https://www.insee.fr/fr/information/2015441",
  RNA: "https://www.data.gouv.fr/datasets/rna-agrege-a-lechelle-nationale",
  Annuaire: "https://annuaire-entreprises.data.gouv.fr/",
  "Organismes de formation": "https://www.data.gouv.fr/datasets/liste-publique-des-organismes-de-formation-l-6351-7-1-du-code-du-travail",
  "Index égalité": "https://www.data.gouv.fr/datasets/index-egalite-professionnelle-f-h-des-entreprises-de-50-salaries-ou-plus",
  "Conventions & OPCO": "https://www.data.gouv.fr/datasets/liste-des-conventions-collectives-par-entreprise-siret",
  Brevets: "https://www.data.gouv.fr/datasets/deposants-des-brevets-1",
  "Ratios financiers": "https://www.data.gouv.fr/datasets/ratios-financiers-bce-inpi",
  "Bilans détaillés": "https://www.data.gouv.fr/datasets/donnees-financieres-detaillees-des-entreprises-format-parquet",
  "Géorisques ICPE": "https://www.georisques.gouv.fr/donnees/bases-de-donnees/installations-industrielles",
  SCDL: "https://schema.data.gouv.fr/scdl/subventions/",
  "ADEME Aides": "https://data.ademe.fr/datasets/les-aides-financieres-de-l'ademe",
  "Fonds vert": "https://www.data.gouv.fr/datasets/fonds-vert-liste-des-projets-subventionnes",
  "France Relance": "https://www.data.gouv.fr/datasets/plan-de-relance-projets-industriels-liste-geolocalisation-et-description-synthetique-des-projets",
  "ADEME RGE": "https://data.ademe.fr/datasets/historique-rge",
  BODACC: "https://www.bodacc.fr/",
  DECP: "https://data.economie.gouv.fr/explore/dataset/decp_augmente/",
  OSM: "https://www.openstreetmap.org/",
  "Sites publics": "https://www.openstreetmap.org/",
  Presse: "https://news.google.com/"
};

function normalized(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr").replace(/\s+/g, " ").trim();
}

function confidence(value: number | null | undefined): CompanyProfileConfidence {
  if ((value ?? 0) >= 0.8) return "high";
  if ((value ?? 0) >= 0.6) return "medium";
  return "low";
}

function displayActivity(input: ProfileInput) {
  const code = input.officialProfile.primaryActivityCode ?? null;
  const label = input.officialProfile.primaryActivityLabel ?? input.annuaire.naf25 ?? null;
  return { code, label };
}

export function buildCompanyProfile(input: ProfileInput): CompanyProfile {
  const activity = displayActivity(input);
  const firstWebsiteDescription = [...input.websites.descriptions]
    .filter((item) => item.text.trim())
    .sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0))[0];
  const firstBodaccActivity = input.bodacc.activities.find((value) => value.trim());

  let summary: string;
  let descriptionSource: CompanyProfileDescriptionSource;
  let descriptionConfidence: CompanyProfileConfidence;
  let descriptionEvidence: string;
  if (firstWebsiteDescription) {
    summary = firstWebsiteDescription.text;
    descriptionSource = "official_website";
    descriptionConfidence = confidence(firstWebsiteDescription.confidence);
    descriptionEvidence = "Extrait publié sur un site professionnel relié à l’unité légale ou à un établissement.";
  } else if (firstBodaccActivity) {
    summary = firstBodaccActivity;
    descriptionSource = "bodacc";
    descriptionConfidence = "high";
    descriptionEvidence = "Activité décrite dans une annonce commerciale BODACC.";
  } else if (activity.label) {
    summary = `Établissement enregistré dans le secteur « ${activity.label} »${activity.code ? ` (code NAF ${activity.code})` : ""}.`;
    descriptionSource = "naf_generated";
    descriptionConfidence = "medium";
    descriptionEvidence = "Formulation factuelle construite à partir de l’activité principale publiée, sans déduction de services.";
  } else {
    summary = "Activité principale non suffisamment documentée dans les sources publiques consultées.";
    descriptionSource = "structured_public";
    descriptionConfidence = "low";
    descriptionEvidence = "Aucune description exploitable n’a été trouvée dans les sources interrogées.";
  }

  const services: CompanyProfile["services"] = [];
  const serviceKeys = new Set<string>();
  const addService = (label: string | null, source: string, sourceUrl: string | null, level: CompanyProfileConfidence) => {
    const clean = label?.replace(/\s+/g, " ").trim();
    if (!clean || clean.length < 2) return;
    const key = normalized(clean);
    if (serviceKeys.has(key)) return;
    serviceKeys.add(key);
    services.push({ label: clean, source, sourceUrl, confidence: level });
  };
  input.websites.offerings.forEach((item) => addService(item.name, "Site professionnel public", item.url, confidence(item.confidence)));
  input.osmPresence.services.forEach((item) => addService(`${item.key.replaceAll("_", " ")}: ${item.value}`, "OpenStreetMap", item.sourceUrl, "medium"));
  input.trainingOrganizations.profiles.flatMap((profile) => profile.specialties).forEach((item) => addService(item.label, "Liste publique des organismes de formation", null, "high"));
  input.rge.qualifications.forEach((item) => addService(item.qualificationName, "ADEME RGE", input.rge.sourceUrl, "high"));
  input.rge.domains.forEach((item) => addService(item, "ADEME RGE", input.rge.sourceUrl, "high"));

  const signals: CompanyProfile["signals"] = [];
  const addSignal = (label: string, detail: string | null, source: string, sourceUrl: string | null, referenceDate: string | null, level: CompanyProfileConfidence) => {
    signals.push({ label, detail, source, sourceUrl, referenceDate, confidence: level });
  };
  input.annuaire.labels.forEach((label) => addSignal(label, null, "Annuaire des Entreprises", input.annuaire.sourceUrl ?? null, input.annuaire.sourceReferenceDate ?? null, "high"));
  input.annuaire.aidSignals.forEach((label) => addSignal(label, null, "Annuaire des Entreprises", input.annuaire.sourceUrl ?? null, input.annuaire.sourceReferenceDate ?? null, "high"));
  if (input.websites.accessibleSitesCount > 0) addSignal("Site professionnel public identifié", `${input.websites.accessibleSitesCount} site(s) analysé(s)`, "Enrichissement sites publics", firstWebsiteDescription?.url ?? null, input.websites.generatedAt, "medium");
  if (input.osmPresence.websites.length > 0) addSignal("Présence web ou locale OpenStreetMap", `${input.osmPresence.websites.length} URL publiée(s)`, "OpenStreetMap", input.osmPresence.sourceUrl, input.osmPresence.sourceReferenceDate, "medium");
  if (input.osmPresence.publicEmails?.length) addSignal("Email professionnel générique publié", `${input.osmPresence.publicEmails.length} boîte(s) fonctionnelle(s)`, "OpenStreetMap", input.osmPresence.sourceUrl, input.osmPresence.sourceReferenceDate, "medium");
  if (input.trainingOrganizations.profiles.length > 0) addSignal("Organisme de formation déclaré", `${input.trainingOrganizations.profiles.length} profil(s) rattaché(s)`, "Liste publique des organismes de formation", input.trainingOrganizations.profiles[0]?.resourceUrl ?? null, input.trainingOrganizations.profiles[0]?.sourceUpdatedAt ?? null, "high");
  if (input.rge.qualifications.length > 0) addSignal("Qualification RGE publiée", `${input.rge.qualifications.length} qualification(s)`, "ADEME RGE", input.rge.sourceUrl, input.rge.sourceUpdatedAt, "high");
  if (input.patents.total > 0) addSignal("Portefeuille de brevets publié", `${input.patents.total} famille(s)`, "Données brevets", input.patents.sourceUrl, input.patents.sourceUpdatedAt ?? input.patents.latestApplicationDate, "high");
  if (input.publicContracts.total > 0) addSignal("Marchés publics publiés", `${input.publicContracts.total} marché(s)`, "DECP", input.publicContracts.sourceUrl, input.publicContracts.latestDate, "high");
  if (input.bodacc.total > 0) addSignal("Annonces commerciales publiées", `${input.bodacc.total} annonce(s)`, "BODACC", "https://www.bodacc.fr/", null, "high");
  if (input.environmentalCompliance.total > 0) addSignal("Installation ou donnée ICPE publiée", `${input.environmentalCompliance.total} enregistrement(s)`, "Géorisques", input.environmentalCompliance.sourceUrl, input.environmentalCompliance.sourceUpdatedAt, "high");
  if (input.press.total > 0) addSignal("Mentions de presse trouvées", `${input.press.total} résultat(s)`, "Veille média", null, input.press.latestPublishedAt, "low");

  const proofs: CompanyProfile["proofs"] = [
    {
      label: "Identité et établissements",
      detail: `${input.officialProfile.establishmentCount} établissement(s) actifs rattaché(s) par identifiant SIREN/SIRET.`,
      source: input.officialProfile.source,
      sourceUrl: "https://www.insee.fr/fr/information/2015441",
      referenceDate: input.officialProfile.sourceReferenceDate,
      confidence: "high"
    }
  ];
  if (activity.label) proofs.push({ label: "Activité principale", detail: `${activity.label}${activity.code ? ` · ${activity.code}` : ""}`, source: "SIRENE / Annuaire des Entreprises", sourceUrl: input.annuaire.sourceUrl ?? "https://annuaire-entreprises.data.gouv.fr/", referenceDate: input.officialProfile.sourceReferenceDate ?? input.annuaire.sourceReferenceDate ?? null, confidence: "high" });
  if (firstWebsiteDescription) proofs.push({ label: "Description publiée", detail: descriptionEvidence, source: "Site professionnel public", sourceUrl: firstWebsiteDescription.url, referenceDate: firstWebsiteDescription.fetchedAt, confidence: descriptionConfidence });
  if (firstBodaccActivity && !firstWebsiteDescription) proofs.push({ label: "Activité BODACC", detail: firstBodaccActivity, source: "BODACC", sourceUrl: "https://www.bodacc.fr/", referenceDate: null, confidence: "high" });
  if (input.annuaire.dirigeants?.length) proofs.push({ label: "Gouvernance publique", detail: `${input.annuaire.dirigeants.length} mandat(s) public(s) retourné(s) par ${input.annuaire.dirigeantsSource ?? "l’Annuaire des Entreprises"}.`, source: "RNE via Annuaire des Entreprises", sourceUrl: input.annuaire.sourceUrl ?? null, referenceDate: input.annuaire.sourceReferenceDate ?? null, confidence: "high" });

  const inferredStatuses: ProfileSourceStatus[] = [
    { source: "SIRENE", status: input.officialProfile.establishmentCount > 0 ? "ok" : "empty" },
    { source: "Annuaire", status: input.annuaire.total > 0 ? "ok" : "empty" },
    { source: "Sites publics", status: input.websites.accessibleSitesCount > 0 ? "ok" : "empty" },
    { source: "OSM", status: input.osmPresence.categories.length > 0 ? "ok" : "empty" },
    { source: "Organismes de formation", status: input.trainingOrganizations.profiles.length > 0 ? "ok" : "empty" },
    { source: "ADEME RGE", status: input.rge.qualifications.length > 0 ? "ok" : "empty" },
    { source: "BODACC", status: input.bodacc.total > 0 ? "ok" : "empty" },
    { source: "Brevets", status: input.patents.total > 0 ? "ok" : "empty" },
    { source: "DECP", status: input.publicContracts.total > 0 ? "ok" : "empty" },
    { source: "Presse", status: input.press.total > 0 ? "ok" : "empty" },
    { source: "Géorisques ICPE", status: input.environmentalCompliance.total > 0 ? "ok" : "empty" }
  ];
  const coverageSources = (input.sourceStatuses?.length ? input.sourceStatuses : inferredStatuses).map((status) => ({
    source: status.source,
    status: status.status,
    detail: status.detail ?? null,
    sourceUrl: sourceUrls[status.source] ?? null
  }));
  const sourceCount = coverageSources.filter((source) => source.status === "ok").length;

  const legacySourceCount = [
    input.officialProfile.establishmentCount > 0,
    input.annuaire.total > 0,
    input.websites.accessibleSitesCount > 0,
    input.osmPresence.categories.length > 0,
    input.trainingOrganizations.profiles.length > 0,
    input.rge.qualifications.length > 0,
    input.bodacc.total > 0,
    input.patents.total > 0,
    input.publicContracts.total > 0,
    input.press.total > 0,
    input.environmentalCompliance.total > 0
  ].filter(Boolean).length;

  return {
    summary,
    descriptionSource,
    descriptionConfidence,
    descriptionEvidence,
    activity,
    services: services.slice(0, 24),
    size: {
      workforceBand: input.officialProfile.workforceBand ?? input.annuaire.workforceBand ?? null,
      workforceYear: input.officialProfile.workforceYear ?? input.annuaire.workforceYear ?? null,
      companyCategory: input.officialProfile.companyCategory ?? input.annuaire.companyCategory ?? null,
      establishmentCount: input.officialProfile.establishmentCount,
      employerEstablishmentCount: input.officialProfile.employerEstablishmentCount,
      source: input.officialProfile.source,
      sourceReferenceDate: input.officialProfile.sourceReferenceDate ?? input.annuaire.sourceReferenceDate ?? null
    },
    signals: signals.slice(0, 24),
    proofs: proofs.slice(0, 12),
    coverage: {
      observedSources: coverageSources.length ? sourceCount : legacySourceCount,
      evidenceCount: services.length + signals.length + proofs.length,
      generatedAt: input.retrievedAt,
      sources: coverageSources
    }
  };
}
