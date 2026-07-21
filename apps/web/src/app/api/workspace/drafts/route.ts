import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { saveWorkspaceDraft } from "@/lib/workspace-db";
import { attachWorkspaceCookie, getWorkspaceContext, workspaceError } from "@/lib/workspace-http";

const draftSchema = z.object({
  type: z.enum(["cv", "proposal"]),
  title: z.string().trim().min(1).max(180),
  targetSiren: z.string().regex(/^\d{9}$/).nullable().optional(),
  content: z.string().min(1).max(50_000)
}).strict();

export async function POST(request: NextRequest) {
  const context = getWorkspaceContext(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return workspaceError("Corps JSON invalide", 400);
  }
  const parsed = draftSchema.safeParse(body);
  if (!parsed.success) return workspaceError("Brouillon invalide", 422);
  const draft = saveWorkspaceDraft(context.workspaceId, { ...parsed.data, targetSiren: parsed.data.targetSiren ?? null });
  return attachWorkspaceCookie(NextResponse.json({ draft }, { status: 201 }), context);
}
