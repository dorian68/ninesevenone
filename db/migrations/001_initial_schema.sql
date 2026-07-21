CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TABLE data_sources (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  license TEXT,
  url TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE companies (
  id BIGSERIAL PRIMARY KEY,
  siren CHAR(9) NOT NULL UNIQUE,
  raison_sociale TEXT NOT NULL,
  nom_commercial TEXT,
  sigle TEXT,
  forme_juridique TEXT,
  date_creation DATE,
  statut TEXT NOT NULL DEFAULT 'active',
  categorie_entreprise TEXT,
  annee_categorie_entreprise INTEGER,
  tranche_effectif TEXT,
  annee_effectif INTEGER,
  identifiant_association TEXT,
  economie_sociale_solidaire BOOLEAN,
  societe_mission BOOLEAN,
  date_debut_periode DATE,
  date_dernier_traitement TIMESTAMPTZ,
  nombre_periodes INTEGER,
  site_web TEXT,
  email_public TEXT,
  telephone_public TEXT,
  description_courte TEXT,
  description_longue TEXT,
  description_source TEXT,
  description_confidence NUMERIC(4,3) NOT NULL DEFAULT 0,
  logo_url TEXT,
  verified BOOLEAN NOT NULL DEFAULT false,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE establishments (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  siret CHAR(14) NOT NULL UNIQUE,
  is_head_office BOOLEAN NOT NULL DEFAULT false,
  enseigne TEXT,
  code_naf TEXT,
  libelle_naf TEXT,
  secteur_normalise TEXT,
  adresse_complete TEXT,
  numero_voie TEXT,
  type_voie TEXT,
  nom_voie TEXT,
  complement_adresse TEXT,
  code_postal TEXT,
  commune TEXT,
  code_commune TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  geom GEOGRAPHY(Point, 4326),
  geocoding_precision TEXT,
  geocoding_source TEXT,
  statut TEXT NOT NULL DEFAULT 'active',
  date_creation DATE,
  tranche_effectif TEXT,
  annee_effectif INTEGER,
  caractere_employeur BOOLEAN,
  identifiant_adresse TEXT,
  date_dernier_traitement TIMESTAMPTZ,
  nombre_periodes INTEGER,
  opening_hours TEXT,
  accessibility_info TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sectors (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  parent_id BIGINT REFERENCES sectors(id),
  color TEXT NOT NULL DEFAULT '#006b5d'
);

CREATE TABLE data_import_runs (
  id BIGSERIAL PRIMARY KEY,
  data_source_id BIGINT REFERENCES data_sources(id),
  source_version TEXT,
  status TEXT NOT NULL,
  rows_read INTEGER NOT NULL DEFAULT 0,
  rows_created INTEGER NOT NULL DEFAULT 0,
  rows_updated INTEGER NOT NULL DEFAULT 0,
  rows_skipped INTEGER NOT NULL DEFAULT 0,
  errors_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  logs JSONB NOT NULL DEFAULT '[]',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'USER',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE company_claims (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  verification_payload JSONB NOT NULL DEFAULT '{}',
  reviewed_by BIGINT REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE company_update_requests (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id),
  user_id BIGINT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE saved_searches (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),
  query JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id BIGINT REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE company_media (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id),
  url TEXT NOT NULL,
  media_type TEXT NOT NULL,
  source TEXT NOT NULL,
  authorized BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE company_social_links (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id),
  platform TEXT NOT NULL,
  url TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_establishments_geom ON establishments USING GIST (geom);
CREATE INDEX idx_establishments_bbox ON establishments USING GIST ((geom::geometry));
CREATE INDEX idx_establishments_text ON establishments USING GIN (
  (
    setweight(to_tsvector('french', unaccent(coalesce(enseigne, ''))), 'A') ||
    setweight(to_tsvector('french', unaccent(coalesce(commune, ''))), 'B') ||
    setweight(to_tsvector('french', unaccent(coalesce(secteur_normalise, ''))), 'B') ||
    setweight(to_tsvector('french', unaccent(coalesce(adresse_complete, ''))), 'C')
  )
);
CREATE INDEX idx_companies_name_trgm ON companies USING GIN (unaccent(raison_sociale) gin_trgm_ops);
CREATE INDEX idx_establishments_commune_sector ON establishments (code_commune, secteur_normalise);
