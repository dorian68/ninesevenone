-- Numeric tax-return cells from the open BCE/INPI detailed financial parquet.
CREATE TABLE IF NOT EXISTS detailed_financial_statements (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL UNIQUE,
  closing_date DATE NOT NULL,
  statement_type CHAR(1) NOT NULL CHECK (statement_type IN ('C', 'K', 'S')),
  confidentiality TEXT NOT NULL,
  is_partially_confidential BOOLEAN NOT NULL,
  date_quality TEXT NOT NULL CHECK (date_quality IN ('published', 'future_closing_date')),
  cell_count SMALLINT NOT NULL,
  derived_metric_count SMALLINT NOT NULL,
  liasse JSONB NOT NULL,
  balance_sheet_total BIGINT,
  equity BIGINT,
  provisions BIGINT,
  financial_debt BIGINT,
  total_debt BIGINT,
  fixed_assets_gross BIGINT,
  fixed_assets_net BIGINT,
  current_assets_gross BIGINT,
  current_assets_net BIGINT,
  inventory_gross BIGINT,
  inventory_net BIGINT,
  trade_receivables_gross BIGINT,
  trade_receivables_net BIGINT,
  cash_and_securities_net BIGINT,
  trade_payables BIGINT,
  tax_social_debt BIGINT,
  capital BIGINT,
  revenue BIGINT,
  operating_result BIGINT,
  current_pre_tax_result BIGINT,
  net_income BIGINT,
  personnel_costs BIGINT,
  external_purchases BIGINT,
  taxes BIGINT,
  source_updated_at TIMESTAMPTZ NOT NULL,
  dataset_url TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, closing_date, statement_type)
);

CREATE INDEX IF NOT EXISTS detailed_financial_company_date_idx
  ON detailed_financial_statements(company_id, closing_date DESC, statement_type);
CREATE INDEX IF NOT EXISTS detailed_financial_quality_idx
  ON detailed_financial_statements(date_quality, is_partially_confidential);
CREATE INDEX IF NOT EXISTS detailed_financial_liasse_gin_idx
  ON detailed_financial_statements USING GIN (liasse);
