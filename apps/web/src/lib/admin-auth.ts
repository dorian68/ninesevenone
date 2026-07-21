import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const ADMIN_COOKIE = "guad_admin_session";
const SESSION_MAX_AGE = 60 * 60 * 8;
const env = (process as unknown as { env: Record<string, string | undefined> }).env;

export type AdminRole = "SUPER_ADMIN" | "DATA_ADMIN" | "MODERATOR";

function configuredToken() {
  return env.ADMIN_ACCESS_TOKEN?.trim() || null;
}

function sessionSecret() {
  return env.ADMIN_SESSION_SECRET?.trim() || env.AUTH_SECRET?.trim() || null;
}

function equalSecret(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function sign(payload: string) {
  const secret = sessionSecret();
  return secret ? createHmac("sha256", secret).update(payload).digest("base64url") : null;
}

function makeSession(role: AdminRole) {
  const payload = Buffer.from(JSON.stringify({ role, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE, nonce: randomBytes(12).toString("hex") })).toString("base64url");
  const signature = sign(payload);
  return signature ? `${payload}.${signature}` : null;
}

function readSession(value: string | undefined) {
  if (!value || !sessionSecret()) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature || !equalSecret(signature, sign(payload) ?? "")) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { role?: AdminRole; exp?: number };
    if (!data.role || !["SUPER_ADMIN", "DATA_ADMIN", "MODERATOR"].includes(data.role) || !data.exp || data.exp <= Math.floor(Date.now() / 1000)) return null;
    return { role: data.role };
  } catch {
    return null;
  }
}

export function isAdminAuthConfigured() {
  return Boolean(configuredToken() && sessionSecret());
}

export function authenticateAdminToken(value: string | undefined) {
  const token = configuredToken();
  if (!token || !value || !equalSecret(value, token)) return null;
  const configuredRole = env.ADMIN_ROLE;
  const role: AdminRole = configuredRole === "DATA_ADMIN" || configuredRole === "MODERATOR" ? configuredRole : "SUPER_ADMIN";
  return { role };
}

export function getAdminAuth(request: NextRequest) {
  const header = request.headers.get("x-admin-token") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return authenticateAdminToken(header) ?? readSession(request.cookies.get(ADMIN_COOKIE)?.value);
}

export function attachAdminSession(response: NextResponse, role: AdminRole) {
  const token = makeSession(role);
  if (!token) return response;
  response.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE
  });
  return response;
}

export function clearAdminSession(response: NextResponse) {
  response.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, sameSite: "strict", secure: env.NODE_ENV === "production", path: "/", maxAge: 0 });
  return response;
}

export function adminUnauthorized(message = "Session administrateur requise") {
  return NextResponse.json({ error: message }, { status: 401, headers: { "Cache-Control": "no-store" } });
}

export function adminForbidden(message = "Rôle administrateur insuffisant") {
  return NextResponse.json({ error: message }, { status: 403, headers: { "Cache-Control": "no-store" } });
}

export function hasAdminRole(role: AdminRole, allowed: readonly AdminRole[]) {
  return allowed.includes(role);
}
