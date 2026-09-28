import { NextRequest, NextResponse } from "next/server";

import { createIcp, ProspectCrmInputError } from "@/lib/prospect-factory-crm-db";
import { authorizeProspectCrm, crmError, validateProspectCrmMutation } from "@/lib/prospect-factory-crm-http";
import { createIcpSchema } from "@/app/api/prospect-factory/crm/_schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const invalidMutation = validateProspectCrmMutation(request);
  if (invalidMutation) return invalidMutation;

  const parsed = createIcpSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return crmError("Définition ICP invalide.", 422, "INVALID_ICP");

  try {
    const icp = createIcp({
      slug: parsed.data.slug,
      name: parsed.data.name,
      description: parsed.data.description ?? "",
      qualificationCriteria: parsed.data.qualificationCriteria ?? [],
      exclusions: parsed.data.exclusions ?? [],
      employeeMin: parsed.data.employeeMin ?? null,
      employeeMax: parsed.data.employeeMax ?? null,
      territories: parsed.data.territories ?? [],
      signalWeights: parsed.data.signalWeights ?? {}
    });
    return NextResponse.json({ icp }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProspectCrmInputError) return crmError(error.message, 422, "INVALID_ICP");
    console.error("Prospect CRM ICP create failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("L’ICP n’a pas pu être créé.", 503, "CRM_ICP_CREATE_FAILED");
  }
}
