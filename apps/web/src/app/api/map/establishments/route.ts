import { NextRequest, NextResponse } from "next/server";
import { datasetMetadata, getJoinedEstablishments } from "@/data/establishment-store";
import { getEnterpriseMapData, getEnterpriseMetadata } from "@/lib/enterprise-db";
import { gridCluster, isInsideBBox, parseBBox } from "@/lib/geo";
import { getVerifiedCompanySirens } from "@/lib/moderation-db";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const bbox = parseBBox(searchParams.get("bbox"));
  const zoom = Number(searchParams.get("zoom") ?? 9);
  const sector = searchParams.get("sector") ?? "";
  const commune = searchParams.get("commune") ?? "";
  const verified = searchParams.get("verified") === "true";
  const workforceBand = searchParams.get("workforce") ?? "";
  const headOffice = searchParams.get("headOffice") === "true";
  const employer = searchParams.get("employer") === "true";
  const postalCode = searchParams.get("postalCode") ?? "";
  const nafCode = searchParams.get("naf") ?? "";
  const recent = searchParams.get("recent") === "true";

  if (!bbox) {
    return NextResponse.json({ error: "bbox invalide" }, { status: 400 });
  }

  const databaseResult = getEnterpriseMapData(bbox, zoom, { sector, commune, verified, workforceBand, headOffice, employer, postalCode, nafCode, recent });
  if (databaseResult) {
    const metadata = getEnterpriseMetadata();
    return NextResponse.json({
      type: "FeatureCollection",
      metadata: {
        resultCount: databaseResult.resultCount,
        clustered: databaseResult.clustered,
        source: metadata?.source,
        referenceDate: metadata?.source_reference_date
      },
      features: databaseResult.features
    }, {
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" }
    });
  }

  const allEntries = getJoinedEstablishments();
  const verifiedSirens = getVerifiedCompanySirens(allEntries.map((entry) => entry.company.siren));
  const visible = allEntries.filter((entry) => {
    if (!isInsideBBox(entry, bbox)) return false;
    if (sector && entry.secteurNormalise !== sector) return false;
    if (commune && entry.commune !== commune) return false;
    if (verified && !entry.company.verified && !verifiedSirens.has(entry.company.siren)) return false;
    return true;
  });

  const features = gridCluster(visible, zoom).map((result) => {
    if (result.type === "cluster") {
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [result.longitude, result.latitude] },
        properties: { kind: "cluster", count: result.count }
      };
    }
    const entry = result.item;
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [entry.longitude, entry.latitude] },
      properties: {
        kind: "establishment",
        id: entry.id,
        companyId: entry.companyId,
        siren: entry.company.siren,
        siret: entry.siret,
        name: entry.enseigne ?? entry.company.nomCommercial ?? entry.company.raisonSociale,
        sector: entry.secteurNormalise,
        commune: entry.commune,
        description: entry.company.descriptionCourte,
        verified: entry.company.verified || verifiedSirens.has(entry.company.siren),
        slug: entry.company.slug
      }
    };
  });

  return NextResponse.json({
    type: "FeatureCollection",
    metadata: {
      resultCount: visible.length,
      clustered: zoom < 10,
      source: datasetMetadata.source,
      referenceDate: datasetMetadata.referenceDate
    },
    features
  });
}
