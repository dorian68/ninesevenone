CREATE TABLE company_ademe_financial_aids (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fingerprint CHAR(64) NOT NULL UNIQUE,
  source_row_number INTEGER NOT NULL,
  siret CHAR(14) NOT NULL,
  match_scope TEXT NOT NULL,
  match_confidence NUMERIC(4,3) NOT NULL,
  awarding_authority TEXT,
  awarding_authority_siret CHAR(14),
  convention_date DATE,
  decision_reference TEXT,
  beneficiary_name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  aid_scheme TEXT,
  amount NUMERIC(18,2) NOT NULL,
  nature TEXT,
  payment_conditions TEXT,
  payment_period TEXT,
  rae_id TEXT,
  eu_notification BOOLEAN,
  source_updated_at TIMESTAMPTZ NOT NULL,
  source_url TEXT NOT NULL,
  data_gouv_url TEXT NOT NULL,
  license_name TEXT NOT NULL,
  license_url TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX company_ademe_financial_aids_company_date_idx
  ON company_ademe_financial_aids (company_id, convention_date DESC);

CREATE INDEX company_ademe_financial_aids_siret_idx
  ON company_ademe_financial_aids (siret);

CREATE INDEX company_ademe_financial_aids_scope_idx
  ON company_ademe_financial_aids (match_scope);

CREATE INDEX company_ademe_financial_aids_scheme_idx
  ON company_ademe_financial_aids (aid_scheme);
