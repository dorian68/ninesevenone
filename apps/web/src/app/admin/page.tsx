import { ExternalLink, ShieldCheck, Database, Newspaper, MapPinned, Building2 } from "lucide-react";
import { AdminConsole } from "@/components/admin-console";
import { getAdminCoverageSnapshot } from "@/lib/admin-coverage";

export default function AdminPage() {
  const snapshot = getAdminCoverageSnapshot();
  return (
    <main className="page admin-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Observabilité des données</span>
          <h1>Administration</h1>
          <p className="muted">Couverture réelle des snapshots locaux, fraîcheur et limites connues, avec files de modération protégées côté serveur.</p>
        </div>
        <span className="badge"><ShieldCheck size={15} aria-hidden="true" /> Monitoring + modération</span>
      </div>
      <div className="bi-metrics">
        <div><Building2 size={18} aria-hidden="true" /><strong>{snapshot.totals.companies?.toLocaleString("fr-FR") ?? "—"}</strong><span>unités légales</span></div>
        <div><MapPinned size={18} aria-hidden="true" /><strong>{snapshot.totals.geolocated?.toLocaleString("fr-FR") ?? "—"}</strong><span>établissements géolocalisés</span></div>
        <div><Database size={18} aria-hidden="true" /><strong>{snapshot.totals.bodaccEvents?.toLocaleString("fr-FR") ?? "—"}</strong><span>événements BODACC</span></div>
        <div><Newspaper size={18} aria-hidden="true" /><strong>{snapshot.totals.pressMentions?.toLocaleString("fr-FR") ?? "—"}</strong><span>mentions média</span></div>
      </div>
      <section className="bi-section" aria-labelledby="coverage-title">
        <div className="bi-heading"><div><span className="eyebrow">Sources publiques</span><h2 id="coverage-title">État des enrichissements</h2></div><span className="small muted">Mesuré le {new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(snapshot.generatedAt))}</span></div>
        <div className="info-grid">
          {snapshot.sources.map((source) => <article className="info-box" key={source.name} data-status={source.status}>
            <div className="bi-subheading"><h3 className="title">{source.name}</h3><span className="badge">{source.status === "ok" ? "Disponible" : source.status === "partial" ? "Partiel" : "Indisponible"}</span></div>
            <strong className="admin-coverage-count">{source.count?.toLocaleString("fr-FR") ?? "—"}</strong>
            <p className="small">{source.detail}</p>
            <p className="small muted">Dernière récupération : {source.retrievedAt ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(source.retrievedAt)) : "non renseignée"}</p>
            {source.sourceUrl ? <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer">Source et métadonnées <ExternalLink size={13} aria-hidden="true" /></a> : null}
          </article>)}
        </div>
      </section>
      <AdminConsole />
      <p className="small muted admin-readonly-note">Les métriques de couverture restent en lecture seule. Les revendications, signalements et enrichissements déclarés sont traités uniquement après configuration des secrets administrateur, dans un registre séparé et audité.</p>
    </main>
  );
}
