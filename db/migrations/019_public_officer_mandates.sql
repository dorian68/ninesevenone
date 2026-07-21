CREATE TABLE IF NOT EXISTS company_public_officer_mandates (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  officer_key CHAR(64) NOT NULL UNIQUE,
  officer_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  related_company_siren CHAR(9),
  source_updated_at TIMESTAMPTZ,
  retrieved_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT company_public_officer_related_siren_format CHECK (related_company_siren IS NULL OR related_company_siren ~ '^[0-9]{9}$')
);

CREATE INDEX IF NOT EXISTS company_public_officer_company_idx
  ON company_public_officer_mandates(company_id);
CREATE INDEX IF NOT EXISTS company_public_officer_name_trgm_idx
  ON company_public_officer_mandates USING GIN (display_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS company_public_officer_role_trgm_idx
  ON company_public_officer_mandates USING GIN (role gin_trgm_ops);
