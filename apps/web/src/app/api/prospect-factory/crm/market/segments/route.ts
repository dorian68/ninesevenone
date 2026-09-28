import { NextRequest, NextResponse } from "next/server";

import { createIcpSegment, ProspectCrmInputError } from "@/lib/prospect-factory-crm-db";
import { authorizeProspectCrm, crmError, validateProspectCrmMutation } from "@/lib/prospect-factory-crm-http";
import { createSegmentSchema } from "@/app/api/prospect-factory/crm/_schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const invalidMutation = validateProspectCrmMutation(request);
  if (invalidMutation) return invalidMutation;

  const parsed = createSegmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return crmError("Définition du segment invalide.", 422, "INVALID_SEGMENT");

  try {
    const segment = createIcpSegment({
      icpId: parsed.data.icpId,
      slug: parsed.data.slug,
      name: parsed.data.name,
      description: parsed.data.description ?? "",
      criteria: parsed.data.criteria ?? []
    });
    return NextResponse.json({ segment }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProspectCrmInputError) return crmError(error.message, 422, "INVALID_SEGMENT");
    console.error("Prospect CRM segment create failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("Le segment n’a pas pu être créé.", 503, "CRM_SEGMENT_CREATE_FAILED");
  }
}
