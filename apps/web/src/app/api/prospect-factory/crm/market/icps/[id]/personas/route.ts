import { NextRequest, NextResponse } from "next/server";

import { createIcpPersona, getMarketOverview, listIcpPersonas, ProspectCrmInputError } from "@/lib/prospect-factory-crm-db";
import { authorizeProspectCrm, crmError, validateProspectCrmMutation } from "@/lib/prospect-factory-crm-http";
import { createIcpPersonaSchema, crmIdSchema } from "@/app/api/prospect-factory/crm/_schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const id = crmIdSchema.safeParse((await context.params).id);
  if (!id.success) return crmError("Identifiant ICP invalide.", 400, "INVALID_ICP_ID");

  try {
    if (!getMarketOverview().icps.some((icp) => icp.id === id.data)) return crmError("ICP introuvable.", 404, "ICP_NOT_FOUND");
    return NextResponse.json({ personas: listIcpPersonas(id.data) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Prospect CRM ICP personas list failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("Les personas ICP n’ont pas pu être chargés.", 503, "CRM_ICP_PERSONAS_LIST_FAILED");
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const invalidMutation = validateProspectCrmMutation(request);
  if (invalidMutation) return invalidMutation;
  const id = crmIdSchema.safeParse((await context.params).id);
  if (!id.success) return crmError("Identifiant ICP invalide.", 400, "INVALID_ICP_ID");
  const parsed = createIcpPersonaSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return crmError("Persona ICP invalide.", 422, "INVALID_ICP_PERSONA");

  try {
    if (!getMarketOverview().icps.some((icp) => icp.id === id.data)) return crmError("ICP introuvable.", 404, "ICP_NOT_FOUND");
    const persona = createIcpPersona(id.data, {
      key: parsed.data.key,
      label: parsed.data.label,
      description: parsed.data.description ?? "",
      sortOrder: parsed.data.sortOrder ?? 0
    });
    return NextResponse.json({ persona }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProspectCrmInputError) return crmError(error.message, 422, "INVALID_ICP_PERSONA");
    console.error("Prospect CRM ICP persona create failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("Le persona ICP n’a pas pu être créé.", 503, "CRM_ICP_PERSONA_CREATE_FAILED");
  }
}
