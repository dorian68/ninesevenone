import { NextRequest, NextResponse } from "next/server";

import { deleteIcp, ProspectCrmInputError, updateIcp } from "@/lib/prospect-factory-crm-db";
import { authorizeProspectCrm, crmError, validateProspectCrmMutation } from "@/lib/prospect-factory-crm-http";
import { validateProspectCrmDelete } from "@/app/api/prospect-factory/crm/_delete-mutation";
import { crmIdSchema, patchIcpSchema } from "@/app/api/prospect-factory/crm/_schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const invalidMutation = validateProspectCrmMutation(request);
  if (invalidMutation) return invalidMutation;

  const id = crmIdSchema.safeParse((await context.params).id);
  if (!id.success) return crmError("Identifiant ICP invalide.", 400, "INVALID_ICP_ID");
  const parsed = patchIcpSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return crmError("Mise à jour ICP invalide.", 422, "INVALID_ICP_UPDATE");

  try {
    const icp = updateIcp(id.data, parsed.data);
    if (!icp) return crmError("ICP introuvable.", 404, "ICP_NOT_FOUND");
    return NextResponse.json({ icp }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProspectCrmInputError) return crmError(error.message, 422, "INVALID_ICP_UPDATE");
    console.error("Prospect CRM ICP update failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("L’ICP n’a pas pu être mis à jour.", 503, "CRM_ICP_UPDATE_FAILED");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const invalidMutation = validateProspectCrmDelete(request);
  if (invalidMutation) return invalidMutation;

  const id = crmIdSchema.safeParse((await context.params).id);
  if (!id.success) return crmError("Identifiant ICP invalide.", 400, "INVALID_ICP_ID");
  try {
    if (!deleteIcp(id.data)) return crmError("ICP introuvable.", 404, "ICP_NOT_FOUND");
    return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProspectCrmInputError) return crmError(error.message, 422, "INVALID_ICP_DELETE");
    console.error("Prospect CRM ICP delete failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("L’ICP n’a pas pu être supprimé.", 503, "CRM_ICP_DELETE_FAILED");
  }
}
