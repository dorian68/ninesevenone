import { NextRequest, NextResponse } from "next/server";

import { getMarketOverview } from "@/lib/prospect-factory-crm-db";
import { authorizeProspectCrm, crmError } from "@/lib/prospect-factory-crm-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;

  try {
    return NextResponse.json(getMarketOverview(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Prospect CRM market overview failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("La vue marché n’a pas pu être chargée.", 503, "CRM_MARKET_OVERVIEW_FAILED");
  }
}
