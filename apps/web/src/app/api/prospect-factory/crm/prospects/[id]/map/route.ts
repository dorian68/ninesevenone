import { NextRequest, NextResponse } from "next/server";

import { getAccountMap } from "@/lib/account-map-db";
import { accountMapRouteError, authorizeMapRequest, noStore, type MapRouteContext } from "./_route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, context: MapRouteContext) {
  const auth = await authorizeMapRequest(request, context, null);
  if (auth.error) return auth.error;
  try {
    const map = getAccountMap(auth.accountId!);
    if (!map) return NextResponse.json({ error: "Compte suivi introuvable.", code: "TRACKED_PROSPECT_NOT_FOUND" }, { status: 404, headers: noStore });
    return NextResponse.json({ map }, { headers: noStore });
  } catch (error) { return accountMapRouteError(error, "load"); }
}
