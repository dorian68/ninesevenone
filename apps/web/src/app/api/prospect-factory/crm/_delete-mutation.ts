import { NextRequest, NextResponse } from "next/server";

import { adminForbidden } from "@/lib/admin-auth";
import { consumePublicRateLimit } from "@/lib/public-rate-limit";

/** Apply the CRM write guards to bodyless DELETE requests. */
export function validateProspectCrmDelete(request: NextRequest) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > 65_536) {
    return NextResponse.json({ error: "Corps de requête trop volumineux.", code: "PAYLOAD_TOO_LARGE" }, { status: 413, headers: { "Cache-Control": "no-store" } });
  }

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

  if (!consumePublicRateLimit(request, "prospect-factory-crm-write")) {
    return NextResponse.json({ error: "Trop de modifications. Réessayez dans une minute.", code: "RATE_LIMITED" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
  }
  return null;
}
