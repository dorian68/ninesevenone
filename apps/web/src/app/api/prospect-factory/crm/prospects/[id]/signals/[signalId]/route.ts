import { NextRequest, NextResponse } from "next/server";
import * as z from "zod4";

import { companySignalWriteSchema } from "@/lib/company-signal-contract";
import { CompanySignalError, getCompanySignal, upsertCompanySignal } from "@/lib/company-signals";
import { authorizeProspectCrm, crmError, validateProspectCrmMutation } from "@/lib/prospect-factory-crm-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; signalId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const { id, signalId } = await context.params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(signalId).success) {
    return crmError("Identifiant de signal invalide.", 400, "INVALID_SIGNAL_ID");
  }
  const signal = getCompanySignal(id, signalId);
  return signal ? NextResponse.json({ signal }, { headers: { "Cache-Control": "no-store" } })
    : crmError("Signal introuvable.", 404, "SIGNAL_NOT_FOUND");
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const invalidMutation = validateProspectCrmMutation(request, 65_536);
  if (invalidMutation) return invalidMutation;
  const { id, signalId } = await context.params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(signalId).success) {
    return crmError("Identifiant de signal invalide.", 400, "INVALID_SIGNAL_ID");
  }
  const parsed = companySignalWriteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (parsed.data.signal_id && parsed.data.signal_id !== signalId)) {
    return crmError("Signal invalide.", 422, "INVALID_SIGNAL");
  }
  try {
    const result = upsertCompanySignal(id, { ...parsed.data, signal_id: signalId }, `ui:${auth.role}`);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CompanySignalError) return crmError(error.message,
      error.code === "NOT_FOUND" ? 404 : error.code === "CONFLICT" ? 409 : 422, error.code);
    console.error("Company signal update failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("Le signal n’a pas pu être modifié.", 503, "SIGNAL_WRITE_FAILED");
  }
}
