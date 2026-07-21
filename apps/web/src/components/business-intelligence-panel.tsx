"use client";

import { Accessibility, Activity, BarChart3, Building2, CircleAlert, Clock3, Database, ExternalLink, FlaskConical, Globe2, Landmark, Lightbulb, LockKeyhole, Mail, MapPin, Newspaper, Phone, RefreshCw, Scale, ShieldCheck, TrendingUp, Users } from "lucide-react";
import { useEffect, useState } from "react";

type Intelligence = {
  retrievedAt: string;
  methodology: string;
  timeline?: Array<{
    id: string;
    date: string;
    label: string;
    detail: string | null;
    source: string;
    sourceUrl: string | null;
    confidence: number;
  }>;
  companyProfile?: {
    summary: string;
    descriptionSource: "official_website" | "bodacc" | "structured_public" | "naf_generated";
    descriptionConfidence: "high" | "medium" | "low";
    descriptionEvidence: string;
    activity: { code: string | null; label: string | null };
    services: Array<{ label: string; source: string; sourceUrl: string | null; confidence: "high" | "medium" | "low" }>;
    size: { workforceBand: string | null; workforceYear: number | string | null; companyCategory: string | null; establishmentCount: number; employerEstablishmentCount: number; source: string; sourceReferenceDate: string | null };
    signals: Array<{ label: string; detail: string | null; source: string; sourceUrl: string | null; referenceDate: string | null; confidence: "high" | "medium" | "low" }>;
    proofs: Array<{ label: string; detail: string; source: string; sourceUrl: string | null; referenceDate: string | null; confidence: "high" | "medium" | "low" }>;
    coverage: {
      observedSources: number;
      evidenceCount: number;
      generatedAt: string;
      sources?: Array<{ source: string; status: "ok" | "empty" | "unavailable"; detail: string | null; sourceUrl: string | null }>;
    };
  };
  statuses: Array<{ source: string; status: "ok" | "empty" | "unavailable"; detail?: string }>;
  officialProfile: {
    total: number;
    socialEconomy: boolean | null;
    missionCompany: boolean | null;
    associationId: string | null;
    companyCategory: string | null;
    companyCategoryYear: number | null;
    workforceBandCode: string | null;
    workforceBand: string | null;
    workforceYear: number | null;
    periodStartDate: string | null;
    lastProcessedAt: string | null;
    periodCount: number | null;
    establishmentCount: number;
    headOfficeCount: number;
    employerEstablishmentCount: number;
    datedWorkforceEstablishmentCount: number;
    sourceReferenceDate: string | null;
    source: string;
  };
  association: {
    total: number;
    activeCount: number;
    dissolvedCount: number;
    statusConflictCount: number;
    purposeCount: number;
    publicUtilityCount: number;
    identifierWarningCount: number;
    qualityWarningCount: number;
    sourceReferenceDate: string | null;
    sourceUrl: string;
    license: string;
    profiles: Array<{
      rnaId: string;
      formerId: string | null;
      siret: string | null;
      identifierStatus: "rna_exact_siret_match" | "rna_exact_no_siret" | "rna_exact_siret_mismatch";
      matchConfidence: number;
      publicUtilityId: string | null;
      creationDate: string | null;
      declarationDate: string | null;
      publicationDate: string | null;
      dissolutionDate: string | null;
      natureCode: string | null;
      groupType: string | null;
      title: string | null;
      shortTitle: string | null;
      purpose: string | null;
      purposeCodes: string[];
      website: string | null;
      status: "active" | "dissolved" | "conflicting" | "unknown";
      updatedAt: string | null;
      sourceReferenceDate: string;
      sourceUrl: string;
    }>;
  };
  annuaire: {
    total: number;
    financials: Array<{ year: string; revenue: number | null; netIncome: number | null }>;
    labels: string[];
    aidSignals: string[];
    agreements: string[];
    collectiveAgreementReported?: boolean;
    companyCategory?: string | null;
    workforceBand?: string | null;
    workforceYear?: string | null;
    naf25?: string | null;
    establishments?: number | null;
    openEstablishments?: number | null;
    dirigeants?: Array<{
      displayName: string;
      role: string;
      officerType: string;
      relatedSiren: string | null;
      sourceUpdatedAt: string | null;
    }>;
    dirigeantsSource?: string;
    dirigeantsIndexedSirens?: number;
    dirigeantsRequestedSirens?: number;
    dirigeantsRetrievedAt?: string | null;
    profileSource?: string;
    profileRetrievedAt?: string | null;
    relatedLegalEntities?: Array<{ siren: string; name: string; roleCount: number; roles: string[] }>;
    sourceReferenceDate?: string | null;
    sourceUrl?: string;
  };
  governanceNetwork?: {
    mode: "published_legal_mandates";
    nodes: Array<{ id: string; kind: "company" | "person" | "legal_entity"; label: string; siren: string | null; roles: string[] }>;
    edges: Array<{ id: string; source: string; target: string; role: string; sourceUpdatedAt: string | null }>;
    note: string;
  };
  trainingOrganizations: {
    total: number;
    displayedCount: number;
    guadeloupeCount: number;
    outsideCount: number;
    activeLocalCount: number;
    qualityCount: number;
    specialtyCount: number;
    metricsCount: number;
    qualityTrainingCount: number;
    qualitySkillsCount: number;
    qualityVaeCount: number;
    qualityApprenticeshipCount: number;
    earliestDeclarationDate: string | null;
    latestDeclarationDate: string | null;
    latestExerciseEndDate: string | null;
    truncated: boolean;
    sourceRowCount: number;
    matchedCompanyCount: number;
    sourceUpdatedAt: string | null;
    sourceUrl: string;
    license: string;
    profiles: Array<{
      id: string;
      siren: string;
      siret: string | null;
      matchScope: "active_local_establishment" | "company_other_establishment" | "exact_legal_unit";
      matchConfidence: number;
      registrationLocationScope: "guadeloupe" | "outside_guadeloupe" | "unknown";
      activityDeclarationNumber: string;
      previousActivityNumbers: string | null;
      postalCode: string | null;
      city: string | null;
      regionCode: string | null;
      isQualityCertified: boolean;
      qualityCategories: string[];
      lastDeclarationDate: string | null;
      exerciseStartDate: string | null;
      exerciseEndDate: string | null;
      specialties: Array<{ code: string | null; label: string | null }>;
      traineeCount: number | null;
      entrustedTraineeCount: number | null;
      trainerCount: number | null;
      resourceTitle: string;
      resourceUrl: string;
      resourceLastModified: string | null;
      sourceUpdatedAt: string;
      datasetUrl: string;
      license: string;
      licenseUrl: string;
    }>;
  };
  professionalEquality: {
    total: number;
    displayedCount: number;
    calculableCount: number;
    nonCalculableCount: number;
    directCount: number;
    uesCount: number;
    guadeloupeCount: number;
    earliestYear: number | null;
    latestYear: number | null;
    latestCalculableYear: number | null;
    latestScore: number | null;
    scoreDelta: number | null;
    sourceRowCount: number;
    matchedCompanyCount: number;
    sourceUpdatedAt: string | null;
    sourceUrl: string;
    egaproUrl: string;
    license: string;
    declarations: Array<{
      id: string;
      siren: string;
      declaringSiren: string;
      matchScope: "exact_declarant" | "ues_member";
      matchConfidence: number;
      referenceYear: number;
      structureType: "company" | "ues";
      workforceBand: string | null;
      uesName: string | null;
      uesMemberCount: number | null;
      declarationLocationScope: "guadeloupe" | "outside_guadeloupe";
      declaringRegion: string | null;
      declaringDepartment: string | null;
      declaringCountry: string | null;
      nafCode: string | null;
      nafLabel: string | null;
      indexScore: number | null;
      indexStatus: "calculated" | "not_calculable" | "not_applicable" | "invalid";
      indicators: Array<{
        key: string;
        label: string;
        score: number | null;
        maximum: number;
        status: "calculated" | "not_calculable" | "not_applicable" | "invalid";
      }>;
      resourceTitle: string;
      resourceUrl: string;
      resourceLastModified: string | null;
      sourceUpdatedAt: string;
      datasetUrl: string;
      egaproUrl: string;
      license: string;
      licenseUrl: string;
    }>;
  };
  collectiveAgreements: {
    total: number;
    displayedCount: number;
    agreementCount: number;
    agreementEstablishmentCount: number;
    substantiveAgreementCount: number;
    escapeAgreementCount: number;
    distinctIdccCount: number;
    multiIdccEstablishmentCount: number;
    titledAgreementCount: number;
    opcoAssignmentCount: number;
    assignedOpcoCount: number;
    opcoAnomalyCount: number;
    effectiveOpcoCount: number;
    effectiveOpcos: string[];
    crossSourceDifferenceCount: number;
    idccReferenceMonth: string | null;
    siroReferenceMonth: string | null;
    sourceRowCount: number;
    matchedCompanyCount: number;
    sourceUpdatedAt: string | null;
    siroSourceUpdatedAt: string | null;
    idccSourceUrl: string;
    siroSourceUrl: string;
    kaliSourceUrl: string;
    kaliVersion: string | null;
    license: string;
    establishments: Array<{
      siret: string;
      commune: string | null;
      isHeadOffice: boolean;
      employer: boolean | null;
      idccDifference: boolean;
      agreements: Array<{
        id: string;
        idcc: string;
        status: "declared_code" | "status_unspecified" | "company_agreement_unspecified" | "agreement_not_known" | "no_collective_agreement";
        label: string;
        title: string | null;
        shortTitle: string | null;
        kaliId: string | null;
        baseTextStatus: string | null;
        legifranceUrl: string | null;
        referenceMonth: string;
      }>;
      opco: {
        id: string;
        idcc: string | null;
        idccStatus: string;
        idccLabel: string | null;
        ownerOpco: string | null;
        managingOpco: string | null;
        effectiveOpco: string | null;
        status: string;
        referenceMonth: string;
      } | null;
    }>;
  };
  patents: {
    total: number;
    displayedCount: number;
    applicationCount: number;
    grantedCount: number;
    internationalCount: number;
    epoCount: number;
    titleCount: number;
    abstractCount: number;
    earliestApplicationDate: string | null;
    latestApplicationDate: string | null;
    applicationAuthorityCount: number;
    technologyCount: number;
    technologySectionCount: number;
    sections: Array<{ code: string; label: string; familyCount: number }>;
    truncated: boolean;
    sourceApplicantRows: number;
    matchedCompanyCount: number;
    indexedFamilyCount: number;
    indexedApplicationCount: number;
    applicantsSourceUpdatedAt: string | null;
    familiesSourceUpdatedAt: string | null;
    technologiesSourceUpdatedAt: string | null;
    applicantsSourceUrl: string;
    familiesSourceUrl: string;
    technologiesSourceUrl: string;
    license: string;
    scope: "national_legal_unit";
    families: Array<{
      id: string;
      familyDocdb: string;
      familyInpadoc: string | null;
      applicantNames: string[];
      applicationCount: number;
      firstPublicationDate: string | null;
      firstApplicationDate: string | null;
      epoApplication: boolean | null;
      internationalApplication: boolean | null;
      granted: boolean | null;
      firstGrantDate: string | null;
      title: string;
      abstract: string | null;
      technologyCount: number;
      sections: Array<{ code: string; label: string }>;
      classes: Array<{ code: string; label: string | null }>;
      subclasses: Array<{ code: string; label: string | null }>;
      scanrUrl: string;
      scope: "national_legal_unit";
      sourceUpdatedAt: string;
      datasetUrl: string;
      license: string;
      licenseUrl: string;
    }>;
  };
  financialRatios: {
    total: number;
    publicCount: number;
    partiallyConfidentialCount: number;
    completeCount: number;
    simplifiedCount: number;
    consolidatedCount: number;
    earliestClosingDate: string | null;
    latestClosingDate: string | null;
    matchedCompanyCount: number;
    indexedExerciseCount: number;
    sourceRowCount: number;
    sourceUpdatedAt: string | null;
    sourceUrl: string;
    license: string;
    scope: "national_legal_unit";
    definitions: Array<{
      field: string;
      label: string;
      unit: "EUR" | "percent" | "days" | "ratio";
      description: string | null;
      formulaCompleteOrConsolidated: string | null;
      formulaSimplified: string | null;
    }>;
    exercises: Array<{
      id: string;
      closingDate: string;
      statementType: "C" | "K" | "S";
      confidentiality: string;
      partiallyConfidential: boolean;
      dateQuality: "published" | "future_closing_date";
      metricCount: number;
      revenue: number | null;
      grossMargin: number | null;
      ebe: number | null;
      ebit: number | null;
      netIncome: number | null;
      debtRatio: number | null;
      liquidityRatio: number | null;
      assetAgeRatio: number | null;
      financialAutonomy: number | null;
      operatingWorkingCapitalRatio: number | null;
      interestCoverage: number | null;
      cashFlowToRevenue: number | null;
      repaymentCapacity: number | null;
      ebeMargin: number | null;
      currentPreTaxToRevenue: number | null;
      operatingWorkingCapitalDays: number | null;
      stockRotationDays: number | null;
      customerCreditDays: number | null;
      supplierCreditDays: number | null;
      sourceUpdatedAt: string;
      datasetUrl: string;
      license: string;
      licenseUrl: string;
    }>;
  };
  detailedFinancials: {
    total: number;
    partiallyConfidentialCount: number;
    earliestClosingDate: string | null;
    latestClosingDate: string | null;
    matchedCompanyCount: number;
    indexedStatementCount: number;
    rawCellCount: number;
    sourceUpdatedAt: string | null;
    sourceUrl: string;
    fullFormUrl: string;
    simplifiedFormUrl: string;
    license: string;
    scope: "national_legal_unit";
    statements: Array<{
      id: string;
      closingDate: string;
      statementType: "C" | "K" | "S";
      confidentiality: string;
      partiallyConfidential: boolean;
      dateQuality: "published" | "future_closing_date";
      cellCount: number;
      metricCount: number;
      balanceSheetTotal: number | null;
      equity: number | null;
      provisions: number | null;
      financialDebt: number | null;
      totalDebt: number | null;
      fixedAssetsGross: number | null;
      fixedAssetsNet: number | null;
      currentAssetsGross: number | null;
      currentAssetsNet: number | null;
      inventoryGross: number | null;
      inventoryNet: number | null;
      tradeReceivablesGross: number | null;
      tradeReceivablesNet: number | null;
      cashAndSecuritiesNet: number | null;
      tradePayables: number | null;
      taxSocialDebt: number | null;
      capital: number | null;
      revenue: number | null;
      operatingResult: number | null;
      currentPreTaxResult: number | null;
      netIncome: number | null;
      personnelCosts: number | null;
      externalPurchases: number | null;
      taxes: number | null;
      sourceUpdatedAt: string;
      datasetUrl: string;
      resourceUrl: string;
      license: string;
      licenseUrl: string;
    }>;
  };
  environmentalCompliance: {
    total: number;
    displayedCount: number;
    activeSiretCount: number;
    authorizationCount: number;
    registrationCount: number;
    sevesoCount: number;
    iedCount: number;
    nationalPriorityCount: number;
    latestSourceUpdate: string | null;
    latestInspectionDate: string | null;
    inspectionCount: number;
    rubricCount: number;
    documentCount: number;
    indexedInstallationCount: number;
    matchedCompanyCount: number;
    sourceUpdatedAt: string | null;
    sourceUrl: string;
    license: string;
    truncated: boolean;
    installations: Array<{
      id: string;
      aiotCode: string;
      siret: string;
      matchScope: "exact_active_siret" | "exact_company_historical_siret";
      address: string | null;
      postalCode: string | null;
      communeCode: string | null;
      commune: string | null;
      nafDivision: string | null;
      longitude: number | null;
      latitude: number | null;
      categories: string[];
      nationalPriority: boolean;
      sevesoStatus: string | null;
      ied: boolean;
      activityStatus: string | null;
      inspectionService: string | null;
      regime: string | null;
      sourceUpdatedAt: string | null;
      detailUrl: string;
      sourceUrl: string;
      license: string;
      licenseUrl: string;
      inspections: Array<{
        id: string;
        inspectionDate: string | null;
        documentDate: string | null;
        documentType: string | null;
        documentUrl: string | null;
      }>;
      rubrics: Array<{
        id: string;
        number: string;
        nature: string | null;
        paragraph: string | null;
        authorizedRegime: string | null;
        totalQuantity: string | null;
        unit: string | null;
        reasonDate: string | null;
      }>;
      documents: Array<{
        id: string;
        documentDate: string | null;
        documentType: string | null;
        documentUrl: string | null;
      }>;
    }>;
  };
  publicGrants: {
    total: number;
    displayedCount: number;
    totalAmount: number | null;
    earliestDate: string | null;
    latestDate: string | null;
    authorityCount: number;
    sourceCount: number;
    activeEstablishmentCount: number;
    historicalEstablishmentCount: number;
    associationMatchCount: number;
    truncated: boolean;
    catalogDatasetCount: number;
    openDatasetCount: number;
    importedResourceCount: number;
    sourceReferenceDate: string | null;
    importedAt: string | null;
    schemaUrl: string;
    catalogUrl: string;
    grants: Array<{
      id: string;
      siret: string | null;
      rnaId: string | null;
      beneficiaryName: string;
      awardingAuthority: string | null;
      awardingAuthoritySiret: string | null;
      conventionDate: string | null;
      decisionReference: string | null;
      purpose: string;
      amount: number;
      nature: string | null;
      paymentConditions: string | null;
      paymentPeriod: string | null;
      raeId: string | null;
      euNotification: boolean | null;
      subsidyPercentage: number | null;
      aidScheme: string | null;
      matchMethod: "exact_active_siret" | "exact_company_siret" | "exact_unambiguous_rna" | "exact_active_siret_rna" | "exact_company_siret_rna";
      matchConfidence: number;
      beneficiaryScope: "active_establishment" | "association" | "company_historical_establishment";
      sourceReferenceDate: string | null;
      sourceLastModified: string | null;
      sourceOccurrenceCount: number;
      datasetTitle: string | null;
      datasetUrl: string | null;
      resourceTitle: string | null;
      resourceUrl: string | null;
      license: string | null;
      licenseUrl: string | null;
    }>;
  };
  ademeAids: {
    total: number;
    displayedCount: number;
    totalAmount: number | null;
    activeLocalCount: number;
    activeLocalAmount: number | null;
    companyScopeCount: number;
    companyScopeAmount: number | null;
    schemeCount: number;
    earliestDate: string | null;
    latestDate: string | null;
    truncated: boolean;
    sourceRowCount: number;
    sourceUpdatedAt: string | null;
    sourceUrl: string;
    dataGouvUrl: string;
    license: string;
    aids: Array<{
      id: string;
      siret: string;
      scope: "active_local_establishment" | "company_historical_establishment";
      matchConfidence: number;
      awardingAuthority: string | null;
      awardingAuthoritySiret: string | null;
      conventionDate: string | null;
      decisionReference: string | null;
      beneficiaryName: string;
      purpose: string;
      aidScheme: string | null;
      amount: number;
      nature: string | null;
      paymentConditions: string | null;
      paymentPeriod: string | null;
      raeId: string | null;
      euNotification: boolean | null;
      sourceUpdatedAt: string;
      sourceUrl: string;
      dataGouvUrl: string;
      license: string;
      licenseUrl: string;
    }>;
  };
  fondsVert: {
    total: number;
    displayedCount: number;
    totalAmount: number | null;
    guadeloupeCount: number;
    guadeloupeAmount: number | null;
    outsideCount: number;
    outsideAmount: number | null;
    unknownLocationCount: number;
    activeLocalCount: number;
    activeLocalAmount: number | null;
    schemeCount: number;
    earliestYear: number | null;
    latestYear: number | null;
    truncated: boolean;
    sourceRowCount: number;
    resourceCount: number;
    excludedResourceCount: number;
    sourceUpdatedAt: string | null;
    sourceUrl: string;
    license: string;
    projects: Array<{
      id: string;
      year: number;
      siren: string;
      siret: string | null;
      beneficiaryIdentifier: string;
      identifierType: "siren" | "siret";
      matchScope: "active_local_establishment" | "company_other_establishment" | "exact_legal_unit";
      matchConfidence: number;
      projectLocationScope: "guadeloupe" | "outside_guadeloupe" | "unknown";
      projectName: string;
      projectSummary: string | null;
      committedAmount: number;
      beneficiaryName: string;
      beneficiaryLegalForm: string | null;
      dossierNumber: string | null;
      commitmentNumber: string | null;
      operatorNumber: string | null;
      operator: string | null;
      scheme: string | null;
      axis: string | null;
      region: string | null;
      department: string | null;
      departmentCode: string | null;
      commune: string | null;
      communeCode: string | null;
      resourceTitle: string;
      resourceUrl: string;
      resourceLastModified: string | null;
      sourceUpdatedAt: string;
      datasetUrl: string;
      license: string;
      licenseUrl: string;
    }>;
  };
  franceRelance: {
    total: number;
    displayedCount: number;
    guadeloupeCount: number;
    outsideCount: number;
    unknownLocationCount: number;
    activeLocalCount: number;
    descriptionCount: number;
    co2MetricCount: number;
    measureCount: number;
    sectorCount: number;
    earliestDate: string | null;
    latestDate: string | null;
    truncated: boolean;
    sourceRowCount: number;
    sourceUpdatedAt: string | null;
    sourceUrl: string;
    portalUrl: string;
    license: string;
    individualAmountsAvailable: boolean;
    projects: Array<{
      id: string;
      siren: string;
      siret: string | null;
      beneficiaryIdentifier: string;
      identifierType: "siren" | "siret";
      matchScope: "active_local_establishment" | "company_other_establishment" | "exact_legal_unit";
      matchConfidence: number;
      projectLocationScope: "guadeloupe" | "outside_guadeloupe" | "unknown";
      beneficiaryName: string;
      companyType: string | null;
      recoveryAxis: string | null;
      measure: string;
      measureLabel: string | null;
      projectDescription: string | null;
      sector: string | null;
      expectedCo2Tonnes: number | null;
      updateDate: string | null;
      region: string | null;
      department: string | null;
      departmentCode: string | null;
      commune: string | null;
      postalCode: string | null;
      latitude: number | null;
      longitude: number | null;
      resourceTitle: string;
      resourceUrl: string;
      resourceLastModified: string | null;
      sourceUpdatedAt: string;
      datasetUrl: string;
      portalUrl: string;
      license: string;
      licenseUrl: string;
    }>;
  };
  osmPresence: {
    total: number;
    websites: string[];
    emails?: string[];
    phones: string[];
    categories: string[];
    openingHoursCount: number;
    accessibilityCount: number;
    socialProfilesCount: number;
    activeMatchesCount: number;
    staleReferencesCount: number;
    sourceReferenceDate: string | null;
    importedAt: string | null;
    license: string;
    attribution: string;
    sourceUrl: string;
    profiles: Array<{
      id: string;
      siret: string | null;
      name: string | null;
      brand: string | null;
      operator: string | null;
      category: string | null;
      website: string | null;
      publicEmail: string | null;
      phone: string | null;
      openingHours: string | null;
      wheelchair: string | null;
      internetAccess: string | null;
      address: string | null;
      description: string | null;
      latitude: number | null;
      longitude: number | null;
      services: Array<{ key: string; value: string }>;
      socialProfiles: Array<{ platform: string; url: string }>;
      sourceUrl: string;
      establishmentStatus: "active_match" | "company_match" | "not_in_active_stock";
      matchConfidence: number;
      dataConfidence: number;
    }>;
  };
  websites: {
    total: number;
    accessibleSitesCount: number;
    descriptionsCount: number;
    offeringsCount: number;
    socialProfilesCount: number;
    blockedCount: number;
    errorCount: number;
    generatedAt: string | null;
    methodology: string;
    descriptions: Array<{
      text: string;
      source: string | null;
      confidence: number | null;
      siteName: string | null;
      url: string | null;
      establishmentStatus: "active_match" | "company_match" | "not_in_active_stock";
      fetchedAt: string;
    }>;
    offerings: Array<{
      name: string;
      source: string;
      confidence: number;
      siteName: string | null;
      url: string | null;
      establishmentStatus: "active_match" | "company_match" | "not_in_active_stock";
    }>;
    sites: Array<{
      id: string;
      siret: string | null;
      sourceName: string | null;
      sourceOrigin: string;
      inputUrl: string | null;
      url: string | null;
      hostname: string | null;
      robotsStatus: string;
      fetchStatus: string;
      httpStatus: number | null;
      title: string | null;
      description: string | null;
      descriptionSource: string | null;
      offerings: Array<{ name: string; source: string; confidence: number }>;
      socialProfiles: Array<{ platform: string; url: string }>;
      structuredTypes: string[];
      language: string | null;
      restricted: boolean;
      lastModified: string | null;
      fetchedAt: string;
      errorDetail: string | null;
      establishmentStatus: "active_match" | "company_match" | "not_in_active_stock";
      descriptionConfidence: number | null;
    }>;
  };
  rge: {
    total: number;
    activeCount: number;
    historicalCount: number;
    domains: string[];
    organizations: string[];
    truncated: boolean;
    sourceUpdatedAt: string | null;
    sourceUrl: string;
    license: string;
    qualifications: Array<{
      id: string;
      siret: string | null;
      companyName: string | null;
      qualificationCode: string | null;
      qualificationName: string;
      certificateName: string | null;
      domains: string[];
      metaDomain: string | null;
      organization: string | null;
      forIndividuals: boolean;
      startDate: string | null;
      endDate: string | null;
      status: "active" | "historical";
      certificateUrl: string | null;
      updatedAt: string | null;
      confidence: number;
    }>;
  };
  bodacc: {
    total: number;
    activities: string[];
    cacheStatus?: "snapshot" | "live";
    retrievedAt?: string | null;
    sourceUrl?: string;
    events: Array<{ id: string; date: string | null; title: string; city: string | null; legalForm: string | null; capital: number | null; capitalCurrency: string; url: string | null }>;
  };
  publicContracts: {
    total: number;
    totalAmount: number | null;
    contracts: Array<{ id: string; title: string; date: string | null; amount: number | null; durationMonths: number | null; buyer: string | null; cpvLabel: string | null; executionPlace: string | null; sourceUrl: string }>;
  };
  recruitment: {
    status: "ok" | "empty" | "unavailable";
    total: number;
    identifierMatchedCount: number;
    retrievedAt: string | null;
    sourceUrl: string;
    detail: string | null;
    offers: Array<{ id: string; title: string; contract: string | null; location: string | null; createdAt: string | null; updatedAt: string | null; duration: string | null; experience: string | null; sourceUrl: string; matchedBy: "siren" }>;
  };
  press: {
    total: number;
    cacheStatus?: string;
    fetchedAt?: string | null;
    cacheError?: string | null;
    mentions: Array<{ title: string; url: string; domain: string | null; publishedAt: string | null; sourceCountry: string | null; source?: string; confidence: number }>;
  };
};

type Tab = "overview" | "governance" | "association" | "services" | "training" | "equality" | "agreements" | "patents" | "financials" | "environment" | "profile" | "grants" | "ademeAids" | "fondsVert" | "franceRelance" | "qualifications" | "presence" | "events" | "contracts" | "recruitment" | "press";

function formatDate(value: string | null) {
  if (!value) return "Date non renseignée";
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})T/);
  const normalized = compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(date);
}

function formatMonth(value: string | null) {
  if (!value) return "Non renseigné";
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) return formatDate(value);
  return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(new Date(`${value}-01T12:00:00Z`));
}

function formatCurrency(value: number | null, currency = "EUR") {
  if (value === null) return "Non renseigné";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

function formatNumber(value: number, maximumFractionDigits = 1) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits }).format(value);
}

function formatFinancialValue(value: number | null, unit: "percent" | "days" | "ratio") {
  if (value === null) return "Non renseigné";
  const formatted = formatNumber(value, 2);
  if (unit === "percent") return `${formatted} %`;
  if (unit === "days") return `${formatted} jours`;
  return formatted;
}

function balanceShare(value: number | null, total: number | null) {
  if (value === null || total === null || total <= 0 || value <= 0) return "0%";
  return `${Math.min(100, Math.max(2, value / total * 100))}%`;
}

function statementTypeLabel(value: "C" | "K" | "S") {
  if (value === "C") return "Complet";
  if (value === "K") return "Consolidé";
  return "Simplifié";
}

function formatOsmValue(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toLocaleUpperCase("fr"));
}

function accessibilityLabel(value: string | null) {
  if (value === "yes") return "Accessible en fauteuil roulant";
  if (value === "limited") return "Accessibilité partielle";
  if (value === "no") return "Non accessible en fauteuil roulant";
  return value ? `Accessibilité publiée : ${value}` : null;
}

function establishmentStatusLabel(value: Intelligence["osmPresence"]["profiles"][number]["establishmentStatus"]) {
  if (value === "active_match") return "SIRET actif SIRENE";
  if (value === "not_in_active_stock") return "SIRET absent du stock actif";
  return "SIREN exact";
}

function descriptionSourceLabel(value: string | null) {
  if (value === "jsonld") return "Donnée structurée JSON-LD";
  if (value === "meta_description") return "Meta description";
  if (value === "open_graph") return "Open Graph";
  return "Contenu du site";
}

function websiteStatusLabel(value: string) {
  const labels: Record<string, string> = {
    ok: "Analysé",
    robots_disallowed: "Refus robots.txt",
    robots_unreachable: "Robots inaccessible",
    skipped_platform: "Plateforme externe",
    redirected_platform: "Redirection externe",
    meta_robots_restricted: "Réutilisation interdite",
    http_error: "Erreur HTTP",
    fetch_error: "Site inaccessible",
    invalid_or_unsafe_url: "URL invalide ou non publique",
    non_html: "Contenu non HTML"
  };
  return labels[value] ?? value;
}

function associationGroupLabel(value: string | null) {
  if (value === "S") return "Association simple";
  if (value === "U") return "Union";
  if (value === "F") return "Fédération";
  return "Groupement non renseigné";
}

function associationNatureLabel(value: string | null) {
  if (value === "D") return "Association déclarée";
  if (value === "R") return "Association reconnue d’utilité publique";
  if (value === "A") return "Association d’assistance ou de bienfaisance";
  if (value === "U") return "Union d’associations";
  if (value === "I") return "Nature associative particulière";
  return "Nature non renseignée";
}

function associationIdentifierLabel(value: Intelligence["association"]["profiles"][number]["identifierStatus"]) {
  if (value === "rna_exact_siret_match") return "RNA et SIRET concordants";
  if (value === "rna_exact_siret_mismatch") return "SIRET RNA à vérifier";
  return "RNA exact · SIRET absent du RNA";
}

function grantScopeLabel(value: Intelligence["publicGrants"]["grants"][number]["beneficiaryScope"]) {
  if (value === "active_establishment") return "SIRET actif concordant";
  if (value === "association") return "RNA exact non ambigu";
  return "Ancien SIRET ou établissement hors stock actif local";
}

function ademeAidScopeLabel(value: Intelligence["ademeAids"]["aids"][number]["scope"]) {
  return value === "active_local_establishment" ? "Établissement actif en Guadeloupe" : "Autre établissement ou SIRET historique de l’unité légale";
}

function fondsVertLocationLabel(value: Intelligence["fondsVert"]["projects"][number]["projectLocationScope"]) {
  if (value === "guadeloupe") return "Projet localisé en Guadeloupe";
  if (value === "outside_guadeloupe") return "Projet localisé hors Guadeloupe";
  return "Localisation du projet non renseignée";
}

function fondsVertMatchLabel(value: Intelligence["fondsVert"]["projects"][number]["matchScope"]) {
  if (value === "active_local_establishment") return "SIRET actif guadeloupéen exact";
  if (value === "company_other_establishment") return "Autre SIRET exact de l’unité légale";
  return "SIREN exact de l’unité légale";
}

function franceRelanceLocationLabel(value: Intelligence["franceRelance"]["projects"][number]["projectLocationScope"]) {
  if (value === "guadeloupe") return "Projet localisé en Guadeloupe";
  if (value === "outside_guadeloupe") return "Projet localisé hors Guadeloupe";
  return "Localisation du projet non renseignée";
}

function franceRelanceMatchLabel(value: Intelligence["franceRelance"]["projects"][number]["matchScope"]) {
  if (value === "active_local_establishment") return "SIRET actif guadeloupéen exact";
  if (value === "company_other_establishment") return "Autre SIRET exact de l’unité légale";
  return "SIREN exact de l’unité légale";
}

function trainingLocationLabel(value: Intelligence["trainingOrganizations"]["profiles"][number]["registrationLocationScope"]) {
  if (value === "guadeloupe") return "Déclaration rattachée à la Guadeloupe";
  if (value === "outside_guadeloupe") return "Déclaration rattachée hors Guadeloupe";
  return "Territoire de déclaration non renseigné";
}

function trainingMatchLabel(value: Intelligence["trainingOrganizations"]["profiles"][number]["matchScope"]) {
  if (value === "active_local_establishment") return "SIRET actif guadeloupéen exact";
  if (value === "company_other_establishment") return "Autre SIRET exact de l’unité légale";
  return "SIREN exact de l’unité légale";
}

function equalityMatchLabel(value: Intelligence["professionalEquality"]["declarations"][number]["matchScope"]) {
  return value === "exact_declarant" ? "SIREN déclarant exact" : "Membre d’UES explicitement publié";
}

function equalityStatusLabel(value: Intelligence["professionalEquality"]["declarations"][number]["indexStatus"]) {
  if (value === "not_calculable") return "NC";
  if (value === "invalid") return "Valeur écartée";
  return "Non applicable";
}

export function BusinessIntelligencePanel({ siren }: { siren: string }) {
  const [data, setData] = useState<Intelligence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [financialStatementType, setFinancialStatementType] = useState<"C" | "K" | "S" | null>(null);
  const [financialExerciseId, setFinancialExerciseId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const financialExercises = data ? [
    ...data.financialRatios.exercises,
    ...data.detailedFinancials.statements
      .filter((statement) => statement.dateQuality === "published" && !data.financialRatios.exercises.some((exercise) => exercise.closingDate === statement.closingDate && exercise.statementType === statement.statementType))
      .map((statement) => ({
        id: `detail:${statement.id}`,
        closingDate: statement.closingDate,
        statementType: statement.statementType,
        confidentiality: statement.confidentiality,
        partiallyConfidential: statement.partiallyConfidential,
        dateQuality: statement.dateQuality,
        metricCount: statement.metricCount,
        revenue: statement.revenue,
        grossMargin: null,
        ebe: null,
        ebit: statement.operatingResult,
        netIncome: statement.netIncome,
        debtRatio: null,
        liquidityRatio: null,
        assetAgeRatio: null,
        financialAutonomy: null,
        operatingWorkingCapitalRatio: null,
        interestCoverage: null,
        cashFlowToRevenue: null,
        repaymentCapacity: null,
        ebeMargin: null,
        currentPreTaxToRevenue: null,
        operatingWorkingCapitalDays: null,
        stockRotationDays: null,
        customerCreditDays: null,
        supplierCreditDays: null,
        sourceUpdatedAt: statement.sourceUpdatedAt,
        datasetUrl: statement.datasetUrl,
        license: statement.license,
        licenseUrl: statement.licenseUrl
      }))
  ] : [];
  const availableFinancialTypes = (["C", "S", "K"] as const).filter((type) => financialExercises.some((exercise) => exercise.statementType === type && exercise.dateQuality === "published"));
  const activeFinancialType = financialStatementType && availableFinancialTypes.includes(financialStatementType)
    ? financialStatementType
    : availableFinancialTypes[0] ?? null;
  const typeFinancialExercises = data && activeFinancialType
    ? financialExercises.filter((exercise) => exercise.statementType === activeFinancialType && exercise.dateQuality === "published")
      .sort((left, right) => right.closingDate.localeCompare(left.closingDate))
    : [];
  const activeFinancialExercise = typeFinancialExercises.find((exercise) => exercise.id === financialExerciseId) ?? typeFinancialExercises[0] ?? null;
  const activeDetailedFinancialStatement = data && activeFinancialExercise
    ? data.detailedFinancials.statements.find((statement) => statement.dateQuality === "published"
      && statement.closingDate === activeFinancialExercise.closingDate
      && statement.statementType === activeFinancialExercise.statementType) ?? null
    : null;
  const financialTrend = [...typeFinancialExercises].reverse();
  const financialRevenueMaximum = Math.max(1, ...financialTrend.map((exercise) => Math.max(0, exercise.revenue ?? 0)));
  const timeline = data?.timeline ?? [];
  const osmEmails = data?.osmPresence.emails ?? [];

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/companies/${siren}/intelligence`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Chargement impossible (${response.status})`);
        return response.json() as Promise<Intelligence>;
      })
      .then(setData)
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setError(reason.message);
      });
    return () => controller.abort();
  }, [reload, siren]);

  return (
    <section className="bi-section" aria-labelledby="bi-title">
      <div className="bi-heading">
        <div>
          <span className="panel-kicker"><Activity size={15} aria-hidden="true" /> Intelligence entreprise</span>
          <h2 id="bi-title">Signaux business vérifiables</h2>
          <p className="muted">Profil officiel, finances, subventions, présence terrain, événements légaux, commande publique et mentions dans les médias.</p>
        </div>
        {data ? <div className="source-health" aria-label="État des sources">
          {data.statuses.map((status) => <span key={status.source} className="source-pill" data-status={status.status} title={status.detail}>{status.source}</span>)}
        </div> : null}
      </div>

      {!data && !error ? <div className="bi-loading" aria-live="polite">
        <RefreshCw className="spin" size={20} aria-hidden="true" /> Consolidation des sources publiques…
      </div> : null}
      {error ? <div className="bi-error" role="alert">
        <CircleAlert size={18} aria-hidden="true" />
        <span>{error}</span>
        <button type="button" className="button" onClick={() => { setError(null); setData(null); setReload((value) => value + 1); }}>Réessayer</button>
      </div> : null}

      {data ? <>
        <div className="bi-metrics">
          <div><Scale size={18} aria-hidden="true" /><strong>{data.bodacc.total}</strong><span>annonces BODACC</span></div>
          <div><Landmark size={18} aria-hidden="true" /><strong>{data.publicContracts.total}</strong><span>marchés publics</span></div>
          <div><Building2 size={18} aria-hidden="true" /><strong>{formatCurrency(data.publicContracts.totalAmount)}</strong><span>montant publié</span></div>
          <div><Newspaper size={18} aria-hidden="true" /><strong>{data.press.total}</strong><span>mentions média trouvées</span></div>
        </div>

        <div className="segmented-tabs" role="tablist" aria-label="Données d’intelligence entreprise">
          {([ 
            ["overview", "Synthèse"], ["governance", "Gouvernance"], ...(data.association.total ? [["association", "Association"]] : []), ["services", "Prestations"], ...(data.trainingOrganizations.total ? [["training", "Formation"]] : []), ...(data.professionalEquality.total ? [["equality", "Égalité F/H"]] : []), ...(data.collectiveAgreements.total ? [["agreements", "Conventions & OPCO"]] : []), ...(data.patents.total ? [["patents", "Brevets & innovation"]] : []), ...(data.financialRatios.total || data.detailedFinancials.total ? [["financials", "Analyse financière"]] : []), ...(data.environmentalCompliance.total ? [["environment", "Environnement & ICPE"]] : []), ["profile", data.financialRatios.total || data.detailedFinancials.total ? "Profil & labels" : "Finances & labels"], ...(data.publicGrants.total ? [["grants", "Subventions publiques"]] : []), ...(data.ademeAids.total ? [["ademeAids", "Aides ADEME"]] : []), ...(data.fondsVert.total ? [["fondsVert", "Fonds vert"]] : []), ...(data.franceRelance.total ? [["franceRelance", "France Relance"]] : []), ["qualifications", "Qualifications"], ["presence", "Présence locale"], ["events", "Événements"], ["contracts", "Marchés publics"], ["recruitment", "Recrutement"], ["press", "Presse"]
          ] as Array<[Tab, string]>).map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>{label}</button>
          ))}
        </div>

        <div className="bi-content" role="tabpanel">
          {tab === "overview" ? <div className="bi-overview">
            <div className="official-overview-main">
              {data.companyProfile ? <section className="profile-readout" aria-labelledby="profile-readout-title">
                <div className="bi-subheading">
                  <div>
                    <h3 id="profile-readout-title">Profil d’activité consolidé</h3>
                    <p>Lecture factuelle des sources publiques rattachées par identifiant. Les services sont listés uniquement lorsqu’ils sont explicitement observés.</p>
                  </div>
                  <span className="official-reference">{data.companyProfile.coverage.observedSources} sources observées</span>
                </div>
                <div className="profile-readout-grid">
                  <div className="profile-readout-summary">
                    <span className="detail-eyebrow">Description</span>
                    <p className="profile-summary-text">{data.companyProfile.summary}</p>
                    <p className="small muted">{data.companyProfile.descriptionEvidence} Source : {data.companyProfile.descriptionSource === "official_website" ? "site professionnel public" : data.companyProfile.descriptionSource === "bodacc" ? "BODACC" : data.companyProfile.descriptionSource === "naf_generated" ? "activité NAF" : "donnée structurée publique"}. Confiance : {data.companyProfile.descriptionConfidence}.</p>
                  </div>
                  <dl className="profile-readout-size">
                    <div><dt>Activité principale</dt><dd>{data.companyProfile.activity.label ?? "Non renseignée"}{data.companyProfile.activity.code ? ` · ${data.companyProfile.activity.code}` : ""}</dd></div>
                    <div><dt>Effectif publié</dt><dd>{data.companyProfile.size.workforceBand ?? "Non renseigné"}{data.companyProfile.size.workforceYear ? ` · ${data.companyProfile.size.workforceYear}` : ""}</dd></div>
                    <div><dt>Catégorie</dt><dd>{data.companyProfile.size.companyCategory ?? "Non renseignée"}</dd></div>
                    <div><dt>Implantations actives</dt><dd>{data.companyProfile.size.establishmentCount} · {data.companyProfile.size.employerEstablishmentCount} employeur(s) déclaré(s)</dd></div>
                  </dl>
                </div>
                {data.companyProfile.services.length ? <div className="profile-readout-block">
                  <span className="detail-eyebrow">Services et spécialités observés</span>
                  <div className="profile-chip-list">{data.companyProfile.services.map((service) => <span className="profile-chip" key={`${service.source}-${service.label}`} title={`${service.source} · confiance ${service.confidence}`}>{service.label}</span>)}</div>
                </div> : <p className="small muted profile-empty">Aucun service explicite n’a été retrouvé. La fiche conserve uniquement l’activité déclarée.</p>}
                {data.companyProfile.signals.length ? <div className="profile-readout-block">
                  <span className="detail-eyebrow">Signaux vérifiables</span>
                  <div className="profile-signal-list">{data.companyProfile.signals.slice(0, 10).map((signal) => <span className="profile-signal" key={`${signal.source}-${signal.label}`} title={`${signal.source}${signal.referenceDate ? ` · ${formatDate(signal.referenceDate)}` : ""}`}>{signal.label}{signal.detail ? ` · ${signal.detail}` : ""}</span>)}</div>
                </div> : null}
                <details className="profile-proof-details">
                  <summary>Voir les preuves et références</summary>
                  <div className="profile-proof-list">{data.companyProfile.proofs.map((proof) => <div key={`${proof.source}-${proof.label}`}><strong>{proof.label}</strong><span>{proof.detail}</span><small>{proof.source} · {formatDate(proof.referenceDate)} · confiance {proof.confidence}{proof.sourceUrl ? <> · <a href={proof.sourceUrl} target="_blank" rel="noopener noreferrer">source</a></> : null}</small></div>)}</div>
                </details>
                {data.companyProfile.coverage.sources?.length ? <details className="profile-proof-details profile-coverage-details">
                  <summary>Voir la couverture par source</summary>
                  <div className="profile-coverage-list">
                    {data.companyProfile.coverage.sources.map((source) => <div key={source.source} className="profile-coverage-row" data-status={source.status}>
                      <span className="profile-coverage-status" aria-hidden="true" />
                      <strong>{source.source}</strong>
                      <span>{source.status === "ok" ? "Donnée trouvée" : source.status === "empty" ? "Aucun résultat rattaché" : "Fournisseur indisponible"}</span>
                      {source.sourceUrl ? <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={`Ouvrir la source ${source.source}`}>Source <ExternalLink size={12} aria-hidden="true" /></a> : null}
                    </div>)}
                  </div>
                </details> : null}
              </section> : null}
              <section className="official-profile" aria-labelledby="official-profile-title">
                <div className="bi-subheading">
                  <div>
                    <h3 id="official-profile-title">Profil officiel SIRENE</h3>
                    <p>Situation courante de l’unité légale et de ses établissements actifs.</p>
                  </div>
                  <span className="official-reference">Référence {formatDate(data.officialProfile.sourceReferenceDate)}</span>
                </div>
                {data.officialProfile.socialEconomy || data.officialProfile.missionCompany || data.officialProfile.associationId ? <div className="official-badges" aria-label="Qualités administratives publiées">
                  {data.officialProfile.socialEconomy ? <span><ShieldCheck size={14} aria-hidden="true" /> Économie sociale et solidaire</span> : null}
                  {data.officialProfile.missionCompany ? <span><ShieldCheck size={14} aria-hidden="true" /> Société à mission</span> : null}
                  {data.officialProfile.associationId ? <span><Building2 size={14} aria-hidden="true" /> RNA {data.officialProfile.associationId}</span> : null}
                </div> : null}
                <div className="official-metrics">
                  <div><Building2 size={17} aria-hidden="true" /><strong>{data.officialProfile.establishmentCount}</strong><span>établissements actifs</span></div>
                  <div><MapPin size={17} aria-hidden="true" /><strong>{data.officialProfile.headOfficeCount}</strong><span>siège identifié</span></div>
                  <div><Activity size={17} aria-hidden="true" /><strong>{data.officialProfile.employerEstablishmentCount}</strong><span>employeurs déclarés</span></div>
                  <div><Clock3 size={17} aria-hidden="true" /><strong>{data.officialProfile.periodCount ?? "—"}</strong><span>périodes SIRENE</span></div>
                </div>
                <dl className="official-facts">
                  <div><dt>Catégorie d’entreprise</dt><dd>{data.officialProfile.companyCategory ?? "Non renseignée"}{data.officialProfile.companyCategoryYear ? ` · ${data.officialProfile.companyCategoryYear}` : ""}</dd></div>
                  <div><dt>Tranche d’effectif</dt><dd>{data.officialProfile.workforceBand ?? "Non renseignée"}{data.officialProfile.workforceYear ? ` · ${data.officialProfile.workforceYear}` : ""}</dd></div>
                  <div><dt>Début de la situation courante</dt><dd>{formatDate(data.officialProfile.periodStartDate)}</dd></div>
                  <div><dt>Dernier traitement SIRENE</dt><dd>{formatDate(data.officialProfile.lastProcessedAt)}</dd></div>
                </dl>
                <p className="small muted official-caveat">Le caractère employeur est déclaratif. Une valeur nulle ou négative ne permet pas de conclure à l’absence actuelle de salariés.</p>
              </section>
              <section className="official-activity">
              <h3>Activité déclarée</h3>
              {data.bodacc.activities.length ? data.bodacc.activities.map((activity) => <p key={activity}>{activity}</p>) : <p className="muted">Aucune description d’activité publiée au BODACC n’a été trouvée.</p>}
              </section>
              <section className="official-activity company-timeline" aria-labelledby="company-timeline-title">
                <div className="bi-subheading">
                  <div>
                    <h3 id="company-timeline-title">Chronologie des signaux publics</h3>
                    <p>Événements datés rattachés par identifiant ou par correspondance média documentée. Cette chronologie ne constitue pas un jugement sur l’activité actuelle.</p>
                  </div>
                  <span className="official-reference">{timeline.length} signaux</span>
                </div>
                {timeline.length ? <div className="bi-list">
                  {timeline.slice(0, 10).map((event) => <article key={event.id} className="bi-row">
                    <div className={`timeline-dot ${event.source === "DECP" ? "contract" : event.source === "Presse" || event.source === "Google News RSS" || event.source === "GDELT" ? "press" : ""}`} aria-hidden="true" />
                    <div>
                      <div className="bi-row-meta"><span>{formatDate(event.date)}</span><span>{event.source} · confiance {Math.round(event.confidence * 100)} %</span></div>
                      <h3>{event.label}</h3>
                      {event.detail ? <p>{event.detail}</p> : null}
                      {event.sourceUrl ? <a href={event.sourceUrl} target="_blank" rel="noopener noreferrer">Voir la source <ExternalLink size={14} aria-hidden="true" /></a> : null}
                    </div>
                  </article>)}
                </div> : <p className="empty-state compact">Aucun signal daté suffisamment rattaché n’est disponible dans les sources consultées.</p>}
              </section>
            </div>
            <aside>
              <h3>Qualité des données</h3>
              <p>{data.methodology}</p>
              <p className="small muted">Actualisé le {formatDate(data.retrievedAt)}. Une absence de résultat ne prouve pas une absence d’activité.</p>
            </aside>
          </div> : null}

          {tab === "governance" ? <div className="governance-layout">
            <div className="governance-main">
              <div className="bi-subheading">
                <div>
                  <h3><Users size={18} aria-hidden="true" /> Mandats et gouvernance publiée</h3>
                  <p>Personnes et personnes morales déclarées comme dirigeants ou mandataires dans le registre accessible via l’Annuaire des Entreprises.</p>
                </div>
                {data.annuaire.sourceUrl ? <a href={data.annuaire.sourceUrl} target="_blank" rel="noopener noreferrer">Source officielle <ExternalLink size={14} aria-hidden="true" /></a> : null}
              </div>
              <p className="small muted">Source active : {data.annuaire.dirigeantsSource ?? "API Recherche d’entreprises"}. Cache local exact : {data.annuaire.dirigeantsIndexedSirens ?? 0} SIREN indexés sur {data.annuaire.dirigeantsRequestedSirens ?? 0}{data.annuaire.dirigeantsRetrievedAt ? ` · importé le ${formatDate(data.annuaire.dirigeantsRetrievedAt)}` : ""}.</p>
              {!data.annuaire.dirigeants?.length ? <p className="empty-state compact">Aucun mandat public n’est retourné pour ce SIREN dans le snapshot ou la réponse consultée. Cette absence ne prouve pas l’absence de dirigeant.</p> : null}
              <div className="governance-list">
                {(data.annuaire.dirigeants ?? []).map((officer, index) => <article className="governance-card" key={`${officer.displayName}-${officer.role}-${index}`}>
                  <div className="governance-card-heading">
                    <div>
                      <span className="detail-eyebrow">{officer.officerType === "personne physique" ? "Personne physique" : "Personne morale"}</span>
                      <h4>{officer.displayName}</h4>
                    </div>
                    <span className="badge"><ShieldCheck size={14} aria-hidden="true" /> Mandat public</span>
                  </div>
                  <p className="governance-role">{officer.role}</p>
                  {officer.relatedSiren ? <p className="small muted">SIREN de la personne morale : {officer.relatedSiren}</p> : null}
                  <p className="small muted">Mise à jour RNE : {formatDate(officer.sourceUpdatedAt)}</p>
                </article>)}
              </div>
              {data.governanceNetwork?.edges.length ? <section className="governance-network" aria-labelledby="governance-edges-title">
                <div className="bi-subheading">
                  <div>
                    <h3 id="governance-edges-title">Réseau de mandats publiés</h3>
                    <p>Chaque ligne représente une relation légale publiée entre un mandataire et cette unité légale.</p>
                  </div>
                  <span className="official-reference">{data.governanceNetwork.nodes.length} nœud{data.governanceNetwork.nodes.length > 1 ? "s" : ""}</span>
                </div>
                <div className="governance-edge-list">
                  {data.governanceNetwork.edges.map((edge) => {
                    const source = data.governanceNetwork?.nodes.find((node) => node.id === edge.source);
                    const target = data.governanceNetwork?.nodes.find((node) => node.id === edge.target);
                    if (!source || !target) return null;
                    return <article className="governance-edge" key={edge.id}>
                      <div className="governance-edge-node"><span className="detail-eyebrow">{source.kind === "legal_entity" ? "Personne morale" : source.kind === "person" ? "Personne physique" : "Unité légale"}</span><strong>{source.label}</strong>{source.siren ? <small>SIREN {source.siren}</small> : null}</div>
                      <div className="governance-edge-role"><span aria-hidden="true">→</span><strong>{edge.role}</strong><small>{formatDate(edge.sourceUpdatedAt)}</small></div>
                      <div className="governance-edge-node"><span className="detail-eyebrow">Unité légale cible</span><strong>{target.label}</strong><small>SIREN {target.siren}</small></div>
                    </article>;
                  })}
                </div>
                <p className="small muted">{data.governanceNetwork.note}</p>
              </section> : null}
              {data.annuaire.relatedLegalEntities?.length ? <section className="governance-network" aria-labelledby="governance-network-title">
                <div className="bi-subheading">
                  <div>
                    <h3 id="governance-network-title">Réseau juridique public</h3>
                    <p>Personnes morales citées dans les mandats publiés, avec les qualités exactes observées.</p>
                  </div>
                </div>
                <div className="badge-row">
                  {data.annuaire.relatedLegalEntities.map((entity) => <a className="badge" key={entity.siren} href={`https://annuaire-entreprises.data.gouv.fr/entreprise/${entity.siren}`} target="_blank" rel="noopener noreferrer">
                    {entity.name} · SIREN {entity.siren} · {entity.roles.join(", ")} · {entity.roleCount} mandat{entity.roleCount > 1 ? "s" : ""} <ExternalLink size={12} aria-hidden="true" />
                  </a>)}
                </div>
              </section> : null}
            </div>
            <aside className="governance-method">
              <h3>Lecture responsable</h3>
              <p>Cette vue décrit des mandats légaux publiés. Elle ne constitue pas un organigramme opérationnel, ne déduit pas les liens hiérarchiques et ne contient ni date de naissance, ni adresse, ni contact personnel.</p>
              <p className="small muted">Les qualités peuvent inclure des fonctions de direction, de contrôle ou d’audit. Une personne morale est conservée avec son SIREN lorsqu’il est publié.</p>
              <p className="small muted">Référence source : {formatDate(data.annuaire.sourceReferenceDate ?? null)}{data.annuaire.profileSource ? ` · snapshot ${data.annuaire.profileSource}` : ""}{data.annuaire.profileRetrievedAt ? ` · récupéré le ${formatDate(data.annuaire.profileRetrievedAt)}` : ""}.</p>
            </aside>
          </div> : null}

          {tab === "association" ? <div className="association-layout">
            <div className="association-main">
              <div className="bi-subheading">
                <div>
                  <h3>Identité et objet associatif</h3>
                  <p>Déclarations enregistrées en préfecture dans le Répertoire national des associations.</p>
                </div>
                <a href={data.association.sourceUrl} target="_blank" rel="noopener noreferrer">Source RNA <ExternalLink size={14} aria-hidden="true" /></a>
              </div>
              <div className="association-metrics">
                <div><Activity size={17} aria-hidden="true" /><strong>{data.association.activeCount}</strong><span>associations actives</span></div>
                <div><Scale size={17} aria-hidden="true" /><strong>{data.association.dissolvedCount}</strong><span>dissolutions publiées</span></div>
                <div><ShieldCheck size={17} aria-hidden="true" /><strong>{data.association.publicUtilityCount}</strong><span>utilité publique</span></div>
                <div><CircleAlert size={17} aria-hidden="true" /><strong>{data.association.qualityWarningCount}</strong><span>anomalies à vérifier</span></div>
              </div>
              <div className="association-list">
                {data.association.profiles.map((profile) => {
                  const purposeIsLong = Boolean(profile.purpose && profile.purpose.length > 700);
                  const purposeExcerpt = purposeIsLong ? `${profile.purpose?.slice(0, 700).replace(/\s+\S*$/, "")}…` : profile.purpose;
                  return <article className="association-profile" key={`${profile.rnaId}-${profile.siret ?? "sans-siret"}`}>
                    <div className="association-heading">
                      <div>
                        <span>{associationNatureLabel(profile.natureCode)}</span>
                        <h3>{profile.title ?? profile.shortTitle ?? "Association sans titre publié"}</h3>
                        <small>RNA {profile.rnaId}{profile.siret ? ` · SIRET ${profile.siret}` : ""}</small>
                      </div>
                      <span className="association-status" data-status={profile.status}>{profile.status === "active" ? "Active" : profile.status === "dissolved" ? "Dissoute" : profile.status === "conflicting" ? "Statut contradictoire" : "Statut inconnu"}</span>
                    </div>
                    <div className="association-signals">
                      <span>{associationGroupLabel(profile.groupType)}</span>
                      {profile.publicUtilityId ? <span>RUP {profile.publicUtilityId}</span> : null}
                      {profile.purposeCodes.map((code) => <span key={code}>Objet {code}</span>)}
                    </div>
                    <section className="association-purpose" aria-label="Objet déclaré">
                      <h4>Objet déclaré</h4>
                      {purposeExcerpt ? <p>{purposeExcerpt}</p> : <p className="muted">Objet non renseigné dans le snapshot RNA.</p>}
                      {purposeIsLong ? <details><summary>Lire l’objet complet</summary><p>{profile.purpose}</p></details> : null}
                    </section>
                    <dl className="association-dates">
                      <div><dt>Création déclarée</dt><dd>{formatDate(profile.creationDate)}</dd></div>
                      <div><dt>Publication au JO</dt><dd>{formatDate(profile.publicationDate)}</dd></div>
                      <div><dt>Dernière déclaration</dt><dd>{formatDate(profile.declarationDate)}</dd></div>
                      <div><dt>Mise à jour RNA</dt><dd>{formatDate(profile.updatedAt)}</dd></div>
                    </dl>
                    <div className="association-footer">
                      <span className="confidence-chip" data-status={profile.identifierStatus === "rna_exact_siret_mismatch" ? "not_in_active_stock" : "active_match"}>{associationIdentifierLabel(profile.identifierStatus)} · {Math.round(profile.matchConfidence * 100)} %</span>
                      {profile.website ? <a href={profile.website} target="_blank" rel="noopener noreferrer"><Globe2 size={14} aria-hidden="true" /> Site publié</a> : null}
                    </div>
                  </article>;
                })}
              </div>
            </div>
            <aside className="association-method">
              <h3>Lecture des données</h3>
              <p>L’objet est la déclaration de l’association en préfecture. Il décrit sa finalité statutaire, pas nécessairement ses activités actuelles.</p>
              <dl className="profile-facts">
                <div><dt>Profils RNA</dt><dd>{data.association.total}</dd></div>
                <div><dt>Objets disponibles</dt><dd>{data.association.purposeCount}</dd></div>
                <div><dt>Référence</dt><dd>{formatDate(data.association.sourceReferenceDate)}</dd></div>
                <div><dt>Licence</dt><dd>{data.association.license}</dd></div>
              </dl>
              <p className="small muted">Aucun dirigeant, email, téléphone ou adresse de gestion n’est importé. Une dissolution publiée est distinguée du statut SIRENE de l’unité légale.</p>
            </aside>
          </div> : null}

          {tab === "services" ? <div className="website-layout">
            <div className="website-main">
              <div className="bi-subheading">
                <div>
                  <h3>Ce que l’entreprise déclare proposer</h3>
                  <p>Extraits courts et offres explicitement publiées sur des sites reliés par SIREN ou SIRET.</p>
                </div>
              </div>

              <div className="website-metrics">
                <div><Globe2 size={17} aria-hidden="true" /><strong>{data.websites.accessibleSitesCount}</strong><span>sites analysés</span></div>
                <div><Activity size={17} aria-hidden="true" /><strong>{data.websites.descriptionsCount}</strong><span>descriptions</span></div>
                <div><Building2 size={17} aria-hidden="true" /><strong>{data.websites.offeringsCount}</strong><span>offres et prestations</span></div>
                <div><CircleAlert size={17} aria-hidden="true" /><strong>{data.websites.blockedCount + data.websites.errorCount}</strong><span>sources non exploitables</span></div>
              </div>

              <section className="website-block" aria-labelledby="website-descriptions-title">
                <h3 id="website-descriptions-title">Descriptions publiées</h3>
                {data.websites.descriptions.length ? <div className="website-description-list">
                  {data.websites.descriptions.map((description) => <article className="website-description" key={`${description.url}-${description.text}`}>
                    <div className="website-item-heading">
                      <div><span>{descriptionSourceLabel(description.source)}</span><strong>{description.siteName ?? "Site rattaché"}</strong></div>
                      <span className="confidence-chip" data-status={description.establishmentStatus}>{description.confidence !== null ? `Confiance ${Math.round(description.confidence * 100)} %` : establishmentStatusLabel(description.establishmentStatus)}</span>
                    </div>
                    <p>{description.text}</p>
                    {description.url ? <a href={description.url} target="_blank" rel="noopener noreferrer">Vérifier sur le site <ExternalLink size={13} aria-hidden="true" /></a> : null}
                  </article>)}
                </div> : <p className="empty-state compact">Aucune description réutilisable n’a été trouvée. Aucun texte n’est généré pour combler ce manque.</p>}
              </section>

              <section className="website-block" aria-labelledby="website-offerings-title">
                <h3 id="website-offerings-title">Offres et prestations détectées</h3>
                {data.websites.offerings.length ? <div className="website-offerings">
                  {data.websites.offerings.map((offering) => <article className="website-offering" key={`${offering.url}-${offering.name}`}>
                    <ShieldCheck size={17} aria-hidden="true" />
                    <div><h3>{offering.name}</h3><span>{offering.source === "jsonld" ? "Donnée structurée" : "Rubrique du site"} · confiance {Math.round(offering.confidence * 100)} %</span></div>
                    {offering.url ? <a href={offering.url} target="_blank" rel="noopener noreferrer" aria-label={`Vérifier ${offering.name}`}><ExternalLink size={14} aria-hidden="true" /></a> : null}
                  </article>)}
                </div> : <p className="empty-state compact">Aucune prestation explicitement structurée ou nommée sur les pages autorisées.</p>}
              </section>
            </div>

            <aside className="website-method">
              <h3>Méthode et diagnostics</h3>
              <p>{data.websites.methodology}</p>
              <p className="small muted">Les formulations sont des déclarations du site, pas des données administratives ni une validation de qualité commerciale.</p>
              {data.websites.sites.length ? <div className="website-diagnostics">
                {data.websites.sites.map((site) => <div key={site.id}>
                  <span className="website-status" data-status={site.fetchStatus}>{websiteStatusLabel(site.fetchStatus)}</span>
                  {site.url ? <a href={site.url} target="_blank" rel="noopener noreferrer">{site.hostname ?? site.sourceName ?? "Site"} <ExternalLink size={12} aria-hidden="true" /></a> : <strong>{site.hostname ?? site.sourceName ?? "Référence web"}</strong>}
                  <small>{site.sourceOrigin} · {site.siret ? `SIRET ${site.siret}` : "SIREN exact"} · {establishmentStatusLabel(site.establishmentStatus)}</small>
                </div>)}
              </div> : <p className="small muted">Aucun site rattaché par identifiant exact.</p>}
              <p className="small muted">Index généré le {formatDate(data.websites.generatedAt)}.</p>
            </aside>
          </div> : null}

          {tab === "training" ? <div className="training-layout">
            <div className="training-main">
              <div className="bi-subheading">
                <div>
                  <h3>Activité de formation déclarée</h3>
                  <p>Déclarations d’activité, catégories qualité et spécialités issues de la liste publique du ministère du Travail.</p>
                </div>
                <a href={data.trainingOrganizations.sourceUrl} target="_blank" rel="noopener noreferrer">Source ministérielle <ExternalLink size={14} aria-hidden="true" /></a>
              </div>

              <div className="training-metrics">
                <div><MapPin size={17} aria-hidden="true" /><strong>{data.trainingOrganizations.guadeloupeCount}</strong><span>profils déclarés en Guadeloupe</span></div>
                <div><ShieldCheck size={17} aria-hidden="true" /><strong>{data.trainingOrganizations.qualityCount}</strong><span>certifications qualité actives publiées</span></div>
                <div><Database size={17} aria-hidden="true" /><strong>{data.trainingOrganizations.specialtyCount}</strong><span>profils avec spécialités BPF</span></div>
                <div><Activity size={17} aria-hidden="true" /><strong>{data.trainingOrganizations.metricsCount}</strong><span>profils avec volumes déclarés</span></div>
              </div>

              <div className="training-warning" role="note">
                <CircleAlert size={18} aria-hidden="true" />
                <p>Les spécialités, stagiaires et formateurs proviennent du dernier bilan pédagogique et financier publié. Ils décrivent une période déclarée, pas nécessairement l’offre, les effectifs ou l’activité en temps réel. Une certification affichée concerne uniquement les catégories en cours de validité présentes dans ce snapshot.</p>
              </div>

              <div className="training-list">
                {data.trainingOrganizations.profiles.map((profile) => <article className="training-profile" data-location={profile.registrationLocationScope} key={profile.id}>
                  <div className="training-heading">
                    <div>
                      <span>Déclaration d’activité</span>
                      <h3>NDA {profile.activityDeclarationNumber}</h3>
                    </div>
                    {profile.isQualityCertified ? <span className="training-quality"><ShieldCheck size={14} aria-hidden="true" /> Certification qualité publiée</span> : <span className="training-quality muted-quality">Aucune catégorie qualité active publiée</span>}
                  </div>

                  <div className="project-scope" data-location={profile.registrationLocationScope}><MapPin size={13} aria-hidden="true" /> {trainingLocationLabel(profile.registrationLocationScope)}</div>
                  <p className="training-location">{[profile.postalCode, profile.city].filter(Boolean).join(" · ") || "Localité non publiée"}</p>

                  <section className="training-block" aria-label="Catégories de certification qualité">
                    <h4>Catégories qualité en cours publiées</h4>
                    {profile.qualityCategories.length ? <div className="training-tags">
                      {profile.qualityCategories.map((category) => <span key={category}>{category}</span>)}
                    </div> : <p className="small muted">Aucune catégorie de certification qualité active n’est publiée pour ce profil dans le snapshot.</p>}
                  </section>

                  <section className="training-block" aria-label="Spécialités de formation déclarées">
                    <h4>Spécialités déclarées au BPF</h4>
                    {profile.specialties.length ? <div className="training-specialties">
                      {profile.specialties.map((specialty, index) => <div key={`${specialty.code ?? "sans-code"}-${index}`}>
                        <span>{specialty.code ? `NSF ${specialty.code}` : "Code NSF non renseigné"}</span>
                        <strong>{specialty.label ?? "Libellé non renseigné"}</strong>
                      </div>)}
                    </div> : <p className="small muted">Aucune spécialité n’est renseignée dans le dernier bilan publié.</p>}
                  </section>

                  <dl className="training-facts">
                    <div><dt>Dernière déclaration</dt><dd>{formatDate(profile.lastDeclarationDate)}</dd></div>
                    <div><dt>Période BPF</dt><dd>{formatDate(profile.exerciseStartDate)} → {formatDate(profile.exerciseEndDate)}</dd></div>
                    <div><dt>Stagiaires déclarés</dt><dd>{profile.traineeCount === null ? "Non renseigné" : formatNumber(profile.traineeCount, 0)}</dd></div>
                    <div><dt>Confiés par un autre OF</dt><dd>{profile.entrustedTraineeCount === null ? "Non renseigné" : formatNumber(profile.entrustedTraineeCount, 0)}</dd></div>
                    <div><dt>Formateurs déclarés</dt><dd>{profile.trainerCount === null ? "Non renseigné" : formatNumber(profile.trainerCount, 0)}</dd></div>
                    <div><dt>Identifiant exact</dt><dd>{profile.siret ? `SIRET ${profile.siret}` : `SIREN ${profile.siren}`}</dd></div>
                    <div><dt>Périmètre de jointure</dt><dd>{trainingMatchLabel(profile.matchScope)}</dd></div>
                    <div><dt>Confiance de jointure</dt><dd>{Math.round(profile.matchConfidence * 100)} %</dd></div>
                    {profile.previousActivityNumbers ? <div><dt>Anciens NDA publiés</dt><dd>{profile.previousActivityNumbers}</dd></div> : null}
                  </dl>

                  <div className="training-source-row">
                    <a href={profile.datasetUrl} target="_blank" rel="noopener noreferrer">{profile.resourceTitle} <ExternalLink size={13} aria-hidden="true" /></a>
                    <span>{profile.license}</span>
                  </div>
                </article>)}
              </div>
              {data.trainingOrganizations.truncated ? <p className="small muted">Les {data.trainingOrganizations.displayedCount} profils prioritaires sont affichés sur {data.trainingOrganizations.total}; les déclarations guadeloupéennes apparaissent en premier.</p> : null}
            </div>

            <aside className="training-method">
              <h3>Lecture réglementaire</h3>
              <p>La présence dans cette liste signifie que l’organisme est déclaré auprès du préfet de région et à jour de son obligation de bilan pédagogique et financier selon la source. Elle ne garantit pas qu’une formation précise soit ouverte actuellement.</p>
              <dl className="profile-facts">
                <div><dt>Profils de l’unité légale</dt><dd>{data.trainingOrganizations.total}</dd></div>
                <div><dt>Déclarations en Guadeloupe</dt><dd>{data.trainingOrganizations.guadeloupeCount}</dd></div>
                <div><dt>Déclarations hors Guadeloupe</dt><dd>{data.trainingOrganizations.outsideCount}</dd></div>
                <div><dt>SIRET actifs locaux exacts</dt><dd>{data.trainingOrganizations.activeLocalCount}</dd></div>
                <div><dt>Actions de formation certifiées</dt><dd>{data.trainingOrganizations.qualityTrainingCount}</dd></div>
                <div><dt>Bilans de compétences certifiés</dt><dd>{data.trainingOrganizations.qualitySkillsCount}</dd></div>
                <div><dt>VAE certifiées</dt><dd>{data.trainingOrganizations.qualityVaeCount}</dd></div>
                <div><dt>Apprentissage certifié</dt><dd>{data.trainingOrganizations.qualityApprenticeshipCount}</dd></div>
              </dl>
              <p className="small muted">Dernière déclaration trouvée : {formatDate(data.trainingOrganizations.latestDeclarationDate)}. Dernière fin d’exercice publiée : {formatDate(data.trainingOrganizations.latestExerciseEndDate)}.</p>
              <p className="small muted">Source mise à jour le {formatDate(data.trainingOrganizations.sourceUpdatedAt)} · {data.trainingOrganizations.license}. Aucun nom de personne, rue ou contact n’est stocké dans l’index local.</p>
              <a href={data.trainingOrganizations.sourceUrl} target="_blank" rel="noopener noreferrer">Méthodologie et métadonnées <ExternalLink size={13} aria-hidden="true" /></a>
            </aside>
          </div> : null}

          {tab === "equality" ? <div className="equality-layout">
            <div className="equality-main">
              <div className="bi-subheading">
                <div>
                  <span className="eyebrow">Données agrégées déclarées</span>
                  <h2>Index de l’égalité professionnelle</h2>
                </div>
                <a href={data.professionalEquality.egaproUrl} target="_blank" rel="noopener noreferrer">Consulter Egapro <ExternalLink size={14} aria-hidden="true" /></a>
              </div>

              <section className="equality-scoreboard" aria-label="Dernier résultat calculable">
                <div className="equality-score-ring" style={{ background: data.professionalEquality.latestScore !== null ? `conic-gradient(var(--brand) ${data.professionalEquality.latestScore}%, var(--line) 0)` : "var(--line)" }}>
                  <div>
                    <strong>{data.professionalEquality.latestScore ?? "NC"}</strong>
                    <span>{data.professionalEquality.latestScore !== null ? "/ 100" : "non calculable"}</span>
                  </div>
                </div>
                <div className="equality-score-copy">
                  <span>Dernier index calculable{data.professionalEquality.latestCalculableYear ? ` · référence ${data.professionalEquality.latestCalculableYear}` : ""}</span>
                  <h3>{data.professionalEquality.latestScore !== null ? `${data.professionalEquality.latestScore} points sur 100` : "Aucun score calculable publié"}</h3>
                  <p>{data.professionalEquality.scoreDelta === null ? "Évolution non calculable avec l’historique disponible." : data.professionalEquality.scoreDelta === 0 ? "Score stable par rapport au résultat calculable précédent." : `${data.professionalEquality.scoreDelta > 0 ? "+" : ""}${data.professionalEquality.scoreDelta} point${Math.abs(data.professionalEquality.scoreDelta) > 1 ? "s" : ""} par rapport au résultat calculable précédent.`}</p>
                  {data.professionalEquality.latestScore !== null ? <div className="equality-thresholds" aria-label={`Score ${data.professionalEquality.latestScore} sur 100, repères à 75 et 85`}>
                    <span className="threshold-line threshold-75" aria-hidden="true" />
                    <span className="threshold-line threshold-85" aria-hidden="true" />
                    <span className="score-point" style={{ left: `${data.professionalEquality.latestScore}%` }} aria-hidden="true" />
                    <div><span>0</span><span>75</span><span>85</span><span>100</span></div>
                  </div> : null}
                </div>
              </section>

              <div className="equality-metrics">
                <div><Database size={17} aria-hidden="true" /><strong>{data.professionalEquality.total}</strong><span>années rattachées</span></div>
                <div><Activity size={17} aria-hidden="true" /><strong>{data.professionalEquality.calculableCount}</strong><span>index calculables</span></div>
                <div><CircleAlert size={17} aria-hidden="true" /><strong>{data.professionalEquality.nonCalculableCount}</strong><span>index non calculables</span></div>
                <div><Building2 size={17} aria-hidden="true" /><strong>{data.professionalEquality.uesCount}</strong><span>rattachements UES</span></div>
              </div>

              <div className="equality-warning" role="note">
                <Scale size={18} aria-hidden="true" />
                <p>Ces résultats agrégés mesurent des écarts selon la méthode légale Egapro. Ils ne décrivent aucune rémunération individuelle et ne suffisent pas, seuls, à conclure sur une situation personnelle ou sur la conformité globale de l’employeur.</p>
              </div>

              <div className="equality-history">
                {data.professionalEquality.declarations.map((declaration) => <article className="equality-year" key={declaration.id} data-scope={declaration.matchScope}>
                  <div className="equality-year-heading">
                    <div>
                      <span>Année de référence</span>
                      <h3>{declaration.referenceYear}</h3>
                    </div>
                    <div className="equality-year-score" data-status={declaration.indexStatus}>
                      <strong>{declaration.indexScore ?? equalityStatusLabel(declaration.indexStatus)}</strong>
                      {declaration.indexScore !== null ? <span>/ 100</span> : null}
                    </div>
                  </div>

                  <div className="equality-context">
                    <span><Building2 size={13} aria-hidden="true" /> {equalityMatchLabel(declaration.matchScope)}</span>
                    <span>{declaration.structureType === "ues" ? declaration.uesName || "Unité économique et sociale" : "Déclaration entreprise"}</span>
                  </div>

                  <div className="equality-indicators">
                    {declaration.indicators.map((indicator) => <div className="equality-indicator" key={indicator.key} data-status={indicator.status}>
                      <div><span>{indicator.label}</span><strong>{indicator.score !== null ? `${indicator.score} / ${indicator.maximum}` : equalityStatusLabel(indicator.status)}</strong></div>
                      <div className="indicator-track" aria-hidden="true"><span style={{ width: indicator.score !== null ? `${Math.min(100, indicator.score / indicator.maximum * 100)}%` : "0%" }} /></div>
                    </div>)}
                  </div>

                  <dl className="equality-facts">
                    <div><dt>Effectif assujetti</dt><dd>{declaration.workforceBand || "Non renseigné"}</dd></div>
                    <div><dt>Déclarant</dt><dd>SIREN {declaration.declaringSiren}</dd></div>
                    <div><dt>Localisation du déclarant</dt><dd>{[declaration.declaringDepartment, declaration.declaringRegion].filter(Boolean).join(" · ") || "Non renseignée"}</dd></div>
                    <div><dt>Activité déclarée</dt><dd>{[declaration.nafCode, declaration.nafLabel].filter(Boolean).join(" · ") || "Non renseignée"}</dd></div>
                  </dl>
                </article>)}
              </div>
            </div>

            <aside className="equality-method">
              <h3>Lecture des données</h3>
              <p className="small muted">L’index est la somme des indicateurs calculables, ramenée sur 100 selon les règles Egapro. `NC` signifie que l’index publié n’était pas calculable pour l’année considérée.</p>
              <dl>
                <div><dt>Période disponible</dt><dd>{data.professionalEquality.earliestYear ?? "—"}–{data.professionalEquality.latestYear ?? "—"}</dd></div>
                <div><dt>Déclarations directes</dt><dd>{data.professionalEquality.directCount}</dd></div>
                <div><dt>Déclarations localisées en Guadeloupe</dt><dd>{data.professionalEquality.guadeloupeCount}</dd></div>
                <div><dt>Entreprises locales couvertes</dt><dd>{formatNumber(data.professionalEquality.matchedCompanyCount, 0)}</dd></div>
                <div><dt>Lignes source analysées</dt><dd>{formatNumber(data.professionalEquality.sourceRowCount, 0)}</dd></div>
              </dl>
              <p className="small muted">Une UES regroupe plusieurs entreprises : le score affiché est collectif et le rattachement repose uniquement sur la liste de SIREN publiée. Source mise à jour le {formatDate(data.professionalEquality.sourceUpdatedAt)} · {data.professionalEquality.license}.</p>
              <a href={data.professionalEquality.sourceUrl} target="_blank" rel="noopener noreferrer">Source et métadonnées <ExternalLink size={13} aria-hidden="true" /></a>
            </aside>
          </div> : null}

          {tab === "agreements" ? <div className="agreement-layout">
            <div className="agreement-main">
              <div className="bi-subheading">
                <div>
                  <span className="eyebrow">Rattachements déclarés par établissement</span>
                  <h2>Conventions collectives et OPCO</h2>
                  <p>IDCC déclarés en DSN et opérateurs de compétences publiés par France compétences.</p>
                </div>
                <a href={data.collectiveAgreements.idccSourceUrl} target="_blank" rel="noopener noreferrer">Jeu SIRET–IDCC <ExternalLink size={14} aria-hidden="true" /></a>
              </div>

              <div className="agreement-timeline" aria-label="Millésimes des deux sources">
                <div>
                  <span>Conventions collectives</span>
                  <strong>{formatMonth(data.collectiveAgreements.idccReferenceMonth)}</strong>
                  <small>Ministère du Travail</small>
                </div>
                <span aria-hidden="true" />
                <div>
                  <span>Rattachements OPCO</span>
                  <strong>{formatMonth(data.collectiveAgreements.siroReferenceMonth)}</strong>
                  <small>France compétences · SIRO</small>
                </div>
              </div>

              <div className="agreement-metrics">
                <div><Building2 size={17} aria-hidden="true" /><strong>{data.collectiveAgreements.total}</strong><span>établissements couverts</span></div>
                <div><Scale size={17} aria-hidden="true" /><strong>{data.collectiveAgreements.substantiveAgreementCount}</strong><span>IDCC documentés</span></div>
                <div><Activity size={17} aria-hidden="true" /><strong>{data.collectiveAgreements.effectiveOpcoCount}</strong><span>OPCO opérationnels</span></div>
                <div><CircleAlert size={17} aria-hidden="true" /><strong>{data.collectiveAgreements.opcoAnomalyCount}</strong><span>anomalies déclaratives</span></div>
              </div>

              <div className="agreement-warning" role="note">
                <CircleAlert size={18} aria-hidden="true" />
                <p>Ces rattachements proviennent de déclarations DSN et peuvent être décalés dans le temps. Ils facilitent la vérification, mais ne déterminent pas à eux seuls le texte juridiquement applicable à une situation de travail.</p>
              </div>

              <div className="agreement-list">
                {data.collectiveAgreements.establishments.map((establishment) => <article className="agreement-establishment" key={establishment.siret} data-difference={establishment.idccDifference}>
                  <div className="agreement-establishment-heading">
                    <div>
                      <span>{establishment.isHeadOffice ? "Siège social" : "Établissement"}{establishment.employer === true ? " · employeur déclaré" : ""}</span>
                      <h3>{establishment.commune || "Commune non renseignée"}</h3>
                      <small>SIRET {establishment.siret}</small>
                    </div>
                    {establishment.idccDifference ? <span className="agreement-difference">Millésimes différents</span> : null}
                  </div>

                  <section className="agreement-block" aria-label={`Conventions collectives déclarées pour le SIRET ${establishment.siret}`}>
                    <h4>Convention{establishment.agreements.length > 1 ? "s" : ""} déclarée{establishment.agreements.length > 1 ? "s" : ""}</h4>
                    {establishment.agreements.length ? <div className="agreement-idcc-list">
                      {establishment.agreements.map((agreement) => <div key={agreement.id} data-status={agreement.status}>
                        <span>IDCC {agreement.idcc}</span>
                        <div>
                          <strong>{agreement.shortTitle || agreement.label}</strong>
                          {agreement.shortTitle && agreement.title && agreement.title !== agreement.shortTitle ? <p>{agreement.title}</p> : null}
                          <small>Référence {formatMonth(agreement.referenceMonth)}{agreement.baseTextStatus ? ` · texte ${agreement.baseTextStatus.toLocaleLowerCase("fr")}` : ""}</small>
                        </div>
                        {agreement.legifranceUrl ? <a href={agreement.legifranceUrl} target="_blank" rel="noopener noreferrer" aria-label={`Vérifier l’IDCC ${agreement.idcc} sur Légifrance`}><ExternalLink size={15} aria-hidden="true" /></a> : null}
                      </div>)}
                    </div> : <p className="empty-state compact">Aucun IDCC trouvé dans le millésime du ministère pour cet établissement.</p>}
                  </section>

                  <section className="agreement-block agreement-opco" aria-label={`OPCO déclaré pour le SIRET ${establishment.siret}`}>
                    <h4>Opérateur de compétences</h4>
                    {establishment.opco ? <div className="opco-assignment" data-status={establishment.opco.status}>
                      <div className="opco-mark" aria-hidden="true">OPCO</div>
                      <div>
                        {establishment.opco.status === "assigned" ? <>
                          <strong>{establishment.opco.effectiveOpco || "Rattachement non renseigné"}</strong>
                          <p>{establishment.opco.managingOpco && establishment.opco.ownerOpco && establishment.opco.managingOpco !== establishment.opco.ownerOpco
                            ? `${establishment.opco.ownerOpco} est l’OPCO de rattachement; ${establishment.opco.managingOpco} assure la gestion territoriale.`
                            : "OPCO publié dans la table SIRO."}</p>
                        </> : <>
                          <strong>Déclaration incomplète</strong>
                          <p>Le SIRET figure dans SIRO, mais aucun OPCO propriétaire ou gestionnaire n’est attribué.</p>
                        </>}
                        <small>{establishment.opco.idcc ? `IDCC SIRO ${establishment.opco.idcc} · ` : ""}référence {formatMonth(establishment.opco.referenceMonth)}</small>
                      </div>
                    </div> : <p className="empty-state compact">Aucun rattachement OPCO trouvé dans le millésime SIRO.</p>}
                  </section>
                </article>)}
              </div>
            </div>

            <aside className="agreement-method">
              <h3>Comment lire ces données</h3>
              <p>Un établissement peut déclarer plusieurs IDCC. Les codes 5100, 5501, 9998 et 9999 sont conservés comme états déclaratifs, pas comme conventions nommées.</p>
              <dl>
                <div><dt>IDCC distincts</dt><dd>{data.collectiveAgreements.distinctIdccCount}</dd></div>
                <div><dt>Établissements multi-IDCC</dt><dd>{data.collectiveAgreements.multiIdccEstablishmentCount}</dd></div>
                <div><dt>Écarts entre millésimes</dt><dd>{data.collectiveAgreements.crossSourceDifferenceCount}</dd></div>
                <div><dt>Entreprises locales couvertes</dt><dd>{formatNumber(data.collectiveAgreements.matchedCompanyCount, 0)}</dd></div>
                <div><dt>Lignes source analysées</dt><dd>{formatNumber(data.collectiveAgreements.sourceRowCount, 0)}</dd></div>
              </dl>
              {data.collectiveAgreements.effectiveOpcos.length ? <div className="agreement-opco-list"><span>OPCO observés</span>{data.collectiveAgreements.effectiveOpcos.map((opco) => <strong key={opco}>{opco}</strong>)}</div> : null}
              <p className="small muted">Titres enrichis depuis KALI {data.collectiveAgreements.kaliVersion || "version courante"}. Mise à jour IDCC : {formatDate(data.collectiveAgreements.sourceUpdatedAt)}. Mise à jour SIRO : {formatDate(data.collectiveAgreements.siroSourceUpdatedAt)} · {data.collectiveAgreements.license}.</p>
              <div className="agreement-source-links">
                <a href={data.collectiveAgreements.siroSourceUrl} target="_blank" rel="noopener noreferrer">Table SIRO <ExternalLink size={13} aria-hidden="true" /></a>
                <a href={data.collectiveAgreements.kaliSourceUrl} target="_blank" rel="noopener noreferrer">Catalogue KALI <ExternalLink size={13} aria-hidden="true" /></a>
              </div>
            </aside>
          </div> : null}

          {tab === "patents" ? <div className="patent-layout">
            <div className="patent-main">
              <div className="bi-subheading">
                <div>
                  <span className="eyebrow">Portefeuille de l’unité légale</span>
                  <h2>Brevets et empreinte technologique</h2>
                  <p>Familles DOCDB, demandes internationales, octrois et classifications technologiques publiés.</p>
                </div>
                <a href={data.patents.applicantsSourceUrl} target="_blank" rel="noopener noreferrer">Déposants MESRE <ExternalLink size={14} aria-hidden="true" /></a>
              </div>

              <div className="patent-metrics">
                <div><Lightbulb size={17} aria-hidden="true" /><strong>{formatNumber(data.patents.total, 0)}</strong><span>familles d’inventions</span></div>
                <div><Database size={17} aria-hidden="true" /><strong>{formatNumber(data.patents.applicationCount, 0)}</strong><span>demandes publiées</span></div>
                <div><ShieldCheck size={17} aria-hidden="true" /><strong>{formatNumber(data.patents.grantedCount, 0)}</strong><span>familles octroyées</span></div>
                <div><Globe2 size={17} aria-hidden="true" /><strong>{formatNumber(data.patents.internationalCount, 0)}</strong><span>familles internationales</span></div>
              </div>

              <div className="patent-scope-warning" role="note">
                <MapPin size={18} aria-hidden="true" />
                <p>Le SIREN rattache le portefeuille à l’unité légale nationale. Une implantation en Guadeloupe ne prouve pas que l’invention a été créée, déposée ou exploitée localement.</p>
              </div>

              {data.patents.sections.length ? <section className="patent-spectrum" aria-labelledby="patent-spectrum-title">
                <div>
                  <h3 id="patent-spectrum-title">Empreinte technologique</h3>
                  <span>{data.patents.technologyCount.toLocaleString("fr-FR")} classifications CIB</span>
                </div>
                <div className="patent-spectrum-list">
                  {data.patents.sections.map((section) => <div key={section.code}>
                    <div><strong>{section.code}</strong><span>{section.label}</span><small>{formatNumber(section.familyCount, 0)}</small></div>
                    <div aria-hidden="true"><span style={{ width: `${Math.max(4, Math.min(100, section.familyCount / data.patents.total * 100))}%` }} /></div>
                  </div>)}
                </div>
              </section> : null}

              {data.patents.truncated ? <p className="patent-truncated"><CircleAlert size={15} aria-hidden="true" /> Affichage des {data.patents.displayedCount} familles les plus récentes sur {formatNumber(data.patents.total, 0)}. Les indicateurs ci-dessus portent sur le portefeuille complet.</p> : null}

              <div className="patent-family-list">
                {data.patents.families.map((family) => {
                  const abstractIsLong = Boolean(family.abstract && family.abstract.length > 720);
                  const abstractExcerpt = abstractIsLong ? `${family.abstract?.slice(0, 720).replace(/\s+\S*$/, "")}…` : family.abstract;
                  return <article className="patent-family" key={family.id} data-granted={family.granted}>
                    <div className="patent-family-heading">
                      <div>
                        <span>Famille DOCDB {family.familyDocdb}</span>
                        <h3>{family.title}</h3>
                      </div>
                      <div className="patent-statuses">
                        {family.granted ? <span data-status="granted"><ShieldCheck size={13} aria-hidden="true" /> Octroyée</span> : <span data-status="pending">Sans octroi publié</span>}
                        {family.internationalApplication ? <span><Globe2 size={13} aria-hidden="true" /> Internationale</span> : null}
                        {family.epoApplication ? <span>OEB</span> : null}
                      </div>
                    </div>

                    <dl className="patent-dates">
                      <div><dt>Première demande</dt><dd>{formatDate(family.firstApplicationDate)}</dd></div>
                      <div><dt>Première publication</dt><dd>{formatDate(family.firstPublicationDate)}</dd></div>
                      <div><dt>Premier octroi</dt><dd>{family.granted ? formatDate(family.firstGrantDate) : "Non publié"}</dd></div>
                      <div><dt>Demandes reliées</dt><dd>{family.applicationCount}</dd></div>
                    </dl>

                    <section className="patent-abstract" aria-label="Résumé public de l’invention">
                      <h4>Résumé publié</h4>
                      {abstractExcerpt ? <p>{abstractExcerpt}</p> : <p className="muted">Aucun résumé disponible dans le jeu des familles.</p>}
                      {abstractIsLong ? <details><summary>Lire le résumé complet</summary><p>{family.abstract}</p></details> : null}
                    </section>

                    <div className="patent-technologies">
                      {family.sections.map((section) => <span className="patent-section-chip" key={section.code}><FlaskConical size={13} aria-hidden="true" /> {section.label}</span>)}
                      {family.classes.map((classification) => <span key={classification.code} title={classification.label || classification.code}>{classification.code}</span>)}
                      {family.subclasses.slice(0, 8).map((classification) => <span key={classification.code} title={classification.label || classification.code}>{classification.code}</span>)}
                    </div>

                    <div className="patent-family-footer">
                      <span>{family.applicantNames.join(" · ") || "Déposant rattaché par SIREN exact"}</span>
                      <a href={family.scanrUrl} target="_blank" rel="noopener noreferrer">Vérifier dans scanR <ExternalLink size={13} aria-hidden="true" /></a>
                    </div>
                  </article>;
                })}
              </div>
            </div>

            <aside className="patent-method">
              <h3>Lecture du portefeuille</h3>
              <p>Une famille DOCDB regroupe des demandes portant sur une même invention dans plusieurs offices. Le nombre de demandes ne représente donc pas autant d’inventions distinctes.</p>
              <dl>
                <div><dt>Période des demandes</dt><dd>{formatDate(data.patents.earliestApplicationDate)} – {formatDate(data.patents.latestApplicationDate)}</dd></div>
                <div><dt>Offices de dépôt</dt><dd>{data.patents.applicationAuthorityCount}</dd></div>
                <div><dt>Familles OEB</dt><dd>{formatNumber(data.patents.epoCount, 0)}</dd></div>
                <div><dt>Résumés disponibles</dt><dd>{formatNumber(data.patents.abstractCount, 0)}</dd></div>
                <div><dt>Entreprises locales couvertes</dt><dd>{formatNumber(data.patents.matchedCompanyCount, 0)}</dd></div>
              </dl>
              <p className="small muted">Index territorial : {formatNumber(data.patents.indexedFamilyCount, 0)} rattachements entreprise-famille et {formatNumber(data.patents.indexedApplicationCount, 0)} demandes. Les déposants personnes physiques et les inventeurs ne sont pas importés.</p>
              <p className="small muted">Déposants et technologies mis à jour le {formatDate(data.patents.applicantsSourceUpdatedAt)}. Familles détaillées mises à jour le {formatDate(data.patents.familiesSourceUpdatedAt)} · {data.patents.license}.</p>
              <div className="patent-source-links">
                <a href={data.patents.familiesSourceUrl} target="_blank" rel="noopener noreferrer">Familles de brevets <ExternalLink size={13} aria-hidden="true" /></a>
                <a href={data.patents.technologiesSourceUrl} target="_blank" rel="noopener noreferrer">Technologies CIB <ExternalLink size={13} aria-hidden="true" /></a>
              </div>
            </aside>
          </div> : null}

          {tab === "presence" ? <div className="presence-layout">
            <div className="presence-main">
              <div className="bi-subheading">
                <div>
                  <h3>Empreinte numérique et opérationnelle</h3>
                  <p>Points d’intérêt rapprochés par SIREN ou SIRET exact dans OpenStreetMap.</p>
                </div>
                <a href={data.osmPresence.sourceUrl} target="_blank" rel="noopener noreferrer">Source OSM <ExternalLink size={14} aria-hidden="true" /></a>
              </div>

              <div className="presence-metrics" aria-label="Couverture OpenStreetMap de l’entreprise">
                <div><MapPin size={17} aria-hidden="true" /><strong>{data.osmPresence.total}</strong><span>implantations OSM</span></div>
                <div><Globe2 size={17} aria-hidden="true" /><strong>{data.osmPresence.websites.length}</strong><span>sites publiés</span></div>
                <div><Mail size={17} aria-hidden="true" /><strong>{osmEmails.length}</strong><span>emails fonctionnels</span></div>
                <div><Phone size={17} aria-hidden="true" /><strong>{data.osmPresence.phones.length}</strong><span>téléphones</span></div>
                <div><Clock3 size={17} aria-hidden="true" /><strong>{data.osmPresence.openingHoursCount}</strong><span>horaires</span></div>
              </div>

              {data.osmPresence.profiles.length ? <div className="presence-list">
                {data.osmPresence.profiles.map((profile) => <article className="presence-row" key={profile.id}>
                  <div className="presence-row-heading">
                    <div>
                      <span className="presence-category">{profile.category ?? "Activité non catégorisée"}</span>
                      <h3>{profile.name ?? profile.brand ?? profile.operator ?? "Implantation OSM"}</h3>
                    </div>
                    <span className="confidence-chip" data-status={profile.establishmentStatus}>{establishmentStatusLabel(profile.establishmentStatus)}</span>
                  </div>
                  {profile.description ? <p>{profile.description}</p> : null}
                  <div className="presence-facts">
                    {profile.address ? <span><MapPin size={14} aria-hidden="true" />{profile.address}</span> : null}
                    {profile.publicEmail ? <span><Mail size={14} aria-hidden="true" />{profile.publicEmail}</span> : null}
                    {profile.phone ? <span><Phone size={14} aria-hidden="true" />{profile.phone}</span> : null}
                    {profile.openingHours ? <span><Clock3 size={14} aria-hidden="true" />{profile.openingHours}</span> : null}
                    {accessibilityLabel(profile.wheelchair) ? <span><Accessibility size={14} aria-hidden="true" />{accessibilityLabel(profile.wheelchair)}</span> : null}
                  </div>
                  {profile.services.length ? <ul className="signal-list compact-signals">
                    {profile.services.map((service) => <li key={`${service.key}-${service.value}`}>{formatOsmValue(service.key)} · {formatOsmValue(service.value)}</li>)}
                  </ul> : null}
                  <div className="presence-links">
                    {profile.website ? <a href={profile.website} target="_blank" rel="noopener noreferrer"><Globe2 size={14} aria-hidden="true" /> Site web</a> : null}
                    {profile.publicEmail ? <a href={`mailto:${profile.publicEmail}`} rel="nofollow"><Mail size={14} aria-hidden="true" /> Email professionnel</a> : null}
                    {profile.socialProfiles.map((social) => <a key={`${social.platform}-${social.url}`} href={social.url} target="_blank" rel="noopener noreferrer">{formatOsmValue(social.platform)} <ExternalLink size={13} aria-hidden="true" /></a>)}
                    <a href={profile.sourceUrl} target="_blank" rel="noopener noreferrer">Objet OSM <ExternalLink size={13} aria-hidden="true" /></a>
                  </div>
                </article>)}
              </div> : <p className="empty-state">Aucune présence OSM reliée par identifiant exact. Cela ne signifie pas que l’entreprise n’a ni site, ni horaires, ni point d’accueil.</p>}
            </div>

            <aside className="presence-method">
              <h3>Lecture des données</h3>
              <p>La jointure administrative est exacte. Les attributs sont contributifs et doivent être confirmés depuis le site officiel avant tout usage sensible.</p>
              <dl className="profile-facts">
                <div><dt>Catégories trouvées</dt><dd>{data.osmPresence.categories.length}</dd></div>
                <div><dt>Emails fonctionnels</dt><dd>{osmEmails.length}</dd></div>
                <div><dt>Réseaux sociaux</dt><dd>{data.osmPresence.socialProfilesCount}</dd></div>
                <div><dt>Accessibilité</dt><dd>{data.osmPresence.accessibilityCount}</dd></div>
                <div><dt>SIRET actifs</dt><dd>{data.osmPresence.activeMatchesCount}</dd></div>
                <div><dt>Références à revoir</dt><dd>{data.osmPresence.staleReferencesCount}</dd></div>
                <div><dt>Confiance attributs</dt><dd>80 %</dd></div>
              </dl>
              <p className="small muted">Extrait du {formatDate(data.osmPresence.sourceReferenceDate)} · {data.osmPresence.license} · {data.osmPresence.attribution}</p>
            </aside>
          </div> : null}

          {tab === "financials" && activeFinancialExercise ? <div className="financial-analysis-layout">
            <div className="financial-analysis-main">
              <div className="bi-subheading">
                <div>
                  <h3>Trajectoire financière publiée</h3>
                  <p>{data.financialRatios.total ? "Ratios BCE et bilans détaillés issus des comptes RNCS transmis par l’INPI" : "Bilans détaillés issus des comptes RNCS transmis par l’INPI"}, sans notation ni interprétation de solvabilité.</p>
                </div>
                <a href={data.financialRatios.total ? data.financialRatios.sourceUrl : data.detailedFinancials.sourceUrl} target="_blank" rel="noopener noreferrer">Source BCE / INPI <ExternalLink size={14} aria-hidden="true" /></a>
              </div>

              <div className="financial-scope-note" role="note">
                <Database size={18} aria-hidden="true" />
                <p>Ces comptes concernent l’unité légale nationale portant le SIREN {siren}. Ils ne décrivent pas isolément son établissement en Guadeloupe.</p>
              </div>

              <div className="financial-controls">
                <div className="financial-type-control" role="group" aria-label="Type de bilan">
                  {availableFinancialTypes.map((type) => <button
                    key={type}
                    type="button"
                    aria-pressed={activeFinancialType === type}
                    onClick={() => { setFinancialStatementType(type); setFinancialExerciseId(null); }}
                  >{statementTypeLabel(type)} <span>{type}</span></button>)}
                </div>
                <label>
                  Exercice
                  <select value={activeFinancialExercise.id} onChange={(event) => setFinancialExerciseId(event.target.value)}>
                    {typeFinancialExercises.map((exercise) => <option value={exercise.id} key={exercise.id}>{formatDate(exercise.closingDate)}{exercise.partiallyConfidential ? " · diffusion partielle" : ""}</option>)}
                  </select>
                </label>
              </div>

              <div className="financial-headline-metrics">
                <div><BarChart3 size={17} aria-hidden="true" /><span>Chiffre d’affaires</span><strong>{activeFinancialExercise.revenue === null && activeFinancialExercise.partiallyConfidential ? "Non diffusé" : formatCurrency(activeFinancialExercise.revenue)}</strong></div>
                <div><TrendingUp size={17} aria-hidden="true" /><span>Excédent brut</span><strong>{activeFinancialExercise.ebe === null && activeFinancialExercise.partiallyConfidential ? "Non diffusé" : formatCurrency(activeFinancialExercise.ebe)}</strong></div>
                <div><Scale size={17} aria-hidden="true" /><span>Résultat net</span><strong data-negative={activeFinancialExercise.netIncome !== null && activeFinancialExercise.netIncome < 0}>{formatCurrency(activeFinancialExercise.netIncome)}</strong></div>
                <div><Activity size={17} aria-hidden="true" /><span>Marge EBE</span><strong>{formatFinancialValue(activeFinancialExercise.ebeMargin, "percent")}</strong></div>
              </div>

              {activeFinancialExercise.partiallyConfidential ? <div className="financial-confidentiality" role="note">
                <LockKeyhole size={18} aria-hidden="true" />
                <div><strong>Diffusion partielle</strong><p>Le chiffre d’affaires, la marge brute, l’EBE et l’EBIT ne sont pas diffusés pour cet exercice. Les zéros techniques de la source ne sont pas affichés comme des montants réels.</p></div>
              </div> : null}

              {activeDetailedFinancialStatement ? <section className="financial-balance-detail" aria-labelledby="financial-balance-title">
                <div className="financial-section-heading">
                  <div>
                    <h3 id="financial-balance-title">Bilan de l’exercice</h3>
                    <p>{activeDetailedFinancialStatement.metricCount} agrégats dérivés de {activeDetailedFinancialStatement.cellCount} cellules fiscales publiées</p>
                  </div>
                  <a href={data.detailedFinancials.sourceUrl} target="_blank" rel="noopener noreferrer">Données détaillées <ExternalLink size={13} aria-hidden="true" /></a>
                </div>
                <div className="financial-balance-total">
                  <span>Total du bilan</span>
                  <strong>{formatCurrency(activeDetailedFinancialStatement.balanceSheetTotal)}</strong>
                </div>
                <div className="financial-balance-columns">
                  <div>
                    <h4>Composition de l’actif</h4>
                    {([
                      ["Immobilisations nettes", activeDetailedFinancialStatement.fixedAssetsNet],
                      ["Actif circulant net", activeDetailedFinancialStatement.currentAssetsNet],
                      ["Stocks nets", activeDetailedFinancialStatement.inventoryNet],
                      ["Créances clients nettes", activeDetailedFinancialStatement.tradeReceivablesNet],
                      ["Trésorerie et valeurs mobilières", activeDetailedFinancialStatement.cashAndSecuritiesNet]
                    ] as Array<[string, number | null]>).map(([label, value]) => <div className="financial-balance-line" key={label}>
                      <div><span>{label}</span><strong>{formatCurrency(value)}</strong></div>
                      <span aria-hidden="true"><span style={{ width: balanceShare(value, activeDetailedFinancialStatement.balanceSheetTotal) }} /></span>
                    </div>)}
                  </div>
                  <div>
                    <h4>Financement et dettes</h4>
                    {([
                      ["Capitaux propres", activeDetailedFinancialStatement.equity],
                      ["Dettes financières", activeDetailedFinancialStatement.financialDebt],
                      ["Total des dettes", activeDetailedFinancialStatement.totalDebt],
                      ["Dettes fournisseurs", activeDetailedFinancialStatement.tradePayables],
                      ["Dettes fiscales et sociales", activeDetailedFinancialStatement.taxSocialDebt]
                    ] as Array<[string, number | null]>).map(([label, value]) => <div className="financial-balance-line" key={label}>
                      <div><span>{label}</span><strong>{formatCurrency(value)}</strong></div>
                      <span aria-hidden="true"><span style={{ width: balanceShare(value, activeDetailedFinancialStatement.balanceSheetTotal) }} /></span>
                    </div>)}
                  </div>
                </div>
                {!activeDetailedFinancialStatement.partiallyConfidential ? <div className="financial-income-detail">
                  <div className="financial-section-heading"><div><h3>Compte de résultat détaillé</h3><p>Montants publiés pour cet exercice</p></div></div>
                  <dl>
                    <div><dt>Résultat d’exploitation</dt><dd data-negative={activeDetailedFinancialStatement.operatingResult !== null && activeDetailedFinancialStatement.operatingResult < 0}>{formatCurrency(activeDetailedFinancialStatement.operatingResult)}</dd></div>
                    <div><dt>Résultat courant avant impôts</dt><dd data-negative={activeDetailedFinancialStatement.currentPreTaxResult !== null && activeDetailedFinancialStatement.currentPreTaxResult < 0}>{formatCurrency(activeDetailedFinancialStatement.currentPreTaxResult)}</dd></div>
                    <div><dt>Charges de personnel</dt><dd>{formatCurrency(activeDetailedFinancialStatement.personnelCosts)}</dd></div>
                    <div><dt>Achats et charges externes</dt><dd>{formatCurrency(activeDetailedFinancialStatement.externalPurchases)}</dd></div>
                    <div><dt>Impôts et taxes d’exploitation</dt><dd>{formatCurrency(activeDetailedFinancialStatement.taxes)}</dd></div>
                    <div><dt>Capital social ou individuel</dt><dd>{formatCurrency(activeDetailedFinancialStatement.capital)}</dd></div>
                  </dl>
                </div> : <div className="financial-detail-restricted"><LockKeyhole size={16} aria-hidden="true" /><span>Le compte de résultat détaillé n’est pas restitué pour ce bilan à diffusion partielle.</span></div>}
                <p className="financial-detail-source">Correspondance exacte SIREN + date de clôture + type de bilan. Définitions: <a href={activeDetailedFinancialStatement.statementType === "S" ? data.detailedFinancials.simplifiedFormUrl : data.detailedFinancials.fullFormUrl} target="_blank" rel="noopener noreferrer">formulaire DGFiP {activeDetailedFinancialStatement.statementType === "S" ? "2033" : "2050–2051"}</a>.</p>
              </section> : data.detailedFinancials.total ? <div className="financial-detail-missing" role="note">
                <Database size={17} aria-hidden="true" />
                <p>Le détail fiscal n’est pas disponible dans cette source pour l’exercice et le type de bilan sélectionnés. Aucun exercice différent n’est fusionné automatiquement.</p>
              </div> : null}

              <section className="financial-trend" aria-labelledby="financial-trend-title">
                <div className="financial-section-heading">
                  <div><h3 id="financial-trend-title">Évolution du chiffre d’affaires</h3><p>{statementTypeLabel(activeFinancialExercise.statementType)} uniquement · exercices non mélangés</p></div>
                  <span>{financialTrend.length} exercice{financialTrend.length > 1 ? "s" : ""}</span>
                </div>
                <div className="financial-trend-list">
                  {financialTrend.map((exercise) => <button type="button" key={exercise.id} aria-pressed={exercise.id === activeFinancialExercise.id} onClick={() => setFinancialExerciseId(exercise.id)}>
                    <span>{new Date(`${exercise.closingDate}T12:00:00Z`).getUTCFullYear()}</span>
                    <span className="financial-bar-track" aria-hidden="true"><span style={{ width: exercise.revenue === null || exercise.revenue <= 0 ? "0" : `${Math.max(2, exercise.revenue / financialRevenueMaximum * 100)}%` }} /></span>
                    <strong>{exercise.revenue === null && exercise.partiallyConfidential ? "Non diffusé" : formatCurrency(exercise.revenue)}</strong>
                    <small data-negative={exercise.netIncome !== null && exercise.netIncome < 0}>RN {formatCurrency(exercise.netIncome)}</small>
                  </button>)}
                </div>
              </section>

              <div className="financial-ratio-groups">
                <section>
                  <div className="financial-section-heading"><div><h3>Structure financière</h3><p>Valeurs publiées, sans seuil d’alerte ajouté.</p></div></div>
                  <dl>
                    <div><dt>Endettement</dt><dd>{formatFinancialValue(activeFinancialExercise.debtRatio, "percent")}</dd></div>
                    <div><dt>Liquidité</dt><dd>{formatFinancialValue(activeFinancialExercise.liquidityRatio, "percent")}</dd></div>
                    <div><dt>Autonomie financière</dt><dd>{formatFinancialValue(activeFinancialExercise.financialAutonomy, "percent")}</dd></div>
                    <div><dt>Capacité de remboursement</dt><dd>{formatFinancialValue(activeFinancialExercise.repaymentCapacity, "ratio")}</dd></div>
                    <div><dt>Couverture des intérêts</dt><dd>{formatFinancialValue(activeFinancialExercise.interestCoverage, "ratio")}</dd></div>
                    <div><dt>Vétusté des immobilisations</dt><dd>{formatFinancialValue(activeFinancialExercise.assetAgeRatio, "percent")}</dd></div>
                  </dl>
                </section>
                <section>
                  <div className="financial-section-heading"><div><h3>Cycle d’exploitation</h3><p>Délais et besoin en fonds de roulement.</p></div></div>
                  <dl>
                    <div><dt>BFR d’exploitation</dt><dd>{formatFinancialValue(activeFinancialExercise.operatingWorkingCapitalDays, "days")}</dd></div>
                    <div><dt>Rotation des stocks</dt><dd>{formatFinancialValue(activeFinancialExercise.stockRotationDays, "days")}</dd></div>
                    <div><dt>Crédit clients</dt><dd>{formatFinancialValue(activeFinancialExercise.customerCreditDays, "days")}</dd></div>
                    <div><dt>Crédit fournisseurs</dt><dd>{formatFinancialValue(activeFinancialExercise.supplierCreditDays, "days")}</dd></div>
                    <div><dt>CAF / chiffre d’affaires</dt><dd>{formatFinancialValue(activeFinancialExercise.cashFlowToRevenue, "percent")}</dd></div>
                    <div><dt>Résultat courant / CA</dt><dd>{formatFinancialValue(activeFinancialExercise.currentPreTaxToRevenue, "percent")}</dd></div>
                  </dl>
                </section>
              </div>

              {data.financialRatios.definitions.length ? <details className="financial-definitions">
                <summary>Définitions et formules officielles des indicateurs</summary>
                <div>
                  {data.financialRatios.definitions.map((definition) => <article key={definition.field}>
                    <h4>{definition.label.replaceAll("_", " ")}</h4>
                    {definition.description ? <p>{definition.description.split("\n")[0].replace(/^[- ]+/, "")}</p> : null}
                    <code>{activeFinancialExercise.statementType === "S" ? definition.formulaSimplified : definition.formulaCompleteOrConsolidated}</code>
                  </article>)}
                </div>
              </details> : null}
            </div>

            <aside className="financial-analysis-method">
              <h3>Lecture de l’exercice</h3>
              <div className="financial-statement-badge" data-type={activeFinancialExercise.statementType}>
                <strong>{activeFinancialExercise.statementType}</strong>
                <span>Bilan {statementTypeLabel(activeFinancialExercise.statementType).toLocaleLowerCase("fr")}</span>
              </div>
              <dl>
                <div><dt>Clôture</dt><dd>{formatDate(activeFinancialExercise.closingDate)}</dd></div>
                <div><dt>Diffusion</dt><dd>{activeFinancialExercise.partiallyConfidential ? "Partielle" : activeFinancialExercise.confidentiality}</dd></div>
                <div><dt>Indicateurs renseignés</dt><dd>{activeFinancialExercise.metricCount} / {activeFinancialExercise.id.startsWith("detail:") ? 24 : 19}</dd></div>
                <div><dt>Période couverte</dt><dd>{formatDate(data.financialRatios.earliestClosingDate ?? data.detailedFinancials.earliestClosingDate)} – {formatDate(data.financialRatios.latestClosingDate ?? data.detailedFinancials.latestClosingDate)}</dd></div>
                <div><dt>Exercices de l’entreprise</dt><dd>{financialExercises.length}</dd></div>
              </dl>
              <div className="financial-method-warning">
                <CircleAlert size={17} aria-hidden="true" />
                <p>Ces ratios ne constituent ni un score de crédit, ni une recommandation, ni une évaluation de la santé financière.</p>
              </div>
              {data.financialRatios.total ? <><p className="small muted">Index territorial : {formatNumber(data.financialRatios.indexedExerciseCount, 0)} exercices pour {formatNumber(data.financialRatios.matchedCompanyCount, 0)} entreprises. Source nationale : {formatNumber(data.financialRatios.sourceRowCount, 0)} lignes.</p>
              <p className="small muted">Source mise à jour le {formatDate(data.financialRatios.sourceUpdatedAt)} · {data.financialRatios.license}.</p></> : null}
              {data.detailedFinancials.total ? <p className="small muted">Bilans détaillés : {formatNumber(data.detailedFinancials.indexedStatementCount, 0)} exercices pour {formatNumber(data.detailedFinancials.matchedCompanyCount, 0)} entreprises · source du {formatDate(data.detailedFinancials.sourceUpdatedAt)}.</p> : null}
            </aside>
          </div> : null}

          {tab === "environment" ? <div className="icpe-layout">
            <div className="icpe-main">
              <div className="bi-subheading">
                <div>
                  <h3>Installations et activité réglementée</h3>
                  <p>Sites reliés par SIRET exact au registre public quotidien des installations classées Géorisques.</p>
                </div>
                <a href={data.environmentalCompliance.sourceUrl} target="_blank" rel="noopener noreferrer">Source Géorisques <ExternalLink size={14} aria-hidden="true" /></a>
              </div>

              <div className="icpe-scope-note" role="note">
                <FlaskConical size={18} aria-hidden="true" />
                <p>Un classement ICPE ou une inspection décrit un cadre réglementaire. Il ne prouve ni incident, ni infraction, ni mauvaise performance environnementale.</p>
              </div>

              <div className="icpe-metrics" aria-label="Indicateurs des installations classées">
                <div><strong>{data.environmentalCompliance.total}</strong><span>installations</span></div>
                <div><strong>{data.environmentalCompliance.authorizationCount}</strong><span>autorisations</span></div>
                <div><strong>{data.environmentalCompliance.inspectionCount}</strong><span>inspections publiées</span></div>
                <div><strong>{data.environmentalCompliance.rubricCount}</strong><span>rubriques ICPE</span></div>
              </div>

              <div className="icpe-installations">
                {data.environmentalCompliance.installations.map((installation) => <article className="icpe-installation" key={installation.id}>
                  <div className="icpe-installation-heading">
                    <div>
                      <span>AIOT {installation.aiotCode}</span>
                      <h3>{installation.commune ?? `Installation ${installation.aiotCode}`}</h3>
                    </div>
                    <div className="icpe-statuses">
                      <span data-tone="regime">{installation.regime ?? "Régime non renseigné"}</span>
                      {installation.sevesoStatus ? <span data-tone={installation.sevesoStatus.startsWith("Seveso") ? "seveso" : "neutral"}>{installation.sevesoStatus}</span> : null}
                      {installation.ied ? <span data-tone="ied">IED</span> : null}
                    </div>
                  </div>

                  <div className="icpe-facts">
                    <span><MapPin size={14} aria-hidden="true" />{installation.address ?? "Adresse non renseignée"}</span>
                    <span><ShieldCheck size={14} aria-hidden="true" />{installation.activityStatus ?? "État d’activité non renseigné"}</span>
                    <span><Database size={14} aria-hidden="true" />SIRET {installation.siret}</span>
                  </div>
                  <div className="icpe-chips">
                    <span>{installation.matchScope === "exact_active_siret" ? "Établissement actif exact" : "SIRET historique de l’unité légale"}</span>
                    {installation.categories.map((category) => <span key={category}>{category}</span>)}
                    {installation.nationalPriority ? <span>Priorité nationale</span> : null}
                  </div>

                  {installation.rubrics.length ? <details className="icpe-details">
                    <summary>{installation.rubrics.length} rubrique{installation.rubrics.length > 1 ? "s" : ""} réglementaire{installation.rubrics.length > 1 ? "s" : ""}</summary>
                    <div className="icpe-rubrics">
                      {installation.rubrics.map((rubric) => <div key={rubric.id}>
                        <strong>{rubric.number}{rubric.paragraph ? ` · ${rubric.paragraph}` : ""}</strong>
                        <span>{rubric.nature ?? "Nature non renseignée"}</span>
                        <small>{[rubric.authorizedRegime, rubric.totalQuantity && rubric.unit ? `${rubric.totalQuantity} ${rubric.unit}` : rubric.totalQuantity].filter(Boolean).join(" · ")}</small>
                      </div>)}
                    </div>
                  </details> : null}

                  {installation.inspections.length ? <details className="icpe-details">
                    <summary>{installation.inspections.length} inspection{installation.inspections.length > 1 ? "s" : ""} publiée{installation.inspections.length > 1 ? "s" : ""}</summary>
                    <div className="icpe-timeline">
                      {installation.inspections.map((inspection) => <div key={inspection.id}>
                        <time>{formatDate(inspection.inspectionDate)}</time>
                        <span>{inspection.documentType ?? "Inspection Géorisques"}</span>
                        {inspection.documentUrl ? <a href={inspection.documentUrl} target="_blank" rel="noopener noreferrer">Rapport public <ExternalLink size={12} aria-hidden="true" /></a> : <small>Rapport non diffusé</small>}
                      </div>)}
                    </div>
                  </details> : null}

                  {installation.documents.length ? <details className="icpe-details">
                    <summary>{installation.documents.length} document{installation.documents.length > 1 ? "s" : ""} administratif{installation.documents.length > 1 ? "s" : ""}</summary>
                    <div className="icpe-documents">
                      {installation.documents.map((document) => <div key={document.id}>
                        <span>{document.documentType ?? "Document Géorisques"}</span>
                        <time>{formatDate(document.documentDate)}</time>
                        {document.documentUrl ? <a href={document.documentUrl} target="_blank" rel="noopener noreferrer">Consulter <ExternalLink size={12} aria-hidden="true" /></a> : null}
                      </div>)}
                    </div>
                  </details> : null}

                  <div className="icpe-footer">
                    <span>Mis à jour le {formatDate(installation.sourceUpdatedAt)} · {installation.inspectionService ?? "Service d’inspection non renseigné"}</span>
                    <a href={installation.detailUrl} target="_blank" rel="noopener noreferrer">Fiche complète <ExternalLink size={13} aria-hidden="true" /></a>
                  </div>
                </article>)}
              </div>
            </div>

            <aside className="icpe-method">
              <h3>Lecture réglementaire</h3>
              <dl>
                <div><dt>SIRET actifs</dt><dd>{data.environmentalCompliance.activeSiretCount}</dd></div>
                <div><dt>Enregistrements</dt><dd>{data.environmentalCompliance.registrationCount}</dd></div>
                <div><dt>Sites Seveso</dt><dd>{data.environmentalCompliance.sevesoCount}</dd></div>
                <div><dt>Sites IED</dt><dd>{data.environmentalCompliance.iedCount}</dd></div>
                <div><dt>Priorité nationale</dt><dd>{data.environmentalCompliance.nationalPriorityCount}</dd></div>
                <div><dt>Dernière inspection</dt><dd>{formatDate(data.environmentalCompliance.latestInspectionDate)}</dd></div>
              </dl>
              <div className="financial-method-warning">
                <CircleAlert size={17} aria-hidden="true" />
                <p>L’absence de ligne ne prouve pas l’absence d’activité réglementée. La base publique ne couvre pas uniformément tous les régimes déclaratifs.</p>
              </div>
              <p className="small muted">Index territorial : {formatNumber(data.environmentalCompliance.indexedInstallationCount, 0)} installations pour {formatNumber(data.environmentalCompliance.matchedCompanyCount, 0)} entreprises.</p>
              <p className="small muted">Source mise à jour le {formatDate(data.environmentalCompliance.sourceUpdatedAt)} · {data.environmentalCompliance.license}.</p>
            </aside>
          </div> : null}

          {tab === "profile" ? <div className="bi-profile">
            <div className="bi-profile-main">
              <div className="bi-subheading">
                <div>
                  <h3>Comptes publiés</h3>
                  <p>Chiffre d’affaires et résultat net disponibles dans l’Annuaire des Entreprises.</p>
                </div>
                {data.annuaire.sourceUrl ? <a href={data.annuaire.sourceUrl} target="_blank" rel="noopener noreferrer">Source officielle <ExternalLink size={14} aria-hidden="true" /></a> : null}
              </div>
              {data.annuaire.financials.length ? <div className="financial-table" role="table" aria-label="Comptes publiés">
                <div className="financial-row financial-header" role="row">
                  <span role="columnheader">Exercice</span><span role="columnheader">Chiffre d’affaires</span><span role="columnheader">Résultat net</span>
                </div>
                {data.annuaire.financials.map((financial) => <div className="financial-row" role="row" key={financial.year}>
                  <strong role="cell">{financial.year}</strong><span role="cell">{formatCurrency(financial.revenue)}</span><span role="cell" data-negative={financial.netIncome !== null && financial.netIncome < 0}>{formatCurrency(financial.netIncome)}</span>
                </div>)}
              </div> : <p className="empty-state compact">Aucun compte financier publié n’a été trouvé pour ce SIREN.</p>}
            </div>

            <aside className="bi-profile-side">
              <div>
                <h3>Profil public</h3>
                <dl className="profile-facts">
                  <div><dt>Catégorie</dt><dd>{data.annuaire.companyCategory ?? "Non renseignée"}</dd></div>
                  <div><dt>Tranche d’effectif</dt><dd>{data.annuaire.workforceBand ? `${data.annuaire.workforceBand}${data.annuaire.workforceYear ? ` · ${data.annuaire.workforceYear}` : ""}` : "Non renseignée"}</dd></div>
                  <div><dt>Établissements</dt><dd>{data.annuaire.establishments ?? "Non renseigné"}{data.annuaire.openEstablishments !== null && data.annuaire.openEstablishments !== undefined ? ` · ${data.annuaire.openEstablishments} ouvert(s)` : ""}</dd></div>
                  <div><dt>Activité NAF 2025</dt><dd>{data.annuaire.naf25 ?? "Non renseignée"}</dd></div>
                  <div><dt>Convention renseignée</dt><dd>{data.annuaire.collectiveAgreementReported === undefined ? "Non documenté" : data.annuaire.collectiveAgreementReported ? "Oui" : "Non signalée"}</dd></div>
                </dl>
              </div>
              <div>
                <h3>Labels et signaux publiés</h3>
                {data.annuaire.labels.length || data.annuaire.aidSignals.length ? <ul className="signal-list">
                  {[...data.annuaire.labels, ...data.annuaire.aidSignals].map((label) => <li key={label}>{label}</li>)}
                </ul> : <p className="muted small">Aucun label ou signal d’aide identifié dans cette source. Cela ne prouve pas leur absence.</p>}
              </div>
              <div>
                <h3>Conventions collectives</h3>
                {data.annuaire.agreements.length ? <p>{data.annuaire.agreements.join(" · ")}</p> : <p className="muted small">Aucun identifiant IDCC publié.</p>}
              </div>
            </aside>
          </div> : null}

          {tab === "grants" ? <div className="grant-layout">
            <div className="grant-main">
              <div className="bi-subheading">
                <div>
                  <h3>Conventions de subvention publiées</h3>
                  <p>Attributions SCDL reliées exactement à l’unité légale par SIRET ou RNA.</p>
                </div>
                <a href={data.publicGrants.catalogUrl} target="_blank" rel="noopener noreferrer">Catalogue data.gouv.fr <ExternalLink size={14} aria-hidden="true" /></a>
              </div>

              <div className="grant-metrics">
                <div><Landmark size={17} aria-hidden="true" /><strong>{data.publicGrants.total}</strong><span>conventions uniques</span></div>
                <div><Scale size={17} aria-hidden="true" /><strong>{formatCurrency(data.publicGrants.totalAmount)}</strong><span>cumul publié</span></div>
                <div><Building2 size={17} aria-hidden="true" /><strong>{data.publicGrants.authorityCount}</strong><span>attribuants identifiés</span></div>
                <div><Database size={17} aria-hidden="true" /><strong>{data.publicGrants.sourceCount}</strong><span>jeux sources</span></div>
              </div>

              <div className="grant-warning" role="note">
                <CircleAlert size={18} aria-hidden="true" />
                <p>Montants attribués tels que publiés, sans preuve de versement. Une convention liée à un ancien SIRET peut concerner une implantation hors Guadeloupe de la même unité légale.</p>
              </div>

              <div className="grant-list">
                {data.publicGrants.grants.map((grant) => <article className="grant-row" key={grant.id}>
                  <div className="grant-row-heading">
                    <div>
                      <span>{formatDate(grant.conventionDate)} · {grant.awardingAuthority ?? "Attribuant non renseigné"}</span>
                      <h3>{grant.purpose}</h3>
                    </div>
                    <strong>{formatCurrency(grant.amount)}</strong>
                  </div>
                  <p className="grant-beneficiary">Bénéficiaire publié : {grant.beneficiaryName}</p>
                  <dl className="grant-facts">
                    <div><dt>Périmètre</dt><dd>{grantScopeLabel(grant.beneficiaryScope)}</dd></div>
                    <div><dt>Identifiant</dt><dd>{grant.siret ? `SIRET ${grant.siret}` : grant.rnaId ? `RNA ${grant.rnaId}` : "Non renseigné"}</dd></div>
                    {grant.nature ? <div><dt>Nature</dt><dd>{grant.nature}</dd></div> : null}
                    {grant.paymentPeriod ? <div><dt>Période publiée</dt><dd>{grant.paymentPeriod}</dd></div> : null}
                    {grant.decisionReference ? <div><dt>Décision</dt><dd>{grant.decisionReference}</dd></div> : null}
                    <div><dt>Confiance de jointure</dt><dd>{Math.round(grant.matchConfidence * 100)} %</dd></div>
                  </dl>
                  <div className="grant-source-row">
                    {grant.datasetUrl ? <a href={grant.datasetUrl} target="_blank" rel="noopener noreferrer">{grant.datasetTitle ?? "Jeu de données source"} <ExternalLink size={13} aria-hidden="true" /></a> : null}
                    <span>{grant.license ?? "Licence non renseignée"}{grant.sourceOccurrenceCount > 1 ? ` · ${grant.sourceOccurrenceCount} occurrences sources` : ""}</span>
                  </div>
                </article>)}
              </div>
              {data.publicGrants.truncated ? <p className="small muted">Les {data.publicGrants.displayedCount} conventions les plus récentes sont affichées sur {data.publicGrants.total}.</p> : null}
            </div>

            <aside className="grant-method">
              <h3>Couverture et méthode</h3>
              <p>Seuls les CSV associés au schéma SCDL et à une licence ouverte explicite sont importés. Les noms seuls ne servent jamais à créer une correspondance.</p>
              <dl className="profile-facts">
                <div><dt>Jeux catalogués</dt><dd>{data.publicGrants.catalogDatasetCount}</dd></div>
                <div><dt>Jeux sous licence ouverte</dt><dd>{data.publicGrants.openDatasetCount}</dd></div>
                <div><dt>Ressources CSV auditées</dt><dd>{data.publicGrants.importedResourceCount}</dd></div>
                <div><dt>SIRET hors stock actif local</dt><dd>{data.publicGrants.historicalEstablishmentCount}</dd></div>
              </dl>
              <p className="small muted">Période trouvée : {formatDate(data.publicGrants.earliestDate)} → {formatDate(data.publicGrants.latestDate)}.</p>
              <p className="small muted">L’absence de convention ne prouve pas l’absence d’aide publique : la publication SCDL est partielle et soumise à des obligations et seuils.</p>
              <a href={data.publicGrants.schemaUrl} target="_blank" rel="noopener noreferrer">Documentation du schéma SCDL <ExternalLink size={13} aria-hidden="true" /></a>
            </aside>
          </div> : null}

          {tab === "ademeAids" ? <div className="grant-layout">
            <div className="grant-main">
              <div className="bi-subheading">
                <div>
                  <h3>Dossiers d’aides financières ADEME</h3>
                  <p>Subventions et aides remboursables engagées depuis 2021, reliées par SIRET exact.</p>
                </div>
                <a href={data.ademeAids.sourceUrl} target="_blank" rel="noopener noreferrer">Source ADEME <ExternalLink size={14} aria-hidden="true" /></a>
              </div>

              <div className="grant-metrics ademe-aid-metrics">
                <div><MapPin size={17} aria-hidden="true" /><strong>{data.ademeAids.activeLocalCount}</strong><span>aides sur SIRET actif local</span></div>
                <div><Scale size={17} aria-hidden="true" /><strong>{formatCurrency(data.ademeAids.activeLocalAmount)}</strong><span>engagé sur SIRET actif local</span></div>
                <div><Building2 size={17} aria-hidden="true" /><strong>{data.ademeAids.companyScopeCount}</strong><span>autres SIRET de l’unité légale</span></div>
                <div><Database size={17} aria-hidden="true" /><strong>{data.ademeAids.schemeCount}</strong><span>dispositifs identifiés</span></div>
              </div>

              <div className="grant-warning" role="note">
                <CircleAlert size={18} aria-hidden="true" />
                <p>Les montants sont des engagements publiés par l’ADEME. Ils ne prouvent pas le décaissement intégral. Les lignes d’un autre SIRET sont des signaux nationaux de l’unité légale et sont séparées des implantations actives en Guadeloupe.</p>
              </div>

              <div className="grant-list">
                {data.ademeAids.aids.map((aid) => <article className="grant-row ademe-aid-row" data-scope={aid.scope} key={aid.id}>
                  <div className="grant-row-heading">
                    <div>
                      <span>{formatDate(aid.conventionDate)} · {aid.awardingAuthority ?? "ADEME"}</span>
                      <h3>{aid.purpose}</h3>
                    </div>
                    <strong>{formatCurrency(aid.amount)}</strong>
                  </div>
                  <div className="aid-scope" data-scope={aid.scope}><MapPin size={13} aria-hidden="true" /> {ademeAidScopeLabel(aid.scope)}</div>
                  <p className="grant-beneficiary">Bénéficiaire publié : {aid.beneficiaryName}</p>
                  {aid.aidScheme ? <p className="aid-scheme">{aid.aidScheme}</p> : null}
                  <dl className="grant-facts">
                    <div><dt>SIRET bénéficiaire</dt><dd>{aid.siret}</dd></div>
                    {aid.nature ? <div><dt>Nature</dt><dd>{aid.nature}</dd></div> : null}
                    {aid.paymentConditions ? <div><dt>Versement publié</dt><dd>{aid.paymentConditions}</dd></div> : null}
                    {aid.paymentPeriod ? <div><dt>Date ou période publiée</dt><dd>{aid.paymentPeriod}</dd></div> : null}
                    {aid.decisionReference ? <div><dt>Décision</dt><dd>{aid.decisionReference}</dd></div> : null}
                    <div><dt>Confiance de jointure</dt><dd>{Math.round(aid.matchConfidence * 100)} %</dd></div>
                  </dl>
                  <div className="grant-source-row">
                    <a href={aid.dataGouvUrl} target="_blank" rel="noopener noreferrer">Jeu de données ADEME <ExternalLink size={13} aria-hidden="true" /></a>
                    <span>{aid.license}</span>
                  </div>
                </article>)}
              </div>
              {data.ademeAids.truncated ? <p className="small muted">Les {data.ademeAids.displayedCount} dossiers prioritaires sont affichés sur {data.ademeAids.total}; les SIRET actifs locaux apparaissent en premier.</p> : null}
            </div>

            <aside className="grant-method">
              <h3>Lecture des montants</h3>
              <p>Le cumul national de l’unité légale est {formatCurrency(data.ademeAids.totalAmount)}. La part associée aux SIRET actuellement actifs en Guadeloupe est isolée à {formatCurrency(data.ademeAids.activeLocalAmount)}.</p>
              <dl className="profile-facts">
                <div><dt>Dossiers pour l’unité légale</dt><dd>{data.ademeAids.total}</dd></div>
                <div><dt>SIRET actifs locaux</dt><dd>{data.ademeAids.activeLocalCount}</dd></div>
                <div><dt>Autres SIRET</dt><dd>{data.ademeAids.companyScopeCount}</dd></div>
                <div><dt>Lignes dans la source</dt><dd>{data.ademeAids.sourceRowCount}</dd></div>
              </dl>
              <p className="small muted">Période trouvée : {formatDate(data.ademeAids.earliestDate)} → {formatDate(data.ademeAids.latestDate)}.</p>
              <p className="small muted">Source mise à jour le {formatDate(data.ademeAids.sourceUpdatedAt)} · {data.ademeAids.license}.</p>
              <a href={data.ademeAids.dataGouvUrl} target="_blank" rel="noopener noreferrer">Métadonnées data.gouv.fr <ExternalLink size={13} aria-hidden="true" /></a>
            </aside>
          </div> : null}

          {tab === "fondsVert" ? <div className="grant-layout">
            <div className="grant-main">
              <div className="bi-subheading">
                <div>
                  <h3>Projets financés par le Fonds vert</h3>
                  <p>Projets engagés entre 2023 et 2025, reliés au bénéficiaire par SIREN ou SIRET exact.</p>
                </div>
                <a href={data.fondsVert.sourceUrl} target="_blank" rel="noopener noreferrer">Source ministérielle <ExternalLink size={14} aria-hidden="true" /></a>
              </div>

              <div className="grant-metrics fonds-vert-metrics">
                <div><MapPin size={17} aria-hidden="true" /><strong>{data.fondsVert.guadeloupeCount}</strong><span>projets localisés en Guadeloupe</span></div>
                <div><Scale size={17} aria-hidden="true" /><strong>{formatCurrency(data.fondsVert.guadeloupeAmount)}</strong><span>engagé sur les projets guadeloupéens</span></div>
                <div><Globe2 size={17} aria-hidden="true" /><strong>{data.fondsVert.outsideCount}</strong><span>projets de l’unité légale hors Guadeloupe</span></div>
                <div><Database size={17} aria-hidden="true" /><strong>{data.fondsVert.schemeCount}</strong><span>mesures identifiées</span></div>
              </div>

              <div className="grant-warning" role="note">
                <CircleAlert size={18} aria-hidden="true" />
                <p>Le montant est un engagement Fonds vert publié, pas une preuve de paiement. La localisation repose sur les codes département et commune du projet; la source signale que certains codes peuvent correspondre au porteur plutôt qu’au lieu réel.</p>
              </div>

              <div className="grant-list">
                {data.fondsVert.projects.map((project) => <article className="grant-row fonds-vert-row" data-location={project.projectLocationScope} key={project.id}>
                  <div className="grant-row-heading">
                    <div>
                      <span>Millésime {project.year}{project.scheme ? ` · ${project.scheme}` : ""}</span>
                      <h3>{project.projectName}</h3>
                    </div>
                    <strong>{formatCurrency(project.committedAmount)}</strong>
                  </div>
                  <div className="project-scope" data-location={project.projectLocationScope}><MapPin size={13} aria-hidden="true" /> {fondsVertLocationLabel(project.projectLocationScope)}</div>
                  <p className="grant-beneficiary">Bénéficiaire publié : {project.beneficiaryName}</p>
                  {project.projectSummary ? <p className="fonds-vert-summary">{project.projectSummary}</p> : null}
                  <dl className="grant-facts">
                    <div><dt>Lieu publié</dt><dd>{[project.commune, project.department].filter(Boolean).join(" · ") || "Non renseigné"}</dd></div>
                    <div><dt>Identifiant exact</dt><dd>{project.identifierType.toUpperCase()} {project.beneficiaryIdentifier}</dd></div>
                    <div><dt>Périmètre de jointure</dt><dd>{fondsVertMatchLabel(project.matchScope)}</dd></div>
                    {project.operator ? <div><dt>Opérateur</dt><dd>{project.operator}</dd></div> : null}
                    {project.dossierNumber ? <div><dt>Dossier</dt><dd>{project.dossierNumber}</dd></div> : null}
                    {project.commitmentNumber ? <div><dt>Engagement juridique</dt><dd>{project.commitmentNumber}</dd></div> : null}
                    <div><dt>Confiance de jointure</dt><dd>{Math.round(project.matchConfidence * 100)} %</dd></div>
                  </dl>
                  <div className="grant-source-row">
                    <a href={project.resourceUrl} target="_blank" rel="noopener noreferrer">{project.resourceTitle} <ExternalLink size={13} aria-hidden="true" /></a>
                    <span>{project.license}</span>
                  </div>
                </article>)}
              </div>
              {data.fondsVert.truncated ? <p className="small muted">Les {data.fondsVert.displayedCount} projets prioritaires sont affichés sur {data.fondsVert.total}; les projets guadeloupéens apparaissent en premier.</p> : null}
            </div>

            <aside className="grant-method">
              <h3>Lecture territoriale</h3>
              <p>Le cumul de tous les projets liés à cette unité légale est {formatCurrency(data.fondsVert.totalAmount)}. Seuls {formatCurrency(data.fondsVert.guadeloupeAmount)} sont associés à un code projet guadeloupéen dans la source.</p>
              <dl className="profile-facts">
                <div><dt>Projets pour l’unité légale</dt><dd>{data.fondsVert.total}</dd></div>
                <div><dt>Projets en Guadeloupe</dt><dd>{data.fondsVert.guadeloupeCount}</dd></div>
                <div><dt>SIRET actifs locaux exacts</dt><dd>{data.fondsVert.activeLocalCount}</dd></div>
                <div><dt>Projets hors Guadeloupe</dt><dd>{data.fondsVert.outsideCount}</dd></div>
                <div><dt>Lignes sources auditées</dt><dd>{data.fondsVert.sourceRowCount}</dd></div>
                <div><dt>CSV importés</dt><dd>{data.fondsVert.resourceCount}</dd></div>
              </dl>
              <p className="small muted">Millésimes trouvés : {data.fondsVert.earliestYear ?? "—"} → {data.fondsVert.latestYear ?? "—"}.</p>
              <p className="small muted">Source mise à jour le {formatDate(data.fondsVert.sourceUpdatedAt)} · {data.fondsVert.license}. Le CSV biodiversité sans identifiant bénéficiaire est exclu du rapprochement automatique.</p>
              <a href={data.fondsVert.sourceUrl} target="_blank" rel="noopener noreferrer">Méthodologie et métadonnées <ExternalLink size={13} aria-hidden="true" /></a>
            </aside>
          </div> : null}

          {tab === "franceRelance" ? <div className="grant-layout">
            <div className="grant-main">
              <div className="bi-subheading">
                <div>
                  <h3>Projets industriels France Relance</h3>
                  <p>Projets lauréats reliés au bénéficiaire par SIREN ou SIRET exact, avec leur description publique lorsqu’elle existe.</p>
                </div>
                <a href={data.franceRelance.sourceUrl} target="_blank" rel="noopener noreferrer">Source DGE <ExternalLink size={14} aria-hidden="true" /></a>
              </div>

              <div className="grant-metrics france-relance-metrics">
                <div><MapPin size={17} aria-hidden="true" /><strong>{data.franceRelance.guadeloupeCount}</strong><span>projets localisés en Guadeloupe</span></div>
                <div><Globe2 size={17} aria-hidden="true" /><strong>{data.franceRelance.outsideCount}</strong><span>projets de l’unité légale hors Guadeloupe</span></div>
                <div><Database size={17} aria-hidden="true" /><strong>{data.franceRelance.descriptionCount}</strong><span>descriptions publiques disponibles</span></div>
                <div><Activity size={17} aria-hidden="true" /><strong>{data.franceRelance.sectorCount}</strong><span>filières industrielles identifiées</span></div>
              </div>

              <div className="grant-warning" role="note">
                <CircleAlert size={18} aria-hidden="true" />
                <p>Le jeu utilisé identifie des projets lauréats, mais ne publie aucun montant individuel. Une description peut concerner un projet collaboratif et citer plusieurs partenaires; elle n’est donc jamais transformée en description commerciale de l’entreprise.</p>
              </div>

              <div className="grant-list">
                {data.franceRelance.projects.map((project) => <article className="grant-row france-relance-row" data-location={project.projectLocationScope} key={project.id}>
                  <div className="grant-row-heading">
                    <div>
                      <span>{formatDate(project.updateDate)}{project.measureLabel ? ` · ${project.measureLabel}` : ""}</span>
                      <h3>{project.measure}</h3>
                    </div>
                    <span className="relance-sector-tag">{project.sector ?? "Projet industriel"}</span>
                  </div>
                  <div className="project-scope" data-location={project.projectLocationScope}><MapPin size={13} aria-hidden="true" /> {franceRelanceLocationLabel(project.projectLocationScope)}</div>
                  <p className="grant-beneficiary">Lauréat publié : {project.beneficiaryName}</p>
                  {project.projectDescription ? <p className="france-relance-summary">{project.projectDescription}</p> : <p className="small muted">Description détaillée non publiée dans ce jeu.</p>}
                  <dl className="grant-facts">
                    <div><dt>Lieu publié</dt><dd>{[project.commune, project.department].filter(Boolean).join(" · ") || "Non renseigné"}</dd></div>
                    <div><dt>Identifiant exact</dt><dd>{project.identifierType.toUpperCase()} {project.beneficiaryIdentifier}</dd></div>
                    <div><dt>Périmètre de jointure</dt><dd>{franceRelanceMatchLabel(project.matchScope)}</dd></div>
                    {project.companyType ? <div><dt>Type publié</dt><dd>{project.companyType}</dd></div> : null}
                    {project.recoveryAxis ? <div><dt>Volet du plan</dt><dd>{project.recoveryAxis}</dd></div> : null}
                    {project.expectedCo2Tonnes !== null ? <div><dt>CO₂ évité publié</dt><dd>{formatNumber(project.expectedCo2Tonnes)} t équivalent CO₂</dd></div> : null}
                    <div><dt>Confiance de jointure</dt><dd>{Math.round(project.matchConfidence * 100)} %</dd></div>
                  </dl>
                  <div className="grant-source-row">
                    <a href={project.portalUrl} target="_blank" rel="noopener noreferrer">{project.resourceTitle} <ExternalLink size={13} aria-hidden="true" /></a>
                    <span>{project.license}</span>
                  </div>
                </article>)}
              </div>
              {data.franceRelance.truncated ? <p className="small muted">Les {data.franceRelance.displayedCount} projets prioritaires sont affichés sur {data.franceRelance.total}; les projets guadeloupéens apparaissent en premier.</p> : null}
            </div>

            <aside className="grant-method">
              <h3>Lecture territoriale</h3>
              <p>La présence de l’unité légale en Guadeloupe ne suffit pas à localiser un projet dans l’archipel. Le département publié reste la référence territoriale de chaque ligne.</p>
              <dl className="profile-facts">
                <div><dt>Projets pour l’unité légale</dt><dd>{data.franceRelance.total}</dd></div>
                <div><dt>Projets en Guadeloupe</dt><dd>{data.franceRelance.guadeloupeCount}</dd></div>
                <div><dt>SIRET actifs locaux exacts</dt><dd>{data.franceRelance.activeLocalCount}</dd></div>
                <div><dt>Projets hors Guadeloupe</dt><dd>{data.franceRelance.outsideCount}</dd></div>
                <div><dt>Mesures distinctes</dt><dd>{data.franceRelance.measureCount}</dd></div>
                <div><dt>Indicateurs CO₂ publiés</dt><dd>{data.franceRelance.co2MetricCount}</dd></div>
                <div><dt>Lignes sources auditées</dt><dd>{data.franceRelance.sourceRowCount}</dd></div>
              </dl>
              <p className="small muted">Dates de mise à jour des projets : {formatDate(data.franceRelance.earliestDate)} → {formatDate(data.franceRelance.latestDate)}.</p>
              <p className="small muted">Jeu mis à jour le {formatDate(data.franceRelance.sourceUpdatedAt)} · {data.franceRelance.license}. Montants individuels : non publiés.</p>
              <a href={data.franceRelance.sourceUrl} target="_blank" rel="noopener noreferrer">Méthodologie et métadonnées <ExternalLink size={13} aria-hidden="true" /></a>
            </aside>
          </div> : null}

          {tab === "qualifications" ? <div className="qualification-layout">
            <div className="qualification-main">
              <div className="bi-subheading">
                <div>
                  <h3>Qualifications RGE publiées</h3>
                  <p>Domaines de travaux, organismes et périodes de validité issus de l’ADEME.</p>
                </div>
                <a href={data.rge.sourceUrl} target="_blank" rel="noopener noreferrer">Source ADEME <ExternalLink size={14} aria-hidden="true" /></a>
              </div>

              <div className="qualification-metrics">
                <div><ShieldCheck size={17} aria-hidden="true" /><strong>{data.rge.activeCount}</strong><span>qualifications actives</span></div>
                <div><Clock3 size={17} aria-hidden="true" /><strong>{data.rge.historicalCount}</strong><span>qualifications historiques</span></div>
                <div><Building2 size={17} aria-hidden="true" /><strong>{data.rge.domains.length}</strong><span>domaines de travaux</span></div>
              </div>

              {data.rge.qualifications.length ? <div className="qualification-list">
                {data.rge.qualifications.map((qualification) => <article className="qualification-row" key={qualification.id}>
                  <div className="qualification-heading">
                    <div>
                      <span className="qualification-meta">{qualification.organization ? formatOsmValue(qualification.organization) : "Organisme non renseigné"}{qualification.qualificationCode ? ` · ${qualification.qualificationCode}` : ""}</span>
                      <h3>{qualification.qualificationName}</h3>
                    </div>
                    <span className="qualification-status" data-status={qualification.status}>{qualification.status === "active" ? "Active" : "Historique"}</span>
                  </div>
                  <p>{qualification.startDate || qualification.endDate ? `Validité publiée : ${formatDate(qualification.startDate)} → ${formatDate(qualification.endDate)}` : "Période non renseignée"}</p>
                  {qualification.domains.length ? <ul className="signal-list compact-signals">
                    {qualification.domains.map((domain) => <li key={domain}>{domain}</li>)}
                  </ul> : null}
                  <div className="presence-links">
                    {qualification.siret ? <span>SIRET {qualification.siret}</span> : null}
                    {qualification.forIndividuals ? <span>Travaux pour particuliers</span> : null}
                    {qualification.certificateUrl ? <a href={qualification.certificateUrl} target="_blank" rel="noopener noreferrer">Voir le certificat <ExternalLink size={13} aria-hidden="true" /></a> : null}
                  </div>
                </article>)}
              </div> : <p className="empty-state">Aucune qualification RGE trouvée pour les SIRET de cette entreprise. Cette absence ne concerne pas les autres certifications possibles.</p>}
            </div>

            <aside className="qualification-method">
              <h3>Portée</h3>
              <p>Les résultats ADEME sont filtrés par préfixe SIREN puis contrôlés par SIRET exact. Les lignes terminées restent visibles comme historique.</p>
              <dl className="profile-facts">
                <div><dt>Organismes</dt><dd>{data.rge.organizations.length}</dd></div>
                <div><dt>Correspondance</dt><dd>SIRET exact</dd></div>
                <div><dt>Confiance</dt><dd>100 %</dd></div>
              </dl>
              <p className="small muted">Dernier enregistrement le {formatDate(data.rge.sourceUpdatedAt)} · {data.rge.license}{data.rge.truncated ? " · résultats plafonnés" : ""}</p>
            </aside>
          </div> : null}

          {tab === "events" ? <div className="bi-list">
            <p className="small muted">{data.bodacc.cacheStatus === "snapshot" ? `Index BODACC local, rafraîchi le ${formatDate(data.bodacc.retrievedAt ?? null)}. Les annonces sont rattachées par SIREN exact.` : "Résultat BODACC récupéré à la demande, rattaché par SIREN exact."}</p>
            {data.bodacc.events.length ? data.bodacc.events.map((event) => <article key={event.id} className="bi-row">
              <div className="timeline-dot" aria-hidden="true" />
              <div>
                <div className="bi-row-meta"><span>{formatDate(event.date)}</span><span>BODACC</span></div>
                <h3>{event.title}</h3>
                <p>{[event.legalForm, event.city, event.capital !== null ? `Capital publié ${formatCurrency(event.capital, event.capitalCurrency)}` : null].filter(Boolean).join(" · ")}</p>
                {event.url ? <a href={event.url} target="_blank" rel="noopener noreferrer">Voir l’annonce <ExternalLink size={14} aria-hidden="true" /></a> : null}
              </div>
            </article>) : <p className="empty-state">Aucune annonce BODACC correspondante.</p>}
          </div> : null}

          {tab === "contracts" ? <div className="bi-list">
            {data.publicContracts.contracts.length ? data.publicContracts.contracts.map((contract) => <article key={contract.id} className="bi-row">
              <div className="timeline-dot contract" aria-hidden="true" />
              <div>
                <div className="bi-row-meta"><span>{formatDate(contract.date)}</span><span>{formatCurrency(contract.amount)}</span></div>
                <h3>{contract.title}</h3>
                <p>{[contract.buyer, contract.cpvLabel, contract.executionPlace, contract.durationMonths ? `${contract.durationMonths} mois` : null].filter(Boolean).join(" · ")}</p>
                <a href={contract.sourceUrl} target="_blank" rel="noopener noreferrer">Source DECP <ExternalLink size={14} aria-hidden="true" /></a>
              </div>
            </article>) : <p className="empty-state">Aucun marché public attribué trouvé dans la source DECP.</p>}
          </div> : null}

          {tab === "recruitment" ? <div className="bi-list">
            <div className="bi-subheading">
              <div>
                <h3>Offres d’emploi publiées</h3>
                <p>Les offres ne sont rattachées à cette fiche que lorsqu’un SIREN ou SIRET correspondant est publié dans la réponse France Travail. Une recherche par nom seule est écartée.</p>
              </div>
              <span className="official-reference">{data.recruitment.identifierMatchedCount} correspondance(s) exacte(s)</span>
            </div>
            {data.recruitment.status === "unavailable" ? <p className="empty-state">Flux France Travail non activé. Configurez un accès API officiel côté serveur pour activer ce signal.</p> : null}
            {data.recruitment.status !== "unavailable" && data.recruitment.offers.length ? data.recruitment.offers.map((offer) => <article key={offer.id} className="bi-row">
              <div className="timeline-dot contract" aria-hidden="true" />
              <div>
                <div className="bi-row-meta"><span>{formatDate(offer.updatedAt ?? offer.createdAt)}</span><span>{offer.contract ?? "Contrat non renseigné"}</span></div>
                <h3>{offer.title}</h3>
                <p>{[offer.location, offer.duration, offer.experience].filter(Boolean).join(" · ") || "Détails complémentaires non renseignés"}</p>
                <a href={offer.sourceUrl} target="_blank" rel="noopener noreferrer">Voir l’offre France Travail <ExternalLink size={14} aria-hidden="true" /></a>
              </div>
            </article>) : null}
            {data.recruitment.status === "empty" ? <p className="empty-state">Aucune offre avec identifiant d’entreprise correspondant dans la réponse courante. {data.recruitment.detail ?? "Une absence ne prouve pas l’absence de recrutement."}</p> : null}
            <p className="small muted">Source : France Travail. Le flux est temps réel mais dépend des offres actives et des conditions de diffusion consenties par les employeurs partenaires.</p>
          </div> : null}

          {tab === "press" ? <div className="bi-list">
            <p className="small muted">{data.press.cacheStatus === "live" ? "Recherche média à la demande, non exhaustive." : data.press.cacheStatus ? `Snapshot média ${data.press.cacheStatus}, récupéré le ${formatDate(data.press.fetchedAt ?? null)}.` : "Recherche média à la demande, non exhaustive."} Une absence de résultat ne prouve pas l’absence de couverture médiatique.</p>
            {data.press.cacheError ? <p className="empty-state compact" role="status">Un fournisseur média n’a pas répondu pour ce snapshot : {data.press.cacheError}</p> : null}
            {data.press.mentions.length ? data.press.mentions.map((mention) => <article key={mention.url} className="bi-row">
              <div className="timeline-dot press" aria-hidden="true" />
              <div>
                <div className="bi-row-meta"><span>{formatDate(mention.publishedAt)}</span><span>{mention.source ?? "Veille média"} · confiance {Math.round(mention.confidence * 100)} %</span></div>
                <h3>{mention.title}</h3>
                <p>{[mention.domain, mention.sourceCountry].filter(Boolean).join(" · ")}</p>
                <a href={mention.url} target="_blank" rel="noopener noreferrer">Lire l’article <ExternalLink size={14} aria-hidden="true" /></a>
              </div>
            </article>) : <p className="empty-state">Aucune mention média suffisamment précise, ou fournisseur temporairement indisponible.</p>}
          </div> : null}
        </div>
      </> : null}
    </section>
  );
}
