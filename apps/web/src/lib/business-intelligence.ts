import "server-only";
import { XMLParser } from "fast-xml-parser";
import { getAdemeAidsBySiren, getAdemeAidsMetadata, getAdemeAidSummaryBySiren } from "@/lib/ademe-aids-db";
import {
  getCollectiveAgreementMetadata,
  getCollectiveAgreementsBySiren,
  getCollectiveAgreementSummaryBySiren,
  getOpcoAssignmentsBySiren,
  getOpcoAssignmentSummaryBySiren
} from "@/lib/collective-agreements-db";
import { getEnterpriseCompanyBySiren, getEnterpriseLocationsBySiren } from "@/lib/enterprise-db";
import { getFondsVertMetadata, getFondsVertProjectsBySiren, getFondsVertSummaryBySiren } from "@/lib/fonds-vert-db";
import { getFranceRelanceMetadata, getFranceRelanceProjectsBySiren, getFranceRelanceSummaryBySiren } from "@/lib/france-relance-db";
import {
  getIcpeDocuments,
  getIcpeInstallationsBySiren,
  getIcpeInspections,
  getIcpeMetadata,
  getIcpeRubrics,
  getIcpeSummaryBySiren
} from "@/lib/georisques-icpe-db";
import {
  getDetailedFinancialMetadata,
  getDetailedFinancialStatementsBySiren,
  getDetailedFinancialSummaryBySiren
} from "@/lib/detailed-financial-statements-db";
import {
  getFinancialExercisesBySiren,
  getFinancialMetricDefinitions,
  getFinancialRatiosMetadata,
  getFinancialSummaryBySiren
} from "@/lib/financial-ratios-db";
import { getOsmBusinessMetadata, getOsmBusinessProfilesBySiren } from "@/lib/osm-business-db";
import {
  getPatentFamiliesBySiren,
  getPatentPortfolioMetadata,
  getPatentPortfolioSummaryBySiren,
  getPatentSectionSummaryBySiren,
  getPatentTechnologiesForFamilies
} from "@/lib/patent-portfolios-db";
import { getPublicGrantsBySiren, getPublicGrantsMetadata, getPublicGrantSummaryBySiren } from "@/lib/public-grants-db";
import { getRnaAssociationMetadata, getRnaAssociationsBySiren } from "@/lib/rna-association-db";
import { getTrainingOrganizationsBySiren, getTrainingOrganizationsMetadata, getTrainingOrganizationSummaryBySiren } from "@/lib/training-organizations-db";
import { getProfessionalEqualityBySiren, getProfessionalEqualityMetadata, getProfessionalEqualitySummaryBySiren } from "@/lib/professional-equality-db";
import { getWebsiteEnrichmentMetadata, getWebsiteEnrichmentsBySiren } from "@/lib/website-enrichment-db";
import { getAnnuaireProfileBySiren, getPublicOfficersBySiren, getPublicOfficersMetadata } from "@/lib/public-officers-db";
import { getPressSignalSnapshotBySiren } from "@/lib/press-signals-db";
import { getBodaccEventsBySiren, getBodaccMetadata } from "@/lib/bodacc-db";
import { loadRecruitmentSignals } from "@/lib/france-travail";
import { buildCompanyProfile } from "@/lib/company-profile";
import { getNafLabel } from "@/lib/naf";

const BODACC_API = "https://www.bodacc.fr/api/explore/v2.1/catalog/datasets/annonces-commerciales/records";
const DECP_API = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/decp_augmente/records";
const GDELT_API = "https://api.gdeltproject.org/api/v2/doc/doc";
const GOOGLE_NEWS_RSS = "https://news.google.com/rss/search";
const ANNUAIRE_API = "https://recherche-entreprises.api.gouv.fr/search";
const ANNUAIRE_URL = "https://annuaire-entreprises.data.gouv.fr/entreprise/";
const ADEME_RGE_API = "https://data.ademe.fr/data-fair/api/v1/datasets/historique-rge/lines";

const WORKFORCE_BANDS: Record<string, string> = {
  NN: "Effectif inconnu",
  "00": "0 salarié",
  "01": "1 à 2 salariés",
  "02": "3 à 5 salariés",
  "03": "6 à 9 salariés",
  "11": "10 à 19 salariés",
  "12": "20 à 49 salariés",
  "21": "50 à 99 salariés",
  "22": "100 à 199 salariés",
  "31": "200 à 249 salariés",
  "32": "250 à 499 salariés",
  "41": "500 à 999 salariés",
  "42": "1 000 à 1 999 salariés",
  "51": "2 000 à 4 999 salariés",
  "52": "5 000 à 9 999 salariés",
  "53": "10 000 salariés ou plus"
};

type SourceStatus = { source: string; status: "ok" | "empty" | "unavailable"; detail?: string };

function sireneBoolean(value: string | null) {
  if (value === "O") return true;
  if (value === "N") return false;
  return null;
}

function loadSireneOfficialProfile(siren: string) {
  const company = getEnterpriseCompanyBySiren(siren);
  const establishments = getEnterpriseLocationsBySiren(siren) ?? [];
  if (!company) {
    return {
      total: 0,
      primaryActivityCode: null,
      primaryActivityLabel: null,
      socialEconomy: null,
      missionCompany: null,
      associationId: null,
      companyCategory: null,
      companyCategoryYear: null,
      workforceBandCode: null,
      workforceBand: null,
      workforceYear: null,
      periodStartDate: null,
      lastProcessedAt: null,
      periodCount: null,
      establishmentCount: 0,
      headOfficeCount: 0,
      employerEstablishmentCount: 0,
      datedWorkforceEstablishmentCount: 0,
      sourceReferenceDate: null,
      source: "SIRENE INSEE"
    };
  }
  const headOffice = establishments.find((item) => Boolean(item.is_head_office)) ?? establishments[0];
  return {
    total: 1,
    primaryActivityCode: company.primary_activity ?? headOffice?.naf_code ?? null,
    primaryActivityLabel: getNafLabel(company.primary_activity ?? headOffice?.naf_code) ?? headOffice?.sector ?? null,
    socialEconomy: sireneBoolean(company.social_economy),
    missionCompany: sireneBoolean(company.mission_company),
    associationId: company.association_id,
    companyCategory: company.company_category,
    companyCategoryYear: company.company_category_year,
    workforceBandCode: company.workforce_band,
    workforceBand: company.workforce_band ? WORKFORCE_BANDS[company.workforce_band] ?? company.workforce_band : null,
    workforceYear: company.workforce_year,
    periodStartDate: company.period_start_date,
    lastProcessedAt: company.last_processed_at,
    periodCount: company.period_count,
    establishmentCount: establishments.length,
    headOfficeCount: establishments.filter((item) => Boolean(item.is_head_office)).length,
    employerEstablishmentCount: establishments.filter((item) => item.employer === "O").length,
    datedWorkforceEstablishmentCount: establishments.filter((item) => item.workforce_year !== null).length,
    sourceReferenceDate: company.source_reference_date,
    source: company.source
  };
}

async function loadAssociationIntelligence(siren: string) {
  const rows = getRnaAssociationsBySiren(siren);
  const metadata = getRnaAssociationMetadata();
  if (rows === null && metadata === null) throw new Error("Index RNA indisponible");
  const profiles = (rows ?? []).map((row) => ({
    rnaId: row.rna_id,
    formerId: row.former_id,
    siret: row.siret,
    identifierStatus: row.identifier_status,
    matchConfidence: row.match_confidence,
    publicUtilityId: row.public_utility_id,
    creationDate: row.creation_date,
    declarationDate: row.declaration_date,
    publicationDate: row.publication_date,
    dissolutionDate: row.dissolution_date,
    natureCode: row.nature_code,
    groupType: row.group_type,
    title: row.title,
    shortTitle: row.short_title,
    purpose: row.purpose,
    purposeCodes: [row.purpose_code_1, row.purpose_code_2].filter((value): value is string => Boolean(value && value !== "000000")),
    website: row.website,
    status: row.position_code === "A" && row.dissolution_date ? "conflicting" as const : row.position_code === "A" ? "active" as const : row.position_code === "D" ? "dissolved" as const : "unknown" as const,
    updatedAt: row.updated_at,
    sourceReferenceDate: row.source_reference_date,
    sourceUrl: row.source_url
  }));
  return {
    total: profiles.length,
    activeCount: profiles.filter((item) => item.status === "active").length,
    dissolvedCount: profiles.filter((item) => item.status === "dissolved").length,
    statusConflictCount: profiles.filter((item) => item.status === "conflicting").length,
    purposeCount: profiles.filter((item) => Boolean(item.purpose)).length,
    publicUtilityCount: profiles.filter((item) => Boolean(item.publicUtilityId)).length,
    identifierWarningCount: profiles.filter((item) => item.identifierStatus === "rna_exact_siret_mismatch").length,
    qualityWarningCount: profiles.filter((item) => item.identifierStatus === "rna_exact_siret_mismatch" || item.status === "conflicting").length,
    sourceReferenceDate: metadata?.source_reference_date ?? profiles[0]?.sourceReferenceDate ?? null,
    sourceUrl: metadata?.source_url ?? "https://www.data.gouv.fr/datasets/rna-agrege-a-lechelle-nationale",
    license: metadata?.license ?? "Licence Ouverte 2.0",
    profiles
  };
}

function metadataNumber(metadata: Record<string, string> | null, key: string) {
  const value = Number(metadata?.[key]);
  return Number.isFinite(value) ? value : 0;
}

async function loadPublicGrants(siren: string) {
  const rows = getPublicGrantsBySiren(siren, 100);
  const summary = getPublicGrantSummaryBySiren(siren);
  const metadata = getPublicGrantsMetadata();
  if (rows === null && summary === null && metadata === null) throw new Error("Index SCDL des subventions indisponible");
  const grants = (rows ?? []).map((row) => ({
    id: String(row.id),
    siret: row.siret,
    rnaId: row.rna_id,
    beneficiaryName: row.beneficiary_name,
    awardingAuthority: row.awarding_authority,
    awardingAuthoritySiret: row.awarding_authority_siret,
    conventionDate: row.convention_date,
    decisionReference: row.decision_reference,
    purpose: row.purpose,
    amount: row.amount,
    nature: row.nature,
    paymentConditions: row.payment_conditions,
    paymentPeriod: row.payment_period,
    raeId: row.rae_id,
    euNotification: row.eu_notification === null ? null : Boolean(row.eu_notification),
    subsidyPercentage: row.subsidy_percentage,
    aidScheme: row.aid_scheme,
    matchMethod: row.match_method,
    matchConfidence: row.match_confidence,
    beneficiaryScope: row.match_method.includes("active_siret") ? "active_establishment" as const : row.match_method === "exact_unambiguous_rna" ? "association" as const : "company_historical_establishment" as const,
    sourceReferenceDate: row.source_reference_date,
    sourceLastModified: row.source_last_modified,
    sourceOccurrenceCount: row.occurrence_count,
    datasetTitle: row.dataset_title,
    datasetUrl: row.dataset_url,
    resourceTitle: row.resource_title,
    resourceUrl: row.resource_url,
    license: row.license_name,
    licenseUrl: row.license_url
  }));
  return {
    total: summary?.total ?? grants.length,
    displayedCount: grants.length,
    totalAmount: summary?.total_amount ?? null,
    earliestDate: summary?.earliest_date ?? null,
    latestDate: summary?.latest_date ?? null,
    authorityCount: summary?.authority_count ?? 0,
    sourceCount: summary?.source_count ?? 0,
    activeEstablishmentCount: summary?.active_siret_count ?? 0,
    historicalEstablishmentCount: summary?.company_siret_count ?? 0,
    associationMatchCount: summary?.rna_count ?? 0,
    truncated: (summary?.total ?? grants.length) > grants.length,
    catalogDatasetCount: metadataNumber(metadata, "catalog_dataset_count"),
    openDatasetCount: metadataNumber(metadata, "open_dataset_count"),
    importedResourceCount: metadataNumber(metadata, "open_csv_resource_count"),
    sourceReferenceDate: grants.map((grant) => grant.sourceReferenceDate).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null,
    importedAt: metadata?.imported_at ?? null,
    schemaUrl: metadata?.schema_url ?? "https://schema.data.gouv.fr/scdl/subventions/",
    catalogUrl: "https://www.data.gouv.fr/datasets/?schema=scdl%2Fsubventions",
    grants
  };
}

async function loadAdemeFinancialAids(siren: string) {
  const rows = getAdemeAidsBySiren(siren, 100);
  const summary = getAdemeAidSummaryBySiren(siren);
  const metadata = getAdemeAidsMetadata();
  if (rows === null && summary === null && metadata === null) throw new Error("Index des aides financières ADEME indisponible");
  const aids = (rows ?? []).map((row) => ({
    id: String(row.id),
    siret: row.siret,
    scope: row.match_scope,
    matchConfidence: row.match_confidence,
    awardingAuthority: row.awarding_authority,
    awardingAuthoritySiret: row.awarding_authority_siret,
    conventionDate: row.convention_date,
    decisionReference: row.decision_reference,
    beneficiaryName: row.beneficiary_name,
    purpose: row.purpose,
    aidScheme: row.aid_scheme,
    amount: row.amount,
    nature: row.nature,
    paymentConditions: row.payment_conditions,
    paymentPeriod: row.payment_period,
    raeId: row.rae_id,
    euNotification: row.eu_notification === null ? null : Boolean(row.eu_notification),
    sourceUpdatedAt: row.source_updated_at,
    sourceUrl: row.source_url,
    dataGouvUrl: row.data_gouv_url,
    license: row.license_name,
    licenseUrl: row.license_url
  }));
  return {
    total: summary?.total ?? aids.length,
    displayedCount: aids.length,
    totalAmount: summary?.total_amount ?? null,
    activeLocalCount: summary?.active_local_count ?? 0,
    activeLocalAmount: summary?.active_local_amount ?? null,
    companyScopeCount: summary?.company_scope_count ?? 0,
    companyScopeAmount: summary?.company_scope_amount ?? null,
    schemeCount: summary?.scheme_count ?? 0,
    earliestDate: summary?.earliest_date ?? null,
    latestDate: summary?.latest_date ?? null,
    truncated: (summary?.total ?? aids.length) > aids.length,
    sourceRowCount: metadataNumber(metadata, "source_row_count"),
    sourceUpdatedAt: metadata?.source_updated_at ?? aids[0]?.sourceUpdatedAt ?? null,
    sourceUrl: metadata?.source_url ?? "https://data.ademe.fr/datasets/les-aides-financieres-de-l'ademe",
    dataGouvUrl: metadata?.data_gouv_url ?? "https://www.data.gouv.fr/datasets/les-aides-financieres-de-lademe-1",
    license: metadata?.license ?? aids[0]?.license ?? "Licence Ouverte 2.0",
    aids
  };
}

async function loadFondsVertProjects(siren: string) {
  const rows = getFondsVertProjectsBySiren(siren, 100);
  const summary = getFondsVertSummaryBySiren(siren);
  const metadata = getFondsVertMetadata();
  if (rows === null && summary === null && metadata === null) throw new Error("Index des projets Fonds vert indisponible");
  const projects = (rows ?? []).map((row) => ({
    id: String(row.id),
    year: row.year,
    siren: row.siren,
    siret: row.siret,
    beneficiaryIdentifier: row.beneficiary_identifier,
    identifierType: row.identifier_type,
    matchScope: row.match_scope,
    matchConfidence: row.match_confidence,
    projectLocationScope: row.project_location_scope,
    projectName: row.project_name,
    projectSummary: row.project_summary,
    committedAmount: row.committed_amount,
    beneficiaryName: row.beneficiary_name,
    beneficiaryLegalForm: row.beneficiary_legal_form,
    dossierNumber: row.dossier_number,
    commitmentNumber: row.commitment_number,
    operatorNumber: row.operator_number,
    operator: row.operator,
    scheme: row.scheme,
    axis: row.axis,
    region: row.region,
    department: row.department,
    departmentCode: row.department_code,
    commune: row.commune,
    communeCode: row.commune_code,
    resourceTitle: row.resource_title,
    resourceUrl: row.resource_url,
    resourceLastModified: row.resource_last_modified,
    sourceUpdatedAt: row.source_updated_at,
    datasetUrl: row.dataset_url,
    license: row.license_name,
    licenseUrl: row.license_url
  }));
  return {
    total: summary?.total ?? projects.length,
    displayedCount: projects.length,
    totalAmount: summary?.total_amount ?? null,
    guadeloupeCount: summary?.guadeloupe_count ?? 0,
    guadeloupeAmount: summary?.guadeloupe_amount ?? null,
    outsideCount: summary?.outside_count ?? 0,
    outsideAmount: summary?.outside_amount ?? null,
    unknownLocationCount: summary?.unknown_count ?? 0,
    activeLocalCount: summary?.active_local_count ?? 0,
    activeLocalAmount: summary?.active_local_amount ?? null,
    schemeCount: summary?.scheme_count ?? 0,
    earliestYear: summary?.earliest_year ?? null,
    latestYear: summary?.latest_year ?? null,
    truncated: (summary?.total ?? projects.length) > projects.length,
    sourceRowCount: metadataNumber(metadata, "source_rows"),
    resourceCount: metadataNumber(metadata, "imported_resource_count"),
    excludedResourceCount: metadataNumber(metadata, "excluded_csv_resource_count"),
    sourceUpdatedAt: metadata?.source_updated_at ?? projects[0]?.sourceUpdatedAt ?? null,
    sourceUrl: metadata?.source_url ?? "https://www.data.gouv.fr/datasets/fonds-vert-liste-des-projets-subventionnes",
    license: metadata?.license ?? projects[0]?.license ?? "Licence Ouverte 2.0",
    projects
  };
}

async function loadFranceRelanceProjects(siren: string) {
  const rows = getFranceRelanceProjectsBySiren(siren, 100);
  const summary = getFranceRelanceSummaryBySiren(siren);
  const metadata = getFranceRelanceMetadata();
  if (rows === null && summary === null && metadata === null) throw new Error("Index des projets industriels France Relance indisponible");
  const projects = (rows ?? []).map((row) => ({
    id: String(row.id),
    siren: row.siren,
    siret: row.siret,
    beneficiaryIdentifier: row.beneficiary_identifier,
    identifierType: row.identifier_type,
    matchScope: row.match_scope,
    matchConfidence: row.match_confidence,
    projectLocationScope: row.project_location_scope,
    beneficiaryName: row.beneficiary_name,
    companyType: row.company_type,
    recoveryAxis: row.recovery_axis,
    measure: row.measure,
    measureLabel: row.measure_label,
    projectDescription: row.project_description,
    sector: row.sector,
    expectedCo2Tonnes: row.expected_co2_tonnes,
    updateDate: row.update_date,
    region: row.region,
    department: row.department,
    departmentCode: row.department_code,
    commune: row.commune,
    postalCode: row.postal_code,
    latitude: row.latitude,
    longitude: row.longitude,
    resourceTitle: row.resource_title,
    resourceUrl: row.resource_url,
    resourceLastModified: row.resource_last_modified,
    sourceUpdatedAt: row.source_updated_at,
    datasetUrl: row.dataset_url,
    portalUrl: row.portal_url,
    license: row.license_name,
    licenseUrl: row.license_url
  }));
  return {
    total: summary?.total ?? projects.length,
    displayedCount: projects.length,
    guadeloupeCount: summary?.guadeloupe_count ?? 0,
    outsideCount: summary?.outside_count ?? 0,
    unknownLocationCount: summary?.unknown_count ?? 0,
    activeLocalCount: summary?.active_local_count ?? 0,
    descriptionCount: summary?.description_count ?? 0,
    co2MetricCount: summary?.co2_metric_count ?? 0,
    measureCount: summary?.measure_count ?? 0,
    sectorCount: summary?.sector_count ?? 0,
    earliestDate: summary?.earliest_date ?? null,
    latestDate: summary?.latest_date ?? null,
    truncated: (summary?.total ?? projects.length) > projects.length,
    sourceRowCount: metadataNumber(metadata, "source_rows"),
    sourceUpdatedAt: metadata?.source_updated_at ?? projects[0]?.sourceUpdatedAt ?? null,
    sourceUrl: metadata?.source_url ?? "https://www.data.gouv.fr/datasets/plan-de-relance-projets-industriels-liste-geolocalisation-et-description-synthetique-des-projets",
    portalUrl: metadata?.portal_url ?? "https://data.economie.gouv.fr/explore/dataset/plan-de-relance/",
    license: metadata?.license ?? projects[0]?.license ?? "Licence Ouverte 2.0",
    individualAmountsAvailable: metadata?.individual_amounts_available === "true",
    projects
  };
}

async function loadTrainingOrganizations(siren: string) {
  const rows = getTrainingOrganizationsBySiren(siren, 50);
  const summary = getTrainingOrganizationSummaryBySiren(siren);
  const metadata = getTrainingOrganizationsMetadata();
  if (rows === null && summary === null && metadata === null) throw new Error("Index de la Liste publique des organismes de formation indisponible");
  const profiles = (rows ?? []).map((row) => ({
    id: String(row.id),
    siren: row.siren,
    siret: row.siret,
    matchScope: row.match_scope,
    matchConfidence: row.match_confidence,
    registrationLocationScope: row.registration_location_scope,
    activityDeclarationNumber: row.activity_declaration_number,
    previousActivityNumbers: row.previous_activity_numbers,
    postalCode: row.postal_code,
    city: row.city,
    regionCode: row.region_code,
    isQualityCertified: Boolean(row.is_quality_certified),
    qualityCategories: [
      row.quality_training === 1 ? "Actions de formation" : null,
      row.quality_skills_assessment === 1 ? "Bilans de compétences" : null,
      row.quality_vae === 1 ? "Validation des acquis de l’expérience" : null,
      row.quality_apprenticeship === 1 ? "Actions de formation par apprentissage" : null
    ].filter((value): value is string => Boolean(value)),
    lastDeclarationDate: row.last_declaration_date,
    exerciseStartDate: row.exercise_start_date,
    exerciseEndDate: row.exercise_end_date,
    specialties: [
      { code: row.specialty_code_1, label: row.specialty_label_1 },
      { code: row.specialty_code_2, label: row.specialty_label_2 },
      { code: row.specialty_code_3, label: row.specialty_label_3 }
    ].filter((item): item is { code: string | null; label: string | null } => Boolean(item.code || item.label)),
    traineeCount: row.trainee_count,
    entrustedTraineeCount: row.entrusted_trainee_count,
    trainerCount: row.trainer_count,
    resourceTitle: row.resource_title,
    resourceUrl: row.resource_url,
    resourceLastModified: row.resource_last_modified,
    sourceUpdatedAt: row.source_updated_at,
    datasetUrl: row.dataset_url,
    license: row.license_name,
    licenseUrl: row.license_url
  }));
  return {
    total: summary?.total ?? profiles.length,
    displayedCount: profiles.length,
    guadeloupeCount: summary?.guadeloupe_count ?? 0,
    outsideCount: summary?.outside_count ?? 0,
    activeLocalCount: summary?.active_local_count ?? 0,
    qualityCount: summary?.quality_count ?? 0,
    specialtyCount: summary?.specialty_count ?? 0,
    metricsCount: summary?.metrics_count ?? 0,
    qualityTrainingCount: summary?.training_quality_count ?? 0,
    qualitySkillsCount: summary?.skills_quality_count ?? 0,
    qualityVaeCount: summary?.vae_quality_count ?? 0,
    qualityApprenticeshipCount: summary?.apprenticeship_quality_count ?? 0,
    earliestDeclarationDate: summary?.earliest_declaration ?? null,
    latestDeclarationDate: summary?.latest_declaration ?? null,
    latestExerciseEndDate: summary?.latest_exercise_end ?? null,
    truncated: (summary?.total ?? profiles.length) > profiles.length,
    sourceRowCount: metadataNumber(metadata, "source_rows"),
    matchedCompanyCount: metadataNumber(metadata, "matched_companies"),
    sourceUpdatedAt: metadata?.source_updated_at ?? profiles[0]?.sourceUpdatedAt ?? null,
    sourceUrl: metadata?.source_url ?? "https://www.data.gouv.fr/datasets/liste-publique-des-organismes-de-formation-l-6351-7-1-du-code-du-travail",
    license: metadata?.license ?? profiles[0]?.license ?? "Licence Ouverte",
    profiles
  };
}

async function loadProfessionalEquality(siren: string) {
  const rows = getProfessionalEqualityBySiren(siren, 20);
  const summary = getProfessionalEqualitySummaryBySiren(siren);
  const metadata = getProfessionalEqualityMetadata();
  if (rows === null && summary === null && metadata === null) throw new Error("Index Egapro local indisponible");
  const declarations = (rows ?? []).map((row) => ({
    id: String(row.id),
    siren: row.siren,
    declaringSiren: row.declaring_siren,
    matchScope: row.match_scope,
    matchConfidence: row.match_confidence,
    referenceYear: row.reference_year,
    structureType: row.structure_type,
    workforceBand: row.workforce_band,
    uesName: row.ues_name,
    uesMemberCount: row.ues_member_count,
    declarationLocationScope: row.declaration_location_scope,
    declaringRegion: row.declaring_region,
    declaringDepartment: row.declaring_department,
    declaringCountry: row.declaring_country,
    nafCode: row.naf_code,
    nafLabel: row.naf_label,
    indexScore: row.index_score,
    indexStatus: row.index_status,
    indicators: [
      { key: "payGap", label: "Écart de rémunération", score: row.pay_gap_score, maximum: 40, status: row.pay_gap_status },
      { key: "raiseGapNoPromotion", label: "Écart d’augmentations hors promotion", score: row.raise_gap_no_promotion_score, maximum: 20, status: row.raise_gap_no_promotion_status },
      { key: "promotionGap", label: "Écart de promotions", score: row.promotion_gap_score, maximum: 15, status: row.promotion_gap_status },
      { key: "raiseGap", label: "Écart de taux d’augmentation", score: row.raise_gap_score, maximum: 35, status: row.raise_gap_status },
      { key: "maternityReturn", label: "Retour de congé maternité", score: row.maternity_return_score, maximum: 15, status: row.maternity_return_status },
      { key: "highestRemuneration", label: "Dix plus hautes rémunérations", score: row.highest_remuneration_score, maximum: 10, status: row.highest_remuneration_status }
    ].filter((indicator) => indicator.status !== "not_applicable"),
    resourceTitle: row.resource_title,
    resourceUrl: row.resource_url,
    resourceLastModified: row.resource_last_modified,
    sourceUpdatedAt: row.source_updated_at,
    datasetUrl: row.dataset_url,
    egaproUrl: row.egapro_url,
    license: row.license_name,
    licenseUrl: row.license_url
  }));
  const calculable = declarations.filter((item) => item.indexStatus === "calculated" && item.indexScore !== null);
  const latestCalculable = calculable[0] ?? null;
  const previousCalculable = calculable.find((item) => item.referenceYear < (latestCalculable?.referenceYear ?? 0)) ?? null;
  return {
    total: summary?.total ?? declarations.length,
    displayedCount: declarations.length,
    calculableCount: summary?.calculable_count ?? calculable.length,
    nonCalculableCount: summary?.non_calculable_count ?? declarations.filter((item) => item.indexStatus === "not_calculable").length,
    directCount: summary?.direct_count ?? declarations.filter((item) => item.matchScope === "exact_declarant").length,
    uesCount: summary?.ues_count ?? declarations.filter((item) => item.matchScope === "ues_member").length,
    guadeloupeCount: summary?.guadeloupe_count ?? declarations.filter((item) => item.declarationLocationScope === "guadeloupe").length,
    earliestYear: summary?.earliest_year ?? declarations.at(-1)?.referenceYear ?? null,
    latestYear: summary?.latest_year ?? declarations[0]?.referenceYear ?? null,
    latestCalculableYear: summary?.latest_calculable_year ?? latestCalculable?.referenceYear ?? null,
    latestScore: latestCalculable?.indexScore ?? null,
    scoreDelta: latestCalculable && previousCalculable && latestCalculable.indexScore !== null && previousCalculable.indexScore !== null
      ? latestCalculable.indexScore - previousCalculable.indexScore
      : null,
    sourceRowCount: metadataNumber(metadata, "source_rows"),
    matchedCompanyCount: metadataNumber(metadata, "matched_companies"),
    sourceUpdatedAt: metadata?.source_updated_at ?? declarations[0]?.sourceUpdatedAt ?? null,
    sourceUrl: metadata?.source_url ?? "https://www.data.gouv.fr/datasets/index-egalite-professionnelle-f-h-des-entreprises-de-50-salaries-ou-plus",
    egaproUrl: metadata?.egapro_url ?? "https://egapro.travail.gouv.fr/consulter-index",
    license: metadata?.license ?? declarations[0]?.license ?? "Licence Ouverte 2.0",
    declarations
  };
}

const IDCC_STATUS_LABELS: Record<string, string> = {
  "5100": "Statut divers ou non précisé",
  "5501": "Convention d’entreprise ou texte assimilé non précisé",
  "9998": "Convention collective non connue",
  "9999": "Sans convention collective déclarée"
};

async function loadCollectiveAgreements(siren: string) {
  const agreementRows = getCollectiveAgreementsBySiren(siren, 100);
  const agreementSummary = getCollectiveAgreementSummaryBySiren(siren);
  const opcoRows = getOpcoAssignmentsBySiren(siren, 100);
  const opcoSummary = getOpcoAssignmentSummaryBySiren(siren);
  const metadata = getCollectiveAgreementMetadata();
  if (agreementRows === null && agreementSummary === null && opcoRows === null && opcoSummary === null && metadata === null) {
    throw new Error("Index local des conventions collectives et OPCO indisponible");
  }

  const agreements = (agreementRows ?? []).map((row) => ({
    id: String(row.id),
    siret: row.siret,
    commune: row.commune,
    isHeadOffice: Boolean(row.is_head_office),
    employer: row.employer === null ? null : Boolean(row.employer),
    idcc: row.idcc,
    status: row.idcc_status,
    label: row.title ?? IDCC_STATUS_LABELS[row.idcc] ?? `IDCC ${row.idcc}`,
    title: row.title,
    shortTitle: row.short_title,
    kaliId: row.kali_id,
    baseTextStatus: row.base_text_status,
    legifranceUrl: row.legifrance_url,
    referenceMonth: row.reference_month,
    sourceUpdateDate: row.source_update_date,
    sourceUpdatedAt: row.source_updated_at,
    sourceUrl: row.dataset_url,
    resourceUrl: row.resource_url,
    license: row.license_name,
    licenseUrl: row.license_url
  }));
  const assignments = (opcoRows ?? []).map((row) => ({
    id: String(row.id),
    siret: row.siret,
    commune: row.commune,
    isHeadOffice: Boolean(row.is_head_office),
    employer: row.employer === null ? null : Boolean(row.employer),
    idcc: row.idcc,
    idccStatus: row.idcc_status,
    idccLabel: row.title ?? (row.idcc ? IDCC_STATUS_LABELS[row.idcc] ?? `IDCC ${row.idcc}` : null),
    ownerOpco: row.owner_opco,
    managingOpco: row.managing_opco,
    effectiveOpco: row.managing_opco ?? row.owner_opco,
    status: row.assignment_status,
    referenceMonth: row.reference_month,
    sourceUpdatedAt: row.source_updated_at,
    sourceUrl: row.dataset_url,
    resourceUrl: row.resource_url,
    license: row.license_name,
    licenseUrl: row.license_url
  }));

  const siretSet = new Set([...agreements.map((row) => row.siret), ...assignments.map((row) => row.siret)]);
  const establishments = [...siretSet].map((siret) => {
    const establishmentAgreements = agreements.filter((row) => row.siret === siret);
    const opco = assignments.find((row) => row.siret === siret) ?? null;
    const context = establishmentAgreements[0] ?? opco;
    const idccDifference = Boolean(
      opco?.idcc
      && establishmentAgreements.length > 0
      && !establishmentAgreements.some((agreement) => agreement.idcc === opco.idcc)
    );
    return {
      siret,
      commune: context?.commune ?? null,
      isHeadOffice: context?.isHeadOffice ?? false,
      employer: context?.employer ?? null,
      idccDifference,
      agreements: establishmentAgreements,
      opco
    };
  }).sort((left, right) => Number(right.isHeadOffice) - Number(left.isHeadOffice) || left.siret.localeCompare(right.siret));

  return {
    total: establishments.length,
    displayedCount: establishments.length,
    agreementCount: agreementSummary?.total ?? agreements.length,
    agreementEstablishmentCount: agreementSummary?.establishment_count ?? new Set(agreements.map((row) => row.siret)).size,
    substantiveAgreementCount: agreementSummary?.substantive_count ?? agreements.filter((row) => row.status === "declared_code").length,
    escapeAgreementCount: agreementSummary?.escape_count ?? agreements.filter((row) => row.status !== "declared_code").length,
    distinctIdccCount: agreementSummary?.distinct_idcc_count ?? new Set(agreements.map((row) => row.idcc)).size,
    multiIdccEstablishmentCount: agreementSummary?.multi_idcc_establishment_count ?? 0,
    titledAgreementCount: agreementSummary?.titled_count ?? agreements.filter((row) => Boolean(row.title)).length,
    opcoAssignmentCount: opcoSummary?.total ?? assignments.length,
    assignedOpcoCount: opcoSummary?.assigned_count ?? assignments.filter((row) => row.status === "assigned").length,
    opcoAnomalyCount: opcoSummary?.anomaly_count ?? assignments.filter((row) => row.status !== "assigned").length,
    effectiveOpcoCount: opcoSummary?.effective_opco_count ?? new Set(assignments.map((row) => row.effectiveOpco).filter(Boolean)).size,
    effectiveOpcos: [...new Set(assignments.map((row) => row.effectiveOpco).filter((value): value is string => Boolean(value)))].sort(),
    crossSourceDifferenceCount: establishments.filter((row) => row.idccDifference).length,
    idccReferenceMonth: agreementSummary?.latest_reference_month ?? agreements[0]?.referenceMonth ?? null,
    siroReferenceMonth: opcoSummary?.latest_reference_month ?? assignments[0]?.referenceMonth ?? null,
    sourceRowCount: metadataNumber(metadata, "idcc_source_rows") + metadataNumber(metadata, "siro_source_rows"),
    matchedCompanyCount: metadataNumber(metadata, "covered_company_count"),
    sourceUpdatedAt: metadata?.idcc_source_updated_at ?? agreements[0]?.sourceUpdatedAt ?? null,
    siroSourceUpdatedAt: metadata?.siro_source_updated_at ?? assignments[0]?.sourceUpdatedAt ?? null,
    idccSourceUrl: metadata?.idcc_source_url ?? "https://www.data.gouv.fr/datasets/liste-des-conventions-collectives-par-entreprise-siret",
    siroSourceUrl: metadata?.siro_source_url ?? "https://www.data.gouv.fr/datasets/table-siret-opco",
    kaliSourceUrl: metadata?.kali_source_url ?? "https://github.com/SocialGouv/kali-data",
    kaliVersion: metadata?.kali_version ?? null,
    license: "Licence Ouverte 2.0",
    establishments
  };
}

const PATENT_SECTION_LABELS: Record<string, string> = {
  A: "Nécessités courantes de la vie",
  B: "Techniques industrielles et transports",
  C: "Chimie et métallurgie",
  D: "Textiles et papier",
  E: "Constructions fixes",
  F: "Mécanique, éclairage et chauffage",
  G: "Physique",
  H: "Électricité",
  Y: "Développements technologiques transversaux"
};

async function loadPatentPortfolio(siren: string) {
  const rows = getPatentFamiliesBySiren(siren, 20);
  const summary = getPatentPortfolioSummaryBySiren(siren);
  const sectionRows = getPatentSectionSummaryBySiren(siren);
  const metadata = getPatentPortfolioMetadata();
  if (rows === null && summary === null && sectionRows === null && metadata === null) {
    throw new Error("Index local des portefeuilles de brevets indisponible");
  }
  const familyIds = (rows ?? []).map((row) => row.family_docdb);
  const technologyRows = getPatentTechnologiesForFamilies(siren, familyIds, 300) ?? [];
  const families = (rows ?? []).map((row) => {
    const technologies = technologyRows.filter((technology) => technology.family_docdb === row.family_docdb);
    return {
      id: String(row.id),
      familyDocdb: row.family_docdb,
      familyInpadoc: row.family_inpadoc,
      applicantNames: arrayValue(row.applicant_names_json).filter((value): value is string => typeof value === "string"),
      applicationCount: row.application_count,
      firstPublicationDate: row.first_publication_date,
      firstApplicationDate: row.first_application_date,
      epoApplication: row.epo_application === null ? null : Boolean(row.epo_application),
      internationalApplication: row.international_application === null ? null : Boolean(row.international_application),
      granted: row.granted === null ? null : Boolean(row.granted),
      firstGrantDate: row.first_grant_date,
      title: row.display_title ?? `Famille de brevets ${row.family_docdb}`,
      abstract: row.display_abstract,
      technologyCount: row.technology_count,
      sections: technologies.filter((item) => item.level === "section").map((item) => ({
        code: item.code,
        label: PATENT_SECTION_LABELS[item.code] ?? item.label ?? item.code
      })),
      classes: technologies.filter((item) => item.level === "classe").map((item) => ({ code: item.code, label: item.label })),
      subclasses: technologies.filter((item) => item.level === "sous-classe").map((item) => ({ code: item.code, label: item.label })),
      scanrUrl: row.scanr_url,
      scope: row.scope,
      sourceUpdatedAt: row.source_updated_at,
      datasetUrl: row.dataset_url,
      license: row.license_name,
      licenseUrl: row.license_url
    };
  });
  return {
    total: summary?.total ?? families.length,
    displayedCount: families.length,
    applicationCount: summary?.application_count ?? families.reduce((sum, item) => sum + item.applicationCount, 0),
    grantedCount: summary?.granted_count ?? families.filter((item) => item.granted).length,
    internationalCount: summary?.international_count ?? families.filter((item) => item.internationalApplication).length,
    epoCount: summary?.epo_count ?? families.filter((item) => item.epoApplication).length,
    titleCount: summary?.title_count ?? families.filter((item) => Boolean(item.title)).length,
    abstractCount: summary?.abstract_count ?? families.filter((item) => Boolean(item.abstract)).length,
    earliestApplicationDate: summary?.earliest_application_date ?? null,
    latestApplicationDate: summary?.latest_application_date ?? null,
    applicationAuthorityCount: summary?.application_authority_count ?? 0,
    technologyCount: summary?.technology_count ?? 0,
    technologySectionCount: summary?.technology_section_count ?? 0,
    sections: (sectionRows ?? []).map((row) => ({
      code: row.code,
      label: PATENT_SECTION_LABELS[row.code] ?? row.label ?? row.code,
      familyCount: row.family_count
    })),
    truncated: (summary?.total ?? families.length) > families.length,
    sourceApplicantRows: metadataNumber(metadata, "source_applicant_rows"),
    matchedCompanyCount: metadataNumber(metadata, "company_count"),
    indexedFamilyCount: metadataNumber(metadata, "family_count"),
    indexedApplicationCount: metadataNumber(metadata, "application_count"),
    applicantsSourceUpdatedAt: metadata?.applicants_source_updated_at ?? null,
    familiesSourceUpdatedAt: metadata?.families_source_updated_at ?? families[0]?.sourceUpdatedAt ?? null,
    technologiesSourceUpdatedAt: metadata?.technologies_source_updated_at ?? null,
    applicantsSourceUrl: metadata?.applicants_source_url ?? "https://www.data.gouv.fr/datasets/deposants-des-brevets-1",
    familiesSourceUrl: metadata?.families_source_url ?? "https://www.data.gouv.fr/datasets/familles-de-brevets",
    technologiesSourceUrl: metadata?.technologies_source_url ?? "https://www.data.gouv.fr/datasets/technologies-des-familles-de-brevets",
    license: "Licence Ouverte 2.0",
    scope: "national_legal_unit" as const,
    families
  };
}

async function loadFinancialRatios(siren: string) {
  const rows = getFinancialExercisesBySiren(siren, 60);
  const summary = getFinancialSummaryBySiren(siren);
  const definitionRows = getFinancialMetricDefinitions();
  const metadata = getFinancialRatiosMetadata();
  if (rows === null && summary === null && definitionRows === null && metadata === null) {
    throw new Error("Index local des ratios financiers indisponible");
  }
  const exercises = (rows ?? []).map((row) => {
    const amountsAreDisclosed = !Boolean(row.is_partially_confidential);
    return {
      id: String(row.id),
      closingDate: row.closing_date,
      statementType: row.statement_type,
      confidentiality: row.confidentiality,
      partiallyConfidential: Boolean(row.is_partially_confidential),
      dateQuality: row.date_quality,
      metricCount: row.metric_count,
      revenue: amountsAreDisclosed ? row.chiffre_d_affaires : null,
      grossMargin: amountsAreDisclosed ? row.marge_brute : null,
      ebe: amountsAreDisclosed ? row.ebe : null,
      ebit: amountsAreDisclosed ? row.ebit : null,
      netIncome: row.resultat_net,
      debtRatio: row.taux_d_endettement,
      liquidityRatio: row.ratio_de_liquidite,
      assetAgeRatio: row.ratio_de_vetuste,
      financialAutonomy: row.autonomie_financiere,
      operatingWorkingCapitalRatio: row.poids_bfr_exploitation_sur_ca,
      interestCoverage: row.couverture_des_interets,
      cashFlowToRevenue: row.caf_sur_ca,
      repaymentCapacity: row.capacite_de_remboursement,
      ebeMargin: row.marge_ebe,
      currentPreTaxToRevenue: row.resultat_courant_avant_impots_sur_ca,
      operatingWorkingCapitalDays: row.poids_bfr_exploitation_sur_ca_jours,
      stockRotationDays: row.rotation_des_stocks_jours,
      customerCreditDays: row.credit_clients_jours,
      supplierCreditDays: row.credit_fournisseurs_jours,
      sourceUpdatedAt: row.source_updated_at,
      datasetUrl: row.dataset_url,
      license: row.license_name,
      licenseUrl: row.license_url
    };
  });
  return {
    total: summary?.total ?? exercises.length,
    publicCount: summary?.public_count ?? exercises.filter((item) => !item.partiallyConfidential).length,
    partiallyConfidentialCount: summary?.partially_confidential_count ?? exercises.filter((item) => item.partiallyConfidential).length,
    completeCount: summary?.complete_count ?? exercises.filter((item) => item.statementType === "C").length,
    simplifiedCount: summary?.simplified_count ?? exercises.filter((item) => item.statementType === "S").length,
    consolidatedCount: summary?.consolidated_count ?? exercises.filter((item) => item.statementType === "K").length,
    earliestClosingDate: summary?.earliest_closing_date ?? null,
    latestClosingDate: summary?.latest_closing_date ?? null,
    matchedCompanyCount: metadataNumber(metadata, "company_count"),
    indexedExerciseCount: metadataNumber(metadata, "exercise_count"),
    sourceRowCount: metadataNumber(metadata, "source_row_count"),
    sourceUpdatedAt: metadata?.source_updated_at ?? exercises[0]?.sourceUpdatedAt ?? null,
    sourceUrl: metadata?.dataset_url ?? "https://www.data.gouv.fr/datasets/ratios-financiers-bce-inpi",
    license: "Licence Ouverte 2.0",
    scope: "national_legal_unit" as const,
    definitions: (definitionRows ?? []).map((row) => ({
      field: row.field_name,
      label: row.label,
      unit: row.unit,
      description: row.description,
      formulaCompleteOrConsolidated: row.formula_ck,
      formulaSimplified: row.formula_s
    })),
    exercises
  };
}

async function loadDetailedFinancialStatements(siren: string) {
  const rows = getDetailedFinancialStatementsBySiren(siren, 60);
  const summary = getDetailedFinancialSummaryBySiren(siren);
  const metadata = getDetailedFinancialMetadata();
  if (rows === null && summary === null && metadata === null) {
    throw new Error("Index local des bilans détaillés indisponible");
  }
  const statements = (rows ?? []).map((row) => {
    const incomeStatementIsDisclosed = !Boolean(row.is_partially_confidential);
    return {
      id: String(row.id),
      closingDate: row.closing_date,
      statementType: row.statement_type,
      confidentiality: row.confidentiality,
      partiallyConfidential: Boolean(row.is_partially_confidential),
      dateQuality: row.date_quality,
      cellCount: row.cell_count,
      metricCount: row.derived_metric_count,
      balanceSheetTotal: row.balance_sheet_total,
      equity: row.equity,
      provisions: row.provisions,
      financialDebt: row.financial_debt,
      totalDebt: row.total_debt,
      fixedAssetsGross: row.fixed_assets_gross,
      fixedAssetsNet: row.fixed_assets_net,
      currentAssetsGross: row.current_assets_gross,
      currentAssetsNet: row.current_assets_net,
      inventoryGross: row.inventory_gross,
      inventoryNet: row.inventory_net,
      tradeReceivablesGross: row.trade_receivables_gross,
      tradeReceivablesNet: row.trade_receivables_net,
      cashAndSecuritiesNet: row.cash_and_securities_net,
      tradePayables: row.trade_payables,
      taxSocialDebt: row.tax_social_debt,
      capital: row.capital,
      revenue: incomeStatementIsDisclosed ? row.revenue : null,
      operatingResult: incomeStatementIsDisclosed ? row.operating_result : null,
      currentPreTaxResult: incomeStatementIsDisclosed ? row.current_pre_tax_result : null,
      netIncome: incomeStatementIsDisclosed ? row.net_income : null,
      personnelCosts: incomeStatementIsDisclosed ? row.personnel_costs : null,
      externalPurchases: incomeStatementIsDisclosed ? row.external_purchases : null,
      taxes: incomeStatementIsDisclosed ? row.taxes : null,
      sourceUpdatedAt: row.source_updated_at,
      datasetUrl: row.dataset_url,
      resourceUrl: row.resource_url,
      license: row.license_name,
      licenseUrl: row.license_url
    };
  });
  return {
    total: summary?.total ?? statements.length,
    partiallyConfidentialCount: summary?.partially_confidential_count ?? statements.filter((item) => item.partiallyConfidential).length,
    earliestClosingDate: summary?.earliest_closing_date ?? null,
    latestClosingDate: summary?.latest_closing_date ?? null,
    matchedCompanyCount: metadataNumber(metadata, "company_count"),
    indexedStatementCount: metadataNumber(metadata, "statement_count"),
    rawCellCount: metadataNumber(metadata, "raw_cell_count"),
    sourceUpdatedAt: metadata?.source_updated_at ?? statements[0]?.sourceUpdatedAt ?? null,
    sourceUrl: metadata?.dataset_url ?? "https://www.data.gouv.fr/datasets/donnees-financieres-detaillees-des-entreprises-format-parquet",
    fullFormUrl: "https://www.impots.gouv.fr/formulaire/2050-liasse/liasse-fiscale-du-regime-reel-normal-en-matiere-de-bic-et-dis",
    simplifiedFormUrl: "https://www.impots.gouv.fr/formulaire/2033-sd/liasse-bicsi-regime-rsi-tableaux-ndeg-2033-sd-2033-g-sd",
    license: metadata?.license_name ?? "Licence Ouverte 2.0",
    scope: "national_legal_unit" as const,
    statements
  };
}

async function loadEnvironmentalCompliance(siren: string) {
  const rows = getIcpeInstallationsBySiren(siren, 100);
  const summary = getIcpeSummaryBySiren(siren);
  const metadata = getIcpeMetadata();
  if (rows === null && summary === null && metadata === null) {
    throw new Error("Index local Géorisques ICPE indisponible");
  }
  const ids = (rows ?? []).map((row) => row.id);
  const inspectionRows = getIcpeInspections(ids, 200) ?? [];
  const rubricRows = getIcpeRubrics(ids, 300) ?? [];
  const documentRows = getIcpeDocuments(ids, 200) ?? [];
  const installations = (rows ?? []).map((row) => ({
    id: String(row.id),
    aiotCode: row.aiot_code,
    siret: row.siret,
    matchScope: row.match_scope,
    address: [row.address_line_1, row.address_line_2, row.address_line_3, row.postal_code, row.commune].filter(Boolean).join(" · ") || null,
    postalCode: row.postal_code,
    communeCode: row.commune_code,
    commune: row.commune,
    nafDivision: row.naf_division,
    longitude: row.longitude,
    latitude: row.latitude,
    categories: [
      row.is_industry ? "Industrie" : null,
      row.is_quarry ? "Carrière" : null,
      row.is_wind_farm ? "Éolien" : null,
      row.has_cattle ? "Élevage bovin" : null,
      row.has_pigs ? "Élevage porcin" : null,
      row.has_poultry ? "Élevage avicole" : null
    ].filter((value): value is string => Boolean(value)),
    nationalPriority: Boolean(row.national_priority),
    sevesoStatus: row.seveso_status,
    ied: Boolean(row.ied),
    activityStatus: row.activity_status,
    inspectionService: row.inspection_service,
    regime: row.regime,
    sourceUpdatedAt: row.source_updated_at,
    detailUrl: row.detail_url,
    sourceUrl: row.dataset_url,
    license: row.license_name,
    licenseUrl: row.license_url,
    inspections: inspectionRows.filter((item) => item.installation_id === row.id).map((item) => ({
      id: String(item.id),
      inspectionDate: item.inspection_date,
      documentDate: item.document_date,
      documentType: item.document_type,
      documentUrl: item.document_url
    })),
    rubrics: rubricRows.filter((item) => item.installation_id === row.id).map((item) => ({
      id: String(item.id),
      number: item.rubric_number,
      nature: item.nature,
      paragraph: item.paragraph,
      authorizedRegime: item.authorized_regime,
      totalQuantity: item.total_quantity,
      unit: item.unit,
      reasonDate: item.reason_date
    })),
    documents: documentRows.filter((item) => item.installation_id === row.id).map((item) => ({
      id: String(item.id),
      documentDate: item.document_date,
      documentType: item.document_type,
      documentUrl: item.document_url
    }))
  }));
  return {
    total: summary?.total ?? installations.length,
    displayedCount: installations.length,
    activeSiretCount: summary?.active_siret_count ?? installations.filter((item) => item.matchScope === "exact_active_siret").length,
    authorizationCount: summary?.authorization_count ?? installations.filter((item) => item.regime === "Autorisation").length,
    registrationCount: summary?.registration_count ?? installations.filter((item) => item.regime === "Enregistrement").length,
    sevesoCount: summary?.seveso_count ?? installations.filter((item) => item.sevesoStatus?.startsWith("Seveso")).length,
    iedCount: summary?.ied_count ?? installations.filter((item) => item.ied).length,
    nationalPriorityCount: summary?.national_priority_count ?? installations.filter((item) => item.nationalPriority).length,
    latestSourceUpdate: summary?.latest_source_update ?? installations.map((item) => item.sourceUpdatedAt).filter(Boolean).sort().at(-1) ?? null,
    latestInspectionDate: summary?.latest_inspection_date ?? null,
    inspectionCount: summary?.inspection_count ?? inspectionRows.length,
    rubricCount: summary?.rubric_count ?? rubricRows.length,
    documentCount: summary?.document_count ?? documentRows.length,
    indexedInstallationCount: metadataNumber(metadata, "installation_count"),
    matchedCompanyCount: metadataNumber(metadata, "company_count"),
    sourceUpdatedAt: metadata?.latest_source_update ?? null,
    sourceUrl: metadata?.source_url ?? "https://www.georisques.gouv.fr/donnees/bases-de-donnees/installations-industrielles",
    license: metadata?.license_name ?? "Licence Ouverte 2.0",
    truncated: (summary?.total ?? installations.length) > installations.length,
    installations
  };
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function objects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  const item = parseObject(value);
  return item ? [item] : [];
}

function arrayValue(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeUrl(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  try {
    const parsed = new URL(raw.replaceAll("\\", "/"));
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

const OSM_CATEGORY_LABELS: Record<string, string> = {
  bakery: "Boulangerie",
  bank: "Banque",
  bar: "Bar",
  beauty: "Institut de beauté",
  cafe: "Café",
  car_rental: "Location de véhicules",
  car_repair: "Garage automobile",
  clothes: "Magasin de vêtements",
  company: "Entreprise",
  convenience: "Supérette",
  dentist: "Cabinet dentaire",
  estate_agent: "Agence immobilière",
  fast_food: "Restauration rapide",
  hairdresser: "Salon de coiffure",
  hospital: "Hôpital",
  hotel: "Hôtel",
  optician: "Opticien",
  pharmacy: "Pharmacie",
  restaurant: "Restaurant",
  school: "Établissement scolaire",
  social_facility: "Établissement social",
  supermarket: "Supermarché",
  townhall: "Hôtel de ville"
};

function osmLabel(key: string | null, value: string | null) {
  if (!value) return null;
  const normalized = value.replaceAll("_", " ");
  const label = OSM_CATEGORY_LABELS[value] ?? normalized.charAt(0).toUpperCase() + normalized.slice(1);
  const prefixes: Record<string, string> = { craft: "Artisanat", office: "Service", shop: "Commerce", tourism: "Tourisme" };
  return prefixes[key ?? ""] && !OSM_CATEGORY_LABELS[value] ? `${prefixes[key ?? ""]} · ${label}` : label;
}

function socialUrl(key: string, value: string) {
  const direct = safeUrl(value);
  if (direct) return direct;
  const handle = value.replace(/^@/, "");
  if (!/^[a-zA-Z0-9._-]+$/.test(handle)) return null;
  if (key.includes("facebook")) return `https://www.facebook.com/${handle}`;
  if (key.includes("instagram")) return `https://www.instagram.com/${handle}`;
  return null;
}

async function loadOsmPresence(siren: string, activeSirets: string[]) {
  const rows = getOsmBusinessProfilesBySiren(siren);
  if (rows === null) throw new Error("Index OSM local absent");
  const metadata = getOsmBusinessMetadata() ?? {};
  const activeSet = new Set(activeSirets);
  const profiles = rows.slice(0, 60).map((row) => {
    const services = parseObject(row.services_json) ?? {};
    const social = parseObject(row.social_json) ?? {};
    const establishmentStatus = !row.siret ? "company_match" : activeSet.has(row.siret) ? "active_match" : "not_in_active_stock";
    return {
      id: `${row.element_type}/${row.osm_id}`,
      siret: text(row.siret),
      name: text(row.name),
      brand: text(row.brand),
      operator: text(row.operator_name),
      category: osmLabel(row.category_key, row.category_value),
      categoryKey: text(row.category_key),
      categoryValue: text(row.category_value),
      website: safeUrl(row.website),
      publicEmail: text(row.public_email),
      phone: text(row.phone),
      openingHours: text(row.opening_hours),
      wheelchair: text(row.wheelchair),
      internetAccess: text(row.internet_access),
      address: text(row.address),
      description: text(row.description),
      latitude: row.latitude,
      longitude: row.longitude,
      services: Object.entries(services).map(([key, value]) => ({ key, value: text(value) })).filter((item): item is { key: string; value: string } => Boolean(item.value)),
      socialProfiles: Object.entries(social).map(([key, value]) => {
        const raw = text(value);
        return raw ? { platform: key.replace("contact:", ""), url: socialUrl(key, raw) } : null;
      }).filter((item): item is { platform: string; url: string } => Boolean(item?.url)),
      sourceUrl: `https://www.openstreetmap.org/${row.element_type}/${row.osm_id}`,
      establishmentStatus,
      matchConfidence: 1,
      dataConfidence: establishmentStatus === "not_in_active_stock" ? 0.55 : 0.8
    };
  });
  const unique = <T>(values: Array<T | null>) => [...new Set(values.filter((value): value is T => value !== null))];
  return {
    total: rows.length,
    profiles,
    websites: unique(profiles.map((profile) => profile.website)),
    emails: unique(profiles.map((profile) => profile.publicEmail)),
    phones: unique(profiles.map((profile) => profile.phone)),
    categories: unique(profiles.map((profile) => profile.category)),
    openingHoursCount: profiles.filter((profile) => profile.openingHours).length,
    accessibilityCount: profiles.filter((profile) => profile.wheelchair).length,
    socialProfilesCount: profiles.reduce((total, profile) => total + profile.socialProfiles.length, 0),
    activeMatchesCount: profiles.filter((profile) => profile.establishmentStatus === "active_match").length,
    staleReferencesCount: profiles.filter((profile) => profile.establishmentStatus === "not_in_active_stock").length,
    sourceReferenceDate: text(metadata.source_reference_date),
    importedAt: text(metadata.imported_at),
    license: metadata.license ?? "ODbL 1.0",
    attribution: metadata.attribution ?? "© OpenStreetMap contributors",
    sourceUrl: metadata.source_url ?? "https://download.geofabrik.de/europe/france/guadeloupe.html"
  };
}

async function loadWebsiteIntelligence(siren: string, activeSirets: string[]) {
  const rows = getWebsiteEnrichmentsBySiren(siren);
  if (rows === null) throw new Error("Index sites publics absent");
  const metadata = getWebsiteEnrichmentMetadata() ?? {};
  const activeSet = new Set(activeSirets);
  const sites = rows.map((row) => {
    const establishmentStatus = !row.siret ? "company_match" : activeSet.has(row.siret) ? "active_match" : "not_in_active_stock";
    const offerings = arrayValue(row.services_json).map((item) => parseObject(item)).filter((item): item is Record<string, unknown> => Boolean(item)).map((item) => ({
      name: text(item.name) ?? "Offre publiée",
      source: text(item.source) ?? "website",
      confidence: numberValue(item.confidence) ?? 0.65
    }));
    const social = parseObject(row.social_json) ?? {};
    return {
      id: `${row.siren}-${row.siret}-${row.input_url}`,
      siret: text(row.siret),
      sourceName: text(row.source_name),
      sourceOrigin: text(row.source_origin) ?? "OpenStreetMap",
      inputUrl: safeUrl(row.input_url),
      url: safeUrl(row.final_url) ?? safeUrl(row.input_url),
      hostname: text(row.hostname),
      robotsStatus: row.robots_status,
      fetchStatus: row.fetch_status,
      httpStatus: row.http_status,
      title: text(row.title),
      canonicalUrl: safeUrl(row.canonical_url),
      description: text(row.description),
      descriptionSource: text(row.description_source),
      offerings,
      socialProfiles: Object.entries(social).map(([platform, value]) => ({ platform, url: safeUrl(value) })).filter((item): item is { platform: string; url: string } => Boolean(item.url)),
      structuredTypes: arrayValue(row.structured_types_json).filter((item): item is string => typeof item === "string"),
      language: text(row.language),
      restricted: row.meta_robots_restricted === 1,
      lastModified: text(row.last_modified),
      fetchedAt: row.fetched_at,
      errorDetail: text(row.error_detail),
      establishmentStatus,
      descriptionConfidence: row.description_source === "jsonld" ? 0.9 : row.description_source === "meta_description" ? 0.8 : row.description_source === "open_graph" ? 0.7 : null
    };
  });
  const descriptions = [...new Map(sites.filter((site) => site.description).map((site) => [(site.description as string).toLocaleLowerCase("fr"), {
    text: site.description as string,
    source: site.descriptionSource,
    confidence: site.establishmentStatus === "not_in_active_stock" ? Math.min(site.descriptionConfidence ?? 0.7, 0.55) : site.descriptionConfidence,
    siteName: site.sourceName,
    url: site.url,
    establishmentStatus: site.establishmentStatus,
    fetchedAt: site.fetchedAt
  }])).values()];
  const offerings = [...new Map(sites.flatMap((site) => site.offerings.map((offering) => ({
    ...offering,
    siteName: site.sourceName,
    url: site.url,
    establishmentStatus: site.establishmentStatus
  }))).map((offering) => [offering.name.toLocaleLowerCase("fr"), offering])).values()].slice(0, 80);
  return {
    total: rows.length,
    accessibleSitesCount: sites.filter((site) => site.fetchStatus === "ok").length,
    descriptionsCount: descriptions.length,
    offeringsCount: offerings.length,
    socialProfilesCount: sites.reduce((total, site) => total + site.socialProfiles.length, 0),
    blockedCount: sites.filter((site) => site.fetchStatus.startsWith("robots_") || site.restricted).length,
    errorCount: sites.filter((site) => ["fetch_error", "http_error", "invalid_or_unsafe_url", "non_html"].includes(site.fetchStatus)).length,
    descriptions,
    offerings,
    sites,
    generatedAt: text(metadata.generated_at),
    methodology: text(metadata.methodology) ?? "Homepage uniquement, robots.txt respecté, aucun HTML brut ni email conservé."
  };
}

async function fetchJson(url: URL, timeoutMs = 8_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Guadeloupe-Entreprises-BI/0.1" },
      signal: controller.signal,
      next: { revalidate: 86_400 }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url: URL, timeoutMs = 4_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Guadeloupe-Entreprises-BI/0.1" },
      signal: controller.signal,
      next: { revalidate: 21_600 }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function loadBodacc(siren: string) {
  const cached = getBodaccEventsBySiren(siren, 30);
  if (cached) {
    const metadata = getBodaccMetadata();
    const activities = [...new Set(cached.rows.map((row) => row.activity_text).filter((value): value is string => Boolean(value)))].slice(0, 8);
    return {
      total: cached.total,
      activities,
      events: cached.rows.map((row) => ({
        id: row.event_id,
        date: row.publication_date,
        type: row.family ?? "announcement",
        title: row.family_label,
        city: row.city,
        legalForm: row.legal_form,
        capital: row.capital,
        capitalCurrency: row.capital_currency,
        url: safeUrl(row.source_url),
        source: "BODACC",
        confidence: 1
      })),
      cacheStatus: "snapshot" as const,
      retrievedAt: text(metadata?.finished_at ?? metadata?.retrieved_at),
      sourceUrl: metadata?.source_url ?? "https://www.bodacc.fr/api-console/explore/v2.1/"
    };
  }
  const url = new URL(BODACC_API);
  url.searchParams.set("where", `registre="${siren}"`);
  url.searchParams.set("order_by", "dateparution desc");
  url.searchParams.set("limit", "30");
  const payload = await fetchJson(url);
  const rows = Array.isArray(payload.results) ? payload.results as Record<string, unknown>[] : [];
  const activities = new Set<string>();
  const events = rows.map((row) => {
    const establishmentBlock = parseObject(row.listeetablissements);
    const establishments = objects(establishmentBlock?.etablissement);
    for (const establishment of establishments) {
      const activity = text(establishment.activite);
      if (activity) activities.add(activity);
    }
    const peopleBlock = parseObject(row.listepersonnes);
    const corporatePerson = objects(peopleBlock?.personne).find((person) => text(person.typePersonne) === "pm");
    const capital = parseObject(corporatePerson?.capital);
    return {
      id: text(row.id) ?? crypto.randomUUID(),
      date: text(row.dateparution),
      type: text(row.familleavis) ?? "announcement",
      title: text(row.familleavis_lib) ?? "Annonce commerciale",
      city: text(row.ville),
      legalForm: text(corporatePerson?.formeJuridique),
      capital: numberValue(capital?.montantCapital),
      capitalCurrency: text(capital?.devise) ?? "EUR",
      url: safeUrl(row.url_complete),
      source: "BODACC",
      confidence: 1
    };
  });
  return {
    total: Number(payload.total_count ?? rows.length),
    events,
    activities: [...activities].slice(0, 8),
    cacheStatus: "live" as const,
    retrievedAt: new Date().toISOString(),
    sourceUrl: "https://www.bodacc.fr/api-console/explore/v2.1/"
  };
}

async function loadAnnuaire(siren: string) {
  const cachedMetadata = getPublicOfficersMetadata();
  const cachedRows = getPublicOfficersBySiren(siren);
  const cachedProfile = getAnnuaireProfileBySiren(siren);
  const cachedDirigeants = cachedRows?.map((row) => ({
    displayName: row.display_name,
    role: row.role,
    officerType: row.officer_type,
    relatedSiren: row.related_siren || null,
    sourceUpdatedAt: row.source_updated_at,
    source: "Cache RNE local" as const
  })) ?? [];
  const cachedCoverage = {
    indexedSirens: Number(cachedMetadata?.indexed_sirens ?? 0),
    requestedSirens: Number(cachedMetadata?.requested_sirens ?? 0),
    retrievedAt: text(cachedMetadata?.retrieved_at)
  };
  const relatedEntities = (dirigeants: Array<{ relatedSiren?: string | null; role?: string }>) => [...new Set(dirigeants.map((item) => item.relatedSiren).filter((value): value is string => Boolean(value && /^\d{9}$/.test(value))))]
    .map((relatedSiren) => {
      const company = getEnterpriseCompanyBySiren(relatedSiren);
      return {
        siren: relatedSiren,
        name: company?.usual_name ?? company?.legal_name ?? `Personne morale ${relatedSiren}`,
        roleCount: dirigeants.filter((item) => item.relatedSiren === relatedSiren).length,
        roles: [...new Set(dirigeants.filter((item) => item.relatedSiren === relatedSiren).map((item) => item.role))]
      };
    });
  if (cachedProfile) {
    const cachedDirigeantsSource = cachedDirigeants.length ? "Snapshot RNE local" : "Snapshot Annuaire local";
    return {
      total: 1,
      financials: cachedProfile.financials.map((row) => ({ year: row.year, revenue: row.revenue, netIncome: row.net_income })),
      labels: cachedProfile.labels.map((row) => row.label),
      aidSignals: cachedProfile.aidSignals,
      agreements: cachedProfile.agreements.map((idcc) => `IDCC ${idcc}`),
      collectiveAgreementReported: Boolean(cachedProfile.profile.collective_agreement_reported),
      companyCategory: cachedProfile.profile.company_category,
      workforceBand: cachedProfile.profile.workforce_band_code ? WORKFORCE_BANDS[cachedProfile.profile.workforce_band_code] ?? `Tranche ${cachedProfile.profile.workforce_band_code}` : null,
      workforceYear: cachedProfile.profile.workforce_year,
      naf25: cachedProfile.profile.naf25,
      establishments: cachedProfile.profile.establishment_count,
      openEstablishments: cachedProfile.profile.open_establishment_count,
      dirigeants: cachedDirigeants,
      relatedLegalEntities: relatedEntities(cachedDirigeants),
      dirigeantsSource: cachedDirigeantsSource,
      dirigeantsIndexedSirens: cachedCoverage.indexedSirens,
      dirigeantsRequestedSirens: cachedCoverage.requestedSirens,
      dirigeantsRetrievedAt: cachedProfile.profile.retrieved_at,
      sourceReferenceDate: cachedProfile.profile.source_updated_at ?? cachedProfile.profile.retrieved_at,
      sourceUrl: cachedProfile.profile.source_url,
      profileSource: cachedProfile.profile.source,
      profileRetrievedAt: cachedProfile.profile.retrieved_at
    };
  }
  const url = new URL(ANNUAIRE_API);
  url.searchParams.set("q", siren);
  url.searchParams.set("per_page", "1");
  let payload: Record<string, unknown>;
  try {
    payload = await fetchJson(url);
  } catch (error) {
    if (!cachedDirigeants.length) throw error;
    return {
      total: 1,
      financials: [],
      labels: [],
      aidSignals: [],
      agreements: [],
      dirigeants: cachedDirigeants,
      relatedLegalEntities: relatedEntities(cachedDirigeants),
      dirigeantsSource: "Cache RNE local",
      dirigeantsIndexedSirens: cachedCoverage.indexedSirens,
      dirigeantsRequestedSirens: cachedCoverage.requestedSirens,
      dirigeantsRetrievedAt: cachedCoverage.retrievedAt,
      sourceReferenceDate: cachedDirigeants.map((item) => item.sourceUpdatedAt).filter(Boolean).sort().at(-1) ?? cachedCoverage.retrievedAt,
      sourceUrl: cachedRows?.[0]?.source_url ?? `${ANNUAIRE_URL}${siren}`
    };
  }
  const result = Array.isArray(payload.results)
    ? (payload.results as Record<string, unknown>[]).find((item) => text(item.siren) === siren)
    : undefined;
  if (!result && !cachedDirigeants.length) return { total: 0, financials: [], labels: [], aidSignals: [], agreements: [], dirigeants: [] };
  if (!result) {
    return {
      total: 1,
      financials: [],
      labels: [],
      aidSignals: [],
      agreements: [],
      dirigeants: cachedDirigeants,
      relatedLegalEntities: relatedEntities(cachedDirigeants),
      dirigeantsSource: "Cache RNE local",
      dirigeantsIndexedSirens: cachedCoverage.indexedSirens,
      dirigeantsRequestedSirens: cachedCoverage.requestedSirens,
      dirigeantsRetrievedAt: cachedCoverage.retrievedAt,
      sourceReferenceDate: cachedDirigeants.map((item) => item.sourceUpdatedAt).filter(Boolean).sort().at(-1) ?? cachedCoverage.retrievedAt,
      sourceUrl: cachedRows?.[0]?.source_url ?? `${ANNUAIRE_URL}${siren}`
    };
  }
  const finances = parseObject(result.finances) ?? {};
  const financials = Object.entries(finances).map(([year, raw]) => {
    const values = parseObject(raw) ?? {};
    return { year, revenue: numberValue(values.ca), netIncome: numberValue(values.resultat_net) };
  }).sort((left, right) => right.year.localeCompare(left.year));
  const complements = parseObject(result.complements) ?? {};
  const labelDefinitions: Array<[string, string]> = [
    ["est_ess", "Économie sociale et solidaire"],
    ["est_societe_mission", "Société à mission"],
    ["est_qualiopi", "Certification Qualiopi"],
    ["est_rge", "Reconnu garant de l'environnement (RGE)"],
    ["est_bio", "Agriculture biologique"],
    ["est_organisme_formation", "Organisme de formation"],
    ["est_patrimoine_vivant", "Entreprise du patrimoine vivant"],
    ["est_siae", "Structure d'insertion par l'activité économique"],
    ["egapro_renseignee", "Index égalité professionnelle renseigné"],
    ["bilan_ges_renseigne", "Bilan d'émissions de gaz à effet de serre renseigné"]
  ];
  const labels = labelDefinitions.filter(([key]) => complements[key] === true).map(([, label]) => label);
  const aidSignals = [
    complements.a_aide_minimis === true ? "Aide de minimis signalée" : null,
    complements.a_aide_ademe === true ? "Aide ADEME signalée" : null
  ].filter((value): value is string => Boolean(value));
  const agreements = Array.isArray(complements.liste_idcc)
    ? complements.liste_idcc.filter((item): item is string => typeof item === "string").map((idcc) => `IDCC ${idcc}`)
    : [];
  const workforceCode = text(result.tranche_effectif_salarie);
  const liveDirigeants = (Array.isArray(result.dirigeants) ? result.dirigeants : [])
    .map((raw) => parseObject(raw))
    .map((raw) => {
      if (!raw) return null;
      const officerType = text(raw.type_dirigeant);
      if (officerType === "personne physique") {
        const displayName = [text(raw.prenoms), text(raw.nom)].filter(Boolean).join(" ");
        if (!displayName) return null;
        return {
          displayName,
          role: text(raw.qualite) ?? "Qualité non renseignée",
          officerType,
          relatedSiren: null,
          sourceUpdatedAt: text(result.date_mise_a_jour_rne) ?? text(result.date_mise_a_jour)
        };
      }
      if (officerType === "personne morale") {
        const displayName = text(raw.denomination);
        if (!displayName) return null;
        return {
          displayName,
          role: text(raw.qualite) ?? "Qualité non renseignée",
          officerType,
          relatedSiren: text(raw.siren),
          sourceUpdatedAt: text(result.date_mise_a_jour_rne) ?? text(result.date_mise_a_jour)
        };
      }
      return null;
    })
    .filter((value): value is {
      displayName: string;
      role: string;
      officerType: string;
      relatedSiren: string | null;
      sourceUpdatedAt: string | null;
    } => value !== null);
  const dirigeants = [...liveDirigeants, ...cachedDirigeants].filter((officer, index, values) => values.findIndex((candidate) => candidate.displayName === officer.displayName && candidate.role === officer.role && candidate.relatedSiren === officer.relatedSiren) === index);
  return {
    total: 1,
    financials,
    labels,
    aidSignals,
    agreements,
    collectiveAgreementReported: complements.convention_collective_renseignee === true,
    companyCategory: text(result.categorie_entreprise),
    workforceBand: workforceCode ? WORKFORCE_BANDS[workforceCode] ?? `Tranche ${workforceCode}` : null,
    workforceYear: text(result.annee_tranche_effectif_salarie),
    naf25: text(result.activite_principale_naf25),
    establishments: numberValue(result.nombre_etablissements),
    openEstablishments: numberValue(result.nombre_etablissements_ouverts),
    dirigeants,
    relatedLegalEntities: relatedEntities(dirigeants),
    dirigeantsSource: liveDirigeants.length ? "API Recherche d’entreprises + cache RNE local" : "Cache RNE local",
    dirigeantsIndexedSirens: cachedCoverage.indexedSirens,
    dirigeantsRequestedSirens: cachedCoverage.requestedSirens,
    dirigeantsRetrievedAt: cachedCoverage.retrievedAt,
    sourceReferenceDate: text(result.date_mise_a_jour_rne) ?? text(result.date_mise_a_jour),
    sourceUrl: `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}`
  };
}

async function loadRgeQualifications(siren: string) {
  const url = new URL(ADEME_RGE_API);
  url.searchParams.set("qs", `siret:${siren}*`);
  url.searchParams.set("size", "300");
  url.searchParams.set("select", [
    "_id", "_updatedAt", "siret", "nom_entreprise", "code_qualification",
    "nom_qualification", "nom_certificat", "domaine", "meta_domaine",
    "organisme", "particulier", "traitement_termine", "lien_date_debut",
    "lien_date_fin", "date_debut", "date_fin", "url_qualification"
  ].join(","));
  const payload = await fetchJson(url);
  const rows = Array.isArray(payload.results)
    ? (payload.results as Record<string, unknown>[]).filter((row) => text(row.siret)?.startsWith(siren))
    : [];
  const today = new Date().toISOString().slice(0, 10);
  const normalized = rows.map((row) => {
    const endDate = text(row.lien_date_fin) ?? text(row.date_fin);
    const active = row.traitement_termine !== true && (!endDate || endDate >= today);
    return {
      id: text(row._id) ?? crypto.randomUUID(),
      siret: text(row.siret),
      companyName: text(row.nom_entreprise),
      qualificationCode: text(row.code_qualification),
      qualificationName: text(row.nom_qualification) ?? text(row.nom_certificat) ?? "Qualification RGE",
      certificateName: text(row.nom_certificat),
      domains: (text(row.domaine) ?? "").split(";").map((item) => item.trim()).filter(Boolean),
      metaDomain: text(row.meta_domaine),
      organization: text(row.organisme),
      forIndividuals: row.particulier === true,
      startDate: text(row.lien_date_debut) ?? text(row.date_debut),
      endDate,
      status: active ? "active" as const : "historical" as const,
      certificateUrl: safeUrl(row.url_qualification),
      updatedAt: text(row._updatedAt),
      source: "ADEME RGE",
      confidence: 1
    };
  });
  const deduplicated = new Map<string, (typeof normalized)[number]>();
  for (const item of normalized) {
    const key = [item.siret, item.qualificationCode, item.qualificationName, item.startDate, item.endDate].join("|");
    const current = deduplicated.get(key);
    if (!current || item.status === "active") deduplicated.set(key, item);
  }
  const qualifications = [...deduplicated.values()]
    .sort((left, right) => Number(right.status === "active") - Number(left.status === "active") || (right.endDate ?? "").localeCompare(left.endDate ?? ""))
    .slice(0, 100);
  const unique = (values: Array<string | null>) => [...new Set(values.filter((value): value is string => Boolean(value)))];
  return {
    total: qualifications.length,
    activeCount: qualifications.filter((item) => item.status === "active").length,
    historicalCount: qualifications.filter((item) => item.status === "historical").length,
    domains: unique(qualifications.flatMap((item) => item.domains)),
    organizations: unique(qualifications.map((item) => item.organization)),
    qualifications,
    truncated: Number(payload.total ?? rows.length) > rows.length,
    sourceUpdatedAt: qualifications.map((item) => item.updatedAt).filter(Boolean).sort().at(-1) ?? null,
    sourceUrl: "https://data.ademe.fr/datasets/historique-rge",
    license: "Licence Ouverte 2.0"
  };
}

async function loadPublicContracts(siren: string) {
  const where = `startswith(siretetablissement, "${siren}")`;
  const listUrl = new URL(DECP_API);
  listUrl.searchParams.set("where", where);
  listUrl.searchParams.set("order_by", "datenotification desc");
  listUrl.searchParams.set("limit", "20");
  const statsUrl = new URL(DECP_API);
  statsUrl.searchParams.set("select", "count(*) as count,sum(montant) as total_amount,max(datenotification) as latest_date");
  statsUrl.searchParams.set("where", where);
  statsUrl.searchParams.set("limit", "1");
  const [listPayload, statsPayload] = await Promise.all([fetchJson(listUrl), fetchJson(statsUrl)]);
  const rows = Array.isArray(listPayload.results) ? listPayload.results as Record<string, unknown>[] : [];
  const stats = Array.isArray(statsPayload.results) ? statsPayload.results[0] as Record<string, unknown> | undefined : undefined;
  return {
    total: Number(stats?.count ?? listPayload.total_count ?? rows.length),
    totalAmount: numberValue(stats?.total_amount),
    latestDate: text(stats?.latest_date),
    contracts: rows.map((row) => ({
      id: text(row.id) ?? crypto.randomUUID(),
      title: text(row.objetmarche) ?? "Marché public",
      date: text(row.datenotification),
      amount: numberValue(row.montant),
      durationMonths: numberValue(row.dureemois),
      buyer: text(row.nomacheteur),
      procedure: text(row.procedure),
      nature: text(row.nature),
      cpv: text(row.codecpv),
      cpvLabel: text(row.referencecpv),
      executionPlace: text(row.lieuexecutionnom),
      source: "DECP",
      sourceUrl: "https://data.economie.gouv.fr/explore/dataset/decp_augmente/",
      confidence: 1
    }))
  };
}

async function loadGdeltMentions(normalized: string) {
  const url = new URL(GDELT_API);
  url.searchParams.set("query", `"${normalized}" Guadeloupe`);
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("maxrecords", "20");
  url.searchParams.set("format", "json");
  url.searchParams.set("sort", "datedesc");
  url.searchParams.set("timespan", "3months");
  const payload = await fetchJson(url, 1_800);
  const articlesContainer = parseObject(payload.articles);
  const rows = Array.isArray(payload.articles)
    ? payload.articles as Record<string, unknown>[]
    : objects(articlesContainer?.article);
  return rows.map((row) => ({
    title: text(row.title) ?? "Mention média",
    url: safeUrl(row.url),
    domain: text(row.domain),
    publishedAt: text(row.seendate),
    language: text(row.language),
    sourceCountry: text(row.sourcecountry),
    source: "GDELT",
    confidence: 0.65
  })).filter((item): item is typeof item & { url: string } => Boolean(item.url));
}

async function loadGoogleNewsMentions(normalized: string) {
  const url = new URL(GOOGLE_NEWS_RSS);
  url.searchParams.set("q", `"${normalized}" Guadeloupe`);
  url.searchParams.set("hl", "fr");
  url.searchParams.set("gl", "FR");
  url.searchParams.set("ceid", "FR:fr");
  const xml = await fetchText(url);
  const parsed = new XMLParser({ ignoreAttributes: false, trimValues: true }).parse(xml) as Record<string, unknown>;
  const rss = parseObject(parsed.rss);
  const channel = parseObject(rss?.channel);
  const rows = Array.isArray(channel?.item) ? channel.item as Record<string, unknown>[] : objects(channel?.item);
  return rows.slice(0, 20).map((row) => {
    const publisher = parseObject(row.source);
    const titleValue = text(row.title) ?? "Mention média";
    const domain = text(publisher?.["#text"]) ?? titleValue.split(" - ").at(-1) ?? null;
    return {
      title: titleValue,
      url: safeUrl(row.link) ?? "",
      domain,
      publishedAt: text(row.pubDate),
      language: "français",
      sourceCountry: "France",
      source: "Google News RSS",
      confidence: 0.58
    };
  }).filter((item) => Boolean(item.url));
}

async function loadPressMentions(siren: string, companyName: string) {
  const cached = getPressSignalSnapshotBySiren(siren);
  if (cached) {
    return {
      total: cached.mentions.length,
      mentions: cached.mentions.map((mention) => ({
        title: mention.title,
        url: mention.url,
        domain: mention.domain,
        publishedAt: mention.published_at,
        language: mention.language,
        sourceCountry: mention.source_country,
        source: mention.source,
        confidence: mention.confidence
      })),
      skipped: false,
      cacheStatus: cached.status,
      fetchedAt: cached.fetched_at,
      cacheError: cached.error
    };
  }
  const normalized = companyName.replace(/["()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  if (normalized.length < 5 || normalized === "Entreprise individuelle" || normalized === "Établissement SIRENE") {
    return { total: 0, mentions: [], skipped: true };
  }
  const results = await Promise.allSettled([
    loadGdeltMentions(normalized),
    loadGoogleNewsMentions(normalized)
  ]);
  const rows = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (results.every((result) => result.status === "rejected")) throw new Error("Fournisseurs média indisponibles");
  const unique = [...new Map(rows.map((row) => [row.url, row])).values()];
  return {
    total: unique.length,
    mentions: unique,
    skipped: false,
    cacheStatus: "live",
    fetchedAt: new Date().toISOString(),
    cacheError: null
  };
}

type CompanyTimelineEvent = {
  id: string;
  date: string;
  label: string;
  detail: string | null;
  source: string;
  sourceUrl: string | null;
  confidence: number;
};

type GovernanceOfficer = {
  displayName: string;
  role: string;
  officerType: string;
  relatedSiren: string | null;
  sourceUpdatedAt: string | null;
};

function governanceKey(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function buildGovernanceNetwork(siren: string, officers: GovernanceOfficer[]) {
  const company = getEnterpriseCompanyBySiren(siren);
  const companyNode = {
    id: `company:${siren}`,
    kind: "company" as const,
    label: company?.usual_name ?? company?.legal_name ?? `Unité légale ${siren}`,
    siren,
    roles: [] as string[]
  };
  const nodes = new Map<string, typeof companyNode | { id: string; kind: "person" | "legal_entity"; label: string; siren: string | null; roles: string[] }>([[companyNode.id, companyNode]]);
  const edges: Array<{ id: string; source: string; target: string; role: string; sourceUpdatedAt: string | null }> = [];
  for (const officer of officers) {
    const legalEntity = officer.relatedSiren ? getEnterpriseCompanyBySiren(officer.relatedSiren) : null;
    const nodeId = officer.relatedSiren ? `legal:${officer.relatedSiren}` : `person:${governanceKey(officer.displayName)}`;
    const existing = nodes.get(nodeId);
    if (existing) {
      if (!existing.roles.includes(officer.role)) existing.roles.push(officer.role);
    } else {
      nodes.set(nodeId, {
        id: nodeId,
        kind: officer.relatedSiren ? "legal_entity" : "person",
        label: legalEntity?.usual_name ?? legalEntity?.legal_name ?? officer.displayName,
        siren: officer.relatedSiren,
        roles: [officer.role]
      });
    }
    edges.push({
      id: `${nodeId}->${companyNode.id}:${governanceKey(officer.role)}`,
      source: nodeId,
      target: companyNode.id,
      role: officer.role,
      sourceUpdatedAt: officer.sourceUpdatedAt
    });
  }
  return {
    mode: "published_legal_mandates" as const,
    nodes: [...nodes.values()],
    edges,
    note: "Réseau construit à partir des mandats légaux publiés. Il ne déduit ni la hiérarchie, ni les équipes, ni les bénéficiaires effectifs."
  };
}

function timelineDate(value: unknown) {
  const raw = text(value)?.trim();
  if (!raw) return null;
  if (/^\d{4}$/.test(raw)) return raw;
  const isoDate = raw.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (isoDate) return isoDate;
  const compactDate = raw.match(/\d{8}/)?.[0];
  if (compactDate) return `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

function timelineDetail(values: unknown[]) {
  const detail = values.map((value) => text(value)).filter((value): value is string => Boolean(value)).join(" · ");
  return detail ? detail.slice(0, 260) : null;
}

function timelineAmount(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `${amount.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €` : null;
}

function buildCompanyTimeline(input: {
  bodacc: Awaited<ReturnType<typeof loadBodacc>>;
  annuaire: Awaited<ReturnType<typeof loadAnnuaire>>;
  publicContracts: Awaited<ReturnType<typeof loadPublicContracts>>;
  publicGrants: Awaited<ReturnType<typeof loadPublicGrants>>;
  ademeAids: Awaited<ReturnType<typeof loadAdemeFinancialAids>>;
  fondsVert: Awaited<ReturnType<typeof loadFondsVertProjects>>;
  franceRelance: Awaited<ReturnType<typeof loadFranceRelanceProjects>>;
  financialRatios: Awaited<ReturnType<typeof loadFinancialRatios>>;
  detailedFinancials: Awaited<ReturnType<typeof loadDetailedFinancialStatements>>;
  patents: Awaited<ReturnType<typeof loadPatentPortfolio>>;
  press: Awaited<ReturnType<typeof loadPressMentions>>;
}) {
  const events = new Map<string, CompanyTimelineEvent>();
  const add = (event: Omit<CompanyTimelineEvent, "confidence"> & { confidence?: number }) => {
    if (!event.date) return;
    events.set(event.id, { ...event, confidence: event.confidence ?? 1 });
  };

  for (const event of input.bodacc.events) {
    const date = timelineDate(event.date);
    if (!date) continue;
    add({
      id: `bodacc-${event.id}`,
      date,
      label: event.title,
      detail: timelineDetail([event.city, event.legalForm, event.capital !== null ? `Capital publié ${timelineAmount(event.capital)}` : null]),
      source: "BODACC",
      sourceUrl: event.url,
      confidence: event.confidence
    });
  }

  for (const contract of input.publicContracts.contracts) {
    const date = timelineDate(contract.date);
    if (!date) continue;
    add({
      id: `contract-${contract.id}`,
      date,
      label: "Marché public attribué",
      detail: timelineDetail([contract.title, contract.buyer, timelineAmount(contract.amount), contract.executionPlace]),
      source: "DECP",
      sourceUrl: contract.sourceUrl,
      confidence: contract.confidence
    });
  }

  for (const grant of input.publicGrants.grants) {
    const date = timelineDate(grant.conventionDate);
    if (!date) continue;
    add({
      id: `scdl-${grant.id}`,
      date,
      label: "Subvention publique publiée",
      detail: timelineDetail([grant.purpose, grant.awardingAuthority, timelineAmount(grant.amount)]),
      source: "SCDL",
      sourceUrl: grant.datasetUrl,
      confidence: grant.matchConfidence
    });
  }

  for (const aid of input.ademeAids.aids) {
    const date = timelineDate(aid.conventionDate);
    if (!date) continue;
    add({
      id: `ademe-${aid.id}`,
      date,
      label: "Aide ADEME publiée",
      detail: timelineDetail([aid.purpose, aid.aidScheme, timelineAmount(aid.amount)]),
      source: "ADEME Aides",
      sourceUrl: aid.sourceUrl,
      confidence: aid.matchConfidence
    });
  }

  for (const project of input.fondsVert.projects) {
    const date = timelineDate(project.year);
    if (!date) continue;
    add({
      id: `fonds-vert-${project.id}`,
      date,
      label: "Projet Fonds vert publié",
      detail: timelineDetail([project.projectName, project.commune, timelineAmount(project.committedAmount)]),
      source: "Fonds vert",
      sourceUrl: project.resourceUrl ?? project.datasetUrl,
      confidence: project.matchConfidence
    });
  }

  for (const project of input.franceRelance.projects) {
    const date = timelineDate(project.updateDate);
    if (!date) continue;
    add({
      id: `france-relance-${project.id}`,
      date,
      label: "Projet industriel lauréat publié",
      detail: timelineDetail([project.measureLabel, project.sector, project.commune]),
      source: "France Relance",
      sourceUrl: project.resourceUrl ?? project.portalUrl,
      confidence: project.matchConfidence
    });
  }

  for (const financial of input.annuaire.financials) {
    const date = timelineDate(financial.year);
    if (!date) continue;
    add({
      id: `annuaire-financial-${financial.year}`,
      date,
      label: "Compte publié dans l'Annuaire",
      detail: timelineDetail([
        financial.revenue !== null ? `CA ${timelineAmount(financial.revenue)}` : null,
        financial.netIncome !== null ? `Résultat net ${timelineAmount(financial.netIncome)}` : null,
        "Périmètre unité légale nationale"
      ]),
      source: "Annuaire des Entreprises",
      sourceUrl: input.annuaire.sourceUrl ?? null,
      confidence: 1
    });
  }

  const latestFinancialDate = timelineDate(input.financialRatios.latestClosingDate ?? input.detailedFinancials.latestClosingDate);
  if (latestFinancialDate) {
    add({
      id: `financial-${latestFinancialDate}`,
      date: latestFinancialDate,
      label: "Exercice financier publié",
      detail: timelineDetail([input.financialRatios.total ? `${input.financialRatios.total} exercice(s) de ratios` : null, input.detailedFinancials.total ? `${input.detailedFinancials.total} bilan(s) détaillé(s)` : null, "Périmètre unité légale nationale"]),
      source: "BCE/INPI",
      sourceUrl: input.financialRatios.sourceUrl ?? input.detailedFinancials.sourceUrl,
      confidence: 1
    });
  }

  const latestPatentDate = timelineDate(input.patents.latestApplicationDate);
  if (latestPatentDate) {
    add({
      id: `patent-${latestPatentDate}`,
      date: latestPatentDate,
      label: "Demande de brevet indexée",
      detail: timelineDetail([input.patents.applicationCount ? `${input.patents.applicationCount} demande(s)` : null, "Portefeuille national de l’unité légale"]),
      source: "Brevets",
      sourceUrl: input.patents.familiesSourceUrl,
      confidence: 1
    });
  }

  for (const mention of input.press.mentions) {
    const date = timelineDate(mention.publishedAt);
    if (!date) continue;
    add({
      id: `press-${mention.url}`,
      date,
      label: mention.title,
      detail: timelineDetail([mention.domain, mention.source]),
      source: mention.source,
      sourceUrl: mention.url,
      confidence: mention.confidence
    });
  }

  return [...events.values()]
    .sort((left, right) => right.date.localeCompare(left.date) || right.confidence - left.confidence || left.source.localeCompare(right.source))
    .slice(0, 60);
}

async function buildBusinessIntelligence(siren: string, companyName: string, activeSirets: string[] = []) {
  const statuses: SourceStatus[] = [];
  const officialProfile = loadSireneOfficialProfile(siren);
  statuses.push({ source: "SIRENE", status: officialProfile.total ? "ok" : "empty" });
  const settle = async <T>(source: string, task: Promise<T>, fallback: T): Promise<T> => {
    try {
      const result = await task;
      const total = typeof result === "object" && result && "total" in result ? Number((result as { total: unknown }).total) : 0;
      statuses.push({ source, status: total > 0 ? "ok" : "empty" });
      return result;
    } catch (error) {
      statuses.push({ source, status: "unavailable", detail: error instanceof Error ? error.message : "Erreur fournisseur" });
      return fallback;
    }
  };

  const [association, annuaire, trainingOrganizations, professionalEquality, collectiveAgreements, patents, financialRatios, detailedFinancials, environmentalCompliance, publicGrants, ademeAids, fondsVert, franceRelance, osmPresence, websites, rge, bodacc, publicContracts, press, recruitment] = await Promise.all([
    settle("RNA", loadAssociationIntelligence(siren), { total: 0, activeCount: 0, dissolvedCount: 0, statusConflictCount: 0, purposeCount: 0, publicUtilityCount: 0, identifierWarningCount: 0, qualityWarningCount: 0, sourceReferenceDate: "", sourceUrl: "https://www.data.gouv.fr/datasets/rna-agrege-a-lechelle-nationale", license: "Licence Ouverte 2.0", profiles: [] }),
    settle("Annuaire", loadAnnuaire(siren), { total: 0, financials: [], labels: [], aidSignals: [], agreements: [], dirigeants: [] }),
    settle("Organismes de formation", loadTrainingOrganizations(siren), { total: 0, displayedCount: 0, guadeloupeCount: 0, outsideCount: 0, activeLocalCount: 0, qualityCount: 0, specialtyCount: 0, metricsCount: 0, qualityTrainingCount: 0, qualitySkillsCount: 0, qualityVaeCount: 0, qualityApprenticeshipCount: 0, earliestDeclarationDate: null, latestDeclarationDate: null, latestExerciseEndDate: null, truncated: false, sourceRowCount: 0, matchedCompanyCount: 0, sourceUpdatedAt: "", sourceUrl: "https://www.data.gouv.fr/datasets/liste-publique-des-organismes-de-formation-l-6351-7-1-du-code-du-travail", license: "Licence Ouverte", profiles: [] }),
    settle<Awaited<ReturnType<typeof loadProfessionalEquality>>>("Index égalité", loadProfessionalEquality(siren), { total: 0, displayedCount: 0, calculableCount: 0, nonCalculableCount: 0, directCount: 0, uesCount: 0, guadeloupeCount: 0, earliestYear: 0, latestYear: 0, latestCalculableYear: 0, latestScore: null, scoreDelta: null, sourceRowCount: 0, matchedCompanyCount: 0, sourceUpdatedAt: "", sourceUrl: "https://www.data.gouv.fr/datasets/index-egalite-professionnelle-f-h-des-entreprises-de-50-salaries-ou-plus", egaproUrl: "https://egapro.travail.gouv.fr/consulter-index", license: "Licence Ouverte 2.0", declarations: [] }),
    settle<Awaited<ReturnType<typeof loadCollectiveAgreements>>>("Conventions & OPCO", loadCollectiveAgreements(siren), { total: 0, displayedCount: 0, agreementCount: 0, agreementEstablishmentCount: 0, substantiveAgreementCount: 0, escapeAgreementCount: 0, distinctIdccCount: 0, multiIdccEstablishmentCount: 0, titledAgreementCount: 0, opcoAssignmentCount: 0, assignedOpcoCount: 0, opcoAnomalyCount: 0, effectiveOpcoCount: 0, effectiveOpcos: [], crossSourceDifferenceCount: 0, idccReferenceMonth: "", siroReferenceMonth: "", sourceRowCount: 0, matchedCompanyCount: 0, sourceUpdatedAt: "", siroSourceUpdatedAt: "", idccSourceUrl: "https://www.data.gouv.fr/datasets/liste-des-conventions-collectives-par-entreprise-siret", siroSourceUrl: "https://www.data.gouv.fr/datasets/table-siret-opco", kaliSourceUrl: "https://github.com/SocialGouv/kali-data", kaliVersion: null, license: "Licence Ouverte 2.0", establishments: [] }),
    settle<Awaited<ReturnType<typeof loadPatentPortfolio>>>("Brevets", loadPatentPortfolio(siren), { total: 0, displayedCount: 0, applicationCount: 0, grantedCount: 0, internationalCount: 0, epoCount: 0, titleCount: 0, abstractCount: 0, earliestApplicationDate: null, latestApplicationDate: null, applicationAuthorityCount: 0, technologyCount: 0, technologySectionCount: 0, sections: [], truncated: false, sourceApplicantRows: 0, matchedCompanyCount: 0, indexedFamilyCount: 0, indexedApplicationCount: 0, applicantsSourceUpdatedAt: "", familiesSourceUpdatedAt: "", technologiesSourceUpdatedAt: "", applicantsSourceUrl: "https://www.data.gouv.fr/datasets/deposants-des-brevets-1", familiesSourceUrl: "https://www.data.gouv.fr/datasets/familles-de-brevets", technologiesSourceUrl: "https://www.data.gouv.fr/datasets/technologies-des-familles-de-brevets", license: "Licence Ouverte 2.0", scope: "national_legal_unit", families: [] }),
    settle<Awaited<ReturnType<typeof loadFinancialRatios>>>("Ratios financiers", loadFinancialRatios(siren), { total: 0, publicCount: 0, partiallyConfidentialCount: 0, completeCount: 0, simplifiedCount: 0, consolidatedCount: 0, earliestClosingDate: null, latestClosingDate: null, matchedCompanyCount: 0, indexedExerciseCount: 0, sourceRowCount: 0, sourceUpdatedAt: "", sourceUrl: "https://www.data.gouv.fr/datasets/ratios-financiers-bce-inpi", license: "Licence Ouverte 2.0", scope: "national_legal_unit", definitions: [], exercises: [] }),
    settle<Awaited<ReturnType<typeof loadDetailedFinancialStatements>>>("Bilans détaillés", loadDetailedFinancialStatements(siren), { total: 0, partiallyConfidentialCount: 0, earliestClosingDate: null, latestClosingDate: null, matchedCompanyCount: 0, indexedStatementCount: 0, rawCellCount: 0, sourceUpdatedAt: "", sourceUrl: "https://www.data.gouv.fr/datasets/donnees-financieres-detaillees-des-entreprises-format-parquet", fullFormUrl: "https://www.impots.gouv.fr/formulaire/2050-liasse/liasse-fiscale-du-regime-reel-normal-en-matiere-de-bic-et-dis", simplifiedFormUrl: "https://www.impots.gouv.fr/formulaire/2033-sd/liasse-bicsi-regime-rsi-tableaux-ndeg-2033-sd-2033-g-sd", license: "Licence Ouverte 2.0", scope: "national_legal_unit", statements: [] }),
    settle<Awaited<ReturnType<typeof loadEnvironmentalCompliance>>>("Géorisques ICPE", loadEnvironmentalCompliance(siren), { total: 0, displayedCount: 0, activeSiretCount: 0, authorizationCount: 0, registrationCount: 0, sevesoCount: 0, iedCount: 0, nationalPriorityCount: 0, latestSourceUpdate: null, latestInspectionDate: null, inspectionCount: 0, rubricCount: 0, documentCount: 0, indexedInstallationCount: 0, matchedCompanyCount: 0, sourceUpdatedAt: null, sourceUrl: "https://www.georisques.gouv.fr/donnees/bases-de-donnees/installations-industrielles", license: "Licence Ouverte 2.0", truncated: false, installations: [] }),
    settle("SCDL", loadPublicGrants(siren), { total: 0, displayedCount: 0, totalAmount: null, earliestDate: null, latestDate: null, authorityCount: 0, sourceCount: 0, activeEstablishmentCount: 0, historicalEstablishmentCount: 0, associationMatchCount: 0, truncated: false, catalogDatasetCount: 0, openDatasetCount: 0, importedResourceCount: 0, sourceReferenceDate: null, importedAt: null, schemaUrl: "https://schema.data.gouv.fr/scdl/subventions/", catalogUrl: "https://www.data.gouv.fr/datasets/?schema=scdl%2Fsubventions", grants: [] }),
    settle("ADEME Aides", loadAdemeFinancialAids(siren), { total: 0, displayedCount: 0, totalAmount: null, activeLocalCount: 0, activeLocalAmount: null, companyScopeCount: 0, companyScopeAmount: null, schemeCount: 0, earliestDate: null, latestDate: null, truncated: false, sourceRowCount: 0, sourceUpdatedAt: "", sourceUrl: "https://data.ademe.fr/datasets/les-aides-financieres-de-l'ademe", dataGouvUrl: "https://www.data.gouv.fr/datasets/les-aides-financieres-de-lademe-1", license: "Licence Ouverte 2.0", aids: [] }),
    settle("Fonds vert", loadFondsVertProjects(siren), { total: 0, displayedCount: 0, totalAmount: null, guadeloupeCount: 0, guadeloupeAmount: null, outsideCount: 0, outsideAmount: null, unknownLocationCount: 0, activeLocalCount: 0, activeLocalAmount: null, schemeCount: 0, earliestYear: null, latestYear: null, truncated: false, sourceRowCount: 0, resourceCount: 0, excludedResourceCount: 0, sourceUpdatedAt: "", sourceUrl: "https://www.data.gouv.fr/datasets/fonds-vert-liste-des-projets-subventionnes", license: "Licence Ouverte 2.0", projects: [] }),
    settle("France Relance", loadFranceRelanceProjects(siren), { total: 0, displayedCount: 0, guadeloupeCount: 0, outsideCount: 0, unknownLocationCount: 0, activeLocalCount: 0, descriptionCount: 0, co2MetricCount: 0, measureCount: 0, sectorCount: 0, earliestDate: null, latestDate: null, truncated: false, sourceRowCount: 0, sourceUpdatedAt: "", sourceUrl: "https://www.data.gouv.fr/datasets/plan-de-relance-projets-industriels-liste-geolocalisation-et-description-synthetique-des-projets", portalUrl: "https://data.economie.gouv.fr/explore/dataset/plan-de-relance/", license: "Licence Ouverte 2.0", individualAmountsAvailable: false, projects: [] }),
    settle("OSM", loadOsmPresence(siren, activeSirets), { total: 0, profiles: [], websites: [], emails: [], phones: [], categories: [], openingHoursCount: 0, accessibilityCount: 0, socialProfilesCount: 0, activeMatchesCount: 0, staleReferencesCount: 0, sourceReferenceDate: null, importedAt: null, license: "ODbL 1.0", attribution: "© OpenStreetMap contributors", sourceUrl: "https://www.openstreetmap.org/" }),
    settle("Sites publics", loadWebsiteIntelligence(siren, activeSirets), { total: 0, accessibleSitesCount: 0, descriptionsCount: 0, offeringsCount: 0, socialProfilesCount: 0, blockedCount: 0, errorCount: 0, descriptions: [], offerings: [], sites: [], generatedAt: null, methodology: "Homepage uniquement, robots.txt respecté, aucun HTML brut ni email conservé." }),
    settle("ADEME RGE", loadRgeQualifications(siren), { total: 0, activeCount: 0, historicalCount: 0, domains: [], organizations: [], qualifications: [], truncated: false, sourceUpdatedAt: null, sourceUrl: "https://data.ademe.fr/datasets/historique-rge", license: "Licence Ouverte 2.0" }),
    settle("BODACC", loadBodacc(siren), { total: 0, events: [], activities: [] as string[], cacheStatus: "live" as const, retrievedAt: new Date().toISOString(), sourceUrl: "https://www.bodacc.fr/api-console/explore/v2.1/" }),
    settle("DECP", loadPublicContracts(siren), { total: 0, totalAmount: null, latestDate: null, contracts: [] }),
    settle("Presse", loadPressMentions(siren, companyName), { total: 0, mentions: [], skipped: false }),
    settle("France Travail", loadRecruitmentSignals(siren, companyName, activeSirets), { status: "unavailable" as const, total: 0, identifierMatchedCount: 0, offers: [], retrievedAt: null, sourceUrl: "https://www.data.gouv.fr/dataservices/api-offres-demploi", detail: "Flux désactivé ou identifiants non configurés." })
  ]);
  const pressStatus = statuses.find((status) => status.source === "Presse");
  if (pressStatus && press.cacheStatus === "error") {
    pressStatus.status = "unavailable";
    pressStatus.detail = press.cacheError ?? "Le snapshot média est en erreur fournisseur.";
  } else if (pressStatus && press.cacheStatus === "partial") {
    pressStatus.detail = "Snapshot média partiel : au moins un fournisseur n’a pas répondu.";
  }
  const sourceOrder = ["SIRENE", "RNA", "Annuaire", "Organismes de formation", "Index égalité", "Conventions & OPCO", "Brevets", "Ratios financiers", "Bilans détaillés", "Géorisques ICPE", "SCDL", "ADEME Aides", "Fonds vert", "France Relance", "ADEME RGE", "BODACC", "DECP", "France Travail", "OSM", "Sites publics", "Presse"];
  statuses.sort((left, right) => sourceOrder.indexOf(left.source) - sourceOrder.indexOf(right.source));
  const companyProfile = buildCompanyProfile({
    retrievedAt: new Date().toISOString(),
    sourceStatuses: statuses,
    officialProfile,
    annuaire,
    websites,
    osmPresence: {
      services: osmPresence.profiles.flatMap((profile) => profile.services.map((service) => ({ ...service, sourceUrl: profile.sourceUrl }))),
      categories: osmPresence.categories,
      websites: osmPresence.websites,
      publicEmails: osmPresence.emails,
      sourceReferenceDate: osmPresence.sourceReferenceDate,
      sourceUrl: osmPresence.sourceUrl
    },
    trainingOrganizations,
    rge: {
      domains: rge.domains,
      qualifications: rge.qualifications.map((qualification) => ({ qualificationName: qualification.qualificationName, sourceUpdatedAt: qualification.updatedAt })),
      sourceUpdatedAt: rge.sourceUpdatedAt,
      sourceUrl: rge.sourceUrl
    },
    bodacc,
    patents: {
      total: patents.total,
      technologySections: patents.sections.map((section) => section.label),
      latestApplicationDate: patents.latestApplicationDate,
      sourceUpdatedAt: patents.familiesSourceUpdatedAt,
      sourceUrl: patents.familiesSourceUrl
    },
    publicContracts: {
      total: publicContracts.total,
      latestDate: publicContracts.latestDate,
      sourceUrl: publicContracts.contracts[0]?.sourceUrl ?? null
    },
    press: {
      total: press.total,
      latestPublishedAt: press.mentions.map((mention) => mention.publishedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null
    },
    environmentalCompliance: {
      total: environmentalCompliance.total,
      sourceUpdatedAt: environmentalCompliance.sourceUpdatedAt,
      sourceUrl: environmentalCompliance.sourceUrl
    }
  });
  const timeline = buildCompanyTimeline({ annuaire, bodacc, publicContracts, publicGrants, ademeAids, fondsVert, franceRelance, financialRatios, detailedFinancials, patents, press });
  const governanceNetwork = buildGovernanceNetwork(siren, (annuaire.dirigeants ?? []) as GovernanceOfficer[]);

  return {
    siren,
    retrievedAt: new Date().toISOString(),
    statuses,
    officialProfile,
    association,
    annuaire,
    governanceNetwork,
    trainingOrganizations,
    professionalEquality,
    collectiveAgreements,
    patents,
    financialRatios,
    detailedFinancials,
    environmentalCompliance,
    publicGrants,
    ademeAids,
    fondsVert,
    franceRelance,
    osmPresence,
    websites,
    rge,
    bodacc,
    publicContracts,
    press,
    recruitment,
    timeline,
    companyProfile,
    methodology: "Correspondance exacte par SIREN/SIRET/RNA pour les sources administratives, Géorisques ICPE et OSM; rattachement Egapro par SIREN déclarant ou membre d’UES explicitement publié; recherche par dénomination exacte et Guadeloupe pour la presse. Les IDCC et OPCO sont rattachés par SIRET exact à partir de déclarations DSN de millésimes distincts; un écart entre les sources est conservé et signalé, sans interprétation juridique. Les brevets, ratios et bilans détaillés sont rattachés au périmètre national de l’unité légale par SIREN exact; ils ne sont jamais attribués automatiquement à son établissement guadeloupéen. Les installations ICPE sont reliées par SIRET exact; une inspection ou un classement réglementaire ne prouve ni incident, ni infraction, ni performance environnementale. Les rapports sont seulement liés et jamais aspirés. Les bilans C, S et K restent distincts, les comptes de résultat sous confidentialité partielle ne sont pas affichés, les cellules fiscales brutes ne sont pas exposées et aucun score de solvabilité n’est calculé. Les spécialités et volumes de formation proviennent du dernier bilan pédagogique et financier publié et ne décrivent pas nécessairement une offre actuelle. Les scores Egapro sont des résultats agrégés déclarés et ne permettent pas, seuls, de conclure sur une situation individuelle. Les montants SCDL, ADEME et Fonds vert sont des attributions ou engagements publiés, pas des preuves de versement. France Relance ne publie aucun montant individuel dans le jeu industriel utilisé."
  };
}

type BusinessIntelligenceResult = Awaited<ReturnType<typeof buildBusinessIntelligence>>;
const intelligenceCache = new Map<string, { expiresAt: number; value: BusinessIntelligenceResult }>();
const intelligenceInFlight = new Map<string, Promise<BusinessIntelligenceResult>>();

function intelligenceCacheTtlMs() {
  const value = Number((process as unknown as { env: Record<string, string | undefined> }).env.BI_CACHE_TTL_SECONDS ?? "300");
  return Number.isFinite(value) && value >= 30 && value <= 3600 ? value * 1000 : 300_000;
}

function intelligenceCacheKey(siren: string, companyName: string, activeSirets: string[]) {
  return `${siren}|${companyName}|${[...activeSirets].sort().join(",")}`;
}

export async function getBusinessIntelligence(siren: string, companyName: string, activeSirets: string[] = []) {
  const key = intelligenceCacheKey(siren, companyName, activeSirets);
  const cached = intelligenceCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) intelligenceCache.delete(key);
  const running = intelligenceInFlight.get(key);
  if (running) return running;
  const promise = buildBusinessIntelligence(siren, companyName, activeSirets)
    .then((value) => {
      intelligenceCache.set(key, { expiresAt: Date.now() + intelligenceCacheTtlMs(), value });
      while (intelligenceCache.size > 128) {
        const oldestKey = intelligenceCache.keys().next().value;
        if (!oldestKey) break;
        intelligenceCache.delete(oldestKey);
      }
      return value;
    })
    .finally(() => intelligenceInFlight.delete(key));
  intelligenceInFlight.set(key, promise);
  return promise;
}
