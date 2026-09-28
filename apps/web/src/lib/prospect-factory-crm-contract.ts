import type { ProspectCertification, ProspectContactFilter, ProspectFactoryFacetsResponse, ProspectFactoryRow } from "./prospect-factory-contract";

export const PROSPECT_QUALIFICATION_STATUSES = [
  "to_qualify",
  "qualified",
  "to_contact",
  "contacted",
  "in_conversation",
  "opportunity",
  "won",
  "lost",
  "disqualified"
] as const;

export const PROSPECT_PRIORITIES = ["high", "normal", "low"] as const;
export const PROSPECT_ACTIVITY_TYPES = ["note", "call", "email", "meeting", "status_change", "enrichment"] as const;
export const PROSPECT_ACTIVITY_DETAIL_TYPES = [
  "email", "call", "linkedin_connection", "linkedin_message", "meeting",
  "follow_up", "note", "proposal", "other"
] as const;
export const PROSPECT_OPERATIONAL_SIGNALS = [
  "multiple_establishments", "multiple_entities", "multiple_territories", "regular_reporting",
  "consolidation", "finance_admin_team", "manual_tasks", "spreadsheet_heavy",
  "document_flows", "multiple_tools", "regulated_processes", "field_teams"
] as const;
export const PROSPECT_DEAL_ROLES = [
  "champion", "economic_decision_maker", "business_decision_maker", "user",
  "influencer", "gatekeeper", "it_security", "procurement", "unknown"
] as const;
export const PROSPECT_DECISION_SCOPES = ["local", "headquarters", "both", "unknown"] as const;
export const PROSPECT_ACTIVITY_DIRECTIONS = ["inbound", "outbound", "internal"] as const;
export const PROSPECT_EVENT_TYPES = [
  "prospect_created",
  "imported",
  "research_completed",
  "qualified",
  "status_changed",
  "note_added",
  "contact_added",
  "approach",
  "follow_up_scheduled",
  "follow_up_completed",
  "call_logged",
  "meeting_booked",
  "outcome_updated",
  "archived",
  "enrichment_updated"
] as const;
export const PROSPECT_EVENT_SOURCES = ["ui", "import", "automation", "api"] as const;
export const PROSPECT_EVIDENCE_TYPES = ["official", "apollo_input", "to_confirm"] as const;
export const PROSPECT_OBSERVATION_STATUSES = ["observed", "hypothesis", "to_confirm"] as const;
export const PROSPECT_OBSERVATION_KINDS = ["business_fact", "pain_signal", "trigger", "buying_committee", "other"] as const;
export const PROSPECT_BUYING_COMMITTEE_ROLES = [
  "user",
  "champion",
  "sponsor",
  "economic_buyer",
  "technical_buyer",
  "procurement",
  "blocker"
] as const;
export const PROSPECT_RESEARCH_SOURCE_TYPES = ["official_website", "report", "press_release", "investor", "regulatory", "secondary"] as const;
export const PROSPECT_SOURCE_INPUT_TYPES = ["apollo_screenshot", "apollo_export", "manual_list"] as const;
export const PROSPECT_SOURCE_EXTRACTION_STATUSES = ["extracted", "ambiguous", "excluded"] as const;
export const PROSPECT_QUALIFICATION_TIERS = ["A", "B", "C"] as const;
export const PROSPECT_QUALIFICATION_CONFIDENCES = ["high", "medium", "low"] as const;
export const PROSPECT_ACTIVITY_OUTCOMES = [
  "reached",
  "no_answer",
  "replied",
  "interested",
  "follow_up",
  "meeting_booked",
  "not_interested",
  "wrong_contact",
  "other"
] as const;

export type ProspectQualificationStatus = (typeof PROSPECT_QUALIFICATION_STATUSES)[number];
export type ProspectPriority = (typeof PROSPECT_PRIORITIES)[number];
export type ProspectActivityType = (typeof PROSPECT_ACTIVITY_TYPES)[number];
export type ProspectActivityDetailType = (typeof PROSPECT_ACTIVITY_DETAIL_TYPES)[number];
export type ProspectOperationalSignal = (typeof PROSPECT_OPERATIONAL_SIGNALS)[number];
export type ProspectDealRole = (typeof PROSPECT_DEAL_ROLES)[number];
export type ProspectDecisionScope = (typeof PROSPECT_DECISION_SCOPES)[number];
export type ProspectActivityDirection = (typeof PROSPECT_ACTIVITY_DIRECTIONS)[number];
export type ProspectActivityOutcome = (typeof PROSPECT_ACTIVITY_OUTCOMES)[number];
export type ProspectEventType = (typeof PROSPECT_EVENT_TYPES)[number];
export type ProspectEventSource = (typeof PROSPECT_EVENT_SOURCES)[number];
export type ProspectEvidenceType = (typeof PROSPECT_EVIDENCE_TYPES)[number];
export type ProspectObservationStatus = (typeof PROSPECT_OBSERVATION_STATUSES)[number];
export type ProspectObservationKind = (typeof PROSPECT_OBSERVATION_KINDS)[number];
export type ProspectBuyingCommitteeRole = (typeof PROSPECT_BUYING_COMMITTEE_ROLES)[number];
export type ProspectResearchSourceType = (typeof PROSPECT_RESEARCH_SOURCE_TYPES)[number];
export type ProspectSourceInputType = (typeof PROSPECT_SOURCE_INPUT_TYPES)[number];
export type ProspectSourceExtractionStatus = (typeof PROSPECT_SOURCE_EXTRACTION_STATUSES)[number];
export type ProspectQualificationTier = (typeof PROSPECT_QUALIFICATION_TIERS)[number];
export type ProspectQualificationConfidence = (typeof PROSPECT_QUALIFICATION_CONFIDENCES)[number];
export const PROSPECT_ACTIVITY_ACTION_KINDS = ["activity", "approach", "status_change", "enrichment"] as const;
export type ProspectActivityActionKind = (typeof PROSPECT_ACTIVITY_ACTION_KINDS)[number];

type ProspectCanonicalSnapshotBase = Pick<
  ProspectFactoryRow,
  | "dedupeKey"
  | "companyName"
  | "commercialName"
  | "country"
  | "territory"
  | "region"
  | "city"
  | "vertical"
  | "recordOrigin"
  | "sourceUrls"
  | "leadScore"
  | "certification"
>;

export type ProspectCanonicalObservedFields = Pick<
  ProspectFactoryRow,
  | "contactName"
  | "email"
  | "phone"
  | "website"
  | "activityDetail"
  | "employeeRange"
>;

export type ProspectCanonicalSnapshot = ProspectCanonicalSnapshotBase & ProspectCanonicalObservedFields;
export type ProspectCanonicalSnapshotInput = ProspectCanonicalSnapshotBase & Partial<ProspectCanonicalObservedFields>;

export type ProspectEnrichment = {
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  jobTitle: string | null;
  linkedin: string | null;
  address: string | null;
};

export type ProspectQualification = {
  status: ProspectQualificationStatus;
  priority: ProspectPriority;
  tags: string[];
  notes: string;
  nextActionAt: string | null;
  nextActionLabel: string | null;
  lastContactedAt: string | null;
  owner: string | null;
  campaign: string | null;
  potentialValue: number | null;
  probability: number | null;
  expectedCloseAt: string | null;
  disqualificationReason: string | null;
  /** Source-backed qualification dimensions. Null means the dimension was not scored. */
  fitScore: number | null;
  painScore: number | null;
  timingScore: number | null;
  personaScore: number | null;
  scoreTotal: number | null;
  tier: ProspectQualificationTier | null;
  confidence: ProspectQualificationConfidence | null;
  scoreReason: string | null;
};

export type ProspectSourceInput = {
  type: ProspectSourceInputType;
  reference: string | null;
  rowOrRecord: string | null;
  extractionStatus: ProspectSourceExtractionStatus;
  extractionNote: string | null;
};

export type ProspectResearch = {
  /** Stable external account identity used by structured imports. */
  accountKey: string | null;
  businessSummary: string | null;
  offerHypothesis: string | null;
  nextVerification: string | null;
  recommendedNextActionAt: string | null;
  sourceInput: ProspectSourceInput | null;
  firstActionAt: string | null;
  lastActionAt: string | null;
  firstApproachedAt: string | null;
  lastApproachedAt: string | null;
  firstResearchedAt: string | null;
  lastResearchedAt: string | null;
  firstQualifiedAt: string | null;
  lastQualifiedAt: string | null;
  statusChangedAt: string | null;
  reportingTimezone: string;
};

export type ProspectContact = {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  seniority: string | null;
  personaKey: string | null;
  dealRoles: ProspectDealRole[];
  decisionScope: ProspectDecisionScope | null;
  inputTitle: string | null;
  verifiedTitle: string | null;
  evidenceType: ProspectEvidenceType;
  sourceUrl: string | null;
  sourceRowOrRecord: string | null;
  buyingCommitteeRole: ProspectBuyingCommitteeRole | null;
  createdAt: string;
  updatedAt: string;
};

export type MarketIcp = {
  id: string;
  slug: string;
  name: string;
  description: string;
  qualificationCriteria: string[];
  exclusions: string[];
  employeeMin: number | null;
  employeeMax: number | null;
  territories: string[];
  signalWeights: Partial<Record<ProspectOperationalSignal, number>>;
  createdAt: string;
  updatedAt: string;
};

export type MarketSegment = {
  id: string;
  icpId: string;
  slug: string;
  name: string;
  description: string;
  criteria: string[];
  createdAt: string;
  updatedAt: string;
};

export type MarketMetrics = {
  accountCount: number;
  contactCount: number;
  contactedCount: number;
  conversationCount: number;
  responseCount: number;
  meetingCount: number;
  opportunityCount: number;
  clientCount: number;
  potentialValue: number;
  /** Sum of potentialValue on accounts marked won; this is not invoiced revenue. */
  signedValue: number;
  /** Fraction from 0 to 1: responding accounts / contacted accounts. */
  responseRate: number | null;
  averageWonValue: number | null;
};

export type MarketSegmentSummary = MarketSegment & { metrics: MarketMetrics };
export type MarketIcpSummary = MarketIcp & { metrics: MarketMetrics; segments: MarketSegmentSummary[]; targetPersonas: IcpPersona[] };
export type MarketOverview = { icps: MarketIcpSummary[]; unclassified: MarketMetrics; totalAccounts: number };

export type IcpPersona = {
  id: string;
  icpId: string;
  key: string;
  label: string;
  description: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type AccountPersonaSlot = {
  id: string;
  prospectId: string;
  key: string;
  label: string;
  contactId: string | null;
  status: "to_find" | "identified" | "not_relevant";
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type AccountMarketProfile = {
  icpId: string | null;
  segmentId: string | null;
  groupName: string | null;
  siren: string | null;
  siret: string | null;
  employeeCountEstimate: number | null;
  establishmentCount: number | null;
  entityCount: number | null;
  operationalSignals: ProspectOperationalSignal[];
  icpFitScore: number | null;
  icpFitReason: string | null;
};

export type LegacyProspectContact = {
  name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  linkedin: string | null;
};

export type MarketAccountRow = {
  prospect: TrackedProspect;
  lastActivity: ProspectActivity | null;
  activityCount: number;
  targetPersonas: AccountPersonaSlot[];
};

export type MarketAccountListResult = { accounts: MarketAccountRow[]; total: number; limit: number; offset: number };
export type ListMarketAccountsOptions = {
  icpId?: string;
  segmentId?: string;
  unclassified?: boolean;
  query?: string;
  status?: ProspectQualificationStatus;
  priority?: ProspectPriority;
  signal?: ProspectOperationalSignal;
  minIcpFitScore?: number;
  limit?: number;
  offset?: number;
};

export type IcpWriteInput = Pick<MarketIcp, "slug" | "name"> & Partial<Omit<MarketIcp, "id" | "slug" | "name" | "createdAt" | "updatedAt">>;
export type SegmentWriteInput = Pick<MarketSegment, "icpId" | "slug" | "name"> & Partial<Omit<MarketSegment, "id" | "icpId" | "slug" | "name" | "createdAt" | "updatedAt">>;
export type IcpPersonaWriteInput = Pick<IcpPersona, "key" | "label"> & Partial<Pick<IcpPersona, "description" | "sortOrder">>;
export type AccountPersonaWriteInput = Pick<AccountPersonaSlot, "key" | "label"> & Partial<Pick<AccountPersonaSlot, "contactId" | "status" | "notes">>;
export type ProspectContactWriteInput = Pick<ProspectContact, "name"> & Partial<Omit<ProspectContact, "id" | "name" | "createdAt" | "updatedAt">>;
export type AccountMarketUpdateInput = { expectedVersion: number; market: Partial<Omit<AccountMarketProfile, "icpId" | "icpFitScore" | "icpFitReason">> };

export type ProspectResearchSource = {
  id: string;
  url: string;
  sourceType: ProspectResearchSourceType;
  supportedClaim: string;
  publishedAt: string | null;
  researchedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ProspectObservation = {
  id: string;
  kind: ProspectObservationKind;
  statement: string;
  evidenceStatus: ProspectObservationStatus;
  category: string | null;
  sourceUrl: string | null;
  occurredAt: string | null;
  publishedAt: string | null;
  researchedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type TrackedProspect = {
  id: string;
  warehouseId: string;
  dedupeKey: string;
  version: number;
  snapshot: ProspectCanonicalSnapshot;
  enrichment: ProspectEnrichment;
  qualification: ProspectQualification;
  research: ProspectResearch;
  contacts: ProspectContact[];
  market: AccountMarketProfile;
  legacyContact: LegacyProspectContact | null;
  researchSources: ProspectResearchSource[];
  observations: ProspectObservation[];
  createdAt: string;
  updatedAt: string;
};

export type ProspectActivity = {
  id: string;
  prospectId: string;
  contactId: string | null;
  type: ProspectActivityType;
  detailType: ProspectActivityDetailType | null;
  actionKind: ProspectActivityActionKind;
  eventType: ProspectEventType;
  direction: ProspectActivityDirection | null;
  outcome: ProspectActivityOutcome | null;
  subject: string | null;
  body: string;
  nextActionLabel: string | null;
  nextActionAt: string | null;
  occurredAt: string;
  statusBefore: ProspectQualificationStatus | null;
  statusAfter: ProspectQualificationStatus | null;
  actorRole: string;
  actorId: string | null;
  source: ProspectEventSource;
  idempotencyKey: string | null;
  reportingTimezone: string;
  metadata: Record<string, unknown>;
  recordedAt: string;
  createdAt: string;
};

export type AddProspectInput = {
  warehouseId: string;
  snapshot: ProspectCanonicalSnapshotInput;
  enrichment?: Partial<ProspectEnrichment>;
  qualification?: Partial<ProspectQualification>;
};

export type UpdateProspectInput = {
  enrichment?: Partial<ProspectEnrichment>;
  qualification?: Partial<ProspectQualification>;
  /** Last version read by the client. A stale value raises ProspectVersionConflictError. */
  expectedVersion?: number;
};

export type AddProspectActivityInput = {
  type: ProspectActivityType;
  detailType?: ProspectActivityDetailType | null;
  direction?: ProspectActivityDirection | null;
  outcome?: ProspectActivityOutcome | null;
  subject?: string | null;
  body?: string;
  nextActionLabel?: string | null;
  occurredAt?: string;
  /** Optional linked decision-maker/contact. Legacy activities can remain account-level. */
  contactId?: string | null;
  eventType?: ProspectEventType;
  source?: ProspectEventSource;
  actorId?: string | null;
  idempotencyKey?: string;
  reportingTimezone?: string;
  metadata?: Record<string, unknown>;
  actorRole: string;
  /** When present (including null), updates the prospect's scheduled next action atomically. */
  nextActionAt?: string | null;
  /** Moves the prospect to this pipeline stage in the same transaction as the activity. */
  statusAfter?: ProspectQualificationStatus;
};

export type ProspectActivityWriteResult = {
  activity: ProspectActivity;
  prospect: TrackedProspect;
};

export type ProspectUpdateAuditResult = {
  prospect: TrackedProspect;
  version: number;
  activities: ProspectActivity[];
};

export type ListProspectsOptions = {
  status?: ProspectQualificationStatus | readonly ProspectQualificationStatus[];
  priority?: ProspectPriority | readonly ProspectPriority[];
  country?: string;
  territory?: string;
  vertical?: string;
  origin?: string;
  certification?: ProspectCertification;
  contact?: ProspectContactFilter;
  minScore?: number;
  query?: string;
  limit?: number;
  offset?: number;
};

export type ProspectCrmFilterOptions = Pick<
  ProspectFactoryFacetsResponse,
  "countries" | "territories" | "verticals" | "origins" | "certifications" | "contacts"
>;

export type ProspectListResult = {
  prospects: TrackedProspect[];
  total: number;
  limit: number;
  offset: number;
};

export type ProspectTrackingSummary = {
  id: string;
  warehouseId: string;
  version: number;
  status: ProspectQualificationStatus;
  priority: ProspectPriority;
  nextActionAt: string | null;
  lastContactedAt: string | null;
  updatedAt: string;
};

export type ProspectPipelineCounts = {
  total: number;
  byStatus: Record<ProspectQualificationStatus, number>;
  byPriority: Record<ProspectPriority, number>;
  /** Includes source-backed qualification tiers plus records not yet scored. */
  byTier: Record<ProspectQualificationTier | "unscored", number>;
  overdueNextActions: number;
  withoutNextAction: number;
  pipelineValue: number;
  weightedPipelineValue: number;
  wonValue: number;
};

export type ProspectActivityStats = {
  from: string;
  to: string;
  reportingTimezone: string;
  totalActivities: number;
  /** All real approach actions in the window, including relances. */
  approachEvents: number;
  /** Follow-up approach actions only; never counted toward the weekly new-contact target. */
  followUpApproachEvents: number;
  /** Distinct contacts whose first real approach falls in the window. Primary 50/week metric. */
  newContactsApproached: number;
  /** Distinct accounts whose first real approach falls in the window. */
  newAccountsApproached: number;
  /** Legacy alias retained for callers that used the account-level metric. */
  approachedProspects: number;
  statusChanges: number;
  enrichmentUpdates: number;
  byDay: Array<{
    date: string;
    activities: number;
    approachEvents: number;
    followUpApproachEvents: number;
    newContactsApproached: number;
    newAccountsApproached: number;
    approachedProspects: number;
  }>;
  byType: Record<ProspectActivityType, number>;
};

export type ProspectQualificationImportContactInput = Pick<
  ProspectContact,
  "name" | "inputTitle" | "verifiedTitle" | "evidenceType" | "sourceUrl" | "sourceRowOrRecord" | "buyingCommitteeRole"
> & Partial<Pick<
  ProspectContact,
  "firstName" | "lastName" | "email" | "phone" | "linkedin" | "seniority" | "personaKey" | "dealRoles" | "decisionScope"
>>;
export type ProspectQualificationImportSourceInput = Omit<ProspectResearchSource, "id" | "createdAt" | "updatedAt">;
export type ProspectQualificationImportObservationInput = Omit<ProspectObservation, "id" | "createdAt" | "updatedAt">;

/**
 * One source-backed account row accepted by POST /api/prospect-factory/crm/qualification-import.
 * `idempotencyKey` must remain stable when retrying the same row. A reused key
 * with a different payload is rejected rather than silently overwriting research.
 */
export type ProspectQualificationImportInput = {
  idempotencyKey: string;
  occurredAt?: string;
  reportingTimezone?: string;
  account: {
    accountKey: string;
    companyName: string;
    commercialName?: string | null;
    country: string;
    territory: string;
    region?: string | null;
    city?: string | null;
    vertical?: string | null;
    officialWebsite?: string | null;
    activityDetail?: string | null;
    employeeRange?: string | null;
    businessSummary?: string | null;
    offerHypothesis?: string | null;
    nextVerification?: string | null;
    recommendedNextActionAt?: string | null;
    sourceInput?: ProspectSourceInput | null;
    qualification?: Partial<ProspectQualification>;
    contacts?: ProspectQualificationImportContactInput[];
    sources?: ProspectQualificationImportSourceInput[];
    observations?: ProspectQualificationImportObservationInput[];
  };
};

export type ProspectQualificationImportResult = {
  prospect: TrackedProspect;
  created: boolean;
  idempotent: boolean;
  events: ProspectActivity[];
};
