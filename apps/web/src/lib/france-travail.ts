import "server-only";

const OFFERS_API = "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search";
const TOKEN_API = "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=/partenaire";
const SOURCE_URL = "https://www.data.gouv.fr/dataservices/api-offres-demploi";
import { parseRecruitmentOffers, type RecruitmentOffer, type UnknownRecord } from "@/lib/france-travail-parser";

export type RecruitmentSignals = {
  status: "ok" | "empty" | "unavailable";
  total: number;
  identifierMatchedCount: number;
  offers: RecruitmentOffer[];
  retrievedAt: string | null;
  sourceUrl: string;
  detail: string | null;
};

let accessToken: { value: string; expiresAt: number } | null = null;

function envValue(key: string) {
  return (process as unknown as { env: Record<string, string | undefined> }).env[key];
}

function text(value: unknown, limit = 500) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : null;
}

function object(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null ? value as UnknownRecord : {};
}

async function getAccessToken() {
  const clientId = envValue("FRANCE_TRAVAIL_CLIENT_ID");
  const clientSecret = envValue("FRANCE_TRAVAIL_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Identifiants API France Travail non configurés");
  if (accessToken && accessToken.expiresAt > Date.now() + 60_000) return accessToken.value;
  const response = await fetch(envValue("FRANCE_TRAVAIL_TOKEN_URL") ?? TOKEN_API, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: "grant_type=client_credentials&scope=api_offresdemploiv2",
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Token France Travail HTTP ${response.status}`);
  const payload = await response.json() as UnknownRecord;
  const token = text(payload.access_token, 4_000);
  if (!token) throw new Error("Jeton France Travail absent");
  const expiresIn = Number(payload.expires_in ?? 1_200);
  accessToken = { value: token, expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn * 1_000 : 1_200_000) };
  return token;
}

export async function loadRecruitmentSignals(siren: string, companyName: string, activeSirets: string[]): Promise<RecruitmentSignals> {
  if (envValue("FRANCE_TRAVAIL_RECRUITMENT_LIVE") !== "true") {
    throw new Error("Flux France Travail désactivé; activer explicitement FRANCE_TRAVAIL_RECRUITMENT_LIVE après obtention des identifiants");
  }
  const token = await getAccessToken();
  const url = new URL(envValue("FRANCE_TRAVAIL_OFFERS_API") ?? OFFERS_API);
  url.searchParams.set("motsCles", companyName.slice(0, 120));
  url.searchParams.set("departement", "971");
  url.searchParams.set("range", "0-149");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "Guadeloupe-Entreprises-BI/0.4" },
    next: { revalidate: 300 }
  });
  if (!response.ok) throw new Error(`Offres France Travail HTTP ${response.status}`);
  const payload = await response.json() as UnknownRecord;
  const offers = parseRecruitmentOffers(payload, siren, activeSirets);
  const possibleTotal = object(payload.filtresPossibles).total;
  const total = Number(possibleTotal ?? rowsCount(payload));
  const retrievedAt = new Date().toISOString();
  return {
    status: offers.length ? "ok" : "empty",
    total: Number.isFinite(total) ? total : offers.length,
    identifierMatchedCount: offers.length,
    offers,
    retrievedAt,
    sourceUrl: SOURCE_URL,
    detail: offers.length ? "Correspondance SIREN/SIRET publiée dans l'offre." : "Aucune offre avec identifiant SIREN/SIRET correspondant dans la réponse; les offres par nom sont écartées."
  };
}

function rowsCount(payload: UnknownRecord) {
  return Array.isArray(payload.resultats) ? payload.resultats.length : 0;
}

export { SOURCE_URL as FRANCE_TRAVAIL_SOURCE_URL };
