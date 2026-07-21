import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { saveWorkspaceShortlist } from "@/lib/workspace-db";
import { attachWorkspaceCookie, getWorkspaceContext, workspaceError } from "@/lib/workspace-http";

const candidateSchema = z.object({
  establishmentId: z.string().min(1).max(120),
  siren: z.string().regex(/^\d{9}$/),
  siret: z.string().regex(/^\d{14}$/),
  name: z.string().max(240),
  legalName: z.string().max(240),
  commune: z.string().max(120),
  sector: z.string().max(180),
  nafCode: z.string().max(16),
  address: z.string().max(500),
  description: z.string().max(900),
  workforceBand: z.string().max(80).nullable().optional(),
  workforceYear: z.number().int().nullable().optional(),
  isHeadOffice: z.boolean().optional(),
  url: z.string().max(500)
}).strip();

const shortlistSchema = z.object({
  name: z.string().trim().min(1).max(120),
  items: z.array(candidateSchema).min(1).max(50)
}).strict();

export async function POST(request: NextRequest) {
  const context = getWorkspaceContext(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return workspaceError("Corps JSON invalide", 400);
  }
  const parsed = shortlistSchema.safeParse(body);
  if (!parsed.success) return workspaceError("Shortlist invalide", 422);
  const uniqueSirens = new Set(parsed.data.items.map((item) => item.siren));
  if (uniqueSirens.size !== parsed.data.items.length) return workspaceError("Une shortlist ne peut contenir qu’une fois chaque SIREN", 422);
  const shortlist = saveWorkspaceShortlist(context.workspaceId, parsed.data);
  return attachWorkspaceCookie(NextResponse.json({ shortlist }, { status: 201 }), context);
}
