import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getAdminActorId } from "@/lib/admin-auth";
import { authorizeProspectCrm, crmError, validateProspectCrmMutation } from "@/lib/prospect-factory-crm-http";
import { validateProspectCrmDelete } from "@/app/api/prospect-factory/crm/_delete-mutation";
import { AccountMapInputError, AccountMapVersionConflictError } from "@/lib/account-map-db";

export type MapRouteContext = { params: Promise<{ id: string; resource?: string; itemId?: string }> };
export const mapIdSchema = z.string().uuid();
export const noStore = { "Cache-Control": "no-store" };

export async function authorizeMapRequest(request: NextRequest, context: MapRouteContext, mutation: "json" | "delete" | null) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return { error: auth };
  if (mutation) {
    const invalid = mutation === "json" ? validateProspectCrmMutation(request) : validateProspectCrmDelete(request);
    if (invalid) return { error: invalid };
  }
  const params = await context.params;
  const parsed = mapIdSchema.safeParse(params.id);
  if (!parsed.success) return { error: crmError("Identifiant de compte invalide.", 400, "INVALID_ACCOUNT_ID") };
  return { accountId: parsed.data, params, actorId: getAdminActorId(request) };
}

export function accountMapRouteError(error: unknown, operation: string): NextResponse {
  if (error instanceof AccountMapInputError) {
    return NextResponse.json({ error: error.message, field: error.field, code: "INVALID_ACCOUNT_MAP" }, { status: 422, headers: noStore });
  }
  if (error instanceof AccountMapVersionConflictError) {
    return crmError("Cet élément a changé. Rechargez la carte avant de réessayer.", 409, "VERSION_CONFLICT");
  }
  console.error(`Account map ${operation} failed`, error instanceof Error ? error.name : "UnknownError");
  return crmError("La cartographie n’a pas pu être mise à jour.", 503, "ACCOUNT_MAP_FAILED");
}
