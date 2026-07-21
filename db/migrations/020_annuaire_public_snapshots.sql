CREATE TABLE annuaire_public_snapshots (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  company_category TEXT,
  workforce_band_code TEXT,
  workforce_year INTEGER,
  naf25 TEXT,
  establishment_count INTEGER NOT NULL DEFAULT 0,
  open_establishment_count INTEGER NOT NULL DEFAULT 0,
  collective_agreement_reported BOOLEAN NOT NULL DEFAULT false,
  source_updated_at TIMESTAMPTZ,
  retrieved_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT NOT NULL,
  UNIQUE(company_id, retrieved_at)
);

CREATE TABLE annuaire_public_financials (
  snapshot_id BIGINT NOT NULL REFERENCES annuaire_public_snapshots(id) ON DELETE CASCADE,
  fiscal_year INTEGER NOT NULL,
  revenue NUMERIC,
  net_income NUMERIC,
  PRIMARY KEY(snapshot_id, fiscal_year)
);

CREATE TABLE annuaire_public_labels (
  snapshot_id BIGINT NOT NULL REFERENCES annuaire_public_snapshots(id) ON DELETE CASCADE,
  label_key TEXT NOT NULL,
  label TEXT NOT NULL,
  PRIMARY KEY(snapshot_id, label_key)
);

CREATE TABLE annuaire_public_agreements (
  snapshot_id BIGINT NOT NULL REFERENCES annuaire_public_snapshots(id) ON DELETE CASCADE,
  idcc TEXT NOT NULL,
  PRIMARY KEY(snapshot_id, idcc)
);

CREATE INDEX annuaire_public_snapshots_company_idx ON annuaire_public_snapshots(company_id, source_updated_at DESC);
CREATE INDEX annuaire_public_financials_year_idx ON annuaire_public_financials(fiscal_year);
CREATE INDEX annuaire_public_labels_key_idx ON annuaire_public_labels(label_key);
CREATE INDEX annuaire_public_agreements_idcc_idx ON annuaire_public_agreements(idcc);
