import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminUnauthorized, getAdminAuth } from "@/lib/admin-auth";
import { reviewCompanyReport } from "@/lib/moderation-db";

const reviewSchema = z.object({ status: z.enum(["resolved", "dismissed"]), reviewNote: z.string().trim().max(2000).optional() }).strict();

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = getAdminAuth(request);
  if (!auth) return adminUnauthorized();
  const { id } = await params;
  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Décision invalide" }, { status: 400 });
  const report = reviewCompanyReport(id, parsed.data.status, parsed.data.reviewNote || null, auth.role);
  if (!report) return NextResponse.json({ error: "Signalement introuvable" }, { status: 404 });
  return NextResponse.json({ report }, { headers: { "Cache-Control": "no-store" } });
}
