# Architecture

## Choix cible

Architecture recommandée: Next.js App Router pour le web et FastAPI pour les traitements de données.

Raison: la carte, les pages SEO et l'expérience utilisateur bénéficient du rendu React/Next.js, tandis que l'import SIRENE, le géocodage, l'observabilité et les tâches longues sont plus robustes dans un backend Python séparé avec workers.

## Modules

- `apps/web`: UI, SSR, API de vertical slice local.
- `backend/app`: FastAPI, domaine, ingestion et futurs endpoints industriels.
- `db/migrations`: schéma PostgreSQL/PostGIS.
- `scripts`: commandes d'import et géocodage.
- `infra`: configuration PostgreSQL locale.

## Services explicites

À industrialiser:

- `CompanyRepository`
- `EstablishmentRepository`
- `SireneImporter`
- `AddressNormalizer`
- `GeocodingService`
- `CompanyDescriptionService`
- `SearchService`
- `MapViewportService`
- `CompanyClaimService`
- `DataQualityService`
- `BusinessIntelligenceService`
- `BodaccProvider`
- `PublicContractsProvider`
- `MediaMonitoringProvider`
- `AnnuaireProvider`
- `PublicOfficerRepository`
- `CompanyProfileService`
- `AdemeRgeProvider`
- `AdemeFinancialAidsImporter`
- `FranceRelanceIndustrialProjectsImporter`
- `TrainingOrganizationsImporter`
- `ProfessionalEqualityImporter`
- `FinancialRatiosImporter`
- `OsmBusinessPresenceImporter`
- `WebsiteEnrichmentService`
- `RnaAssociationImporter`
- `PublicGrantsImporter`
- `SourceConfidenceService`

## Cartographie

Le navigateur ne charge pas toute la base. Les requêtes de carte utilisent une bounding box et un zoom. En production, l'endpoint devra s'appuyer sur PostGIS, cache Redis et éventuellement tuiles vectorielles.

Le studio `/outils` s'appuie sur `GET /api/prospecting` pour une liste bornée d'établissements actifs filtrables par texte, secteur et commune. L'analyse BI d'un candidat est explicite et déclenchée à la demande; le résumé, les services et les signaux sont réutilisés comme faits de ciblage du CV ou du brief de proposition, sans génération de besoin, de promesse commerciale ou de compétence. La lecture BI expose aussi les signaux secondaires positifs lorsqu'ils existent : dirigeants publics minimisés, brevets, exercices financiers, aides, formation, RGE et ICPE. Les endpoints `/api/workspace`, `/api/workspace/saved-searches`, `/api/workspace/shortlists` et `/api/workspace/drafts` persistent les éléments explicitement enregistrés dans un espace anonyme identifié par cookie HttpOnly; le CSV n'embarque que SIREN/SIRET, nom légal, commune, NAF, adresse professionnelle publiée, effectif lorsqu'il est disponible et URL de fiche. La cible de production devra rattacher ce workspace à un utilisateur authentifié, ajouter quotas, audit et stockage chiffré avant tout partage multi-utilisateur.

## Intelligence Entreprise

`GET /api/companies/{siren}/intelligence` agrège d'abord les profils locaux SIRENE, RNA, organismes de formation, Egapro, conventions/OPCO, brevets, ratios et bilans détaillés BCE/INPI, SCDL, aides ADEME et projets Fonds vert/France Relance, puis Annuaire des Entreprises, mandats publics RNE, BODACC, ADEME RGE, DECP, l'index territorial OSM, l'index hors ligne des sites publics rattachés et les fournisseurs média côté serveur. `CompanyProfileService` dérive ensuite une synthèse explicite : description priorisée par preuve, activité NAF, services observés, taille, signaux et références. Les jointures administratives utilisent les identifiants exacts. Les profils officiels restent disponibles même si les fournisseurs réseau sont indisponibles; aucune page web d'entreprise n'est visitée au runtime. Les mandats sont lus depuis l'index FTS local et minimisés avant exposition. La réponse est mise en cache cinq minutes avec déduplication des requêtes concurrentes et une limite de 128 profils en mémoire. La cible Postgres matérialise ces résultats dans les migrations `002_business_intelligence.sql` à `019_public_officer_mandates.sql`.
`GET /api/search?suggest=true` renvoie dans un même payload les résultats bornés et les suggestions structurées afin de limiter les appels par frappe. Les suggestions locales s'appuient sur FTS5 SIRENE, mandats, sites publics, OSM, BODACC et presse; les scopes `siren:`, `siret:`, `naf:`, `commune:`, `secteur:`, `adresse:` et `presse:` évitent les ambiguïtés. Pour rester réactive, cette variante ne sollicite pas l'Annuaire distant pour une recherche libre; le préfixe explicite `dirigeant:` peut toutefois utiliser le fournisseur officiel après trois caractères afin de retrouver un mandat hors snapshot local. En cas de faute simple, le moteur interroge un sous-ensemble SQL borné et classe les rapprochements de nom avant les rapprochements de contexte. La validation explicite de toute recherche peut utiliser l'API officielle avec cache HTTP et source affichée. Le composant annule les requêtes précédentes et débounce les suggestions. `getEnterpriseMapData` applique les filtres d'URL à la requête spatiale avant le regroupement, sans charger la base dans le navigateur.

Les pages SSR `/entreprises/{commune}/{slug}-{siren}` dérivent en plus un premier niveau de description depuis les sites publics rattachés autorisés et les activités BODACC locales. Le site web, le téléphone, l'email fonctionnel et les horaires OSM sont ajoutés uniquement lorsqu'ils sont publiés et validés par les règles d'import; chaque formulation garde sa source et son niveau de confiance. Une proposition approuvée par l'administration est ajoutée sous forme d'enrichissement déclaré distinct, sans écraser les faits SIRENE. L'absence de description publique revient explicitement au libellé NAF généré, jamais à une promesse commerciale.

`/admin` combine un tableau local de couverture et une console de modération. `admin-auth.ts` valide un jeton bootstrap côté serveur, ouvre une session HMAC HttpOnly de huit heures et expose les rôles `SUPER_ADMIN`, `DATA_ADMIN` et `MODERATOR`; les routes ne se fient pas au rôle envoyé par le navigateur. Les revendications, signalements et propositions d'enrichissement sont stockés dans `moderation.sqlite`, avec décision et journal d'audit séparés du stock officiel. Seuls `SUPER_ADMIN` et `DATA_ADMIN` peuvent publier un enrichissement déclaré. Le compte utilisateur multi-tenant, le rôle `COMPANY_OWNER`, les importations administratives et la persistance Postgres restent des étapes de production.

## Dossier BI et modération

`business-intelligence-dossier.ts` transforme la synthèse BI en un contrat borné, exploitable par la page entreprise et le Studio : chaque fait conserve source, URL, date, confiance et portée; les mandats restent des mandats légaux publiés et ne sont jamais présentés comme organigramme ou bénéficiaires effectifs. `GET /api/companies/{siren}/dossier` renvoie uniquement ce contrat, avec cache court et sans payload brut ni champs personnels.

`CompanyActions` propose trois actions réelles : revendication, signalement et enrichissement. Une mise à jour est recevable uniquement avec le SIREN, une référence de revendication approuvée et le même email professionnel; après décision `DATA_ADMIN`/`SUPER_ADMIN`, elle est matérialisée dans `company_declared_overrides`. Cette table ne modifie ni `companies`, ni `establishments`, ni les snapshots d'import. La migration cible est `026_declared_company_updates.sql`; le runtime local utilise la projection SQLite idempotente de `moderation-db.ts`.

### Lecture conventions collectives et OPCO

`scripts/import_collective_agreements.py` produit `data/collective-agreements.sqlite` atomiquement. `collective-agreements-db.ts` ouvre cet index en lecture seule avec des requêtes bornées par SIREN. `business-intelligence.ts` rapproche les deux millésimes par SIRET, sans fusion destructive, puis groupe le résultat par établissement.

Le catalogue KALI est réduit aux métadonnées nécessaires. Le texte intégral n'est ni copié ni servi; la fiche pointe vers Légifrance pour la vérification. La cible PostgreSQL est décrite par la migration `014_collective_agreements_opco.sql`.

### Portefeuilles de brevets

`import_patent_portfolios.py` utilise un plan en deux temps : découverte exacte des SIREN dans l'export national, puis enrichissement ciblé par clés de demandes et familles DOCDB. Cette architecture évite le téléchargement des jeux complets de résumés et classifications.

`patent-portfolios-db.ts` calcule les agrégats exhaustifs côté serveur et ne renvoie que les 20 familles les plus récentes. Les très grands portefeuilles restent donc consultables sans exposer des milliers de composants ou un payload disproportionné. La migration cible est `015_patent_portfolios.sql`.

### Ratios financiers BCE/INPI

`import_financial_ratios.py` inverse le flux habituel du jeu national : il part des 109 825 SIREN locaux actifs et diffusables et interroge ODS par lots exacts. Les 733 caches versionnés rendent le traitement reprenable sans télécharger les 6,5 millions de lignes.

`financial-ratios-db.ts` ouvre l'index SQLite en lecture seule et borne les exercices à 60 par SIREN. `business-intelligence.ts` applique la politique de diffusion avant sérialisation : les montants techniques confidentiels deviennent `null`, tandis que les ratios légalement publiés restent disponibles. L'UI choisit une seule série C, S ou K à la fois. La migration cible est `016_financial_ratios.sql`.

`detailed-financial-statements-db.ts` ouvre séparément l'index de liasses dérivées et sélectionne explicitement les 24 agrégats publics, jamais `liasse_json`. Le service BI masque le compte de résultat des bilans partiellement confidentiels. L'UI n'affiche un détail que lorsque SIREN, date de clôture et type C/K/S correspondent exactement à l'exercice choisi dans les ratios; aucune valeur d'un autre exercice n'est substituée. La migration cible est `017_detailed_financial_statements.sql`.
