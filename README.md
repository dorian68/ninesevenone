# Guadeloupe Entreprises

Plateforme web de cartographie des entreprises et établissements de Guadeloupe.

L'état actuel livre un vertical slice cartographique avec un stock réel à l'échelle du territoire :

- carte MapLibre centrée sur la Guadeloupe ;
- chargement par bounding box via `/api/map/establishments` ;
- clustering serveur dynamique selon la zone et le zoom ;
- recherche plein texte accent-insensitive et autocomplétion structurée via `/api/search`, avec suggestions locales bornées pendant la saisie, recherche tolérante aux fautes bornée et recherche officielle complète sur validation ;
- filtres secteur, commune, tranche d'effectif, siège, employeur, code postal, création récente et fiche vérifiée reflétés dans l'URL ;
- hover desktop stabilisé et bottom sheet mobile ;
- panneau latéral et pages entreprises SSR ;
- fonds vectoriels OpenFreeMap clair/sombre basés sur OpenStreetMap, avec style territorial local de secours ;
- stock SIRENE consolidé indexé localement en SQLite/FTS5/RTree ;
- profil officiel SIRENE enrichi : siège, ESS, société à mission, RNA, catégorie, effectif daté, caractère employeur et fraîcheur ;
- fiches BI enrichies par SIRENE, RNA, Annuaire des Entreprises, mandats publics RNE minimisés, ratios et bilans détaillés BCE/INPI, organismes de formation et Qualiopi, Index Egapro, conventions collectives/OPCO, brevets, conventions SCDL, aides ADEME, projets Fonds vert et France Relance, qualifications RGE, BODACC, commande publique DECP, OpenStreetMap, sites publics rattachés et veille média ;
- dossier BI sourcé par entreprise via `/api/companies/{siren}/dossier`, avec activités observées, taille, finance, contrats, presse, chronologie, gouvernance publique, couverture et export Markdown ;
- revendication, signalement et proposition d’enrichissement déclaratif avec validation Zod, limitation par IP, file admin et journal d’audit ;
- schéma PostgreSQL/PostGIS et squelette FastAPI/import.

Le stock actif est daté du 1er juillet 2026 et couvre les 32 communes actuelles du département 971 : **120 710 entreprises juridiques**, **129 163 établissements actifs**, dont **115 920 positions publiables** après application des statuts de diffusion. Les autres établissements restent accessibles par la recherche sans géolocalisation artificielle. Ces chiffres décrivent la couverture du stock importé et ne constituent pas une promesse de couverture en temps réel.

Le profil officiel identifie notamment **118 050 sièges**, **20 933 établissements déclarés employeurs**, **12 631 structures du champ ESS**, **41 sociétés à mission** et **9 483 identifiants RNA**. Ces valeurs reflètent le stock SIRENE de référence; une absence ou une valeur négative ne constitue pas une conclusion sur la situation actuelle.

Les réponses BI sont dédupliquées en mémoire pendant cinq minutes par SIREN et ensemble d'établissements actifs, avec une limite de 128 entrées et une déduplication des requêtes concurrentes. Ce cache réduit le coût de lecture sans masquer la date de référence de chaque source.

L’index local des mandats publics utilise l’API officielle Recherche d’entreprises par SIREN exact. Le lot territorial contrôlé au 19 juillet 2026 couvre **10 599 SIREN sur 120 710** et **14 534 mandats**, soit **8,7805 %**; l’API a exposé **10 000 résultats sur 400 pages**, donc cette couverture reste partielle, reprenable et affichée comme telle. Les dates de naissance, nationalités, adresses et contacts personnels sont écartés dès l’import.

L'index RNA rapproche exactement **9 470 associations sur 9 483 identifiants**, dont **9 469 objets statutaires**, 182 positions dissoutes et 18 reconnaissances d'utilité publique. Les contradictions de statut ou de SIRET sont affichées comme anomalies à vérifier.

L'index ouvert des conventions de subvention SCDL contient **396 conventions uniques** reliées exactement à **23 SIREN** présents sur le territoire. Les **25,17 M€** correspondent au cumul des montants attribués publiés, pas à des versements prouvés ni nécessairement réalisés en Guadeloupe; les SIRET historiques ou hors stock actif local sont signalés.

L'index ADEME contient **897 dossiers d'aides engagées** pour **258 SIREN**, dont **264 dossiers visant un SIRET actif guadeloupéen** pour 27,34 M€ publiés. Les 633 lignes rattachées à d'autres SIRET de la même unité légale restent séparées du périmètre local.

L'index Fonds vert rapproche exactement **221 projets** avec **57 SIREN** présents sur le territoire. Parmi eux, **120 projets sont codés en Guadeloupe** pour **31,44 M€ engagés publiés** entre 2023 et 2025. Les 101 projets codés hors Guadeloupe restent des signaux nationaux de l'unité légale et n'entrent pas dans le cumul territorial.

L'index industriel France Relance relie exactement **33 projets** à **25 entreprises** présentes dans le stock territorial. Douze projets sont localisés en Guadeloupe, 21 hors de l'archipel, 21 disposent d'une description publique et 4 d'un indicateur CO2. Le jeu ne publie aucun montant individuel et n'est pas présenté comme une preuve de versement.

La Liste publique des organismes de formation couvre **1 410 profils** et **1 404 entreprises** du stock territorial. Elle identifie 1 235 déclarations rattachées à la Guadeloupe, 491 profils avec une certification qualité active publiée et 1 317 profils avec spécialités de formation déclarées. Les volumes de stagiaires et formateurs restent attribués à la période BPF publiée.

L'Index de l'égalité professionnelle Egapro relie **2 653 déclarations annuelles** à **460 entreprises** du stock territorial entre 2018 et 2025. Il comprend 2 210 index calculables et 443 index publiés `NC`; 346 rattachements proviennent de listes de membres d'UES explicites. Les scores sont des résultats agrégés et ne révèlent aucune rémunération individuelle.

L'index financier BCE/INPI relie **35 009 exercices** à **9 281 entreprises** actives et diffusables du stock territorial : 21 563 bilans complets, 13 213 simplifiés et 233 consolidés. Les types de bilans ne sont jamais fusionnés. Pour 7 526 exercices à diffusion partielle, les montants non diffusés sont masqués et ne sont pas présentés comme des zéros réels. Aucun score de crédit ou de solvabilité n'est calculé.

L'index BCE/INPI détaillé relie **34 020 exercices** à **9 087 entreprises** : 21 069 bilans complets, 12 701 simplifiés et 250 consolidés. Il dérive 24 agrégats depuis 2 377 454 cellules fiscales valides. Les 7 176 comptes à diffusion partielle conservent leurs agrégats de bilan mais leur compte de résultat est masqué; 3 943 cellules saturées aux bornes INT32 de la source sont écartées plutôt que présentées comme des montants réels.

L'index BODACC local contient **144 756 annonces lues depuis 2020**, dont **90 930 lignes rattachées à 36 354 SIREN** par identifiant exact. Il conserve les événements et activités publiés, sans payload juridique brut ni noms de personnes; ce signal légal daté ne prouve pas une activité actuelle.

## Démarrage local

```bash
npm install
npm run dev
```

Puis ouvrir `http://localhost:3000`.

Le lien **Studio outils** ouvre `/outils` : recherche de candidats par secteur et commune depuis l'index actif, analyse BI à la demande, dossier exportable, lecture des faits secondaires (dirigeants publics, brevets, exercices financiers, aides, formation, RGE et ICPE), shortlist locale exportable en CSV, brief de proposition commerciale et brouillon de CV ciblé. Les recherches, shortlists et brouillons peuvent être enregistrés dans un espace anonyme persistant 180 jours via cookie HttpOnly; le rattachement à des comptes et le partage multi-utilisateur restent à activer pour la production.

La page `/admin` expose la couverture en lecture seule et, uniquement lorsque `ADMIN_ACCESS_TOKEN` et `ADMIN_SESSION_SECRET` sont définis côté serveur, les files de revendications, signalements et enrichissements déclarés. Les décisions sont écrites dans `data/moderation.sqlite`, séparées des faits officiels et visibles dans le journal d’audit. Ce bootstrap à jeton est adapté au déploiement contrôlé local; une authentification utilisateurs complète est requise avant une ouverture multi-tenant.

## Validation

```bash
npm run typecheck
npm run test
npm run build
```

## Services de données

```bash
docker compose up -d
```

PostgreSQL inclut PostGIS, `pg_trgm` et `unaccent`.

## Imports

Construire l'index local à partir de l'export public consolidé :

```bash
python scripts/build_guadeloupe_sqlite.py --refresh
```

Extraire les unités légales officielles nécessaires au territoire :

```bash
python scripts/import_sirene_unites_legales_guadeloupe.py --workers 16
```

Construire l'index de présence professionnelle OSM à partir de l'extrait territorial Geofabrik :

```bash
python scripts/import_osm_business_profiles.py --download
```

Cet import conserve uniquement les objets portant un `ref:FR:SIREN` ou `ref:FR:SIRET` exact. L'extrait local actuel contient 874 objets reliés à 564 entreprises, avec attribution ODbL visible dans l'interface.

Construire l'index de descriptions et prestations à partir des sites publics rattachés :

```bash
python scripts/enrich_official_websites.py
```

Le collecteur visite uniquement la page publique rattachée, respecte `robots.txt`, bloque les cibles réseau privées, ne conserve ni HTML brut ni email et limite les descriptions réutilisées à 25 mots. L'index actuel porte sur 323 références uniques (OSM et 2 URLs RNA autorisées) et 310 entreprises; cette couverture reste partielle. Les URLs malformées restent en erreur plutôt que d'être corrigées par déduction.

Indexer un lot borné de mandats publics RNE :

```bash
python scripts/import_public_officers_guadeloupe.py --limit 500 --resume
```

Pour reprendre ou étendre le traitement, réutiliser `--resume`; pour un contrôle ciblé, fournir `--siren 498235316`. Après l’ajout du schéma d’agrégats, `--refresh-profiles --resume` reprend uniquement les SIREN déjà journalisés sans snapshot local. Le script interroge l’API officielle par SIREN exact avec `include=complements,dirigeants,finances`, respecte un débit inférieur à la limite publique, journalise chaque réponse et publie `data/public-officers.sqlite` avec FTS5. Il ne conserve que l’identité publique affichée, la qualité du mandat et, pour une personne morale, son SIREN publié; les agrégats financiers, labels, IDCC, taille et compteurs d’établissements sont stockés séparément, sans payload brut. L’API publique ne fournit pas un export massif unique de dirigeants; la couverture doit donc être mesurée par lot.

La barre de recherche accepte aussi les scopes explicites `siren:`, `siret:`, `naf:`, `commune:`, `secteur:`, `adresse:` et `presse:`. Les scopes d'identifiant restent des correspondances locales exactes ou préfixées; `presse:` ne renvoie que les signaux média mis en cache avec leur source. En saisie, l'autocomplétion interroge les index locaux, annule la requête précédente et peut interroger l'Annuaire officiel pour le préfixe explicite `dirigeant:`; une faute simple passe par un fallback fuzzy local borné qui favorise les noms légaux et commerciaux. La touche Entrée déclenche la recherche complète lorsque le réseau est disponible.

Pour parcourir le lot départemental borné et reprendre une interruption :

```bash
python scripts/import_public_officers_guadeloupe.py --bulk-department --department 971 --resume
```

Le run est enregistré dans `department_runs`; `metadata` documente les 10 000 résultats et 400 pages observés. Le plafond de cette recherche empêche de conclure à une couverture exhaustive.

Construire une veille média bornée pour des SIREN explicitement sélectionnés :

```bash
python scripts/enrich_company_press.py --siren 498235316 --siren 219711017 --resume
```

Le cache `data/press-signals.sqlite` conserve uniquement titre, URL, éditeur, date publiée, langue, pays, fournisseur, confiance et date de récupération. `--limit` est accepté uniquement comme limite explicite; une collecte média de toute la base n’est jamais déclenchée par défaut. Pour planifier les entreprises prioritaires : `python scripts/enrich_company_press.py --priority --limit 100 --offset 0 --resume`. Les erreurs fournisseur deviennent `partial` ou `error`, GDELT est placé en cooldown après `429`, et une absence de résultat ne vaut pas absence de presse. Le snapshot du 19 juillet 2026 contient 401 SIREN et 2 771 mentions; 3 `ok`, 238 `partial`, 5 `empty` et 155 `error`.

Indexer les annonces BODACC du département 971 :

```bash
python scripts/import_bodacc_guadeloupe.py --since 2020-01-01 --export
```

`--all-history` couvre l'historique disponible. Le mode `--export` est adapté au volume; pour un import paginé contrôlé, supprimer cette option et utiliser `--resume`. Le fichier `data/bodacc-guadeloupe.sqlite` est lu localement par la fiche BI et son rafraîchissement est affiché.

Construire l'index du Répertoire national des associations :

```bash
python scripts/import_rna_association_profiles.py
```

Le téléchargement WALDEC est reprenable et la jointure utilise uniquement le RNA exact issu de SIRENE. Les champs de dirigeant, déclarant, adresse de gestion, email et téléphone sont exclus.

Construire l'index des conventions de subvention ouvertes :

```bash
python scripts/import_public_grants.py
```

Le script interroge le catalogue SCDL de data.gouv.fr, refuse les jeux sans licence ouverte explicite, met en cache les CSV, valide les variantes de schéma et joint uniquement les SIRET ou RNA exacts. Une seconde exécution est idempotente et réutilise le cache local.

Construire l'index détaillé des aides financières ADEME :

```bash
python scripts/import_ademe_financial_aids.py
```

L'export de 39 160 dossiers est mis en cache selon sa date de mise à jour. Les SIRET actifs du stock territorial sont distingués des autres établissements de la même unité légale.

Construire l'index des projets Fonds vert financés :

```bash
python scripts/import_fonds_vert_projects.py
```

Le pipeline importe les CSV 2023, 2024 et 2025 sous Licence Ouverte, joint uniquement les SIREN/SIRET exacts et sépare la localisation publiée du projet du périmètre juridique du bénéficiaire. Le CSV biodiversité 2024 sans identifiant bénéficiaire n'est pas rapproché automatiquement.

Construire l'index des projets industriels France Relance :

```bash
python scripts/import_france_relance_industrial_projects.py
```

Le pipeline importe l'export DGE sous Licence Ouverte 2.0, normalise les SIREN et SIRET, conserve les descriptions de projet et sépare les projets guadeloupéens des projets nationaux. Aucun montant individuel n'est disponible dans cette source.

Construire l'index des organismes de formation et catégories Qualiopi :

```bash
python scripts/import_training_organizations.py
```

Le pipeline utilise l'export quotidien du ministère du Travail, joint uniquement les SIREN/SIRET exacts et exclut les dénominations personnelles, rues, contacts et organismes étrangers représentés.

Construire l'index annuel de l'égalité professionnelle Egapro :

```bash
python scripts/import_professional_equality_index.py
```

Le pipeline importe le classeur officiel sous Licence Ouverte 2.0, rattache les déclarations par SIREN déclarant ou SIREN membre d'UES explicitement publié et distingue les scores calculés, `NC` et indicateurs non applicables. Il ne conserve ni salarié, ni rémunération, ni contact, ni raison sociale source.

La provenance, les scores et les règles d'enrichissement sont détaillés dans `BI_ENRICHMENT.md`; les mesures de couverture sont dans `DATA_QUALITY_REPORT.md`.

Import rapide géolocalisé :

```bash
python scripts/import_recherche_entreprises_guadeloupe.py --max-pages 4 --per-page 25 --delay 0.6
```

Import du dernier stock officiel SIRENE à filtrer localement :

```bash
python scripts/import_sirene_stock_guadeloupe.py
```

Le fichier officiel `StockEtablissement` pèse plusieurs gigaoctets. Le script reprend un téléchargement interrompu et transforme les coordonnées UTM 20N en WGS84.

Construire l'index des conventions collectives déclarées et des OPCO :

```bash
python scripts/import_collective_agreements.py
```

L'import croise uniquement les SIRET actifs publiables avec les jeux officiels SIRET-IDCC et SIRO. Les deux millésimes restent distincts et les titres proviennent du catalogue officiel KALI.

Construire l'index des portefeuilles de brevets :

```bash
python scripts/import_patent_portfolios.py --workers 12
```

Le scan initial porte sur les déposants personnes morales avec SIREN. Les détails de demandes, familles et technologies sont ensuite récupérés seulement pour les unités légales territoriales trouvées; les réponses sont réutilisées lors des imports suivants.

Construire l'index des ratios financiers BCE/INPI :

```bash
python scripts/import_financial_ratios.py
```

L'import interroge uniquement les SIREN actifs et diffusables par lots de 150, met chaque réponse en cache et publie atomiquement l'index SQLite. Les bilans C, S et K restent séparés; les indicateurs et formules officielles sont conservés sans produire de diagnostic financier.

Construire l'index des bilans fiscaux détaillés BCE/INPI :

```bash
python scripts/import_detailed_financial_statements.py
```

La source nationale Parquet est téléchargée par segments reprenables, puis filtrée localement sur les SIREN actifs et diffusables. L'API restitue 24 agrégats de bilan et de compte de résultat; elle n'expose ni cellules fiscales brutes, ni document, ni donnée personnelle. Le premier téléchargement pèse environ 2,82 Go et reste en cache pour les imports suivants.
