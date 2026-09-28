export type ProspectCertification = "gold" | "silver" | "bronze" | "blocked";
export type ProspectContactFilter = "any" | "email" | "phone" | "website" | "no_website";

export type ProspectFactoryFilters = {
  country?: string;
  territory?: string;
  vertical?: string;
  origin?: string;
  certification?: ProspectCertification;
  contact?: ProspectContactFilter;
  minScore?: number;
  query?: string;
};

export type ProspectFactoryRow = {
  warehouseId: string;
  dedupeKey: string;
  companyName: string;
  commercialName: string | null;
  country: string;
  territory: string;
  region: string | null;
  city: string | null;
  vertical: string | null;
  activityDetail: string | null;
  employeeRange: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  fax?: string | null;
  leadScore: number;
  prioritySegment: string | null;
  certification: ProspectCertification;
  qualityReasons: string[];
  recordOrigin: string;
  sourceType: string;
  sourceUrls: string;
  sourceReferenceDate: string | null;
  retrievedAt: string | null;
  administrativeStatus: string | null;
  siren: string | null;
  siret: string | null;
  businessId: string | null;
  tracking?: {
    id: string;
    status: "to_qualify" | "qualified" | "to_contact" | "contacted" | "in_conversation" | "opportunity" | "won" | "lost" | "disqualified";
    priority: "high" | "normal" | "low";
    nextActionAt: string | null;
    updatedAt: string;
  } | null;

  /** Enriched firmographic and targeting fields carried by the serving layer. */
  activityCategory?: string | null;
  employeeCount?: string | null;
  employeeMin?: string | null;
  employeeMax?: string | null;
  employeeDataType?: string | null;
  employeeScope?: string | null;
  employeeYear?: string | null;
  contactType?: string | null;
  websiteStatus?: string | null;
  noWebsiteSignal?: string | null;
  googleReviewCount?: number | null;
  googleRating?: number | null;
  googleMapsUrl?: string | null;
  address?: string | null;
  postalCode?: string | null;
  creationDate?: string | null;
  legalCategory?: string | null;
  employerStatus?: string | null;
  persona?: string | null;
  icp?: string | null;
  approachAngle?: string | null;
  sourceCount?: number | null;
  dataQuality?: string | null;
  employeeDataStatus?: string | null;
  /** Latest public social-capital observation joined by SIREN. */
  capitalSocial?: number | null;
  capitalCurrency?: string | null;
  capitalReferenceDate?: string | null;
  capitalSource?: string | null;
};

export type ProspectQualityDimensionRow = {
  value: string;
  total: number;
  emailCandidates: number;
  phoneCandidates: number;
  websites: number;
  enrichable: number;
  gold: number;
  silver: number;
  bronze: number;
  blocked: number;
};

export type ProspectQualitySnapshot = {
  schemaVersion: number;
  generatedAt: string;
  database: string;
  elapsedMs: number;
  definitions: Record<string, string>;
  summary: {
    total: number;
    identified: number;
    traceable: number;
    joinable: number;
    emailObserved: number;
    emailValidShape: number;
    phoneObserved: number;
    phoneValidShape: number;
    websiteObserved: number;
    enrichable: number;
    contactCandidate: number;
    gold: number;
    silver: number;
    bronze: number;
    blocked: number;
    distinctDedupeKeys: number;
  };
  dimensions: {
    countries: ProspectQualityDimensionRow[];
    territories: ProspectQualityDimensionRow[];
    origins: ProspectQualityDimensionRow[];
    verticals: ProspectQualityDimensionRow[];
  };
};

export type ProspectFactorySearchResponse = {
  rows: ProspectFactoryRow[];
  nextCursor: string | null;
  total: number | null;
  elapsedMs: number;
  cached: boolean;
};

export type ProspectFactoryFacetOption = {
  value: string;
  count: number;
};

export type ProspectFactoryFacetsResponse = {
  countries: ProspectFactoryFacetOption[];
  territories: ProspectFactoryFacetOption[];
  verticals: ProspectFactoryFacetOption[];
  origins: ProspectFactoryFacetOption[];
  certifications: ProspectFactoryFacetOption[];
  contacts: ProspectFactoryFacetOption[];
  elapsedMs: number;
  cached: boolean;
};
