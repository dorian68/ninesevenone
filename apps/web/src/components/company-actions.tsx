"use client";

import { AlertTriangle, CheckCircle2, ShieldCheck, X } from "lucide-react";
import { FormEvent, useState } from "react";

type ActionMode = "claim" | "report" | "update" | null;

const reportLabels = {
  factual_error: "Information factuellement incorrecte",
  personal_data: "Donnée personnelle à retirer",
  closed: "Établissement fermé ou inactif",
  other: "Autre demande"
} as const;

export function CompanyActions({ siren, companyName }: { siren: string; companyName: string }) {
  const [mode, setMode] = useState<ActionMode>(null);
  const [claimantName, setClaimantName] = useState("");
  const [professionalEmail, setProfessionalEmail] = useState("");
  const [companyRole, setCompanyRole] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [claimMessage, setClaimMessage] = useState("");
  const [reportCategory, setReportCategory] = useState<keyof typeof reportLabels>("factual_error");
  const [reportMessage, setReportMessage] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [claimId, setClaimId] = useState("");
  const [updateSiteWeb, setUpdateSiteWeb] = useState("");
  const [updatePhone, setUpdatePhone] = useState("");
  const [updateEmail, setUpdateEmail] = useState("");
  const [updateHours, setUpdateHours] = useState("");
  const [updateDescription, setUpdateDescription] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (busy) return;
    setMode(null);
    setError(null);
  }

  async function submitClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const response = await fetch(`/api/companies/${siren}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimantName, professionalEmail, companyRole, evidenceUrl, message: claimMessage, consent })
      });
      const payload = await response.json().catch(() => null) as { error?: string; claimId?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Impossible d’envoyer la demande");
      setStatus(`Demande enregistrée sous la référence ${payload?.claimId ?? "locale"}. Elle sera examinée par un administrateur.`);
      setMode(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Impossible d’envoyer la demande");
    } finally {
      setBusy(false);
    }
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const response = await fetch(`/api/companies/${siren}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: reportCategory, message: reportMessage, contactEmail })
      });
      const payload = await response.json().catch(() => null) as { error?: string; reportId?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Impossible d’envoyer le signalement");
      setStatus(`Signalement enregistré sous la référence ${payload?.reportId ?? "locale"}. Merci pour votre précision.`);
      setMode(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Impossible d’envoyer le signalement");
    } finally {
      setBusy(false);
    }
  }

  async function submitUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const response = await fetch(`/api/companies/${siren}/update-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimId,
          professionalEmail,
          siteWeb: updateSiteWeb,
          telephonePublic: updatePhone,
          emailPublic: updateEmail,
          openingHoursPublic: updateHours,
          descriptionCourte: updateDescription
        })
      });
      const payload = await response.json().catch(() => null) as { error?: string; updateRequestId?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Impossible d’envoyer la proposition");
      setStatus(`Proposition enregistrée sous la référence ${payload?.updateRequestId ?? "locale"}. Elle sera publiée séparément après examen.`);
      setMode(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Impossible d’envoyer la proposition");
    } finally {
      setBusy(false);
    }
  }

  return <div className="company-actions">
    <div className="company-action-buttons">
      <button className="button" type="button" aria-expanded={mode === "claim"} onClick={() => { setMode(mode === "claim" ? null : "claim"); setError(null); }}><ShieldCheck size={15} aria-hidden="true" /> Revendiquer cette fiche</button>
      <button className="button" type="button" aria-expanded={mode === "report"} onClick={() => { setMode(mode === "report" ? null : "report"); setError(null); }}><AlertTriangle size={15} aria-hidden="true" /> Signaler une erreur</button>
      <button className="button" type="button" aria-expanded={mode === "update"} onClick={() => { setMode(mode === "update" ? null : "update"); setError(null); }}><ShieldCheck size={15} aria-hidden="true" /> Proposer une mise à jour</button>
    </div>
    {status ? <p className="company-action-status" role="status"><CheckCircle2 size={16} aria-hidden="true" /> {status}</p> : null}
    {error ? <p className="studio-error" role="alert">{error}</p> : null}
    {mode === "claim" ? <form className="company-action-form" onSubmit={(event) => void submitClaim(event)}>
      <div className="company-action-form-heading"><div><span className="detail-eyebrow">Revendication</span><h3>{companyName}</h3></div><button className="icon-button" type="button" onClick={close} aria-label="Fermer le formulaire"><X size={16} aria-hidden="true" /></button></div>
      <p className="small muted">La revendication ne remplace aucune donnée officielle. Elle ouvre une demande de vérification et permet ensuite de proposer des enrichissements séparés.</p>
      <label><span className="label">Nom et prénom</span><input className="input" value={claimantName} onChange={(event) => setClaimantName(event.target.value)} autoComplete="name" required /></label>
      <label><span className="label">Email professionnel</span><input className="input" type="email" value={professionalEmail} onChange={(event) => setProfessionalEmail(event.target.value)} autoComplete="email" required /></label>
      <label><span className="label">Fonction dans l’entreprise</span><input className="input" value={companyRole} onChange={(event) => setCompanyRole(event.target.value)} required /></label>
      <label><span className="label">Lien justificatif public (facultatif)</span><input className="input" type="url" value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} placeholder="https://..." /></label>
      <label><span className="label">Éléments de vérification</span><textarea className="input company-action-textarea" value={claimMessage} onChange={(event) => setClaimMessage(event.target.value)} minLength={20} maxLength={3000} required /></label>
      <label className="company-action-check"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required /><span>J’autorise l’examen de ces informations dans le cadre de cette demande.</span></label>
      <button className="button primary" type="submit" disabled={busy}>{busy ? "Envoi…" : "Envoyer la demande"}</button>
    </form> : null}
    {mode === "report" ? <form className="company-action-form" onSubmit={(event) => void submitReport(event)}>
      <div className="company-action-form-heading"><div><span className="detail-eyebrow">Signalement</span><h3>{companyName}</h3></div><button className="icon-button" type="button" onClick={close} aria-label="Fermer le formulaire"><X size={16} aria-hidden="true" /></button></div>
      <p className="small muted">Le signalement est examiné séparément des sources administratives et laisse une trace de modération.</p>
      <label><span className="label">Motif</span><select className="input" value={reportCategory} onChange={(event) => setReportCategory(event.target.value as keyof typeof reportLabels)}>{Object.entries(reportLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span className="label">Description du problème</span><textarea className="input company-action-textarea" value={reportMessage} onChange={(event) => setReportMessage(event.target.value)} minLength={10} maxLength={3000} required /></label>
      <label><span className="label">Email de suivi (facultatif)</span><input className="input" type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} autoComplete="email" /></label>
      <button className="button primary" type="submit" disabled={busy}>{busy ? "Envoi…" : "Envoyer le signalement"}</button>
    </form> : null}
    {mode === "update" ? <form className="company-action-form" onSubmit={(event) => void submitUpdate(event)}>
      <div className="company-action-form-heading"><div><span className="detail-eyebrow">Enrichissement déclaré</span><h3>{companyName}</h3></div><button className="icon-button" type="button" onClick={close} aria-label="Fermer le formulaire"><X size={16} aria-hidden="true" /></button></div>
      <p className="small muted">Ce parcours nécessite une revendication déjà approuvée. Les champs proposés seront publiés comme informations déclarées et resteront séparés des données officielles.</p>
      <label><span className="label">Référence de la revendication approuvée</span><input className="input" value={claimId} onChange={(event) => setClaimId(event.target.value)} placeholder="Identifiant reçu après la revendication" required /></label>
      <label><span className="label">Email professionnel de la revendication</span><input className="input" type="email" value={professionalEmail} onChange={(event) => setProfessionalEmail(event.target.value)} autoComplete="email" required /></label>
      <label><span className="label">Site web public</span><input className="input" type="url" value={updateSiteWeb} onChange={(event) => setUpdateSiteWeb(event.target.value)} placeholder="https://..." /></label>
      <label><span className="label">Téléphone professionnel public</span><input className="input" value={updatePhone} onChange={(event) => setUpdatePhone(event.target.value)} /></label>
      <label><span className="label">Email fonctionnel public</span><input className="input" type="email" value={updateEmail} onChange={(event) => setUpdateEmail(event.target.value)} /></label>
      <label><span className="label">Horaires publiés</span><textarea className="input company-action-textarea" value={updateHours} onChange={(event) => setUpdateHours(event.target.value)} maxLength={1000} /></label>
      <label><span className="label">Présentation factuelle de l’activité</span><textarea className="input company-action-textarea" value={updateDescription} onChange={(event) => setUpdateDescription(event.target.value)} minLength={20} maxLength={600} /></label>
      <button className="button primary" type="submit" disabled={busy}>{busy ? "Envoi…" : "Soumettre pour examen"}</button>
    </form> : null}
  </div>;
}
