import { NextRequest, NextResponse } from "next/server";
import * as z from "zod4";

import { outreachDraftWriteSchema } from "@/lib/outreach-draft-contract";
import { getOutreachDraft, OutreachDraftError, upsertOutreachDraft } from "@/lib/outreach-drafts";
import { authorizeProspectCrm, crmError, validateProspectCrmMutation } from "@/lib/prospect-factory-crm-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string; draftId: string }> };

export async function GET(request: NextRequest, context: Context) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const { id, draftId } = await context.params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(draftId).success) {
    return crmError("Identifiant de brouillon invalide.", 400, "INVALID_DRAFT_ID");
  }
  const draft = getOutreachDraft(id, draftId);
  return draft ? NextResponse.json({ draft }, { headers: { "Cache-Control": "no-store" } })
    : crmError("Brouillon introuvable.", 404, "DRAFT_NOT_FOUND");
}

export async function PATCH(request: NextRequest, context: Context) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const invalid = validateProspectCrmMutation(request, 65_536);
  if (invalid) return invalid;
  const { id, draftId } = await context.params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(draftId).success) {
    return crmError("Identifiant de brouillon invalide.", 400, "INVALID_DRAFT_ID");
  }
  const parsed = outreachDraftWriteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (parsed.data.draft_id && parsed.data.draft_id !== draftId)) {
    return crmError("Brouillon invalide.", 422, "INVALID_DRAFT");
  }
  try {
    const result = upsertOutreachDraft(id, { ...parsed.data, draft_id: draftId }, "ui:" + auth.role);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof OutreachDraftError) return crmError(error.message,
      error.code === "NOT_FOUND" ? 404 : error.code === "CONFLICT" ? 409 : 422, error.code);
    console.error("Outreach draft update failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("Le brouillon n'a pas pu être modifié.", 503, "DRAFT_WRITE_FAILED");
  }
}
