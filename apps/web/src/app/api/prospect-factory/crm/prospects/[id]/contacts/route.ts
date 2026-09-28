import { NextRequest, NextResponse } from "next/server";

import { createProspectContact, getProspect, listProspectContacts, ProspectCrmInputError } from "@/lib/prospect-factory-crm-db";
import { authorizeProspectCrm, crmError, validateProspectCrmMutation } from "@/lib/prospect-factory-crm-http";
import { createContactSchema, crmIdSchema } from "@/app/api/prospect-factory/crm/_schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const id = crmIdSchema.safeParse((await context.params).id);
  if (!id.success) return crmError("Identifiant de prospect invalide.", 400, "INVALID_PROSPECT_ID");

  try {
    if (!getProspect(id.data)) return crmError("Prospect suivi introuvable.", 404, "TRACKED_PROSPECT_NOT_FOUND");
    return NextResponse.json({ contacts: listProspectContacts(id.data) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Prospect CRM contacts list failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("Les contacts n’ont pas pu être chargés.", 503, "CRM_CONTACTS_LIST_FAILED");
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const invalidMutation = validateProspectCrmMutation(request);
  if (invalidMutation) return invalidMutation;
  const id = crmIdSchema.safeParse((await context.params).id);
  if (!id.success) return crmError("Identifiant de prospect invalide.", 400, "INVALID_PROSPECT_ID");
  const parsed = createContactSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return crmError("Contact invalide.", 422, "INVALID_CONTACT");

  try {
    if (!getProspect(id.data)) return crmError("Prospect suivi introuvable.", 404, "TRACKED_PROSPECT_NOT_FOUND");
    const contact = createProspectContact(id.data, parsed.data);
    return NextResponse.json({ contact }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProspectCrmInputError) return crmError(error.message, 422, "INVALID_CONTACT");
    console.error("Prospect CRM contact create failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("Le contact n’a pas pu être créé.", 503, "CRM_CONTACT_CREATE_FAILED");
  }
}
