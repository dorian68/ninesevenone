# Progression

## Phase 1 — Audit

Réalisé le 2026-07-18.

### Réalisé

- Audit du dossier de travail.
- Vérification Git, fichiers existants et versions Node/npm/Python.
- Rédaction de `CURRENT_STATE.md`.

### Résultat

- Dossier initial vide, sans dépôt Git.
- Aucun composant ou service réutilisable.

### Limitations

- Pas d'historique projet.

## Phase 2 — Conception

### Réalisé

- Choix architecture Next.js + FastAPI/PostGIS.
- Modèle de données initial.
- Stratégies données, import, SEO, sécurité et déploiement.

### Fichiers

- `ARCHITECTURE.md`
- `DATA_MODEL.md`
- `DATA_SOURCES.md`
- `IMPORT_PIPELINE.md`
- `SEO_STRATEGY.md`
- `SECURITY.md`
- `DEPLOYMENT.md`
- `BLOCKERS.md`

## Phase 3 — Vertical slice

### Réalisé

- Application Next.js App Router.
- API bbox + clustering simplifié.
- Recherche locale accent-insensitive.
- Carte MapLibre.
- Hover desktop stabilisé.
- Bottom sheet mobile.
- Panneau latéral.
- Pages entreprises SSR.
- Seed de démonstration séparé.
- Schéma PostGIS initial.
- Squelette FastAPI et import.
- Refonte UX cartographique : fond de plan CARTO/OpenStreetMap plein écran, panneaux flottants, thème clair/sombre, contrôles accessibles et cadrages desktop/mobile.
- Clusters MapLibre rendus en couches WebGL, agrégés côté serveur par bounding box et niveau de zoom.
- Import du stock officiel SIRENE `StockEtablissement` du 1er juillet 2026 : 43 700 154 lignes lues, 129 163 établissements actifs retenus sur 32 communes.
- Exclusion explicite des anciens libellés Saint-Martin et Saint-Barthélemy; périmètre défini par liste de codes communaux.
- Index local SQLite avec FTS5 et RTree : 120 710 SIREN, 129 163 SIRET, 115 920 positions publiables.
- Enrichissement de 45 766 coordonnées non restreintes via l'export public ODS SIRENE/BAN d'avril 2026.
- Recherche et fiches SSR branchées en priorité sur l'index complet; le bootstrap historique n'est plus utilisé dans les parcours visibles.
- Glyphes de compteurs servis localement pour supprimer la latence du CDN sur les clusters.

## Phase 4 — Intelligence entreprise

### Réalisé

- Extraction sélective du parquet officiel `StockUniteLegale` : 120 710 SIREN extraits, aucun manquant, aucun nom personnel sélectionné.
- Table locale `companies` avec forme juridique, création, effectif, catégorie, statut, activité principale et siège.
- Application des statuts de diffusion entreprise et établissement avant tout enrichissement ODS historique.
- API BI normalisée par SIREN avec cache et états de fournisseurs.
- BODACC : événements, activité déclarée, forme et capital publiés.
- DECP : marchés publics, montants, acheteurs, CPV, durée et lieu d'exécution.
- Veille presse GDELT avec repli Google News RSS, correspondance exacte et confiance explicite.
- Annuaire des Entreprises : comptes publiés par exercice, catégorie, effectif, implantation, IDCC, labels et signaux d'aides, sans dirigeants ni coordonnées personnelles.
- Import territorial OpenStreetMap/Geofabrik : 874 objets reliés exactement à 564 SIREN et 756 SIRET, avec sites, téléphones professionnels, horaires, catégories, accessibilité et réseaux.
- Contrôle croisé OSM/SIRENE actif : les SIRET anciens restent visibles avec avertissement et confiance abaissée.
- ADEME RGE : qualifications actives et historiques, domaines, organismes, périodes de validité et certificats par SIRET exact.
- Fiche entreprise enrichie avec indicateurs et onglets synthèse, finances et labels, événements, marchés publics et presse.
- Onglets opérationnels `Qualifications` et `Présence locale`, avec attribution, fraîcheur et états vides non trompeurs.
- Index hors ligne de 323 sites publics rattachés à 310 entreprises, avec contrôle robots, protection SSRF, extraction limitée et reprise idempotente.
- Onglet `Prestations` présentant 152 descriptions courtes et les offres explicitement détectées sur 19 sites, avec provenance, confiance et diagnostics visibles.
- Extension du profil SIRENE à toutes les unités légales et implantations : ESS, société à mission, RNA, siège, effectif daté, caractère employeur, périodes et dates de traitement.
- Réimport du stock national de 43 700 154 lignes et reconstruction de l'index : 118 050 sièges, 20 933 établissements employeurs déclarés, 12 631 ESS, 41 sociétés à mission et 9 483 RNA.
- Nouvelle synthèse BI officielle disponible sans dépendance réseau, avec valeurs nulles distinctes des réponses négatives et avertissement sur le caractère déclaratif.
- Import RNA national du 1er juillet 2026 et jointure exacte de 9 470 profils : 9 469 objets statutaires, dates, positions, groupements, codes d'objet et RUP, sans champs personnels.
- Onglet `Association` conditionnel avec statut, objet déclaré, chronologie, concordance d'identifiants et diagnostic des anomalies.
- Migration Postgres `002_business_intelligence.sql` et documentation `BI_ENRICHMENT.md`.

### Fichiers créés ou modifiés

- `apps/web/src/lib/business-intelligence.ts`
- `apps/web/src/app/api/companies/[siren]/intelligence/route.ts`
- `apps/web/src/components/business-intelligence-panel.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/src/lib/osm-business-db.ts`
- `apps/web/src/lib/website-enrichment-db.ts`
- `apps/web/e2e/map.spec.ts`
- `db/migrations/002_business_intelligence.sql`
- `db/migrations/003_osm_business_presence.sql`
- `db/migrations/004_rge_qualifications.sql`
- `db/migrations/005_website_enrichments.sql`
- `db/migrations/006_sirene_official_profile.sql`
- `db/migrations/007_rna_association_profiles.sql`
- `scripts/import_osm_business_profiles.py`
- `scripts/enrich_official_websites.py`
- `backend/tests/test_osm_business_import.py`
- `backend/tests/test_website_enrichment.py`
- `backend/tests/test_sirene_official_profile.py`
- `backend/tests/test_rna_association_import.py`
- `apps/web/src/lib/rna-association-db.ts`
- `scripts/import_rna_association_profiles.py`
- `BI_ENRICHMENT.md`
- `DATA_SOURCES.md`
- `DATA_QUALITY_REPORT.md`

### Limitations

- La veille presse dépend des index des fournisseurs et n'est pas exhaustive.
- Les comptes détaillés au-delà des agrégats publiés restent à brancher sur des sources autorisées; l'enrichissement web actuel est limité aux sites exactement rattachés et aux pages autorisées.
- La présence OSM couvre 564 entreprises et reste communautaire; elle n'est jamais interprétée comme un recensement exhaustif.
- ADEME RGE ne couvre que cette famille de qualifications; l'absence de résultat ne vaut pas absence de certification.
- La matérialisation des enrichissements BI est définie pour Postgres mais le vertical slice utilise encore le cache Next.js.

### Tests exécutés

- `npm run lint`: succès.
- `npm run typecheck`: succès.
- `npm run test`: succès, 1 fichier, 3 tests.
- `python -m pytest backend/tests -q --basetemp=data/test-temp-osm`: succès, 6 tests Python.
- `python -m pytest backend/tests -q --basetemp=.pytest-tmp-website`: succès, 13 tests Python, dont robots, SSRF, JSON-LD, limites de texte et filtrage éditorial.
- `python -m pytest backend/tests -q --basetemp=.pytest-tmp-sirene-profile`: succès, 14 tests Python, dont la persistance des signaux unité légale et établissement.
- `python -m pytest backend/tests -q --basetemp=.pytest-tmp-rna-all`: succès, 18 tests Python, dont format RNA ultramarin, autorisation de publication web, dates, diagnostics SIRET et exclusion des champs personnels.
- `npm run test:e2e`: succès, 6 exécutions Playwright (3 parcours sur desktop et mobile), dont navigation dans finances et labels, événements, marchés publics et presse.
- `npm run build`: succès, routes `/`, `/admin`, API map/search et pages entreprises générées.
- Build après ajout OSM/RGE : succès, API `/api/companies/[siren]/intelligence` et pages entreprises SSR compilées.
- Build après ajout des sites publics : succès, onglet `Prestations`, API BI et pages entreprises SSR compilés.
- Build après extension SIRENE : succès, nouveau schéma SQLite, synthèse BI et pages entreprises SSR compilés.
- Build après ajout RNA : succès, index associatif, API BI, onglet conditionnel et pages entreprises SSR compilés.
- Contrôle visuel Playwright : fond cartographique, clusters, toolbar desktop et panneau mobile vérifiés en 1440×900 et 390×844.
- Contrôle visuel Playwright BI réel : tableau financier et profil public vérifiés en 1440×1000 et 390×844, sans débordement horizontal; captures `apps/web/test-results/company-bi-finances-{desktop,mobile}.png`.
- Contrôle visuel Playwright présence OSM et qualifications RGE réelles : desktop/mobile sans débordement, captures `company-bi-presence-*` et `company-bi-rge-*`.
- Contrôle visuel Playwright des prestations réelles : desktop/mobile sans débordement, captures `company-bi-services-{desktop,mobile}.png`; carte MapLibre vérifiée en 1440x900 dans `map-modern-desktop.png`.
- Contrôle visuel Playwright du profil SIRENE réel : société à mission et siège vérifiés en 1440x1000 et 412x915, sans débordement; captures `company-bi-sirene-{desktop,mobile}.png`.
- Contrôle visuel Playwright du profil RNA réel : objet, chronologie et concordance SIRET vérifiés en 1440x1000 et 412x915, sans débordement; captures `company-bi-rna-{desktop,mobile}.png`.
- API réelle Annuaire vérifiée pour le SIREN `440401974` : exercice financier, catégorie, effectif, nombre d'établissements, NAF 2025 et IDCC normalisés.
- Contrôle d'intégrité ZIP du stock INSEE : succès, aucune entrée corrompue.
- Compilation Python des scripts d'import et d'indexation : succès.
- `npm audit --audit-level=high`: succès au seuil high. Deux vulnérabilités modérées PostCSS restent liées à la dépendance interne de Next 16.2.10.
- Contrôle runtime final : page d'accueil `HTTP 200`; fournisseur ADEME réel vérifié avec 1 qualification active et 7 historiques pour le SIREN `839883915`.

### Limitations

- Le seed fictif reste uniquement un fallback de développement et n'est plus visible lorsque l'index réel est présent.
- 13 243 établissements actifs n'ont pas de position publiable; ils restent recherchables mais ne sont pas placés sur la carte.
- Le backend FastAPI, l'authentification, le RBAC et l'administration avancée sont scaffoldés/documentés mais pas encore industrialisés.
- Le runtime local utilise `node:sqlite`, expérimental dans Node 24; la production multi-instance doit utiliser PostGIS/Redis ou des tuiles vectorielles.
- Audit npm: vulnérabilité modérée PostCSS dans Next 16.2.10, sans échec au seuil high.

### Prochaines étapes

- Brancher les endpoints FastAPI/PostGIS réels.
- Implémenter les migrations Alembic et repositories.
- Matérialiser les enrichissements BI dans Postgres avec tâches de rafraîchissement observables.
- Industrialiser la file de géocodage des positions non restreintes manquantes.
- Ajouter l'authentification, les rôles et le workflow de revendication.
- Ajouter les tests E2E Playwright complets et les mesures de performance cartographique.

## Itération UX cartographique — 19 juillet 2026

### Réalisé

- Carte MapLibre maintenue en plein écran comme surface principale, avec l'archipel visible dès le premier écran.
- Panneau d'exploration desktop allégé et repliable; le bouton `Explorer` restaure recherche, filtres et liste sans rechargement.
- Expérience mobile reconstruite autour d'une recherche compacte et de contrôles tactiles, sans grand panneau masquant la carte.
- Filtres partagés restaurés depuis l'URL au chargement, compteurs formatés en français et effacement rapide de la recherche.
- Cadrage initial mobile recalculé pour conserver Grande-Terre, Basse-Terre, Marie-Galante, La Désirade et Les Saintes dans la zone utile.
- Contrôles MapLibre redondants masqués sur mobile; attribution OpenStreetMap/CARTO conservée.
- Aperçu au survol contraint aux limites de la carte pour éviter les débordements d'écran.
- En-tête produit et hiérarchie visuelle modernisés sans modifier le pipeline de données ni charger davantage d'établissements dans le navigateur.

### Fichiers modifiés

- `apps/web/src/app/page.tsx`
- `apps/web/src/components/map-explorer.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/src/types/lucide-react.d.ts`
- `PROGRESS.md`

### Décisions et limites

- La carte reste servie par bounding box et clusters; le redesign ne remplace pas les couches MapLibre par des marqueurs DOM.
- La vue liste complète et virtualisée demeure une prochaine étape; la liste actuelle sert la recherche et la synchronisation avec la carte.
- Le disque noir `N` visible uniquement en développement est l'indicateur Next.js Dev Tools et n'est pas présent dans le build de production.

### Validation

- `npm run typecheck`: succès.
- `npm run lint`: succès.
- `npm run test`: succès, 3 tests unitaires.
- `npm run test:e2e`: succès, 6 parcours Playwright desktop/mobile.
- `npm run build`: succès avec Next.js 16.2.10.
- Contrôle visuel réel en 1440x900 et 412x915; carte non blanche, archipel cadré, panneau desktop repliable et contrôles mobiles sans chevauchement.
- Captures: `apps/web/test-results/map-modern-desktop.png`, `map-modern-collapsed.png` et `map-modern-mobile-final.png`.

### Prochaine étape UX

- Ajouter un mode `Carte`, `Liste` et `Mixte` avec virtualisation de la liste, sans augmenter le payload initial.

## Enrichissement BI — conventions de subvention SCDL — 19 juillet 2026

### Réalisé

- Audit du catalogue officiel `scdl/subventions` de data.gouv.fr et des conditions de l'API Data.Subvention.
- Exclusion de Data.Subvention des fiches publiques en raison de son accès réservé aux agents habilités ou usagers authentifiés.
- Importeur idempotent des seuls CSV sous licence ouverte explicite, avec cache, limite de taille, validation de contenu, variantes d'encodage et d'en-têtes.
- Jointure exacte SIRET/RNA, rejet des conflits et ambiguïtés, déduplication par empreinte et conservation de toutes les occurrences sources.
- Index local de 396 conventions uniques, 401 occurrences et 23 SIREN, pour 25 171 274,38 € de montants attribués publiés entre 2015 et 2024.
- API BI enrichie avec état fournisseur `SCDL`, agrégats, périmètre de jointure, confiance, source, licence et fraîcheur.
- Onglet conditionnel `Subventions publiques`, avec avertissement sur les versements non prouvés et les anciens SIRET hors stock actif local.
- Migration PostgreSQL pour conventions et occurrences de provenance.

### Fichiers créés ou modifiés

- `scripts/import_public_grants.py`
- `backend/tests/test_public_grants_import.py`
- `apps/web/src/lib/public-grants-db.ts`
- `apps/web/src/lib/business-intelligence.ts`
- `apps/web/src/components/business-intelligence-panel.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/e2e/map.spec.ts`
- `db/migrations/008_public_grants.sql`
- `.env.example`
- `README.md`
- `BI_ENRICHMENT.md`
- `DATA_SOURCES.md`
- `DATA_MODEL.md`
- `IMPORT_PIPELINE.md`
- `DATA_QUALITY_REPORT.md`
- `ARCHITECTURE.md`
- `SECURITY.md`
- `BLOCKERS.md`
- `PROGRESS.md`

### Décisions

- Une convention rattachée à un ancien SIRET reste un signal de l'unité légale nationale, jamais une preuve d'attribution en Guadeloupe.
- Le montant SCDL est conservé brut : aucun recalcul n'est effectué lorsque le pourcentage multi-bénéficiaire est encodé de façon hétérogène.
- L'absence de convention est non concluante; l'onglet n'apparaît que lorsque des données existent, tandis que l'état source reste visible.
- Les 20 jeux sans licence spécifiée et les rapprochements par nom sont exclus.

### Tests et résultats

- Import initial : 46 téléchargements valides; second import : 46 ressources servies par cache, résultats identiques.
- Ressources : 53 jeux recensés, 33 ouverts, 52 CSV, 37 importés et 15 rejetés avec diagnostic.
- `python -m pytest backend/tests/test_public_grants_import.py -q`: succès, 4 tests.
- Suite Python complète avec `PYTHONPATH=backend;.` : succès, 22 tests.
- `python -m py_compile scripts/import_public_grants.py`: succès.
- `npm run typecheck`: succès.
- `npm run lint`: succès.
- `npm run test`: succès, 3 tests Vitest.
- `npm run test:e2e`: succès, 6 parcours desktop/mobile incluant le nouvel onglet.
- `npm run build`: succès, API BI, page entreprise SSR et index SCDL compilés.
- API réelle pour le SIREN `775672272`: 110 conventions, 17 083 525,49 €, 4 attribuants, 5 jeux sources et 110 SIRET hors stock actif local.
- Contrôle visuel réel desktop 1440x1000 et mobile 412x915 sans débordement; captures `company-bi-grants-desktop.png`, `company-bi-grants-mobile.png` et `company-bi-grants-mobile-row.png`.

### Limitations et prochaine étape

- La couverture SCDL est nationale mais très partielle, concentrée sur 23 unités légales disposant aussi d'une implantation active en Guadeloupe.
- Les comptes de paiement, dossiers de demande et données Data.Subvention restreintes ne sont pas collectés.
- Prochaine source à auditer : bénéficiaires d'aides ADEME ou France Relance sous licence ouverte et identifiant SIREN/SIRET, en gardant les conventions SCDL distinctes des marchés DECP.

## Enrichissement BI — aides financières ADEME — 19 juillet 2026

### Réalisé

- Audit de l'API et de l'export ouvert `Les aides financières de l'ADEME`, mis à jour le 18 juillet 2026.
- Import idempotent de 39 160 dossiers non confidentiels engagés depuis 2021, sans seuil de montant.
- Jointure de 897 aides avec 258 SIREN territoriaux par SIRET exact uniquement.
- Séparation de 264 dossiers sur SIRET actif guadeloupéen et 633 dossiers sur autre SIRET de l'unité légale.
- Calcul d'un montant engagé publié local de 27 339 525,60 €, distinct du cumul national de l'unité légale.
- Nouvel onglet conditionnel `Aides ADEME` avec objet, dispositif, montant, nature, décision, versement publié, périmètre, confiance, source et licence.
- Migration PostgreSQL et index SQLite dédié, sans fusion sémantique avec SCDL, DECP ou RGE.

### Fichiers créés ou modifiés

- `scripts/import_ademe_financial_aids.py`
- `backend/tests/test_ademe_financial_aids_import.py`
- `apps/web/src/lib/ademe-aids-db.ts`
- `apps/web/src/lib/business-intelligence.ts`
- `apps/web/src/components/business-intelligence-panel.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/e2e/map.spec.ts`
- `db/migrations/009_ademe_financial_aids.sql`
- `.env.example`
- documentation BI, sources, modèle, pipeline, architecture, sécurité, qualité et blocages.

### Décisions et limites

- `active_local_establishment` signifie que le SIRET du dossier figure dans le stock actif des 32 communes configurées; ce n'est pas une preuve que toutes les dépenses du projet ont lieu localement.
- `company_historical_establishment` reste un signal national de l'unité légale et n'entre jamais dans le montant local.
- Le montant décrit un engagement ADEME publié, pas le décaissement intégral; la date ou période de versement reste affichée telle que fournie.
- Les 294 lignes sans SIRET valide sont ignorées et aucun nom n'est utilisé en repli.

### Validation

- Import initial : export CSV téléchargé; second import : cache réutilisé avec 897 résultats identiques.
- `python -m pytest backend/tests/test_ademe_financial_aids_import.py -q`: succès, 2 tests.
- `python -m py_compile scripts/import_ademe_financial_aids.py`: succès.
- `npm run typecheck`: succès.
- `npm run lint`: succès.
- `npm run test:e2e`: succès, 6 parcours desktop/mobile incluant ADEME.
- API réelle SIREN `885188847`: 2 dossiers, dont 1 sur SIRET actif local pour 3 532 904,32 €.
- Contrôle visuel réel en 1440x1000 et 412x915, sans débordement; captures `company-bi-ademe-aids-desktop.png`, `company-bi-ademe-aids-mobile.png` et `company-bi-ademe-aids-mobile-row.png`.

### Prochaine étape

- Auditer les listes Fonds vert 2023-2025 et les bénéficiaires France Relance pour identifier les ressources disposant d'un SIREN/SIRET publiable avant toute nouvelle jointure.

## UX cartographique vectorielle et mode dégradé — 19 juillet 2026

### Réalisé

- La carte MapLibre reste l'expérience principale plein écran, avec panneau d'exploration flottant repliable sur desktop et barre compacte sur mobile.
- Remplacement du fond raster CARTO, instable dans certains contextes WebGL larges, par des styles vectoriels OpenFreeMap compatibles avec le périmètre ultramarin.
- Ajout d'un style local de secours chargé immédiatement : limites communales, clusters et données restent utilisables même si le fournisseur de fond ne répond pas.
- Réinjection idempotente de chaque source et couche métier après un changement de style, sans perdre les clusters lors d'une bascule clair/sombre rapide.
- Stabilisation des annulations de requêtes de bounding box et de recherche afin qu'elles ne remontent plus comme erreurs visibles.
- Maintien de l'attribution automatique OpenFreeMap, OpenMapTiles et OpenStreetMap sur les fonds vectoriels.

### Fichiers modifiés

- `apps/web/src/components/map-explorer.tsx`
- `apps/web/src/app/globals.css`
- `PROGRESS.md`

### Décisions et limites

- Le fond externe est un enrichissement visuel; les couches territoriales et économiques ne dépendent pas de sa disponibilité.
- Le service public OpenFreeMap n'offre pas de SLA. Une exploitation à fort trafic devra prévoir un fournisseur contractuel ou un hébergement interne des tuiles.
- Aucun marqueur DOM n'a été ajouté : les 115 920 positions publiables restent servies par bounding box et rendues dans les couches WebGL clusterisées.

### Validation

- `npm run test`: succès, 3 tests Vitest.
- `npm run typecheck`: succès.
- `npm run lint`: succès sans avertissement.
- `npm run test:e2e`: succès, 6 parcours Playwright desktop/mobile.
- `npm run build`: succès final avec Next.js 16.2.10 après la stabilisation MapLibre.
- Contrôle visuel 1440x960 et 412x915 : aucun débordement, carte et clusters visibles en clair, sombre et sans accès à OpenFreeMap.
- Captures finales : `apps/web/test-results/map-modern-final2-desktop.png`, `map-modern-final2-dark.png`, `map-modern-final2-mobile.png` et `map-modern-final2-fallback.png`.

### Prochaine étape UX

- Ajouter le sélecteur `Carte`, `Liste` et `Mixte` avec virtualisation de la vue liste et synchronisation bidirectionnelle du focus.

## Enrichissement BI — projets Fonds vert 2023-2025 — 19 juillet 2026

### Réalisé

- Audit du jeu officiel du ministère de la Transition écologique et de ses quatre exports CSV publiés sous Licence Ouverte 2.0.
- Import idempotent des exports Fonds vert 2023, 2024 et 2025; l'export biodiversité P113 2024 est exclu car il ne contient aucun SIREN ou SIRET.
- Lecture de 25 240 lignes sources, dont 25 027 identifiants syntaxiquement exploitables après normalisation contrôlée.
- Jointure exacte de 221 projets avec 57 SIREN présents dans le périmètre, sans rapprochement par nom.
- Séparation entre périmètre de rattachement et lieu déclaré du projet : 120 projets codés en Guadeloupe pour 31 441 035,21 EUR, 101 hors Guadeloupe pour 14 482 689,13 EUR.
- Identification de 75 projets rattachés à un SIRET actif local, pour 15 593 210,74 EUR d'engagements publiés.
- Index SQLite, migration PostgreSQL, API BI et onglet conditionnel `Fonds vert` avec projet, dispositif, millésime, montant, localisation, opérateur, numéro de dossier, périmètre de jointure, confiance, source et licence.
- Cache par ressource, métadonnées de provenance, limite de taille, contrôle du type de contenu et remplacement atomique de la base et du rapport.

### Fichiers créés ou modifiés

- `scripts/import_fonds_vert_projects.py`
- `backend/tests/test_fonds_vert_import.py`
- `apps/web/src/lib/fonds-vert-db.ts`
- `apps/web/src/lib/business-intelligence.ts`
- `apps/web/src/components/business-intelligence-panel.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/e2e/map.spec.ts`
- `db/migrations/010_fonds_vert_projects.sql`
- `data/fonds-vert-projects.sqlite`
- `data/fonds-vert-projects.report.json`
- `.env.example`
- documentation générale, BI, sources, modèle, pipeline, architecture, sécurité, qualité et blocages.

### Décisions et limites

- Le montant publié correspond à un engagement juridique ou comptable et ne prouve pas le paiement effectif.
- Le code commune peut désigner la commune du bénéficiaire plutôt que le lieu exact du projet; les deux dimensions sont donc conservées sans extrapolation.
- Les projets rejetés ou retirés ne figurent pas dans la source et l'absence de résultat n'est pas interprétée comme une absence d'aide.
- Les projets rattachés à un autre établissement de la même unité légale restent des signaux nationaux et n'entrent pas dans le montant local.
- Les données dépourvues d'identifiant exact et les correspondances par nom sont exclues.

### Validation

- Trois exécutions de l'import ont produit les mêmes 221 projets; les exécutions suivantes ont réutilisé les trois fichiers en cache.
- `python -m pytest backend/tests -q --basetemp=.pytest-tmp-all-fonds-vert`: succès, 27 tests.
- `npm run test`: succès, 3 tests Vitest.
- `npm run typecheck`: succès.
- `npm run lint`: succès sans avertissement.
- `npm run test:e2e`: succès, 6 parcours Playwright desktop/mobile.
- `npm run build`: succès avec Next.js 16.2.10.
- API réelle SIREN `429658271`: un projet local 2024 de 413 000 EUR, joint par le SIRET actif `42965827100011` à Baie-Mahault.
- Contrôle visuel desktop et mobile sans débordement; captures `company-bi-fonds-vert-desktop.png`, `company-bi-fonds-vert-desktop-row.png`, `company-bi-fonds-vert-mobile.png` et `company-bi-fonds-vert-mobile-row.png`.

### Prochaine étape

- Auditer les jeux France Relance et n'intégrer que les ressources ouvertes disposant d'un identifiant SIREN ou SIRET exact et d'une sémantique de montant documentée.

## Enrichissement BI — projets industriels France Relance — 19 juillet 2026

### Réalisé

- Audit des huit jeux de l'organisation France Relance sur data.gouv.fr et exclusion des ressources uniquement agrégées au département, inutilisables pour une fiche entreprise.
- Qualification du jeu DGE `Plan de relance - Projets industriels`, sous Licence Ouverte 2.0, mis à jour le 8 avril 2022.
- Import idempotent de 3 080 lignes, dont 3 024 identifiants SIREN/SIRET valides et 56 lignes rejetées sans identifiant exploitable.
- Jointure exacte de 33 projets avec 25 SIREN présents dans le stock territorial, sans rapprochement par nom.
- Séparation de 12 projets localisés en Guadeloupe et 21 projets hors Guadeloupe liés à des unités légales également implantées dans l'archipel.
- Conservation de 21 descriptions publiques de projet, 7 mesures, 12 filières et 4 indicateurs CO2, sans convertir ces textes en descriptions commerciales ou prestations.
- Index SQLite, migration PostgreSQL/PostGIS, cache de ressource, rapport de couverture et nouvel onglet conditionnel `France Relance` dans la fiche entreprise.
- API enrichie avec bénéficiaire, type d'entreprise, volet, mesure, filière, description, date, localisation, coordonnées, identifiant exact, confiance, provenance et licence.

### Fichiers créés ou modifiés

- `scripts/import_france_relance_industrial_projects.py`
- `backend/tests/test_france_relance_import.py`
- `apps/web/src/lib/france-relance-db.ts`
- `apps/web/src/lib/business-intelligence.ts`
- `apps/web/src/components/business-intelligence-panel.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/e2e/map.spec.ts`
- `db/migrations/011_france_relance_industrial_projects.sql`
- `data/france-relance-industrial-projects.sqlite`
- `data/france-relance-industrial-projects.report.json`
- `.env.example`
- documentation générale, BI, sources, modèle, pipeline, architecture, sécurité, qualité et blocages.

### Décisions et limites

- Le jeu identifie des projets lauréats mais ne publie aucun montant individuel; aucune somme n'est inventée, estimée ou agrégée.
- Les descriptions de projets collaboratifs peuvent citer plusieurs partenaires et restent donc cantonnées à l'onglet projet; elles ne remplacent jamais la description de l'entreprise.
- La localisation du projet et la présence de l'unité légale en Guadeloupe sont deux dimensions distinctes.
- La source date de 2022 : sa fraîcheur est affichée et l'absence de ligne ne prouve pas l'absence d'un autre soutien France Relance.
- Les jeux départementaux `Industrie du futur` et `Chèque France Num` sont exclus des fiches individuelles car ils ne publient pas les bénéficiaires avec identifiant exact.

### Validation

- Première exécution : ressource téléchargée; seconde exécution : cache réutilisé et 33 projets reproduits à l'identique.
- `python -m pytest backend/tests -q --basetemp=.pytest-tmp-all-france-relance`: succès, 30 tests.
- `python -m py_compile scripts/import_france_relance_industrial_projects.py`: succès.
- `npm run test`: succès, 3 tests Vitest.
- `npm run typecheck`: succès.
- `npm run lint`: succès sans avertissement.
- `npm run test:e2e`: succès, 6 parcours Playwright desktop/mobile incluant le nouvel onglet.
- `npm run build`: succès avec Next.js 16.2.10.
- API réelle SIREN `402249783`: un projet local CHLOREX INDUSTRIE, une description publique, filière `Chimie et Matériaux`, jointure SIREN exacte à 99 % et aucun montant exposé.
- Contrôle visuel réel en 1440x1000 et 412x915, sans débordement horizontal; captures `company-bi-france-relance-desktop.png` et `company-bi-france-relance-mobile.png`.

### Prochaine étape

- Auditer les données publiques de propriété intellectuelle, certifications et appels à projets France 2030 disposant d'un SIREN/SIRET exact, sans collecter de titulaires personnes physiques ni utiliser de rapprochement nominatif.

## Enrichissement BI — organismes de formation et qualité — 19 juillet 2026

### Réalisé

- Audit de la Liste publique des organismes de formation du ministère du Travail, publiée conformément à l'article L.6351-7-1 du Code du travail et mise à jour quotidiennement sous Licence Ouverte.
- Import idempotent de 164 453 profils, tous munis d'un SIREN/SIRET syntaxiquement exploitable dans le snapshot du 18 juillet 2026.
- Jointure exacte de 1 410 profils avec 1 404 entreprises du stock territorial, sans rapprochement par nom.
- Identification de 1 235 déclarations rattachées à la Guadeloupe et 1 192 profils sur SIRET actif local; 175 profils hors Guadeloupe restent des signaux nationaux de l'unité légale.
- Conservation de 491 profils avec certification qualité active publiée : 486 actions de formation, 39 bilans de compétences, 60 VAE et 65 actions par apprentissage.
- Conservation de 1 317 profils avec spécialités NSF et de 1 410 profils avec agrégats stagiaires/formateurs du dernier bilan pédagogique et financier.
- Nouvel onglet conditionnel `Formation` avec NDA, catégories qualité, spécialités, période BPF, volumes déclarés, périmètre, confiance, source, licence et fraîcheur.
- Minimisation à l'import : dénominations, rues, contacts et informations sur les organismes étrangers représentés exclus.
- Normalisation des anciens NDA avec déduplication et retrait du numéro actif lorsqu'il est répété par la source.

### Fichiers créés ou modifiés

- `scripts/import_training_organizations.py`
- `backend/tests/test_training_organizations_import.py`
- `apps/web/src/lib/training-organizations-db.ts`
- `apps/web/src/lib/business-intelligence.ts`
- `apps/web/src/components/business-intelligence-panel.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/e2e/map.spec.ts`
- `db/migrations/012_training_organization_profiles.sql`
- `data/training-organizations.sqlite`
- `data/training-organizations.report.json`
- `.env.example`
- documentation générale, BI, sources, modèle, pipeline, architecture, sécurité, qualité et blocages.

### Décisions et limites

- La présence dans la liste indique une déclaration d'activité et une obligation BPF à jour selon le ministère; elle ne garantit pas qu'une formation précise soit ouverte actuellement.
- Les spécialités, stagiaires et formateurs restent attribués à la période BPF publiée et ne décrivent ni l'offre en temps réel ni l'effectif salarié.
- Une catégorie qualité est affichée uniquement lorsqu'elle vaut explicitement `true` dans le snapshot; une valeur vide n'est pas transformée en certification.
- Les 13 profils reliés dont le NDA est inexploitable sont ignorés avec diagnostic.
- Un SIRET hors stock territorial actif reste un signal de l'unité légale nationale et n'est pas présenté comme une implantation locale.

### Validation

- Première exécution : export quotidien téléchargé; seconde et troisième exécutions : cache réutilisé et 1 410 profils reproduits à l'identique.
- `python -m pytest backend/tests -q --basetemp=.pytest-tmp-all-training`: succès, 33 tests.
- `python -m py_compile scripts/import_training_organizations.py`: succès.
- `npm run test`: succès, 3 tests Vitest.
- `npm run typecheck`: succès.
- `npm run lint`: succès sans avertissement.
- `npm run test:e2e`: succès, 6 parcours Playwright desktop/mobile incluant l'onglet Formation.
- `npm run build`: succès avec Next.js 16.2.10.
- API réelle SIREN `498212349`: INSTITUT FORMELEC, NDA `95970143397`, 2 catégories qualité, 3 spécialités NSF, 2 211 stagiaires, 774 confiés et 40 formateurs sur l'exercice publié.
- Contrôle visuel réel en 1440x1000 et 412x915 sans débordement horizontal; captures `company-bi-training-desktop.png` et `company-bi-training-mobile.png`.

### Prochaine étape

- Auditer l'Index égalité professionnelle femmes-hommes, qui publie des scores annuels par SIREN pour les entreprises d'au moins 50 salariés, puis le croiser sans exposer d'informations individuelles sur les salariés.

## Enrichissement BI — Index de l'égalité professionnelle — 19 juillet 2026

### Réalisé

- Audit du jeu Egapro officiel du ministère du Travail, sous Licence Ouverte 2.0, mis à jour le 18 juillet 2026.
- Lecture contrôlée de 214 040 déclarations de référence 2018-2025; tous les SIREN déclarants sont syntaxiquement valides dans le snapshot.
- Jointure exacte de 2 492 lignes sources et publication de 2 653 rattachements annuels couvrant 460 entreprises du stock territorial.
- Séparation de 2 307 rattachements au SIREN déclarant et 346 rattachements à un SIREN membre d'UES explicitement publié.
- Conservation de 2 210 index calculables et 443 index `NC`, sans transformer les cellules non applicables en zéro.
- Conservation des six indicateurs agrégés, de la tranche d'effectifs, de l'activité NAF et de la localisation du déclarant; exclusion des raisons sociales source, salariés, rémunérations et contacts.
- Nouvel onglet conditionnel `Égalité F/H` avec dernier score calculable, évolution, repères 75/85, historique annuel, indicateurs, contexte UES, méthode, fraîcheur et source.
- Index SQLite atomique, migration PostgreSQL, cache XLSX, rapport de couverture et fournisseur API avec statut propre.

### Fichiers créés ou modifiés

- `scripts/import_professional_equality_index.py`
- `backend/tests/test_professional_equality_import.py`
- `apps/web/src/lib/professional-equality-db.ts`
- `apps/web/src/lib/business-intelligence.ts`
- `apps/web/src/components/business-intelligence-panel.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/e2e/map.spec.ts`
- `db/migrations/013_professional_equality_index.sql`
- `data/professional-equality-index.sqlite`
- `data/professional-equality-index.report.json`
- `data/imports/professional-equality/`
- `backend/pyproject.toml`
- `.env.example`
- `README.md`, `BI_ENRICHMENT.md`, `DATA_SOURCES.md`, `DATA_MODEL.md`, `IMPORT_PIPELINE.md`, `ARCHITECTURE.md`, `SECURITY.md`, `BLOCKERS.md`, `DATA_QUALITY_REPORT.md` et `PROGRESS.md`.

### Décisions et limites

- Le SIREN déclarant exact reçoit une confiance de 1,00; un membre d'UES explicitement listé reçoit 0,99 et le caractère collectif du score reste visible.
- L'année du fichier est présentée comme année de référence, sans inventer une date de publication individuelle.
- Le dernier score calculable peut être antérieur à la dernière déclaration lorsque celle-ci est `NC`; les deux informations restent visibles dans l'historique.
- Les repères 75 et 85 contextualisent la méthode légale mais l'application ne qualifie pas automatiquement une conformité, une discrimination ou une situation personnelle.
- Les 2 106 rattachements dont le déclarant est localisé hors Guadeloupe restent des signaux de l'unité légale ou de l'UES nationale; seuls 547 sont localisés en Guadeloupe selon la déclaration.

### Validation

- Second import avec cache : 2 653 rattachements et 460 entreprises reproduits à l'identique; aucun score invalide.
- Suite Python complète : 36 tests réussis.
- Vitest : 3 tests réussis.
- `npm run typecheck` : succès.
- `npm run lint` : succès sans avertissement.
- Playwright : 6 parcours desktop/mobile réussis, incluant le nouvel onglet et les états calculable/NC.
- `npm run build` : succès avec Next.js 16.2.10, page entreprise rendue côté serveur et API BI compilée.
- API réelle SIREN `314560822` : cinq déclarations directes, dernier score calculable 99/100 pour 2025 et évolution de +15 points par rapport à 2024.
- Contrôle visuel réel en 1440x1000 et 412x915, sans débordement horizontal; captures `apps/web/test-results/company-bi-equality-desktop.png` et `company-bi-equality-mobile.png`.

### Prochaine étape

- Auditer les données ouvertes des conventions collectives par SIRET et les dispositifs France 2030 disposant d'identifiants exacts, en maintenant une frontière stricte entre droit applicable, signal de financement et description commerciale.

## Enrichissement BI — conventions collectives et OPCO — 19 juillet 2026

### Réalisé

- Audit des jeux officiels du ministère du Travail `SIRET-IDCC` et de France compétences `SIRO SIRET-OPCO`, tous deux sous Licence Ouverte 2.0.
- Analyse de 2 370 794 lignes IDCC nationales et 3 564 342 lignes SIRO.
- Import exact de 13 135 déclarations IDCC couvrant 12 109 établissements et 11 232 entreprises territoriales.
- Import de 17 327 rattachements SIRO couvrant 16 080 entreprises; 16 437 attributions OPCO et 890 anomalies déclaratives conservées séparément.
- Couverture unifiée de 16 520 entreprises, sans jointure nominative.
- Conservation de 8 981 IDCC substantifs, 4 154 codes d'état, 271 IDCC distincts et 910 établissements multi-IDCC.
- Enrichissement par 390 entrées du paquet officiel `@socialgouv/kali-data` 3.479.0; 7 549 lignes portent un titre KALI et un lien Légifrance.
- Détection de 765 écarts IDCC entre les SIRET communs aux deux millésimes, sans arbitrage automatique.
- Nouvel onglet conditionnel `Conventions & OPCO` avec chronologie, lecture par établissement, OPCO propriétaire/gestionnaire, anomalies, provenance et avertissement juridique.
- Index SQLite atomique, migration PostgreSQL, cache contrôlé des trois ressources et fournisseur API en lecture seule.

### Fichiers créés ou modifiés

- `scripts/import_collective_agreements.py`
- `backend/tests/test_collective_agreements_import.py`
- `apps/web/src/lib/collective-agreements-db.ts`
- `apps/web/src/lib/business-intelligence.ts`
- `apps/web/src/components/business-intelligence-panel.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/e2e/map.spec.ts`
- `db/migrations/014_collective_agreements_opco.sql`
- `data/collective-agreements.sqlite`
- `data/collective-agreements.report.json`
- `data/imports/collective-agreements/`
- `.env.example`
- `README.md`, `BI_ENRICHMENT.md`, `DATA_SOURCES.md`, `DATA_MODEL.md`, `IMPORT_PIPELINE.md`, `ARCHITECTURE.md`, `SECURITY.md`, `BLOCKERS.md`, `DATA_QUALITY_REPORT.md` et `PROGRESS.md`.

### Décisions et limites

- Les mois mai 2026 pour l'IDCC et avril 2026 pour SIRO restent visibles et ne sont pas fusionnés en une vérité artificielle.
- Tous les IDCC déclarés sont conservés; aucune convention principale n'est choisie arbitrairement.
- Les codes 5100, 5501, 9998 et 9999 sont des états déclaratifs et non des titres de conventions.
- L'OPCO propriétaire et l'OPCO gestionnaire sont deux rôles distincts; l'interface explique la gestion territoriale par AKTO.
- Les déclarations DSN peuvent être retardées et ne constituent pas, seules, un avis sur le texte juridiquement applicable.
- 49 lignes IDCC et 74 lignes SIRO à diffusion restreinte sont exclues; aucun salarié, nom personnel ou contact n'est conservé.

### Validation

- Deuxième import avec cache : volumes et agrégats reproduits à l'identique.
- Suite Python complète : 40 tests réussis.
- Vitest : 3 tests réussis.
- `npm run typecheck` : succès.
- `npm run lint` : succès sans avertissement.
- Playwright : 6 parcours desktop/mobile réussis, incluant le nouvel onglet, les IDCC multiples et la distinction OPCO propriétaire/gestionnaire.
- `npm run build` : succès avec Next.js 16.2.10; page entreprise SSR et API BI compilées.
- API réelle SIREN `352808042` : quatre IDCC titrés, OPCO2I propriétaire et AKTO gestionnaire territorial pour le SIRET actif de TRANSBETON à Lamentin.
- Contrôle visuel réel en 1440x1100 et 390x844, sans débordement horizontal; captures `apps/web/test-results/company-bi-agreements-desktop.png` et `company-bi-agreements-mobile.png`.

### Prochaine étape

- Auditer les jeux France 2030 et les données de propriété industrielle qui publient un SIREN/SIRET exact, sans importer de titulaires personnes physiques ni transformer un projet en description commerciale.

## Enrichissement BI — portefeuilles de brevets — 19 juillet 2026

### Réalisé

- Audit des données de propriété industrielle et des jeux France 2030 à identifiants exacts.
- Sélection des quatre jeux MESRE/PATSTAT `Déposants`, `Demandes`, `Familles` et `Technologies des familles de brevets`, tous sous Licence Ouverte 2.0.
- Exclusion du jeu de 2,9 Go `Marques françaises`, dont la licence n'était pas spécifiée sur data.gouv.fr lors de l'audit.
- Lecture de 949 226 lignes de déposants, dont 831 609 avec SIREN valide, sans jointure nominative.
- Publication de 66 233 demandes et 19 588 rattachements entreprise-famille couvrant 70 unités légales territoriales.
- Conservation de 11 223 familles octroyées, 15 178 familles internationales, 19 588 titres, 19 574 résumés et 136 833 classifications CIB.
- Enrichissement ciblé par 58 135 clés de demandes et 17 258 familles DOCDB, sans télécharger les jeux compagnons complets.
- Cache versionné des réponses API; deuxième import reproduit exactement tous les volumes sans nouvel appel réseau.
- Nouvel onglet conditionnel `Brevets & innovation` avec métriques, empreinte technologique, titres, résumés, dates, octrois, portée internationale, codes CIB et liens scanR.
- Portefeuille explicitement qualifié au niveau national de l'unité légale; aucune invention n'est attribuée arbitrairement à l'établissement guadeloupéen.
- Affichage borné aux 20 familles les plus récentes et agrégats exhaustifs côté serveur pour les portefeuilles de plusieurs milliers de familles.

### Fichiers créés ou modifiés

- `scripts/import_patent_portfolios.py`
- `backend/tests/test_patent_portfolios_import.py`
- `apps/web/src/lib/patent-portfolios-db.ts`
- `apps/web/src/lib/business-intelligence.ts`
- `apps/web/src/components/business-intelligence-panel.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/src/types/lucide-react.d.ts`
- `apps/web/e2e/map.spec.ts`
- `db/migrations/015_patent_portfolios.sql`
- `data/patent-portfolios.sqlite`
- `data/patent-portfolios.report.json`
- `data/imports/patent-portfolios/`
- `.env.example`
- documentation générale, BI, sources, modèle, pipeline, architecture, sécurité, qualité et blocages.

### Décisions et limites

- La famille DOCDB représente l'invention; les demandes auprès de plusieurs offices restent des objets liés et ne gonflent pas le nombre d'inventions.
- Les familles partagées sont rattachées à chaque unité légale déposante exacte, d'où 17 258 familles sources pour 19 588 relations entreprise-famille.
- Les résumés sont des textes techniques publics et ne deviennent jamais une description commerciale ou une liste de prestations.
- Le jeu source indique que les personnes physiques ne sont normalement pas incluses; l'import ajoute une barrière stricte en ne retenant que les SIREN exacts de personnes morales actives et publiables.
- Les données PATSTAT/SIREN ne sont pas exhaustives et les familles détaillées sont moins fraîches que les déposants; chaque date source reste affichée.
- Les portefeuilles du CNRS, d'Orange ou d'EDF sont nationaux même lorsque ces unités légales disposent d'une implantation en Guadeloupe.

### Validation

- Deuxième import : 19 588 familles, 66 233 demandes et 136 833 classifications reproduites; trois caches API réutilisés intégralement.
- Suite Python complète : 44 tests réussis.
- Vitest : 3 tests réussis.
- `npm run typecheck` : succès.
- `npm run lint` : succès sans avertissement.
- Playwright : 6 parcours desktop/mobile réussis, incluant le nouvel onglet, l'octroi, la portée internationale et l'avertissement territorial.
- `npm run build` : succès avec Next.js 16.2.10; page entreprise SSR et API BI compilées.
- API réelle SIREN `483700282` : PHYTOBOKAZ, 4 familles, 14 demandes, 3 familles octroyées, 3 internationales et 34 classifications.
- Test grand portefeuille SIREN `180089013` : 9 337 familles agrégées et réponse bornée aux familles récentes.
- Contrôle visuel réel en 1440x1100 et 390x844, sans débordement horizontal; captures `apps/web/test-results/company-bi-patents-desktop.png` et `company-bi-patents-mobile.png`.

### Prochaine étape

- Importer les ratios financiers BCE/INPI par SIREN pour compléter le compte de résultat par marges, endettement, liquidité, autonomie financière, BFR et capacité de remboursement, avec année et type de bilan explicites.

## Enrichissement BI — ratios financiers BCE/INPI — 19 juillet 2026

### Réalisé

- Audit du jeu officiel DGE `Ratios Financiers (BCE / INPI)`, issu des comptes RNCS fournis par l'INPI et transformés par BCE/DNUM, sous Licence Ouverte 2.0.
- Validation de 23 champs, 19 indicateurs et de leurs formules officielles distinctes pour bilans complets/consolidés et simplifiés.
- Import ciblé des 109 825 SIREN actifs et diffusables du stock territorial, sans envoyer les 10 883 SIREN actifs à diffusion restreinte à l'API source.
- Publication de 35 009 exercices couvrant 9 281 entreprises : 21 563 bilans complets, 13 213 simplifiés et 233 consolidés.
- Conservation des 7 526 statuts de diffusion partielle; masquage API du chiffre d'affaires, de la marge brute, de l'EBE et de l'EBIT afin de ne pas transformer des zéros techniques en montants réels.
- Déduplication de 213 répétitions sources strictement identiques, sans conflit de métrique.
- Cache compressé par lot/version source, import reprenable et publication SQLite atomique avec rapport de couverture.
- Migration PostgreSQL, lecteur serveur borné et fournisseur BI `Ratios financiers` avec statut de source autonome.
- Nouvel onglet conditionnel `Analyse financière` : choix du type C/S/K, exercice, indicateurs principaux, tendance réelle, structure financière, cycle d'exploitation, confidentialité, formules officielles, périmètre et fraîcheur.
- Conservation du panneau Annuaire existant sous `Profil & labels`; aucune source n'est écrasée ou fusionnée silencieusement.

### Fichiers créés ou modifiés

- `scripts/import_financial_ratios.py`
- `backend/tests/test_financial_ratios_import.py`
- `apps/web/src/lib/financial-ratios-db.ts`
- `apps/web/src/lib/business-intelligence.ts`
- `apps/web/src/components/business-intelligence-panel.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/src/types/lucide-react.d.ts`
- `apps/web/e2e/map.spec.ts`
- `db/migrations/016_financial_ratios.sql`
- `data/financial-ratios.sqlite`
- `data/financial-ratios.report.json`
- `data/imports/financial-ratios/chunks/`
- `.env.example`
- `README.md`, `BI_ENRICHMENT.md`, `DATA_SOURCES.md`, `DATA_MODEL.md`, `IMPORT_PIPELINE.md`, `ARCHITECTURE.md`, `SECURITY.md`, `BLOCKERS.md`, `DATA_QUALITY_REPORT.md` et `PROGRESS.md`.

### Décisions et limites

- Les comptes décrivent l'unité légale nationale portant le SIREN; aucune valeur n'est attribuée à l'établissement guadeloupéen sans ventilation source.
- Les bilans C, S et K d'une même date sont des observations distinctes. L'interface n'affiche qu'une série homogène à la fois.
- Les valeurs brutes confidentielles restent auditables dans l'index hors ligne, mais l'API publique les remplace par `null` et explique la diffusion partielle.
- Les clôtures postérieures à la fraîcheur source sont marquées `future_closing_date` et exclues de la série par défaut. Aucune n'a été trouvée dans le sous-ensemble territorial actuel.
- L'interface ne colore aucun ratio comme bon ou mauvais et ne calcule ni score de crédit, ni solvabilité, ni recommandation.
- La couverture de 9 281 entreprises est mesurée, non exhaustive; une absence de comptes dans ce jeu ne prouve aucune situation économique.

### Validation

- Premier import : 733 lots, 783 appels paginés, zéro retry, 35 009 exercices publiés en 71,4 secondes.
- Second import : 733 lots servis depuis le cache, zéro appel réseau, mêmes agrégats en 6,4 secondes.
- Suite Python complète : 48 tests réussis.
- Vitest : 3 tests réussis.
- `npm run typecheck` : succès.
- `npm run lint` : succès sans avertissement.
- Playwright : 6 parcours desktop/mobile réussis, incluant sélection de type, exercice confidentiel et avertissement de non-notation.
- `npm run build` : succès avec Next.js 16.2.10; page entreprise SSR et API BI compilées.
- API réelle TRANSBETON `352808042` : 9 exercices publics; exercice 2024 à 16 710 965 € de chiffre d'affaires, 810 752 € d'EBE et 415 919 € de résultat net.
- API réelle PHYTOBOKAZ `483700282` : 8 exercices, dont 6 partiellement confidentiels; chiffre d'affaires et EBE 2024 masqués, résultat net publié à -139 367 € conservé.
- API réelle ORANGE `380129866` : 20 exercices servis avec séries S et K distinctes.
- Contrôle visuel réel en 1440x1100 et 390x844, sans débordement horizontal; captures `apps/web/test-results/company-bi-financial-desktop.png` et `company-bi-financial-mobile.png`.

### Prochaine étape

- Auditer les dépôts de comptes et actes INPI/RNE complémentaires accessibles sous licence et canal officiels, puis enrichir uniquement les documents rattachables par identifiant exact sans dupliquer les ratios BCE ni exposer de personne physique.

## Enrichissement BI — bilans financiers détaillés BCE/INPI — 19 juillet 2026

### Réalisé

- Audit des canaux RNE/INPI : accès documentaire authentifié et risque de données personnelles; actes et PDF explicitement exclus.
- Sélection du jeu ouvert Signaux Faibles `Données financières détaillées des entreprises`, Licence Ouverte 2.0, 6 368 964 lignes et 2,82 Go.
- Téléchargement HTTP reprenable en 48 segments avec quatre travailleurs, contrôle `Content-Range`, taille et signatures Parquet.
- Extraction DuckDB des 109 825 SIREN actifs diffusables et publication atomique de 34 020 exercices pour 9 087 entreprises.
- Dérivation de 24 agrégats à partir des formulaires DGFiP 2050–2051 et 2033, en conservant C, S et K séparés.
- Détection et exclusion de 3 943 cellules saturées aux bornes INT32; aucune valeur artificielle n'est exposée.
- Lecteur serveur borné sans `liasse_json`, fournisseur BI autonome `Bilans détaillés` et masquage du compte de résultat à diffusion partielle.
- UX financière responsive : composition du bilan, compte de résultat détaillé, sources DGFiP, correspondance exacte d'exercice et support des liasses sans ratio.

### Fichiers créés ou modifiés

- `scripts/import_detailed_financial_statements.py`
- `backend/tests/test_detailed_financial_statements_import.py`
- `apps/web/src/lib/detailed-financial-statements-db.ts`
- `apps/web/src/lib/business-intelligence.ts`
- `apps/web/src/components/business-intelligence-panel.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/e2e/map.spec.ts`
- `db/migrations/017_detailed_financial_statements.sql`
- `data/detailed-financial-statements.sqlite`
- `data/detailed-financial-statements.report.json`
- `.env.example`
- `README.md`, `ARCHITECTURE.md`, `BI_ENRICHMENT.md`, `DATA_SOURCES.md`, `DATA_MODEL.md`, `IMPORT_PIPELINE.md`, `SECURITY.md`, `BLOCKERS.md`, `DATA_QUALITY_REPORT.md` et `PROGRESS.md`.

### Décisions et limites

- Les comptes appartiennent à l'unité légale nationale; aucune ventilation locale n'est inventée.
- Les cellules fiscales brutes restent hors ligne et ne font pas partie du contrat API.
- Le compte de résultat détaillé est intégralement masqué en diffusion partielle; le bilan reste affiché lorsqu'il est publiable.
- Les valeurs saturées INT32 sont considérées absentes, jamais extrapolées.
- L'absence de liasse ou de métrique n'est pas interprétée comme un signal financier.

### Validation

- Import initial : 34 020 exercices, 9 087 entreprises, zéro ligne invalide, doublon, conflit ou date future.
- Import rejoué depuis le cache territorial : mêmes agrégats, zéro appel réseau.
- Suite Python complète : 53 tests réussis.
- Vitest : 3 tests réussis.
- `npm run typecheck` et `npm run lint` : succès.
- Playwright : 6 parcours desktop/mobile réussis, incluant carte, filtres URL et bilan détaillé confidentiel.
- `npm run build` : succès avec Next.js 16.2.10; API BI et page entreprise SSR compilées.
- API TRANSBETON : 9 exercices détaillés, bilan 2024 de 6 237 507 €; aucune cellule brute exposée.
- API PHYTOBOKAZ : bilan 2024 visible, compte de résultat détaillé masqué.
- Contrôle visuel réel en 1440x1100 et 412x915, sans débordement; captures `company-bi-detailed-desktop.png` et `company-bi-detailed-mobile.png`.

### Prochaine étape

- Étendre l'enrichissement uniquement avec des sources ouvertes à identifiants exacts; tout accès documentaire INPI devra être authentifié, minimisé et précédé d'une analyse des données personnelles.

## Recentrage UX cartographique — 19 juillet 2026

### Réalisé

- Correction du premier rendu vide : MapLibre charge maintenant directement le style vectoriel au lieu d'initialiser un canevas local puis de reconstruire le contexte WebGL.
- Remplacement du style clair OpenFreeMap Positron par Liberty, seul style clair testé qui conserve routes, terres et libellés de la Guadeloupe au zoom d'ensemble mobile.
- Mode sombre aligné sur le style OpenFreeMap Fiord.
- Panneau d'exploration réduit à une commande compacte au repos; la liste n'est rendue que lorsqu'une recherche est active.
- Hiérarchie simplifiée autour de la recherche, du nombre visible, des filtres et des actions de carte.
- Légende cartographique compacte sur desktop et provenance conservée sur mobile sans recouvrir l'attribution OpenStreetMap.
- Cadrage mobile recalculé avec des limites de navigation élargies afin d'afficher Basse-Terre, Grande-Terre, Marie-Galante, La Désirade et Les Saintes dans la vue initiale.

### Fichiers modifiés

- `apps/web/src/components/map-explorer.tsx`
- `apps/web/src/app/globals.css`
- `PROGRESS.md`
- `BLOCKERS.md`

### Décisions et limites

- Les styles OpenFreeMap Positron et Bright ont été écartés après contrôle visuel : les terres ultramarines disparaissent au zoom mobile d'ensemble, malgré des tuiles servies avec succès.
- Le fond public OpenFreeMap reste sans SLA; l'attribution OpenFreeMap, OpenMapTiles et OpenStreetMap est conservée.
- Les établissements restent servis par bounding box et regroupés dans des couches WebGL; aucun marqueur React ou DOM massif n'a été introduit.

### Validation

- `npm run typecheck --workspace @guad/web` : succès.
- `npm run lint --workspace @guad/web` : succès sans avertissement.
- Vitest : 3 tests réussis.
- Playwright : 6 parcours desktop/mobile réussis (carte, recherche, filtres URL, sélection et fiche BI).
- `npm run build --workspace @guad/web` : succès avec Next.js 16.2.10; page d'accueil statique, fiche entreprise SSR et API dynamiques compilées.
- Contrôle visuel Playwright en 1440x900 et Pixel 7 : fond territorial, archipel, clusters, panneau compact et attribution vérifiés.
- Captures : `ux-map-modern-desktop.png` et `ux-map-modern-mobile.png`.

### Prochaine étape

- Reprendre l'enrichissement des profils et la recherche universelle sans modifier cette surface cartographique validée.

## Enrichissement BI — profil d’activité et mandats publics — 19 juillet 2026

### Réalisé

- Audit de l'API officielle Recherche d'entreprises et de son exposition publique des dirigeants issus du RNE.
- Import exact par SIREN avec `scripts/import_public_officers_guadeloupe.py`, reprise `--resume`, journal `fetch_log`, FTS5 et métadonnées de couverture.
- Lot local contrôlé : 1 357 SIREN réussis sur 120 710 et 1 585 mandats publics; les 119 353 SIREN restants ne sont pas présentés comme couverts.
- Minimisation à l'import : identité affichée et qualité du mandat uniquement; dates de naissance, nationalité, adresses, contacts et bénéficiaires effectifs exclus.
- Recherche universelle : index local des personnes publiques, recherche accent-insensible, résultats marqués `mandat public`, et fallback borné vers l'API officielle pour les requêtes textuelles.
- Fiche BI : gouvernance publique distincte d'un organigramme opérationnel, avec type de dirigeant, rôle, personne morale liée et date RNE.
- Nouveau `CompanyProfileService` : description priorisée par preuve, activité NAF, services explicitement observés, taille, signaux et références source.
- Migration PostgreSQL `019_public_officer_mandates.sql` et affichage du profil consolidé en tête de l'onglet Synthèse.
- Studio `/outils` : prospection par texte, secteur et commune sur établissements actifs, shortlist bornée à 50 entrées, export CSV professionnel et brouillon de CV ciblé local avec transparence sur les champs non inventés.

### Fichiers créés ou modifiés

- `scripts/import_public_officers_guadeloupe.py`
- `backend/tests/test_public_officers_import.py`
- `apps/web/src/lib/public-officers-db.ts`
- `apps/web/src/lib/company-profile.ts`
- `apps/web/src/lib/company-profile.test.ts`
- `apps/web/src/lib/business-intelligence.ts`
- `apps/web/src/app/api/search/route.ts`
- `apps/web/src/components/business-intelligence-panel.tsx`
- `apps/web/src/components/map-explorer.tsx`
- `apps/web/src/components/studio-tools.tsx`
- `apps/web/src/app/outils/page.tsx`
- `apps/web/src/app/api/prospecting/route.ts`
- `apps/web/src/app/api/prospecting/options/route.ts`
- `apps/web/src/app/globals.css`
- `db/migrations/019_public_officer_mandates.sql`
- `data/public-officers.sqlite`
- `.env.example`, `README.md`, `DATA_SOURCES.md`, `DATA_MODEL.md`, `IMPORT_PIPELINE.md`, `ARCHITECTURE.md`, `SECURITY.md`, `BI_ENRICHMENT.md`, `DATA_QUALITY_REPORT.md`, `PROGRESS.md`, `BLOCKERS.md`

### Décisions et limites

- L'API publique n'est pas utilisée pour affirmer une couverture exhaustive : la requête exacte par SIREN est la seule clé de rattachement.
- Les mandats légaux ne sont pas convertis en organigramme, hiérarchie ou rôle opérationnel.
- Une description de site reste attribuée à sa source; sans preuve suffisante, la fiche revient à une formulation NAF factuelle.
- Les services sont des observations sourcées et dédupliquées; aucun service n'est inféré du seul code NAF.

### Validation

- Import public officers : 2 tests ciblés réussis; suite Python complète à 58 tests; FTS5 contrôlé sur `LADY BIRD` et `DAMOISEAU FRERES`.
- Vitest : 5 tests réussis.
- `npm run typecheck --workspace @guad/web` : succès.
- `npm run lint --workspace @guad/web` : succès sans avertissement.
- Smoke API : `/api/search?q=LADY%20BIRD` retourne RHUM DAMOISEAU avec le mandat `Président de SAS`; `/api/companies/498235316/intelligence` retourne 4 mandats minimisés et le profil BI.
- Playwright : 10 parcours desktop/mobile réussis, dont shortlist, export activable et génération de brouillon CV.
- Build de production : succès après ajout des routes `/outils` et `/api/prospecting`.

### Prochaine étape

- Étendre l'import exact des mandats par lots planifiés, puis remplacer le stockage local des shortlists par un workflow authentifié et audité.

## BI lisible, autocomplétion et ciblage — 19 juillet 2026

### Réalisé

- Import du référentiel officiel INSEE NAF rév. 2 : 732 libellés de sous-classe sont disponibles dans `data/naf-rev2-labels.json`; les fiches et résultats de recherche affichent désormais l'activité précise lorsque le code est connu.
- Profil d'activité consolidé enrichi d'une matrice par source : `ok`, `empty` ou `unavailable`, URL de référence et nombre de sources observées. Ce compteur mesure la couverture documentaire, pas la qualité commerciale de l'entreprise.
- Recherche temps réel structurée via `/api/search?suggest=true` : entreprises, mandats publics, communes et secteurs; recherche accent-insensible, `dirigeant:`/`mandataire:`, surlignage, navigation clavier et historique local borné à six entrées.
- Filtres cartographiques supplémentaires exécutés côté SQLite : tranche d'effectif, siège, employeur déclaré, code postal et créations sur 24 mois. Tous les paramètres sont reflétés dans l'URL.
- Studio `/outils` relié au BI à la demande : un candidat peut être analysé, ses faits sourcés affichés, puis utilisé comme cible factuelle du brouillon CV; aucune agrégation BI en masse n'est déclenchée au chargement.
- Bottom sheet mobile nommé comme dialogue accessible et fermeture de l'autocomplétion stabilisée pour les interactions tactiles.

### Fichiers créés ou modifiés

- `scripts/import_naf_labels.py`, `data/naf-rev2-labels.json`
- `apps/web/src/lib/naf.ts`, `apps/web/src/lib/naf.test.ts`
- `apps/web/src/lib/enterprise-db.ts`, `apps/web/src/app/api/map/establishments/route.ts`
- `apps/web/src/app/api/search/route.ts`, `apps/web/src/components/map-explorer.tsx`
- `apps/web/src/lib/company-profile.ts`, `apps/web/src/lib/business-intelligence.ts`, `apps/web/src/components/business-intelligence-panel.tsx`
- `apps/web/src/components/studio-tools.tsx`, `apps/web/src/app/globals.css`, `apps/web/e2e/map.spec.ts`
- `backend/pyproject.toml`, `README.md`, `ARCHITECTURE.md`, `DATA_SOURCES.md`, `IMPORT_PIPELINE.md`, `BLOCKERS.md`

### Décisions et limites

- La NAF rév. 2 reste la nomenclature active pour le stock SIRENE de juillet 2026; la NAF 2025 est conservée comme évolution future INSEE et n'est pas mélangée silencieusement aux codes actuels.
- Une description reste factuelle : un libellé NAF décrit l'activité déclarée, mais ne prouve pas une offre commerciale. Les prestations du studio ne sont reprises que si elles sont explicitement observées dans une source.
- Les mandats locaux restent partiels : 1 357 SIREN sur 120 710 et 1 585 lignes. Une suggestion distante de l'API officielle est marquée par sa source et ne transforme pas l'absence en négation.
- Les paramètres `verified` restent vides tant que le workflow de revendication authentifié n'est pas branché; le filtre est conservé pour le futur modèle de fiches vérifiées.

### Validation

- `npm test -- --run` : 7 tests Vitest réussis.
- `npm run typecheck` : succès.
- `npm run lint` : succès sans avertissement.
- `npm run test:e2e` : 16 tests desktop/mobile réussis, dont autocomplétion clavier, tap bottom sheet, filtres avancés et CV BI ciblé.
- Smoke API : activité `11.01Z` rendue « Production de boissons alcooliques distillées »; filtre `workforce=12&headOffice=true&employer=true` exécuté dans la requête SQLite.

### Prochaine étape

- Étendre l'import des mandats par lots planifiés, puis livrer l'authentification, le partage persistant et l'audit serveur des shortlists et revendications.

## Validation finale de la tranche BI — 19 juillet 2026

### Réalisé

- Libellé NAF officiel propagé jusque dans le titre éditorial des fiches entreprise; aucune activité commerciale n'est déduite au-delà de la nomenclature INSEE.
- Couche territoriale communale locale renforcée sous les fonds OpenFreeMap afin de conserver une lecture de l'archipel lorsque le fournisseur distant tarde à répondre.

### Fichiers créés ou modifiés

- `apps/web/src/app/entreprises/[commune]/[slugSiren]/page.tsx`
- `apps/web/src/components/map-explorer.tsx`
- `PROGRESS.md`

### Décisions et limites

- Les fonds cartographiques distants restent une dépendance externe sans SLA; la couche locale garantit la géographie administrative, pas les rues, les noms de lieux ou les tuiles de fond.
- Un lancement Chromium headless peut perdre son contexte WebGL après des ouvertures répétées; le rendu nominal a été contrôlé avec fond, archipel, communes et clusters, et la carte conserve un repli territorial visible.

### Validation

- `npm test -- --run` : 7 tests Vitest réussis.
- `npm run typecheck` : succès.
- `npm run lint` : succès sans avertissement.
- `npm run test:e2e` : 16 tests desktop/mobile réussis.
- `npm run build` : succès avec Next.js 16.2.10.
- Contrôle visuel Playwright 1440x900 : carte de l'archipel, fond, limites communales, clusters, attribution et panneau d'exploration visibles.

### Prochaines étapes de production

- Remplacer le stockage local du studio par une authentification et un stockage serveur audité.
- Étendre l'import RNE par lots planifiés et migrer l'index local vers PostgreSQL/PostGIS pour le déploiement multi-instance.

## Audit des signaux de contact et des sources web — 19 juillet 2026

### Réalisé

- Extension du cache public RNE à 1 357 SIREN et 1 585 mandats, avec couverture publiée de 1,1242 % sur les 120 710 SIREN territoriaux; la couverture reste explicitement partielle.
- Rebuild de l'index OSM avec 40 emails fonctionnels génériques filtrés; aucune boîte nominative n'est collectée ni affichée.
- Extension du collecteur de sites aux URLs RNA dont `website_publication_authorized=1`, en plus des références OSM exactes.
- Provenance ajoutée dans l'index web : `OpenStreetMap` ou `RNA · publication autorisée`; les URLs malformées restent des erreurs traçables.
- Chronologie BI courte ajoutée à la synthèse : annonces BODACC, marchés DECP, aides et projets publics, exercices financiers, brevets et mentions presse, avec date, source, lien et confiance.
- Mesure actuelle : 323 références web, 310 entreprises, 224 pages accessibles, 152 descriptions, 19 sites avec prestations, 7 refus robots, 18 robots inaccessibles, 13 plateformes ignorées et 60 erreurs.

### Fichiers créés ou modifiés

- `scripts/import_osm_business_profiles.py`
- `data/osm-business-profiles.sqlite`
- `scripts/enrich_official_websites.py`
- `data/website-enrichments.sqlite`
- `apps/web/src/lib/osm-business-db.ts`
- `apps/web/src/lib/website-enrichment-db.ts`
- `apps/web/src/lib/business-intelligence.ts`
- `apps/web/src/lib/company-profile.ts`
- `apps/web/src/components/business-intelligence-panel.tsx`
- `apps/web/src/types/lucide-react.d.ts`
- `apps/web/e2e/map.spec.ts`
- `db/migrations/003_osm_business_presence.sql`, `db/migrations/005_website_enrichments.sql`
- `DATA_QUALITY_REPORT.md`
- `DATA_SOURCES.md`, `DATA_MODEL.md`, `IMPORT_PIPELINE.md`, `BI_ENRICHMENT.md`, `README.md`, `BLOCKERS.md`

### Décisions et limites

- Un email OSM n'est rendu visible que si son préfixe correspond à une boîte fonctionnelle générique; il reste un attribut communautaire à confirmer.
- Les URLs RNA sont utilisées seulement avec l'autorisation de publication portée par la source. Les deux URLs disponibles dans le snapshot sont malformées et n'ont pas été réparées par inférence.
- Le cache RNE permet une réponse locale rapide et un fallback lorsque l'API réseau est indisponible; ses SIREN non indexés ne signifient pas qu'aucun mandat n'existe.

### Validation

- `python -m py_compile scripts/import_osm_business_profiles.py scripts/import_public_officers_guadeloupe.py scripts/enrich_official_websites.py` : succès.
- `python scripts/enrich_official_websites.py --workers 2 --delay 0.2 --timeout 5` : index idempotent mis à jour, rapport 323/310/224/152/19.
- `python -m pytest -q backend/tests --basetemp .pytest-tmp-20260719` : 60 tests réussis.
- `npm test -- --run` : 7 tests Vitest réussis.
- `npm run typecheck` : succès.
- `npm run lint` : succès sans avertissement.
- `npm run test:e2e` : 16 parcours desktop/mobile réussis, dont la chronologie BI mockée.
- `npm run build` : succès avec Next.js 16.2.10.
- Capture Playwright 1440x900 : carte de l’archipel, fond, clusters, légende, attribution et panneau d’exploration visibles.
- Smoke API : le SIREN `219711017` expose `contact@ville-des-abymes.fr` comme email fonctionnel OSM et la provenance RNE locale dans sa fiche BI.

### Prochaines étapes

- Étendre le cache RNE aux agrégats publics non personnels lorsque leur structure et leur fraîcheur sont stables.
- Remplacer le stockage local du studio par une authentification et un stockage serveur audité avant une ouverture multi-utilisateur.

## Snapshot Annuaire, recherche par signaux et veille média — 19 juillet 2026

### Réalisé

- Projection locale des réponses Annuaire avec `include=complements,dirigeants,finances` : 1 357 profils, 1 585 mandats, 9 exercices financiers, 97 labels/signaux et 47 IDCC.
- Reprise idempotente `--refresh-profiles --resume` ajoutée pour enrichir le cache RNE existant sans relancer les SIREN hors lot.
- Fiche BI prioritairement servie depuis le snapshot local, avec date source, date de récupération et statut de couverture visibles; le live reste un fallback.
- Recherche étendue aux prestations/catégories observées dans les sites publics autorisés et OSM; un match garde sa source et le texte du signal trouvé.
- Cache média séparé `press-signals.sqlite` et script `enrich_company_press.py` : titres/liens uniquement, collecte bornée par SIREN, états fournisseur `ok`/`partial`/`empty`/`error`.
- Chronologie BI étendue aux exercices financiers Annuaire; l’onglet presse affiche désormais le statut de cache et sa fraîcheur.

### Fichiers créés ou modifiés

- `scripts/import_public_officers_guadeloupe.py`, `data/public-officers.sqlite`
- `scripts/enrich_company_press.py`, `data/press-signals.sqlite`
- `apps/web/src/lib/public-officers-db.ts`, `apps/web/src/lib/press-signals-db.ts`, `apps/web/src/lib/enrichment-search.ts`
- `apps/web/src/lib/website-enrichment-db.ts`, `apps/web/src/lib/osm-business-db.ts`, `apps/web/src/lib/enterprise-db.ts`
- `apps/web/src/lib/business-intelligence.ts`, `apps/web/src/app/api/search/route.ts`, `apps/web/src/components/business-intelligence-panel.tsx`
- `db/migrations/020_annuaire_public_snapshots.sql`, `db/migrations/021_press_signals.sql`, `.env.example`
- `README.md`, `DATA_SOURCES.md`, `DATA_MODEL.md`, `IMPORT_PIPELINE.md`, `BI_ENRICHMENT.md`, `DATA_QUALITY_REPORT.md`, `BLOCKERS.md`
- `backend/tests/test_public_officers_import.py`

### Validation

- `python scripts/import_public_officers_guadeloupe.py --refresh-profiles --resume --delay 0` : consolidation sans nouvel appel, couverture metadata restaurée à 1 357 / 120 710 = 1,1242 %.
- `python scripts/enrich_company_press.py --siren 219711017 --siren 419475728 --delay 0.2` : 20 métadonnées média, état partiel correctement journalisé.
- `python -m pytest -q backend/tests` avec `PYTHONPATH=backend` : 64 tests réussis.
- `npm test -- --run` : 7 tests Vitest réussis.
- `npm run typecheck` et `npm run lint` : succès.
- `npm run test:e2e` : 18 parcours desktop/mobile réussis, dont la recherche d’une prestation observée.
- Smoke API : recherche `seafood` renvoie des signaux OSM sans remplacer le descriptif NAF; le SIREN `219711017` sert une veille média depuis le cache local.

### Limitations

- Le RNE reste partiel : 119 353 SIREN territoriaux ne disposent pas encore d’un snapshot local; une absence n’est pas une preuve d’absence.
- La presse est volontairement ciblée et non exhaustive; homonymie, indexation et disponibilité des fournisseurs peuvent limiter le résultat.
- Les prestations enrichies restent limitées aux signaux explicitement publiés; aucun contenu commercial n’est généré.

### Prochaines étapes

- Planifier des lots RNE avec métriques de fraîcheur et backoff fournisseur.
- Ajouter une couverture média ciblée pilotée par les listes de prospection, avec validation de pertinence.
- Remplacer le stockage local du studio par authentification, partage persistant et audit serveur.

## Collecte territoriale Annuaire et couverture publiée — 19 juillet 2026

### Réalisé

- Ajout d'un mode `--bulk-department` au collecteur Annuaire, avec requête officielle `departement=971`, `per_page=25`, filtrage des résultats par SIREN présent dans le stock SIRENE local et réutilisation de la projection minimisée existante.
- Ajout de `department_runs` : page suivante, pages parcourues, lignes lues, lignes rattachées, SIREN traités, statut, horodatage et erreur; chaque page est commitée pour permettre une reprise idempotente.
- Collecte réelle terminée le 19 juillet 2026 : 400 pages, 10 000 résultats exposés par l'API, 9 276 lignes rattachées exactement au stock local, 9 242 SIREN traités pendant le run, 0 erreur d'écriture.
- Snapshot final : 10 599 SIREN/profils, 14 534 mandats, 2 018 exercices financiers, 2 125 labels/signaux et 3 625 IDCC sur 120 710 SIREN, soit 8,7805 %.
- Le plafond `total_results=10000` / `total_pages=400` est conservé dans `metadata` et documenté comme une limite de couverture; aucune extrapolation n'est faite pour les SIREN hors lot.

### Fichiers créés ou modifiés

- `scripts/import_public_officers_guadeloupe.py`
- `backend/tests/test_public_officers_import.py`
- `data/public-officers.sqlite`
- `README.md`, `DATA_SOURCES.md`, `DATA_QUALITY_REPORT.md`, `DATA_MODEL.md`, `IMPORT_PIPELINE.md`, `BI_ENRICHMENT.md`, `BLOCKERS.md`

### Validation

- `python -m py_compile scripts/import_public_officers_guadeloupe.py` : succès.
- `python -m pytest -q backend/tests/test_public_officers_import.py` : 5 tests réussis.
- Smoke réel `--bulk-department --max-pages 1 --resume`, puis reprise par lots : succès jusqu'à `status=complete`.

### Limitations

- La recherche départementale publique est plafonnée à 10 000 résultats observés; 110 111 SIREN territoriaux ne disposent pas encore d'un snapshot Annuaire exact dans ce cache.
- Le rang des résultats peut évoluer entre deux collectes; le cache reste daté et la couverture ne vaut pas une réponse officielle individuelle pour les SIREN non renvoyés.

### Prochaines étapes

- Exécuter la suite complète Python et frontend, puis le build de production.
- Vérifier les smoke tests BI après l'augmentation du snapshot et mesurer les régressions de temps de réponse.

## Validation finale de l'incrément — 19 juillet 2026

### Réalisé

- Test E2E rendu déterministe après l'évolution du classement de recherche liée aux nouveaux signaux RNE; le parcours vise une fiche de Basse-Terre dans la liste plutôt que de dépendre du premier résultat global.
- Vérification des endpoints carte, recherche, fiche BI, cache BODACC et statut recrutement après le build.

### Fichiers créés ou modifiés

- `apps/web/e2e/map.spec.ts`
- `PROGRESS.md`, `BLOCKERS.md`

### Tests exécutés

- `$env:PYTHONPATH='backend;.'; python -m pytest -q backend/tests` : 69 tests réussis.
- `npm test -- --run` : 8 tests Vitest réussis.
- `npm run typecheck` : succès.
- `npm run lint` : succès.
- `npm run test:e2e` : 18 parcours desktop/mobile réussis.
- `npm run build` : build Next.js de production réussi.
- Smoke HTTP : `/api/map/establishments` renvoie 115 323 établissements géolocalisés en mode cluster; `/api/search` répond sur un dirigeant public; la fiche SIREN `303091086` sert le cache BODACC (`29` événements) et le recrutement `unavailable` sans identifiants.

### Résultat

- La vertical slice cartographique, la recherche, les fiches BI enrichies et la collecte Annuaire reprenable sont opérationnelles dans l'environnement local.
- Restent des limites de production documentées : plafond Annuaire, fournisseur cartographique sans SLA, recrutement live désactivé sans credentials, et studio de prospection encore local au navigateur.

## Veille média prioritaire et résilience fournisseurs — 19 juillet 2026

### Réalisé

- Sélection de cibles presse par entreprises actives et tranche d'effectif (`--priority`), avec `--limit` et `--offset` pour planifier des batches.
- Utilisation du nom commercial public lorsqu'il existe, sans rapprochement par nom pour les données administratives.
- Exécution concurrente de GDELT et Google News par entreprise, timeout configurable (`--timeout`) et cooldown GDELT après une réponse `429`.
- Snapshot réel : 101 SIREN, 978 mentions, 3 `ok`, 74 `partial`, 5 `empty`, 19 `error`. Les erreurs et absences restent exposées dans la fiche BI.
- Ajout d'un message explicite dans l'onglet Presse lorsqu'un fournisseur est en erreur; les titres et liens restent des signaux, sans texte intégral ni résumé généré.

### Fichiers créés ou modifiés

- `scripts/enrich_company_press.py`
- `backend/tests/test_press_enrichment.py`
- `apps/web/src/components/business-intelligence-panel.tsx`
- `data/press-signals.sqlite`
- `README.md`, `DATA_SOURCES.md`, `DATA_QUALITY_REPORT.md`, `IMPORT_PIPELINE.md`, `BI_ENRICHMENT.md`

### Validation

- `python -m py_compile scripts/enrich_company_press.py` : succès.
- `python -m pytest -q backend/tests/test_press_enrichment.py` : 3 tests réussis.
- Batch réel prioritaire avec reprise : terminé; GDELT `429` géré sans arrêter Google News.

### Limites

- La presse n'est pas exhaustive et les agrégateurs peuvent produire des homonymies; `partial` ne signifie pas validation éditoriale.
- Le batch reste borné pour respecter les fournisseurs; il faut planifier les offsets suivants plutôt que lancer toute la base en une fois.

### Prochaines étapes

- Étendre les batches selon la capacité fournisseur et ajouter un tableau de couverture presse global dans l'administration.
- Continuer l’enrichissement des sites publics rattachés et des signaux de recrutement autorisés.

## Recherche structurée des signaux — 19 juillet 2026

### Réalisé

- Ajout d'un parseur pur partagé pour les scopes `siren:`, `siret:`, `naf:`, `commune:`, `secteur:`, `adresse:` et `presse:`.
- Recherche par SIREN/SIRET/NAF avec requête locale bornée; recherche commune, secteur et adresse avec filtres SQL; recherche presse dans le cache des titres, domaines et noms de requête.
- Le moteur conserve la source `Presse` et le texte du signal dans les résultats; l'API distante Annuaire n'est pas appelée pour un scope structuré local.
- Le statut BI Presse devient `unavailable` lorsque le snapshot indique une erreur fournisseur, au lieu d'afficher silencieusement `empty`.

### Fichiers créés ou modifiés

- `apps/web/src/lib/search-query.ts`
- `apps/web/src/lib/enterprise-db.ts`, `apps/web/src/lib/press-signals-db.ts`, `apps/web/src/lib/enrichment-search.ts`
- `apps/web/src/app/api/search/route.ts`, `apps/web/src/components/map-explorer.tsx`, `apps/web/src/components/business-intelligence-panel.tsx`
- `apps/web/src/lib/search.test.ts`

### Validation

- `npm test -- --run` : 9 tests Vitest réussis.
- `npm run typecheck` et `npm run lint` : succès.
- Smoke API : `siren:303091086` retourne un résultat exact; `presse:Protection enfance` retourne un résultat source `Presse` avec titre et SIREN.

## Validation de l’incrément BI et couverture — 19 juillet 2026

### Tests et mesures

- `PYTHONPATH='backend;.'; python -m pytest -q backend/tests` : 70 tests réussis.
- `npm test -- --run` : 9 tests Vitest réussis.
- `npm run typecheck` : succès.
- `npm run lint` : succès.
- `npm run test:e2e` : 18 parcours desktop/mobile réussis.
- `npm run build` : build Next.js de production réussi.
- Smoke HTTP : `/admin` répond `200` avec la couverture réelle; `siren:303091086` retrouve l'entreprise; `presse:Protection enfance` retrouve le SIREN `775685506` avec source `Presse`; un snapshot presse `partial` est signalé `ok` avec détail partiel et un snapshot `error` est signalé `unavailable`.

### État courant

- La BI exploitable par fiche combine maintenant les snapshots structurels, la gouvernance publique, les événements légaux, les signaux web/OSM, la presse mise en cache et la recherche structurée.
- La page `/admin` est une observabilité locale réelle, volontairement en lecture seule; aucune action d'import, de correction ou de revendication n'est simulée.
- Les limites restant ouvertes sont explicites : couverture Annuaire plafonnée, presse dépendante de fournisseurs, recrutement live nécessitant des credentials, et authentification/RBAC de production à brancher avant toute mutation ou partage persistant.
## Index BODACC local et événements légaux — 19 juillet 2026

### Réalisé

- Audit de l'API BODACC officielle : le jeu `annonces-commerciales` expose `registre`, famille/type, date, tribunal, localisation et URL; l'endpoint d'export JSON est utilisé pour la volumétrie.
- Importeur `scripts/import_bodacc_guadeloupe.py` ajouté : filtre département 971, jointure SIREN exacte au stock SIRENE, projection minimisée, upsert idempotent sur `(siren, event_id)`, journal `import_runs`, métadonnées et mode pagination reprenable.
- Snapshot local produit : 144 756 annonces lues depuis 2020, 90 930 lignes rattachées à 36 354 SIREN, date de récupération 19 juillet 2026.
- Fiche BI branchée sur `data/bodacc-guadeloupe.sqlite` avec fallback live si le snapshot est absent et affichage du statut/fraîcheur du cache.
- La projection écarte les noms de personnes, le payload brut, les actes et les descriptions juridiques libres; seule l'activité publiée nécessaire à l'onglet Événements est conservée.

### Fichiers créés ou modifiés

- `scripts/import_bodacc_guadeloupe.py`
- `backend/tests/test_bodacc_import.py`
- `apps/web/src/lib/bodacc-db.ts`
- `apps/web/src/lib/business-intelligence.ts`
- `apps/web/src/components/business-intelligence-panel.tsx`
- `db/migrations/022_bodacc_events.sql`
- `data/bodacc-guadeloupe.sqlite`
- `.env.example`, `README.md`, `DATA_SOURCES.md`, `DATA_MODEL.md`, `IMPORT_PIPELINE.md`, `BI_ENRICHMENT.md`, `DATA_QUALITY_REPORT.md`, `PROGRESS.md`

### Validation

- `python -m py_compile scripts/import_bodacc_guadeloupe.py` : succès.
- `python -m pytest -q backend/tests/test_bodacc_import.py --basetemp .pytest-tmp-bodacc` : 3 tests réussis.
- `npm run typecheck` : succès.
- Smoke API : `/api/companies/303091086/intelligence` sert 29 événements avec `cacheStatus=snapshot`.

### Limites et prochaine étape

- La fenêtre locale commence en 2020; `--all-history` est disponible mais n'a pas été exécuté dans ce lot.
- BODACC décrit des publications légales datées et ne permet pas de conclure à l'activité actuelle.
- Il faut maintenant renforcer la recherche transversale et auditer les sources recrutement/commande publique accessibles avant d'ajouter des signaux supplémentaires.

## Recherche BI et adaptateur recrutement — 19 juillet 2026

### Réalisé

- Index FTS5 `bodacc_search` ajouté au cache BODACC pour rechercher les activités et événements publics sans parcourir 90 000 lignes par requête.
- Recherche universelle étendue aux activités BODACC; le résultat conserve la source, la date de publication et le signal observé, sans remplacer la description NAF par un texte non vérifié.
- Audit BOAMP officiel : API DILA ouverte et riche en avis, mais titulaires souvent textuels ou identifiants d'organisation non exploitables comme SIREN/SIRET; aucune jointure par nom ajoutée.
- Adaptateur `apps/web/src/lib/france-travail.ts` et parseur testable `france-travail-parser.ts` ajoutés. L'onglet BI Recrutement est disponible, mais le flux reste désactivé par défaut et affiche la limite au lieu d'une donnée inventée.
- Règle de rattachement recrutement : SIREN/SIRET publié dans l'offre uniquement; les correspondances par nom, commune ou mot-clé sont écartées.
- Migration cible `023_recruitment_signals.sql` ajoutée pour le futur cache persistant lorsque l'accès API sera autorisé.

### Fichiers créés ou modifiés

- `apps/web/src/lib/bodacc-db.ts`, `apps/web/src/lib/enrichment-search.ts`
- `scripts/import_bodacc_guadeloupe.py`, `backend/tests/test_bodacc_import.py`
- `apps/web/src/lib/france-travail.ts`, `apps/web/src/lib/france-travail-parser.ts`, `apps/web/src/lib/france-travail.test.ts`
- `apps/web/src/components/business-intelligence-panel.tsx`
- `db/migrations/023_recruitment_signals.sql`, `.env.example`
- `README.md`, `DATA_SOURCES.md`, `DATA_MODEL.md`, `IMPORT_PIPELINE.md`, `BI_ENRICHMENT.md`, `DATA_QUALITY_REPORT.md`, `BLOCKERS.md`, `PROGRESS.md`

### Validation

- `python -m pytest -q backend/tests/test_bodacc_import.py --basetemp .pytest-tmp-bodacc` : 4 tests réussis.
- `npm test -- --run` : 8 tests Vitest réussis.
- `npm run typecheck` : succès.
- Smoke API : recherche `spiritueux` retourne des entreprises avec `source=BODACC` et le signal d'activité publié; une fiche sans credentials expose `France Travail=unavailable`.

### Limites et prochaines étapes

- France Travail nécessite encore un accès développeur officiel et n'est pas alimenté sans credentials; aucune offre n'est présentée comme disponible par défaut.
- BOAMP n'est pas rattaché individuellement tant qu'un identifiant exact du titulaire n'est pas publié et validé.
- Étape suivante : cache recrutement borné après accès autorisé, puis moteur de recherche transversal PostgreSQL/PostGIS/FTS pour le déploiement multi-instance.

## Studio BI ciblage et CV — 19 juillet 2026

### Réalisé

- Le studio `/outils` expose désormais, pour le candidat sélectionné, des faits BI séparés : prestations explicitement observées, événements BODACC, marchés publics rattachés par identifiant, mentions presse, offres de recrutement exactes et sites accessibles.
- Le brouillon de CV ciblé réutilise l'activité publiée, la tranche d'effectif, le nombre d'implantations, les prestations observées et les signaux de commande publique, presse ou recrutement lorsqu'ils sont effectivement disponibles.
- Les données non disponibles restent signalées (`NC`) et le texte de ciblage rappelle de vérifier les informations avant prise de contact. Aucune promesse commerciale, compétence ou correspondance par nom n'est ajoutée.
- Le panneau BI dispose d'une grille de faits compacte et responsive, avec les mêmes règles de transparence sur desktop et mobile.

### Fichiers créés ou modifiés

- `apps/web/src/components/studio-tools.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/e2e/map.spec.ts`
- `PROGRESS.md`

### Validation

- `npm run typecheck` : succès.
- `npm run lint` : succès.
- `npm test -- --run` : 9 tests Vitest réussis.
- `npx playwright test e2e/map.spec.ts -g "selected BI profile"` : 2 tests desktop/mobile réussis.
- `npm run test:e2e` : 18 tests desktop/mobile réussis.
- `npm run build` : build Next.js de production réussi.

### Limites et prochaine étape

- Les prestations, la presse et la commande publique restent des signaux de couverture variable; leur absence ne signifie pas absence d'activité.
- Le recrutement France Travail reste désactivé sans accès développeur officiel; l'interface affiche `NC` plutôt qu'une offre non vérifiée.
- Le mode Proposition commerciale constitue ce brief local exportable; une persistance multi-utilisateur nécessitera ensuite authentification, autorisations serveur et stockage d'audit.

## Brief de proposition commerciale — 19 juillet 2026

### Réalisé

- Un troisième mode `Proposition` a été ajouté au studio, accessible depuis la lecture BI d'une entreprise ou depuis les onglets de l'outil.
- Le brief préremplit le contexte SIRENE/BI observé : activité, taille, prestations publiques identifiées, commande publique, presse et recrutement exact lorsque disponible.
- L'entrepreneur renseigne explicitement l'objectif à valider, les prestations proposées, les livrables, le budget et le délai; le résultat reste local et téléchargeable en texte.
- La sortie distingue les signaux de qualification d'un besoin confirmé et conserve la date d'agrégation lorsque le profil BI est chargé.

### Fichiers modifiés

- `apps/web/src/components/studio-tools.tsx`
- `apps/web/e2e/map.spec.ts`
- `PROGRESS.md`

### Validation

- `npm run typecheck` et `npm run lint` : succès.
- `npm test -- --run` : 9 tests Vitest réussis.
- `npm run test:e2e` : 18 tests desktop/mobile réussis, dont le parcours Proposition → CV ciblé.
- `npm run build` : build Next.js de production réussi.

### Limites

- Le brief n'envoie aucune proposition et ne contacte aucun prospect; il s'agit d'un brouillon local à valider humainement.
- Les signaux publics restent incomplets et non équivalents à un besoin commercial; les sources non disponibles restent explicitement absentes ou `NC`.

## Enrichissement fiche, recherche temps réel et couverture presse — 19 juillet 2026

### Réalisé

- La fiche entreprise SSR exploite désormais les enrichissements locaux autorisés : description courte du site public rattaché lorsqu'elle existe, activité BODACC comme repli légal daté, site web, téléphone professionnel, email fonctionnel et horaires OSM lorsqu'ils sont publiés. La provenance, la confiance et la date de récupération restent visibles; sans preuve, le texte NAF automatique est conservé.
- Le schéma Schema.org de la fiche reprend le site public rattaché lorsqu'il est disponible. Le parcours E2E vérifie que cette information reste rendue côté serveur même lorsque l'appel BI client est interrompu.
- L'autocomplétion est désormais locale, bornée, débouncée et annulable pendant la saisie; la recherche complète est réservée à la validation explicite et peut utiliser le repli Annuaire officiel. Les scopes structurés restent disponibles.
- Le panneau BI et les contextes CV/proposition reprennent les signaux secondaires positifs disponibles : dirigeants publics minimisés, brevets, exercices financiers, aides publiques, formation, RGE et ICPE.
- Le batch presse prioritaire reprenable a porté le snapshot à **401 SIREN**, **2 771 mentions**, **3 `ok`**, **238 `partial`**, **5 `empty`** et **155 `error`**. Les erreurs fournisseur restent visibles et aucune mention n'est transformée en description commerciale.

### Fichiers créés ou modifiés

- `apps/web/src/app/entreprises/[commune]/[slugSiren]/page.tsx`
- `apps/web/src/app/api/search/route.ts`, `apps/web/src/components/map-explorer.tsx`
- `apps/web/src/lib/enterprise-db.ts`, `apps/web/src/lib/website-enrichment-db.ts`, `apps/web/src/lib/osm-business-db.ts`, `apps/web/src/lib/press-signals-db.ts`
- `apps/web/src/components/studio-tools.tsx`, `apps/web/e2e/map.spec.ts`
- `README.md`, `ARCHITECTURE.md`, `DATA_SOURCES.md`, `DATA_QUALITY_REPORT.md`, `BI_ENRICHMENT.md`, `PROGRESS.md`
- `data/press-signals.sqlite`

### Validation intermédiaire

- `npm run typecheck` : succès.
- `npm run lint` : succès.
- `npm test -- --run` : 9 tests Vitest réussis.
- `$env:PYTHONPATH = "backend;."; python -m pytest -q backend/tests --basetemp .pytest-tmp-final-validation-3` : 70 tests réussis.
- `npx playwright test e2e/map.spec.ts -g "realtime suggestions|website enrichment" --project=chromium` : 2 tests réussis.

### Limites et prochaines étapes

- La couverture des sites publics, des dirigeants et de la presse reste partielle et mesurée; une absence ne signifie pas absence d'activité.
- France Travail reste désactivé sans identifiants développeur officiels; le recrutement live ne doit pas être simulé.
- L'administration reste en lecture seule et les listes, briefs et CV restent locaux; authentification, RBAC, persistance multi-utilisateur et audit serveur restent à industrialiser.
- Il reste à exécuter la suite E2E complète et le build final après ces ajouts.

## Validation finale de l’incrément — 19 juillet 2026

### Résultats

- `npm run typecheck` : succès.
- `npm run lint` : succès.
- `npm test -- --run` : 9 tests Vitest réussis.
- `$env:PYTHONPATH = "backend;."; python -m pytest -q backend/tests --basetemp .pytest-tmp-final-validation-3` : 70 tests réussis.
- `npm run test:e2e` : 22 parcours desktop/mobile réussis, dont l’autocomplétion locale et l’enrichissement SSR.
- `npm run build` : build Next.js de production réussi; la route entreprise reste server-rendered et les routes carte/recherche restent dynamiques.
- Le snapshot presse final est cohérent avec les documents sources : 401 SIREN, 2 771 mentions, 3 `ok`, 238 `partial`, 5 `empty`, 155 `error`.

### État de livraison

- La carte reste accessible sur `http://127.0.0.1:3000/`; le Studio BI et les modes CV ciblé/proposition sont disponibles sur `/outils`.
- Les enrichissements présentés sont rattachés par SIREN/SIRET exact ou exposés comme signaux territoriaux avec source, date et confiance.
- Aucune mutation administrateur, revendication ou donnée personnelle non nécessaire n’a été ajoutée dans cet incrément.

### Limites restantes

- La production doit encore brancher l’authentification, le RBAC serveur, les workflows de revendication/modération et la persistance multi-utilisateur.
- Les mandats, sites publics, presse et recrutement ne couvrent pas uniformément les 120 710 SIREN; les indicateurs de couverture restent visibles et ne valent pas exhaustivité.

## Workspace persistant, réseau de mandats et recherche fuzzy — 19 juillet 2026

### Réalisé

- Le Studio `/outils` enregistre désormais explicitement les recherches, shortlists et brouillons CV/proposition dans `data/workspaces.sqlite`, derrière un cookie HttpOnly aléatoire haché, avec expiration configurable par défaut à 180 jours et purge complète.
- Les routes `/api/workspace`, `/api/workspace/saved-searches`, `/api/workspace/shortlists`, `/api/workspace/drafts` et la suppression par ressource valident les entrées par Zod, bornent les tailles et ne stockent que les éléments choisis par l'utilisateur.
- La fiche BI expose un réseau accessible de mandats publiés : personnes ou personnes morales, qualité, date de source et entreprise cible. Il est explicitement présenté comme un réseau légal publié, pas comme un organigramme opérationnel ni une liste de bénéficiaires effectifs.
- Le cache BI déduplique les requêtes concurrentes et conserve au plus 128 profils pendant cinq minutes, paramétrables avec `BI_CACHE_TTL_SECONDS`.
- La saisie libre reste locale et bornée; le préfixe explicite `dirigeant:` peut interroger l'Annuaire officiel. Une faute simple utilise désormais un fallback fuzzy limité aux candidats SQL pertinents, avec priorité aux noms légaux et commerciaux.
- L'administration compte désormais les lignes réelles de `fetch_log` pour la couverture presse, et non le seul volume annoncé par le dernier lot.

### Fichiers créés ou modifiés

- `apps/web/src/lib/workspace-db.ts`, `apps/web/src/lib/workspace-http.ts`
- `apps/web/src/app/api/workspace/route.ts`
- `apps/web/src/app/api/workspace/saved-searches/route.ts`, `shortlists/route.ts`, `drafts/route.ts`
- `apps/web/src/app/api/workspace/[resource]/[id]/route.ts`
- `apps/web/src/lib/business-intelligence.ts`, `apps/web/src/components/business-intelligence-panel.tsx`, `apps/web/src/lib/admin-coverage.ts`
- `apps/web/src/lib/enterprise-db.ts`, `apps/web/src/app/api/search/route.ts`, `apps/web/e2e/map.spec.ts`
- `db/migrations/024_workspace_persistence.sql`, `.env.example`
- `README.md`, `ARCHITECTURE.md`, `DATA_MODEL.md`, `SECURITY.md`, `DEPLOYMENT.md`, `DATA_QUALITY_REPORT.md`, `BI_ENRICHMENT.md`, `PROGRESS.md`

### Validation intermédiaire

- Smoke workspace : création, recherche enregistrée, shortlist, brouillon, restauration après rechargement et purge réussies.
- Smoke BI : la fiche `303091086` retourne `12` nœuds et `11` arêtes de mandats publiés; le second appel cache observé est passé d'environ `327 ms` à `25 ms` dans le runtime local.
- Smoke recherche : `dirigeant:lady bird` retourne des suggestions officielles; `restaurtion` retrouve le SIREN `884077884` dans un payload limité à 24 résultats.
- Playwright ciblé : parcours workspace et gouvernance réussi sur Chromium desktop.

### Limites

- Le workspace est persistant mais anonyme pour ce vertical slice; il ne doit pas être partagé ni considéré comme un espace de production avant authentification, RBAC, quotas, chiffrement et audit.
- Le réseau de mandats ne décrit ni hiérarchie interne, ni équipe, ni contrôle capitalistique; la couverture Annuaire reste partielle.
- Le fallback fuzzy est volontairement borné et ne remplace pas un moteur de recherche distribué; la cible multi-instance reste PostgreSQL `pg_trgm`/FTS ou un moteur dédié.

### Validation finale de l'incrément courant

- `npm run typecheck` : succès.
- `npm run lint` : succès sans avertissement.
- `npm test -- --run` : 9 tests Vitest réussis.
- `$env:PYTHONPATH = "backend;."; python -m pytest -q backend/tests --basetemp .pytest-tmp-final-validation-4` : 70 tests réussis.
- `npm run test:e2e` : 26 tests Playwright réussis sur Chromium desktop et mobile.
- `npm run build` : build Next.js de production réussi; les routes SSR et API dynamiques sont compilées.
- Smoke HTTP : `/` et `/admin` en `200`; carte clusterisée à `115 920` positions et `11` clusters; recherche fuzzy et recherche dirigeant opérationnelles; BI `12` nœuds/`11` arêtes; second appel BI observé à `25 ms`; workspace `anonymous_http_only_cookie` avec rétention `180` jours.

## Dossier BI et modération déclarative — 19 juillet 2026

### Réalisé

- Contrat `BusinessIntelligenceDossier` borné et sourcé : activités observées, prestations, taille, finance, contrats, recrutement, signaux, presse, chronologie, gouvernance publique, limites et matrice de couverture.
- Route SSR-compatible `GET /api/companies/{siren}/dossier`, cache HTTP court, aucune donnée personnelle brute et export Markdown depuis le Studio `/outils`.
- Actions réelles sur la fiche entreprise : revendication, signalement et proposition d’enrichissement déclaratif.
- Console `/admin` protégée par jeton serveur et session HMAC HttpOnly : files de revendications, signalements, enrichissements, décisions `DATA_ADMIN`/`SUPER_ADMIN` et journal d’audit.
- Synchronisation des overrides de vérification avec recherche, filtre carte et marqueurs individuels; les champs déclarés approuvés restent séparés de SIRENE.
- Schéma cible `db/migrations/025_moderation_workflows.sql` complété par `026_declared_company_updates.sql`; projection locale idempotente dans `data/moderation.sqlite`.

### Fichiers créés ou modifiés

- `apps/web/src/lib/business-intelligence-dossier-types.ts`, `business-intelligence-dossier.ts`
- `apps/web/src/lib/moderation-db.ts`, `admin-auth.ts`, `public-rate-limit.ts`, `moderation.test.ts`, `admin-auth.test.ts`
- `apps/web/src/app/api/companies/[siren]/dossier/route.ts`, `claim/route.ts`, `report/route.ts`, `update-request/route.ts`
- `apps/web/src/app/api/admin/session/route.ts`, `claims/*`, `reports/*`, `updates/*`, `audit/route.ts`
- `apps/web/src/components/company-actions.tsx`, `admin-console.tsx`, `studio-tools.tsx`
- `apps/web/src/app/entreprises/[commune]/[slugSiren]/page.tsx`, `apps/web/src/lib/enterprise-db.ts`, `apps/web/src/app/api/map/establishments/route.ts`
- `apps/web/e2e/map.spec.ts`, `apps/web/vitest.config.ts`, `apps/web/src/test-server-only.ts`
- `apps/web/src/app/globals.css`, `apps/web/src/app/admin/page.tsx`, `apps/web/src/types/lucide-react.d.ts`
- `db/migrations/025_moderation_workflows.sql`, `db/migrations/026_declared_company_updates.sql`, `.env.example`
- `README.md`, `ARCHITECTURE.md`, `DATA_MODEL.md`, `SECURITY.md`, `DEPLOYMENT.md`, `CURRENT_STATE.md`, `BLOCKERS.md`, `PROGRESS.md`

### Validation intermédiaire

- `npm run typecheck` : succès.
- `npm run lint` : succès sans avertissement.
- `npm run test` : 11 tests Vitest réussis, dont le cycle revendication approuvée → enrichissement déclaré → publication séparée et la session admin HMAC.
- `$env:PYTHONPATH = "backend;."; python -m pytest -q backend/tests --basetemp .pytest-tmp-moderation` : 70 tests Python réussis lors de la validation précédente.
- `npx playwright test e2e/map.spec.ts -g "dossier|public report" --project=chromium` : 3 tests réussis.

### Limites restantes

- Le bootstrap admin à jeton ne remplace pas encore les comptes `USER`/`COMPANY_OWNER`, la récupération de compte, MFA et le rattachement du workspace à un utilisateur.
- Le rate limiting public est mémoire et doit être remplacé par Redis en multi-instance; le registre de modération local doit migrer vers PostgreSQL.
- Les actions d’import, de relance de job, de correction géographique et de recalcul restent opérées par scripts; aucune fausse action n’est exposée dans l’UI.
- La couverture des mandats, sites publics, presse et recrutement reste partielle et mesurée; France Travail reste désactivé sans identifiants officiels.

### Validation finale après implémentation — 19 juillet 2026

- `npm run typecheck` : succès.
- `npm run lint` : succès sans avertissement.
- `npm run test` : 11 tests Vitest réussis sur 6 fichiers.
- `$env:PYTHONPATH = "backend;."; python -m pytest -q backend/tests --basetemp .pytest-tmp-moderation-final` : 70 tests Python réussis.
- `npm run build` : build Next.js de production réussi; les routes dossier, modération et session admin sont compilées.
- `npm run test:e2e` : 32 tests Playwright réussis sur Chromium desktop et mobile.
- Smoke HTTP existant : `/api/admin/session` non configuré sans secrets, comportement attendu; la validation positive du jeton, du cookie signé et du RBAC est couverte par `admin-auth.test.ts`.
- Un lancement ponctuel d’un second serveur configuré par job PowerShell n’a pas démarré; aucun processus ni port de test n’est resté actif.
