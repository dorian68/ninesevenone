import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authorizeProspectCrm, crmError, validateProspectCrmMutation } from "@/lib/prospect-factory-crm-http";
import {
  importProspectQualificationBatch,
  PROSPECT_BUYING_COMMITTEE_ROLES,
  PROSPECT_EVIDENCE_TYPES,
  PROSPECT_OBSERVATION_KINDS,
  PROSPECT_OBSERVATION_STATUSES,
  PROSPECT_PRIORITIES,
  PROSPECT_QUALIFICATION_CONFIDENCES,
  PROSPECT_QUALIFICATION_STATUSES,
  PROSPECT_QUALIFICATION_TIERS,
  PROSPECT_RESEARCH_SOURCE_TYPES,
  PROSPECT_SOURCE_EXTRACTION_STATUSES,
  PROSPECT_SOURCE_INPUT_TYPES,
  ProspectCrmIdempotencyConflictError,
  ProspectCrmInputError
} from "@/lib/prospect-factory-crm-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const optionalText = (maximum: number) => z.string().trim().min(1).max(maximum).nullable().default(null);
const optionalDate = z.string().datetime({ offset: true }).nullable().default(null);
const nonLinkedInHttpUrl = z.string().trim().min(1).max(2_048).url().refine((value) => {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (url.protocol === "http:" || url.protocol === "https:")
      && hostname !== "linkedin.com"
      && !hostname.endsWith(".linkedin.com");
  } catch {
    return false;
  }
}, "Seules les URL HTTP(S) hors LinkedIn sont acceptées.");

const qualificationSchema = z.object({
  status: z.enum(PROSPECT_QUALIFICATION_STATUSES).refine(
    (value) => ["to_qualify", "qualified", "to_contact", "disqualified"].includes(value),
    "Un import de qualification ne peut pas définir une étape post-contact."
  ).optional(),
  priority: z.enum(PROSPECT_PRIORITIES).optional(),
  tags: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  notes: z.string().max(200_000).optional(),
  nextActionAt: z.string().datetime({ offset: true }).nullable().optional(),
  owner: optionalText(180).optional(),
  campaign: optionalText(180).optional(),
  potentialValue: z.number().finite().min(0).max(1_000_000_000).nullable().optional(),
  probability: z.number().int().min(0).max(100).nullable().optional(),
  expectedCloseAt: z.string().datetime({ offset: true }).nullable().optional(),
  disqualificationReason: optionalText(500).optional(),
  fitScore: z.number().int().min(0).max(30).nullable().optional(),
  painScore: z.number().int().min(0).max(30).nullable().optional(),
  timingScore: z.number().int().min(0).max(20).nullable().optional(),
  personaScore: z.number().int().min(0).max(20).nullable().optional(),
  scoreTotal: z.number().int().min(0).max(100).nullable().optional(),
  tier: z.enum(PROSPECT_QUALIFICATION_TIERS).nullable().optional(),
  confidence: z.enum(PROSPECT_QUALIFICATION_CONFIDENCES).nullable().optional(),
  scoreReason: optionalText(10_000).optional()
}).strict();

const sourceInputSchema = z.object({
  type: z.enum(PROSPECT_SOURCE_INPUT_TYPES),
  reference: optionalText(10_000),
  rowOrRecord: optionalText(1_000),
  extractionStatus: z.enum(PROSPECT_SOURCE_EXTRACTION_STATUSES).default("extracted"),
  extractionNote: optionalText(10_000)
}).strict();

const contactSchema = z.object({
  name: z.string().trim().min(1).max(2_000),
  inputTitle: optionalText(1_000),
  verifiedTitle: optionalText(1_000),
  evidenceType: z.enum(PROSPECT_EVIDENCE_TYPES),
  sourceUrl: nonLinkedInHttpUrl.nullable().default(null),
  sourceRowOrRecord: optionalText(1_000),
  buyingCommitteeRole: z.enum(PROSPECT_BUYING_COMMITTEE_ROLES).nullable().default(null)
}).strict();

const researchSourceSchema = z.object({
  url: nonLinkedInHttpUrl,
  sourceType: z.enum(PROSPECT_RESEARCH_SOURCE_TYPES),
  supportedClaim: z.string().trim().min(1).max(20_000),
  publishedAt: optionalDate,
  researchedAt: z.string().datetime({ offset: true })
}).strict();

const observationSchema = z.object({
  kind: z.enum(PROSPECT_OBSERVATION_KINDS),
  statement: z.string().trim().min(1).max(30_000),
  evidenceStatus: z.enum(PROSPECT_OBSERVATION_STATUSES),
  category: optionalText(500),
  sourceUrl: nonLinkedInHttpUrl.nullable().default(null),
  occurredAt: optionalDate,
  publishedAt: optionalDate,
  researchedAt: z.string().datetime({ offset: true })
}).strict();

const importItemSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(256),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  reportingTimezone: z.string().trim().min(1).max(100).optional(),
  account: z.object({
    accountKey: z.string().trim().min(1).max(256),
    companyName: z.string().trim().min(1).max(10_000),
    commercialName: optionalText(10_000),
    country: z.string().trim().min(1).max(1_000),
    territory: z.string().trim().min(1).max(2_000),
    region: optionalText(2_000),
    city: optionalText(2_000),
    vertical: optionalText(5_000),
    officialWebsite: nonLinkedInHttpUrl.nullable().default(null),
    activityDetail: optionalText(100_000),
    employeeRange: optionalText(2_000),
    businessSummary: optionalText(100_000),
    offerHypothesis: optionalText(20_000),
    nextVerification: optionalText(20_000),
    recommendedNextActionAt: optionalDate,
    sourceInput: sourceInputSchema.nullable().default(null),
    qualification: qualificationSchema.optional(),
    contacts: z.array(contactSchema).max(100).default([]),
    sources: z.array(researchSourceSchema).max(200).default([]),
    observations: z.array(observationSchema).max(500).default([])
  }).strict()
}).strict();

const batchSchema = z.object({
  items: z.array(importItemSchema).min(1).max(50)
}).strict();

/**
 * POST /api/prospect-factory/crm/qualification-import
 *
 * Bounded, authenticated integration endpoint for the B2B qualification skill.
 * It accepts up to 50 account rows, each with a stable `idempotencyKey`, account
 * identity, contacts, sources, observations and four score components. The
 * server derives total/tier, rejects LinkedIn URLs, and writes imported,
 * research_completed and qualified events without ever manufacturing approach.
 */
export async function POST(request: NextRequest) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const invalidMutation = validateProspectCrmMutation(request, 1_000_000);
  if (invalidMutation) return invalidMutation;
  const parsed = batchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return crmError("Import de qualification invalide.", 422, "INVALID_QUALIFICATION_IMPORT");

  try {
    const results = importProspectQualificationBatch(parsed.data.items, auth.role);
    return NextResponse.json({
      results: results.map((result) => ({
        prospect: result.prospect,
        created: result.created,
        idempotent: result.idempotent,
        events: result.events
      }))
    }, {
      status: results.every((result) => result.idempotent) ? 200 : 201,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    if (error instanceof ProspectCrmIdempotencyConflictError) {
      return crmError("Cette clé d’idempotence a déjà été utilisée avec un contenu différent.", 409, "IDEMPOTENCY_CONFLICT");
    }
    if (error instanceof ProspectCrmInputError) return crmError(error.message, 422, "INVALID_QUALIFICATION_IMPORT");
    console.error("Prospect qualification import failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("L’import de qualification n’a pas pu être enregistré.", 503, "QUALIFICATION_IMPORT_FAILED");
  }
}
