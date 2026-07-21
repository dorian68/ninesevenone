import { NextRequest, NextResponse } from "next/server";
import { adminUnauthorized, getAdminAuth } from "@/lib/admin-auth";
import { listCompanyUpdateRequests, type UpdateStatus } from "@/lib/moderation-db";

export async function GET(request: NextRequest) {
  const auth = getAdminAuth(request);
  if (!auth) return adminUnauthorized();
  const requested = request.nextUrl.searchParams.get("status");
  const status = requested && ["pending", "approved", "rejected"].includes(requested) ? requested as UpdateStatus : undefined;
  return NextResponse.json({ updates: listCompanyUpdateRequests(status), role: auth.role }, { headers: { "Cache-Control": "no-store" } });
}
