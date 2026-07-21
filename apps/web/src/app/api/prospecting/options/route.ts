import { NextResponse } from "next/server";
import { getEnterpriseFilterOptions } from "@/lib/enterprise-db";

export function GET() {
  const options = getEnterpriseFilterOptions();
  if (!options) return NextResponse.json({ error: "Index territorial indisponible" }, { status: 503 });
  return NextResponse.json(options, { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } });
}
