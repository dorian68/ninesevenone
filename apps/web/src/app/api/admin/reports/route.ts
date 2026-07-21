import { NextRequest, NextResponse } from "next/server";
import { adminUnauthorized, getAdminAuth } from "@/lib/admin-auth";
import { listCompanyReports, type ReportStatus } from "@/lib/moderation-db";

export async function GET(request: NextRequest) {
  const auth = getAdminAuth(request);
  if (!auth) return adminUnauthorized();
  const requested = request.nextUrl.searchParams.get("status");
  const status = requested && ["pending", "resolved", "dismissed"].includes(requested) ? requested as ReportStatus : undefined;
  return NextResponse.json({ reports: listCompanyReports(status), role: auth.role }, { headers: { "Cache-Control": "no-store" } });
}
