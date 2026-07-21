import { NextRequest, NextResponse } from "next/server";
import { ensureWorkspace, getWorkspaceRetentionDays, WORKSPACE_COOKIE, type WorkspaceContext } from "@/lib/workspace-db";

const workspaceCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: (process as unknown as { env: Record<string, string | undefined> }).env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * getWorkspaceRetentionDays()
};

export function getWorkspaceContext(request: NextRequest) {
  return ensureWorkspace(request.cookies.get(WORKSPACE_COOKIE)?.value);
}

export function attachWorkspaceCookie(response: NextResponse, context: WorkspaceContext) {
  if (context.isNew) response.cookies.set(WORKSPACE_COOKIE, context.token, workspaceCookieOptions);
  return response;
}

export function workspaceError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
