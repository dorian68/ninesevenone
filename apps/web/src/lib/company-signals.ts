import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  COMPANY_SIGNAL_FILE_TYPES, COMPANY_SIGNAL_MAX_FILE_BYTES,
  companySignalWriteSchema,
  type CompanySignal, type CompanySignalAttachment, type CompanySignalFields,
  type CompanySignalPage, type CompanySignalWriteInput
} from "./company-signal-contract";
import { withAccountMapDatabase } from "./prospect-factory-crm-db";

type Row = Record<string, unknown>;

export class CompanySignalError extends Error {
  constructor(message: string, public readonly code: "NOT_FOUND" | "CONFLICT" | "INVALID") {
    super(message);
    this.name = "CompanySignalError";
  }
}

function ensureCompany(db: DatabaseSync, companyId: string) {
  if (!db.prepare("SELECT 1 FROM prospect_factory_prospects WHERE id=?").get(companyId)) {
    throw new CompanySignalError("Société CRM introuvable.", "NOT_FOUND");
  }
}

function attachmentsFor(db: DatabaseSync, signalIds: string[]): Map<string, CompanySignalAttachment[]> {
  const result = new Map<string, CompanySignalAttachment[]>(signalIds.map((id) => [id, []]));
  if (!signalIds.length) return result;
  const placeholders = signalIds.map(() => "?").join(",");
  const rows = db.prepare(`SELECT id,signal_id,file_name,mime_type,size_bytes,sha256,created_at
    FROM prospect_factory_company_signal_attachments WHERE signal_id IN (${placeholders})
    ORDER BY created_at,id`).all(...signalIds) as Row[];
  for (const row of rows) {
    result.get(String(row.signal_id))?.push({
      id: String(row.id), signal_id: String(row.signal_id), file_name: String(row.file_name),
      mime_type: String(row.mime_type) as CompanySignalAttachment["mime_type"],
      size_bytes: Number(row.size_bytes), sha256: String(row.sha256), created_at: String(row.created_at)
    });
  }
  return result;
}

function mapSignal(row: Row, attachments: CompanySignalAttachment[]): CompanySignal {
  return {
    id: String(row.id), company_id: String(row.prospect_id),
    kind: String(row.kind) as CompanySignal["kind"], title: String(row.title),
    description: String(row.description), readiness_dimension: String(row.readiness_dimension) as CompanySignal["readiness_dimension"],
    interpretation: String(row.interpretation), evidence_type: String(row.evidence_type) as CompanySignal["evidence_type"],
    source_reference: row.source_reference === null ? null : String(row.source_reference),
    source_url: row.source_url === null ? null : String(row.source_url),
    published_at: row.published_at === null ? null : String(row.published_at),
    observed_at: row.observed_at === null ? null : String(row.observed_at),
    archived: row.archived_at !== null, archived_at: row.archived_at === null ? null : String(row.archived_at),
    version: Number(row.version), created_by: String(row.created_by), updated_by: String(row.updated_by),
    created_at: String(row.created_at), updated_at: String(row.updated_at), attachments
  };
}

function getSignalRow(db: DatabaseSync, companyId: string, signalId: string): Row | null {
  return db.prepare("SELECT * FROM prospect_factory_company_signals WHERE id=? AND prospect_id=?")
    .get(signalId, companyId) as Row | undefined ?? null;
}

function getSignalFromDb(db: DatabaseSync, companyId: string, signalId: string): CompanySignal | null {
  const row = getSignalRow(db, companyId, signalId);
  if (!row) return null;
  return mapSignal(row, attachmentsFor(db, [signalId]).get(signalId) ?? []);
}

export function getCompanySignal(companyId: string, signalId: string): CompanySignal | null {
  return withAccountMapDatabase((db) => getSignalFromDb(db, companyId, signalId));
}

export function listCompanySignals(companyId: string, options: { limit?: number; offset?: number; includeArchived?: boolean } = {}): CompanySignalPage {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 100_000) {
    throw new CompanySignalError("Pagination des signaux invalide.", "INVALID");
  }
  return withAccountMapDatabase((db) => {
    ensureCompany(db, companyId);
    const activeClause = options.includeArchived ? "" : "AND archived_at IS NULL";
    const total = Number((db.prepare(`SELECT COUNT(*) AS total FROM prospect_factory_company_signals WHERE prospect_id=? ${activeClause}`)
      .get(companyId) as { total: number }).total);
    const rows = db.prepare(`SELECT * FROM prospect_factory_company_signals WHERE prospect_id=? ${activeClause}
      ORDER BY COALESCE(observed_at,published_at,substr(created_at,1,10)) DESC, created_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(companyId, limit, offset) as Row[];
    const ids = rows.map((row) => String(row.id));
    const attachments = attachmentsFor(db, ids);
    return { items: rows.map((row) => mapSignal(row, attachments.get(String(row.id)) ?? [])),
      total, limit, offset, has_more: offset + rows.length < total };
  });
}

function sameFields(signal: CompanySignal, fields: CompanySignalFields): boolean {
  return signal.kind === fields.kind && signal.title === fields.title && signal.description === fields.description
    && signal.readiness_dimension === fields.readiness_dimension && signal.interpretation === fields.interpretation
    && signal.evidence_type === fields.evidence_type && signal.source_reference === fields.source_reference
    && signal.source_url === fields.source_url && signal.published_at === fields.published_at
    && signal.observed_at === fields.observed_at && signal.archived === fields.archived;
}

export function upsertCompanySignal(companyId: string, raw: CompanySignalWriteInput, actor: string) {
  const input = companySignalWriteSchema.parse(raw);
  if (["observed", "verified", "declared"].includes(input.signal.evidence_type)
    && !input.signal.source_url && !input.signal.source_reference) {
    throw new CompanySignalError("Une information observée ou confirmée exige un lien ou une référence de source.", "INVALID");
  }
  if (input.signal_id && !input.expected_version) {
    throw new CompanySignalError("La version actuelle est requise pour modifier un signal.", "INVALID");
  }
  if (!input.signal_id && input.expected_version) {
    throw new CompanySignalError("Une version ne peut être fournie que pour modifier un signal.", "INVALID");
  }
  if (!actor.trim() || actor.length > 100) throw new CompanySignalError("Auteur invalide.", "INVALID");
  return withAccountMapDatabase((db) => {
    ensureCompany(db, companyId);
    let savedId: string | null = null;
    let savedOutcome: "created" | "updated" | "unchanged" = "unchanged";
    db.exec("BEGIN IMMEDIATE");
    try {
      const fields = input.signal;
      const timestamp = new Date().toISOString();
      let signalId = input.signal_id;
      let outcome: "created" | "updated" | "unchanged";
      if (signalId) {
        const old = getSignalFromDb(db, companyId, signalId);
        if (!old) throw new CompanySignalError("Signal introuvable dans cette société.", "NOT_FOUND");
        if (old.version !== input.expected_version) {
          throw new CompanySignalError("Ce signal a changé depuis son ouverture. Vos modifications sont conservées dans le formulaire.", "CONFLICT");
        }
        if (sameFields(old, fields)) outcome = "unchanged";
        else {
          db.prepare(`INSERT INTO prospect_factory_company_signal_revisions
            (id,signal_id,previous_version,snapshot_json,actor,created_at) VALUES (?,?,?,?,?,?)`)
            .run(randomUUID(), signalId, old.version, JSON.stringify(old), actor, timestamp);
          db.prepare(`UPDATE prospect_factory_company_signals SET
            kind=?,title=?,description=?,readiness_dimension=?,interpretation=?,evidence_type=?,
            source_reference=?,source_url=?,published_at=?,observed_at=?,archived_at=?,
            version=version+1,updated_by=?,updated_at=? WHERE id=? AND prospect_id=?`)
            .run(fields.kind, fields.title, fields.description, fields.readiness_dimension,
              fields.interpretation, fields.evidence_type, fields.source_reference, fields.source_url,
              fields.published_at, fields.observed_at, fields.archived ? old.archived_at ?? timestamp : null,
              actor, timestamp, signalId, companyId);
          outcome = "updated";
        }
      } else {
        const existingRow = input.idempotency_key
          ? db.prepare("SELECT id FROM prospect_factory_company_signals WHERE prospect_id=? AND idempotency_key=?")
            .get(companyId, input.idempotency_key) as { id: string } | undefined
          : db.prepare(`SELECT id FROM prospect_factory_company_signals WHERE prospect_id=? AND kind=? AND title=?
              AND description=? AND COALESCE(source_url,'')=COALESCE(?,'') AND archived_at IS NULL LIMIT 1`)
            .get(companyId, fields.kind, fields.title, fields.description, fields.source_url) as { id: string } | undefined;
        if (existingRow) {
          signalId = existingRow.id;
          const existing = getSignalFromDb(db, companyId, signalId)!;
          if (!sameFields(existing, fields)) {
            throw new CompanySignalError("Ce signal existe déjà avec des données différentes ; utilisez son identifiant et sa version pour le modifier.", "CONFLICT");
          }
          outcome = "unchanged";
        } else {
          signalId = randomUUID();
          db.prepare(`INSERT INTO prospect_factory_company_signals
            (id,prospect_id,kind,title,description,readiness_dimension,interpretation,evidence_type,
             source_reference,source_url,published_at,observed_at,archived_at,idempotency_key,version,
             created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`)
            .run(signalId, companyId, fields.kind, fields.title, fields.description,
              fields.readiness_dimension, fields.interpretation, fields.evidence_type,
              fields.source_reference, fields.source_url, fields.published_at, fields.observed_at,
              fields.archived ? timestamp : null, input.idempotency_key ?? null,
              actor, actor, timestamp, timestamp);
          outcome = "created";
        }
      }
      savedId = signalId!;
      savedOutcome = outcome;
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { signal: getSignalFromDb(db, companyId, savedId!)!, outcome: savedOutcome };
  });
}

function fileMatchesMime(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === "application/pdf") return bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString("ascii") === "%PDF-";
  if (mimeType === "image/png") return bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mimeType === "image/webp") return bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF"
    && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP";
  return false;
}

export function decodeSignalAttachmentBase64(content: string): Buffer {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(content) || content.length > Math.ceil(COMPANY_SIGNAL_MAX_FILE_BYTES / 3) * 4 + 4) {
    throw new CompanySignalError("Pièce jointe Base64 invalide ou trop volumineuse.", "INVALID");
  }
  const bytes = Buffer.from(content, "base64");
  if (!bytes.length || bytes.length > COMPANY_SIGNAL_MAX_FILE_BYTES || bytes.toString("base64") !== content) {
    throw new CompanySignalError("Pièce jointe Base64 invalide ou trop volumineuse.", "INVALID");
  }
  return bytes;
}

export function addCompanySignalAttachment(companyId: string, signalId: string,
  input: { fileName: string; mimeType: string; bytes: Uint8Array }, actor: string) {
  const fileName = input.fileName.replace(/[\\/\u0000-\u001f\u007f]/g, "_").trim();
  if (!fileName || fileName.length > 255) throw new CompanySignalError("Nom de fichier invalide.", "INVALID");
  if (!(COMPANY_SIGNAL_FILE_TYPES as readonly string[]).includes(input.mimeType)
    || !input.bytes.length || input.bytes.length > COMPANY_SIGNAL_MAX_FILE_BYTES
    || !fileMatchesMime(input.bytes, input.mimeType)) {
    throw new CompanySignalError("Seuls les PDF, PNG, JPEG et WebP de 10 Mo maximum sont acceptés.", "INVALID");
  }
  if (!actor.trim() || actor.length > 100) throw new CompanySignalError("Auteur invalide.", "INVALID");
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  return withAccountMapDatabase((db) => {
    if (!getSignalRow(db, companyId, signalId)) throw new CompanySignalError("Signal introuvable dans cette société.", "NOT_FOUND");
    let savedId: string | null = null;
    let wasCreated = false;
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing = db.prepare(`SELECT id FROM prospect_factory_company_signal_attachments WHERE signal_id=? AND sha256=?`)
        .get(signalId, sha256) as { id: string } | undefined;
      const id = existing?.id ?? randomUUID();
      savedId = id;
      wasCreated = !existing;
      if (!existing) db.prepare(`INSERT INTO prospect_factory_company_signal_attachments
        (id,signal_id,file_name,mime_type,size_bytes,sha256,data,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(id, signalId, fileName, input.mimeType, input.bytes.length, sha256,
          Buffer.from(input.bytes), actor, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    const attachment = attachmentsFor(db, [signalId]).get(signalId)?.find((item) => item.id === savedId);
    return { attachment: attachment!, created: wasCreated };
  });
}

export function getCompanySignalAttachment(companyId: string, signalId: string, attachmentId: string) {
  return withAccountMapDatabase((db) => {
    const row = db.prepare(`SELECT a.id,a.signal_id,a.file_name,a.mime_type,a.size_bytes,a.sha256,a.created_at,a.data
      FROM prospect_factory_company_signal_attachments a JOIN prospect_factory_company_signals s ON s.id=a.signal_id
      WHERE s.prospect_id=? AND s.id=? AND a.id=?`).get(companyId, signalId, attachmentId) as Row | undefined;
    if (!row) return null;
    return {
      attachment: { id: String(row.id), signal_id: String(row.signal_id), file_name: String(row.file_name),
        mime_type: String(row.mime_type) as CompanySignalAttachment["mime_type"], size_bytes: Number(row.size_bytes),
        sha256: String(row.sha256), created_at: String(row.created_at) } satisfies CompanySignalAttachment,
      bytes: Buffer.from(row.data as Uint8Array)
    };
  });
}
