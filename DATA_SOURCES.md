# Sources de Données

Sources autorisées utilisées ou prévues :

- SIRENE / API Sirene INSEE pour entreprises et établissements.
- Nomenclature officielle INSEE NAF rév. 2 pour les libellés précis des codes APE/NAF; import versionné par `scripts/import_naf_labels.py`.
- Stock SIRENE data.gouv.fr/Insee du 1er juillet 2026: `StockEtablissement` et `StockUniteLegale`.
- OpenDataSoft `economicref-france-sirene-v3`, consolidation SIRENE et BAN utilisée uniquement pour compléter les coordonnées non restreintes manquantes.
- BODACC/DILA pour les annonces commerciales et descriptions d'activité déclarées.
- DECP/data.economie.gouv.fr pour les marchés publics attribués.
- BOAMP/DILA pour les avis de marchés et résultats publiés; le rattachement à une entreprise reste conditionné à un identifiant SIREN/SIRET réellement publié.
- API Offres d'emploi France Travail pour les offres actives; accès développeur demandé, données de contact diffusées seulement selon le consentement et les paramètres de publication de l'employeur.
- ADEME `Historique des entreprises RGE depuis 2014` pour qualifications, domaines, organismes, périodes de validité et certificats, avec filtrage exact par SIRET.
- ADEME `Les aides financières de l'ADEME` pour les dossiers non confidentiels engagés depuis 2021, subventions et aides remboursables sans seuil de montant, sous Licence Ouverte.
- Ministère de la Transition écologique `Fonds Vert - Liste des projets subventionnés` pour les projets financés 2023-2025, sous Licence Ouverte 2.0.
- DGE / data.economie.gouv.fr `Plan de relance - Projets industriels` pour les projets lauréats, descriptions, filières et localisations publiées, sous Licence Ouverte 2.0.
- Ministère du Travail `Liste Publique des Organismes de Formation` pour les déclarations d'activité, catégories qualité en cours, spécialités NSF et agrégats BPF, sous Licence Ouverte.
- GDELT et Google News RSS pour une veille média par dénomination exacte, avec confiance probabiliste.
- API Recherche d'Entreprises / Annuaire des Entreprises pour les agrégats financiers publiés, catégorie, effectif, établissements, IDCC, labels, signaux d'aides et mandats publics issus du RNE; les informations de naissance, nationalité, adresse et contact personnel sont écartées.
- data.gouv.fr pour exports publics pertinents.
- Base Adresse Nationale pour géocodage.
- Extrait OpenStreetMap Guadeloupe Geofabrik sous ODbL pour sites, téléphones professionnels, horaires, catégories, services et accessibilité reliés par identifiant exact; attribution conservée.
- OpenStreetMap/Nominatim uniquement dans le respect des conditions d'utilisation.
- Sites publics rattachés par un identifiant OSM exact, uniquement si `robots.txt` et les conditions techniques l'autorisent.
- Enrichissements manuels déclarés par entreprises ou administrateurs.
- Répertoire national des associations du Ministère de l'Intérieur, snapshot WALDEC parquet du 1er juillet 2026 sous Licence Ouverte 2.0.
- Jeux data.gouv.fr associés au schéma `scdl/subventions`, uniquement sous Licence Ouverte ou ODbL explicite, pour les données essentielles des conventions de subvention.

## Stock actif

- Sources administratives : `StockEtablissement` et `StockUniteLegale` SIRENE INSEE/data.gouv.fr.
- Référence : 1er juillet 2026.
- Récupération : 18 juillet 2026.
- Périmètre : liste explicite des 32 codes communaux actuels de Guadeloupe; les anciens libellés Saint-Martin et Saint-Barthélemy sont exclus.
- Couverture : 32 communes, 120 710 SIREN et 129 163 SIRET actifs.
- Couverture unités légales : 120 710 sur 120 710 SIREN présents dans le stock territorial.
- Sièges identifiés : 118 050 établissements; les autres SIREN peuvent avoir leur siège hors du périmètre ou une information non exploitable.
- Signaux officiels : 12 631 unités ESS, 41 sociétés à mission et 9 483 identifiants RNA publiés.
- Caractère employeur établissement : 20 933 `O`, 107 590 `N` et 640 non renseignés; ce champ est déclaratif.
- Effectifs établissement datés : 12 895 valeurs avec année 2023; 12 190 ont également une tranche différente de `NN`.
- Fraîcheur et historique : date du dernier traitement et nombre de périodes conservés pour les 120 710 unités légales et 129 163 établissements.
- Géolocalisation publiable : 115 920 établissements, dont 45 766 coordonnées complétées depuis l'export public ODS SIRENE/BAN d'avril 2026.
- Diffusion restreinte : 11 409 établissements pour lesquels aucun enrichissement historique n'est réinjecté.
- Sans position publiée : 13 243 établissements, disponibles dans la recherche mais absents de la carte.

Les extractions officielles sont produites par `scripts/import_sirene_stock_guadeloupe.py` et `scripts/import_sirene_unites_legales_guadeloupe.py`; l'index et son rapport sont produits par `scripts/build_guadeloupe_sqlite.py`.

La matrice de provenance BI et ses scores sont documentés dans `BI_ENRICHMENT.md`.

## Index BODACC local

- API : `https://www.bodacc.fr/api/explore/v2.1/`, jeu `annonces-commerciales` de la DILA.
- Filtre : département `971`, puis rattachement exact aux SIREN du stock SIRENE local; aucune jointure par nom.
- Import du 19 juillet 2026 : 144 756 annonces lues depuis le 1er janvier 2020, 90 930 lignes rattachées à 36 354 SIREN.
- Données conservées : identifiant d'annonce, date, famille et type, tribunal, commune/code postal publiés, forme/capital lorsqu'un bloc de personne morale est présent, activité déclarée d'établissement et URL officielle.
- Données exclues : payload JSON brut, noms de personnes, administration, adresses issues des blocs juridiques, acte et descriptions libres non nécessaires.
- Reprise : `scripts/import_bodacc_guadeloupe.py --since 2020-01-01 --export`; `--all-history` permet d'étendre la fenêtre, et la pagination `--resume` reste disponible pour les imports contrôlés.
- Limite : une annonce BODACC est un événement de publication; elle ne prouve pas que l'activité décrite est encore actuelle. Les 36 354 SIREN couverts correspondent à cette fenêtre, pas à l'ensemble des entreprises guadeloupéennes.

## Mandats publics RNE

- Source : `https://recherche-entreprises.api.gouv.fr/search`, documentation officielle `https://recherche-entreprises.api.gouv.fr/docs/`.
- Méthode : interrogation par SIREN exact issu du stock SIRENE local; aucun rapprochement par nom de personne n'est utilisé pour rattacher un mandat à une entreprise.
- Données conservées : type de dirigeant public, nom affiché, qualité ou rôle, SIREN de la personne morale lorsqu'il est publié, date de mise à jour RNE, date de récupération et URL source.
- Données exclues à la lecture : date ou année de naissance, nationalité, adresse, email, téléphone, bénéficiaire effectif et document RNE.
- Index local au 19 juillet 2026 : 10 599 SIREN en statut `ok` sur 120 710, 14 534 mandats dédupliqués, couverture `8,7805 %`. Le mode territorial a lu 10 000 résultats sur 400 pages et en a rattaché 9 276 par SIREN exact; il complète un lot exact antérieur et reste strictement partiel.
- Mode de collecte : `scripts/import_public_officers_guadeloupe.py --bulk-department --department 971 --resume` utilise `departement=971`, `per_page=25`, un journal `department_runs` et un pointeur de page reprenable. `metadata` conserve le plafond observé (`total_results=10000`, `total_pages=400`) et le ratio sur le stock SIRENE.
- Limites : l'API publique est limitée en débit et la recherche départementale est plafonnée à 10 000 résultats dans la réponse observée; les SIREN non indexés ne permettent aucune conclusion sur un éventuel mandat.

### Agrégats Annuaire

- Requête : SIREN exact, `minimal=true`, `include=complements,dirigeants,finances`.
- Données conservées : catégorie d'entreprise, tranche et année d'effectif, NAF 2025, nombre d'établissements, nombre d'établissements ouverts, exercice financier publié, labels positifs, signaux d'aide et IDCC.
- Données imbriquées exclues : élus de collectivités, dates de naissance, nationalité, adresse, coordonnées, bénéficiaires effectifs et payload JSON brut.
- Fraîcheur : `date_mise_a_jour` ou `date_mise_a_jour_rne` de la source, plus date de récupération locale.
- Règle d'affichage : le snapshot local est prioritaire pour les SIREN importés; l'API live est un repli pour les SIREN non indexés.

## Veille média

- Fournisseurs : GDELT DOC API et Google News RSS, requête « dénomination exacte + Guadeloupe » sur une fenêtre de trois mois.
- Collecte : uniquement sur SIREN sélectionnés explicitement ou dans une limite bornée; aucune collecte de toute la base par défaut. Le collecteur accepte `--priority --limit N --offset K` pour planifier des batches d'entreprises actives, priorisées par tranche d'effectif, avec reprise `--resume`.
- Données conservées : titre, URL, domaine/éditeur, date publiée, langue, pays, fournisseur, score de confiance, requête et date de récupération.
- Données exclues : texte intégral, extrait éditorial, coordonnées personnelles et profilage de personnes.
- Snapshot local au 19 juillet 2026 : 401 SIREN, 2 771 mentions; 3 `ok`, 238 `partial`, 5 `empty` et 155 `error`. Le second lot prioritaire a ajouté 300 positions aux 101 SIREN historiques; les titres et URLs restent des signaux, pas une preuve de notoriété.
- Limites : homonymie, indexation incomplète et indisponibilité fournisseur; GDELT peut répondre `429` et passe alors en cooldown, tandis que Google News est conservé indépendamment. `partial`/`error` sont exposés et l'absence n'est jamais interprétée comme absence de presse.

## Recrutement et BOAMP

- France Travail : l'API officielle restitue des offres actives en temps réel, avec filtres de département et consultation paginée. L'adaptateur local est présent mais désactivé par défaut (`FRANCE_TRAVAIL_RECRUITMENT_LIVE=false`); aucun appel ne part sans configuration explicite et identifiants serveur.
- Rattachement recrutement : SIREN/SIRET exact présent dans la réponse de l'offre. Une offre retrouvée uniquement par nom, commune ou mot-clé est rejetée pour éviter les homonymies.
- BOAMP : l'API DILA est ouverte sous Licence Ouverte 2.0 et expose avis, titulaires et objets. Les annonces territoriales ne publient pas systématiquement un SIREN/SIRET du titulaire dans un champ exploitable; aucune jointure par nom n'est effectuée. Le BOAMP est donc une source territoriale candidate, pas encore un enrichissement BI individuel exhaustif.

## NAF

- Source : [Nomenclature d'activités française – NAF rév. 2](https://www.insee.fr/fr/information/2120875), INSEE.
- Référence utilisée : édition publiée le 8 mars 2021, active pour les codes NAF du stock SIRENE de juillet 2026.
- Couverture locale : 732 libellés de sous-classe importés; un code sans correspondance reste affiché tel quel et n'est pas remplacé par un intitulé inventé.
- La NAF 2025, annoncée par l'INSEE pour l'entrée en vigueur de janvier 2027, n'est pas fusionnée avec la NAF rév. 2 courante.

## Présence OSM

- Extrait : `guadeloupe-latest.osm.pbf`, Geofabrik.
- Référence locale : 17 juillet 2026 à 22:24 UTC.
- Import : 18 juillet 2026.
- Couverture exacte : 874 objets, 564 SIREN et 756 SIRET.
- Attributs présents : 327 sites, 40 emails fonctionnels génériques, 659 téléphones professionnels, 327 horaires, 795 catégories, 135 tags sociaux et 80 informations d'accessibilité.
- Les emails sont filtrés sur une liste courte de boîtes fonctionnelles (`contact`, `info`, `accueil`, `support`, etc.) et ne comprennent pas les boîtes nominatives; leur publication OSM reste à confirmer par l'entreprise.
- Limite : source communautaire non exhaustive; chaque SIRET est comparé au stock SIRENE actif et les références anciennes sont signalées.

## Sites publics rattachés

- Entrée : 323 URL uniques, dont 321 issues de références OSM et 2 issues du RNA avec publication web explicitement autorisée, pour 310 entreprises.
- Résultat : 224 pages accessibles et autorisées, 152 descriptions courtes et 19 sites contenant des prestations explicites après filtrage du bruit éditorial.
- Restrictions observées : 7 refus `robots.txt`, 18 fichiers robots inaccessibles, 13 plateformes externes ignorées et 60 erreurs de récupération. Les deux URLs RNA ajoutées sont malformées dans le snapshot et restent non exploitables sans correction publiée par la source.
- Données conservées : titre, URL canonique, description courte de 25 mots maximum, prestations structurées, types Schema.org, statut robots, statut HTTP, date, hash et confiance.
- Données exclues : HTML brut, emails, pages secondaires, profils personnels et contenu marqué `noindex` ou `nosnippet`.
- Limite : un site rattaché reste une déclaration publiée par l'entreprise, une association ou son réseau; son contenu n'est pas une validation administrative.

## Répertoire national des associations

- Candidats SIRENE : 9 483 identifiants RNA, y compris le format ultramarin alphanumérique `W9G…`.
- Correspondances RNA exactes : 9 470; 13 identifiants absents du snapshot WALDEC.
- Contenu : 9 469 objets statutaires, 9 288 codes position `A` dont 3 contradictoires, 182 positions dissoutes, 18 reconnaissances d'utilité publique et 2 sites dont la publication web est explicitement autorisée.
- Contrôle SIRET : 523 concordances, 8 929 RNA sans SIRET, 18 divergences signalées.
- Qualité : 3 positions actives comportent une date de dissolution; 74 RNA extraits sont reliés à plusieurs SIREN et restent visibles avec diagnostic.
- Exclusions : déclarant, civilité du dirigeant, adresse de gestion, téléphone, email et observation libre.

## Conventions de subvention SCDL

- Catalogue interrogé : filtre `schema=scdl/subventions` de l'API data.gouv.fr, audité le 19 juillet 2026.
- Jeux recensés : 53, dont 33 sous licence ouverte explicite; 20 jeux sans licence spécifiée sont exclus.
- Ressources CSV ouvertes : 52; 37 importées, 15 rejetées pour lien cassé, page HTML ou schéma sans identifiant bénéficiaire exploitable.
- Lignes structurées lues : 53 377, dont 35 554 avec SIRET ou RNA valide.
- Couverture territoriale par unité légale : 401 occurrences, 396 conventions uniques et 23 SIREN.
- Montants publiés cumulés : 25 171 274,38 €, période trouvée du 3 février 2015 au 16 septembre 2024.
- Jointure : 394 SIRET exacts hors stock actif local et 2 concordances SIRET+RNA hors stock actif; aucune jointure par nom.
- Provenance : chaque convention conserve le jeu, la ressource, la ligne, la licence, la date source et toutes ses occurrences après déduplication.
- Limite : les publications SCDL sont partielles et soumises à des obligations légales; l'absence de ligne ne prouve pas l'absence d'aide.
- Sémantique : `montant` est le montant attribué publié, parfois total avant répartition multi-bénéficiaires; il ne constitue pas une preuve de versement.
- Source de référence : `https://schema.data.gouv.fr/scdl/subventions/`.

L'API Data.Subvention d'API Entreprise n'est pas utilisée dans les fiches publiques : ses conditions réservent les données aux agents habilités ou usagers authentifiés et interdisent leur communication hors des cas autorisés.

## Aides financières ADEME

- Source : `https://data.ademe.fr/datasets/les-aides-financieres-de-l'ademe`, mise à jour le 18 juillet 2026.
- Volume source : 39 160 dossiers; 38 866 SIRET syntaxiquement valides et 294 lignes invalides ou sans SIRET exploitable.
- Couverture des unités légales territoriales : 897 dossiers et 258 SIREN.
- Périmètre local : 264 dossiers sur un SIRET actif en Guadeloupe, pour 27 339 525,60 € engagés publiés.
- Périmètre national/historique : 633 dossiers visant un autre SIRET de la même unité légale.
- Période : conventions du 3 février 2021 au 10 juillet 2026; 150 dispositifs identifiés.
- Contenu conservé : bénéficiaire, SIRET, objet, dispositif, montant, nature, conditions, période, décision, notification UE, source, licence et fraîcheur.
- Exclusions : aucune jointure nominative, aucune coordonnée personnelle, aucune pièce de dossier.
- Sémantique : le montant décrit un engagement publié par l'ADEME et ne prouve pas le décaissement intégral.

## Projets Fonds vert

- Source : `https://www.data.gouv.fr/datasets/fonds-vert-liste-des-projets-subventionnes`, mise à jour le 22 juin 2026.
- Ressources importées : CSV 2023, 2024 et 2025; 25 240 lignes auditées et 25 027 identifiants SIREN/SIRET syntaxiquement exploitables.
- Couverture des unités légales territoriales : 221 projets uniques et 57 SIREN, par identifiant exact uniquement.
- Périmètre projet Guadeloupe : 120 projets pour 31 441 035,21 € engagés publiés.
- Périmètre hors Guadeloupe : 101 projets pour 14 482 689,13 €, conservés comme signaux nationaux des unités légales multi-sites.
- SIRET actifs locaux exacts : 75 projets pour 15 593 210,74 €; cette métrique de bénéficiaire reste distincte de la localisation du projet.
- Contenu : nom et résumé du projet, millésime, montant, mesure, opérateur, dossier, engagement juridique, bénéficiaire, forme juridique et codes territoriaux publiés.
- Exclusion : le CSV biodiversité P113 2024 ne porte aucun SIREN/SIRET bénéficiaire; aucune jointure nominative n'est tentée.
- Limite officielle : le code commune peut parfois désigner la commune du porteur plutôt que l'implantation réelle du projet.
- Sémantique : le montant est un engagement juridique ou comptable publié, pas une preuve de paiement.

## Projets industriels France Relance

- Source : `https://www.data.gouv.fr/datasets/plan-de-relance-projets-industriels-liste-geolocalisation-et-description-synthetique-des-projets`, mise à jour le 8 avril 2022.
- Volume source : 3 080 lignes, dont 3 024 identifiants SIREN/SIRET syntaxiquement exploitables et 56 lignes sans identifiant valide.
- Couverture des unités légales territoriales : 33 projets et 25 SIREN, par identifiant exact uniquement.
- Périmètre projet Guadeloupe : 12 projets; 21 projets hors Guadeloupe restent des signaux nationaux des unités légales multi-sites.
- Contenu : bénéficiaire, type d'entreprise, volet, mesure, filière, description du projet, date, région, département, commune, coordonnées et estimation CO2 lorsqu'elle est publiée.
- Descriptions : 21 projets reliés disposent d'un texte public; celui-ci reste attribué au projet et ne devient jamais une description commerciale de l'entreprise.
- Sémantique : le jeu identifie des projets lauréats mais ne publie aucun montant individuel; aucune somme n'est calculée ou inférée.
- Exclusions : aucune jointure nominative, aucun partenaire déduit du texte et aucune donnée personnelle.

## Organismes de formation et qualité

- Source : `https://www.data.gouv.fr/datasets/liste-publique-des-organismes-de-formation-l-6351-7-1-du-code-du-travail`, mise à jour quotidiennement; snapshot utilisé du 18 juillet 2026.
- Volume source : 164 453 profils, tous munis d'un SIREN/SIRET syntaxiquement exploitable dans le snapshot.
- Couverture territoriale par unité légale : 1 410 profils et 1 404 SIREN reliés exactement.
- Déclarations rattachées à la Guadeloupe : 1 235; 175 profils hors Guadeloupe restent des signaux nationaux d'unités légales multi-sites.
- SIRET actifs locaux exacts : 1 192 profils.
- Certification qualité active publiée : 491 profils, dont 486 actions de formation, 39 bilans de compétences, 60 VAE et 65 actions par apprentissage; les catégories peuvent se cumuler.
- Spécialités : 1 317 profils disposent d'au moins un code ou libellé NSF déclaré au dernier bilan pédagogique et financier.
- Activité : 1 410 profils disposent d'au moins un agrégat stagiaires/formateurs; ces nombres décrivent la période BPF publiée et non l'activité en temps réel.
- Exclusions : dénomination, rue, contacts et données relatives aux organismes étrangers représentés; aucune jointure par nom.
- Sémantique : la présence dans la liste indique une déclaration d'activité et une obligation BPF à jour selon le ministère; elle ne garantit pas l'ouverture actuelle d'une formation précise.

## Index de l'égalité professionnelle Egapro

- Producteur : ministère du Travail, Direction générale du travail.
- Jeu : `Index Egalité Professionnelle F/H des entreprises de 50 salariés ou plus`.
- URL : `https://www.data.gouv.fr/datasets/index-egalite-professionnelle-f-h-des-entreprises-de-50-salaries-ou-plus`.
- Ressource : classeur XLSX officiel `https://egapro.travail.gouv.fr/index-egalite-fh.xlsx`.
- Licence : Licence Ouverte 2.0.
- Snapshot : métadonnées mises à jour le 18 juillet 2026; 214 040 déclarations de référence 2018-2025.
- Jointure : SIREN déclarant exact, ou SIREN membre extrait de la liste UES explicitement publiée; aucune jointure par nom.
- Données conservées : année de référence, structure entreprise/UES, tranche d'effectifs, activité NAF, localisation du déclarant, score global et six indicateurs agrégés.
- Statuts : `calculated`, `not_calculable`, `not_applicable` et `invalid` restent distincts; une cellule vide n'est jamais transformée en score nul.
- Exclusions : raisons sociales source, salariés, rémunérations, contacts et toute donnée individuelle.
- Sémantique : l'index d'une UES est collectif. Le résultat ne suffit pas, isolément, à qualifier une situation personnelle, une discrimination ou la conformité globale de l'employeur.

## Traçabilité

Chaque donnée importée doit conserver:

- source;
- date de récupération;
- date de dernière mise à jour source;
- niveau de confiance;
- statut de vérification.

## Priorité

1. Données officielles administratives.
2. Données validées manuellement.
3. Données déclarées par l'entreprise.
4. Données structurées publiques.
5. Description automatique fondée sur NAF.

Une donnée automatique ne doit pas écraser une donnée vérifiée.

## Conventions collectives par SIRET et OPCO

- Source IDCC : ministère du Travail, jeu `Liste des conventions collectives par entreprise (SIRET)`, Licence Ouverte 2.0, mis à jour le 16 juillet 2026.
- Ressource IDCC : `transsismmo-weez-idcc-0526.csv`, référence mai 2026, 2 370 794 lignes nationales analysées.
- Source OPCO : France compétences, table SIRO `SIRET-OPCO`, Licence Ouverte 2.0, mise à jour le 11 mai 2026.
- Ressource SIRO : `SIRO_202604.csv`, référence avril 2026, 3 564 342 lignes nationales analysées.
- Catalogue : paquet officiel SocialGouv `@socialgouv/kali-data` 3.479.0, Apache-2.0; seuls les identifiants et métadonnées de conventions sont extraits.
- Jointure : SIRET exact d'un établissement actif territorial; aucune jointure par nom, adresse ou personne.
- Couverture : 16 520 entreprises avec au moins un signal; 12 109 établissements avec IDCC et 17 327 rattachements SIRO.
- Exclusions : 49 lignes IDCC et 74 lignes SIRO à diffusion restreinte; aucune donnée de salarié, nom, contact ou rémunération.
- Sémantique : ces déclarations DSN peuvent être décalées et ne remplacent pas l'analyse juridique de la convention effectivement applicable.

## Portefeuilles de brevets MESRE/PATSTAT

- Producteur : ministère de l'Enseignement supérieur et de la Recherche, données issues de PATSTAT et SIREN récupérés depuis l'INPI.
- Jeux : `Déposants des brevets`, `Demandes de brevets`, `Familles de brevets` et `Technologies des familles de brevets`.
- Licence : Licence Ouverte 2.0 pour les quatre jeux utilisés.
- Fraîcheur : déposants, demandes et technologies mis à jour le 11 mai 2026; familles détaillées mises à jour le 12 juin 2025.
- Volume source déposants : 949 226 lignes, dont 831 609 avec SIREN valide.
- Jointure : SIREN exact d'une unité légale active et publiable; aucune jointure par nom.
- Couverture : 70 unités légales territoriales, 19 588 rattachements entreprise-famille, 66 233 demandes et 136 833 classifications CIB.
- Contenu : titres, résumés, dates de demande/publication/octroi, portée OEB/internationale, déposant moral publié et technologies CIB.
- Exclusions : inventeurs, identifiants de personnes, déposants personnes physiques, contacts et adresses.
- Périmètre : le brevet appartient au portefeuille national de l'unité légale; aucune origine ou exploitation guadeloupéenne n'est déduite de la seule présence locale.
- Limite : PATSTAT et le rapprochement SIREN ne sont pas exhaustifs; l'absence de résultat n'est pas une preuve d'absence de brevet.

## Ratios financiers BCE/INPI

- Producteur : Direction générale des Entreprises; transformation BCE/DNUM à partir des comptes RNCS fournis par l'INPI.
- Jeu : `Ratios Financiers (BCE / INPI)` sur `data.economie.gouv.fr` et data.gouv.fr.
- URL : `https://www.data.gouv.fr/datasets/ratios-financiers-bce-inpi`.
- Licence : Licence Ouverte 2.0.
- Fraîcheur : source mise à jour et traitée le 1er juin 2026.
- Volume national : 6 542 232 lignes et 1 626 265 SIREN distincts au moment de l'audit.
- Jointure : SIREN exact parmi les unités légales actives et diffusables du stock territorial; aucune requête n'est émise pour un SIREN restreint.
- Couverture territoriale : 35 009 exercices et 9 281 entreprises, dont 21 563 bilans complets, 13 213 simplifiés et 233 consolidés.
- Confidentialité : 7 526 exercices sont partiellement confidentiels. Les montants non diffusés ne sont pas affichés comme des zéros.
- Période locale exploitable : du 31 décembre 2011 au 28 février 2026; aucune clôture future n'a été trouvée dans le sous-ensemble territorial.
- Périmètre : comptes nationaux de l'unité légale; aucune ventilation vers un établissement guadeloupéen n'est déduite.
- Limite : l'absence de ligne ne prouve ni absence de dépôt, ni absence d'activité, ni difficulté financière.

## Bilans financiers détaillés BCE/INPI

- Producteur et diffuseur : Signaux Faibles, service numérique de l'État, à partir des comptes annuels INPI.
- Jeu : `Données financières détaillées des entreprises (format parquet)` sur data.gouv.fr.
- URL : `https://www.data.gouv.fr/datasets/donnees-financieres-detaillees-des-entreprises-format-parquet`.
- Licence : Licence Ouverte 2.0.
- Ressource auditée : Parquet de 2 820 473 022 octets, mis à jour le 10 février 2026.
- Schéma source : SIREN, date de clôture, type C/K/S, confidentialité et map de cellules fiscales numériques.
- Jointure : SIREN exact parmi les unités légales actives et diffusables du stock territorial.
- Définitions : formulaires officiels DGFiP 2050–2051 pour C/K et 2033 pour S.
- Exclusions : actes et comptes PDF RNE, dirigeants, signatures, adresses de personnes et contacts. L'accès documentaire direct INPI requiert en outre une authentification dédiée.
- Confidentialité : pour une diffusion partielle, l'API masque l'ensemble du compte de résultat détaillé et ne restitue que les agrégats de bilan publiables.
- Périmètre : comptes nationaux de l'unité légale; aucune ventilation à l'établissement guadeloupéen n'est déduite.
- Couverture territoriale mesurée : 34 020 exercices, 9 087 entreprises, 21 069 bilans C, 12 701 bilans S et 250 bilans K.
- Qualité numérique : 3 943 cellules égales aux bornes `INT32_MIN` ou `INT32_MAX` sont des valeurs saturées et sont exclues avant dérivation.
