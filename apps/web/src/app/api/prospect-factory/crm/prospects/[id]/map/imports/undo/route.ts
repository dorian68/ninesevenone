import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getAdminActorId } from "@/lib/admin-auth";
import { AccountMapImportError, undoAccountMapImport } from "@/lib/account-map-import";
import { authorizeProspectCrm, crmError, validateProspectCrmMutation } from "@/lib/prospect-factory-crm-http";
import { crmIdSchema } from "@/app/api/prospect-factory/crm/_schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
const undoSchema = z.object({ importBatchId: z.string().uuid() }).strict();

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const invalidMutation = validateProspectCrmMutation(request);
  if (invalidMutation) return invalidMutation;
  const id = crmIdSchema.safeParse((await context.params).id);
  if (!id.success) return crmError("Identifiant de compte invalide.", 400, "INVALID_ACCOUNT_ID");
  const parsed = undoSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return crmError("Identifiant de lot invalide.", 422, "INVALID_IMPORT_BATCH_ID");
  try {
    const actor = getAdminActorId(request) ?? `role:${auth.role}`;
    const result = undoAccountMapImport(id.data, parsed.data.importBatchId, actor);
    return NextResponse.json({ result }, { status: result.undone ? 200 : 409,
      headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AccountMapImportError) return crmError(error.message, error.status, error.code);
    console.error("Account map import undo failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("Le retour sur import n’a pas pu être effectué.", 503, "MAP_IMPORT_UNDO_FAILED");
  }
}
