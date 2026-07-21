import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type NafPayload = {
  source?: string;
  source_url?: string;
  source_reference_date?: string;
  labels?: Record<string, string>;
};

const env = (process as unknown as { env: Record<string, string | undefined> }).env;
const candidates = [
  env.NAF_LABELS_PATH,
  resolve((process as unknown as { cwd(): string }).cwd(), "data/naf-rev2-labels.json"),
  resolve((process as unknown as { cwd(): string }).cwd(), "../../data/naf-rev2-labels.json")
].filter((candidate): candidate is string => Boolean(candidate));
const labelsPath = candidates.find(existsSync);
let payload: NafPayload | null | undefined;

function getPayload() {
  if (payload !== undefined) return payload;
  if (!labelsPath) {
    payload = null;
    return payload;
  }
  try {
    payload = JSON.parse(readFileSync(labelsPath, "utf-8")) as NafPayload;
  } catch {
    payload = null;
  }
  return payload;
}

export function getNafLabel(code: string | null | undefined) {
  if (!code) return null;
  return getPayload()?.labels?.[code.trim().toUpperCase()] ?? null;
}

function normalizeNafSearchText(value: string) {
  return value
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function editDistance(left: string, right: string) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function nafTokenMatches(term: string, labelToken: string) {
  if (labelToken.includes(term)) return true;
  if (term.length < 6) return false;
  const distance = editDistance(term, labelToken);
  return distance <= Math.max(1, Math.floor(term.length * 0.18));
}

/** Finds official NAF codes whose activity labels match natural-language terms. */
export function findNafCodesForTerms(terms: string[]) {
  const labels = getPayload()?.labels ?? {};
  const usefulTerms = terms.map(normalizeNafSearchText).filter((term) => term.length >= 3);
  if (!usefulTerms.length) return [];
  return Object.entries(labels)
    .filter(([, label]) => {
      const labelTokens = normalizeNafSearchText(label).split(/\s+/).filter(Boolean);
      return usefulTerms.every((term) => labelTokens.some((labelToken) => nafTokenMatches(term, labelToken)));
    })
    .map(([code]) => code);
}

export function getNafMetadata() {
  const current = getPayload();
  if (!current) return null;
  return {
    source: current.source ?? "INSEE",
    sourceUrl: current.source_url ?? "https://www.insee.fr/fr/information/2120875",
    referenceDate: current.source_reference_date ?? null
  };
}
