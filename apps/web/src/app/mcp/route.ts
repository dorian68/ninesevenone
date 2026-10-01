import { timingSafeEqual } from "node:crypto";

import { createMcpHandler } from "@modelcontextprotocol/server";

import { createCaraaiosMcpServer } from "@/lib/caraaios-mcp-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handler = createMcpHandler(createCaraaiosMcpServer, { maxRequestBodySize: 8_000_000 });

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function serve(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const hostname = url.hostname.toLowerCase();
  const hostHeader = request.headers.get("host")?.split(":")[0]?.toLowerCase();
  if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)
    || !hostHeader || !["localhost", "127.0.0.1", "[::1]"].includes(hostHeader)) {
    return Response.json({ error: "Local MCP endpoint only." }, { status: 403 });
  }
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname.toLowerCase())) {
        return Response.json({ error: "Origin not allowed." }, { status: 403 });
      }
    } catch { return Response.json({ error: "Origin not allowed." }, { status: 403 }); }
  }
  const secret = process.env.CARAAIOS_MCP_TOKEN;
  if (!secret || secret.length < 32) return Response.json({ error: "MCP token is not configured." }, { status: 503 });
  const authorization = request.headers.get("authorization");
  const supplied = authorization?.startsWith("Bearer ") ? authorization.slice(7)
    : request.headers.get("x-caraaios-mcp-key");
  if (!supplied || !sameSecret(supplied, secret)) {
    return Response.json({ error: "Unauthorized." }, { status: 401,
      headers: { "WWW-Authenticate": "Bearer realm=\"Caraaios CRM MCP\"", "Cache-Control": "no-store" } });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 8_000_000) return Response.json({ error: "MCP request too large." }, { status: 413 });
  return handler.fetch(request);
}

export { serve as GET, serve as POST, serve as DELETE };
