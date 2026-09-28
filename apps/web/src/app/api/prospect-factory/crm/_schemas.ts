import { z } from "zod";

import {
  PROSPECT_BUYING_COMMITTEE_ROLES,
  PROSPECT_DEAL_ROLES,
  PROSPECT_DECISION_SCOPES,
  PROSPECT_EVIDENCE_TYPES,
  PROSPECT_OPERATIONAL_SIGNALS
} from "@/lib/prospect-factory-crm-contract";

export const crmIdSchema = z.string().uuid();
export const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
export const nullableText = (maximum: number) => requiredText(maximum).nullable();
export const nullableHttpUrl = z.string().trim().url().max(2_048).refine((value) => {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}, "Seules les URL HTTP et HTTPS sont acceptées.").nullable();
const slug = z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const criteria = z.array(requiredText(2_000)).max(100);
const employeeInt = z.number().int().min(0).max(1_000_000);
const operationalSignals = z.array(z.enum(PROSPECT_OPERATIONAL_SIGNALS)).max(PROSPECT_OPERATIONAL_SIGNALS.length);
const signalWeights = z.record(z.enum(PROSPECT_OPERATIONAL_SIGNALS), z.number().int().min(0).max(100));

export const icpFields = z.object({
  slug,
  name: requiredText(240),
  description: z.string().trim().max(20_000),
  qualificationCriteria: criteria,
  exclusions: criteria,
  employeeMin: employeeInt.nullable(),
  employeeMax: employeeInt.nullable(),
  territories: z.array(requiredText(2_000)).max(100),
  signalWeights
}).strict();
export const createIcpSchema = icpFields.partial().extend({ slug, name: requiredText(240) }).strict();
export const patchIcpSchema = icpFields.partial().strict().refine((value) => Object.keys(value).length > 0);

export const segmentFields = z.object({
  icpId: crmIdSchema,
  slug,
  name: requiredText(240),
  description: z.string().trim().max(20_000),
  criteria
}).strict();
export const createSegmentSchema = segmentFields.partial().extend({ icpId: crmIdSchema, slug, name: requiredText(240) }).strict();
export const patchSegmentSchema = segmentFields.partial().strict().refine((value) => Object.keys(value).length > 0);

export const accountMarketUpdateSchema = z.object({
  expectedVersion: z.number().int().min(1),
  market: z.object({
    segmentId: crmIdSchema.nullable().optional(),
    groupName: nullableText(240).optional(),
    siren: z.string().regex(/^\d{9}$/).nullable().optional(),
    siret: z.string().regex(/^\d{14}$/).nullable().optional(),
    employeeCountEstimate: employeeInt.nullable().optional(),
    establishmentCount: employeeInt.nullable().optional(),
    entityCount: employeeInt.nullable().optional(),
    operationalSignals: operationalSignals.optional()
  }).strict().refine((value) => Object.keys(value).length > 0)
}).strict();

export const contactFields = z.object({
  name: requiredText(2_000),
  firstName: nullableText(500),
  lastName: nullableText(500),
  email: z.string().trim().email().max(500).nullable(),
  phone: nullableText(500),
  linkedin: nullableHttpUrl,
  seniority: nullableText(500),
  personaKey: slug.nullable(),
  dealRoles: z.array(z.enum(PROSPECT_DEAL_ROLES)).max(PROSPECT_DEAL_ROLES.length),
  decisionScope: z.enum(PROSPECT_DECISION_SCOPES).nullable(),
  inputTitle: nullableText(1_000),
  verifiedTitle: nullableText(1_000),
  evidenceType: z.enum(PROSPECT_EVIDENCE_TYPES),
  sourceUrl: nullableHttpUrl,
  sourceRowOrRecord: nullableText(1_000),
  buyingCommitteeRole: z.enum(PROSPECT_BUYING_COMMITTEE_ROLES).nullable()
}).strict();
export const createContactSchema = contactFields.partial().extend({ name: requiredText(2_000) }).strict();
export const patchContactSchema = contactFields.partial().strict().refine((value) => Object.keys(value).length > 0);

export const icpPersonaFields = z.object({
  key: slug,
  label: requiredText(180),
  description: z.string().trim().max(2_000),
  sortOrder: z.number().int().min(-10_000).max(10_000)
}).strict();
export const createIcpPersonaSchema = icpPersonaFields.partial().extend({ key: slug, label: requiredText(180) }).strict();
export const patchIcpPersonaSchema = icpPersonaFields.partial().strict().refine((value) => Object.keys(value).length > 0);

export const accountPersonaFields = z.object({
  key: slug,
  label: requiredText(180),
  contactId: crmIdSchema.nullable(),
  status: z.enum(["to_find", "identified", "not_relevant"]),
  notes: z.string().max(5_000)
}).strict();
export const createAccountPersonaSchema = accountPersonaFields.partial().extend({ key: slug, label: requiredText(180) }).strict();
export const patchAccountPersonaSchema = accountPersonaFields.partial().strict().refine((value) => Object.keys(value).length > 0);
