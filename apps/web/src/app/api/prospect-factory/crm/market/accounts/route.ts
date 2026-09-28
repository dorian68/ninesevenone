import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { listMarketAccounts } from "@/lib/prospect-factory-crm-db";
import { PROSPECT_OPERATIONAL_SIGNALS, PROSPECT_PRIORITIES, PROSPECT_QUALIFICATION_STATUSES } from "@/lib/prospect-factory-crm-contract";
import { authorizeProspectCrm, crmError } from "@/lib/prospect-factory-crm-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const filtersSchema = z.object({
  icpId: z.string().uuid().optional(),
  segmentId: z.string().uuid().optional(),
  unclassified: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  query: z.string().trim().max(120).optional(),
  status: z.enum(PROSPECT_QUALIFICATION_STATUSES).optional(),
  priority: z.enum(PROSPECT_PRIORITIES).optional(),
  signal: z.enum(PROSPECT_OPERATIONAL_SIGNALS).optional(),
  minIcpFitScore: z.coerce.number().int().min(0).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(10_000_000).default(0)
}).strict();

export function GET(request: NextRequest) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;

  const parameters = request.nextUrl.searchParams;
  const parsed = filtersSchema.safeParse({
    icpId: parameters.get("icpId") || undefined,
    segmentId: parameters.get("segmentId") || undefined,
    unclassified: parameters.get("unclassified") || undefined,
    query: parameters.get("query") || undefined,
    status: parameters.get("status") || undefined,
    priority: parameters.get("priority") || undefined,
    signal: parameters.get("signal") || undefined,
    minIcpFitScore: parameters.get("minIcpFitScore") || undefined,
    limit: parameters.get("limit") ?? undefined,
    offset: parameters.get("offset") ?? undefined
  });
  if (!parsed.success) return crmError("Filtres des comptes invalides.", 422, "INVALID_MARKET_ACCOUNT_FILTERS");

  try {
    return NextResponse.json(listMarketAccounts(parsed.data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Prospect CRM market accounts failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("Les comptes du marché n’ont pas pu être chargés.", 503, "CRM_MARKET_ACCOUNTS_FAILED");
  }
}
