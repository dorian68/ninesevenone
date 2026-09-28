import { NextRequest, NextResponse } from "next/server";

import { createAccountPersona, getProspect, listAccountPersonas, ProspectCrmInputError } from "@/lib/prospect-factory-crm-db";
import { authorizeProspectCrm, crmError, validateProspectCrmMutation } from "@/lib/prospect-factory-crm-http";
import { createAccountPersonaSchema, crmIdSchema } from "@/app/api/prospect-factory/crm/_schemas";

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
    return NextResponse.json({ personas: listAccountPersonas(id.data) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Prospect CRM account personas list failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("Les personas du compte n’ont pas pu être chargés.", 503, "CRM_ACCOUNT_PERSONAS_LIST_FAILED");
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const invalidMutation = validateProspectCrmMutation(request);
  if (invalidMutation) return invalidMutation;
  const id = crmIdSchema.safeParse((await context.params).id);
  if (!id.success) return crmError("Identifiant de prospect invalide.", 400, "INVALID_PROSPECT_ID");
  const parsed = createAccountPersonaSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return crmError("Persona du compte invalide.", 422, "INVALID_ACCOUNT_PERSONA");

  try {
    if (!getProspect(id.data)) return crmError("Prospect suivi introuvable.", 404, "TRACKED_PROSPECT_NOT_FOUND");
    const persona = createAccountPersona(id.data, {
      key: parsed.data.key,
      label: parsed.data.label,
      contactId: parsed.data.contactId ?? null,
      status: parsed.data.status,
      notes: parsed.data.notes ?? ""
    });
    return NextResponse.json({ persona }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProspectCrmInputError) return crmError(error.message, 422, "INVALID_ACCOUNT_PERSONA");
    console.error("Prospect CRM account persona create failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("Le persona du compte n’a pas pu être créé.", 503, "CRM_ACCOUNT_PERSONA_CREATE_FAILED");
  }
}
