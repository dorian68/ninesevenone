"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ClipboardCopy, LoaderCircle, Pencil, Plus, RotateCcw, Save, X } from "lucide-react";

import type { ProspectContact } from "@/lib/prospect-factory-crm-contract";
import {
  type OutreachContext, type OutreachDraft, type OutreachDraftFields, type OutreachDraftPage
} from "@/lib/outreach-draft-contract";
import styles from "./company-outreach.module.css";

type Editor = {
  companyId: string;
  draftId: string | null;
  version: number | null;
  idempotencyKey: string;
  fields: OutreachDraftFields;
};

const channels: Array<[OutreachDraftFields["channel"], string]> = [
  ["email", "E-mail"], ["linkedin_connection", "Invitation LinkedIn"],
  ["linkedin_message", "Message LinkedIn"], ["phone", "Trame d'appel"], ["other", "Autre"]
];
const channelLabels = Object.fromEntries(channels) as Record<OutreachDraftFields["channel"], string>;
const statusLabels: Record<OutreachDraftFields["status"], string> = {
  draft: "Brouillon", ready: "Prêt à relire", archived: "Archivé"
};

function newIdempotencyKey() {
  return `outreach-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function restoreEditor(companyId: string | null): Editor | null {
  if (!companyId || typeof window === "undefined") return null;
  try {
    const text = sessionStorage.getItem("caraaios:outreach-editor:" + companyId);
    if (!text) return null;
    const value = JSON.parse(text) as Editor;
    return value.companyId === companyId ? value : null;
  } catch { return null; }
}

function fieldsFromDraft(draft: OutreachDraft): OutreachDraftFields | null {
  if (!draft.contact_id) return null;
  return {
    contact_id: draft.contact_id, icp_id: draft.icp_id, persona_id: draft.persona_id,
    opportunity_id: draft.opportunity_id, channel: draft.channel, status: draft.status,
    angle: draft.angle, subject: draft.subject, body: draft.body,
    call_to_action: draft.call_to_action, signal_ids: draft.signal_ids
  };
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(body?.error || "L'opération a échoué. Réessayez.");
  if (!body) throw new Error("Le serveur n'a pas confirmé l'opération.");
  return body;
}

export function CompanyOutreach({ companyId, contacts, initialContactId }: {
  companyId: string | null; contacts: ProspectContact[]; initialContactId?: string | null
}) {
  return <CompanyOutreachBody key={companyId ?? "untracked"} companyId={companyId}
    contacts={contacts} initialContactId={initialContactId} />;
}

function CompanyOutreachBody({ companyId, contacts, initialContactId }: {
  companyId: string | null; contacts: ProspectContact[]; initialContactId?: string | null
}) {
  const [editor, setEditor] = useState<Editor | null>(() => restoreEditor(companyId));
  const [contactId, setContactId] = useState(() => restoreEditor(companyId)?.fields.contact_id || initialContactId || "");
  const [contactQuery, setContactQuery] = useState("");
  const [context, setContext] = useState<OutreachContext | null>(null);
  const [drafts, setDrafts] = useState<OutreachDraft[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lastInitialContactId = useRef(initialContactId);

  const orderedContacts = useMemo(() => [...contacts].sort((a, b) => a.name.localeCompare(b.name, "fr")), [contacts]);
  const visibleContacts = orderedContacts.filter((item) =>
    !contactQuery || item.id === contactId ||
    (item.name + " " + (item.verifiedTitle || item.inputTitle || "")).toLocaleLowerCase("fr")
      .includes(contactQuery.toLocaleLowerCase("fr")));
  const base = companyId ? "/api/prospect-factory/crm/prospects/" + encodeURIComponent(companyId) : null;

  useEffect(() => {
    if (initialContactId !== lastInitialContactId.current && !editor && initialContactId
      && contacts.some((item) => item.id === initialContactId)) {
      setContactId(initialContactId);
    }
    lastInitialContactId.current = initialContactId;
  }, [contacts, editor, initialContactId]);

  useEffect(() => {
    if (!companyId) return;
    try {
      const key = "caraaios:outreach-editor:" + companyId;
      if (editor) sessionStorage.setItem(key, JSON.stringify(editor));
      else sessionStorage.removeItem(key);
    } catch { /* The form still works if browser storage is disabled. */ }
  }, [companyId, editor]);

  useEffect(() => {
    if (!base || !contactId) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ contact_id: contactId, signal_limit: "30" });
    if (editor?.fields.icp_id) query.set("icp_id", editor.fields.icp_id);
    if (editor?.fields.persona_id) query.set("persona_id", editor.fields.persona_id);
    if (editor?.fields.opportunity_id) query.set("opportunity_id", editor.fields.opportunity_id);
    void fetch(base + "/outreach-context?" + query, { signal: controller.signal, cache: "no-store" })
      .then((response) => jsonResponse<{ context: OutreachContext }>(response))
      .then((payload) => { if (!controller.signal.aborted) setContext(payload.context); })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Contexte indisponible.");
      });
    return () => controller.abort();
  }, [base, contactId, editor?.fields.icp_id, editor?.fields.persona_id, editor?.fields.opportunity_id]);

  useEffect(() => {
    if (!base || !contactId) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ contact_id: contactId, limit: "50", offset: "0",
      include_archived: String(includeArchived) });
    void fetch(base + "/outreach-drafts?" + query, { signal: controller.signal, cache: "no-store" })
      .then((response) => jsonResponse<OutreachDraftPage>(response))
      .then((page) => {
        if (!controller.signal.aborted) {
          setDrafts(page.items); setTotal(page.total); setHasMore(page.has_more); setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Brouillons indisponibles.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [base, contactId, includeArchived]);

  async function refreshDrafts() {
    if (!base || !contactId) return;
    const query = new URLSearchParams({ contact_id: contactId, limit: "50", offset: "0",
      include_archived: String(includeArchived) });
    const page = await jsonResponse<OutreachDraftPage>(await fetch(base + "/outreach-drafts?" + query, { cache: "no-store" }));
    setDrafts(page.items); setTotal(page.total); setHasMore(page.has_more);
  }

  async function loadMore() {
    if (!base || !contactId || !hasMore || busy) return;
    setBusy(true); setError(null);
    try {
      const query = new URLSearchParams({ contact_id: contactId, limit: "50", offset: String(drafts.length),
        include_archived: String(includeArchived) });
      const page = await jsonResponse<OutreachDraftPage>(await fetch(base + "/outreach-drafts?" + query, { cache: "no-store" }));
      setDrafts((current) => [...current, ...page.items]); setTotal(page.total); setHasMore(page.has_more);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Chargement impossible."); }
    finally { setBusy(false); }
  }

  function startNew() {
    if (!companyId || !contactId) return;
    const preferredIcp = context?.icps.find((item) => item.associated)?.id ?? null;
    setEditor({ companyId, draftId: null, version: null, idempotencyKey: newIdempotencyKey(),
      fields: { contact_id: contactId, icp_id: preferredIcp, persona_id: null, opportunity_id: null,
        channel: "email", status: "draft", angle: "", subject: "", body: "",
        call_to_action: "", signal_ids: [] } });
    setError(null); setNotice(null);
  }

  function startEdit(draft: OutreachDraft) {
    if (!companyId) return;
    const fields = fieldsFromDraft(draft);
    if (!fields) { setError("Le contact d'origine n'existe plus ; ce brouillon reste consultable."); return; }
    setContactId(fields.contact_id);
    setEditor({ companyId, draftId: draft.id, version: draft.version,
      idempotencyKey: newIdempotencyKey(), fields });
    setError(null); setNotice(null);
  }

  function change<K extends keyof OutreachDraftFields>(key: K, value: OutreachDraftFields[K]) {
    setEditor((current) => current ? { ...current, fields: { ...current.fields, [key]: value } } : current);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!base || !editor || busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const path = editor.draftId ? base + "/outreach-drafts/" + encodeURIComponent(editor.draftId)
        : base + "/outreach-drafts";
      const response = await fetch(path, { method: editor.draftId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editor.draftId ? { expected_version: editor.version } : { idempotency_key: editor.idempotencyKey }),
          draft: editor.fields
        }) });
      const saved = await jsonResponse<{ draft: OutreachDraft; outcome: string }>(response);
      setEditor((current) => current ? { ...current, draftId: saved.draft.id, version: saved.draft.version } : current);
      try {
        await refreshDrafts();
        setEditor(null);
        setNotice(saved.outcome === "created" ? "Brouillon enregistré pour cette personne." : "Brouillon mis à jour.");
      } catch {
        setNotice("Brouillon enregistré, mais la liste n’a pas pu être actualisée. Vous pouvez recharger la fiche.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Enregistrement impossible. Votre texte reste dans le formulaire.");
    } finally { setBusy(false); }
  }

  async function setArchived(draft: OutreachDraft, archived: boolean) {
    const fields = fieldsFromDraft(draft);
    if (!base || !fields || busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await jsonResponse(await fetch(base + "/outreach-drafts/" + encodeURIComponent(draft.id), {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expected_version: draft.version,
          draft: { ...fields, status: archived ? "archived" : "draft" } })
      }));
      await refreshDrafts();
      setNotice(archived ? "Brouillon archivé." : "Brouillon réactivé.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Modification impossible."); }
    finally { setBusy(false); }
  }

  return <section className={styles.root} aria-labelledby="outreach-title">
    <div className={styles.heading}><div><span className={styles.eyebrow}>Approche ciblée</span>
      <h3 id="outreach-title">Copywriting par personne</h3>
      <p>Choisissez un contact à approcher, son contexte ICP et son persona. Les textes restent des brouillons ; aucun message n’est envoyé ici.</p></div>
      {contactId && !editor ? <button type="button" className={styles.primary} onClick={startNew}><Plus size={15} /> Nouveau brouillon</button> : null}
    </div>
    {!companyId ? <p className={styles.empty}>Ajoutez d’abord cette société au suivi commercial.</p> : <>
      <div className={styles.target}>
        <label>Rechercher une personne<input type="search" value={contactQuery} onChange={(event) => setContactQuery(event.target.value)}
          placeholder="Nom ou fonction…" disabled={Boolean(editor)} /></label>
        <label>Personne ciblée<select value={contactId} disabled={Boolean(editor)} onChange={(event) => {
          setContactId(event.target.value); setContext(null); setDrafts([]); setLoading(Boolean(event.target.value));
          setError(null); setNotice(null);
        }}><option value="">Choisir un contact du CRM</option>
          {visibleContacts.map((person) => <option key={person.id} value={person.id}>
            {person.name}{person.verifiedTitle || person.inputTitle ? " · " + (person.verifiedTitle || person.inputTitle) : ""}
          </option>)}</select></label>
      </div>
      {!contactId ? <p className={styles.empty}>Aucun brouillon n’est créé automatiquement pour les collaborateurs. Sélectionnez la personne que vous souhaitez approcher.</p> : null}
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {notice ? <p role="status" className={styles.notice}>{notice}</p> : null}
      {contactId && context ? <div className={styles.context}>
        <strong>Contexte de {context.contact.name}</strong>
        <span>{context.contact.verifiedTitle || context.contact.inputTitle || "Fonction à confirmer"}</span>
        <span>{context.icps.filter((item) => item.associated).length} ICP lié(s) · {context.signals.length} signal(aux) récents · {context.organization.buying_roles.length} rôle(s) d’achat documenté(s)</span>
        {context.company.offer_hypothesis ? <p>Hypothèse de compte : {context.company.offer_hypothesis}</p> : null}
      </div> : null}

      {editor ? <form className={styles.form} onSubmit={(event) => void save(event)}>
        <div className={styles.formHeading}><strong>{editor.draftId ? "Modifier le brouillon" : "Nouvelle approche"}</strong>
          <button type="button" onClick={() => { setEditor(null); setError(null); }} disabled={busy}><X size={14} /> Fermer</button></div>
        <div className={styles.fields}>
          <label>ICP<select value={editor.fields.icp_id ?? ""} onChange={(event) => setEditor((current) => current ? {
            ...current, fields: { ...current.fields, icp_id: event.target.value || null, persona_id: null }
          } : current)}><option value="">ICP à définir</option>
            {context?.icps.map((item) => <option value={item.id} key={item.id}>{item.name}{item.associated ? " · lié au compte" : " · non qualifié"}</option>)}
          </select></label>
          <label>Persona<select value={editor.fields.persona_id ?? ""} disabled={!editor.fields.icp_id}
            onChange={(event) => change("persona_id", event.target.value || null)}><option value="">Persona à définir</option>
              {context?.personas.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
            </select></label>
          <label>Cas d’usage / campagne<select value={editor.fields.opportunity_id ?? ""}
            onChange={(event) => change("opportunity_id", event.target.value || null)}><option value="">À définir</option>
              {context?.opportunities.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
            </select></label>
          <label>Canal<select value={editor.fields.channel}
            onChange={(event) => change("channel", event.target.value as OutreachDraftFields["channel"])}>
              {channels.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select></label>
          <label className={styles.wide}>Angle à vérifier<textarea rows={3} maxLength={5_000} value={editor.fields.angle}
            onChange={(event) => change("angle", event.target.value)}
            placeholder="Pourquoi cette approche pourrait être pertinente pour cette personne ?" /></label>
          <label className={styles.wide}>Objet, si pertinent<input maxLength={300} value={editor.fields.subject}
            onChange={(event) => change("subject", event.target.value)} placeholder="Objet de l'e-mail" /></label>
          <label className={styles.wide}>Message<textarea required rows={8} maxLength={20_000} value={editor.fields.body}
            onChange={(event) => change("body", event.target.value)}
            placeholder="Rédigez ici avec ChatGPT ou Codex, puis relisez avant utilisation." /></label>
          <label className={styles.wide}>Appel à l’action<input maxLength={2_000} value={editor.fields.call_to_action}
            onChange={(event) => change("call_to_action", event.target.value)} placeholder="Ex. proposer un échange de 15 minutes" /></label>
          {context?.signals.length ? <fieldset className={styles.signalChoices}><legend>Signaux de l’entreprise utilisés</legend>
            {context.signals.map((signal) => <label key={signal.id}><input type="checkbox"
              checked={editor.fields.signal_ids.includes(signal.id)}
              onChange={(event) => change("signal_ids", event.target.checked
                ? [...editor.fields.signal_ids, signal.id]
                : editor.fields.signal_ids.filter((id) => id !== signal.id))} />{signal.title}
              <small>{signal.evidence_type} · {signal.readiness_dimension}</small></label>)}
            {editor.fields.signal_ids.filter((id) => !context.signals.some((signal) => signal.id === id)).map((id) =>
              <label key={id}><input type="checkbox" checked onChange={() =>
                change("signal_ids", editor.fields.signal_ids.filter((value) => value !== id))} />Signal plus ancien ({id})</label>)}
          </fieldset> : null}
          <label>État<select value={editor.fields.status}
            onChange={(event) => change("status", event.target.value as OutreachDraftFields["status"])}>
              <option value="draft">Brouillon</option><option value="ready">Prêt à relire</option>
              {editor.draftId ? <option value="archived">Archivé</option> : null}
            </select></label>
        </div>
        <div className={styles.formActions}><button type="submit" className={styles.primary} disabled={busy}>
          {busy ? <LoaderCircle className={styles.spin} size={15} /> : <Save size={15} />} Enregistrer ce brouillon
        </button></div>
      </form> : null}

      {contactId ? <div className={styles.listHeading}><strong>{loading ? "Chargement…" : total + " brouillon(s) pour cette personne"}</strong>
        <label><input type="checkbox" checked={includeArchived}
          onChange={(event) => { setLoading(true); setIncludeArchived(event.target.checked); }} /> Voir les archives</label></div> : null}
      {contactId && !loading && !drafts.length ? <p className={styles.empty}>Aucun brouillon pour cette personne.</p> : null}
      <div className={styles.cards}>{drafts.map((draft) => <article key={draft.id} className={styles.card}>
        <div className={styles.cardTop}><div className={styles.chips}><span>{channelLabels[draft.channel]}</span>
          <span>{statusLabels[draft.status]}</span>{draft.icp_name ? <span>{draft.icp_name}</span> : null}
          {draft.persona_label ? <span>{draft.persona_label}</span> : null}</div>
          <div className={styles.actions}>
            {draft.contact_id ? <button type="button" onClick={() => startEdit(draft)} disabled={busy || Boolean(editor)}>
              <Pencil size={13} /> Modifier</button> : null}
            {draft.contact_id ? <button type="button" onClick={() => void setArchived(draft, draft.status !== "archived")}
              disabled={busy || Boolean(editor)}>{draft.status === "archived" ? <RotateCcw size={13} /> : <Archive size={13} />}
              {draft.status === "archived" ? "Réactiver" : "Archiver"}</button> : null}
            <button type="button" onClick={() => void navigator.clipboard.writeText(draft.body).then(() =>
              setNotice("Message copié.")).catch(() => setError("Copie impossible."))}><ClipboardCopy size={13} /> Copier</button>
          </div></div>
        <h4>{draft.subject || "Approche " + channelLabels[draft.channel]}</h4>
        {draft.angle ? <p className={styles.angle}><strong>Angle à vérifier :</strong> {draft.angle}</p> : null}
        <p className={styles.body}>{draft.body}</p>
        {draft.call_to_action ? <p className={styles.cta}>Appel à l’action : {draft.call_to_action}</p> : null}
        <small>Pour {draft.contact_name} · version {draft.version} · {new Date(draft.updated_at).toLocaleDateString("fr-FR")}</small>
      </article>)}</div>
      {hasMore ? <button className={styles.more} type="button" disabled={busy} onClick={() => void loadMore()}>Voir les brouillons suivants</button> : null}
    </>}
  </section>;
}
