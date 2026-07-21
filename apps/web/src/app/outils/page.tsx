import type { Metadata } from "next";
import { StudioTools } from "@/components/studio-tools";

export const metadata: Metadata = {
  title: "Studio de ciblage",
  description: "Shortlist professionnelle et brouillon de CV ciblé à partir des données publiques des entreprises de Guadeloupe."
};

export default function ToolsPage() {
  return <StudioTools />;
}
