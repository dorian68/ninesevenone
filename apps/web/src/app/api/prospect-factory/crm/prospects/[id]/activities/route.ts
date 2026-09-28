import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authorizeProspectCrm, crmError, validateProspectCrmMutation } from "@/lib/prospect-factory-crm-http";
import {
  addProspectActivity,
  getProspect,
  listProspectActivities,
  PROSPECT_ACTIVITY_DIRECTIONS,
  PROSPECT_ACTIVITY_OUTCOMES,
  PROSPECT_ACTIVITY_TYPES,
  PROSPECT_QUALIFICATION_STATUSES
} from "@/lib/prospect-factory-crm-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const prospectIdSchema = z.string().uuid();
const activitySchema = z.object({
  type: z.enum(PROSPECT_ACTIVITY_TYPES),
  direction: z.enum(PROSPECT_ACTIVITY_DIRECTIONS).nullable().optional(),
  outcome: z.enum(PROSPECT_ACTIVITY_OUTCOMES).nullable().optional(),
  subject: z.string().trim().min(1).max(240).nullable().optional(),
  body: z.string().max(10_000).optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  contactId: z.string().uuid().nullable().optional(),
  idempotencyKey: z.string().trim().min(1).max(256).optional(),
  reportingTimezone: z.string().trim().min(1).max(100).optional(),
  nextActionAt: z.string().datetime({ offset: true }).nullable().optional(),
  statusAfter: z.enum(PROSPECT_QUALIFICATION_STATUSES).optional()
}).strict().superRefine((value, context) => {
  if (value.type === "note" && !value.body?.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["body"], message: "Une note ne peut pas être vide." });
  }
});

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
  if (!getProspect(parsedId.data)) return crmError("Prospect suivi introuvable.", 404, "TRACKED_PROSPECT_NOT_FOUND");

  const requestedLimit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "100", 10);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
    return crmError("Limite de chronologie invalide.", 422, "INVALID_ACTIVITY_LIMIT");
  }
  return NextResponse.json({ activities: listProspectActivities(parsedId.data, requestedLimit) }, {
    headers: { "Cache-Control": "no-store" }
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const invalidMutation = validateProspectCrmMutation(request);
  if (invalidMutation) return invalidMutation;

  const parsedId = await validatedId(context);
  if (!parsedId.success) return crmError("Identifiant de fiche invalide.", 400, "INVALID_PROSPECT_ID");
  const parsed = activitySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return crmError("Activité commerciale invalide.", 422, "INVALID_ACTIVITY");

  try {
    const result = addProspectActivity(parsedId.data, { ...parsed.data, actorRole: auth.role });
    if (!result) return crmError("Prospect suivi introuvable.", 404, "TRACKED_PROSPECT_NOT_FOUND");
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Prospect CRM activity write failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("L’activité n’a pas pu être enregistrée.", 503, "CRM_ACTIVITY_WRITE_FAILED");
  }
}
