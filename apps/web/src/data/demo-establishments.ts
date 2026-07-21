export type SourceConfidence = "low" | "medium" | "high" | "verified";

export type DemoCompany = {
  id: string;
  siren: string;
  raisonSociale: string;
  nomCommercial?: string;
  formeJuridique: string;
  dateCreation: string;
  statut: "active" | "inactive";
  trancheEffectif?: string;
  siteWeb?: string;
  telephonePublic?: string;
  descriptionCourte: string;
  descriptionLongue: string;
  descriptionSource: "demo_seed_public_style" | "verified_company" | "naf_generated";
  descriptionConfidence: SourceConfidence;
  verified: boolean;
  slug: string;
};

export type DemoEstablishment = {
  id: string;
  companyId: string;
  siret: string;
  isHeadOffice: boolean;
  enseigne?: string;
  codeNaf: string;
  libelleNaf: string;
  secteurNormalise: string;
  adresseComplete: string;
  codePostal: string;
  commune: string;
  codeCommune: string;
  latitude: number;
  longitude: number;
  geocodingPrecision: "exact_address" | "street" | "postal_code" | "city_centroid" | "manual";
  geocodingSource: "demo_manual_seed";
  statut: "active" | "inactive";
  dateCreation: string;
};

export const demoMetadata = {
  datasetName: "Seed de démonstration local",
  referenceDate: "2026-07-18",
  source: "Données fictives explicitement marquées comme démonstration, non présentées comme entreprises réelles.",
  establishmentCount: 12,
  coverageNotice: "Ce jeu local ne mesure aucune couverture réelle. Utiliser le pipeline SIRENE/BAN pour importer les données publiques."
};

export const companies: DemoCompany[] = [
  {
    id: "c_demo_001",
    siren: "971000001",
    raisonSociale: "DEMO ATELIER CANNE ET BOIS",
    nomCommercial: "Atelier Canne & Bois",
    formeJuridique: "SAS, société par actions simplifiée",
    dateCreation: "2022-03-12",
    statut: "active",
    trancheEffectif: "3 à 5 salariés",
    descriptionCourte: "Établissement de démonstration enregistré dans le secteur « Fabrication d'autres meubles et industries connexes de l'ameublement ».",
    descriptionLongue: "Cette fiche est un exemple local destiné au développement. La description est factuelle et dérivée du secteur NAF de démonstration, sans prétendre représenter une entreprise réelle.",
    descriptionSource: "naf_generated",
    descriptionConfidence: "low",
    verified: false,
    slug: "atelier-canne-bois"
  },
  {
    id: "c_demo_002",
    siren: "971000002",
    raisonSociale: "DEMO LOGISTIQUE KARUKERA",
    nomCommercial: "Karukera Logistique",
    formeJuridique: "SARL",
    dateCreation: "2020-09-01",
    statut: "active",
    siteWeb: "https://example.invalid",
    descriptionCourte: "Établissement de démonstration enregistré dans le secteur « Entreposage et stockage non frigorifique ».",
    descriptionLongue: "Fiche de démonstration utilisée pour valider la carte, la recherche et les pages entreprises. Aucune donnée commerciale réelle n'est affirmée.",
    descriptionSource: "naf_generated",
    descriptionConfidence: "low",
    verified: true,
    slug: "karukera-logistique"
  },
  {
    id: "c_demo_003",
    siren: "971000003",
    raisonSociale: "DEMO SERVICES NUMERIQUES PAP",
    nomCommercial: "Services Numériques PAP",
    formeJuridique: "SASU",
    dateCreation: "2023-01-24",
    statut: "active",
    descriptionCourte: "Établissement de démonstration enregistré dans le secteur « Conseil en systèmes et logiciels informatiques ».",
    descriptionLongue: "Résumé automatique de démonstration fondé sur un code NAF. Les services précis ne sont pas extrapolés sans source supplémentaire.",
    descriptionSource: "naf_generated",
    descriptionConfidence: "low",
    verified: false,
    slug: "services-numeriques-pap"
  },
  {
    id: "c_demo_004",
    siren: "971000004",
    raisonSociale: "DEMO RESTAURATION MARIE GALANTE",
    nomCommercial: "Table Demo Marie-Galante",
    formeJuridique: "Entreprise individuelle",
    dateCreation: "2021-06-05",
    statut: "active",
    telephonePublic: "+590 590 00 00 00",
    descriptionCourte: "Établissement de démonstration enregistré dans le secteur « Restauration traditionnelle ».",
    descriptionLongue: "Les horaires, menus et spécialités ne sont pas renseignés dans le seed. La fiche illustre seulement le comportement produit.",
    descriptionSource: "naf_generated",
    descriptionConfidence: "low",
    verified: false,
    slug: "table-demo-marie-galante"
  },
  {
    id: "c_demo_005",
    siren: "971000005",
    raisonSociale: "DEMO SANTE PROXIMITE",
    nomCommercial: "Santé Proximité Demo",
    formeJuridique: "SELARL",
    dateCreation: "2019-11-14",
    statut: "active",
    descriptionCourte: "Établissement de démonstration enregistré dans le secteur « Activité des professionnels de la rééducation, de l'appareillage et des pédicures-podologues ».",
    descriptionLongue: "Aucune donnée personnelle de professionnel n'est fournie. Le seed vérifie que l'application reste prudente sur les activités sensibles.",
    descriptionSource: "naf_generated",
    descriptionConfidence: "low",
    verified: false,
    slug: "sante-proximite-demo"
  },
  {
    id: "c_demo_006",
    siren: "971000006",
    raisonSociale: "DEMO ECO MATERIAUX",
    nomCommercial: "Eco Matériaux Demo",
    formeJuridique: "SAS",
    dateCreation: "2018-02-18",
    statut: "active",
    descriptionCourte: "Établissement de démonstration enregistré dans le secteur « Commerce de gros de bois et de matériaux de construction ».",
    descriptionLongue: "Cette fiche illustre une entreprise multi-établissements. Les implantations sont fictives et réservées au développement local.",
    descriptionSource: "naf_generated",
    descriptionConfidence: "low",
    verified: true,
    slug: "eco-materiaux-demo"
  }
];

export const establishments: DemoEstablishment[] = [
  {
    id: "e_demo_001",
    companyId: "c_demo_001",
    siret: "97100000100011",
    isHeadOffice: true,
    enseigne: "Atelier Canne & Bois",
    codeNaf: "3109B",
    libelleNaf: "Fabrication d'autres meubles et industries connexes de l'ameublement",
    secteurNormalise: "Artisanat et fabrication",
    adresseComplete: "Adresse de démonstration, 97100 Basse-Terre",
    codePostal: "97100",
    commune: "Basse-Terre",
    codeCommune: "97105",
    latitude: 15.9985,
    longitude: -61.7278,
    geocodingPrecision: "manual",
    geocodingSource: "demo_manual_seed",
    statut: "active",
    dateCreation: "2022-03-12"
  },
  {
    id: "e_demo_002",
    companyId: "c_demo_002",
    siret: "97100000200019",
    isHeadOffice: true,
    enseigne: "Karukera Logistique",
    codeNaf: "5210B",
    libelleNaf: "Entreposage et stockage non frigorifique",
    secteurNormalise: "Transport et logistique",
    adresseComplete: "Zone de démonstration, 97122 Baie-Mahault",
    codePostal: "97122",
    commune: "Baie-Mahault",
    codeCommune: "97103",
    latitude: 16.2492,
    longitude: -61.5895,
    geocodingPrecision: "manual",
    geocodingSource: "demo_manual_seed",
    statut: "active",
    dateCreation: "2020-09-01"
  },
  {
    id: "e_demo_003",
    companyId: "c_demo_003",
    siret: "97100000300017",
    isHeadOffice: true,
    enseigne: "Services Numériques PAP",
    codeNaf: "6202A",
    libelleNaf: "Conseil en systèmes et logiciels informatiques",
    secteurNormalise: "Numérique et services",
    adresseComplete: "Adresse de démonstration, 97110 Pointe-à-Pitre",
    codePostal: "97110",
    commune: "Pointe-à-Pitre",
    codeCommune: "97120",
    latitude: 16.2413,
    longitude: -61.5331,
    geocodingPrecision: "manual",
    geocodingSource: "demo_manual_seed",
    statut: "active",
    dateCreation: "2023-01-24"
  },
  {
    id: "e_demo_004",
    companyId: "c_demo_004",
    siret: "97100000400015",
    isHeadOffice: true,
    enseigne: "Table Demo Marie-Galante",
    codeNaf: "5610A",
    libelleNaf: "Restauration traditionnelle",
    secteurNormalise: "Commerce, tourisme et restauration",
    adresseComplete: "Adresse de démonstration, 97112 Grand-Bourg",
    codePostal: "97112",
    commune: "Grand-Bourg",
    codeCommune: "97112",
    latitude: 15.8837,
    longitude: -61.3136,
    geocodingPrecision: "manual",
    geocodingSource: "demo_manual_seed",
    statut: "active",
    dateCreation: "2021-06-05"
  },
  {
    id: "e_demo_005",
    companyId: "c_demo_005",
    siret: "97100000500013",
    isHeadOffice: true,
    enseigne: "Santé Proximité Demo",
    codeNaf: "8690E",
    libelleNaf: "Activités des professionnels de la rééducation",
    secteurNormalise: "Santé et action sociale",
    adresseComplete: "Adresse de démonstration, 97139 Les Abymes",
    codePostal: "97139",
    commune: "Les Abymes",
    codeCommune: "97101",
    latitude: 16.2704,
    longitude: -61.5041,
    geocodingPrecision: "manual",
    geocodingSource: "demo_manual_seed",
    statut: "active",
    dateCreation: "2019-11-14"
  },
  {
    id: "e_demo_006",
    companyId: "c_demo_006",
    siret: "97100000600011",
    isHeadOffice: true,
    enseigne: "Eco Matériaux Demo",
    codeNaf: "4673A",
    libelleNaf: "Commerce de gros de bois et de matériaux de construction",
    secteurNormalise: "Commerce et distribution",
    adresseComplete: "Adresse de démonstration, 97122 Baie-Mahault",
    codePostal: "97122",
    commune: "Baie-Mahault",
    codeCommune: "97103",
    latitude: 16.262,
    longitude: -61.582,
    geocodingPrecision: "manual",
    geocodingSource: "demo_manual_seed",
    statut: "active",
    dateCreation: "2018-02-18"
  },
  {
    id: "e_demo_007",
    companyId: "c_demo_006",
    siret: "97100000600029",
    isHeadOffice: false,
    enseigne: "Eco Matériaux Demo - Sud Basse-Terre",
    codeNaf: "4673A",
    libelleNaf: "Commerce de gros de bois et de matériaux de construction",
    secteurNormalise: "Commerce et distribution",
    adresseComplete: "Adresse de démonstration, 97113 Gourbeyre",
    codePostal: "97113",
    commune: "Gourbeyre",
    codeCommune: "97109",
    latitude: 15.9938,
    longitude: -61.692,
    geocodingPrecision: "manual",
    geocodingSource: "demo_manual_seed",
    statut: "active",
    dateCreation: "2020-05-02"
  },
  {
    id: "e_demo_008",
    companyId: "c_demo_003",
    siret: "97100000300025",
    isHeadOffice: false,
    enseigne: "Services Numériques PAP - Nord Grande-Terre",
    codeNaf: "6202A",
    libelleNaf: "Conseil en systèmes et logiciels informatiques",
    secteurNormalise: "Numérique et services",
    adresseComplete: "Adresse de démonstration, 97117 Port-Louis",
    codePostal: "97117",
    commune: "Port-Louis",
    codeCommune: "97122",
    latitude: 16.4183,
    longitude: -61.5315,
    geocodingPrecision: "manual",
    geocodingSource: "demo_manual_seed",
    statut: "active",
    dateCreation: "2024-02-19"
  },
  {
    id: "e_demo_009",
    companyId: "c_demo_001",
    siret: "97100000100029",
    isHeadOffice: false,
    enseigne: "Atelier Canne & Bois - Les Saintes",
    codeNaf: "3109B",
    libelleNaf: "Fabrication d'autres meubles et industries connexes de l'ameublement",
    secteurNormalise: "Artisanat et fabrication",
    adresseComplete: "Adresse de démonstration, 97137 Terre-de-Haut",
    codePostal: "97137",
    commune: "Terre-de-Haut",
    codeCommune: "97131",
    latitude: 15.867,
    longitude: -61.582,
    geocodingPrecision: "manual",
    geocodingSource: "demo_manual_seed",
    statut: "active",
    dateCreation: "2023-10-02"
  },
  {
    id: "e_demo_010",
    companyId: "c_demo_004",
    siret: "97100000400023",
    isHeadOffice: false,
    enseigne: "Table Demo Désirade",
    codeNaf: "5610A",
    libelleNaf: "Restauration traditionnelle",
    secteurNormalise: "Commerce, tourisme et restauration",
    adresseComplete: "Adresse de démonstration, 97127 La Désirade",
    codePostal: "97127",
    commune: "La Désirade",
    codeCommune: "97110",
    latitude: 16.313,
    longitude: -61.052,
    geocodingPrecision: "manual",
    geocodingSource: "demo_manual_seed",
    statut: "active",
    dateCreation: "2022-08-08"
  },
  {
    id: "e_demo_011",
    companyId: "c_demo_002",
    siret: "97100000200027",
    isHeadOffice: false,
    enseigne: "Karukera Logistique - Moule",
    codeNaf: "5210B",
    libelleNaf: "Entreposage et stockage non frigorifique",
    secteurNormalise: "Transport et logistique",
    adresseComplete: "Adresse de démonstration, 97160 Le Moule",
    codePostal: "97160",
    commune: "Le Moule",
    codeCommune: "97117",
    latitude: 16.333,
    longitude: -61.347,
    geocodingPrecision: "manual",
    geocodingSource: "demo_manual_seed",
    statut: "active",
    dateCreation: "2021-04-17"
  },
  {
    id: "e_demo_012",
    companyId: "c_demo_005",
    siret: "97100000500021",
    isHeadOffice: false,
    enseigne: "Santé Proximité Demo - Sainte-Rose",
    codeNaf: "8690E",
    libelleNaf: "Activités des professionnels de la rééducation",
    secteurNormalise: "Santé et action sociale",
    adresseComplete: "Adresse de démonstration, 97115 Sainte-Rose",
    codePostal: "97115",
    commune: "Sainte-Rose",
    codeCommune: "97129",
    latitude: 16.332,
    longitude: -61.697,
    geocodingPrecision: "manual",
    geocodingSource: "demo_manual_seed",
    statut: "active",
    dateCreation: "2021-01-11"
  }
];

const demoDataset = { companies, establishments };

export default demoDataset;

export function getCompanyBySiren(siren: string) {
  return companies.find((company) => company.siren === siren);
}

export function getEstablishmentsForCompany(companyId: string) {
  return establishments.filter((establishment) => establishment.companyId === companyId);
}

export function getJoinedEstablishments() {
  return establishments.map((establishment) => ({
    ...establishment,
    company: companies.find((company) => company.id === establishment.companyId)!
  }));
}
