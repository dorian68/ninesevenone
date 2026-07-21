CREATE TABLE company_public_grants (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fingerprint CHAR(64) NOT NULL UNIQUE,
  siret CHAR(14),
  rna_id TEXT,
  match_method TEXT NOT NULL,
  match_confidence NUMERIC(4,3) NOT NULL,
  beneficiary_name TEXT NOT NULL,
  awarding_authority TEXT,
  awarding_authority_siret CHAR(14),
  convention_date DATE,
  decision_reference TEXT,
  purpose TEXT NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  nature TEXT,
  payment_conditions TEXT,
  payment_period TEXT,
  rae_id TEXT,
  eu_notification BOOLEAN,
  subsidy_percentage NUMERIC(8,4),
  aid_scheme TEXT,
  source_reference_date DATE,
  imported_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE public_grant_occurrences (
  id BIGSERIAL PRIMARY KEY,
  grant_id BIGINT NOT NULL REFERENCES company_public_grants(id) ON DELETE CASCADE,
  dataset_id TEXT NOT NULL,
  dataset_title TEXT,
  dataset_url TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  resource_title TEXT,
  resource_url TEXT NOT NULL,
  source_row_number INTEGER NOT NULL,
  source_last_modified TIMESTAMPTZ,
  license_code TEXT NOT NULL,
  license_name TEXT NOT NULL,
  license_url TEXT NOT NULL,
  UNIQUE (grant_id, resource_id, source_row_number)
);

CREATE INDEX company_public_grants_company_date_idx
  ON company_public_grants (company_id, convention_date DESC);

CREATE INDEX company_public_grants_siret_idx
  ON company_public_grants (siret);

CREATE INDEX company_public_grants_rna_idx
  ON company_public_grants (rna_id);

CREATE INDEX company_public_grants_authority_idx
  ON company_public_grants (awarding_authority_siret);

CREATE INDEX public_grant_occurrences_resource_idx
  ON public_grant_occurrences (resource_id);
