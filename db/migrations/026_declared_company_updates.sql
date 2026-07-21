-- Approved company edits remain declared enrichments and never overwrite SIRENE facts.
ALTER TABLE company_update_requests
  ADD COLUMN IF NOT EXISTS claim_id BIGINT REFERENCES company_claims(id),
  ADD COLUMN IF NOT EXISTS professional_email TEXT,
  ADD COLUMN IF NOT EXISTS review_note TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by BIGINT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS company_update_requests_status_idx ON company_update_requests(status, created_at DESC);

CREATE TABLE IF NOT EXISTS company_declared_overrides (
  company_id BIGINT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  request_id BIGINT NOT NULL REFERENCES company_update_requests(id),
  site_web TEXT,
  telephone_public TEXT,
  email_public TEXT,
  opening_hours_public TEXT,
  description_courte TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE company_update_requests IS 'Propositions déclarées par un représentant, jamais une écriture des faits officiels.';
COMMENT ON TABLE company_declared_overrides IS 'Enrichissements déclarés approuvés, séparés des colonnes SIRENE et historisés par request_id.';
