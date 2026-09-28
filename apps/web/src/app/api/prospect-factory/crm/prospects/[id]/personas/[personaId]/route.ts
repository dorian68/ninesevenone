import { NextRequest, NextResponse } from "next/server";

import { deleteAccountPersona, ProspectCrmInputError, updateAccountPersona } from "@/lib/prospect-factory-crm-db";
import { authorizeProspectCrm, crmError, validateProspectCrmMutation } from "@/lib/prospect-factory-crm-http";
import { validateProspectCrmDelete } from "@/app/api/prospect-factory/crm/_delete-mutation";
import { crmIdSchema, patchAccountPersonaSchema } from "@/app/api/prospect-factory/crm/_schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; personaId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const invalidMutation = validateProspectCrmMutation(request);
  if (invalidMutation) return invalidMutation;
  const params = await context.params;
  const id = crmIdSchema.safeParse(params.id);
  const personaId = crmIdSchema.safeParse(params.personaId);
  if (!id.success || !personaId.success) return crmError("Identifiant de persona invalide.", 400, "INVALID_ACCOUNT_PERSONA_ID");
  const parsed = patchAccountPersonaSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return crmError("Mise à jour du persona invalide.", 422, "INVALID_ACCOUNT_PERSONA_UPDATE");

  try {
    const persona = updateAccountPersona(id.data, personaId.data, parsed.data);
    if (!persona) return crmError("Persona introuvable pour ce compte.", 404, "ACCOUNT_PERSONA_NOT_FOUND");
    return NextResponse.json({ persona }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProspectCrmInputError) return crmError(error.message, 422, "INVALID_ACCOUNT_PERSONA_UPDATE");
    console.error("Prospect CRM account persona update failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("Le persona du compte n’a pas pu être mis à jour.", 503, "CRM_ACCOUNT_PERSONA_UPDATE_FAILED");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const invalidMutation = validateProspectCrmDelete(request);
  if (invalidMutation) return invalidMutation;
  const params = await context.params;
  const id = crmIdSchema.safeParse(params.id);
  const personaId = crmIdSchema.safeParse(params.personaId);
  if (!id.success || !personaId.success) return crmError("Identifiant de persona invalide.", 400, "INVALID_ACCOUNT_PERSONA_ID");
  try {
    if (!deleteAccountPersona(id.data, personaId.data)) return crmError("Persona introuvable pour ce compte.", 404, "ACCOUNT_PERSONA_NOT_FOUND");
    return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProspectCrmInputError) return crmError(error.message, 422, "INVALID_ACCOUNT_PERSONA_DELETE");
    console.error("Prospect CRM account persona delete failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("Le persona du compte n’a pas pu être supprimé.", 503, "CRM_ACCOUNT_PERSONA_DELETE_FAILED");
  }
}
