import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createCompanyReport } from "@/lib/moderation-db";
import { getEnterpriseCompanyBySiren } from "@/lib/enterprise-db";
import { consumePublicRateLimit } from "@/lib/public-rate-limit";

const reportSchema = z.object({
  category: z.enum(["factual_error", "personal_data", "closed", "other"]),
  message: z.string().trim().min(10).max(3000),
  contactEmail: z.union([z.string().trim().email().max(254), z.literal("")]).optional()
}).strict();

export async function POST(request: NextRequest, { params }: { params: Promise<{ siren: string }> }) {
  const { siren } = await params;
  if (!/^\d{9}$/.test(siren)) return NextResponse.json({ error: "SIREN invalide" }, { status: 400 });
  if (!getEnterpriseCompanyBySiren(siren)) return NextResponse.json({ error: "Entreprise introuvable" }, { status: 404 });
  if (!consumePublicRateLimit(request, "report")) return NextResponse.json({ error: "Trop de signalements. Réessayez plus tard." }, { status: 429, headers: { "Retry-After": "60" } });
  const parsed = reportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Données de signalement invalides", details: parsed.error.flatten() }, { status: 400 });
  const report = createCompanyReport({ siren, category: parsed.data.category, message: parsed.data.message, contactEmail: parsed.data.contactEmail || null });
  return NextResponse.json({ reportId: report?.id, status: report?.status }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
