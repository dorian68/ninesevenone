import { NextRequest, NextResponse } from "next/server";
import { adminUnauthorized, getAdminAuth } from "@/lib/admin-auth";
import { listCompanyClaims, type ClaimStatus } from "@/lib/moderation-db";

export async function GET(request: NextRequest) {
  const auth = getAdminAuth(request);
  if (!auth) return adminUnauthorized();
  const requested = request.nextUrl.searchParams.get("status");
  const status = requested && ["pending", "approved", "rejected"].includes(requested) ? requested as ClaimStatus : undefined;
  return NextResponse.json({ claims: listCompanyClaims(status), role: auth.role }, { headers: { "Cache-Control": "no-store" } });
}
