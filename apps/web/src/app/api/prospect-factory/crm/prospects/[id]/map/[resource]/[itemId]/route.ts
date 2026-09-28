import { NextRequest, NextResponse } from "next/server";

import {
  patchMapClaimSchema, patchMapNodeSchema, patchMapOpportunitySchema,
  patchMapQuestionSchema, patchMapRelationSchema, patchMapSourceSchema, patchMapStakeholderSchema
} from "@/lib/account-map-contract";
import {
  deleteAccountMapClaim, deleteAccountMapNode, deleteAccountMapOpportunity,
  deleteAccountMapQuestion, deleteAccountMapRelation, deleteAccountMapSource, deleteAccountMapStakeholder,
  updateAccountMapClaim, updateAccountMapNode, updateAccountMapOpportunity,
  updateAccountMapQuestion, updateAccountMapRelation, updateAccountMapSource, updateAccountMapStakeholder
} from "@/lib/account-map-db";
import { accountMapRouteError, authorizeMapRequest, mapIdSchema, noStore, type MapRouteContext } from "../../_route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: MapRouteContext) {
  const auth = await authorizeMapRequest(request, context, "json");
  if (auth.error) return auth.error;
  const item = mapIdSchema.safeParse(auth.params!.itemId);
  if (!item.success) return NextResponse.json({ error: "Identifiant invalide.", code: "INVALID_MAP_ITEM_ID" }, { status: 400, headers: noStore });
  const body: unknown = await request.json().catch(() => null);
  const accountId = auth.accountId!;
  try {
    let result: Record<string, unknown> | null = null;
    switch (auth.params!.resource) {
      case "nodes": {
        const parsed = patchMapNodeSchema.safeParse(body);
        if (!parsed.success) break;
        result = { node: updateAccountMapNode(accountId, item.data, parsed.data) }; break;
      }
      case "relations": {
        const parsed = patchMapRelationSchema.safeParse(body);
        if (!parsed.success) break;
        result = { relation: updateAccountMapRelation(accountId, item.data, parsed.data, auth.actorId) }; break;
      }
      case "opportunities": {
        const parsed = patchMapOpportunitySchema.safeParse(body);
        if (!parsed.success) break;
        result = { opportunity: updateAccountMapOpportunity(accountId, item.data, parsed.data) }; break;
      }
      case "sources": {
        const parsed = patchMapSourceSchema.safeParse(body);
        if (!parsed.success) break;
        result = { source: updateAccountMapSource(accountId, item.data, parsed.data) }; break;
      }
      case "claims": {
        const parsed = patchMapClaimSchema.safeParse(body);
        if (!parsed.success) break;
        result = { claim: updateAccountMapClaim(accountId, item.data, parsed.data, auth.actorId) }; break;
      }
      case "questions": {
        const parsed = patchMapQuestionSchema.safeParse(body);
        if (!parsed.success) break;
        result = { question: updateAccountMapQuestion(accountId, item.data, parsed.data) }; break;
      }
      case "stakeholders": {
        const parsed = patchMapStakeholderSchema.safeParse(body);
        if (!parsed.success) break;
        result = { stakeholder: updateAccountMapStakeholder(accountId, item.data, parsed.data, auth.actorId) }; break;
      }
      default: return NextResponse.json({ error: "Ressource inconnue.", code: "UNKNOWN_MAP_RESOURCE" }, { status: 404, headers: noStore });
    }
    if (!result) return NextResponse.json({ error: "Mise à jour invalide.", code: "INVALID_ACCOUNT_MAP_BODY" }, { status: 422, headers: noStore });
    if (Object.values(result)[0] === null) return NextResponse.json({ error: "Élément introuvable.", code: "MAP_ITEM_NOT_FOUND" }, { status: 404, headers: noStore });
    return NextResponse.json(result, { headers: noStore });
  } catch (error) { return accountMapRouteError(error, `update ${auth.params!.resource}`); }
}

export async function DELETE(request: NextRequest, context: MapRouteContext) {
  const auth = await authorizeMapRequest(request, context, "delete");
  if (auth.error) return auth.error;
  const item = mapIdSchema.safeParse(auth.params!.itemId);
  if (!item.success) return NextResponse.json({ error: "Identifiant invalide.", code: "INVALID_MAP_ITEM_ID" }, { status: 400, headers: noStore });
  const accountId = auth.accountId!;
  try {
    let deleted: boolean;
    switch (auth.params!.resource) {
      case "nodes": deleted = deleteAccountMapNode(accountId, item.data); break;
      case "relations": deleted = deleteAccountMapRelation(accountId, item.data); break;
      case "opportunities": deleted = deleteAccountMapOpportunity(accountId, item.data); break;
      case "sources": deleted = deleteAccountMapSource(accountId, item.data); break;
      case "claims": deleted = deleteAccountMapClaim(accountId, item.data); break;
      case "questions": deleted = deleteAccountMapQuestion(accountId, item.data); break;
      case "stakeholders": deleted = deleteAccountMapStakeholder(accountId, item.data); break;
      default: return NextResponse.json({ error: "Ressource inconnue.", code: "UNKNOWN_MAP_RESOURCE" }, { status: 404, headers: noStore });
    }
    if (!deleted) return NextResponse.json({ error: "Élément introuvable.", code: "MAP_ITEM_NOT_FOUND" }, { status: 404, headers: noStore });
    return NextResponse.json({ deleted: true }, { headers: noStore });
  } catch (error) { return accountMapRouteError(error, `delete ${auth.params!.resource}`); }
}
