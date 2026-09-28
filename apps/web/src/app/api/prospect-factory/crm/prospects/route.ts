import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authorizeProspectCrm, crmError, validateProspectCrmMutation } from "@/lib/prospect-factory-crm-http";
import { addProspect, addProspectActivity, getPipelineCounts, getProspectByWarehouseId, getProspectFilterOptions, listProspectActivities, listProspects, PROSPECT_PRIORITIES, PROSPECT_QUALIFICATION_CONFIDENCES, PROSPECT_QUALIFICATION_STATUSES, PROSPECT_QUALIFICATION_TIERS } from "@/lib/prospect-factory-crm-db";
import { getProspectFactoryById, ProspectFactoryInputError } from "@/lib/prospect-factory-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const prospectCertifications = ["gold", "silver", "bronze", "blocked"] as const;
const prospectContactFilters = ["any", "email", "phone", "website", "no_website"] as const;

const addSchema = z.object({
  warehouseId: z.string().regex(/^[A-Za-z0-9:_-]{1,64}$/),
  qualification: z.object({
    status: z.enum(PROSPECT_QUALIFICATION_STATUSES).optional(),
    priority: z.enum(PROSPECT_PRIORITIES).optional()
  }).strict().optional()
}).strict();
const nullableText = (maximum: number) => z.string().trim().min(1).max(maximum).optional();
const nullableHttpUrl = z.string().trim().url().max(2_048).refine((value) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}, "Seules les URL HTTP et HTTPS sont acceptées.").optional();
const manualAddSchema = z.object({
  manual: z.literal(true),
  companyName: z.string().trim().min(1).max(10_000),
  commercialName: nullableText(10_000),
  // Geography is mandatory: a US Apollo account must never inherit the
  // historical Guadeloupe defaults used by the original manual form.
  country: z.string().trim().min(1).max(1_000),
  territory: z.string().trim().min(1).max(2_000),
  region: nullableText(2_000),
  city: nullableText(2_000),
  vertical: nullableText(5_000),
  activityDetail: nullableText(100_000),
  employeeRange: nullableText(2_000),
  contactName: nullableText(180),
  email: z.string().trim().email().max(320).optional(),
  phone: nullableText(60),
  website: nullableHttpUrl,
  status: z.enum(PROSPECT_QUALIFICATION_STATUSES).default("to_qualify"),
  priority: z.enum(PROSPECT_PRIORITIES).default("normal"),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  notes: z.string().max(20_000).default(""),
  nextActionAt: z.string().datetime({ offset: true }).nullable().optional(),
  owner: nullableText(180),
  campaign: nullableText(180),
  potentialValue: z.number().finite().min(0).max(1_000_000_000).nullable().optional(),
  probability: z.number().int().min(0).max(100).nullable().optional(),
  expectedCloseAt: z.string().datetime({ offset: true }).nullable().optional(),
  disqualificationReason: nullableText(500),
  fitScore: z.number().int().min(0).max(30).nullable().optional(),
  painScore: z.number().int().min(0).max(30).nullable().optional(),
  timingScore: z.number().int().min(0).max(20).nullable().optional(),
  personaScore: z.number().int().min(0).max(20).nullable().optional(),
  scoreTotal: z.number().int().min(0).max(100).nullable().optional(),
  tier: z.enum(PROSPECT_QUALIFICATION_TIERS).nullable().optional(),
  confidence: z.enum(PROSPECT_QUALIFICATION_CONFIDENCES).nullable().optional(),
  scoreReason: nullableText(10_000).optional()
}).strict();
const addPayloadSchema = z.union([addSchema, manualAddSchema]);

export function GET(request: NextRequest) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const parameters = request.nextUrl.searchParams;
  const status = parameters.get("status");
  const priority = parameters.get("priority");
  const country = parameters.get("country")?.trim() || undefined;
  const territory = parameters.get("territory")?.trim() || undefined;
  const vertical = parameters.get("vertical")?.trim() || undefined;
  const origin = parameters.get("origin")?.trim() || undefined;
  const certification = parameters.get("certification") || undefined;
  const contact = parameters.get("contact") || undefined;
  const rawMinScore = parameters.get("minScore");
  const minScore = rawMinScore === null ? undefined : Number(rawMinScore);
  if (status && !PROSPECT_QUALIFICATION_STATUSES.includes(status as typeof PROSPECT_QUALIFICATION_STATUSES[number])) return crmError("Étape commerciale invalide.", 422, "INVALID_STATUS");
  if (priority && !PROSPECT_PRIORITIES.includes(priority as typeof PROSPECT_PRIORITIES[number])) return crmError("Priorité invalide.", 422, "INVALID_PRIORITY");
  if (country && country.length > 1_000) return crmError("Pays invalide.", 422, "INVALID_COUNTRY");
  if (territory && territory.length > 2_000) return crmError("Territoire invalide.", 422, "INVALID_TERRITORY");
  if (vertical && vertical.length > 5_000) return crmError("Activité invalide.", 422, "INVALID_VERTICAL");
  if (origin && origin.length > 2_000) return crmError("Source invalide.", 422, "INVALID_ORIGIN");
  if (certification && !(prospectCertifications as readonly string[]).includes(certification)) return crmError("Certification invalide.", 422, "INVALID_CERTIFICATION");
  if (contact && !(prospectContactFilters as readonly string[]).includes(contact)) return crmError("Filtre de contact invalide.", 422, "INVALID_CONTACT_FILTER");
  if (rawMinScore !== null && (!/^\d{1,3}$/.test(rawMinScore) || !Number.isInteger(minScore) || minScore! < 0 || minScore! > 100)) return crmError("Score minimum invalide.", 422, "INVALID_MIN_SCORE");
  const rawQuery = parameters.get("query")?.trim() || undefined;
  if (rawQuery && rawQuery.length > 120) return crmError("Recherche trop longue.", 422, "INVALID_QUERY");
  const limit = Number(parameters.get("limit") ?? "50");
  const offset = Number(parameters.get("offset") ?? "0");
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) return crmError("Limite de page invalide.", 422, "INVALID_LIMIT");
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10_000_000) return crmError("Position de page invalide.", 422, "INVALID_OFFSET");
  try {
    const result = listProspects({
      status: status ? status as typeof PROSPECT_QUALIFICATION_STATUSES[number] : undefined,
      priority: priority ? priority as typeof PROSPECT_PRIORITIES[number] : undefined,
      country,
      territory,
      vertical,
      origin,
      certification: certification as typeof prospectCertifications[number] | undefined,
      contact: contact as typeof prospectContactFilters[number] | undefined,
      minScore,
      query: rawQuery,
      limit,
      offset
    });
    return NextResponse.json({ ...result, filterOptions: getProspectFilterOptions(), counts: getPipelineCounts() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Prospect CRM list failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("Le suivi commercial n’a pas pu être chargé.", 503, "CRM_LIST_FAILED");
  }
}

export async function POST(request: NextRequest) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;
  const invalidMutation = validateProspectCrmMutation(request);
  if (invalidMutation) return invalidMutation;
  const parsed = addPayloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return crmError("Les informations du prospect sont invalides.", 422, "INVALID_PROSPECT_INPUT");
  try {
    if ("manual" in parsed.data) {
      const manual = parsed.data;
      const warehouseId = `manual:${randomUUID()}`;
      const prospect = addProspect({
        warehouseId,
        snapshot: {
          dedupeKey: warehouseId,
          companyName: manual.companyName,
          commercialName: manual.commercialName ?? manual.companyName,
          country: manual.country,
          territory: manual.territory,
          region: manual.region ?? null,
          city: manual.city ?? null,
          vertical: manual.vertical ?? null,
          recordOrigin: "manual",
          sourceUrls: manual.website ?? "",
          leadScore: 0,
          certification: "bronze",
          contactName: manual.contactName,
          email: manual.email,
          phone: manual.phone,
          website: manual.website,
          activityDetail: manual.activityDetail,
          employeeRange: manual.employeeRange
        },
        enrichment: {
          contactName: manual.contactName ?? null,
          email: manual.email ?? null,
          phone: manual.phone ?? null,
          website: manual.website ?? null
        },
        qualification: {
          status: manual.status,
          priority: manual.priority,
          tags: manual.tags,
          notes: manual.notes,
          nextActionAt: manual.nextActionAt ?? null,
          owner: manual.owner ?? null,
          campaign: manual.campaign ?? null,
          potentialValue: manual.potentialValue ?? null,
          probability: manual.probability ?? null,
          expectedCloseAt: manual.expectedCloseAt ?? null,
          disqualificationReason: manual.disqualificationReason ?? null,
          fitScore: manual.fitScore ?? null,
          painScore: manual.painScore ?? null,
          timingScore: manual.timingScore ?? null,
          personaScore: manual.personaScore ?? null,
          scoreTotal: manual.scoreTotal ?? null,
          tier: manual.tier ?? null,
          confidence: manual.confidence ?? null,
          scoreReason: manual.scoreReason ?? null
        }
      });
      const recorded = addProspectActivity(prospect.id, { type: "status_change", direction: "internal", subject: "Ajout manuel au suivi", body: "Prospect créé depuis le suivi commercial.", actorRole: auth.role, statusAfter: manual.status });
      return NextResponse.json({ prospect: recorded?.prospect ?? prospect, canonical: null, activities: recorded ? [recorded.activity] : [], created: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    const existing = getProspectByWarehouseId(parsed.data.warehouseId);
    if (existing) return NextResponse.json({ prospect: existing, canonical: await getProspectFactoryById(existing.warehouseId, request.signal), activities: listProspectActivities(existing.id), created: false }, { headers: { "Cache-Control": "no-store" } });
    const canonical = await getProspectFactoryById(parsed.data.warehouseId, request.signal);
    if (!canonical) return crmError("Ce prospect n’existe plus dans le référentiel.", 404, "PROSPECT_NOT_FOUND");
    const prospect = addProspect({
      warehouseId: canonical.warehouseId,
      snapshot: {
        dedupeKey: canonical.dedupeKey,
        companyName: canonical.companyName,
        commercialName: canonical.commercialName,
        country: canonical.country,
        territory: canonical.territory,
        region: canonical.region,
        city: canonical.city,
        vertical: canonical.vertical,
        recordOrigin: canonical.recordOrigin,
        sourceUrls: canonical.sourceUrls,
        leadScore: canonical.leadScore,
        certification: canonical.certification,
        contactName: canonical.contactName,
        email: canonical.email,
        phone: canonical.phone,
        website: canonical.website,
        activityDetail: canonical.activityDetail,
        employeeRange: canonical.employeeRange
      },
      qualification: parsed.data.qualification
    });
    const recorded = addProspectActivity(prospect.id, { type: "status_change", direction: "internal", subject: parsed.data.qualification?.status === "disqualified" ? "Prospect écarté" : "Ajout au suivi", body: parsed.data.qualification?.status === "disqualified" ? "Entreprise écartée depuis l’explorateur : elle ne correspond pas à la cible commerciale." : "Prospect ajouté depuis l’explorateur.", actorRole: auth.role, statusAfter: parsed.data.qualification?.status ?? "to_qualify" });
    return NextResponse.json({ prospect: recorded?.prospect ?? prospect, canonical, activities: recorded ? [recorded.activity] : [], created: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProspectFactoryInputError) return crmError(error.message, 422, "INVALID_WAREHOUSE_ID");
    console.error("Prospect CRM add failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("Le prospect n’a pas pu être ajouté au suivi.", 503, "CRM_ADD_FAILED");
  }
}
