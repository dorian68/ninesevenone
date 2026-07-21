import { NextRequest, NextResponse } from "next/server";
import { adminUnauthorized, getAdminAuth } from "@/lib/admin-auth";
import { getAdminAuditLogs } from "@/lib/moderation-db";

export async function GET(request: NextRequest) {
  const auth = getAdminAuth(request);
  if (!auth) return adminUnauthorized();
  return NextResponse.json({ logs: getAdminAuditLogs(), role: auth.role }, { headers: { "Cache-Control": "no-store" } });
}
