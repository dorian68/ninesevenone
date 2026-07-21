import { describe, expect, it } from "vitest";
import { buildCompanyProfile } from "./company-profile";

function profileInput(overrides: Record<string, unknown> = {}) {
  return {
    retrievedAt: "2026-07-19T10:00:00.000Z",
    officialProfile: {
      primaryActivityCode: "62.01Z",
      primaryActivityLabel: "Programmation informatique",
      workforceBand: "10 à 19 salariés",
      workforceYear: 2025,
      companyCategory: "PME",
      establishmentCount: 2,
      employerEstablishmentCount: 2,
      source: "SIRENE INSEE",
      sourceReferenceDate: "2026-07-01"
    },
    annuaire: { total: 1, labels: [], aidSignals: [], sourceReferenceDate: "2026-07-01", sourceUrl: "https://annuaire-entreprises.data.gouv.fr/entreprise/123456789" },
    websites: { descriptions: [], offerings: [], accessibleSitesCount: 0, generatedAt: null },
    osmPresence: { services: [], categories: [], websites: [], sourceReferenceDate: null, sourceUrl: "https://www.openstreetmap.org/" },
    trainingOrganizations: { profiles: [] },
    rge: { domains: [], qualifications: [], sourceUpdatedAt: null, sourceUrl: "https://data.ademe.fr/datasets/historique-rge" },
    bodacc: { activities: [], total: 0 },
    patents: { total: 0, technologySections: [], latestApplicationDate: null, sourceUpdatedAt: null, sourceUrl: "https://www.data.gouv.fr/" },
    publicContracts: { total: 0, latestDate: null, sourceUrl: null },
    press: { total: 0, latestPublishedAt: null },
    environmentalCompliance: { total: 0, sourceUpdatedAt: null, sourceUrl: "https://www.georisques.gouv.fr/" },
    ...overrides
  } as Parameters<typeof buildCompanyProfile>[0];
}

describe("company profile derivation", () => {
  it("prioritizes an attributed public website description and explicit offerings", () => {
    const result = buildCompanyProfile(profileInput({
      websites: {
        descriptions: [{ text: "Conseil en transformation numérique.", source: "jsonld", confidence: 0.9, url: "https://example.test", fetchedAt: "2026-07-18T09:00:00Z" }],
        offerings: [{ name: "Audit de sécurité", source: "jsonld", confidence: 0.9, url: "https://example.test" }],
        accessibleSitesCount: 1,
        generatedAt: "2026-07-18T09:00:00Z"
      },
      rge: { domains: ["Isolation"], qualifications: [{ qualificationName: "Qualification RGE", sourceUpdatedAt: "2026-07-18" }], sourceUpdatedAt: "2026-07-18", sourceUrl: "https://data.ademe.fr/datasets/historique-rge" }
    }));

    expect(result.summary).toBe("Conseil en transformation numérique.");
    expect(result.descriptionSource).toBe("official_website");
    expect(result.services.map((service) => service.label)).toEqual(["Audit de sécurité", "Qualification RGE", "Isolation"]);
    expect(result.size.workforceBand).toBe("10 à 19 salariés");
  });

  it("falls back to a factual NAF statement without inventing services", () => {
    const result = buildCompanyProfile(profileInput());

    expect(result.descriptionSource).toBe("naf_generated");
    expect(result.summary).toContain("Programmation informatique");
    expect(result.services).toHaveLength(0);
    expect(result.descriptionEvidence).toContain("sans déduction de services");
  });
});
