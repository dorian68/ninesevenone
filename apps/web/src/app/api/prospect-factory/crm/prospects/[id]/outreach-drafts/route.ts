import { NextRequest, NextResponse } from "next/server";
import * as z from "zod4";

import { outreachDraftWriteSchema } from "@/lib/outreach-draft-contract";
import { listOutreachDrafts, OutreachDraftError, upsertOutreachDraft } from "@/lib/outreach-drafts";
import { authorizeProspectCrm, crmError, validateProspectCrmMutation } from "@/lib/prospect-factory-crm-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return crmError("Identifiant de société invalide.", 400, "INVALID_COMPANY_ID");
  const contactId = request.nextUrl.searchParams.get("contact_id");
  if (contactId && !z.uuid().safeParse(contactId).success) {
    return crmError("Identifiant de personne invalide.", 400, "INVALID_CONTACT_ID");
  }
  try {
    return NextResponse.json(listOutreachDrafts(id, {
      contactId: contactId ?? undefined,
      limit: Number(request.nextUrl.searchParams.get("limit") ?? 50),
      offset: Number(request.nextUrl.searchParams.get("offset") ?? 0),
      includeArchived: request.nextUrl.searchParams.get("include_archived") === "true"
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof OutreachDraftError) return crmError(error.message,
      error.code === "NOT_FOUND" ? 404 : 422, error.code);
    console.error("Outreach draft list failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("Les brouillons ne peuvent pas être chargés.", 503, "DRAFTS_READ_FAILED");
  }
}

export async function POST(request: NextRequest, context: Context) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const invalid = validateProspectCrmMutation(request, 65_536);
  if (invalid) return invalid;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return crmError("Identifiant de société invalide.", 400, "INVALID_COMPANY_ID");
  const parsed = outreachDraftWriteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.draft_id || parsed.data.expected_version) {
    return crmError("Brouillon invalide.", 422, "INVALID_DRAFT");
  }
  try {
    const result = upsertOutreachDraft(id, parsed.data, "ui:" + auth.role);
    return NextResponse.json(result, { status: result.outcome === "created" ? 201 : 200,
      headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof OutreachDraftError) return crmError(error.message,
      error.code === "NOT_FOUND" ? 404 : error.code === "CONFLICT" ? 409 : 422, error.code);
    console.error("Outreach draft write failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("Le brouillon n'a pas pu être enregistré.", 503, "DRAFT_WRITE_FAILED");
  }
}
