import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { saveWorkspaceSearch } from "@/lib/workspace-db";
import { attachWorkspaceCookie, getWorkspaceContext, workspaceError } from "@/lib/workspace-http";

const searchSchema = z.object({
  name: z.string().trim().min(1).max(120),
  query: z.string().trim().max(180).default(""),
  sector: z.string().trim().max(160).default(""),
  commune: z.string().trim().max(120).default("")
}).strict();

export async function POST(request: NextRequest) {
  const context = getWorkspaceContext(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return workspaceError("Corps JSON invalide", 400);
  }
  const parsed = searchSchema.safeParse(body);
  if (!parsed.success) return workspaceError("Recherche sauvegardée invalide", 422);
  const savedSearch = saveWorkspaceSearch(context.workspaceId, parsed.data);
  return attachWorkspaceCookie(NextResponse.json({ savedSearch }, { status: 201 }), context);
}
