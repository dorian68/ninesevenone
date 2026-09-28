import { NextRequest, NextResponse } from "next/server";
import { adminForbidden, adminUnauthorized, getAdminAuth, hasAdminRole } from "@/lib/admin-auth";
import { parseProspectFactoryFilters, ProspectFactoryInputError, prospectFactoryStatus, searchProspectFactory } from "@/lib/prospect-factory-db";
import { getTrackingByWarehouseIds } from "@/lib/prospect-factory-crm-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = getAdminAuth(request);
  if (!auth) return adminUnauthorized();
  if (!hasAdminRole(auth.role, ["SUPER_ADMIN", "DATA_ADMIN"])) return adminForbidden("Accès Prospect Factory réservé aux rôles data.");
  if (!prospectFactoryStatus().available) return NextResponse.json({ error: "Prospect Factory indisponible." }, { status: 503 });
  const started = performance.now();
  try {
    const parameters = request.nextUrl.searchParams;
    const result = await searchProspectFactory(parseProspectFactoryFilters(parameters), {
      cursor: parameters.get("cursor") || undefined,
      limit: Number.parseInt(parameters.get("limit") ?? "50", 10),
      includeCount: parameters.get("count") === "1",
      signal: request.signal
    });
    const tracking = getTrackingByWarehouseIds(result.rows.map((row) => row.warehouseId));
    return NextResponse.json({ ...result, rows: result.rows.map((row) => ({ ...row, tracking: tracking[row.warehouseId] ?? null })) }, { headers: { "Cache-Control": "no-store", "Server-Timing": `prospects;dur=${Math.round(performance.now() - started)}` } });
  } catch (error) {
    if (error instanceof ProspectFactoryInputError) return NextResponse.json({ error: error.message }, { status: 422, headers: { "Cache-Control": "no-store" } });
    if (request.signal.aborted) return NextResponse.json({ error: "Requête annulée." }, { status: 499, headers: { "Cache-Control": "no-store" } });
    console.error("Prospect Factory query failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: "La requête n’a pas pu être exécutée. Réduisez le segment ou réessayez." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
