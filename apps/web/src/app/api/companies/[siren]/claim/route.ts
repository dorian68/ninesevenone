import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createCompanyClaim } from "@/lib/moderation-db";
import { getEnterpriseCompanyBySiren } from "@/lib/enterprise-db";
import { consumePublicRateLimit } from "@/lib/public-rate-limit";

const claimSchema = z.object({
  claimantName: z.string().trim().min(2).max(120),
  professionalEmail: z.string().trim().email().max(254),
  companyRole: z.string().trim().min(2).max(120),
  evidenceUrl: z.union([z.string().trim().url().max(500), z.literal("")]).optional(),
  message: z.string().trim().min(20).max(3000),
  consent: z.literal(true)
}).strict();

export async function POST(request: NextRequest, { params }: { params: Promise<{ siren: string }> }) {
  const { siren } = await params;
  if (!/^\d{9}$/.test(siren)) return NextResponse.json({ error: "SIREN invalide" }, { status: 400 });
  if (!getEnterpriseCompanyBySiren(siren)) return NextResponse.json({ error: "Entreprise introuvable" }, { status: 404 });
  if (!consumePublicRateLimit(request, "claim")) return NextResponse.json({ error: "Trop de demandes. Réessayez plus tard." }, { status: 429, headers: { "Retry-After": "60" } });
  const parsed = claimSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Données de revendication invalides", details: parsed.error.flatten() }, { status: 400 });
  const claim = createCompanyClaim({
    siren,
    claimantName: parsed.data.claimantName,
    professionalEmail: parsed.data.professionalEmail,
    companyRole: parsed.data.companyRole,
    evidenceUrl: parsed.data.evidenceUrl || null,
    message: parsed.data.message
  });
  return NextResponse.json({ claimId: claim?.id, status: claim?.status }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
