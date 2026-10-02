"use client";

import { type FormEvent, useEffect, useState } from "react";
import { Archive, ExternalLink, FileText, ImageIcon, LoaderCircle, Paperclip, Pencil, Plus, RotateCcw, Save, X } from "lucide-react";

import {
  COMPANY_SIGNAL_MAX_FILE_BYTES, type CompanySignal, type CompanySignalFields, type CompanySignalPage
} from "@/lib/company-signal-contract";
import styles from "./company-signals.module.css";

const kinds: Array<[CompanySignalFields["kind"], string]> = [
  ["job_posting", "Offre d’emploi"], ["article", "Article"], ["press_release", "Communiqué"],
  ["company_announcement", "Annonce de l’entreprise"], ["funding", "Financement"],
  ["leadership_change", "Changement de direction"], ["product_launch", "Lancement produit"],
  ["website", "Site de l’entreprise"], ["other", "Autre"]
];
const kindLabels = Object.fromEntries(kinds) as Record<CompanySignalFields["kind"], string>;
const dimensionLabels: Record<CompanySignalFields["readiness_dimension"], string> = {
  fit: "Fit", timing: "Timing", both: "Fit et timing", unknown: "À classer"
};
const evidenceLabels: Record<CompanySignalFields["evidence_type"], string> = {
  observed: "Observé", verified: "Vérifié", declared: "Déclaré", inferred: "Inféré", unknown: "À confirmer"
};

type Draft = { companyId: string; signalId: string | null; version: number | null; idempotencyKey: string; fields: CompanySignalFields };

function emptyFields(): CompanySignalFields {
  return { kind: "article", title: "", description: "", readiness_dimension: "unknown", interpretation: "",
    evidence_type: "unknown", source_reference: null, source_url: null,
    published_at: null, observed_at: null, archived: false };
}

function fieldsFromSignal(signal: CompanySignal): CompanySignalFields {
  return { kind: signal.kind, title: signal.title, description: signal.description,
    readiness_dimension: signal.readiness_dimension, interpretation: signal.interpretation,
    evidence_type: signal.evidence_type, source_reference: signal.source_reference,
    source_url: signal.source_url, published_at: signal.published_at,
    observed_at: signal.observed_at, archived: signal.archived };
}

function safeUrl(value: string | null) {
  if (!value) return null;
  try { return ["https:", "http:"].includes(new URL(value).protocol) ? value : null; }
  catch { return null; }
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(body?.error || "L’enregistrement a échoué. Réessayez.");
  if (!body) throw new Error("Le serveur n’a pas confirmé l’enregistrement.");
  return body;
}

function restoreDraft(companyId: string | null): Draft | null {
  if (!companyId || typeof window === "undefined") return null;
  try {
    const saved = sessionStorage.getItem(`caraaios:company-signal-draft:${companyId}`);
    if (!saved) return null;
    const draft = JSON.parse(saved) as Draft;
    return draft.companyId === companyId ? draft : null;
  } catch { return null; }
}

export function CompanySignals({ companyId }: { companyId: string | null }) {
  return <CompanySignalsBody key={companyId ?? "untracked"} companyId={companyId} />;
}

function CompanySignalsBody({ companyId }: { companyId: string | null }) {
  const [signals, setSignals] = useState<CompanySignal[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(() => restoreDraft(companyId));
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(Boolean(companyId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const baseUrl = companyId ? `/api/prospect-factory/crm/prospects/${encodeURIComponent(companyId)}/signals` : null;
  const draftKey = companyId ? `caraaios:company-signal-draft:${companyId}` : null;

  useEffect(() => {
    if (!draftKey) return;
    try {
      if (draft?.companyId === companyId) sessionStorage.setItem(draftKey, JSON.stringify(draft));
      else if (!draft) sessionStorage.removeItem(draftKey);
    } catch { /* Browser storage may be disabled; normal form state still works. */ }
  }, [draftKey, companyId, draft]);

  useEffect(() => {
    if (!baseUrl) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: "50", offset: "0", include_archived: String(includeArchived) });
    void fetch(`${baseUrl}?${params}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => jsonResponse<CompanySignalPage>(response))
      .then((page) => { setSignals(page.items); setTotal(page.total); setHasMore(page.has_more); setError(null); })
      .catch((caught: unknown) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Chargement des signaux impossible."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [baseUrl, includeArchived]);

  async function refresh() {
    if (!baseUrl) return;
    const params = new URLSearchParams({ limit: "50", offset: "0", include_archived: String(includeArchived) });
    const page = await jsonResponse<CompanySignalPage>(await fetch(`${baseUrl}?${params}`, { cache: "no-store" }));
    setSignals(page.items); setTotal(page.total); setHasMore(page.has_more);
  }

  async function loadMore() {
    if (!baseUrl || !hasMore || busy) return;
    setBusy(true); setError(null);
    try {
      const params = new URLSearchParams({ limit: "50", offset: String(signals.length), include_archived: String(includeArchived) });
      const page = await jsonResponse<CompanySignalPage>(await fetch(`${baseUrl}?${params}`, { cache: "no-store" }));
      setSignals((current) => [...current, ...page.items]); setTotal(page.total); setHasMore(page.has_more);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Chargement des signaux impossible."); }
    finally { setBusy(false); }
  }

  function startNew() {
    if (!companyId) return;
    setDraft({ companyId, signalId: null, version: null, idempotencyKey: crypto.randomUUID(), fields: emptyFields() });
    setPendingFiles([]); setError(null); setNotice(null);
  }

  function startEdit(signal: CompanySignal) {
    setDraft({ companyId: signal.company_id, signalId: signal.id, version: signal.version, idempotencyKey: crypto.randomUUID(), fields: fieldsFromSignal(signal) });
    setPendingFiles([]); setError(null); setNotice(null);
  }

  function change<K extends keyof CompanySignalFields>(key: K, value: CompanySignalFields[K]) {
    setDraft((current) => current ? { ...current, fields: { ...current.fields, [key]: value } } : current);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!baseUrl || !draft || busy) return;
    if (pendingFiles.some((file) => file.size < 1 || file.size > COMPANY_SIGNAL_MAX_FILE_BYTES)) {
      setError("Chaque pièce jointe doit contenir des données et peser au plus 10 Mo."); return;
    }
    setBusy(true); setError(null); setNotice(null);
    let phase: "signal" | "attachments" | "refresh" = "signal";
    try {
      const url = draft.signalId ? `${baseUrl}/${encodeURIComponent(draft.signalId)}` : baseUrl;
      const response = await fetch(url, { method: draft.signalId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(draft.signalId ? { expected_version: draft.version } : { idempotency_key: draft.idempotencyKey }), signal: draft.fields }) });
      const saved = await jsonResponse<{ signal: CompanySignal; outcome: string }>(response);
      setDraft((current) => current ? { ...current, signalId: saved.signal.id, version: saved.signal.version } : current);
      phase = "attachments";
      for (const file of pendingFiles) {
        const form = new FormData(); form.set("file", file);
        await jsonResponse(await fetch(`${baseUrl}/${encodeURIComponent(saved.signal.id)}/attachments`, { method: "POST", body: form }));
      }
      phase = "refresh";
      await refresh();
      setDraft(null); setPendingFiles([]);
      setNotice(saved.outcome === "created" ? "Signal enregistré." : "Signal mis à jour.");
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "Erreur inconnue.";
      setError(phase === "signal" ? `Enregistrement impossible. Votre texte reste dans le formulaire. ${detail}`
        : phase === "attachments" ? `Le signal est enregistré, mais une pièce jointe a échoué. Réessayez l'envoi ; les fichiers déjà transmis ne seront pas dupliqués. ${detail}`
          : `Le signal et ses pièces jointes sont enregistrés, mais la liste n'a pas pu être rechargée. Réessayez. ${detail}`);
    } finally { setBusy(false); }
  }

  async function setArchived(signal: CompanySignal, archived: boolean) {
    if (!baseUrl || busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await jsonResponse(await fetch(`${baseUrl}/${encodeURIComponent(signal.id)}`, { method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expected_version: signal.version, signal: { ...fieldsFromSignal(signal), archived } }) }));
      await refresh(); setNotice(archived ? "Signal archivé. Il peut être réactivé." : "Signal réactivé.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Modification impossible."); }
    finally { setBusy(false); }
  }

  return <section className={styles.section} aria-labelledby="company-signals-title">
    <div className={styles.heading}>
      <div><span className={styles.eyebrow}>Veille commerciale</span><h3 id="company-signals-title">Signaux de fit et de timing</h3>
        <p>Offres d’emploi, articles, annonces et preuves utiles pour décider quand et comment approcher ce compte.</p></div>
      {companyId ? <button type="button" className={styles.primary} onClick={startNew} disabled={busy}><Plus size={15} /> Ajouter un signal</button> : null}
    </div>
    {!companyId ? <p className={styles.empty}>Ajoutez l’entreprise au suivi pour enregistrer ses signaux.</p> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {notice ? <p role="status" className={styles.notice}>{notice}</p> : null}

    {draft && companyId ? <form className={styles.form} onSubmit={(event) => void save(event)}>
      <div className={styles.formHeading}><strong>{draft.signalId ? "Modifier le signal" : "Nouveau signal"}</strong>
        <button type="button" className={styles.textButton} onClick={() => { setDraft(null); setPendingFiles([]); setError(null); }} disabled={busy}><X size={14} /> Fermer</button></div>
      <div className={styles.fields}>
        <label>Type<select value={draft.fields.kind} onChange={(event) => change("kind", event.target.value as CompanySignalFields["kind"])}>{kinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Impact à examiner<select value={draft.fields.readiness_dimension} onChange={(event) => change("readiness_dimension", event.target.value as CompanySignalFields["readiness_dimension"])}><option value="unknown">À classer</option><option value="fit">Fit</option><option value="timing">Timing</option><option value="both">Fit et timing</option></select></label>
        <label className={styles.wide}>Titre<input required maxLength={240} value={draft.fields.title} onChange={(event) => change("title", event.target.value)} placeholder="Ex. Recrutement d’un Lead Finance Ops" /></label>
        <label className={styles.wide}>Information trouvée<textarea required rows={4} maxLength={20_000} value={draft.fields.description} onChange={(event) => change("description", event.target.value)} placeholder="Ce que dit précisément l’article, l’offre ou le document…" /></label>
        <label className={styles.wide}>Ce que cela pourrait signifier pour notre prospection <small>hypothèse distincte du fait observé</small><textarea rows={3} maxLength={10_000} value={draft.fields.interpretation} onChange={(event) => change("interpretation", event.target.value)} placeholder="Ex. Besoin possible de consolider le reporting ; à vérifier en entretien." /></label>
        <label>Statut de l’information<select value={draft.fields.evidence_type} onChange={(event) => change("evidence_type", event.target.value as CompanySignalFields["evidence_type"])}><option value="unknown">À confirmer</option><option value="observed">Observé dans la source</option><option value="verified">Vérifié</option><option value="declared">Déclaré par la personne</option><option value="inferred">Inféré</option></select></label>
        <label>Référence de la source<input maxLength={2_048} value={draft.fields.source_reference ?? ""} onChange={(event) => change("source_reference", event.target.value || null)} placeholder="Titre, fichier ou entretien" /></label>
        <label className={styles.wide}>Lien de la source<input type="url" maxLength={2_048} value={draft.fields.source_url ?? ""} onChange={(event) => change("source_url", event.target.value || null)} placeholder="https://…" /></label>
        <label>Date de publication<input type="date" value={draft.fields.published_at ?? ""} onChange={(event) => change("published_at", event.target.value || null)} /></label>
        <label>Date du signal<input type="date" value={draft.fields.observed_at ?? ""} onChange={(event) => change("observed_at", event.target.value || null)} /></label>
        <label className={styles.wide}>Pièces jointes <small>PDF, PNG, JPEG ou WebP · 10 Mo par fichier</small><input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => setPendingFiles(Array.from(event.target.files ?? []))} />{pendingFiles.length ? <span className={styles.fileNames}>{pendingFiles.map((file) => file.name).join(" · ")}</span> : null}</label>
      </div>
      <div className={styles.formActions}><button className={styles.primary} type="submit" disabled={busy}>{busy ? <LoaderCircle className={styles.spin} size={15} /> : <Save size={15} />} Enregistrer</button></div>
    </form> : null}

    {companyId ? <div className={styles.listControls}><span>{loading ? "Chargement…" : `${total} signal${total > 1 ? "aux" : ""}`}</span><label><input type="checkbox" checked={includeArchived} onChange={(event) => { setLoading(true); setIncludeArchived(event.target.checked); }} /> Voir les signaux archivés</label></div> : null}
    {!loading && companyId && !signals.length ? <p className={styles.empty}>Aucun signal enregistré. Ajoutez une offre d’emploi, un article ou une observation sourcée.</p> : null}
    <div className={styles.cards}>{signals.map((signal) => {
      const href = safeUrl(signal.source_url);
      return <article className={`${styles.card} ${signal.archived ? styles.archived : ""}`} key={signal.id}>
        <div className={styles.cardTop}><div className={styles.chips}><span>{kindLabels[signal.kind]}</span><span>{dimensionLabels[signal.readiness_dimension]}</span><span>{evidenceLabels[signal.evidence_type]}</span>{signal.archived ? <span>Archivé</span> : null}</div><div className={styles.cardActions}><button type="button" onClick={() => startEdit(signal)} disabled={busy}><Pencil size={13} /> Modifier</button><button type="button" onClick={() => void setArchived(signal, !signal.archived)} disabled={busy}>{signal.archived ? <RotateCcw size={13} /> : <Archive size={13} />}{signal.archived ? "Réactiver" : "Archiver"}</button></div></div>
        <h4>{signal.title}</h4><p className={styles.description}>{signal.description}</p>
        {signal.interpretation ? <p className={styles.interpretation}><strong>Lecture commerciale à vérifier :</strong> {signal.interpretation}</p> : null}
        <div className={styles.meta}>{signal.source_reference ? <span>Source : {signal.source_reference}</span> : null}{signal.published_at ? <span>Publié le {signal.published_at}</span> : null}{signal.observed_at ? <span>Signal du {signal.observed_at}</span> : null}{href ? <a href={href} target="_blank" rel="noreferrer">Ouvrir la source <ExternalLink size={12} /></a> : null}</div>
        {signal.attachments.length ? <ul className={styles.attachments}>{signal.attachments.map((attachment) => <li key={attachment.id}>{attachment.mime_type.startsWith("image/") ? <ImageIcon size={14} /> : <FileText size={14} />}<a href={`${baseUrl}/${encodeURIComponent(signal.id)}/attachments/${encodeURIComponent(attachment.id)}`} target="_blank" rel="noreferrer">{attachment.file_name}</a><small>{Math.max(1, Math.round(attachment.size_bytes / 1024))} Ko</small></li>)}</ul> : null}
      </article>;
    })}</div>
    {hasMore ? <button type="button" className={styles.more} onClick={() => void loadMore()} disabled={busy}><Paperclip size={14} /> Voir les signaux suivants</button> : null}
  </section>;
}
