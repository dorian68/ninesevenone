import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getEnterpriseCompanyBySiren } from "@/lib/enterprise-db";
import { consumePublicRateLimit } from "@/lib/public-rate-limit";
import { createCompanyUpdateRequest, getApprovedClaimForUpdate } from "@/lib/moderation-db";

const updateSchema = z.object({
  claimId: z.string().uuid(),
  professionalEmail: z.string().trim().email().max(254),
  siteWeb: z.union([z.string().trim().url().max(500), z.literal("")]).optional(),
  telephonePublic: z.string().trim().max(80).optional(),
  emailPublic: z.union([z.string().trim().email().max(254), z.literal("")]).optional(),
  openingHoursPublic: z.string().trim().max(1000).optional(),
  descriptionCourte: z.string().trim().min(20).max(600).optional()
}).strict().refine((value) => [value.siteWeb, value.telephonePublic, value.emailPublic, value.openingHoursPublic, value.descriptionCourte].some((item) => Boolean(item?.trim())), {
  message: "Au moins un enrichissement est requis"
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ siren: string }> }) {
  const { siren } = await params;
  if (!/^\d{9}$/.test(siren)) return NextResponse.json({ error: "SIREN invalide" }, { status: 400 });
  if (!getEnterpriseCompanyBySiren(siren)) return NextResponse.json({ error: "Entreprise introuvable" }, { status: 404 });
  if (!consumePublicRateLimit(request, "company-update")) return NextResponse.json({ error: "Trop de demandes. Réessayez plus tard." }, { status: 429, headers: { "Retry-After": "60" } });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Proposition de mise à jour invalide", details: parsed.error.flatten() }, { status: 400 });
  const claim = getApprovedClaimForUpdate(parsed.data.claimId, siren, parsed.data.professionalEmail);
  if (!claim) return NextResponse.json({ error: "Une revendication approuvée correspondant à cette entreprise et à cet email est requise." }, { status: 403 });
  const updateRequest = createCompanyUpdateRequest({
    siren,
    claimId: claim.id,
    professionalEmail: claim.professionalEmail,
    payload: {
      siteWeb: parsed.data.siteWeb || undefined,
      telephonePublic: parsed.data.telephonePublic?.trim() || undefined,
      emailPublic: parsed.data.emailPublic || undefined,
      openingHoursPublic: parsed.data.openingHoursPublic?.trim() || undefined,
      descriptionCourte: parsed.data.descriptionCourte?.trim() || undefined
    }
  });
  return NextResponse.json({ updateRequestId: updateRequest?.id, status: updateRequest?.status }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
