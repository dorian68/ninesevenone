CREATE TABLE IF NOT EXISTS company_icpe_installations (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  establishment_id BIGINT REFERENCES establishments(id) ON DELETE SET NULL,
  fingerprint CHAR(64) NOT NULL UNIQUE,
  aiot_code CHAR(10) NOT NULL UNIQUE,
  siret CHAR(14) NOT NULL,
  match_scope TEXT NOT NULL,
  address_line_1 TEXT,
  address_line_2 TEXT,
  address_line_3 TEXT,
  postal_code TEXT,
  commune_code TEXT,
  commune TEXT,
  naf_division TEXT,
  longitude DOUBLE PRECISION,
  latitude DOUBLE PRECISION,
  geom GEOGRAPHY(Point, 4326),
  has_cattle BOOLEAN NOT NULL DEFAULT false,
  has_pigs BOOLEAN NOT NULL DEFAULT false,
  has_poultry BOOLEAN NOT NULL DEFAULT false,
  is_quarry BOOLEAN NOT NULL DEFAULT false,
  is_wind_farm BOOLEAN NOT NULL DEFAULT false,
  is_industry BOOLEAN NOT NULL DEFAULT false,
  national_priority BOOLEAN NOT NULL DEFAULT false,
  seveso_status TEXT,
  ied BOOLEAN NOT NULL DEFAULT false,
  activity_status TEXT,
  inspection_service TEXT,
  regime TEXT,
  source_updated_at TIMESTAMPTZ,
  detail_url TEXT NOT NULL,
  dataset_url TEXT NOT NULL,
  license_name TEXT NOT NULL,
  license_url TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS company_icpe_inspections (
  id BIGSERIAL PRIMARY KEY,
  installation_id BIGINT NOT NULL REFERENCES company_icpe_installations(id) ON DELETE CASCADE,
  fingerprint CHAR(64) NOT NULL UNIQUE,
  inspection_date DATE,
  document_date DATE,
  document_type TEXT,
  document_url TEXT
);

CREATE TABLE IF NOT EXISTS company_icpe_rubrics (
  id BIGSERIAL PRIMARY KEY,
  installation_id BIGINT NOT NULL REFERENCES company_icpe_installations(id) ON DELETE CASCADE,
  rubric_number TEXT NOT NULL,
  nature TEXT,
  paragraph TEXT,
  authorized_regime TEXT,
  total_quantity TEXT,
  unit TEXT,
  reason_date DATE
);

CREATE TABLE IF NOT EXISTS company_icpe_documents (
  id BIGSERIAL PRIMARY KEY,
  installation_id BIGINT NOT NULL REFERENCES company_icpe_installations(id) ON DELETE CASCADE,
  fingerprint CHAR(64) NOT NULL UNIQUE,
  document_date DATE,
  document_type TEXT,
  document_url TEXT
);

CREATE INDEX IF NOT EXISTS company_icpe_company_update_idx
  ON company_icpe_installations(company_id, source_updated_at DESC);
CREATE INDEX IF NOT EXISTS company_icpe_siret_idx
  ON company_icpe_installations(siret);
CREATE INDEX IF NOT EXISTS company_icpe_geom_idx
  ON company_icpe_installations USING GIST(geom);
CREATE INDEX IF NOT EXISTS company_icpe_inspection_date_idx
  ON company_icpe_inspections(installation_id, inspection_date DESC);
CREATE INDEX IF NOT EXISTS company_icpe_rubric_idx
  ON company_icpe_rubrics(installation_id, rubric_number);
