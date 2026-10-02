import * as z from "zod4";

export const COMPANY_SIGNAL_KINDS = [
  "job_posting", "article", "press_release", "company_announcement", "funding",
  "leadership_change", "product_launch", "website", "other"
] as const;
export const COMPANY_SIGNAL_DIMENSIONS = ["fit", "timing", "both", "unknown"] as const;
export const COMPANY_SIGNAL_EVIDENCE_TYPES = ["observed", "verified", "declared", "inferred", "unknown"] as const;
export const COMPANY_SIGNAL_FILE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;
export const COMPANY_SIGNAL_MAX_FILE_BYTES = 10 * 1024 * 1024;

const optionalText = (maximum: number) => z.string().trim().min(1).max(maximum).nullable();
const optionalUrl = z.url().max(2_048).refine((value) => ["http:", "https:"].includes(new URL(value).protocol),
  "Seules les URL HTTP et HTTPS sont acceptées.").nullable();

export const companySignalFieldsSchema = z.object({
  kind: z.enum(COMPANY_SIGNAL_KINDS),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(20_000),
  readiness_dimension: z.enum(COMPANY_SIGNAL_DIMENSIONS),
  interpretation: z.string().trim().max(10_000),
  evidence_type: z.enum(COMPANY_SIGNAL_EVIDENCE_TYPES),
  source_reference: optionalText(2_048),
  source_url: optionalUrl,
  published_at: z.iso.date().nullable(),
  observed_at: z.iso.date().nullable(),
  archived: z.boolean()
}).strict();

export const companySignalWriteSchema = z.object({
  signal_id: z.uuid().optional(),
  expected_version: z.number().int().min(1).optional(),
  idempotency_key: z.string().trim().min(1).max(240).optional(),
  signal: companySignalFieldsSchema
}).strict();

export type CompanySignalFields = z.infer<typeof companySignalFieldsSchema>;
export type CompanySignalWriteInput = z.infer<typeof companySignalWriteSchema>;

export type CompanySignalAttachment = {
  id: string;
  signal_id: string;
  file_name: string;
  mime_type: typeof COMPANY_SIGNAL_FILE_TYPES[number];
  size_bytes: number;
  sha256: string;
  created_at: string;
};

export type CompanySignal = CompanySignalFields & {
  id: string;
  company_id: string;
  version: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  attachments: CompanySignalAttachment[];
};

export type CompanySignalPage = { items: CompanySignal[]; total: number; limit: number; offset: number; has_more: boolean };
