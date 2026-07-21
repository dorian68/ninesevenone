import demoDataset, {
  companies as demoCompanies,
  demoMetadata,
  establishments as demoEstablishments,
  type DemoCompany,
  type DemoEstablishment
} from "@/data/demo-establishments";
import realDataset from "@/generated/real-establishments.json";
import realMetadata from "@/generated/real-metadata.json";

type RealDataset = {
  companies: DemoCompany[];
  establishments: DemoEstablishment[];
};

const real = realDataset as unknown as RealDataset;

export const activeDatasetKind = real.establishments.length > 0 ? "real" : "demo";
export const companies = activeDatasetKind === "real" ? real.companies : demoCompanies;
export const establishments = activeDatasetKind === "real" ? real.establishments : demoEstablishments;
export const datasetMetadata = activeDatasetKind === "real" ? {
  ...realMetadata,
  establishmentCount: realMetadata.establishmentCount || real.establishments.length
} : demoMetadata;

export type Company = DemoCompany;
export type Establishment = DemoEstablishment;

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
  })).filter((entry) => Boolean(entry.company));
}

export { demoDataset };
