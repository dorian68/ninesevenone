# Blocages

## 2026-07-18

- Aucun dépôt initial n'existait. Solution: création d'un socle neuf documenté dans `CURRENT_STATE.md`.
- Le téléchargement direct du stock officiel INSEE a été très lent, mais il a finalement abouti et l'archive a passé le contrôle ZIP. Le stock du 1er juillet 2026 est désormais la source administrative active.
- L'authentification multi-utilisateur et l'administration complète ne peuvent pas encore être considérées production. Une console bootstrap protégée, un RBAC serveur à trois rôles, des files de revendication/signalement/enrichissement et un audit local sont maintenant livrés; `COMPANY_OWNER`/`USER`, comptes, MFA, imports opérés et migration Postgres restent à industrialiser.
- `npm audit` signale encore deux vulnérabilités modérées PostCSS provenant de la dépendance interne de Next 16.2.10. Le seuil high passe; éviter `npm audit fix --force` car npm propose un downgrade cassant vers Next 9.3.3.
- `StockUniteLegale` est désormais intégralement rapproché : 120 710 unités légales sur 120 710 SIREN territoriaux. Aucun champ de nom personnel n'est sélectionné.
- 13 243 établissements actifs n'ont pas de position publiée après application des statuts de diffusion. Ils restent recherchables et ne sont pas placés arbitrairement au centroïde d'une commune.
- GDELT applique ponctuellement une limitation de débit. Le repli Google News RSS est actif; les mentions média restent probabilistes et ne peuvent être qualifiées d'exhaustives.
- L'Annuaire des Entreprises fournit les agrégats financiers et signaux de labels/aides; l'ADEME fournit désormais les certificats RGE détaillés. Les comptes détaillés, montants d'aides et justificatifs des autres certifications restent exclus tant qu'une source ouverte ou un accès contractuel autorisé n'est pas validé.
- La présence numérique OSM ne couvre que 564 entreprises sur 120 710. Le fallback est un état vide explicite; aucun rapprochement approximatif par nom n'est publié automatiquement.
- Les emails OSM ne sont présents que pour 40 boîtes fonctionnelles génériques et restent des attributs communautaires. Les boîtes nominatives sont exclues; l'absence d'email ne permet aucune conclusion sur les moyens de contact de l'entreprise.
- SQLite `node:sqlite` est expérimental dans Node 24. Il sert au vertical slice local; PostgreSQL/PostGIS reste la cible de production.
- L'index de sites publics concerne 310 entreprises rattachées exactement et 224 pages accessibles sur 323 références; les refus robots, erreurs réseau et pages non structurées restent des états vides explicites; aucun crawling opportuniste ni rapprochement par nom n'est utilisé. Deux URLs RNA autorisées sont malformées dans la source et ne sont pas corrigées par heuristique.
- Le champ `caractereEmployeurUniteLegale` est intégralement nul dans le parquet mensuel utilisé. Le repli est le champ établissement, disponible pour 128 523 SIRET; 640 restent explicitement non renseignés.
- Le RNA contient 18 divergences SIRET, 74 identifiants reliés à plusieurs SIREN et 3 contradictions position/date de dissolution. La solution de repli conserve chaque profil par clé SIREN+RNA, abaisse la confiance et affiche l'anomalie au lieu de choisir arbitrairement.
- L'API Data.Subvention d'API Entreprise est réservée aux agents habilités ou usagers authentifiés; elle ne peut pas alimenter des fiches publiques. Solution de repli : import des conventions SCDL sous licence ouverte explicite depuis data.gouv.fr, avec couverture partielle clairement affichée.
- Sur 52 ressources CSV SCDL ouvertes, 15 sont inexploitables (liens cassés, page HTML ou schéma sans identifiant bénéficiaire structuré). Elles sont consignées dans `resource_imports` et ignorées sans bloquer les 37 ressources valides.
- Les 396 conventions trouvées concernent des SIRET hors stock actif guadeloupéen. Elles restent rattachées exactement à l'unité légale, mais l'interface interdit de les présenter comme aides locales ou comme preuve d'un versement en Guadeloupe.
- L'export ADEME contient 633 dossiers visant un autre SIRET d'une unité légale également implantée en Guadeloupe. Solution : conserver le signal national avec une confiance de 0,98, mais isoler les 264 dossiers sur SIRET actif local dans tous les agrégats territoriaux.
- Le CSV Fonds vert biodiversité P113 2024 ne contient ni SIREN ni SIRET bénéficiaire. Solution : l'exclure du rapprochement automatique et importer uniquement les millésimes 2023-2025 identifiables; aucun rapprochement par nom n'est autorisé.
- La documentation Fonds vert avertit que certains codes commune peuvent désigner le porteur plutôt que le lieu réel. Solution : afficher cette réserve, conserver le code brut et séparer strictement localisation du projet et SIRET du bénéficiaire.
- Le jeu industriel France Relance n'a pas été mis à jour depuis le 8 avril 2022 et ne publie aucun montant individuel. Solution : afficher explicitement la fraîcheur, conserver uniquement le statut de projet lauréat et ne calculer aucun montant.
- Certaines descriptions France Relance couvrent des projets collaboratifs et citent plusieurs partenaires. Solution : les afficher comme descriptions du projet source, sans les convertir en prestations ou description commerciale du bénéficiaire principal.
- Les spécialités et volumes de la Liste publique OF proviennent d'un bilan pédagogique et financier antérieur et ne prouvent pas qu'une formation précise soit actuellement ouverte. Solution : afficher la période BPF, qualifier chaque valeur comme déclarée et interdire toute extrapolation d'offre actuelle.
- Le champ ministériel des anciens NDA peut répéter le NDA courant. Solution : normaliser, dédupliquer et retirer systématiquement le numéro actif avant stockage.
- Le fichier Egapro publie des résultats au niveau entreprise ou UES et ne permet pas de conclure sur une rémunération individuelle. Solution : conserver uniquement les scores agrégés, afficher le rattachement UES et interdire les qualifications automatiques de conformité ou de discrimination.
- L'année Egapro est une année de référence et le score peut être `NC` lorsque le minimum d'indicateurs calculables n'est pas atteint. Solution : conserver le statut source séparément d'une cellule non applicable et afficher le dernier score calculable sans masquer la déclaration annuelle plus récente.
- Les jeux SIRET-IDCC et SIRO n'ont pas le même mois de référence et peuvent publier des IDCC différents pour un même SIRET. Solution : conserver chaque source séparément, afficher mai 2026 et avril 2026 et signaler les 765 écarts sans arbitrage automatique.
- Une entreprise peut déclarer plusieurs IDCC et les codes 5100, 5501, 9998 ou 9999 ne sont pas des conventions nommées. Solution : conserver toutes les lignes, distinguer codes substantifs et états, sans choisir arbitrairement une convention principale.
- SIRO peut publier un OPCO propriétaire différent du gestionnaire ultramarin. Solution : afficher les deux rôles; AKTO peut assurer en Guadeloupe la gestion territoriale pour Atlas ou OPCO2I.
- La présence ou l'absence d'un IDCC DSN ne détermine pas seule le droit applicable. Solution : avertissement visible, millésime et lien Légifrance, sans conseil juridique automatisé.
- Le jeu `Marques françaises` affichait une licence non spécifiée lors de l'audit du 19 juillet 2026. Solution : ne pas importer les 2,9 Go ni se fonder sur une réutilisation tierce tant qu'une licence et un canal officiels exploitables ne sont pas confirmés.
- Les listes de lauréats France 2030 sont hétérogènes et beaucoup ne publient pas de SIREN/SIRET. Solution : refuser tout rapprochement par nom; l'audit continue jeu par jeu.
- Les brevets des grands groupes et organismes nationaux ne sont pas localisables à un établissement à partir du seul SIREN. Solution : qualifier systématiquement le signal comme portefeuille national de l'unité légale et ne calculer aucune métrique locale d'invention.
- PATSTAT et les SIREN récupérés depuis l'INPI ne couvrent pas exhaustivement tous les dépôts. Solution : afficher la fraîcheur et interdire l'interprétation d'une absence de ligne comme absence de propriété industrielle.
- Les millésimes des familles détaillées et des déposants ne sont pas identiques. Solution : conserver chaque date source; les 17 258 familles sources trouvées sont toutes résolues, sans inventer de métadonnée plus récente.
- Le jeu BCE/INPI contient des zéros techniques sur certains montants lorsque le bilan est `Partiellement confidentiel`. Solution : conserver la valeur brute pour audit mais renvoyer `null` pour chiffre d'affaires, marge brute, EBE et EBIT dans l'API publique, avec un avertissement explicite.
- Un même SIREN et une même clôture peuvent porter des bilans C, S et K légitimes. Solution : clé incluant le type, sélecteur de série dans l'interface et interdiction de mélanger les types dans une tendance.
- Le jeu national BCE/INPI contient des dates de clôture postérieures à sa date de mise à jour. Solution : les marquer `future_closing_date` et les exclure par défaut; aucune de ces anomalies ne concerne les 35 009 exercices du sous-ensemble territorial actuel.
- Les comptes BCE/INPI décrivent l'unité légale nationale, pas son établissement guadeloupéen. Solution : périmètre `national_legal_unit` visible et aucune ventilation locale ou conclusion de solvabilité.
- Les API/SFTP documentaires RNE de l'INPI nécessitent un compte authentifié et les actes ou PDF peuvent contenir des données personnelles. Solution : ne pas les aspirer; utiliser le Parquet détaillé ouvert de Signaux Faibles, strictement numérique et sans personne, puis conserver les cellules brutes hors de l'API publique.
- La ressource nationale des bilans détaillés pèse 2,82 Go et son hébergeur limite le débit des longues réponses. Solution : téléchargement par plages reprenables à concurrence bornée, cache local versionné et sous-ensemble territorial Parquet pour tous les recalculs suivants.
- Le Parquet détaillé sature certains montants de grands groupes à `INT32_MIN`/`INT32_MAX`; 3 943 cellules territoriales sont concernées. Solution : les compter et les remplacer par une absence avant tout agrégat, sans tenter de reconstruire un montant supérieur non publié.
- Les styles OpenFreeMap Positron et Bright ne rendent pas correctement les terres ultramarines au zoom d'ensemble mobile, même lorsque les tuiles vectorielles répondent. Solution : Liberty en mode clair et Fiord en mode sombre, tous deux contrôlés visuellement sur l'archipel; le fournisseur public reste sans SLA.
- Le studio de prospection et le brouillon CV ne disposent pas encore d'authentification, de partage persistant ni d'audit d'export. Solution actuelle : état local au navigateur, export explicite borné aux données professionnelles publiques et mention visible de cette limite; aucun contact personnel n'est collecté.

## 2026-07-19 — mandats publics RNE

- Il n'existe pas de fichier ouvert officiel unique permettant de télécharger en une fois tous les mandats publics rattachables aux 120 710 SIREN du stock. L'API Recherche d'entreprises impose un débit public limité et plafonne les recherches départementales à 10 000 résultats dans le lot observé. Solution : importer par SIREN exact ou par pages territoriales bornées et reprenables, journaliser chaque réponse et afficher le ratio de couverture.
- Le lot contrôlé couvre désormais 10 599 SIREN et 14 534 mandats sur 120 710 SIREN; il ne faut pas présenter la recherche locale comme exhaustive. Solution : fallback textuel vers l'API officielle, badge de source, date RNE et absence explicitement non concluante.
- Les réponses publiques peuvent contenir davantage d'attributs personnels que nécessaire à la recherche. Solution : parser uniquement le nom affiché, la qualité, le type et le SIREN de personne morale publié; aucune date de naissance, nationalité, adresse ou coordonnée n'entre dans SQLite, l'API ou l'UI.

## 2026-07-19 — couverture BI et recherche

- Les libellés NAF précis sont dépendants de l'édition INSEE utilisée. Solution : versionner 732 libellés NAF rév. 2 et documenter séparément le passage à la NAF 2025 prévu par l'INSEE; aucune conversion silencieuse n'est effectuée.
- Les sources BI ne produisent pas toutes une donnée pour chaque SIREN. Solution : exposer la matrice `ok`/`empty`/`unavailable` par fiche et ne jamais convertir une absence de ligne en absence d'activité.
- Le fallback officiel des dirigeants reste limité par le débit de l'API et le lot local ne couvre que 10 599 SIREN sur 120 710. Solution : debounce client, cache HTTP, requêtes exactes reprenables et affichage explicite de la date/source.
- Le studio reste local au navigateur. Solution de production encore nécessaire : compte, permissions serveur, stockage chiffré, partage persistant, quotas et audit de l'export.
- Certains lancements Chromium headless répétés perdent le contexte WebGL de MapLibre alors que les tuiles répondent; la couche communale locale reste affichée comme repli géographique. En production, mesurer ce comportement sur les navigateurs cibles et prévoir un fournisseur de tuiles vectorielles ou raster avec SLA avant une ouverture publique à fort trafic.

## 2026-07-19 — agrégats locaux et veille média

- Le lot RNE enrichi reste limité à 10 599 SIREN malgré la collecte départementale; les 110 111 autres unités n'ont pas encore reçu de snapshot exact. L'API départementale a plafonné la réponse à 10 000 résultats sur 400 pages. Solution : `--bulk-department --department 971 --resume`, journal `department_runs` et ratio de couverture affiché, sans prétendre à l'exhaustivité.
- Les recherches média ne peuvent pas être rendues exhaustives : GDELT et Google News dépendent de leur index, de l'homonymie et de limites de débit. Solution : cache borné, statuts fournisseurs, confiance basse et absence non concluante.
- Les prestations issues de sites publics ou d'OSM restent déclaratives. Solution : indexer seulement les formulations explicitement observées, garder l'URL/source et ne pas générer de promesse commerciale.

## 2026-07-19 — collecte départementale Annuaire

- La recherche `departement=971` de l'API Recherche d'entreprises renvoie `total_results=10000` et `total_pages=400` avec `per_page=25`; ce plafond est inférieur aux 120 710 SIREN du stock local. Solution : conserver `api_cap_observed`, arrêter proprement au dernier commit et afficher une couverture de 10 599 / 120 710.
- La collecte par pages ne prouve pas qu'un SIREN hors des 10 000 résultats n'a aucun mandat ou profil public. Solution : jointure SIREN exacte, absence non concluante, et possibilité de compléter par des lots SIREN autorisés.

## 2026-07-19 — BODACC, BOAMP et recrutement

- BODACC : la fenêtre locale 2020-2026 couvre 144 756 annonces et 36 354 SIREN, mais ne constitue pas tout l'historique. Solution : export JSON officiel, option `--all-history`, cache idempotent et fraîcheur visible.
- BOAMP : de nombreux avis territoriaux publient un titulaire sous forme textuelle ou un identifiant d'organisation qui n'est pas un SIREN/SIRET exploitable. Solution : ne pas faire de jointure par nom; conserver le BOAMP comme source territoriale candidate jusqu'à disposer d'une clé exacte.
- France Travail : l'API Offres d'emploi est ouverte sur demande, mais nécessite des identifiants développeur et les modalités de diffusion de contact dépendent du consentement de l'employeur. Solution : adaptateur serveur présent mais désactivé par défaut; seules les offres portant un SIREN/SIRET correspondant seront retenues.
- Recrutement : aucun snapshot massif n'est généré sans accès autorisé, afin d'éviter des appels non bornés à chaque fiche. Une file/couche de cache production reste à planifier après obtention des credentials.

## 2026-07-19 — état après implémentation des workflows

- Les revendications, signalements et enrichissements déclarés sont maintenant opérables dans la console `/admin` avec session signée, RBAC bootstrap et audit local. Le blocage restant est l'authentification utilisateurs complète (`USER`/`COMPANY_OWNER`), pas l'absence de parcours de modération.
- Le workspace reste rattaché à un cookie anonyme; il doit être migré vers un compte et PostgreSQL avant partage ou usage multi-tenant.
- Le rate limiting des endpoints publics est encore mémoire par processus. Redis est requis pour un déploiement horizontal.
- Les imports, reprises de jobs, corrections géographiques et recalculs sont fiables via scripts mais ne sont pas déclenchables depuis l'UI admin; exposer ces actions nécessite un worker authentifié, une file durable et une politique d'autorisation dédiée.
- Le lancement d'un serveur Next secondaire configuré pour un smoke admin n'a pas démarré dans le job PowerShell; la session positive est couverte directement par `admin-auth.test.ts`, et aucun processus de test n'est resté actif.
