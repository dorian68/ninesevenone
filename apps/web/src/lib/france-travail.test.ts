import { describe, expect, it } from "vitest";
import { parseRecruitmentOffers } from "./france-travail-parser";

describe("France Travail recruitment matching", () => {
  it("keeps only offers carrying the target SIREN/SIRET", () => {
    const offers = parseRecruitmentOffers({
      resultats: [
        {
          id: "offer-1",
          intitule: "Technicien réseau",
          entreprise: { siret: "12345678900011" },
          lieuTravail: { libelle: "Les Abymes" },
          origineOffre: { urlOrigine: "https://candidat.francetravail.fr/offres/offer-1" }
        },
        { id: "offer-2", intitule: "Homonyme", entreprise: { siret: "98765432100022" } },
        { id: "offer-3", intitule: "Sans identifiant", entreprise: { nom: "Entreprise test" } }
      ]
    }, "123456789", ["12345678900011"]);

    expect(offers).toHaveLength(1);
    expect(offers[0].id).toBe("offer-1");
    expect(offers[0].matchedBy).toBe("siren");
  });
});
