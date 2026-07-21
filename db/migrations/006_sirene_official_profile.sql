ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS annee_categorie_entreprise INTEGER,
  ADD COLUMN IF NOT EXISTS annee_effectif INTEGER,
  ADD COLUMN IF NOT EXISTS identifiant_association TEXT,
  ADD COLUMN IF NOT EXISTS economie_sociale_solidaire BOOLEAN,
  ADD COLUMN IF NOT EXISTS societe_mission BOOLEAN,
  ADD COLUMN IF NOT EXISTS date_debut_periode DATE,
  ADD COLUMN IF NOT EXISTS date_dernier_traitement TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS nombre_periodes INTEGER;

ALTER TABLE establishments
  ADD COLUMN IF NOT EXISTS tranche_effectif TEXT,
  ADD COLUMN IF NOT EXISTS annee_effectif INTEGER,
  ADD COLUMN IF NOT EXISTS caractere_employeur BOOLEAN,
  ADD COLUMN IF NOT EXISTS identifiant_adresse TEXT,
  ADD COLUMN IF NOT EXISTS date_dernier_traitement TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS nombre_periodes INTEGER;

CREATE INDEX IF NOT EXISTS companies_ess_idx
  ON companies (economie_sociale_solidaire)
  WHERE economie_sociale_solidaire = true;

CREATE INDEX IF NOT EXISTS companies_mission_idx
  ON companies (societe_mission)
  WHERE societe_mission = true;

CREATE INDEX IF NOT EXISTS companies_association_idx
  ON companies (identifiant_association)
  WHERE identifiant_association IS NOT NULL;

CREATE INDEX IF NOT EXISTS establishments_employer_idx
  ON establishments (caractere_employeur)
  WHERE caractere_employeur = true;
