import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as getOverview } from "@/app/api/prospect-factory/overview/route";
import { GET as getFacets } from "@/app/api/prospect-factory/facets/route";

const environment = process.env as Record<string, string | undefined>;
const saved = {
  token: environment.ADMIN_ACCESS_TOKEN,
  secret: environment.ADMIN_SESSION_SECRET,
  role: environment.ADMIN_ROLE
};

describe("Prospect Factory access control", () => {
  beforeEach(() => {
    environment.ADMIN_ACCESS_TOKEN = "prospect-test-token";
    environment.ADMIN_SESSION_SECRET = "prospect-test-secret-with-enough-entropy";
  });

  afterEach(() => {
    environment.ADMIN_ACCESS_TOKEN = saved.token;
    environment.ADMIN_SESSION_SECRET = saved.secret;
    environment.ADMIN_ROLE = saved.role;
  });

  it("fails closed without a data session", async () => {
    const response = getOverview(new NextRequest("http://localhost/api/prospect-factory/overview"));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await getFacets(new NextRequest("http://localhost/api/prospect-factory/facets"))).status).toBe(401);
  });

  it("rejects a moderator even with a valid server token", () => {
    environment.ADMIN_ROLE = "MODERATOR";
    const response = getOverview(new NextRequest("http://localhost/api/prospect-factory/overview", { headers: { "x-admin-token": "prospect-test-token" } }));
    expect(response.status).toBe(403);
  });

  it("allows the data administrator without making the response publicly cacheable", async () => {
    environment.ADMIN_ROLE = "DATA_ADMIN";
    const response = getOverview(new NextRequest("http://localhost/api/prospect-factory/overview", { headers: { "x-admin-token": "prospect-test-token" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = await response.json() as { snapshot: { summary: { total: number } } };
    expect(payload.snapshot.summary.total).toBeGreaterThan(25_000_000);
  });
});
