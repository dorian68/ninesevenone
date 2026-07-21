CREATE TABLE company_website_enrichments (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  establishment_id BIGINT REFERENCES establishments(id) ON DELETE SET NULL,
  data_source_id BIGINT NOT NULL REFERENCES data_sources(id),
  source_origin TEXT NOT NULL DEFAULT 'OpenStreetMap',
  input_url TEXT NOT NULL,
  final_url TEXT,
  hostname TEXT,
  referenced_siret CHAR(14),
  establishment_match_status TEXT NOT NULL CHECK (
    establishment_match_status IN ('active_match', 'company_match', 'not_in_active_stock')
  ),
  robots_status TEXT NOT NULL,
  fetch_status TEXT NOT NULL,
  http_status INTEGER,
  page_title TEXT,
  canonical_url TEXT,
  claimed_description TEXT,
  description_source TEXT,
  offerings JSONB NOT NULL DEFAULT '[]',
  social_profiles JSONB NOT NULL DEFAULT '{}',
  structured_types TEXT[] NOT NULL DEFAULT '{}',
  language TEXT,
  meta_robots_restricted BOOLEAN NOT NULL DEFAULT false,
  content_hash CHAR(64),
  last_modified TEXT,
  source_reference_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL,
  error_detail TEXT,
  confidence NUMERIC(4,3) CHECK (confidence BETWEEN 0 AND 1),
  UNIQUE (company_id, input_url, referenced_siret)
);

CREATE INDEX idx_website_enrichments_company ON company_website_enrichments (company_id, fetch_status);
CREATE INDEX idx_website_enrichments_hostname ON company_website_enrichments (hostname);
CREATE INDEX idx_website_enrichments_offerings ON company_website_enrichments USING GIN (offerings);
CREATE INDEX idx_website_enrichments_refresh ON company_website_enrichments (fetched_at, fetch_status);
