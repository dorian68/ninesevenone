import { NextResponse } from "next/server";
import { getBusinessIntelligence } from "@/lib/business-intelligence";
import { getEnterpriseCompanyBySiren, getEnterpriseLocationsBySiren } from "@/lib/enterprise-db";

export async function GET(_: Request, { params }: { params: Promise<{ siren: string }> }) {
  const { siren } = await params;
  if (!/^\d{9}$/.test(siren)) {
    return NextResponse.json({ error: "SIREN invalide" }, { status: 400 });
  }
  const company = getEnterpriseCompanyBySiren(siren);
  if (!company) {
    return NextResponse.json({ error: "Entreprise introuvable" }, { status: 404 });
  }
  const activeSirets = getEnterpriseLocationsBySiren(siren)?.map((establishment) => establishment.siret) ?? [];
  const intelligence = await getBusinessIntelligence(siren, company.legal_name, activeSirets);
  return NextResponse.json(intelligence, {
    headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=86400" }
  });
}
