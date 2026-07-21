# Pipeline d'Import

Pipeline cible idempotent et reprenable:

1. télécharger ou interroger la source;
2. valider le format;
3. filtrer le périmètre géographique configurable;
4. normaliser;
5. dédupliquer;
6. upsert `companies`;
7. upsert `establishments`;
8. appliquer les statuts de diffusion courants;
9. géocoder ou enrichir uniquement les adresses non restreintes manquantes;
10. associer les secteurs;
11. générer ou mettre à jour les descriptions factuelles;
12. enrichir les événements BODACC, organismes de formation, qualifications et aides ADEME, conventions SCDL, projets Fonds vert et France Relance, marchés DECP, présences OSM, sites publics rattachés, mandats publics RNE et signaux média;
13. rattacher les libellés NAF INSEE versionnés;
14. recalculer les index;
15. générer les statistiques;
16. publier;
17. enregistrer un rapport final.

Chaque run écrit dans `data_import_runs`: source, version, lignes lues, créations, mises à jour, éléments ignorés, erreurs, durée et logs.

Scripts disponibles:

- `scripts/build_guadeloupe_sqlite.py`: télécharge le stock consolidé filtré sur les communes 971, protège les noms de personnes physiques, construit les index FTS5/RTree et publie atomiquement la base locale.
- `scripts/import_recherche_entreprises_guadeloupe.py`: bootstrap réel géolocalisé via API Recherche d'Entreprises, non exhaustif.
- `scripts/import_sirene_stock_guadeloupe.py`: chemin de rafraîchissement filtrant le stock officiel `StockEtablissement` data.gouv.fr/Insee, avec reprise, conversion UTM 20N/WGS84 et conservation des champs siège, effectif, employeur, périodes et fraîcheur.
- `scripts/import_sirene_unites_legales_guadeloupe.py`: téléchargement parallèle reprenable du parquet `StockUniteLegale`, puis extraction des seuls SIREN territoriaux avec ESS, mission, RNA, effectifs et périodes, sans champs d'identité personnelle.
- `scripts/import_naf_labels.py`: télécharge la nomenclature NAF rév. 2 officielle INSEE et publie atomiquement les libellés de sous-classe utilisés par les fiches et descriptions factuelles.
- `scripts/import_sirene.py`: dry-run initial historique.
- `scripts/import_osm_business_profiles.py`: télécharge l'extrait Geofabrik Guadeloupe, sélectionne les références SIREN/SIRET exactes, extrait les attributs professionnels OSM et publie atomiquement un index SQLite avec provenance et couverture.
- `scripts/enrich_official_websites.py`: analyse de façon reprenable les pages publiques reliées par identifiant exact depuis OSM et les URLs RNA dont la publication est autorisée, applique robots/SSRF/limites de taille, extrait uniquement descriptions courtes et prestations explicites, puis upsert un index SQLite sans HTML brut.
- `scripts/import_rna_association_profiles.py`: résout la dernière ressource WALDEC parquet, reprend le téléchargement, filtre par RNA exact, recroise le SIRET, exclut les champs personnels et publie atomiquement l'index associatif avec rapport de qualité.
- `scripts/import_public_grants.py`: audite le catalogue SCDL, exige une licence ouverte explicite, met en cache les CSV, normalise les variantes, joint SIRET/RNA exactement, conserve les occurrences sources et publie atomiquement l'index des conventions avec rapport de couverture.
- `scripts/import_ademe_financial_aids.py`: résout les métadonnées ADEME, met en cache l'export daté, filtre les bénéficiaires par SIRET exact, sépare les SIRET actifs locaux des autres établissements et publie atomiquement l'index des aides engagées.
- `scripts/import_fonds_vert_projects.py`: récupère les métadonnées et CSV ministériels 2023-2025, normalise les variantes SIREN/SIRET, sépare localisation du projet et périmètre bénéficiaire, déduplique et publie atomiquement l'index avec rapport de couverture.
- `scripts/import_france_relance_industrial_projects.py`: valide la licence et l'export DGE, met le CSV en cache, normalise les SIREN/SIRET, conserve les descriptions de projet sans les transformer en description d'entreprise, sépare le périmètre territorial et publie atomiquement l'index avec rapport de couverture.
- `scripts/import_training_organizations.py`: résout l'export quotidien ministériel, contrôle licence/type/taille, normalise NDA/SIREN/SIRET, extrait catégories qualité et données BPF, exclut noms/rues/contacts, puis publie atomiquement un index avec rapport de couverture.
- `scripts/import_professional_equality_index.py`: résout le classeur Egapro officiel, contrôle licence/type/taille, joint les SIREN déclarants et membres d'UES explicites, distingue scores calculés/NC/non applicables, exclut les données individuelles et publie atomiquement l'historique avec rapport de couverture.
- `scripts/import_financial_ratios.py`: valide les métadonnées BCE/INPI et la Licence Ouverte, requête uniquement les SIREN actifs diffusables par lots repris sur cache, conserve séparément les bilans C/S/K et publie atomiquement les exercices et définitions officielles.
- `scripts/import_detailed_financial_statements.py`: télécharge le Parquet BCE/INPI détaillé par segments repris, filtre les SIREN territoriaux avec DuckDB, dérive les agrégats DGFiP et publie un index sans document ni personne.
- `scripts/import_public_officers_guadeloupe.py`: interroge l'API officielle par SIREN exact avec `complements`, `dirigeants` et `finances`, respecte le débit public, journalise les réponses, remplace les mandats et agrégats d'un SIREN de manière idempotente, reconstruit FTS5 et reprend les SIREN déjà enrichis avec `--resume` ou les profils historiques manquants avec `--refresh-profiles --resume`. Le mode `--bulk-department --department 971 --resume` parcourt la recherche départementale par pages de 25, conserve `department_runs` et s'arrête au plafond réellement renvoyé par l'API.
- `scripts/enrich_company_press.py`: collecte à la demande des métadonnées média GDELT/Google News pour une liste bornée de SIREN, déduplique les URLs par fournisseur, journalise les états `ok`, `empty`, `partial` ou `error` et n'enregistre jamais le contenu des articles. Il accepte `--priority --limit N --offset K` pour prioriser les entreprises actives à plus forte tranche d'effectif, utilise le nom commercial public quand il existe, exécute les deux fournisseurs en parallèle par cible, borne chaque requête par `--timeout` et met GDELT en cooldown après `429`.
- `scripts/import_bodacc_guadeloupe.py`: filtre le jeu BODACC officiel sur le département 971, joint les annonces par SIREN exact, conserve une projection sans personnes ni payload brut, et publie `data/bodacc-guadeloupe.sqlite`. Le mode `--export` est recommandé pour la volumétrie; la pagination `--resume` permet les imports contrôlés.
- `apps/web/src/lib/france-travail.ts`: adaptateur serveur optionnel pour les offres actives France Travail. Il exige `FRANCE_TRAVAIL_RECRUITMENT_LIVE=true` et des identifiants API; il ne retient qu'une offre portant un SIREN/SIRET correspondant et n'utilise pas de scraping.

Le collecteur web peut être limité ou relancé avec un autre snapshot RNA :

```bash
python scripts/enrich_official_websites.py --rna-input data/rna-association-profiles.sqlite
```

Les emails OSM ne sont pas recopiés dans l'index web : seuls les emails génériques explicitement filtrés sont exposés dans la présence OSM. Les URLs RNA sont retenues uniquement lorsque `website_publication_authorized=1`; une URL malformée est journalisée comme erreur et n'est pas réparée par heuristique.

L'instance publique Overpass n'est pas utilisée comme backend applicatif. Le développement local s'appuie sur l'extrait OSM territorial; la production doit planifier son rafraîchissement ou charger les mêmes données dans PostGIS.

Le runtime SQLite est adapté au vertical slice local. Le déploiement multi-instance cible PostgreSQL/PostGIS, avec les mêmes règles de périmètre et de priorité des sources.

### Mandats publics

Le pipeline de mandats ne prétend pas couvrir toute la population tant que chaque SIREN n'a pas reçu une réponse officielle. `fetch_log` distingue les réponses `ok`, vides et en erreur, ainsi que `profile_status`; `department_runs` conserve le pointeur de page, le statut, les volumes lus et les erreurs; `metadata` conserve le nombre de SIREN indexés, la couverture, le plafond API et les lignes d'agrégats. Une interruption peut laisser l'index FTS à reconstruire : relancer le script avec `--bulk-department --department 971 --resume` reprend au dernier commit; `--refresh-profiles --resume` reste réservé aux profils exacts déjà journalisés.

### Agrégats Annuaire et veille média

Les tables locales `annuaire_profiles`, `annuaire_financials`, `annuaire_labels` et `annuaire_agreements` sont une projection expurgée de la réponse API. Les objets imbriqués de collectivités et d'élus ne sont pas copiés. La fiche BI préfère ce snapshot lorsque le SIREN est indexé; sinon elle utilise le live comme repli et affiche le périmètre.

Le cache `press-signals.sqlite` est séparé du stock administratif. Il doit être alimenté par une liste de SIREN ciblée ou une limite explicite, puis planifié selon la capacité des fournisseurs. Les titres et liens média sont des signaux de veille à faible confiance; ils ne deviennent ni description d'activité ni preuve de notoriété.

### BODACC

L'index local BODACC est un cache d'événements publiés, pas un état juridique temps réel. Une exécution standard couvre les annonces à partir de 2020; `--all-history` étend le périmètre. Le script est idempotent sur `(siren, event_id)`, conserve un journal `import_runs` et met à jour `metadata` avec le filtre, l'offset, le volume source et le volume rattaché. Les blocs `listepersonnes`, `acte` et les descriptions juridiques libres sont utilisés au besoin en mémoire pour extraire une forme/capital ou une activité, puis ne sont jamais écrits.

```bash
python scripts/import_bodacc_guadeloupe.py --since 2020-01-01 --export
python scripts/import_bodacc_guadeloupe.py --all-history --export
```

## Conventions collectives et OPCO

`scripts/import_collective_agreements.py` valide les deux jeux ouverts SIRET-IDCC/SIRO et l'intégrité du paquet KALI, joint les SIRET actifs exacts, conserve les millésimes séparés, exclut la diffusion restreinte et publie atomiquement l'index avec rapport de qualité.

```bash
python scripts/import_collective_agreements.py
```

Les codes `5100`, `5501`, `9998` et `9999` restent des états déclaratifs. Les écarts IDCC sur les SIRET présents dans les deux sources sont signalés, jamais corrigés automatiquement.

## Portefeuilles de brevets

```bash
python scripts/import_patent_portfolios.py --workers 12
```

Le pipeline télécharge le CSV national des déposants, filtre les SIREN exacts actifs et publiables, puis interroge les trois jeux compagnons uniquement pour les demandes et familles trouvées. Les réponses ciblées sont mises en cache par hash de la liste d'identifiants et version de source. La publication SQLite est atomique.

L'import ne sélectionne aucun inventeur ni déposant personne physique. Les familles partagées sont conservées une fois par unité légale correspondante; les agrégats distinguent familles, demandes et classifications.

## Ratios financiers BCE/INPI

```bash
python scripts/import_financial_ratios.py --workers 16 --chunk-size 150
```

Les 109 825 SIREN actifs et diffusables sont découpés en 733 lots. Chaque réponse ODS paginée est stockée dans `data/imports/financial-ratios/chunks` avec la version source et le hash exact du lot. Une reprise ne réinterroge que les lots absents ou invalides.

La normalisation valide SIREN, date, type C/K/S et nombres finis. Une clé SIREN/date/type déduplique les 213 répétitions identiques observées. Les valeurs brutes confidentielles restent auditables dans l'index; leur masquage relève du contrat API. La base `.part` est remplacée atomiquement après validation et un rapport JSON consigne appels, cache, couverture et anomalies.

## Bilans financiers détaillés

```bash
python scripts/import_detailed_financial_statements.py
```

L'import valide le catalogue, la Licence Ouverte, l'hôte officiel, la taille et la signature Parquet. Le fichier national est découpé en 48 plages HTTP, téléchargées par quatre travailleurs maximum et reprises depuis chaque segment validé. DuckDB filtre ensuite les seuls SIREN territoriaux actifs et diffusables dans un Parquet local versionné par hash.

La transformation normalise les cellules numériques, déduplique par SIREN/date/type, dérive 24 agrégats d'après les formulaires DGFiP et publie l'index SQLite par remplacement atomique. Le rapport conserve volume, couverture par métrique, anomalies de date, confidentialité et preuve d'absence de données personnelles ou documentaires.

Les valeurs `-2 147 483 648` et `2 147 483 647` sont traitées comme saturations techniques du type entier source. Elles sont comptées dans `saturated_int32_cell_count`, retirées des cellules valides et ne participent à aucune somme dérivée.
