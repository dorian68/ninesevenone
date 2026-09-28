import { NextRequest, NextResponse } from "next/server";
import { adminForbidden, adminUnauthorized, getAdminAuth, hasAdminRole } from "@/lib/admin-auth";
import { exportProspectFactoryCsv, parseProspectFactoryFilters, prospectFactoryStatus } from "@/lib/prospect-factory-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const auth = getAdminAuth(request);
  if (!auth) return adminUnauthorized();
  if (!hasAdminRole(auth.role, ["SUPER_ADMIN", "DATA_ADMIN"])) return adminForbidden("Export réservé aux rôles data.");
  if (!prospectFactoryStatus().available) return NextResponse.json({ error: "Prospect Factory indisponible." }, { status: 503 });
  try {
    const parameters = request.nextUrl.searchParams;
    const csv = await exportProspectFactoryCsv(parseProspectFactoryFilters(parameters), Number.parseInt(parameters.get("limit") ?? "5000", 10));
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="guad-prospects-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    console.error("Prospect Factory export failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: "Export impossible. Réduisez le segment ou réessayez." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
