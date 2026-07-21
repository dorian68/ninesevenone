export type UnknownRecord = Record<string, unknown>;

export type RecruitmentOffer = {
  id: string;
  title: string;
  contract: string | null;
  location: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  duration: string | null;
  experience: string | null;
  sourceUrl: string;
  matchedBy: "siren";
};

function text(value: unknown, limit = 500) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : null;
}

function object(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null ? value as UnknownRecord : {};
}

function safeUrl(value: unknown) {
  const raw = text(value, 1_000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function validIdentifier(value: unknown, activeSirets: Set<string>, siren: string) {
  const raw = text(value, 30)?.replace(/\s/g, "") ?? "";
  if (raw === siren || activeSirets.has(raw)) return true;
  return raw.length === 14 && raw.startsWith(siren);
}

export function parseRecruitmentOffers(payload: UnknownRecord, siren: string, activeSirets: string[]) {
  const identifiers = new Set(activeSirets.filter((value) => /^\d{14}$/.test(value)));
  const rows = Array.isArray(payload.resultats) ? payload.resultats : [];
  const offers: RecruitmentOffer[] = [];
  for (const raw of rows) {
    const offer = object(raw);
    const company = object(offer.entreprise);
    const identifier = company.siret ?? company.siren ?? offer.siret ?? offer.siren;
    if (!validIdentifier(identifier, identifiers, siren)) continue;
    const id = text(offer.id, 100);
    const origin = object(offer.origineOffre);
    const sourceUrl = safeUrl(origin.urlOrigine ?? offer.urlOrigine ?? offer.url) ?? `https://candidat.francetravail.fr/offres/recherche/detail/${id ?? ""}`;
    if (!id) continue;
    const location = object(offer.lieuTravail);
    offers.push({
      id,
      title: text(offer.intitule, 240) ?? "Offre d'emploi",
      contract: text(offer.typeContratLibelle ?? offer.typeContrat),
      location: text(location.libelle),
      createdAt: text(offer.dateCreation),
      updatedAt: text(offer.dateActualisation),
      duration: text(offer.dureeContrat),
      experience: text(offer.experienceLibelle),
      sourceUrl,
      matchedBy: "siren"
    });
  }
  return offers;
}
