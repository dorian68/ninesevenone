import { z } from "zod";

export const MAP_NODE_KINDS = ["person", "unit", "role_slot"] as const;
export const MAP_UNIT_KINDS = ["account", "group", "company", "headquarters", "subsidiary", "establishment", "department", "external"] as const;
export const MAP_RELATION_KINDS = ["unqualified", "works_in", "reports_to", "functional_reports_to", "part_of", "can_introduce", "advises"] as const;
export const MAP_EVIDENCE_STATUSES = ["observed", "confirmed", "hypothesis", "contradictory", "obsolete"] as const;
export const MAP_VIEWS = ["organization", "decision"] as const;
export const MAP_SOURCE_KINDS = ["screenshot", "document", "meeting_note", "web_page", "crm_note", "other"] as const;
export const MAP_STAKEHOLDER_ROLES = ["user", "process_owner", "influencer", "potential_relay", "confirmed_champion", "economic_decision_maker", "technical_validator", "security_validator", "procurement", "access_facilitator", "unknown"] as const;

export type MapNodeKind = typeof MAP_NODE_KINDS[number];
export type MapUnitKind = typeof MAP_UNIT_KINDS[number];
export type MapRelationKind = typeof MAP_RELATION_KINDS[number];
export type MapEvidenceStatus = typeof MAP_EVIDENCE_STATUSES[number];
export type MapView = typeof MAP_VIEWS[number];
export type MapSourceKind = typeof MAP_SOURCE_KINDS[number];
export type MapStakeholderRoleName = typeof MAP_STAKEHOLDER_ROLES[number];

export type AccountMapNode = {
  id: string; accountId: string; kind: MapNodeKind; contactId: string | null;
  unitKind: MapUnitKind | null; isRoot: boolean; opportunityId: string | null; name: string; title: string | null;
  notes: string; resolvedContactId: string | null; version: number;
  createdAt: string; updatedAt: string;
};
export type AccountMapOpportunity = {
  id: string; accountId: string; name: string; description: string; version: number;
  createdAt: string; updatedAt: string;
};
export type AccountMapSource = {
  id: string; accountId: string; kind: MapSourceKind; label: string; reference: string | null;
  collectedAt: string | null; informationDate: string | null; locator: string | null;
  excerpt: string | null; retentionUntil: string | null; version: number;
  createdAt: string; updatedAt: string;
};
export type AccountMapRelation = {
  id: string; accountId: string; fromNodeId: string; toNodeId: string;
  kind: MapRelationKind; opportunityId: string | null; evidenceStatus: MapEvidenceStatus;
  sourceId: string | null; sourceIds: string[]; label: string | null; notes: string;
  locator: string | null; excerpt: string | null; justification: string | null;
  verificationQuestion: string | null; validatedBy: string | null;
  validatedAt: string | null; version: number; createdAt: string; updatedAt: string;
};
export type AccountMapClaim = {
  id: string; accountId: string; subjectNodeId: string; opportunityId: string | null;
  field: string; value: unknown; evidenceStatus: MapEvidenceStatus; sourceId: string | null;
  sourceIds: string[]; locator: string | null; excerpt: string | null;
  justification: string | null; verificationQuestion: string | null;
  informationDate: string | null; validatedBy: string | null; validatedAt: string | null;
  version: number; createdAt: string; updatedAt: string;
};
export type AccountMapQuestion = {
  id: string; accountId: string; subjectNodeId: string | null; opportunityId: string | null;
  question: string; nextAction: string | null; status: "open" | "answered" | "dismissed";
  version: number; createdAt: string; updatedAt: string;
};
export type AccountMapStakeholderRole = {
  id: string; accountId: string; opportunityId: string; personNodeId: string;
  role: MapStakeholderRoleName; evidenceStatus: MapEvidenceStatus;
  sourceId: string | null; sourceIds: string[]; notes: string;
  validatedBy: string | null; validatedAt: string | null; version: number;
  createdAt: string; updatedAt: string;
};
export type AccountMapLayout = {
  view: MapView; opportunityId: string | null;
  positions: Array<{ nodeId: string; x: number; y: number }>;
  viewport: { x: number; y: number; zoom: number } | null;
};
export type AccountMapSnapshot = {
  accountId: string; accountName: string;
  nodes: AccountMapNode[]; relations: AccountMapRelation[];
  opportunities: AccountMapOpportunity[]; sources: AccountMapSource[];
  claims: AccountMapClaim[]; questions: AccountMapQuestion[];
  stakeholderRoles: AccountMapStakeholderRole[]; layouts: AccountMapLayout[];
  availableContacts: Array<{ id: string; name: string; inputTitle: string | null; verifiedTitle: string | null }>;
};

const id = z.string().uuid();
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => text(max).nullable().optional();
const evidence = z.object({
  evidenceStatus: z.enum(MAP_EVIDENCE_STATUSES).default("hypothesis"),
  sourceId: id.nullable().optional(),
  sourceIds: z.array(id).max(20).optional(),
  locator: optionalText(1_000),
  excerpt: optionalText(4_000),
  justification: optionalText(4_000),
  verificationQuestion: optionalText(1_000)
});

export const createMapNodeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("person"), contactId: id, notes: z.string().max(10_000).optional() }).strict(),
  z.object({ kind: z.literal("unit"), unitKind: z.enum(MAP_UNIT_KINDS).exclude(["account"]), name: text(240), title: optionalText(240), notes: z.string().max(10_000).optional() }).strict(),
  z.object({ kind: z.literal("role_slot"), name: text(240), title: optionalText(240), notes: z.string().max(10_000).optional(), opportunityId: id.nullable().optional() }).strict()
]);
export const patchMapNodeSchema = z.object({
  expectedVersion: z.number().int().positive(),
  name: text(240).optional(), title: optionalText(240), notes: z.string().max(10_000).optional(),
  unitKind: z.enum(MAP_UNIT_KINDS).exclude(["account"]).optional(),
  resolvedContactId: id.nullable().optional()
}).strict().refine((value) => Object.keys(value).some((key) => key !== "expectedVersion"));
export const createMapOpportunitySchema = z.object({ name: text(240), description: z.string().max(10_000).optional() }).strict();
export const patchMapOpportunitySchema = z.object({ expectedVersion: z.number().int().positive(), name: text(240).optional(), description: z.string().max(10_000).optional() }).strict().refine((value) => value.name !== undefined || value.description !== undefined);
export const createMapRelationSchema = z.object({
  fromNodeId: id, toNodeId: id, kind: z.enum(MAP_RELATION_KINDS),
  opportunityId: id.nullable().optional(), ...evidence.shape,
  label: optionalText(240), notes: z.string().max(10_000).optional()
}).strict();
export const patchMapRelationSchema = createMapRelationSchema.partial().extend({ expectedVersion: z.number().int().positive(), revalidate: z.literal(true).optional() }).strict().refine((value) => Object.keys(value).some((key) => key !== "expectedVersion"));
export const createMapSourceSchema = z.object({
  kind: z.enum(MAP_SOURCE_KINDS), label: text(240), reference: optionalText(2_000),
  collectedAt: z.string().datetime({ offset: true }).nullable().optional(),
  informationDate: z.string().max(40).nullable().optional(), locator: optionalText(1_000),
  excerpt: optionalText(4_000), retentionUntil: z.string().datetime({ offset: true }).nullable().optional()
}).strict();
export const patchMapSourceSchema = createMapSourceSchema.partial()
  .extend({ expectedVersion: z.number().int().positive() }).strict()
  .refine((value) => Object.keys(value).some((key) => key !== "expectedVersion"));
export const createMapQuestionSchema = z.object({
  subjectNodeId: id.nullable().optional(), opportunityId: id.nullable().optional(),
  question: text(2_000), nextAction: optionalText(2_000)
}).strict();
const mapClaimFields = z.object({
  subjectNodeId: id, opportunityId: id.nullable().optional(), field: text(120),
  value: z.unknown(), ...evidence.shape, informationDate: optionalText(40)
}).strict();
export const createMapClaimSchema = mapClaimFields.refine((input) => Object.prototype.hasOwnProperty.call(input, "value") && input.value !== undefined,
  "La valeur de l’information est obligatoire.");
export const patchMapClaimSchema = mapClaimFields.partial().extend({ expectedVersion: z.number().int().positive(), revalidate: z.literal(true).optional() }).strict().refine((value) => Object.keys(value).some((key) => key !== "expectedVersion"));
export const createMapStakeholderSchema = z.object({
  opportunityId: id, personNodeId: id, role: z.enum(MAP_STAKEHOLDER_ROLES),
  evidenceStatus: z.enum(MAP_EVIDENCE_STATUSES).default("hypothesis"),
  sourceId: id.nullable().optional(), sourceIds: z.array(id).max(20).optional(),
  notes: z.string().max(10_000).optional()
}).strict();
export const patchMapStakeholderSchema = createMapStakeholderSchema.partial().extend({ expectedVersion: z.number().int().positive(), revalidate: z.literal(true).optional() }).strict().refine((value) => Object.keys(value).some((key) => key !== "expectedVersion"));
export const patchMapQuestionSchema = z.object({
  expectedVersion: z.number().int().positive(), question: text(2_000).optional(),
  nextAction: optionalText(2_000), status: z.enum(["open", "answered", "dismissed"]).optional()
}).strict().refine((value) => Object.keys(value).some((key) => key !== "expectedVersion"));
export const saveMapLayoutSchema = z.object({
  view: z.enum(MAP_VIEWS), opportunityId: id.nullable(),
  positions: z.array(z.object({ nodeId: id, x: z.number().finite().min(-1_000_000).max(1_000_000), y: z.number().finite().min(-1_000_000).max(1_000_000) }).strict()).max(1_000),
  viewport: z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().finite().min(0.05).max(4) }).strict().nullable().optional()
}).strict();
