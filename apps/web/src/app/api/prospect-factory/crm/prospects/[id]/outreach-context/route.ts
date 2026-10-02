import { NextRequest, NextResponse } from "next/server";
import * as z from "zod4";

import { getOutreachContext, OutreachDraftError } from "@/lib/outreach-drafts";
import { authorizeProspectCrm, crmError } from "@/lib/prospect-factory-crm-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  const query = request.nextUrl.searchParams;
  const contactId = query.get("contact_id");
  const icpId = query.get("icp_id");
  const personaId = query.get("persona_id");
  const opportunityId = query.get("opportunity_id");
  if (!z.uuid().safeParse(id).success || !contactId || !z.uuid().safeParse(contactId).success
    || [icpId, personaId, opportunityId].some((value) => value !== null && !z.uuid().safeParse(value).success)) {
    return crmError("Identifiant de contexte invalide.", 400, "INVALID_OUTREACH_CONTEXT");
  }
  try {
    return NextResponse.json({ context: getOutreachContext(id, contactId, {
      icpId, personaId, opportunityId,
      signalLimit: Number(query.get("signal_limit") ?? 30)
    }) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof OutreachDraftError) return crmError(error.message,
      error.code === "NOT_FOUND" ? 404 : 422, error.code);
    console.error("Outreach context failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("Le contexte de rédaction ne peut pas être chargé.", 503, "CONTEXT_READ_FAILED");
  }
}
