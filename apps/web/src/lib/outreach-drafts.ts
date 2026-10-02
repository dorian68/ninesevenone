import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { getAccountMap } from "./account-map-db";
import { getCompanyIcps } from "./caraaios-mcp-icp";
import { listCompanySignals } from "./company-signals";
import {
  outreachDraftWriteSchema, type OutreachContext, type OutreachDraft,
  type OutreachDraftFields, type OutreachDraftPage, type OutreachDraftWriteInput
} from "./outreach-draft-contract";
import {
  getProspect, listAccountPersonas, listIcpPersonas, listIcps, withAccountMapDatabase
} from "./prospect-factory-crm-db";

type Row = Record<string, unknown>;

export class OutreachDraftError extends Error {
  constructor(message: string, public readonly code: "NOT_FOUND" | "CONFLICT" | "INVALID") {
    super(message);
    this.name = "OutreachDraftError";
  }
}

function ensureCompany(db: DatabaseSync, companyId: string) {
  if (!db.prepare("SELECT 1 FROM prospect_factory_prospects WHERE id=?").get(companyId)) {
    throw new OutreachDraftError("Société CRM introuvable.", "NOT_FOUND");
  }
}

function mapDraft(row: Row): OutreachDraft {
  return {
    id: String(row.id), company_id: String(row.prospect_id),
    contact_id: row.contact_id == null ? null : String(row.contact_id),
    contact_name: String(row.contact_name), contact_title: row.contact_title == null ? null : String(row.contact_title),
    icp_id: row.icp_id == null ? null : String(row.icp_id),
    icp_name: row.icp_name == null ? null : String(row.icp_name),
    persona_id: row.persona_id == null ? null : String(row.persona_id),
    persona_label: row.persona_label == null ? null : String(row.persona_label),
    opportunity_id: row.opportunity_id == null ? null : String(row.opportunity_id),
    opportunity_name: row.opportunity_name == null ? null : String(row.opportunity_name),
    channel: String(row.channel) as OutreachDraft["channel"],
    status: String(row.status) as OutreachDraft["status"],
    angle: String(row.angle), subject: String(row.subject), body: String(row.body),
    call_to_action: String(row.call_to_action),
    signal_ids: JSON.parse(String(row.signal_ids_json)) as string[],
    version: Number(row.version), created_by: String(row.created_by), updated_by: String(row.updated_by),
    created_at: String(row.created_at), updated_at: String(row.updated_at)
  };
}

function getDraftFromDb(db: DatabaseSync, companyId: string, draftId: string): OutreachDraft | null {
  const row = db.prepare("SELECT * FROM prospect_factory_outreach_drafts WHERE id=? AND prospect_id=?")
    .get(draftId, companyId) as Row | undefined;
  return row ? mapDraft(row) : null;
}

export function getOutreachDraft(companyId: string, draftId: string): OutreachDraft | null {
  return withAccountMapDatabase((db) => getDraftFromDb(db, companyId, draftId));
}

export function listOutreachDrafts(companyId: string, options: {
  contactId?: string; limit?: number; offset?: number; includeArchived?: boolean
} = {}): OutreachDraftPage {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 100_000) {
    throw new OutreachDraftError("Pagination des brouillons invalide.", "INVALID");
  }
  return withAccountMapDatabase((db) => {
    ensureCompany(db, companyId);
    const where = "prospect_id=?" + (options.contactId ? " AND contact_id=?" : "")
      + (options.includeArchived ? "" : " AND status<>'archived'");
    const args = options.contactId ? [companyId, options.contactId] : [companyId];
    const total = Number((db.prepare(`SELECT COUNT(*) AS total FROM prospect_factory_outreach_drafts WHERE ${where}`)
      .get(...args) as { total: number }).total);
    const rows = db.prepare(`SELECT * FROM prospect_factory_outreach_drafts WHERE ${where}
      ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as Row[];
    return { items: rows.map(mapDraft), total, limit, offset, has_more: offset + rows.length < total };
  });
}

function validateReferences(db: DatabaseSync, companyId: string, fields: OutreachDraftFields) {
  const contact = db.prepare(`SELECT id,name,COALESCE(verified_title,input_title) AS title
    FROM prospect_factory_contacts WHERE id=? AND prospect_id=?`)
    .get(fields.contact_id, companyId) as { id: string; name: string; title: string | null } | undefined;
  if (!contact) throw new OutreachDraftError("Cette personne n'appartient pas à la société.", "INVALID");
  const icp = fields.icp_id
    ? db.prepare("SELECT id,name FROM prospect_factory_icps WHERE id=?").get(fields.icp_id) as { id: string; name: string } | undefined
    : null;
  if (fields.icp_id && !icp) throw new OutreachDraftError("ICP introuvable.", "INVALID");
  if (fields.persona_id && !fields.icp_id) {
    throw new OutreachDraftError("Choisissez l'ICP associé à ce persona.", "INVALID");
  }
  const persona = fields.persona_id
    ? db.prepare("SELECT id,icp_id,label FROM prospect_factory_icp_personas WHERE id=?")
      .get(fields.persona_id) as { id: string; icp_id: string; label: string } | undefined
    : null;
  if (fields.persona_id && (!persona || persona.icp_id !== fields.icp_id)) {
    throw new OutreachDraftError("Ce persona n'appartient pas à l'ICP choisi.", "INVALID");
  }
  const opportunity = fields.opportunity_id
    ? db.prepare("SELECT id,name FROM prospect_factory_map_opportunities WHERE id=? AND prospect_id=?")
      .get(fields.opportunity_id, companyId) as { id: string; name: string } | undefined
    : null;
  if (fields.opportunity_id && !opportunity) {
    throw new OutreachDraftError("Ce cas d'usage n'appartient pas à la société.", "INVALID");
  }
  for (const signalId of fields.signal_ids) {
    if (!db.prepare("SELECT 1 FROM prospect_factory_company_signals WHERE id=? AND prospect_id=?")
      .get(signalId, companyId)) {
      throw new OutreachDraftError("Un signal cité n'appartient pas à la société.", "INVALID");
    }
  }
  if (fields.status === "ready" && fields.channel === "email" && !fields.subject) {
    throw new OutreachDraftError("Un e-mail prêt à relire doit avoir un objet.", "INVALID");
  }
  return { contact, icp, persona, opportunity };
}

function sameFields(existing: OutreachDraft, fields: OutreachDraftFields) {
  return existing.contact_id === fields.contact_id && existing.icp_id === fields.icp_id
    && existing.persona_id === fields.persona_id && existing.opportunity_id === fields.opportunity_id
    && existing.channel === fields.channel && existing.status === fields.status && existing.angle === fields.angle
    && existing.subject === fields.subject && existing.body === fields.body
    && existing.call_to_action === fields.call_to_action
    && JSON.stringify(existing.signal_ids) === JSON.stringify(fields.signal_ids);
}

export function upsertOutreachDraft(companyId: string, raw: OutreachDraftWriteInput, actor: string) {
  const input = outreachDraftWriteSchema.parse(raw);
  if (input.draft_id && !input.expected_version) {
    throw new OutreachDraftError("La version actuelle est requise pour modifier un brouillon.", "INVALID");
  }
  if (!input.draft_id && input.expected_version) {
    throw new OutreachDraftError("Une version ne peut être fournie que pour une modification.", "INVALID");
  }
  if (!actor.trim() || actor.length > 100) throw new OutreachDraftError("Auteur invalide.", "INVALID");
  return withAccountMapDatabase((db) => {
    let savedId: string | null = null;
    let savedOutcome: "created" | "updated" | "unchanged" = "unchanged";
    db.exec("BEGIN IMMEDIATE");
    try {
      ensureCompany(db, companyId);
      const fields = input.draft;
      const labels = validateReferences(db, companyId, fields);
      const timestamp = new Date().toISOString();
      if (input.draft_id) {
        const old = getDraftFromDb(db, companyId, input.draft_id);
        if (!old) throw new OutreachDraftError("Brouillon introuvable dans cette société.", "NOT_FOUND");
        if (old.version !== input.expected_version) {
          throw new OutreachDraftError("Ce brouillon a changé depuis son ouverture. Votre texte reste dans le formulaire.", "CONFLICT");
        }
        if (old.contact_id !== fields.contact_id) {
          throw new OutreachDraftError("Pour cibler une autre personne, créez un nouveau brouillon.", "INVALID");
        }
        savedId = old.id;
        if (!sameFields(old, fields)) {
          db.prepare(`INSERT INTO prospect_factory_outreach_draft_revisions
            (id,draft_id,previous_version,snapshot_json,actor,created_at) VALUES (?,?,?,?,?,?)`)
            .run(randomUUID(), old.id, old.version, JSON.stringify(old), actor, timestamp);
          db.prepare(`UPDATE prospect_factory_outreach_drafts SET
            icp_id=?,icp_name=?,persona_id=?,persona_label=?,opportunity_id=?,opportunity_name=?,
            channel=?,status=?,angle=?,subject=?,body=?,call_to_action=?,signal_ids_json=?,
            version=version+1,updated_by=?,updated_at=? WHERE id=? AND prospect_id=?`)
            .run(fields.icp_id, labels.icp?.name ?? null, fields.persona_id, labels.persona?.label ?? null,
              fields.opportunity_id, labels.opportunity?.name ?? null, fields.channel, fields.status,
              fields.angle, fields.subject, fields.body, fields.call_to_action, JSON.stringify(fields.signal_ids),
              actor, timestamp, old.id, companyId);
          savedOutcome = "updated";
        }
      } else {
        const replay = input.idempotency_key
          ? db.prepare("SELECT id FROM prospect_factory_outreach_drafts WHERE prospect_id=? AND idempotency_key=?")
            .get(companyId, input.idempotency_key) as { id: string } | undefined
          : undefined;
        if (replay) {
          const old = getDraftFromDb(db, companyId, replay.id)!;
          if (!sameFields(old, fields)) {
            throw new OutreachDraftError("Cette clé d'idempotence désigne un autre contenu.", "CONFLICT");
          }
          savedId = old.id;
        } else {
          savedId = randomUUID();
          db.prepare(`INSERT INTO prospect_factory_outreach_drafts
            (id,prospect_id,contact_id,contact_name,contact_title,icp_id,icp_name,persona_id,persona_label,
             opportunity_id,opportunity_name,channel,status,angle,subject,body,call_to_action,signal_ids_json,
             idempotency_key,version,created_by,updated_by,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`)
            .run(savedId, companyId, fields.contact_id, labels.contact.name, labels.contact.title,
              fields.icp_id, labels.icp?.name ?? null, fields.persona_id, labels.persona?.label ?? null,
              fields.opportunity_id, labels.opportunity?.name ?? null, fields.channel, fields.status,
              fields.angle, fields.subject, fields.body, fields.call_to_action, JSON.stringify(fields.signal_ids),
              input.idempotency_key ?? null, actor, actor, timestamp, timestamp);
          savedOutcome = "created";
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { draft: getDraftFromDb(db, companyId, savedId!)!, outcome: savedOutcome };
  });
}

/** Compact, person-specific projection for ChatGPT/Codex and the same CRM UI. */
export function getOutreachContext(companyId: string, contactId: string, options: {
  icpId?: string | null; personaId?: string | null; opportunityId?: string | null; signalLimit?: number
} = {}): OutreachContext {
  const company = getProspect(companyId);
  if (!company) throw new OutreachDraftError("Société CRM introuvable.", "NOT_FOUND");
  const contact = company.contacts.find((item) => item.id === contactId);
  if (!contact) throw new OutreachDraftError("Cette personne n'appartient pas à la société.", "NOT_FOUND");
  const signalLimit = options.signalLimit ?? 30;
  if (!Number.isInteger(signalLimit) || signalLimit < 1 || signalLimit > 50) {
    throw new OutreachDraftError("Nombre de signaux invalide.", "INVALID");
  }
  const associations = getCompanyIcps(companyId)?.associations ?? [];
  const associationById = new Map(associations.map((item) => [item.icpId, item]));
  const icps = listIcps().map((item) => {
    const association = associationById.get(item.id);
    return { id: item.id, name: item.name, description: item.description,
      status: association?.status ?? "unknown", evidence_type: association?.evidenceType ?? "unknown",
      associated: Boolean(association) };
  });
  const selectedIcp = options.icpId ? icps.find((item) => item.id === options.icpId) : null;
  if (options.icpId && !selectedIcp) throw new OutreachDraftError("ICP introuvable.", "INVALID");
  const personas = selectedIcp ? listIcpPersonas(selectedIcp.id).map((item) => ({
    id: item.id, key: item.key, label: item.label, description: item.description
  })) : [];
  const selectedPersona = options.personaId ? personas.find((item) => item.id === options.personaId) : null;
  if (options.personaId && !selectedPersona) {
    throw new OutreachDraftError("Ce persona n'appartient pas à l'ICP choisi.", "INVALID");
  }
  const map = getAccountMap(companyId);
  if (!map) throw new OutreachDraftError("Cartographie de la société introuvable.", "NOT_FOUND");
  const selectedOpportunity = options.opportunityId
    ? map.opportunities.find((item) => item.id === options.opportunityId) : null;
  if (options.opportunityId && !selectedOpportunity) {
    throw new OutreachDraftError("Ce cas d'usage n'appartient pas à la société.", "INVALID");
  }
  const person = map.nodes.find((node) => node.kind === "person" && node.contactId === contactId) ?? null;
  const relationships = person ? map.relations.filter((item) =>
    item.fromNodeId === person.id || item.toNodeId === person.id).slice(0, 30) : [];
  const relatedIds = new Set(relationships.flatMap((item) => [item.fromNodeId, item.toNodeId]));
  relatedIds.delete(person?.id ?? "");
  const relatedPeople = map.nodes.filter((node) => relatedIds.has(node.id));
  const buyingRoles = person ? map.stakeholderRoles.filter((role) => role.personNodeId === person.id) : [];
  const root = map.nodes.find((node) => node.isRoot);
  const claims = map.claims.filter((claim) =>
    claim.subjectNodeId === person?.id || claim.subjectNodeId === root?.id).slice(0, 30);
  const subjectIds = new Set([...relationships.map((item) => item.id), ...buyingRoles.map((item) => item.id),
    ...claims.map((item) => item.id)]);
  const evidence = map.evidenceLinks.filter((link) => subjectIds.has(link.subjectId));
  const sourceIds = new Set([
    ...evidence.map((item) => item.sourceId),
    ...relationships.flatMap((item) => item.sourceIds),
    ...buyingRoles.flatMap((item) => item.sourceIds),
    ...claims.flatMap((item) => item.sourceIds)
  ]);
  return {
    company: {
      id: company.id, name: company.snapshot.commercialName || company.snapshot.companyName,
      website: company.enrichment.website ?? company.snapshot.website,
      qualification_status: company.qualification.status,
      business_summary: company.research.businessSummary ?? "",
      offer_hypothesis: company.research.offerHypothesis ?? ""
    },
    contact,
    icps,
    selected_icp: selectedIcp ? { id: selectedIcp.id, name: selectedIcp.name,
      description: selectedIcp.description, status: selectedIcp.status,
      evidence_type: selectedIcp.evidence_type } : null,
    personas, selected_persona: selectedPersona ?? null,
    account_personas: listAccountPersonas(companyId).filter((slot) => slot.contactId === contactId)
      .map((slot) => ({ key: slot.key, label: slot.label, status: slot.status, notes: slot.notes })),
    opportunities: map.opportunities,
    organization: { person, related_people: relatedPeople, relationships,
      buying_roles: buyingRoles, claims, sources: map.sources.filter((item) => sourceIds.has(item.id)), evidence },
    signals: listCompanySignals(companyId, { limit: signalLimit }).items,
    observations: company.observations.slice(0, 30),
    drafts: listOutreachDrafts(companyId, { contactId, limit: 30 })
  };
}
