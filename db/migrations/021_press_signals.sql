CREATE TABLE press_mentions (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  domain TEXT,
  published_at TIMESTAMPTZ,
  language TEXT,
  source_country TEXT,
  source TEXT NOT NULL,
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  query_name TEXT NOT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL,
  UNIQUE(company_id, url, source)
);

CREATE TABLE press_fetch_runs (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  mention_count INTEGER NOT NULL DEFAULT 0,
  provider_status JSONB NOT NULL DEFAULT '{}',
  error_detail TEXT,
  fetched_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX press_mentions_company_date_idx ON press_mentions(company_id, published_at DESC);
CREATE INDEX press_mentions_source_date_idx ON press_mentions(source, published_at DESC);
