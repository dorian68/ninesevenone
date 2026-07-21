# Modèle de Données

Le modèle distingue `Company` et `Establishment`.

## Tables principales

- `companies`: personne morale ou entreprise juridique, identifiée par SIREN.
- `companies` conserve aussi ESS, société à mission, RNA, années de catégorie/effectif, début de période, nombre de périodes et dernier traitement SIRENE.
- `establishments`: établissement physique identifié par SIRET, avec siège, création, effectif daté, caractère employeur déclaré, identifiant d'adresse, géocodage, périodes et fraîcheur.
- `sectors`: taxonomie interne de secteurs normalisés.
- `data_sources`: source, licence, priorité.
- `data_import_runs`: exécutions d'import observables.
- `company_claims`: revendications de fiche.
- `company_reports`: signalements publics, motif, message, contact de suivi facultatif et décision de modération.
- `company_verification_overrides`: état de fiche vérifiée issu d'une revendication approuvée, séparé de SIRENE.
- `company_update_requests`: propositions d'enrichissement déclaratif rattachées à une revendication approuvée, payload versionné et décision.
- `company_declared_overrides`: derniers champs déclarés approuvés, avec référence de la demande et date de publication; aucune donnée officielle n'est remplacée.
- `saved_searches`: recherches enregistrées.
- `users`: comptes et rôles.
- `admin_audit_logs`: audit administratif.
- `company_media`: médias autorisés.
- `company_social_links`: liens sociaux publics.
- `company_enrichment_snapshots`: fraîcheur, statut et couverture par fournisseur BI.
- `company_events`: créations, modifications, radiations et autres événements BODACC.
- `company_public_contracts`: marchés publics attribués, montants et acheteurs DECP.
- `company_media_mentions`: titres, éditeurs, dates, liens et confiance des correspondances média.
- `company_web_profiles`: sites officiels, profils sociaux ou annuaires avec origine de la référence (OSM/RNA), statut robots et vérification.
- `company_osm_presences`: implantations OSM, téléphones et emails fonctionnels professionnels filtrés, horaires, accessibilité, services, géométrie et statut de rapprochement avec le stock SIRENE actif.
- `company_rge_qualifications`: qualifications ADEME actives et historiques, domaines, organisme, validité et certificat.
- `company_association_profiles`: RNA, objet statutaire, dates, position, groupement, utilité publique et diagnostics de jointure.
- `company_public_grants`: conventions SCDL rattachées par identifiant exact, montant attribué publié, objet, attribuant et périmètre de jointure.
- `public_grant_occurrences`: provenance de chaque occurrence d'une convention dédupliquée, ressource, ligne, date et licence.
- `company_ademe_financial_aids`: dossiers ADEME, objet, dispositif, montant engagé publié, décision, période et périmètre local ou national de la jointure SIRET.
- `company_fonds_vert_projects`: projets Fonds vert, résumé, montant engagé, millésime, bénéficiaire exact, localisation publiée et provenance de ressource.
- `company_france_relance_industrial_projects`: projets industriels France Relance, mesure, description, filière, indicateur CO2 éventuel, bénéficiaire exact, localisation et provenance.
- `company_training_organization_profiles`: NDA, catégories qualité actives, spécialités NSF, période et agrégats BPF, périmètre de jointure et provenance, sans nom personnel ni rue.
- `company_professional_equality_declarations`: déclarations Egapro annuelles, contexte entreprise/UES, tranche d'effectifs, statuts de calcul, scores agrégés, périmètre de rattachement et provenance.
- `company_public_officer_mandates`: mandats publics issus du RNE via l'Annuaire des Entreprises, avec identité affichée minimisée, qualité, personne morale liée éventuelle, fraîcheur et provenance; aucune date de naissance, nationalité, adresse ou coordonnée personnelle.
- `annuaire_public_snapshots`: projection non personnelle des agrégats Annuaire par entreprise, taille, catégorie, NAF 2025, compteurs d'établissements, IDCC renseigné et fraîcheur.
- `annuaire_public_financials`, `annuaire_public_labels`, `annuaire_public_agreements`: exercices, drapeaux publics positifs et codes IDCC associés à un snapshot Annuaire, sans payload JSON brut.
- `press_mentions` et `press_fetch_runs`: titres, URLs, éditeurs, dates, fournisseurs, confiance et état de collecte média; aucun corps d'article.
- `company_bodacc_events`: annonces BODACC rattachées par SIREN exact, famille, date, tribunal, localisation publiée, forme/capital éventuels et activité déclarée; aucun payload juridique brut ni nom de personne.
- `company_recruitment_signals` (cible de persistance): offres France Travail rattachées par SIREN/SIRET exact, intitulé, contrat, lieu, dates, URL et fraîcheur; le vertical slice actuel les lit à la demande lorsque l'accès API est activé et ne les met pas encore en cache.
- `workspace_sessions`: jeton de session anonyme haché, dates de création/mise à jour et expiration; à rattacher à `users` lorsque l'authentification sera activée.
- `workspace_saved_searches`: nom et filtres de recherche explicitement enregistrés.
- `workspace_shortlists`: nom et SIREN sélectionnés, avec détail local de présentation dans le vertical slice SQLite.
- `workspace_drafts`: brouillons CV ou proposition, cible SIREN éventuelle, dates et contenu saisi par l'utilisateur.

Le runtime local contient désormais une table `companies` alimentée par `StockUniteLegale`, reliée aux établissements par SIREN. Aucun nom ou prénom de personne physique n'est sélectionné dans l'extrait légal local.

## Index

- GIST sur `establishments.geom`.
- index composés commune/secteur.
- full-text français avec `unaccent`.
- trigrammes sur raison sociale.
- trigrammes sur `company_public_officer_mandates.display_name` et `role`, plus index SIREN exact côté runtime SQLite/FTS5.

Le SQL initial est dans `db/migrations/001_initial_schema.sql`.
Les tables d'intelligence entreprise sont dans `db/migrations/002_business_intelligence.sql`.
Les présences OSM et leurs contrôles de fraîcheur sont dans `db/migrations/003_osm_business_presence.sql`.
Les qualifications RGE sont dans `db/migrations/004_rge_qualifications.sql`.
Les captures contrôlées des sites publics rattachés sont dans `db/migrations/005_website_enrichments.sql`.
Les signaux officiels SIRENE étendus sont dans `db/migrations/006_sirene_official_profile.sql`.
Les profils RNA sont dans `db/migrations/007_rna_association_profiles.sql`.
Les conventions de subvention SCDL sont dans `db/migrations/008_public_grants.sql`.
Les aides financières ADEME sont dans `db/migrations/009_ademe_financial_aids.sql`.
Les projets Fonds vert sont dans `db/migrations/010_fonds_vert_projects.sql`.
Les projets industriels France Relance sont dans `db/migrations/011_france_relance_industrial_projects.sql`.
Les profils d'organismes de formation sont dans `db/migrations/012_training_organization_profiles.sql`.
Les déclarations annuelles Egapro sont dans `db/migrations/013_professional_equality_index.sql`.
Les conventions collectives et rattachements OPCO sont dans `db/migrations/014_collective_agreements_opco.sql`.
Les mandats publics minimisés sont dans `db/migrations/019_public_officer_mandates.sql`; les agrégats Annuaire sont dans `db/migrations/020_annuaire_public_snapshots.sql`; la veille média est dans `db/migrations/021_press_signals.sql`; les événements BODACC sont dans `db/migrations/022_bodacc_events.sql`; la cible de cache recrutement est dans `db/migrations/023_recruitment_signals.sql`; la persistance workspace est dans `db/migrations/024_workspace_persistence.sql`; la modération et les overrides de données déclarées sont dans `db/migrations/025_moderation_workflows.sql` et `db/migrations/026_declared_company_updates.sql`. Le vertical slice local utilise `data/public-officers.sqlite` et sa table FTS5 `officer_search`, ainsi que les projections SQLite `annuaire_*`, `department_runs`, `data/bodacc-guadeloupe.sqlite`, `data/workspaces.sqlite` et `data/moderation.sqlite`. `department_runs` est un journal d'ingestion local : département, page suivante, plafond exposé, volumes, statut et erreur; il ne remplace pas la cible PostgreSQL métier.

## Conventions collectives et OPCO

- `collective_agreement_catalog` : catalogue minimal IDCC/KALI, titres, état du texte de base et URL Légifrance.
- `establishment_collective_agreements` : IDCC déclarés par SIRET, statut du code, millésime, contexte territorial et provenance ministérielle.
- `establishment_opco_assignments` : OPCO propriétaire et gestionnaire par SIRET, IDCC SIRO, statut d'attribution, millésime et provenance France compétences.

## Portefeuilles de brevets

- `company_patent_families` : familles DOCDB par unité légale, titres, résumés, dates, octroi, portée internationale et provenance.
- `company_patent_applications` : demandes juridictionnelles reliées à une famille, office, publication, priorité et date d'octroi.
- `company_patent_technologies` : classifications CIB aux niveaux section, classe et sous-classe.

La cible PostgreSQL est définie dans `db/migrations/015_patent_portfolios.sql`. Le runtime SQLite conserve les mêmes trois niveaux dans `data/patent-portfolios.sqlite`.

## Ratios financiers

- `financial_exercises` : un exercice par unité légale, date de clôture et type de bilan, avec confidentialité, qualité de date, cinq montants et quatorze ratios publiés.
- `financial_metric_definitions` : libellé, unité, définition BCE et formules distinctes C/K et S pour chacun des 19 indicateurs.

La clé fonctionnelle `(company_id, closing_date, statement_type)` interdit de fusionner un bilan complet, simplifié ou consolidé du même exercice. Les dates postérieures à la fraîcheur de la source restent traçables via `date_quality`. La cible PostgreSQL est `db/migrations/016_financial_ratios.sql`; le runtime en lecture seule est `data/financial-ratios.sqlite`.

## Bilans financiers détaillés

- `detailed_financial_statements` : exercice rattaché par SIREN, date et type C/K/S, statut de confidentialité, cellules fiscales brutes hors ligne et 24 agrégats dérivés.
- `detailed_financial_metric_definitions` : libellés, codes des formulaires C/K et S, et liens vers les formulaires DGFiP.

Les cellules brutes servent à l'audit et au recalcul mais sont absentes du lecteur public. La clé fonctionnelle `(company_id, closing_date, statement_type)` empêche toute fusion d'exercices. La cible PostgreSQL est `db/migrations/017_detailed_financial_statements.sql`; le runtime est `data/detailed-financial-statements.sqlite`.
