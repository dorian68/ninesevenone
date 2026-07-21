import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminUnauthorized, attachAdminSession, authenticateAdminToken, clearAdminSession, getAdminAuth, isAdminAuthConfigured } from "@/lib/admin-auth";

const loginSchema = z.object({ token: z.string().min(1).max(512) }).strict();

export async function GET(request: NextRequest) {
  const auth = getAdminAuth(request);
  return NextResponse.json({ configured: isAdminAuthConfigured(), authenticated: Boolean(auth), role: auth?.role ?? null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!isAdminAuthConfigured()) return NextResponse.json({ error: "Authentification administrateur non configurée" }, { status: 503 });
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Jeton administrateur invalide" }, { status: 400 });
  const auth = authenticateAdminToken(parsed.data.token);
  if (!auth) return adminUnauthorized("Jeton administrateur invalide");
  return attachAdminSession(NextResponse.json({ authenticated: true, role: auth.role }, { headers: { "Cache-Control": "no-store" } }), auth.role);
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false }, { headers: { "Cache-Control": "no-store" } });
  return clearAdminSession(response);
}
