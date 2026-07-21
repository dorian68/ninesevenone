CREATE TABLE collective_agreement_catalog (
  idcc TEXT PRIMARY KEY,
  kali_id TEXT NOT NULL,
  title TEXT,
  short_title TEXT,
  categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  base_text_status TEXT,
  legifrance_url TEXT NOT NULL,
  package_version TEXT NOT NULL,
  package_updated_at TIMESTAMPTZ,
  package_license TEXT NOT NULL,
  package_url TEXT NOT NULL
);

CREATE TABLE establishment_collective_agreements (
  id BIGSERIAL PRIMARY KEY,
  establishment_id BIGINT NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  fingerprint CHAR(64) NOT NULL UNIQUE,
  source_row_number INTEGER NOT NULL,
  idcc TEXT NOT NULL,
  idcc_status TEXT NOT NULL,
  reference_month TEXT NOT NULL,
  source_update_date DATE,
  resource_id UUID NOT NULL,
  resource_title TEXT NOT NULL,
  resource_url TEXT NOT NULL,
  resource_last_modified TIMESTAMPTZ,
  dataset_url TEXT NOT NULL,
  source_updated_at TIMESTAMPTZ NOT NULL,
  license_name TEXT NOT NULL,
  license_url TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE establishment_opco_assignments (
  id BIGSERIAL PRIMARY KEY,
  establishment_id BIGINT NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  fingerprint CHAR(64) NOT NULL UNIQUE,
  source_row_number INTEGER NOT NULL,
  idcc TEXT,
  idcc_status TEXT NOT NULL,
  owner_opco TEXT,
  managing_opco TEXT,
  assignment_status TEXT NOT NULL,
  reference_month TEXT NOT NULL,
  resource_id UUID NOT NULL,
  resource_title TEXT NOT NULL,
  resource_url TEXT NOT NULL,
  resource_last_modified TIMESTAMPTZ,
  dataset_url TEXT NOT NULL,
  source_updated_at TIMESTAMPTZ NOT NULL,
  license_name TEXT NOT NULL,
  license_url TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX establishment_agreements_establishment_idx
  ON establishment_collective_agreements (establishment_id, reference_month DESC, idcc);

CREATE INDEX establishment_agreements_idcc_idx
  ON establishment_collective_agreements (idcc, reference_month DESC);

CREATE INDEX establishment_opco_establishment_idx
  ON establishment_opco_assignments (establishment_id, reference_month DESC);

CREATE INDEX establishment_opco_assignment_idx
  ON establishment_opco_assignments (owner_opco, managing_opco, assignment_status);
