CREATE TABLE company_rge_qualifications (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  establishment_id BIGINT REFERENCES establishments(id) ON DELETE SET NULL,
  data_source_id BIGINT NOT NULL REFERENCES data_sources(id),
  source_record_id TEXT NOT NULL,
  referenced_siret CHAR(14) NOT NULL,
  qualification_code TEXT,
  qualification_name TEXT NOT NULL,
  certificate_name TEXT,
  domains TEXT[] NOT NULL DEFAULT '{}',
  meta_domain TEXT,
  certifying_organization TEXT,
  works_for_individuals BOOLEAN,
  valid_from DATE,
  valid_until DATE,
  qualification_status TEXT NOT NULL CHECK (qualification_status IN ('active', 'historical')),
  certificate_url TEXT,
  confidence NUMERIC(4,3) NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  source_updated_at TIMESTAMPTZ,
  retrieved_at TIMESTAMPTZ NOT NULL,
  UNIQUE (data_source_id, source_record_id)
);

CREATE INDEX idx_rge_company_status ON company_rge_qualifications (company_id, qualification_status, valid_until DESC);
CREATE INDEX idx_rge_siret ON company_rge_qualifications (referenced_siret);
CREATE INDEX idx_rge_domains ON company_rge_qualifications USING GIN (domains);
