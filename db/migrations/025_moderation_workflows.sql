-- User-submitted moderation data is kept separate from official SIRENE/enrichment facts.
-- Production deployments should bind claimant_id/reviewer_id to users.id and encrypt
-- contact fields at rest according to the chosen authentication provider.

CREATE TABLE IF NOT EXISTS company_reports (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('factual_error', 'personal_data', 'closed', 'other')),
  message TEXT NOT NULL,
  contact_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
  review_note TEXT,
  reviewed_by BIGINT REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_reports_queue_idx ON company_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS company_reports_company_idx ON company_reports(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS company_verification_overrides (
  company_id BIGINT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  verified BOOLEAN NOT NULL DEFAULT false,
  claim_id BIGINT REFERENCES company_claims(id),
  verified_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_claims_queue_idx ON company_claims(status, created_at DESC);
CREATE INDEX IF NOT EXISTS company_update_requests_queue_idx ON company_update_requests(status, created_at DESC);
