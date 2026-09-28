import { NextRequest, NextResponse } from "next/server";
import { adminForbidden, adminUnauthorized, getAdminAuth, hasAdminRole } from "@/lib/admin-auth";
import { getProspectQualitySnapshot, prospectFactoryStatus } from "@/lib/prospect-factory-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest) {
  const auth = getAdminAuth(request);
  if (!auth) return adminUnauthorized();
  if (!hasAdminRole(auth.role, ["SUPER_ADMIN", "DATA_ADMIN"])) return adminForbidden("Accès Prospect Factory réservé aux rôles data.");
  const status = prospectFactoryStatus();
  if (!status.available) {
    return NextResponse.json({ error: "La base ou le snapshot qualité Prospect Factory est indisponible.", command: "python scripts/build_prospect_factory_quality.py" }, { status: 503 });
  }
  try {
    return NextResponse.json({ status, snapshot: getProspectQualitySnapshot() }, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    console.error("Prospect Factory overview failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: "Snapshot qualité invalide." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
