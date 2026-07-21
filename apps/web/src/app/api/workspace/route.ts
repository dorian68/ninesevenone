import { NextRequest, NextResponse } from "next/server";
import { clearWorkspace, getWorkspaceRetentionDays, getWorkspaceSnapshot } from "@/lib/workspace-db";
import { attachWorkspaceCookie, getWorkspaceContext } from "@/lib/workspace-http";

export function GET(request: NextRequest) {
  const context = getWorkspaceContext(request);
  return attachWorkspaceCookie(NextResponse.json({
    ...getWorkspaceSnapshot(context.workspaceId),
    metadata: {
      persistence: "anonymous_http_only_cookie",
      workspaceCreated: context.isNew,
      retentionDays: getWorkspaceRetentionDays()
    }
  }), context);
}

export function DELETE(request: NextRequest) {
  const context = getWorkspaceContext(request);
  clearWorkspace(context.workspaceId);
  const response = NextResponse.json({ deleted: true });
  response.cookies.delete("guad_workspace");
  return response;
}
