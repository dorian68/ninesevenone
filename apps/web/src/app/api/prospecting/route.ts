import { NextRequest, NextResponse } from "next/server";
import { searchProspectingDatabase } from "@/lib/enterprise-db";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const sector = request.nextUrl.searchParams.get("sector") ?? "";
  const commune = request.nextUrl.searchParams.get("commune") ?? "";
  const limitValue = Number(request.nextUrl.searchParams.get("limit") ?? "60");
  const limit = Number.isFinite(limitValue) ? Math.min(100, Math.max(1, Math.floor(limitValue))) : 60;
  const results = searchProspectingDatabase(query, { sector, commune }, limit);
  if (results === null) return NextResponse.json({ error: "Index territorial indisponible" }, { status: 503 });
  return NextResponse.json({
    results,
    metadata: {
      resultCount: results.length,
      limit,
      limited: results.length === limit,
      source: "Stock SIRENE local filtré par établissement actif"
    }
  }, { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } });
}
