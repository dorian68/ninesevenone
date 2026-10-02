import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { adminForbidden, adminUnauthorized, getAdminAuth, hasAdminRole, type AdminRole } from "@/lib/admin-auth";
import { consumePublicRateLimit } from "@/lib/public-rate-limit";

export function authorizeProspectCrm(request: NextRequest): { role: AdminRole } | NextResponse {
  const auth = getAdminAuth(request);
  if (!auth) return adminUnauthorized();
  if (!hasAdminRole(auth.role, ["SUPER_ADMIN", "DATA_ADMIN"])) return adminForbidden("Accès au suivi commercial réservé aux rôles data.");
  return auth;
}

export function validateProspectCrmMutation(request: NextRequest, maximumBytes = 65_536) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Le corps doit être envoyé en JSON.", code: "JSON_REQUIRED" }, { status: 415, headers: { "Cache-Control": "no-store" } });
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 1_000_000) {
    throw new Error("Invalid Prospect CRM mutation payload limit.");
  }
  if (Number.isFinite(length) && length > maximumBytes) {
    return NextResponse.json({ error: "Corps de requête trop volumineux.", code: "PAYLOAD_TOO_LARGE" }, { status: 413, headers: { "Cache-Control": "no-store" } });
  }
  return validateProspectCrmOriginAndRate(request, "prospect-factory-crm-write");
}

function validateProspectCrmOriginAndRate(request: NextRequest, rateBucket: string) {
  const origin = request.headers.get("origin");
  if (origin) {
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const expectedHost = forwardedHost || request.headers.get("host") || request.nextUrl.host;
    try {
      if (new URL(origin).host !== expectedHost) return adminForbidden("Origine de la requête refusée.");
    } catch {
      return adminForbidden("Origine de la requête invalide.");
    }
  }
  if (!consumePublicRateLimit(request, rateBucket)) {
    return NextResponse.json({ error: "Trop de modifications. Réessayez dans une minute.", code: "RATE_LIMITED" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
  }
  return null;
}

export function validateProspectCrmUpload(request: NextRequest) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
    return NextResponse.json({ error: "Une pièce jointe doit être envoyée en formulaire multipart.", code: "MULTIPART_REQUIRED" },
      { status: 415, headers: { "Cache-Control": "no-store" } });
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > 11 * 1024 * 1024) {
    return NextResponse.json({ error: "Pièce jointe trop volumineuse (10 Mo maximum).", code: "PAYLOAD_TOO_LARGE" },
      { status: 413, headers: { "Cache-Control": "no-store" } });
  }
  return validateProspectCrmOriginAndRate(request, "prospect-factory-crm-upload");
}

export function crmError(message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status, headers: { "Cache-Control": "no-store" } });
}
