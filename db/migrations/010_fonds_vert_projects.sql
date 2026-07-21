CREATE TABLE company_fonds_vert_projects (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fingerprint CHAR(64) NOT NULL UNIQUE,
  source_row_number INTEGER NOT NULL,
  year INTEGER NOT NULL,
  siret CHAR(14),
  beneficiary_identifier TEXT NOT NULL,
  identifier_type TEXT NOT NULL,
  match_scope TEXT NOT NULL,
  match_confidence NUMERIC(4,3) NOT NULL,
  project_location_scope TEXT NOT NULL,
  project_name TEXT NOT NULL,
  project_summary TEXT,
  committed_amount NUMERIC(18,2) NOT NULL,
  beneficiary_name TEXT NOT NULL,
  beneficiary_legal_form TEXT,
  dossier_number TEXT,
  commitment_number TEXT,
  operator_number TEXT,
  operator TEXT,
  scheme TEXT,
  axis TEXT,
  region TEXT,
  department TEXT,
  department_code TEXT,
  commune TEXT,
  commune_code TEXT,
  resource_id UUID NOT NULL,
  resource_title TEXT NOT NULL,
  resource_url TEXT NOT NULL,
  resource_last_modified TIMESTAMPTZ,
  source_updated_at TIMESTAMPTZ NOT NULL,
  dataset_url TEXT NOT NULL,
  license_name TEXT NOT NULL,
  license_url TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX company_fonds_vert_projects_company_year_idx
  ON company_fonds_vert_projects (company_id, year DESC);

CREATE INDEX company_fonds_vert_projects_siret_idx
  ON company_fonds_vert_projects (siret);

CREATE INDEX company_fonds_vert_projects_location_idx
  ON company_fonds_vert_projects (project_location_scope, commune_code);

CREATE INDEX company_fonds_vert_projects_scheme_idx
  ON company_fonds_vert_projects (scheme);
