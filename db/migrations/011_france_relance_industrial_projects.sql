CREATE TABLE company_france_relance_industrial_projects (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fingerprint CHAR(64) NOT NULL UNIQUE,
  source_row_number INTEGER NOT NULL,
  siret CHAR(14),
  beneficiary_identifier TEXT NOT NULL,
  identifier_type TEXT NOT NULL,
  match_scope TEXT NOT NULL,
  match_confidence NUMERIC(4,3) NOT NULL,
  project_location_scope TEXT NOT NULL,
  beneficiary_name TEXT NOT NULL,
  company_type TEXT,
  recovery_axis TEXT,
  measure TEXT NOT NULL,
  measure_label TEXT,
  project_description TEXT,
  sector TEXT,
  expected_co2_tonnes NUMERIC(18,3),
  update_date DATE,
  region TEXT,
  department TEXT,
  department_code TEXT,
  commune TEXT,
  postal_code TEXT,
  location GEOGRAPHY(POINT, 4326),
  resource_id UUID NOT NULL,
  resource_title TEXT NOT NULL,
  resource_url TEXT NOT NULL,
  resource_last_modified TIMESTAMPTZ,
  source_updated_at TIMESTAMPTZ NOT NULL,
  dataset_url TEXT NOT NULL,
  portal_url TEXT NOT NULL,
  license_name TEXT NOT NULL,
  license_url TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX company_france_relance_projects_company_date_idx
  ON company_france_relance_industrial_projects (company_id, update_date DESC);

CREATE INDEX company_france_relance_projects_siret_idx
  ON company_france_relance_industrial_projects (siret);

CREATE INDEX company_france_relance_projects_location_idx
  ON company_france_relance_industrial_projects USING GIST (location);

CREATE INDEX company_france_relance_projects_measure_idx
  ON company_france_relance_industrial_projects (measure);

CREATE INDEX company_france_relance_projects_sector_idx
  ON company_france_relance_industrial_projects (sector);
