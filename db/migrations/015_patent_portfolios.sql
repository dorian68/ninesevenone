CREATE TABLE company_patent_families (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fingerprint CHAR(64) NOT NULL UNIQUE,
  family_docdb TEXT NOT NULL,
  family_inpadoc TEXT,
  applicant_names JSONB NOT NULL DEFAULT '[]'::jsonb,
  application_count INTEGER NOT NULL,
  application_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  first_publication_date DATE,
  first_application_date DATE,
  epo_application BOOLEAN,
  international_application BOOLEAN,
  granted BOOLEAN,
  first_grant_date DATE,
  title_fr TEXT,
  title_en TEXT,
  title_original TEXT,
  title_original_language TEXT,
  display_title TEXT,
  abstract_fr TEXT,
  abstract_en TEXT,
  abstract_original TEXT,
  abstract_original_language TEXT,
  display_abstract TEXT,
  technology_count INTEGER NOT NULL DEFAULT 0,
  scanr_url TEXT NOT NULL,
  scope TEXT NOT NULL,
  source_updated_at TIMESTAMPTZ NOT NULL,
  dataset_url TEXT NOT NULL,
  license_name TEXT NOT NULL,
  license_url TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL,
  UNIQUE (company_id, family_docdb)
);

CREATE TABLE company_patent_applications (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  family_id BIGINT NOT NULL REFERENCES company_patent_families(id) ON DELETE CASCADE,
  fingerprint CHAR(64) NOT NULL UNIQUE,
  source_row_number INTEGER NOT NULL,
  application_key TEXT NOT NULL,
  applicant_name TEXT,
  country_code TEXT,
  scope TEXT NOT NULL,
  application_date DATE,
  application_authority TEXT,
  ip_domain TEXT,
  publication_number TEXT,
  pct_number TEXT,
  publication_type TEXT,
  priority_claim BOOLEAN,
  publication_date DATE,
  grant_date DATE,
  application_title_language TEXT,
  application_title TEXT,
  source_updated_at TIMESTAMPTZ NOT NULL,
  dataset_url TEXT NOT NULL,
  license_name TEXT NOT NULL,
  license_url TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL,
  UNIQUE (company_id, application_key)
);

CREATE TABLE company_patent_technologies (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  family_id BIGINT NOT NULL REFERENCES company_patent_families(id) ON DELETE CASCADE,
  fingerprint CHAR(64) NOT NULL UNIQUE,
  level TEXT NOT NULL,
  code TEXT NOT NULL,
  label TEXT,
  source_updated_at TIMESTAMPTZ NOT NULL,
  dataset_url TEXT NOT NULL,
  license_name TEXT NOT NULL,
  license_url TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL,
  UNIQUE (company_id, family_id, level, code)
);

CREATE INDEX patent_families_company_date_idx
  ON company_patent_families (company_id, first_application_date DESC);

CREATE INDEX patent_families_granted_idx
  ON company_patent_families (granted, first_grant_date DESC);

CREATE INDEX patent_applications_company_date_idx
  ON company_patent_applications (company_id, application_date DESC);

CREATE INDEX patent_applications_family_idx
  ON company_patent_applications (family_id, application_date DESC);

CREATE INDEX patent_technologies_company_level_idx
  ON company_patent_technologies (company_id, level, code);
