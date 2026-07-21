import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const environment = (process as unknown as { env: Record<string, string | undefined> }).env;
const previous = {
  token: environment.ADMIN_ACCESS_TOKEN,
  secret: environment.ADMIN_SESSION_SECRET,
  role: environment.ADMIN_ROLE
};
environment.ADMIN_ACCESS_TOKEN = "vitest-admin-token";
environment.ADMIN_SESSION_SECRET = "vitest-admin-session-secret";
environment.ADMIN_ROLE = "DATA_ADMIN";

let adminAuth: typeof import("./admin-auth");

beforeAll(async () => {
  adminAuth = await import("./admin-auth");
});

afterAll(() => {
  environment.ADMIN_ACCESS_TOKEN = previous.token;
  environment.ADMIN_SESSION_SECRET = previous.secret;
  environment.ADMIN_ROLE = previous.role;
});

describe("admin authentication", () => {
  it("accepts the server token and validates the signed HttpOnly session", () => {
    const tokenRequest = new NextRequest("http://localhost/admin", { headers: { "x-admin-token": "vitest-admin-token" } });
    expect(adminAuth.getAdminAuth(tokenRequest)).toEqual({ role: "DATA_ADMIN" });

    const response = adminAuth.attachAdminSession(NextResponse.json({ authenticated: true }), "DATA_ADMIN");
    const sessionValue = response.cookies.get(adminAuth.ADMIN_COOKIE)?.value;
    expect(sessionValue).toBeTruthy();
    const sessionRequest = new NextRequest("http://localhost/admin", { headers: { cookie: `${adminAuth.ADMIN_COOKIE}=${sessionValue}` } });
    expect(adminAuth.getAdminAuth(sessionRequest)).toEqual({ role: "DATA_ADMIN" });
    expect(adminAuth.hasAdminRole("DATA_ADMIN", ["SUPER_ADMIN", "DATA_ADMIN"])).toBe(true);
    expect(adminAuth.hasAdminRole("MODERATOR", ["SUPER_ADMIN", "DATA_ADMIN"])).toBe(false);
  });
});
