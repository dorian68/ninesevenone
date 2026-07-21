import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminForbidden, adminUnauthorized, getAdminAuth, hasAdminRole } from "@/lib/admin-auth";
import { reviewCompanyUpdateRequest } from "@/lib/moderation-db";

const reviewSchema = z.object({ status: z.enum(["approved", "rejected"]), reviewNote: z.string().trim().max(2000).optional() }).strict();

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = getAdminAuth(request);
  if (!auth) return adminUnauthorized();
  if (!hasAdminRole(auth.role, ["SUPER_ADMIN", "DATA_ADMIN"])) return adminForbidden();
  const { id } = await params;
  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Décision invalide" }, { status: 400 });
  const updateRequest = reviewCompanyUpdateRequest(id, parsed.data.status, parsed.data.reviewNote || null, auth.role);
  if (!updateRequest) return NextResponse.json({ error: "Proposition introuvable" }, { status: 404 });
  return NextResponse.json({ updateRequest }, { headers: { "Cache-Control": "no-store" } });
}
