import { NextRequest, NextResponse } from "next/server";

import { getAdminActorId } from "@/lib/admin-auth";
import { accountMapImportApplySchema } from "@/lib/account-map-import-contract";
import { AccountMapImportError, applyAccountMapImport } from "@/lib/account-map-import";
import { authorizeProspectCrm, crmError, validateProspectCrmMutation } from "@/lib/prospect-factory-crm-http";
import { crmIdSchema } from "@/app/api/prospect-factory/crm/_schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const invalidMutation = validateProspectCrmMutation(request, 1_000_000);
  if (invalidMutation) return invalidMutation;
  const id = crmIdSchema.safeParse((await context.params).id);
  if (!id.success) return crmError("Identifiant de compte invalide.", 400, "INVALID_ACCOUNT_ID");
  const parsed = accountMapImportApplySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Décisions d’import invalides.", code: "INVALID_MAP_IMPORT_DECISIONS",
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) },
    { status: 422, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const actor = getAdminActorId(request) ?? `role:${auth.role}`;
    const result = applyAccountMapImport(id.data, parsed.data, actor);
    return NextResponse.json({ result }, { status: result.idempotent ? 200 : 201,
      headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AccountMapImportError) return crmError(error.message, error.status, error.code);
    console.error("Account map import apply failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("L’import n’a pas pu être appliqué.", 503, "MAP_IMPORT_APPLY_FAILED");
  }
}
