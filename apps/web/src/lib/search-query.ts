export type StructuredSearch = {
  scope: "siren" | "siret" | "naf" | "commune" | "secteur" | "adresse" | "presse";
  value: string;
};

const searchStopWords = new Set([
  "a", "au", "aux", "avec", "dans", "de", "des", "du", "en", "et", "la", "le", "les", "pour", "sur",
  "un", "une", "entreprise", "entreprises", "etablissement", "etablissements", "societe", "societes",
  "activite", "activites", "secteur", "secteurs", "metier", "metiers", "moi", "je", "cherche", "cherches",
  "recherche", "recherches", "rechercher", "trouve", "trouver", "montre", "montrer", "affiche", "afficher",
  "veux", "voudrais", "souhaite", "souhaiter"
]);

function normalizeSearchQuery(value: string) {
  return value
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function singularizeFrenchToken(token: string) {
  if (token.length > 5 && token.endsWith("ies")) return `${token.slice(0, -3)}ie`;
  if (token.length > 4 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

/**
 * Reduces a natural-language request to the useful business terms.
 * For example: "je recherche des quincailleries" -> ["quincaillerie"].
 */
export function extractSearchTerms(rawQuery: string) {
  return normalizeSearchQuery(rawQuery)
    .split(/\s+/)
    .map(singularizeFrenchToken)
    .filter((token) => token.length >= 3 && !searchStopWords.has(token));
}

export function parseStructuredSearch(rawQuery: string): StructuredSearch | null {
  const match = rawQuery.trim().match(/^(siren|siret|naf|commune|secteur|adresse|presse)\s*:\s*(.+)$/i);
  if (!match) return null;
  return { scope: match[1].toLocaleLowerCase("fr") as StructuredSearch["scope"], value: match[2].trim() };
}
