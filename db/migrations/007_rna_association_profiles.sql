CREATE TABLE company_association_profiles (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rna_id TEXT NOT NULL,
  former_id TEXT,
  siret CHAR(14),
  identifier_status TEXT NOT NULL,
  match_confidence NUMERIC(4,3) NOT NULL,
  public_utility_id TEXT,
  creation_date DATE,
  declaration_date DATE,
  publication_date DATE,
  dissolution_date DATE,
  nature_code TEXT,
  group_type TEXT,
  title TEXT,
  short_title TEXT,
  purpose TEXT,
  purpose_code_1 TEXT,
  purpose_code_2 TEXT,
  website TEXT,
  website_publication_authorized BOOLEAN NOT NULL DEFAULT false,
  position_code TEXT,
  source_updated_at TIMESTAMPTZ,
  source_reference_date DATE NOT NULL,
  source_url TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL,
  UNIQUE (company_id, rna_id)
);

CREATE INDEX company_association_profiles_rna_idx
  ON company_association_profiles (rna_id);

CREATE INDEX company_association_profiles_status_idx
  ON company_association_profiles (position_code);

CREATE INDEX company_association_profiles_purpose_idx
  ON company_association_profiles (purpose_code_1);
