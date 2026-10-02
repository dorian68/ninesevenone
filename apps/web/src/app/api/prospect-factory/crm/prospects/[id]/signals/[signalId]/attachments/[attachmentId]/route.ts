import { NextRequest, NextResponse } from "next/server";
import * as z from "zod4";

import { getCompanySignalAttachment } from "@/lib/company-signals";
import { authorizeProspectCrm, crmError } from "@/lib/prospect-factory-crm-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; signalId: string; attachmentId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const { id, signalId, attachmentId } = await context.params;
  if (![id, signalId, attachmentId].every((value) => z.uuid().safeParse(value).success)) {
    return crmError("Identifiant de pièce jointe invalide.", 400, "INVALID_ATTACHMENT_ID");
  }
  const result = getCompanySignalAttachment(id, signalId, attachmentId);
  if (!result) return crmError("Pièce jointe introuvable.", 404, "ATTACHMENT_NOT_FOUND");
  const { attachment, bytes } = result;
  const disposition = attachment.mime_type.startsWith("image/") ? "inline" : "attachment";
  return new Response(new Uint8Array(bytes), { headers: {
    "Content-Type": attachment.mime_type,
    "Content-Length": String(bytes.length),
    "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(attachment.file_name)}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff"
  } });
}
