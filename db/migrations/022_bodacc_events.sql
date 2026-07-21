CREATE TABLE company_bodacc_events (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_event_id TEXT NOT NULL,
  publication_date DATE,
  announcement_number INTEGER,
  announcement_type TEXT,
  announcement_type_label TEXT,
  family TEXT,
  family_label TEXT NOT NULL,
  department_code TEXT NOT NULL,
  tribunal TEXT,
  city TEXT,
  postal_codes TEXT,
  legal_form TEXT,
  capital NUMERIC,
  capital_currency TEXT NOT NULL DEFAULT 'EUR',
  activity_text TEXT,
  source_url TEXT,
  retrieved_at TIMESTAMPTZ NOT NULL,
  UNIQUE(company_id, source_event_id)
);

CREATE INDEX company_bodacc_events_company_date_idx
  ON company_bodacc_events(company_id, publication_date DESC);
CREATE INDEX company_bodacc_events_family_idx
  ON company_bodacc_events(family, publication_date DESC);
