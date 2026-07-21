import { NextRequest, NextResponse } from "next/server";
import { deleteWorkspaceResource } from "@/lib/workspace-db";
import { attachWorkspaceCookie, getWorkspaceContext, workspaceError } from "@/lib/workspace-http";

const resources = new Set(["saved-searches", "shortlists", "drafts"] as const);

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ resource: string; id: string }> }) {
  const { resource, id } = await params;
  if (!resources.has(resource as "saved-searches" | "shortlists" | "drafts") || !/^[0-9a-f-]{36}$/.test(id)) return workspaceError("Ressource workspace invalide", 400);
  const context = getWorkspaceContext(request);
  const deleted = deleteWorkspaceResource(context.workspaceId, resource as "saved-searches" | "shortlists" | "drafts", id);
  if (!deleted) return workspaceError("Ressource workspace introuvable", 404);
  return attachWorkspaceCookie(NextResponse.json({ deleted: true }), context);
}
