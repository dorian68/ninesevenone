CREATE TABLE company_enrichment_snapshots (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  data_source_id BIGINT NOT NULL REFERENCES data_sources(id),
  status TEXT NOT NULL CHECK (status IN ('ok', 'empty', 'unavailable', 'stale')),
  record_count INTEGER NOT NULL DEFAULT 0,
  payload_hash TEXT,
  error_code TEXT,
  retrieved_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  UNIQUE (company_id, data_source_id)
);

CREATE TABLE company_events (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  data_source_id BIGINT NOT NULL REFERENCES data_sources(id),
  source_record_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  event_date DATE,
  source_url TEXT,
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  source_payload JSONB NOT NULL DEFAULT '{}',
  retrieved_at TIMESTAMPTZ NOT NULL,
  UNIQUE (data_source_id, source_record_id)
);

CREATE TABLE company_public_contracts (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  data_source_id BIGINT NOT NULL REFERENCES data_sources(id),
  source_record_id TEXT NOT NULL,
  title TEXT NOT NULL,
  buyer_name TEXT,
  notification_date DATE,
  amount NUMERIC(18,2),
  duration_months INTEGER,
  cpv_code TEXT,
  cpv_label TEXT,
  execution_place TEXT,
  source_url TEXT,
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  retrieved_at TIMESTAMPTZ NOT NULL,
  UNIQUE (data_source_id, source_record_id, company_id)
);

CREATE TABLE company_media_mentions (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  data_source_id BIGINT NOT NULL REFERENCES data_sources(id),
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL,
  publisher TEXT,
  published_at TIMESTAMPTZ,
  match_query TEXT NOT NULL,
  match_confidence NUMERIC(4,3) NOT NULL CHECK (match_confidence BETWEEN 0 AND 1),
  retrieved_at TIMESTAMPTZ NOT NULL,
  UNIQUE (company_id, canonical_url)
);

CREATE TABLE company_web_profiles (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  data_source_id BIGINT NOT NULL REFERENCES data_sources(id),
  url TEXT NOT NULL,
  profile_type TEXT NOT NULL CHECK (profile_type IN ('official_site', 'social', 'directory')),
  title TEXT,
  factual_description TEXT,
  robots_allowed BOOLEAN NOT NULL DEFAULT false,
  verified BOOLEAN NOT NULL DEFAULT false,
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  retrieved_at TIMESTAMPTZ NOT NULL,
  UNIQUE (company_id, url)
);

CREATE INDEX idx_company_events_timeline ON company_events (company_id, event_date DESC);
CREATE INDEX idx_company_contracts_timeline ON company_public_contracts (company_id, notification_date DESC);
CREATE INDEX idx_company_mentions_timeline ON company_media_mentions (company_id, published_at DESC);
CREATE INDEX idx_company_enrichment_freshness ON company_enrichment_snapshots (status, expires_at);
