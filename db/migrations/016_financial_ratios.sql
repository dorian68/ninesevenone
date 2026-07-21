-- Official BCE/INPI financial statements, matched by exact SIREN.
-- Complete, simplified and consolidated statements must remain separate.
CREATE TABLE IF NOT EXISTS financial_exercises (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL UNIQUE,
  closing_date DATE NOT NULL,
  statement_type CHAR(1) NOT NULL CHECK (statement_type IN ('C', 'K', 'S')),
  confidentiality TEXT NOT NULL,
  is_partially_confidential BOOLEAN NOT NULL DEFAULT FALSE,
  date_quality TEXT NOT NULL CHECK (date_quality IN ('published', 'future_closing_date')),
  metric_count SMALLINT NOT NULL,
  chiffre_d_affaires BIGINT,
  marge_brute BIGINT,
  ebe BIGINT,
  ebit BIGINT,
  resultat_net BIGINT,
  taux_d_endettement DOUBLE PRECISION,
  ratio_de_liquidite DOUBLE PRECISION,
  ratio_de_vetuste DOUBLE PRECISION,
  autonomie_financiere DOUBLE PRECISION,
  poids_bfr_exploitation_sur_ca DOUBLE PRECISION,
  couverture_des_interets DOUBLE PRECISION,
  caf_sur_ca DOUBLE PRECISION,
  capacite_de_remboursement DOUBLE PRECISION,
  marge_ebe DOUBLE PRECISION,
  resultat_courant_avant_impots_sur_ca DOUBLE PRECISION,
  poids_bfr_exploitation_sur_ca_jours DOUBLE PRECISION,
  rotation_des_stocks_jours DOUBLE PRECISION,
  credit_clients_jours DOUBLE PRECISION,
  credit_fournisseurs_jours DOUBLE PRECISION,
  source_updated_at TIMESTAMPTZ NOT NULL,
  dataset_url TEXT NOT NULL,
  license_name TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, closing_date, statement_type)
);

CREATE TABLE IF NOT EXISTS financial_metric_definitions (
  field_name TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  value_type TEXT NOT NULL,
  unit TEXT NOT NULL,
  description TEXT,
  formula_ck TEXT,
  formula_s TEXT,
  source_updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS financial_exercises_company_date_idx
  ON financial_exercises(company_id, closing_date DESC, statement_type);
CREATE INDEX IF NOT EXISTS financial_exercises_quality_idx
  ON financial_exercises(date_quality, is_partially_confidential);
