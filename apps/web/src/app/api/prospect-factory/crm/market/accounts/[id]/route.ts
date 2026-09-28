import { NextRequest, NextResponse } from "next/server";

import {
  getProspect,
  ProspectCrmInputError,
  ProspectVersionConflictError,
  updateAccountMarketProfile
} from "@/lib/prospect-factory-crm-db";
import { authorizeProspectCrm, crmError, validateProspectCrmMutation } from "@/lib/prospect-factory-crm-http";
import { accountMarketUpdateSchema, crmIdSchema } from "@/app/api/prospect-factory/crm/_schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const invalidMutation = validateProspectCrmMutation(request);
  if (invalidMutation) return invalidMutation;

  const id = crmIdSchema.safeParse((await context.params).id);
  if (!id.success) return crmError("Identifiant de compte invalide.", 400, "INVALID_ACCOUNT_ID");
  const parsed = accountMarketUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return crmError("Profil marché invalide.", 422, "INVALID_ACCOUNT_MARKET_PROFILE");

  try {
    const result = updateAccountMarketProfile(id.data, parsed.data, auth.role);
    if (!result) return crmError("Compte introuvable.", 404, "ACCOUNT_NOT_FOUND");
    return NextResponse.json({ prospect: result.prospect, activities: result.activities }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProspectVersionConflictError) {
      return NextResponse.json({
        error: "Ce compte a été modifié depuis son ouverture. Rechargez les données avant de réessayer.",
        code: "VERSION_CONFLICT",
        current: getProspect(id.data)
      }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    if (error instanceof ProspectCrmInputError) return crmError(error.message, 422, "INVALID_ACCOUNT_MARKET_PROFILE");
    console.error("Prospect CRM account market update failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("Le profil marché n’a pas pu être mis à jour.", 503, "CRM_ACCOUNT_MARKET_UPDATE_FAILED");
  }
}
