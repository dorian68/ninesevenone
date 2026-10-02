import * as z from "zod4";

import type { ProspectContact, ProspectObservation } from "./prospect-factory-crm-contract";
import type { CompanySignal } from "./company-signal-contract";
import type {
  AccountMapClaim, AccountMapEvidenceLink, AccountMapNode, AccountMapOpportunity,
  AccountMapRelation, AccountMapSource, AccountMapStakeholderRole
} from "./account-map-contract";

export const OUTREACH_CHANNELS = ["email", "linkedin_connection", "linkedin_message", "phone", "other"] as const;
export const OUTREACH_STATUSES = ["draft", "ready", "archived"] as const;

export const outreachDraftFieldsSchema = z.object({
  contact_id: z.uuid(),
  icp_id: z.uuid().nullable(),
  persona_id: z.uuid().nullable(),
  opportunity_id: z.uuid().nullable(),
  channel: z.enum(OUTREACH_CHANNELS),
  status: z.enum(OUTREACH_STATUSES),
  angle: z.string().trim().max(5_000),
  subject: z.string().trim().max(300),
  body: z.string().trim().min(1).max(20_000),
  call_to_action: z.string().trim().max(2_000),
  signal_ids: z.array(z.uuid()).max(25).refine((ids) => new Set(ids).size === ids.length, "Signal dupliqué.")
}).strict();

export const outreachDraftWriteSchema = z.object({
  draft_id: z.uuid().optional(),
  expected_version: z.number().int().min(1).optional(),
  idempotency_key: z.string().trim().min(1).max(240).optional(),
  draft: outreachDraftFieldsSchema
}).strict();

export type OutreachDraftFields = z.infer<typeof outreachDraftFieldsSchema>;
export type OutreachDraftWriteInput = z.infer<typeof outreachDraftWriteSchema>;
export type OutreachDraft = Omit<OutreachDraftFields, "contact_id"> & {
  id: string;
  company_id: string;
  contact_id: string | null;
  contact_name: string;
  contact_title: string | null;
  icp_name: string | null;
  persona_label: string | null;
  opportunity_name: string | null;
  version: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};
export type OutreachDraftPage = {
  items: OutreachDraft[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
};

export type OutreachContext = {
  company: {
    id: string; name: string; website: string | null;
    qualification_status: string;
    business_summary: string;
    offer_hypothesis: string;
  };
  contact: ProspectContact;
  icps: Array<{
    id: string; name: string; description: string;
    status: string; evidence_type: string; associated: boolean;
  }>;
  selected_icp: { id: string; name: string; description: string; status: string; evidence_type: string } | null;
  personas: Array<{ id: string; key: string; label: string; description: string }>;
  selected_persona: { id: string; key: string; label: string; description: string } | null;
  account_personas: Array<{ key: string; label: string; status: string; notes: string }>;
  opportunities: AccountMapOpportunity[];
  organization: {
    person: AccountMapNode | null;
    related_people: AccountMapNode[];
    relationships: AccountMapRelation[];
    buying_roles: AccountMapStakeholderRole[];
    claims: AccountMapClaim[];
    sources: AccountMapSource[];
    evidence: AccountMapEvidenceLink[];
  };
  signals: CompanySignal[];
  observations: ProspectObservation[];
  drafts: OutreachDraftPage;
};
