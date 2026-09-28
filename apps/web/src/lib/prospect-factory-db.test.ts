import { describe, expect, it } from "vitest";
import { buildProspectFacetQuery, buildProspectWhere, csvCell, decodeProspectCursor, encodeProspectCursor, getProspectFactoryFacets, isUnfilteredProspectQuery, parseProspectFactoryFilters, ProspectFactoryInputError, prospectFactoryStatus, searchProspectFactory } from "@/lib/prospect-factory-db";

describe("Prospect Factory query contract", () => {
  it("parameterizes every user-provided filter", () => {
    const filters = parseProspectFactoryFilters(new URLSearchParams({
      country: "France' OR TRUE --",
      territory: "Guadeloupe",
      vertical: "Construction",
      minScore: "75"
    }));
    const where = buildProspectWhere(filters);
    expect(where.sql).not.toContain("OR TRUE");
    expect(where.sql).toContain("country = $1");
    expect(where.sql).toContain("territory = $2");
    expect(where.values).toEqual(["France' OR TRUE --", "Guadeloupe", "Construction", 75]);
  });

  it("uses keyset pagination rather than a deep offset", () => {
    const cursor = { score: 88, id: "warehouse-row-123" };
    const encoded = encodeProspectCursor(cursor);
    expect(decodeProspectCursor(encoded)).toEqual(cursor);
    const where = buildProspectWhere({ country: "France" }, cursor);
    expect(where.sql).toContain("id > $4");
    expect(where.sql.toLowerCase()).not.toContain("offset");
  });

  it("preserves the browse layer in opaque cursors and detects only semantically empty filters", () => {
    const cursor = { score: 100, id: "warehouse-top-row", layer: "browse" as const };
    expect(decodeProspectCursor(encodeProspectCursor(cursor))).toEqual(cursor);
    expect(decodeProspectCursor(Buffer.from(JSON.stringify({ score: 100, id: "row", layer: "other" })).toString("base64url"))).toBeNull();
    expect(isUnfilteredProspectQuery({})).toBe(true);
    expect(isUnfilteredProspectQuery({ minScore: 0 })).toBe(true);
    expect(isUnfilteredProspectQuery({ contact: "any" })).toBe(false);
    expect(isUnfilteredProspectQuery({ query: "  " })).toBe(true);
  });

  it("rejects malformed cursors and bounds public input", () => {
    expect(decodeProspectCursor("not-a-cursor")).toBeNull();
    const filters = parseProspectFactoryFilters(new URLSearchParams({ minScore: "999", contact: "invalid", certification: "unknown" }));
    expect(filters.minScore).toBe(100);
    expect(filters.contact).toBeUndefined();
    expect(filters.certification).toBeUndefined();
  });

  it("neutralizes spreadsheet formulas in CSV exports", () => {
    expect(csvCell("=HYPERLINK(\"https://example.test\")")).toBe("\"'=HYPERLINK(\"\"https://example.test\"\")\"");
    expect(csvCell("+33123456789")).toBe("'+33123456789");
    expect(csvCell("ordinary value")).toBe("ordinary value");
  });

  it("rejects ambiguous short searches before scanning the warehouse", async () => {
    await expect(searchProspectFactory({ query: "ab" })).rejects.toBeInstanceOf(ProspectFactoryInputError);
    await expect(searchProspectFactory({}, { cursor: "broken" })).rejects.toThrow("Curseur de pagination invalide");
  });

  it("builds exact cascading facets from parameterized cube filters", () => {
    const facetQuery = buildProspectFacetQuery({ country: "France' OR TRUE --", territory: "Guadeloupe", certification: "gold", contact: "email", minScore: 75, query: "ignored in cube" });
    expect(facetQuery.sql).not.toContain("OR TRUE --");
    expect(facetQuery.sql).toContain("sum(row_count)");
    expect(facetQuery.sql).toContain("lead_score_int >=");
    expect(facetQuery.sql).not.toContain("company_name");
    expect(facetQuery.values).toContain("France' OR TRUE --");
    expect(facetQuery.values).toContain("Guadeloupe");
  });

  it("returns compatible values and counts from the 25.8M-row facet cube", async () => {
    const facets = await getProspectFactoryFacets({ country: "France", territory: "Guadeloupe", certification: "gold", contact: "any" });
    expect(facets.countries.some((item) => item.value === "France" && item.count > 1_000)).toBe(true);
    expect(facets.territories.some((item) => item.value === "Guadeloupe" && item.count === 1_401)).toBe(true);
    expect(facets.certifications.some((item) => item.value === "gold" && item.count === 1_401)).toBe(true);
    expect(facets.contacts.find((item) => item.value === "any")?.count).toBe(1_401);
    expect(facets.elapsedMs).toBeLessThan(2_000);
  });

  it("paginates with selectable page sizes without overlapping rows", async () => {
    const filters = { country: "France", territory: "Guadeloupe", certification: "gold", contact: "any" } as const;
    const first = await searchProspectFactory(filters, { limit: 25, includeCount: true });
    expect(first.rows).toHaveLength(25);
    expect(first.total).toBe(1_401);
    expect(first.nextCursor).toBeTruthy();
    const second = await searchProspectFactory(filters, { limit: 25, cursor: first.nextCursor! });
    expect(second.rows).toHaveLength(25);
    expect(new Set([...first.rows, ...second.rows].map((row) => row.warehouseId)).size).toBe(50);
  });

  it("serves clear-all pages from the compact global prefix without losing the exact total", async () => {
    expect(prospectFactoryStatus().browseServingPath).toBeTruthy();
    const first = await searchProspectFactory({ minScore: 0 }, { limit: 100, includeCount: true });
    expect(first.rows).toHaveLength(100);
    expect(first.total).toBeGreaterThan(25_000_000);
    expect(decodeProspectCursor(first.nextCursor ?? "")?.layer).toBe("browse");
    expect(first.elapsedMs).toBeLessThan(2_000);

    const second = await searchProspectFactory({ minScore: 0 }, { limit: 100, cursor: first.nextCursor! });
    expect(second.rows).toHaveLength(100);
    expect(new Set([...first.rows, ...second.rows].map((row) => row.warehouseId)).size).toBe(200);
    expect(second.rows[0]!.leadScore).toBeLessThanOrEqual(first.rows.at(-1)!.leadScore);
  });
});
