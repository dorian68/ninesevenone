import "server-only";

import type { NextRequest } from "next/server";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

const env = (process as unknown as { env: Record<string, string | undefined> }).env;

function settings() {
  const windowSeconds = Number(env.RATE_LIMIT_WINDOW_SECONDS ?? "60");
  const maxRequests = Number(env.RATE_LIMIT_MAX_REQUESTS ?? "120");
  return {
    windowMs: Number.isFinite(windowSeconds) && windowSeconds >= 1 && windowSeconds <= 3600 ? windowSeconds * 1000 : 60_000,
    max: Number.isFinite(maxRequests) && maxRequests >= 1 && maxRequests <= 1000 ? Math.floor(maxRequests) : 120
  };
}

function requestKey(request: NextRequest, scope: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "anonymous";
  return `${scope}:${address}`;
}

export function consumePublicRateLimit(request: NextRequest, scope: string) {
  const { windowMs, max } = settings();
  const key = requestKey(request, scope);
  const currentTime = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= currentTime) {
    buckets.set(key, { count: 1, resetAt: currentTime + windowMs });
    if (buckets.size > 4096) {
      for (const [bucketKey, bucket] of buckets) if (bucket.resetAt <= currentTime) buckets.delete(bucketKey);
    }
    return true;
  }
  if (current.count >= max) return false;
  current.count += 1;
  return true;
}
