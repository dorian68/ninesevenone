import { NextRequest, NextResponse } from "next/server";

import { deleteIcpPersona, ProspectCrmInputError, updateIcpPersona } from "@/lib/prospect-factory-crm-db";
import { authorizeProspectCrm, crmError, validateProspectCrmMutation } from "@/lib/prospect-factory-crm-http";
import { validateProspectCrmDelete } from "@/app/api/prospect-factory/crm/_delete-mutation";
import { crmIdSchema, patchIcpPersonaSchema } from "@/app/api/prospect-factory/crm/_schemas";

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
  if (!id.success || !personaId.success) return crmError("Identifiant de persona ICP invalide.", 400, "INVALID_ICP_PERSONA_ID");
  const parsed = patchIcpPersonaSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return crmError("Mise à jour du persona ICP invalide.", 422, "INVALID_ICP_PERSONA_UPDATE");

  try {
    const persona = updateIcpPersona(id.data, personaId.data, parsed.data);
    if (!persona) return crmError("Persona ICP introuvable.", 404, "ICP_PERSONA_NOT_FOUND");
    return NextResponse.json({ persona }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProspectCrmInputError) return crmError(error.message, 422, "INVALID_ICP_PERSONA_UPDATE");
    console.error("Prospect CRM ICP persona update failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("Le persona ICP n’a pas pu être mis à jour.", 503, "CRM_ICP_PERSONA_UPDATE_FAILED");
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
  if (!id.success || !personaId.success) return crmError("Identifiant de persona ICP invalide.", 400, "INVALID_ICP_PERSONA_ID");
  try {
    if (!deleteIcpPersona(id.data, personaId.data)) return crmError("Persona ICP introuvable.", 404, "ICP_PERSONA_NOT_FOUND");
    return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProspectCrmInputError) return crmError(error.message, 422, "INVALID_ICP_PERSONA_DELETE");
    console.error("Prospect CRM ICP persona delete failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("Le persona ICP n’a pas pu être supprimé.", 503, "CRM_ICP_PERSONA_DELETE_FAILED");
  }
}
