"use client";

import { Check, LogIn, LogOut, RefreshCw, ShieldCheck, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";

type CompanyClaim = { id: string; siren: string; claimantName: string; professionalEmail: string; companyRole: string; evidenceUrl: string | null; message: string; status: "pending" | "approved" | "rejected"; reviewNote: string | null; createdAt: string; reviewedAt: string | null };
type CompanyReport = { id: string; siren: string; category: "factual_error" | "personal_data" | "closed" | "other"; message: string; contactEmail: string | null; status: "pending" | "resolved" | "dismissed"; reviewNote: string | null; createdAt: string; reviewedAt: string | null };
type CompanyUpdateRequest = { id: string; siren: string; claimId: string; professionalEmail: string; payload: Record<string, string>; status: "pending" | "approved" | "rejected"; reviewNote: string | null; createdAt: string; reviewedAt: string | null };
type AuditLog = { id: string; actorRole: string; action: string; entityType: string; entityId: string | null; createdAt: string };

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

const updateLabels: Record<string, string> = {
  siteWeb: "site web",
  telephonePublic: "téléphone",
  emailPublic: "email fonctionnel",
  openingHoursPublic: "horaires",
  descriptionCourte: "présentation"
};

export function AdminConsole() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [claims, setClaims] = useState<CompanyClaim[]>([]);
  const [reports, setReports] = useState<CompanyReport[]>([]);
  const [updates, setUpdates] = useState<CompanyUpdateRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const loadQueues = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [claimsResponse, reportsResponse, updatesResponse, auditResponse] = await Promise.all([
        fetch("/api/admin/claims?status=pending", { cache: "no-store" }),
        fetch("/api/admin/reports?status=pending", { cache: "no-store" }),
        fetch("/api/admin/updates?status=pending", { cache: "no-store" }),
        fetch("/api/admin/audit", { cache: "no-store" })
      ]);
      if ([claimsResponse, reportsResponse, updatesResponse, auditResponse].some((response) => response.status === 401)) {
        setAuthenticated(false);
        setRole(null);
        throw new Error("Session administrateur expirée");
      }
      if (!claimsResponse.ok || !reportsResponse.ok || !updatesResponse.ok || !auditResponse.ok) throw new Error("Files de modération indisponibles");
      const claimsData = await claimsResponse.json() as { claims: CompanyClaim[] };
      const reportsData = await reportsResponse.json() as { reports: CompanyReport[] };
      const updatesData = await updatesResponse.json() as { updates: CompanyUpdateRequest[] };
      const auditData = await auditResponse.json() as { logs: AuditLog[] };
      setClaims(claimsData.claims);
      setReports(reportsData.reports);
      setUpdates(updatesData.updates);
      setAuditLogs(auditData.logs);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Files de modération indisponibles");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSession = useCallback(async () => {
    const response = await fetch("/api/admin/session", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json() as { configured: boolean; authenticated: boolean; role: string | null };
    setConfigured(data.configured);
    setAuthenticated(data.authenticated);
    setRole(data.role);
    if (data.authenticated) await loadQueues();
  }, [loadQueues]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadSession(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadSession]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const data = await response.json().catch(() => null) as { error?: string; role?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? "Authentification refusée");
      setAuthenticated(true);
      setRole(data?.role ?? null);
      setToken("");
      setStatus("Session administrateur ouverte");
      await loadQueues();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Authentification refusée");
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await fetch("/api/admin/session", { method: "DELETE" });
    setAuthenticated(false);
    setRole(null);
    setClaims([]);
    setReports([]);
    setUpdates([]);
    setAuditLogs([]);
    setStatus("Session fermée");
  }

  async function review(kind: "claims" | "reports" | "updates", id: string, decision: "approved" | "rejected" | "resolved" | "dismissed") {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/${kind}/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: decision, reviewNote: notes[id] ?? "" }) });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? "Décision impossible");
      setNotes((current) => { const next = { ...current }; delete next[id]; return next; });
      setStatus("Décision enregistrée et auditée");
      await loadQueues();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Décision impossible");
    } finally {
      setLoading(false);
    }
  }

  if (configured === null) return <section className="admin-console info-box"><p className="small muted">Vérification de la session administrateur…</p></section>;
  if (!configured) return <section className="admin-console info-box" aria-labelledby="admin-auth-title"><div className="bi-subheading"><div><span className="eyebrow">Console sécurisée</span><h2 id="admin-auth-title">Authentification non configurée</h2></div><span className="badge">Écriture désactivée</span></div><p className="small">Définissez <code>ADMIN_ACCESS_TOKEN</code> et <code>ADMIN_SESSION_SECRET</code> côté serveur avant d’ouvrir les files de modération. Aucun bouton d’administration ne fonctionne sans ces secrets.</p></section>;
  if (!authenticated) return <section className="admin-console info-box" aria-labelledby="admin-login-title">
    <div className="bi-subheading"><div><span className="eyebrow">Console sécurisée</span><h2 id="admin-login-title">Ouvrir une session</h2></div><span className="badge"><ShieldCheck size={14} aria-hidden="true" /> RBAC serveur</span></div>
    <form className="admin-login-form" onSubmit={(event) => void login(event)}><label><span className="label">Jeton d’accès administrateur</span><input className="input" type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="current-password" required /></label><button className="button primary" type="submit" disabled={loading}><LogIn size={15} aria-hidden="true" /> {loading ? "Vérification…" : "Ouvrir la console"}</button></form>
    {error ? <p className="studio-error" role="alert">{error}</p> : null}
  </section>;

  return <section className="admin-console" aria-labelledby="admin-queue-title">
    <div className="page-heading admin-console-heading"><div><span className="eyebrow">Session {role}</span><h2 id="admin-queue-title">Files de modération</h2><p className="small muted">Les décisions sont séparées des données officielles et inscrites dans le journal d’audit.</p></div><div className="candidate-actions"><button className="button" type="button" onClick={() => void loadQueues()} disabled={loading}><RefreshCw size={15} aria-hidden="true" /> Actualiser</button><button className="button" type="button" onClick={() => void logout()}><LogOut size={15} aria-hidden="true" /> Fermer la session</button></div></div>
    {status ? <p className="company-action-status" role="status"><Check size={16} aria-hidden="true" /> {status}</p> : null}
    {error ? <p className="studio-error" role="alert">{error}</p> : null}
    <div className="admin-queue-grid">
      <section className="info-box" aria-labelledby="claims-queue-title"><div className="bi-subheading"><h3 id="claims-queue-title" className="title">Revendications ({claims.length})</h3><span className="badge">À examiner</span></div>{claims.length ? <div className="admin-queue-list">{claims.map((claim) => <article className="admin-queue-item" key={claim.id}><div className="admin-queue-item-heading"><strong>SIREN {claim.siren}</strong><small>{formatDate(claim.createdAt)}</small></div><p><strong>{claim.claimantName}</strong> · {claim.companyRole} · <a href={`mailto:${claim.professionalEmail}`}>{claim.professionalEmail}</a></p><p className="small">{claim.message}</p>{claim.evidenceUrl ? <a className="small" href={claim.evidenceUrl} target="_blank" rel="noopener noreferrer">Justificatif public ↗</a> : null}<label><span className="label">Note de décision</span><textarea className="input admin-review-note" value={notes[claim.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [claim.id]: event.target.value }))} maxLength={2000} /></label><div className="candidate-actions"><button className="button primary" type="button" disabled={loading} onClick={() => void review("claims", claim.id, "approved")}><Check size={14} aria-hidden="true" /> Approuver</button><button className="button" type="button" disabled={loading} onClick={() => void review("claims", claim.id, "rejected")}><X size={14} aria-hidden="true" /> Refuser</button></div></article>)}</div> : <p className="empty-state">Aucune revendication en attente.</p>}</section>
      <section className="info-box" aria-labelledby="reports-queue-title"><div className="bi-subheading"><h3 id="reports-queue-title" className="title">Signalements ({reports.length})</h3><span className="badge">À examiner</span></div>{reports.length ? <div className="admin-queue-list">{reports.map((report) => <article className="admin-queue-item" key={report.id}><div className="admin-queue-item-heading"><strong>SIREN {report.siren}</strong><small>{formatDate(report.createdAt)}</small></div><p className="small">Motif : {report.category}{report.contactEmail ? <> · <a href={`mailto:${report.contactEmail}`}>{report.contactEmail}</a></> : null}</p><p>{report.message}</p><label><span className="label">Note de décision</span><textarea className="input admin-review-note" value={notes[report.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [report.id]: event.target.value }))} maxLength={2000} /></label><div className="candidate-actions"><button className="button primary" type="button" disabled={loading} onClick={() => void review("reports", report.id, "resolved")}><Check size={14} aria-hidden="true" /> Résoudre</button><button className="button" type="button" disabled={loading} onClick={() => void review("reports", report.id, "dismissed")}><X size={14} aria-hidden="true" /> Classer sans suite</button></div></article>)}</div> : <p className="empty-state">Aucun signalement en attente.</p>}</section>
      <section className="info-box" aria-labelledby="updates-queue-title"><div className="bi-subheading"><h3 id="updates-queue-title" className="title">Enrichissements ({updates.length})</h3><span className="badge">DATA_ADMIN</span></div>{updates.length ? <div className="admin-queue-list">{updates.map((update) => <article className="admin-queue-item" key={update.id}><div className="admin-queue-item-heading"><strong>SIREN {update.siren}</strong><small>{formatDate(update.createdAt)}</small></div><p className="small">Revendication {update.claimId} · <a href={`mailto:${update.professionalEmail}`}>{update.professionalEmail}</a></p><p className="small">Champs proposés : {Object.keys(update.payload).map((key) => updateLabels[key] ?? key).join(", ") || "aucun"}</p><label><span className="label">Note de décision</span><textarea className="input admin-review-note" value={notes[update.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [update.id]: event.target.value }))} maxLength={2000} /></label><div className="candidate-actions"><button className="button primary" type="button" disabled={loading || role === "MODERATOR"} onClick={() => void review("updates", update.id, "approved")}><Check size={14} aria-hidden="true" /> Publier comme déclaré</button><button className="button" type="button" disabled={loading || role === "MODERATOR"} onClick={() => void review("updates", update.id, "rejected")}><X size={14} aria-hidden="true" /> Refuser</button></div></article>)}</div> : <p className="empty-state">Aucun enrichissement en attente.</p>}</section>
    </div>
    <section className="info-box admin-audit-box" aria-labelledby="audit-title"><div className="bi-subheading"><h3 id="audit-title" className="title">Journal d’audit récent</h3><span className="badge">{auditLogs.length} entrées</span></div>{auditLogs.length ? <div className="admin-audit-list">{auditLogs.slice(0, 20).map((log) => <div className="admin-audit-row" key={log.id}><strong>{log.action}</strong><span>{log.entityType}{log.entityId ? ` · ${log.entityId}` : ""}</span><small>{log.actorRole} · {formatDate(log.createdAt)}</small></div>)}</div> : <p className="empty-state">Aucune décision enregistrée.</p>}</section>
  </section>;
}
