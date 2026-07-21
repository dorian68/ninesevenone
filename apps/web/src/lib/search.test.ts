import { describe, expect, it } from "vitest";
import { extractSearchTerms, parseStructuredSearch } from "./search-query";
import { normalizeSearchText, searchEstablishments } from "./search";
import { slugify } from "./slug";
import { findNafCodesForTerms } from "./naf";
import { searchEnterpriseDatabase } from "./enterprise-db";

describe("search helpers", () => {
  it("normalizes accents and case", () => {
    expect(normalizeSearchText("Pointe-à-Pitre")).toBe("pointe a pitre");
  });

  it("extracts a sector from a natural-language request", () => {
    expect(extractSearchTerms("je recherche des quincailleries")).toEqual(["quincaillerie"]);
    expect(extractSearchTerms("quincaillereie")).toEqual(["quincaillereie"]);
  });

  it("resolves the quincaillerie activity, including a small typo", () => {
    const exactCodes = findNafCodesForTerms(["quincaillerie"]);
    const typoCodes = findNafCodesForTerms(["quincaillereie"]);
    expect(exactCodes).toContain("47.52A");
    expect(typoCodes).toContain("47.52A");
  });

  it("searches establishments from natural-language sector requests", () => {
    for (const query of ["je recherche des quincailleries", "quincaillereie"]) {
      const results = searchEnterpriseDatabase(query, 24);
      expect(results?.length ?? 0).toBeGreaterThan(0);
      expect(results?.every((result) => ["46.15Z", "46.74A", "47.52A", "47.52B"].includes(result.nafCode))).toBe(true);
    }
  });

  it("finds establishments by commune", () => {
    const results = searchEstablishments("Baie Mahault");
    expect(results.length).toBeGreaterThan(0);
  });

  it("generates stable ascii slugs", () => {
    expect(slugify("Table Démo Marie-Galante")).toBe("table-demo-marie-galante");
  });

  it("parses exact search scopes without changing free-text search", () => {
    expect(parseStructuredSearch("siren: 303091086")).toEqual({ scope: "siren", value: "303091086" });
    expect(parseStructuredSearch("presse: protection enfance")).toEqual({ scope: "presse", value: "protection enfance" });
    expect(parseStructuredSearch("RHUM DAMOISEAU")).toBeNull();
  });
});
