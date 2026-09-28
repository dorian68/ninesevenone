import { NextRequest, NextResponse } from "next/server";

import { deleteIcpSegment, ProspectCrmInputError, updateIcpSegment } from "@/lib/prospect-factory-crm-db";
import { authorizeProspectCrm, crmError, validateProspectCrmMutation } from "@/lib/prospect-factory-crm-http";
import { validateProspectCrmDelete } from "@/app/api/prospect-factory/crm/_delete-mutation";
import { crmIdSchema, patchSegmentSchema } from "@/app/api/prospect-factory/crm/_schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const invalidMutation = validateProspectCrmMutation(request);
  if (invalidMutation) return invalidMutation;

  const id = crmIdSchema.safeParse((await context.params).id);
  if (!id.success) return crmError("Identifiant de segment invalide.", 400, "INVALID_SEGMENT_ID");
  const parsed = patchSegmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return crmError("Mise à jour du segment invalide.", 422, "INVALID_SEGMENT_UPDATE");

  try {
    const segment = updateIcpSegment(id.data, parsed.data);
    if (!segment) return crmError("Segment introuvable.", 404, "SEGMENT_NOT_FOUND");
    return NextResponse.json({ segment }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProspectCrmInputError) return crmError(error.message, 422, "INVALID_SEGMENT_UPDATE");
    console.error("Prospect CRM segment update failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("Le segment n’a pas pu être mis à jour.", 503, "CRM_SEGMENT_UPDATE_FAILED");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const invalidMutation = validateProspectCrmDelete(request);
  if (invalidMutation) return invalidMutation;

  const id = crmIdSchema.safeParse((await context.params).id);
  if (!id.success) return crmError("Identifiant de segment invalide.", 400, "INVALID_SEGMENT_ID");
  try {
    if (!deleteIcpSegment(id.data)) return crmError("Segment introuvable.", 404, "SEGMENT_NOT_FOUND");
    return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProspectCrmInputError) return crmError(error.message, 422, "INVALID_SEGMENT_DELETE");
    console.error("Prospect CRM segment delete failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("Le segment n’a pas pu être supprimé.", 503, "CRM_SEGMENT_DELETE_FAILED");
  }
}
