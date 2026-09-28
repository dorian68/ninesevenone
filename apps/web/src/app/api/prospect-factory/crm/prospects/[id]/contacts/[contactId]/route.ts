import { NextRequest, NextResponse } from "next/server";

import { deleteProspectContact, ProspectCrmInputError, updateProspectContact } from "@/lib/prospect-factory-crm-db";
import { authorizeProspectCrm, crmError, validateProspectCrmMutation } from "@/lib/prospect-factory-crm-http";
import { validateProspectCrmDelete } from "@/app/api/prospect-factory/crm/_delete-mutation";
import { crmIdSchema, patchContactSchema } from "@/app/api/prospect-factory/crm/_schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; contactId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const invalidMutation = validateProspectCrmMutation(request);
  if (invalidMutation) return invalidMutation;

  const params = await context.params;
  const id = crmIdSchema.safeParse(params.id);
  const contactId = crmIdSchema.safeParse(params.contactId);
  if (!id.success || !contactId.success) return crmError("Identifiant de contact invalide.", 400, "INVALID_CONTACT_ID");
  const parsed = patchContactSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return crmError("Mise à jour du contact invalide.", 422, "INVALID_CONTACT_UPDATE");

  try {
    const contact = updateProspectContact(id.data, contactId.data, parsed.data);
    if (!contact) return crmError("Contact introuvable pour ce prospect.", 404, "CONTACT_NOT_FOUND");
    return NextResponse.json({ contact }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProspectCrmInputError) return crmError(error.message, 422, "INVALID_CONTACT_UPDATE");
    console.error("Prospect CRM contact update failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("Le contact n’a pas pu être mis à jour.", 503, "CRM_CONTACT_UPDATE_FAILED");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const invalidMutation = validateProspectCrmDelete(request);
  if (invalidMutation) return invalidMutation;

  const params = await context.params;
  const id = crmIdSchema.safeParse(params.id);
  const contactId = crmIdSchema.safeParse(params.contactId);
  if (!id.success || !contactId.success) return crmError("Identifiant de contact invalide.", 400, "INVALID_CONTACT_ID");
  try {
    if (!deleteProspectContact(id.data, contactId.data)) return crmError("Contact introuvable pour ce prospect.", 404, "CONTACT_NOT_FOUND");
    return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProspectCrmInputError) return crmError(error.message, 422, "INVALID_CONTACT_DELETE");
    console.error("Prospect CRM contact delete failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("Le contact n’a pas pu être supprimé.", 503, "CRM_CONTACT_DELETE_FAILED");
  }
}
