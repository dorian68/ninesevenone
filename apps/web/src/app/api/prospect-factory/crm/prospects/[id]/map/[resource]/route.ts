import { NextRequest, NextResponse } from "next/server";

import {
  createMapClaimSchema, createMapNodeSchema, createMapOpportunitySchema,
  createMapQuestionSchema, createMapRelationSchema, createMapSourceSchema,
  createMapStakeholderSchema, saveMapLayoutSchema
} from "@/lib/account-map-contract";
import {
  createAccountMapClaim, createAccountMapNode, createAccountMapOpportunity,
  createAccountMapQuestion, createAccountMapRelation, createAccountMapSource,
  createAccountMapStakeholder, saveAccountMapLayout
} from "@/lib/account-map-db";
import { accountMapRouteError, authorizeMapRequest, noStore, type MapRouteContext } from "../_route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, context: MapRouteContext) {
  const auth = await authorizeMapRequest(request, context, "json");
  if (auth.error) return auth.error;
  const resource = auth.params!.resource;
  const body: unknown = await request.json().catch(() => null);
  const accountId = auth.accountId!;
  try {
    switch (resource) {
      case "nodes": {
        const parsed = createMapNodeSchema.safeParse(body);
        if (!parsed.success) break;
        return NextResponse.json({ node: createAccountMapNode(accountId, parsed.data) }, { status: 201, headers: noStore });
      }
      case "relations": {
        const parsed = createMapRelationSchema.safeParse(body);
        if (!parsed.success) break;
        return NextResponse.json({ relation: createAccountMapRelation(accountId, parsed.data, auth.actorId) }, { status: 201, headers: noStore });
      }
      case "opportunities": {
        const parsed = createMapOpportunitySchema.safeParse(body);
        if (!parsed.success) break;
        return NextResponse.json({ opportunity: createAccountMapOpportunity(accountId, parsed.data) }, { status: 201, headers: noStore });
      }
      case "sources": {
        const parsed = createMapSourceSchema.safeParse(body);
        if (!parsed.success) break;
        return NextResponse.json({ source: createAccountMapSource(accountId, parsed.data) }, { status: 201, headers: noStore });
      }
      case "claims": {
        const parsed = createMapClaimSchema.safeParse(body);
        if (!parsed.success) break;
        return NextResponse.json({ claim: createAccountMapClaim(accountId, { ...parsed.data, value: parsed.data.value }, auth.actorId) }, { status: 201, headers: noStore });
      }
      case "questions": {
        const parsed = createMapQuestionSchema.safeParse(body);
        if (!parsed.success) break;
        return NextResponse.json({ question: createAccountMapQuestion(accountId, parsed.data) }, { status: 201, headers: noStore });
      }
      case "stakeholders": {
        const parsed = createMapStakeholderSchema.safeParse(body);
        if (!parsed.success) break;
        return NextResponse.json({ stakeholder: createAccountMapStakeholder(accountId, parsed.data, auth.actorId) }, { status: 201, headers: noStore });
      }
      case "layout": {
        const parsed = saveMapLayoutSchema.safeParse(body);
        if (!parsed.success) break;
        return NextResponse.json({ layout: saveAccountMapLayout(accountId, { ...parsed.data, viewport: parsed.data.viewport ?? null }) }, { headers: noStore });
      }
      default: return NextResponse.json({ error: "Ressource inconnue.", code: "UNKNOWN_MAP_RESOURCE" }, { status: 404, headers: noStore });
    }
    return NextResponse.json({ error: "Données de cartographie invalides.", code: "INVALID_ACCOUNT_MAP_BODY" }, { status: 422, headers: noStore });
  } catch (error) { return accountMapRouteError(error, `create ${resource}`); }
}
