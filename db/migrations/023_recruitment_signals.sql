CREATE TABLE company_recruitment_signals (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_offer_id TEXT NOT NULL,
  title TEXT NOT NULL,
  contract TEXT,
  location TEXT,
  created_at_source TIMESTAMPTZ,
  updated_at_source TIMESTAMPTZ,
  duration TEXT,
  experience TEXT,
  source_url TEXT NOT NULL,
  match_method TEXT NOT NULL DEFAULT 'exact_siren_or_siret',
  retrieved_at TIMESTAMPTZ NOT NULL,
  UNIQUE(company_id, source_offer_id)
);

CREATE INDEX company_recruitment_signals_company_date_idx
  ON company_recruitment_signals(company_id, updated_at_source DESC);
