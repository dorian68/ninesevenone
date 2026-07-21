import { getJoinedEstablishments } from "@/data/establishment-store";
import { extractSearchTerms } from "@/lib/search-query";

export function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .toLowerCase()
    .trim();
}

export function searchEstablishments(query: string) {
  const normalizedQuery = normalizeSearchText(query);
  const searchTerms = extractSearchTerms(query);
  if (normalizedQuery.length < 2) return [];

  return getJoinedEstablishments()
    .map((entry) => {
      const haystack = normalizeSearchText([
        entry.company.raisonSociale,
        entry.company.nomCommercial,
        entry.enseigne,
        entry.company.siren,
        entry.siret,
        entry.secteurNormalise,
        entry.codeNaf,
        entry.libelleNaf,
        entry.commune,
        entry.adresseComplete,
        entry.company.descriptionCourte
      ].filter(Boolean).join(" "));
      const exactName = haystack.includes(normalizedQuery) ? 10 : 0;
      const startsWith = normalizeSearchText(entry.company.raisonSociale).startsWith(normalizedQuery) ? 6 : 0;
      const sirenBoost = entry.company.siren.startsWith(normalizedQuery) || entry.siret.startsWith(normalizedQuery) ? 12 : 0;
      const sectorHaystack = normalizeSearchText([entry.secteurNormalise, entry.libelleNaf, entry.codeNaf].filter(Boolean).join(" "));
      const sectorBoost = searchTerms.length > 0 && searchTerms.every((term) => sectorHaystack.includes(term)) ? 20 : 0;
      return { entry, score: exactName + startsWith + sirenBoost + sectorBoost };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((result) => result.entry);
}
