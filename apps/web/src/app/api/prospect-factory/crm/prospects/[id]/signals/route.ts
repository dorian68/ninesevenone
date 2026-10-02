import { NextRequest, NextResponse } from "next/server";
import * as z from "zod4";

import { companySignalWriteSchema } from "@/lib/company-signal-contract";
import { CompanySignalError, listCompanySignals, upsertCompanySignal } from "@/lib/company-signals";
import { authorizeProspectCrm, crmError, validateProspectCrmMutation } from "@/lib/prospect-factory-crm-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return crmError("Identifiant de société invalide.", 400, "INVALID_COMPANY_ID");
  try {
    const page = listCompanySignals(id, {
      limit: Number(request.nextUrl.searchParams.get("limit") ?? 50),
      offset: Number(request.nextUrl.searchParams.get("offset") ?? 0),
      includeArchived: request.nextUrl.searchParams.get("include_archived") === "true"
    });
    return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CompanySignalError) return crmError(error.message, error.code === "NOT_FOUND" ? 404 : 422, error.code);
    console.error("Company signal list failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("Les signaux ne peuvent pas être chargés.", 503, "SIGNALS_READ_FAILED");
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const invalidMutation = validateProspectCrmMutation(request, 65_536);
  if (invalidMutation) return invalidMutation;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return crmError("Identifiant de société invalide.", 400, "INVALID_COMPANY_ID");
  const parsed = companySignalWriteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.signal_id || parsed.data.expected_version) {
    return crmError("Signal invalide.", 422, "INVALID_SIGNAL");
  }
  try {
    const result = upsertCompanySignal(id, parsed.data, `ui:${auth.role}`);
    return NextResponse.json(result, { status: result.outcome === "created" ? 201 : 200,
      headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CompanySignalError) return crmError(error.message,
      error.code === "NOT_FOUND" ? 404 : error.code === "CONFLICT" ? 409 : 422, error.code);
    console.error("Company signal write failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("Le signal n’a pas pu être enregistré.", 503, "SIGNAL_WRITE_FAILED");
  }
}
