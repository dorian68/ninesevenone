CREATE TABLE company_training_organization_profiles (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fingerprint CHAR(64) NOT NULL UNIQUE,
  source_row_number INTEGER NOT NULL,
  siret CHAR(14),
  match_scope TEXT NOT NULL,
  match_confidence NUMERIC(4,3) NOT NULL,
  registration_location_scope TEXT NOT NULL,
  activity_declaration_number CHAR(11) NOT NULL,
  previous_activity_numbers TEXT,
  postal_code TEXT,
  city TEXT,
  region_code TEXT,
  quality_training BOOLEAN,
  quality_skills_assessment BOOLEAN,
  quality_vae BOOLEAN,
  quality_apprenticeship BOOLEAN,
  is_quality_certified BOOLEAN NOT NULL,
  last_declaration_date DATE,
  exercise_start_date DATE,
  exercise_end_date DATE,
  specialty_code_1 TEXT,
  specialty_label_1 TEXT,
  specialty_code_2 TEXT,
  specialty_label_2 TEXT,
  specialty_code_3 TEXT,
  specialty_label_3 TEXT,
  trainee_count INTEGER,
  entrusted_trainee_count INTEGER,
  trainer_count INTEGER,
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

CREATE INDEX company_training_profiles_company_date_idx
  ON company_training_organization_profiles (company_id, last_declaration_date DESC);

CREATE INDEX company_training_profiles_siret_idx
  ON company_training_organization_profiles (siret);

CREATE INDEX company_training_profiles_location_idx
  ON company_training_organization_profiles (registration_location_scope, region_code);

CREATE INDEX company_training_profiles_quality_idx
  ON company_training_organization_profiles (is_quality_certified);

CREATE INDEX company_training_profiles_specialty_idx
  ON company_training_organization_profiles (specialty_code_1);
