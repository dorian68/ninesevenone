import { NextRequest, NextResponse } from "next/server";
import { adminForbidden, adminUnauthorized, getAdminAuth, hasAdminRole } from "@/lib/admin-auth";
import { getProspectFactoryFacets, parseProspectFactoryFilters, ProspectFactoryInputError, prospectFactoryStatus } from "@/lib/prospect-factory-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = getAdminAuth(request);
  if (!auth) return adminUnauthorized();
  if (!hasAdminRole(auth.role, ["SUPER_ADMIN", "DATA_ADMIN"])) return adminForbidden("Accès Prospect Factory réservé aux rôles data.");
  if (!prospectFactoryStatus().available) return NextResponse.json({ error: "Prospect Factory indisponible." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const started = performance.now();
  try {
    const result = await getProspectFactoryFacets(parseProspectFactoryFilters(request.nextUrl.searchParams), request.signal);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store", "Server-Timing": `facets;dur=${Math.round(performance.now() - started)}` } });
  } catch (error) {
    if (error instanceof ProspectFactoryInputError) return NextResponse.json({ error: error.message }, { status: 422, headers: { "Cache-Control": "no-store" } });
    if (request.signal.aborted) return NextResponse.json({ error: "Requête annulée." }, { status: 499, headers: { "Cache-Control": "no-store" } });
    console.error("Prospect Factory facets failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: "Les valeurs de filtres n’ont pas pu être actualisées." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
