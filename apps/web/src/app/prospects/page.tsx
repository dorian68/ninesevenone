import type { Metadata } from "next";
import { ProspectFactory } from "@/components/prospect-factory/prospect-factory";

export const metadata: Metadata = {
  title: "Prospect Factory",
  description: "Exploration, certification et activation des prospects GUAD à grande échelle."
};

export default function ProspectFactoryPage() {
  return <ProspectFactory />;
}

