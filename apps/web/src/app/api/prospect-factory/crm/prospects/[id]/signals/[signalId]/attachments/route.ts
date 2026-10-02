import { NextRequest, NextResponse } from "next/server";
import * as z from "zod4";

import { COMPANY_SIGNAL_MAX_FILE_BYTES } from "@/lib/company-signal-contract";
import { addCompanySignalAttachment, CompanySignalError } from "@/lib/company-signals";
import { authorizeProspectCrm, crmError, validateProspectCrmUpload } from "@/lib/prospect-factory-crm-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; signalId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const invalidMutation = validateProspectCrmUpload(request);
  if (invalidMutation) return invalidMutation;
  const { id, signalId } = await context.params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(signalId).success) {
    return crmError("Identifiant de signal invalide.", 400, "INVALID_SIGNAL_ID");
  }
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size < 1 || file.size > COMPANY_SIGNAL_MAX_FILE_BYTES) {
      return crmError("Choisissez un PDF ou une image de 10 Mo maximum.", 422, "INVALID_ATTACHMENT");
    }
    const result = addCompanySignalAttachment(id, signalId, {
      fileName: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer())
    }, `ui:${auth.role}`);
    return NextResponse.json(result, { status: result.created ? 201 : 200,
      headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CompanySignalError) return crmError(error.message, error.code === "NOT_FOUND" ? 404 : 422, error.code);
    console.error("Company signal attachment failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("La pièce jointe n’a pas pu être enregistrée.", 503, "ATTACHMENT_WRITE_FAILED");
  }
}
