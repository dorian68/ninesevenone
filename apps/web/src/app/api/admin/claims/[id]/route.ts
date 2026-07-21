import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminUnauthorized, getAdminAuth } from "@/lib/admin-auth";
import { reviewCompanyClaim } from "@/lib/moderation-db";

const reviewSchema = z.object({ status: z.enum(["approved", "rejected"]), reviewNote: z.string().trim().max(2000).optional() }).strict();

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = getAdminAuth(request);
  if (!auth) return adminUnauthorized();
  const { id } = await params;
  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Décision invalide" }, { status: 400 });
  const claim = reviewCompanyClaim(id, parsed.data.status, parsed.data.reviewNote || null, auth.role);
  if (!claim) return NextResponse.json({ error: "Revendication introuvable" }, { status: 404 });
  return NextResponse.json({ claim }, { headers: { "Cache-Control": "no-store" } });
}
