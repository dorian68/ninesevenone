CREATE TABLE company_professional_equality_declarations (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fingerprint CHAR(64) NOT NULL UNIQUE,
  source_row_number INTEGER NOT NULL,
  declaring_siren CHAR(9) NOT NULL,
  match_scope TEXT NOT NULL,
  match_confidence NUMERIC(4,3) NOT NULL,
  reference_year INTEGER NOT NULL,
  structure_type TEXT NOT NULL,
  workforce_band TEXT,
  ues_name TEXT,
  ues_member_count INTEGER,
  declaration_location_scope TEXT NOT NULL,
  declaring_region TEXT,
  declaring_department TEXT,
  declaring_country TEXT,
  naf_code TEXT,
  naf_label TEXT,
  pay_gap_score SMALLINT,
  pay_gap_status TEXT NOT NULL,
  raise_gap_no_promotion_score SMALLINT,
  raise_gap_no_promotion_status TEXT NOT NULL,
  promotion_gap_score SMALLINT,
  promotion_gap_status TEXT NOT NULL,
  raise_gap_score SMALLINT,
  raise_gap_status TEXT NOT NULL,
  maternity_return_score SMALLINT,
  maternity_return_status TEXT NOT NULL,
  highest_remuneration_score SMALLINT,
  highest_remuneration_status TEXT NOT NULL,
  index_score SMALLINT,
  index_status TEXT NOT NULL,
  resource_id UUID NOT NULL,
  resource_title TEXT NOT NULL,
  resource_url TEXT NOT NULL,
  resource_last_modified TIMESTAMPTZ,
  source_updated_at TIMESTAMPTZ NOT NULL,
  dataset_url TEXT NOT NULL,
  egapro_url TEXT NOT NULL,
  license_name TEXT NOT NULL,
  license_url TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT equality_reference_year_check CHECK (reference_year >= 2018),
  CONSTRAINT equality_index_score_check CHECK (index_score IS NULL OR index_score BETWEEN 0 AND 100)
);

CREATE INDEX company_equality_company_year_idx
  ON company_professional_equality_declarations (company_id, reference_year DESC);

CREATE INDEX company_equality_declarant_year_idx
  ON company_professional_equality_declarations (declaring_siren, reference_year DESC);

CREATE INDEX company_equality_scope_idx
  ON company_professional_equality_declarations (match_scope, structure_type);

CREATE INDEX company_equality_score_idx
  ON company_professional_equality_declarations (reference_year DESC, index_score);
