import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authorizeProspectCrm, crmError, validateProspectCrmMutation } from "@/lib/prospect-factory-crm-http";
import {
  getProspect,
  listProspectActivities,
  PROSPECT_PRIORITIES,
  PROSPECT_QUALIFICATION_CONFIDENCES,
  PROSPECT_QUALIFICATION_STATUSES,
  PROSPECT_QUALIFICATION_TIERS,
  ProspectVersionConflictError,
  updateProspectWithAudit
} from "@/lib/prospect-factory-crm-db";
import { getProspectFactoryById, ProspectFactoryInputError } from "@/lib/prospect-factory-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const prospectIdSchema = z.string().uuid();
const nullableText = (maximum: number) => z.string().trim().min(1).max(maximum).nullable();
const nullableHttpUrl = z.string().trim().min(1).max(2_048).url().refine((value) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}, "Seules les URL HTTP et HTTPS sont acceptées.").nullable();

const enrichmentSchema = z.object({
  contactName: nullableText(180).optional(),
  email: z.string().trim().email().max(320).nullable().optional(),
  phone: nullableText(60).optional(),
  website: nullableHttpUrl.optional(),
  jobTitle: nullableText(180).optional(),
  linkedin: nullableHttpUrl.optional(),
  address: nullableText(500).optional()
}).strict().refine((value) => Object.keys(value).length > 0, "Aucun enrichissement fourni.");

const qualificationSchema = z.object({
  status: z.enum(PROSPECT_QUALIFICATION_STATUSES).optional(),
  priority: z.enum(PROSPECT_PRIORITIES).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  notes: z.string().max(20_000).optional(),
  nextActionLabel: nullableText(500).optional(),
  nextActionAt: z.string().datetime({ offset: true }).nullable().optional(),
  lastContactedAt: z.string().datetime({ offset: true }).nullable().optional(),
  owner: nullableText(180).optional(),
  campaign: nullableText(180).optional(),
  potentialValue: z.number().finite().min(0).max(1_000_000_000).nullable().optional(),
  probability: z.number().int().min(0).max(100).nullable().optional(),
  expectedCloseAt: z.string().datetime({ offset: true }).nullable().optional(),
  disqualificationReason: nullableText(500).optional(),
  fitScore: z.number().int().min(0).max(30).nullable().optional(),
  painScore: z.number().int().min(0).max(30).nullable().optional(),
  timingScore: z.number().int().min(0).max(20).nullable().optional(),
  personaScore: z.number().int().min(0).max(20).nullable().optional(),
  // These are verified/derived again by the persistence boundary.
  scoreTotal: z.number().int().min(0).max(100).nullable().optional(),
  tier: z.enum(PROSPECT_QUALIFICATION_TIERS).nullable().optional(),
  confidence: z.enum(PROSPECT_QUALIFICATION_CONFIDENCES).nullable().optional(),
  scoreReason: nullableText(10_000).optional()
}).strict().refine((value) => Object.keys(value).length > 0, "Aucune qualification fournie.");

const updateSchema = z.object({
  expectedVersion: z.number().int().min(1),
  enrichment: enrichmentSchema.optional(),
  qualification: qualificationSchema.optional()
}).strict().refine((value) => Boolean(value.enrichment || value.qualification), "Aucune modification fournie.");

type RouteContext = { params: Promise<{ id: string }> };

async function validatedId(context: RouteContext) {
  const { id } = await context.params;
  return prospectIdSchema.safeParse(id);
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;

  const parsedId = await validatedId(context);
  if (!parsedId.success) return crmError("Identifiant de fiche invalide.", 400, "INVALID_PROSPECT_ID");
  const prospect = getProspect(parsedId.data);
  if (!prospect) return crmError("Prospect suivi introuvable.", 404, "TRACKED_PROSPECT_NOT_FOUND");

  // Structured qualification imports are account records created by this CRM,
  // not warehouse rows. They intentionally have no canonical Explorer lookup.
  if (prospect.research.accountKey || prospect.warehouseId.startsWith("qualification:")) {
    return NextResponse.json({
      prospect,
      canonical: null,
      activities: listProspectActivities(prospect.id, 100)
    }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const canonical = await getProspectFactoryById(prospect.warehouseId, request.signal);
    return NextResponse.json({
      prospect,
      canonical,
      activities: listProspectActivities(prospect.id, 100)
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProspectFactoryInputError) {
      return crmError("La référence entrepôt de cette fiche est invalide.", 422, "INVALID_WAREHOUSE_ID");
    }
    if (request.signal.aborted) return crmError("Chargement de la fiche annulé.", 499, "REQUEST_ABORTED");
    console.error("Prospect CRM detail failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("La fiche canonique n’a pas pu être chargée.", 503, "CANONICAL_LOOKUP_FAILED");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const invalidMutation = validateProspectCrmMutation(request);
  if (invalidMutation) return invalidMutation;

  const parsedId = await validatedId(context);
  if (!parsedId.success) return crmError("Identifiant de fiche invalide.", 400, "INVALID_PROSPECT_ID");
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return crmError("Mise à jour de la fiche invalide.", 422, "INVALID_PROSPECT_UPDATE");

  try {
    const result = updateProspectWithAudit(parsedId.data, parsed.data, auth.role);
    if (!result) return crmError("Prospect suivi introuvable.", 404, "TRACKED_PROSPECT_NOT_FOUND");
    return NextResponse.json({ prospect: result.prospect, activities: result.activities }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProspectVersionConflictError) {
      return NextResponse.json({
        error: "Cette fiche a été modifiée depuis son ouverture. Rechargez les données avant de réessayer.",
        code: "VERSION_CONFLICT",
        current: getProspect(parsedId.data)
      }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    console.error("Prospect CRM update failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("La fiche n’a pas pu être mise à jour.", 503, "CRM_UPDATE_FAILED");
  }
}
