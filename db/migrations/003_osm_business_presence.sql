CREATE TABLE company_osm_presences (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  establishment_id BIGINT REFERENCES establishments(id) ON DELETE SET NULL,
  data_source_id BIGINT NOT NULL REFERENCES data_sources(id),
  osm_element_type TEXT NOT NULL CHECK (osm_element_type IN ('node', 'way', 'relation')),
  osm_element_id BIGINT NOT NULL,
  referenced_siren CHAR(9) NOT NULL,
  referenced_siret CHAR(14),
  establishment_match_status TEXT NOT NULL CHECK (
    establishment_match_status IN ('active_match', 'company_match', 'not_in_active_stock')
  ),
  display_name TEXT,
  brand TEXT,
  operator_name TEXT,
  category_key TEXT,
  category_value TEXT,
  website TEXT,
  public_phone TEXT,
  public_email TEXT,
  opening_hours TEXT,
  wheelchair TEXT,
  internet_access TEXT,
  public_address TEXT,
  factual_description TEXT,
  location GEOGRAPHY(POINT, 4326),
  services JSONB NOT NULL DEFAULT '{}',
  social_profiles JSONB NOT NULL DEFAULT '{}',
  source_tags JSONB NOT NULL DEFAULT '{}',
  match_confidence NUMERIC(4,3) NOT NULL CHECK (match_confidence BETWEEN 0 AND 1),
  data_confidence NUMERIC(4,3) NOT NULL CHECK (data_confidence BETWEEN 0 AND 1),
  source_reference_at TIMESTAMPTZ,
  retrieved_at TIMESTAMPTZ NOT NULL,
  UNIQUE (data_source_id, osm_element_type, osm_element_id, referenced_siren, referenced_siret)
);

CREATE INDEX idx_company_osm_presences_company ON company_osm_presences (company_id);
CREATE INDEX idx_company_osm_presences_siret ON company_osm_presences (referenced_siret);
CREATE INDEX idx_company_osm_presences_location ON company_osm_presences USING GIST (location);
CREATE INDEX idx_company_osm_presences_stale ON company_osm_presences (establishment_match_status)
  WHERE establishment_match_status = 'not_in_active_stock';
