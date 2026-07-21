# Enrichissement Business Intelligence

## Principe

La plateforme distingue les faits administratifs, les déclarations officielles, les signaux transactionnels et les correspondances probabilistes. Chaque élément conserve sa source, sa date, son URL, sa confiance et sa fraîcheur. Une absence de résultat n'est jamais interprétée comme une absence d'activité.

## Sources Actives

| Source | Données | Jointure | Confiance |
| --- | --- | --- | --- |
| SIRENE `StockUniteLegale` | identité légale, forme, création, catégorie et année, effectif et année, activité, ESS, société à mission, RNA, périodes et fraîcheur | SIREN exact | 1,00 |
| SIRENE `StockEtablissement` | SIRET, activité, adresse publiable, statut, siège, création, effectif daté, caractère employeur, périodes et géocodage | SIREN/SIRET exact | 1,00 |
| Répertoire national des associations | titre, objet statutaire, codes d'objet, dates, position, groupement, RUP et site autorisé | RNA exact issu de SIRENE, SIRET recroisé si présent | 0,80 à 1,00 |
| Annuaire des Entreprises / API Recherche | comptes publiés, catégorie, effectif, nombre d'établissements, IDCC, labels, signaux d'aides et mandats publics minimisés | SIREN exact | 1,00 |
| Ratios financiers BCE/INPI | exercices comptables, montants publiés, structure financière et cycle d'exploitation | SIREN exact actif et diffusable | 1,00 |
| Liste publique des organismes de formation / ministère du Travail | NDA, catégories qualité actives, spécialités NSF et agrégats du bilan pédagogique et financier | SIREN/SIRET exact, recroisé avec le stock actif territorial | 0,98 à 1,00 |
| Index de l'égalité professionnelle Egapro / ministère du Travail | score annuel sur 100, indicateurs agrégés, statut calculable, tranche d'effectifs et contexte UES | SIREN déclarant exact ou SIREN membre d'UES explicitement publié | 0,99 à 1,00 |
| Conventions de subvention SCDL / data.gouv.fr | objet, montant attribué publié, attribuant, décision, période, nature et dispositif | SIRET exact ou RNA exact non ambigu | 0,95 à 1,00 |
| Aides financières ADEME | dossiers engagés depuis 2021, objet, dispositif, montant, nature, décision et période | SIRET exact, recroisé avec le stock actif territorial | 0,98 à 1,00 |
| Fonds vert / Ministère de la Transition écologique | projet, résumé, montant engagé, mesure, opérateur et localisation publiée | SIREN ou SIRET exact; localisation territoriale contrôlée séparément | 0,98 à 1,00 |
| France Relance / DGE | projets industriels lauréats, descriptions, filière, mesure, type d'entreprise, localisation et indicateur CO2 éventuel | SIREN ou SIRET exact; localisation du projet contrôlée séparément | 0,98 à 1,00 |
| ADEME RGE | qualifications, domaines, organismes, validité, historique et certificats | préfixe SIREN puis SIRET exact | 1,00 |
| BODACC | activité déclarée, événements, forme et capital publiés | SIREN exact dans `registre` | 1,00 |
| DECP | marchés publics, montants, acheteurs, CPV, durée | préfixe SIRET = SIREN exact | 1,00 |
| OpenStreetMap / Geofabrik | site, téléphone professionnel, email fonctionnel générique filtré, horaires, catégorie, services, accessibilité et réseaux | `ref:FR:SIREN`/`ref:FR:SIRET` exact | 0,80 sur les attributs |
| Sites publics rattachés | description courte, offres et prestations explicitement structurées, types Schema.org et liens sociaux déclarés | URL issue d'un objet OSM exact ou du RNA avec publication autorisée | 0,70 à 0,90 selon la structure |
| GDELT | articles récents indexés | dénomination exacte + Guadeloupe | 0,65 |
| Google News RSS | titres, éditeurs, dates et liens de presse | dénomination exacte + Guadeloupe | 0,58 |
| France Travail | offres actives, intitulé, contrat, lieu et dates | SIREN/SIRET exact publié dans l'offre; flux optionnel | 1,00 si identifiant présent |
| BOAMP | avis et résultats de marchés publics | annonce territoriale; pas de jointure individuelle sans identifiant | 1,00 sur le fait publié, non rattaché par nom |

Le endpoint `GET /api/companies/{siren}/intelligence` normalise ces sources. Les réponses sont mises en cache cinq minutes en mémoire, avec déduplication des requêtes concurrentes et limite de 128 profils; elles indiquent explicitement les fournisseurs vides ou indisponibles.

La recherche globale conserve la recherche libre et ajoute les scopes `siren:`, `siret:`, `naf:`, `commune:`, `secteur:`, `adresse:` et `presse:`. Une faute simple est traitée par un rapprochement local borné, avec priorité aux noms légaux et commerciaux. Un résultat `presse:` est un signal de veille rattaché au SIREN du cache; il ne remplace ni le code NAF ni une description vérifiée.

### Index BODACC local

Le script `scripts/import_bodacc_guadeloupe.py` indexe le département 971 depuis 2020 par défaut. Le lot du 19 juillet 2026 contient 144 756 annonces lues, 90 930 lignes rattachées à 36 354 SIREN et est servi par `data/bodacc-guadeloupe.sqlite`. L'API BODACC reste le repli pour un environnement sans snapshot. Le cache expose sa date de rafraîchissement et ne stocke ni les noms de personnes ni les blocs JSON juridiques bruts. Une annonce décrit une publication légale datée; elle ne valide pas une activité commerciale actuelle.

### Snapshot Annuaire local

L'import `scripts/import_public_officers_guadeloupe.py` demande `include=complements,dirigeants,finances` avec un SIREN exact ou via une page départementale bornée. Il projette les champs non personnels dans quatre tables SQLite : profil public, exercices, labels positifs et IDCC. Les blocs imbriqués de collectivités et d'élus, ainsi que tout payload brut, sont rejetés. Une fiche dont le SIREN figure dans `annuaire_profiles` est servie depuis ce snapshot ; les autres utilisent le repli API live. La date source et la date de récupération restent visibles dans l'onglet gouvernance/profil.

Le run territorial du 19 juillet 2026 a parcouru `971`, `400` pages et `10 000` résultats exposés par l'API; `9 276` lignes correspondaient au stock local et `10 599` SIREN sont maintenant indexés après déduplication. `department_runs` conserve la page suivante et le statut de reprise. Le plafond observé est affiché comme limite de couverture, jamais comme une preuve d'absence.

### Veille média persistée

`scripts/enrich_company_press.py` constitue un cache séparé et borné. Il peut être alimenté par une liste de SIREN ciblée ou une sélection priorisée bornée (`--priority --limit --offset`), puis planifié selon la capacité des fournisseurs. Les deux fournisseurs sont interrogés en parallèle pour une cible; GDELT passe en cooldown après `429` et Google News est conservé comme source indépendante. Les titres et liens média sont des signaux de veille à faible confiance; ils ne deviennent ni description d'activité ni preuve de notoriété. Le snapshot du 19 juillet 2026 contient 401 SIREN et 2 771 mentions; 3 `ok`, 238 `partial`, 5 `empty` et 155 `error`.

Le profil SIRENE est lu dans l'index local et ne dépend d'aucun fournisseur réseau au moment de l'affichage. Les valeurs `O`, `N` et nulles sont conservées distinctement. Le caractère employeur est présenté comme déclaratif, conformément à la documentation INSEE, et non comme une mesure d'emploi en temps réel.

L'adaptateur France Travail est désactivé par défaut. Lorsqu'il est activé côté serveur, il demande une offre par dénomination et département puis ne conserve dans la réponse BI que les offres dont l'objet `entreprise` expose un SIREN/SIRET correspondant. Les offres sans identifiant sont écartées, même si le nom semble identique. Le flux reste dépendant de l'accès développeur, de l'actualisation des offres et des règles de diffusion de France Travail.

Le BOAMP est documenté comme source d'opportunités territoriales. Ses avis peuvent contenir des titulaires textuels ou des identifiants d'organisations qui ne sont pas des SIREN/SIRET; ces textes ne sont jamais rapprochés automatiquement par nom. Les résultats BOAMP individuels ne seront indexés dans une fiche qu'après définition d'un champ d'identifiant exact et d'une projection minimisée.

Le RNA est également matérialisé hors ligne. L'objet est affiché comme déclaration statutaire et non comme description d'activité actuelle. Une jointure RNA+SIRET concordante vaut 1,00; l'absence de SIRET dans le RNA vaut 0,95; une divergence vaut 0,80 et déclenche un avertissement. Une position active assortie d'une date de dissolution est classée contradictoire.

Les conventions SCDL sont matérialisées hors ligne depuis les seuls jeux portant une licence ouverte explicite. Un SIRET exact absent du stock actif reste un fait rattaché à l'unité légale, mais l'interface précise qu'il peut concerner une implantation historique ou hors Guadeloupe. Le champ `montant` est affiché comme montant attribué publié; il ne prouve ni le paiement ni la part effectivement reçue lorsque plusieurs bénéficiaires figurent dans une convention.

Les aides ADEME sont conservées dans un index séparé. Une ligne visant un SIRET actif dans les 32 communes configurées reçoit le périmètre `active_local_establishment` et une confiance 1,00. Un autre SIRET du même SIREN reçoit le périmètre national/historique et une confiance 0,98. Les agrégats monétaires locaux et nationaux ne sont jamais fusionnés dans l'interface.

Les projets Fonds vert sont matérialisés depuis les trois CSV ministériels 2023-2025. La jointure bénéficiaire et la localisation du projet sont deux dimensions distinctes : un SIRET local ne suffit pas à rendre local un projet, et un SIREN national peut porter un projet codé en Guadeloupe. Le cumul territorial utilise uniquement `project_location_scope=guadeloupe`. Les montants sont des engagements publiés et non des preuves de paiement. Le fichier biodiversité P113 sans identifiant bénéficiaire est exclu plutôt que rapproché par nom.

Les projets industriels France Relance sont matérialisés depuis l'export DGE mis à jour le 8 avril 2022. La source ne publie aucun montant individuel. Les descriptions sont affichées uniquement comme descriptions du projet lauréat : elles peuvent citer plusieurs partenaires et ne remplacent jamais la description de l'entreprise. La localisation publiée du projet reste distincte de la présence de l'unité légale en Guadeloupe.

La Liste publique des organismes de formation est matérialisée quotidiennement. Les catégories qualité affichées sont uniquement celles dont le certificat est en cours de validité dans la source. Les spécialités NSF, stagiaires et formateurs sont des déclarations du dernier bilan pédagogique et financier; elles ne sont ni une offre de cours actuelle ni une mesure de l'effectif salarié. Les dénominations, rues, contacts et organismes étrangers représentés ne sont pas importés.

L'Index Egapro est matérialisé hors ligne par année de référence. Les indicateurs absents car non applicables sont distingués des valeurs `NC`; un score d'UES reste présenté comme collectif. Les seuils légaux servent uniquement de repères de lecture et l'interface ne déduit ni conformité globale, ni discrimination, ni situation individuelle. Aucun salarié, montant de rémunération, contact ou nom légal fourni par le classeur n'est stocké.

## Données Non Collectées

- noms et prénoms des entrepreneurs individuels ;
- coordonnées personnelles ;
- données personnelles de dirigeants au-delà de l'identité publique minimisée et de la qualité du mandat ;
- profils LinkedIn ou autres plateformes par scraping ;
- contenu intégral des articles de presse ;
- données de courtiers sans licence et conditions contractuelles explicites.

Les statuts de diffusion SIRENE sont évalués avant tout enrichissement historique. Une position ou identité masquée dans le stock courant ne peut pas être restaurée depuis un export plus ancien.

L'API Recherche peut retourner des dirigeants et d'autres attributs personnels. La plateforme conserve uniquement l'identité publique affichée et la qualité du mandat pour la recherche et la gouvernance; les dates de naissance, nationalité, adresse et contacts sont écartés au parsing. Le lot `data/public-officers.sqlite` est indexé par SIREN exact, avec couverture et fraîcheur exposées. Un drapeau de label ou d'aide à `false` signifie seulement « non identifié dans la source », jamais « absent » ou « non certifié ».

Les références OSM sont contrôlées contre les SIRET du stock SIRENE actif. Une référence absente du stock actif reste affichée comme signal historique potentiel avec une confiance abaissée à 0,55. Les emails ne sont exposés que lorsqu'ils utilisent un préfixe de boîte fonctionnelle générique; les boîtes nominatives sont exclues. La correspondance d'identifiant reste exacte, mais les attributs communautaires doivent être confirmés avant un usage sensible. L'instance Overpass publique n'est pas utilisée comme backend de production.

Les sites sont analysés hors ligne, jamais pendant une requête utilisateur. Le collecteur accepte les URLs OSM exactes et les URLs RNA dont la publication est explicitement autorisée; il suit au plus cinq redirections, refuse les adresses réseau non publiques, contrôle `robots.txt` à chaque origine et ne visite qu'une page. Une erreur réseau sur `robots.txt` bloque la collecte. Les descriptions proviennent en priorité de JSON-LD, puis de la meta description ou d'Open Graph. Les prestations sont limitées aux offres Schema.org ou aux rubriques explicitement nommées services, prestations ou expertises. Aucun texte commercial n'est généré à partir de ces pages.

## Prochaines Sources

- comptes annuels détaillés et dépôts associés au-delà des agrégats déjà publiés par l'Annuaire ;
- détail des autres aides publiques au-delà de SCDL, ADEME, Fonds vert et France Relance lorsqu'un identifiant exact publiable existe ;
- référentiels détaillés de certifications au-delà des drapeaux publics disponibles ;
- validation humaine ou revendication des descriptions de sites déjà indexées ;
- données RNE/INPI uniquement via un accès autorisé et documenté.

Les enrichissements futurs doivent utiliser les tables de `db/migrations/002_business_intelligence.sql` et ne jamais écraser une donnée vérifiée par une information moins fiable.

## Conventions collectives et OPCO

Le fournisseur `Conventions & OPCO` rapproche deux jeux officiels par SIRET exact. Il expose les conventions déclarées, les codes d'état, les titres KALI, l'OPCO propriétaire et l'OPCO gestionnaire territorial. Les mois de référence restent séparés.

- SIRET exact publiable : correspondance administrative certaine.
- Titre KALI : enrichissement documentaire du code IDCC, sans copie du texte intégral.
- Écart IDCC/SIRO : diagnostic temporel, jamais correction ou sélection automatique.
- Absence de ligne : absence dans le snapshot, jamais preuve d'absence de convention ou d'OPCO.

## Brevets et innovation

Le fournisseur `Brevets` expose le portefeuille national de l'unité légale à partir d'un SIREN exact. La famille DOCDB est l'unité de comptage principale; les demandes par office sont agrégées séparément pour éviter de compter plusieurs fois la même invention.

- titre et résumé : texte public du jeu des familles, sans génération ni reformulation commerciale ;
- octroi : vrai uniquement lorsqu'il est explicitement publié au niveau famille ;
- international/OEB : attributs de la famille, pas labels de qualité ;
- technologie : classifications CIB publiques, avec traduction uniquement des neuf sections standard ;
- territorialité : `national_legal_unit`, jamais `local_establishment` sans preuve supplémentaire ;
- affichage : 20 familles récentes, indicateurs calculés sur le portefeuille complet.

## Ratios financiers BCE/INPI

Le fournisseur `Ratios financiers` lit un index hors ligne construit depuis le jeu DGE/BCE issu des comptes RNCS transmis par l'INPI. Il expose les exercices de l'unité légale nationale et jamais ceux d'un établissement local isolé.

- jointure : SIREN exact, actif et diffusable au moment de l'import ;
- types : `C` complet, `S` simplifié et `K` consolidé restent trois séries distinctes ;
- confidentialité : pour une diffusion partielle, chiffre d'affaires, marge brute, EBE et EBIT sont masqués dans l'API même si la source technique publie zéro ;
- dates : une clôture postérieure à la date de mise à jour source est conservée pour audit avec `future_closing_date`, mais exclue de la série affichée par défaut ;
- formules : définitions officielles BCE conservées par indicateur et par type de bilan ;
- interprétation : aucun seuil, score de crédit, score de solvabilité ou conseil n'est ajouté.

## Bilans détaillés BCE/INPI

Le fournisseur `Bilans détaillés` complète les ratios avec 24 agrégats issus des cellules fiscales numériques du jeu ouvert Signaux Faibles. La restitution reste synchronisée par SIREN, date de clôture et type C/S/K exacts.

- le navigateur ne reçoit jamais `liasse_json`, un code fiscal brut, un PDF ou une donnée de personne ;
- le bilan présente total, actifs, capitaux propres et dettes avec des barres proportionnelles descriptives, sans seuil qualitatif ;
- le compte de résultat détaillé est intégralement masqué lorsque la source indique une diffusion partielle ;
- une liasse sans ratio correspondant reste consultable comme exercice autonome, avec indicateurs de ratio non renseignés ;
- les cellules saturées aux bornes INT32 sont exclues avant tout calcul ;
- l'absence de détail pour un exercice est affichée et aucun autre exercice n'est substitué.
