import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, Mail, MapPin, Phone, ShieldCheck } from "lucide-react";
import { BusinessIntelligencePanel } from "@/components/business-intelligence-panel";
import { CompanyActions } from "@/components/company-actions";
import { datasetMetadata, getCompanyBySiren, getEstablishmentsForCompany } from "@/data/establishment-store";
import { getBodaccEventsBySiren } from "@/lib/bodacc-db";
import { getEnterpriseCompanyBySiren, getEnterpriseLocationsBySiren, getEnterpriseMetadata } from "@/lib/enterprise-db";
import { getNafLabel } from "@/lib/naf";
import { getOsmBusinessProfilesBySiren } from "@/lib/osm-business-db";
import { getWebsiteEnrichmentsBySiren } from "@/lib/website-enrichment-db";
import { getCompanyDeclaredOverride, getCompanyVerificationOverride } from "@/lib/moderation-db";

type PageProps = {
  params: Promise<{ commune: string; slugSiren: string }>;
};

function extractSiren(slugSiren: string) {
  return slugSiren.match(/(\d{9})$/)?.[1] ?? "";
}

const legalCategoryLabels: Record<string, string> = {
  "1000": "Entrepreneur individuel",
  "5498": "SARL unipersonnelle",
  "5499": "Société à responsabilité limitée (SARL)",
  "5599": "Société anonyme à conseil d'administration",
  "5710": "Société par actions simplifiée (SAS)",
  "5720": "Société par actions simplifiée unipersonnelle (SASU)",
  "6220": "Groupement d'intérêt économique (GIE)",
  "6540": "Société civile immobilière (SCI)",
  "9220": "Association déclarée"
};

const workforceLabels: Record<string, string> = {
  "00": "0 salarié",
  "01": "1 à 2 salariés",
  "02": "3 à 5 salariés",
  "03": "6 à 9 salariés",
  "11": "10 à 19 salariés",
  "12": "20 à 49 salariés",
  "21": "50 à 99 salariés",
  "22": "100 à 199 salariés",
  "31": "200 à 249 salariés",
  "32": "250 à 499 salariés",
  "41": "500 à 999 salariés",
  "42": "1 000 à 1 999 salariés",
  "51": "2 000 à 4 999 salariés",
  "52": "5 000 à 9 999 salariés",
  "53": "10 000 salariés ou plus",
  "NN": "Effectif non connu"
};

function legalCategoryLabel(code: string | null | undefined) {
  if (!code) return "Non renseignée";
  return legalCategoryLabels[code] ?? `Code juridique INSEE ${code}`;
}

function descriptionSourceLabel(value: string) {
  if (value === "company_declared") return "déclarée par l’entreprise après validation";
  if (value === "official_website") return "site professionnel public";
  if (value === "bodacc") return "BODACC";
  if (value === "naf_generated") return "activité NAF";
  return value;
}

function descriptionConfidenceLabel(value: string) {
  return value === "declared" ? "déclarée et modérée" : value;
}

function publicUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function firstLocalEnrichment(siren: string) {
  const website = (getWebsiteEnrichmentsBySiren(siren) ?? []).find((row) => row.fetch_status === "ok" && publicUrl(row.final_url ?? row.input_url));
  const osm = (getOsmBusinessProfilesBySiren(siren) ?? []).find((row) => row.website || row.phone || row.public_email || row.opening_hours);
  const bodacc = getBodaccEventsBySiren(siren)?.rows.find((row) => row.activity_text);
  const websiteDescription = website?.description?.replace(/\s+/g, " ").trim() || null;
  const description = websiteDescription || bodacc?.activity_text?.replace(/\s+/g, " ").trim() || null;
  return {
    website: publicUrl(website?.final_url ?? website?.input_url) ?? publicUrl(osm?.website),
    phone: osm?.phone ?? null,
    email: osm?.public_email ?? null,
    openingHours: osm?.opening_hours ?? null,
    description,
    descriptionSource: websiteDescription ? "official_website" as const : bodacc?.activity_text ? "bodacc" as const : null,
    descriptionConfidence: websiteDescription ? "high" as const : bodacc?.activity_text ? "high" as const : null,
    retrievedAt: website?.fetched_at ?? null
  };
}

function pageData(siren: string) {
  const databaseLocations = getEnterpriseLocationsBySiren(siren);
  if (databaseLocations?.length) {
    const primary = databaseLocations[0];
    const primaryNafLabel = getNafLabel(primary.naf_code);
    const legalUnit = getEnterpriseCompanyBySiren(siren);
    const metadata = getEnterpriseMetadata();
    const enrichment = firstLocalEnrichment(siren);
    const declared = getCompanyDeclaredOverride(siren);
    const nafDescription = primaryNafLabel
      ? `Établissement enregistré dans l’activité « ${primaryNafLabel} » (code NAF ${primary.naf_code}).`
      : primary.description;
    const description = declared?.descriptionCourte ?? enrichment.description ?? nafDescription;
    const descriptionSource = declared?.descriptionCourte ? "company_declared" as const : enrichment.descriptionSource ?? "naf_generated" as const;
    const descriptionConfidence = declared?.descriptionCourte ? "declared" as const : enrichment.descriptionConfidence ?? "medium" as const;
    const company = {
    id: `db_company_${siren}`,
    siren,
    raisonSociale: legalUnit?.legal_name ?? primary.legal_name,
    nomCommercial: legalUnit?.usual_name ?? primary.trade_name ?? undefined,
    sigle: legalUnit?.acronym ?? undefined,
    formeJuridique: legalCategoryLabel(legalUnit?.legal_category),
    dateCreation: legalUnit?.creation_date ?? "Non renseignée",
    statut: legalUnit?.administrative_status === "C" ? "inactive" as const : "active" as const,
    trancheEffectif: legalUnit?.workforce_band ?? undefined,
    anneeEffectif: legalUnit?.workforce_year ?? undefined,
    categorieEntreprise: legalUnit?.company_category ?? undefined,
    anneeCategorieEntreprise: legalUnit?.company_category_year ?? undefined,
    activitePrincipale: legalUnit?.primary_activity ?? undefined,
    economieSocialeSolidaire: legalUnit?.social_economy ?? undefined,
    societeMission: legalUnit?.mission_company ?? undefined,
    identifiantAssociation: legalUnit?.association_id ?? undefined,
    derniereMiseAJourSirene: legalUnit?.last_processed_at ?? undefined,
    siteWeb: declared?.siteWeb ?? enrichment.website ?? undefined,
    telephonePublic: declared?.telephonePublic ?? enrichment.phone ?? undefined,
    emailPublic: declared?.emailPublic ?? enrichment.email ?? undefined,
    openingHoursPublic: declared?.openingHoursPublic ?? enrichment.openingHours ?? undefined,
    descriptionCourte: description,
    descriptionLongue: declared?.descriptionCourte
      ? `${description} Cette présentation a été déclarée par un représentant dont la revendication a été approuvée; elle reste séparée des données administratives.`
      : enrichment.description
      ? `${description} Cette formulation reprend une information publiée dans une source professionnelle ou légale; elle ne constitue pas une validation par l’entreprise.`
      : `${description} Cette description est automatique et ne déduit aucun service non confirmé.`,
    descriptionSource,
    descriptionConfidence,
    descriptionRetrievedAt: enrichment.retrievedAt ?? undefined,
    verified: getCompanyVerificationOverride(siren),
    slug: (legalUnit?.legal_name ?? primary.legal_name).toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    };
    return {
      company,
      locations: databaseLocations.map((location) => ({
      id: `db_${location.siret}`,
      companyId: company.id,
      siret: location.siret,
      isHeadOffice: Boolean(location.is_head_office),
      enseigne: location.trade_name ?? location.legal_name,
      codeNaf: location.naf_code ?? "Non renseigné",
      libelleNaf: getNafLabel(location.naf_code) ?? location.sector,
      secteurNormalise: location.sector,
      adresseComplete: location.address ?? `${location.postal_code ?? ""} ${location.commune}`.trim(),
      codePostal: location.postal_code ?? "",
      commune: location.commune,
      codeCommune: location.commune_code,
      latitude: location.latitude,
      longitude: location.longitude,
      geocodingPrecision: location.geocoding_precision ?? (location.latitude === null ? "non_geocode" : "coordonnée publiée"),
      geocodingSource: location.geocoding_source ?? "INSEE SIRENE / ODS SIRENE-BAN",
      statut: "active" as const,
      dateCreation: location.creation_date ?? "Non renseignée",
      trancheEffectif: location.workforce_band ?? undefined,
      anneeEffectif: location.workforce_year ?? undefined,
      employeurDeclare: location.employer ?? undefined,
      derniereMiseAJourSirene: location.last_processed_at ?? undefined
      })),
      source: metadata?.source ?? datasetMetadata.source,
      referenceDate: metadata?.source_reference_date ?? datasetMetadata.referenceDate
    };
  }
  const localCompany = getCompanyBySiren(siren);
  if (!localCompany) return null;
  const declared = getCompanyDeclaredOverride(siren);
  return {
    company: {
      ...localCompany,
      verified: getCompanyVerificationOverride(siren),
      siteWeb: declared?.siteWeb ?? localCompany.siteWeb,
      emailPublic: declared?.emailPublic ?? ("emailPublic" in localCompany ? localCompany.emailPublic : undefined),
      telephonePublic: declared?.telephonePublic ?? localCompany.telephonePublic,
      openingHoursPublic: declared?.openingHoursPublic ?? ("openingHoursPublic" in localCompany ? localCompany.openingHoursPublic : undefined),
      descriptionCourte: declared?.descriptionCourte ?? localCompany.descriptionCourte,
      descriptionLongue: declared?.descriptionCourte
        ? `${declared.descriptionCourte} Cette présentation a été déclarée par un représentant dont la revendication a été approuvée; elle reste séparée des données administratives.`
        : localCompany.descriptionLongue,
      descriptionSource: declared?.descriptionCourte ? "company_declared" : localCompany.descriptionSource,
      descriptionConfidence: declared?.descriptionCourte ? "declared" : localCompany.descriptionConfidence
    },
    locations: getEstablishmentsForCompany(localCompany.id),
    source: datasetMetadata.source,
    referenceDate: datasetMetadata.referenceDate
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slugSiren } = await params;
  const data = pageData(extractSiren(slugSiren));
  if (!data) return {};
  const { company, locations } = data;
  const commune = locations[0]?.commune.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, "-") ?? "guadeloupe";
  return {
    title: `${company.nomCommercial ?? company.raisonSociale}`,
    description: company.descriptionCourte,
    alternates: {
      canonical: `/entreprises/${commune}/${company.slug}-${company.siren}`
    },
    openGraph: {
      title: company.nomCommercial ?? company.raisonSociale,
      description: company.descriptionCourte,
      type: "website"
    }
  };
}

export default async function CompanyPage({ params }: PageProps) {
  const { slugSiren } = await params;
  const data = pageData(extractSiren(slugSiren));
  if (!data) notFound();
  const { company, locations } = data;
  const headOffice = locations.find((location) => location.isHeadOffice) ?? locations[0];
  const commune = headOffice?.commune.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, "-") ?? "guadeloupe";

  const schema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: company.nomCommercial ?? company.raisonSociale,
    legalName: company.raisonSociale,
    identifier: company.siren,
    description: company.descriptionCourte,
    url: `/entreprises/${commune}/${company.slug}-${company.siren}`,
    sameAs: company.siteWeb ? [company.siteWeb] : undefined,
    address: headOffice ? {
      "@type": "PostalAddress",
      streetAddress: headOffice.adresseComplete,
      postalCode: headOffice.codePostal,
      addressLocality: headOffice.commune,
      addressCountry: "FR"
    } : undefined
  };

  return (
    <main className="page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      <nav className="small muted" aria-label="Fil d'Ariane">
        <Link href="/">Carte</Link> / <span>{headOffice?.commune}</span> / <span>{company.nomCommercial ?? company.raisonSociale}</span>
      </nav>
      <section className="hero-company">
        <div className="badge-row">
          <span className="badge">Informations issues de données publiques</span>
          {company.verified ? <span className="badge"><ShieldCheck size={14} /> Fiche vérifiée</span> : null}
        </div>
        <div>
          <h1 style={{ fontSize: "clamp(2rem, 6vw, 4.4rem)", lineHeight: 1.02, margin: 0 }}>{company.nomCommercial ?? company.raisonSociale}</h1>
          {company.nomCommercial ? <p className="muted">{company.raisonSociale}</p> : null}
          <p>{company.descriptionCourte}</p>
        </div>
        <div className="badge-row">
          {company.siteWeb ? <a className="button primary" href={company.siteWeb} rel="nofollow noopener noreferrer">Site web</a> : null}
          {company.telephonePublic ? <a className="button" href={`tel:${company.telephonePublic}`}> <Phone size={16} /> Téléphone</a> : null}
          {"emailPublic" in company && company.emailPublic ? <a className="button" href={`mailto:${company.emailPublic}`}><Mail size={16} /> Email professionnel</a> : null}
          {headOffice ? <a className="button" href={`https://www.openstreetmap.org/directions?to=${headOffice.latitude},${headOffice.longitude}`} rel="nofollow">Itinéraire</a> : null}
        </div>
      </section>

      <BusinessIntelligencePanel siren={company.siren} />

      <section className="info-grid" aria-label="Informations détaillées">
        <article className="info-box">
          <h2 className="title">Présentation</h2>
          <p>{company.descriptionLongue}</p>
          <p className="small muted">Source de description: {descriptionSourceLabel(company.descriptionSource)}. Niveau: {descriptionConfidenceLabel(company.descriptionConfidence)}.</p>
          {"descriptionRetrievedAt" in company && company.descriptionRetrievedAt ? <p className="small muted">Dernière récupération de cette description: {company.descriptionRetrievedAt}.</p> : null}
          {typeof company.openingHoursPublic === "string" && company.openingHoursPublic ? <p className="small">Horaires publiés: {company.openingHoursPublic}</p> : null}
        </article>
        <article className="info-box">
          <h2 className="title">Informations légales publiques</h2>
          <p>SIREN: {company.siren}</p>
          <p>Forme juridique: {company.formeJuridique}</p>
          <p>Date de création: {company.dateCreation}</p>
          <p>Statut: {company.statut}</p>
          {company.trancheEffectif ? <p>Effectif: {workforceLabels[company.trancheEffectif] ?? company.trancheEffectif}</p> : null}
          {"anneeEffectif" in company && company.anneeEffectif ? <p className="small muted">Année de l’effectif: {company.anneeEffectif}</p> : null}
          {"categorieEntreprise" in company && company.categorieEntreprise ? <p>Catégorie: {company.categorieEntreprise}</p> : null}
          {"anneeCategorieEntreprise" in company && company.anneeCategorieEntreprise ? <p className="small muted">Année de catégorie: {company.anneeCategorieEntreprise}</p> : null}
          {"activitePrincipale" in company && company.activitePrincipale ? <p>Activité principale: {company.activitePrincipale}</p> : null}
          {"economieSocialeSolidaire" in company && company.economieSocialeSolidaire === "O" ? <p>Économie sociale et solidaire: oui</p> : null}
          {"societeMission" in company && company.societeMission === "O" ? <p>Société à mission: oui</p> : null}
          {"identifiantAssociation" in company && company.identifiantAssociation ? <p>RNA: {company.identifiantAssociation}</p> : null}
          {"derniereMiseAJourSirene" in company && company.derniereMiseAJourSirene ? <p className="small muted">Dossier SIRENE traité le {company.derniereMiseAJourSirene}</p> : null}
        </article>
        <article className="info-box" id="transparence">
          <h2 className="title">Actions</h2>
          <p className="small muted">Les données officielles restent séparées des demandes humaines. Une revendication ou un signalement est soumis à modération et ne modifie jamais silencieusement le stock SIRENE.</p>
          <CompanyActions siren={company.siren} companyName={company.nomCommercial ?? company.raisonSociale} />
        </article>
      </section>

      <section style={{ marginTop: 28 }}>
        <h2>Implantations</h2>
        <div className="info-grid">
          {locations.map((location) => (
            <article className="info-box" key={location.id}>
              <div className="badge-row">
                <span className="badge"><Building2 size={14} /> {location.isHeadOffice ? "Siège social" : "Établissement"}</span>
              </div>
              <h3 className="title">{location.enseigne}</h3>
              <p><MapPin size={15} /> {location.adresseComplete}</p>
              <p className="small">SIRET: {location.siret}</p>
              <p className="small">NAF {location.codeNaf}: {location.libelleNaf}</p>
              <p className="small">Création de l’établissement: {location.dateCreation}</p>
              {"trancheEffectif" in location && location.trancheEffectif ? <p className="small">Effectif: {workforceLabels[location.trancheEffectif] ?? location.trancheEffectif}{location.anneeEffectif ? ` (${location.anneeEffectif})` : ""}</p> : null}
              {"employeurDeclare" in location && location.employeurDeclare === "O" ? <p className="small">Caractère employeur déclaré: oui</p> : null}
              <p className="small muted">Géocodage: {location.geocodingPrecision}, source {location.geocodingSource}.</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 28 }}>
        <h2>Sources et transparence</h2>
        <p>{data.source}, référence {data.referenceDate}. Les imports réels conservent source, date de récupération, date de mise à jour, confiance et statut de vérification.</p>
      </section>
    </main>
  );
}
