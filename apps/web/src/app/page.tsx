import { MapExplorer } from "@/components/map-explorer";
import { activeDatasetKind, datasetMetadata } from "@/data/establishment-store";
import { BriefcaseBusiness, Database, MapPinned } from "lucide-react";
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="Guadeloupe Entreprises">
          <span className="brand-mark" aria-hidden="true"><MapPinned size={19} /></span>
          <span className="brand-copy">
            <strong>Guadeloupe Entreprises</strong>
            <small>Observatoire économique territorial</small>
          </span>
        </div>
        <div className="topbar-meta">
          <span className="topbar-view"><span className="status-dot" aria-hidden="true" /> Carte interactive</span>
          <span className="topbar-dataset"><Database size={15} aria-hidden="true" /> {activeDatasetKind === "real" ? "Données publiques" : "Seed démo"} · {datasetMetadata.establishmentCount.toLocaleString("fr-FR")} établissements · {datasetMetadata.referenceDate}</span>
          <Link className="topbar-tool-link" href="/outils"><BriefcaseBusiness size={15} aria-hidden="true" /> Studio outils</Link>
        </div>
      </header>
      <MapExplorer />
    </main>
  );
}
