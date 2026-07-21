# Rapport de Qualité des Données

Référence du rapport : 19 juillet 2026.

## Couverture Administrative

| Indicateur | Valeur | Lecture |
| --- | ---: | --- |
| Entreprises juridiques actives | 120 710 | SIREN territoriaux rapprochés avec `StockUniteLegale` |
| Établissements actifs | 129 163 | SIRET sur les 32 communes configurées |
| Positions publiables | 115 920 | points exacts ou enrichis autorisés |
| Sans position publiée | 13 243 | recherchables, jamais placés au centroïde par défaut |
| Diffusion restreinte | 11 409 | aucun enrichissement historique réinjecté |
| Rapprochement unités légales | 120 710 / 120 710 | aucun SIREN territorial manquant |

## Couverture du profil officiel

| Indicateur | Valeur | Lecture |
| --- | ---: | --- |
| Sièges identifiés | 118 050 | champ `etablissementSiege` du stock actif |
| Établissements employeurs déclarés | 20 933 | valeur `O`; ce n'est pas un effectif temps réel |
| Effectifs établissement datés | 12 895 | année publiée 2023 |
| Unités légales ESS | 12 631 | appartenance publiée au champ ESS |
| Sociétés à mission | 41 | valeur positive publiée dans SIRENE |
| Identifiants RNA | 9 483 | associations rapprochables par identifiant public |
| Dates de traitement unité légale | 120 710 | fraîcheur du dossier, distincte de la date de source |
| Dates de traitement établissement | 129 163 | fraîcheur du dossier, distincte de la date de source |

Les valeurs nulles sont conservées et affichées comme non renseignées. Elles ne sont jamais converties en `non`. Les 640 établissements sans caractère employeur publié restent donc distincts des 107 590 valeurs `N`.

## Couverture RNA

| Indicateur | Valeur | Lecture |
| --- | ---: | --- |
| Identifiants RNA candidats | 9 483 | valeurs SIRENE valides, formats nationaux et ultramarins |
| Profils RNA trouvés | 9 470 | jointure exacte, 13 absents du snapshot |
| Objets statutaires | 9 469 | déclaration en préfecture, jusqu'à 5 000 caractères conservés |
| Positions actives sans contradiction | 9 285 | codes `A` sans date de dissolution |
| Positions dissoutes | 182 | code position `D` |
| Reconnaissances d'utilité publique | 18 | numéro RUP publié |
| RNA/SIRET concordants | 523 | confiance 1,00 |
| RNA sans SIRET | 8 929 | confiance 0,95 |
| RNA/SIRET divergents | 18 | confiance 0,80 et avertissement |
| RNA partagés entre plusieurs SIREN | 74 | profils conservés par clé composite SIREN+RNA |
| Statuts contradictoires | 3 | position active avec date de dissolution |

Le RNA ne doit pas être utilisé seul pour conclure à l'activité économique. L'objet décrit la finalité déclarée; le statut SIRENE, la position RNA et les dates sont présentés séparément.

## Couverture OSM

| Indicateur | Valeur | Lecture |
| --- | ---: | --- |
| Objets OSM reliés | 874 | références SIREN/SIRET exactes dans l'extrait Geofabrik |
| SIREN concernés | 564 | couverture communautaire partielle |
| SIRET concernés | 756 | contrôle contre le stock actif SIRENE |
| Sites publiés | 327 | URLs OSM conservées comme attributs contributifs |
| Emails fonctionnels génériques | 40 | boîtes `contact`, `info`, `accueil`, etc.; aucune boîte nominative |
| Téléphones professionnels | 659 | valeur publiée par OSM, à confirmer avant usage sensible |

Les emails génériques sont filtrés avant stockage. Une absence ne signifie pas qu'aucun contact professionnel n'existe; une présence OSM ne vaut pas validation par l'entreprise.

## Couverture des conventions de subvention

| Indicateur | Valeur | Lecture |
| --- | ---: | --- |
| Jeux SCDL recensés | 53 | catalogue data.gouv.fr au 19 juillet 2026 |
| Jeux sous licence ouverte explicite | 33 | 20 jeux sans licence spécifiée exclus |
| Ressources CSV ouvertes | 52 | 37 importées et 15 rejetées avec diagnostic |
| Lignes structurées lues | 53 377 | après validation du schéma de chaque ressource |
| Lignes avec identifiant bénéficiaire | 35 554 | SIRET ou RNA syntaxiquement valide |
| Occurrences reliées | 401 | jointure exacte uniquement |
| Conventions uniques | 396 | 5 occurrences dupliquées conservées en provenance |
| Entreprises couvertes | 23 | SIREN présents dans le stock territorial |
| Cumul des montants publiés | 25 171 274,38 € | attribution publiée, pas preuve de versement |
| SIRET hors stock actif local | 396 | signal entreprise national, pas attribution locale démontrée |

Le cumul ne doit pas être interprété comme une somme effectivement reçue : le schéma prévoit que le montant total d'une convention multi-bénéficiaire peut être répété pour chaque bénéficiaire, et certains producteurs encodent le pourcentage de manière hétérogène. L'interface affiche donc les montants bruts sourcés sans recalcul spéculatif.

## Couverture des aides financières ADEME

| Indicateur | Valeur | Lecture |
| --- | ---: | --- |
| Dossiers dans la source | 39 160 | aides non confidentielles engagées depuis 2021 |
| SIRET syntaxiquement valides | 38 866 | 294 lignes invalides ou sans identifiant exploitable |
| Dossiers reliés | 897 | SIRET exact uniquement |
| Entreprises couvertes | 258 | SIREN présents dans le stock territorial |
| Dossiers sur SIRET actif local | 264 | établissement actuellement actif dans une commune configurée |
| Montant engagé sur SIRET actif local | 27 339 525,60 € | engagement publié, pas preuve de décaissement |
| Dossiers sur autre SIRET | 633 | signal national ou historique de l'unité légale |
| Dispositifs identifiés | 150 | libellés ADEME conservés sans reclassement automatique |

Les agrégats locaux utilisent uniquement les SIRET présents dans le stock territorial actif. Les 633 autres dossiers restent consultables au niveau de l'unité légale mais ne sont pas comptés comme financements guadeloupéens.

## Couverture des projets Fonds vert

| Indicateur | Valeur | Lecture |
| --- | ---: | --- |
| Lignes dans les CSV 2023-2025 | 25 240 | trois ressources ministérielles sous Licence Ouverte 2.0 |
| Identifiants syntaxiquement exploitables | 25 027 | SIREN, SIRET et valeurs tableur normalisées |
| Projets reliés | 221 | SIREN/SIRET exact uniquement |
| Entreprises couvertes | 57 | unités légales également présentes dans le stock territorial |
| Projets codés en Guadeloupe | 120 | code département 971 ou code commune commençant par 971 |
| Montant engagé sur projets guadeloupéens | 31 441 035,21 € | engagement publié, pas preuve de paiement |
| Projets codés hors Guadeloupe | 101 | signal national de l'unité légale, exclu du cumul territorial |
| Montant engagé hors Guadeloupe | 14 482 689,13 € | conservé séparément |
| Projets sur SIRET actif local | 75 | métrique bénéficiaire distincte de la localisation du projet |
| Mesures identifiées | 23 | libellés sources conservés sans reclassement automatique |

La localisation publiée et le rattachement juridique sont évalués indépendamment. La source ministérielle avertit que certains codes commune peuvent correspondre au porteur plutôt qu'au lieu réel; l'interface affiche donc cette réserve. Le CSV biodiversité P113 sans identifiant bénéficiaire est exclu plutôt que rapproché par dénomination.

## Couverture des projets industriels France Relance

| Indicateur | Valeur | Lecture |
| --- | ---: | --- |
| Lignes dans la source | 3 080 | export DGE sous Licence Ouverte 2.0 |
| Identifiants syntaxiquement exploitables | 3 024 | SIREN et SIRET normalisés; 56 lignes exclues |
| Projets reliés | 33 | SIREN/SIRET exact uniquement |
| Entreprises couvertes | 25 | unités légales présentes dans le stock territorial |
| Projets localisés en Guadeloupe | 12 | département 971 ou code postal 971 |
| Projets localisés hors Guadeloupe | 21 | signal national de l'unité légale multi-site |
| Descriptions publiques | 21 | texte attribué au projet, jamais à l'entreprise entière |
| Indicateurs CO2 publiés | 4 | valeur source affichée projet par projet, sans agrégation spéculative |
| Mesures distinctes | 7 | libellés DGE conservés |
| Filières distinctes | 12 | libellés DGE conservés |
| Montants individuels | 0 | non publiés dans ce jeu; aucune estimation |

Le jeu a été mis à jour le 8 avril 2022 et décrit des projets lauréats dont les dates de mise à jour vont du 2 mars 2021 au 21 mars 2022. Cette ancienneté est visible dans la fiche. Les descriptions collaboratives peuvent citer plusieurs partenaires; elles restent donc dans l'onglet projet et ne servent pas à enrichir automatiquement les prestations.

## Couverture des organismes de formation

| Indicateur | Valeur | Lecture |
| --- | ---: | --- |
| Profils dans la source | 164 453 | snapshot quotidien du 18 juillet 2026 |
| Identifiants syntaxiquement exploitables | 164 453 | SIREN/SIRET valides dans toutes les lignes |
| Profils reliés | 1 410 | SIREN/SIRET exact uniquement |
| Entreprises couvertes | 1 404 | unités légales présentes dans le stock territorial |
| Déclarations rattachées à la Guadeloupe | 1 235 | code postal 971 ou code région 01 |
| Déclarations hors Guadeloupe | 175 | signal national de l'unité légale multi-site |
| SIRET actifs locaux exacts | 1 192 | établissement présent dans le stock territorial actif |
| Certifications qualité actives publiées | 491 | au moins une catégorie explicitement vraie |
| Actions de formation | 486 | catégories cumulables |
| Bilans de compétences | 39 | catégories cumulables |
| VAE | 60 | catégories cumulables |
| Apprentissage | 65 | catégories cumulables |
| Profils avec spécialités NSF | 1 317 | données du dernier BPF publié |
| Profils avec volumes d'activité | 1 410 | stagiaires ou formateurs déclarés sur une période |

La source est riche mais déclarative. Les spécialités et volumes ne sont jamais présentés comme une offre actuelle ni comme un effectif salarié. Les dénominations, rues, contacts et organismes étrangers représentés sont volontairement exclus de l'index local. Treize lignes reliées à une unité légale avaient un NDA inexploitable et ont été ignorées.

## Couverture de l'Index de l'égalité professionnelle

| Indicateur | Valeur | Lecture |
| --- | ---: | --- |
| Déclarations dans la source | 214 040 | années de référence 2018 à 2025 |
| SIREN déclarants syntaxiquement valides | 214 040 | aucune ligne invalide dans le snapshot |
| Lignes source reliées | 2 492 | au moins un SIREN territorial exact |
| Rattachements annuels | 2 653 | une ligne source UES peut couvrir plusieurs entreprises |
| Entreprises couvertes | 460 | unités légales présentes dans le stock territorial |
| Rattachements au SIREN déclarant | 2 307 | confiance 1,00 |
| Rattachements comme membre d'UES | 346 | confiance 0,99, score collectif |
| Index calculables | 2 210 | score publié entre 12 et 100 |
| Index non calculables | 443 | statut `NC` conservé, jamais converti en zéro |
| Déclarations localisées en Guadeloupe | 547 | localisation du déclarant, distincte des implantations de l'unité légale |

La couverture est limitée aux structures ayant publié une déclaration Egapro et aux entreprises d'au moins 50 salariés ou membres d'une UES assujettie. L'absence de ligne ne signifie donc pas un défaut de déclaration. Les six indicateurs sont agrégés; aucune donnée de salarié ou montant de rémunération n'est présent dans l'index local.

## Couverture OSM

L'extrait Geofabrik du 17 juillet 2026 contient 874 objets portant une référence administrative exploitable, reliés à 564 entreprises et 756 établissements.

| Attribut | Enregistrements |
| --- | ---: |
| Catégorie d'activité OSM | 795 |
| Téléphone professionnel | 659 |
| Site web | 327 |
| Horaires | 327 |
| Présence sociale taguée | 135 |
| Accessibilité | 80 |

Cette couverture est partielle : l'absence d'un objet OSM n'indique pas l'absence d'une présence physique ou numérique. Les SIRET OSM absents du stock actif sont marqués `not_in_active_stock` et leur confiance attributaire passe de 0,80 à 0,55.

## Qualité par Source BI

| Source | Correspondance | Risque principal | Traitement |
| --- | --- | --- | --- |
| SIRENE | SIREN/SIRET exact | décalage mensuel du stock | date de référence affichée |
| RNA | RNA exact, SIRET optionnel | doublons, SIRET absent ou statut contradictoire | clé composite, confiance et anomalies visibles |
| Annuaire | SIREN exact | agrégats absents selon entreprise | absence formulée sans conclusion |
| SCDL subventions | SIRET exact ou RNA exact non ambigu | couverture légale partielle, SIRET historique, montant multi-bénéficiaire | périmètre, confiance, source et absence non concluante visibles |
| ADEME aides | SIRET exact | groupes multi-établissements et engagement distinct du paiement | agrégats local/national séparés et périmètre visible |
| Fonds vert | SIREN/SIRET exact | code projet parfois rattaché au porteur, engagement distinct du paiement | localisation projet et périmètre bénéficiaire séparés |
| France Relance | SIREN/SIRET exact | source ancienne, descriptions collaboratives et absence de montant individuel | fraîcheur visible, texte limité au projet, aucune somme inférée |
| Organismes de formation | SIREN/SIRET exact | BPF historique, catégories qualité temporaires et multi-NDA | période visible, catégories explicitement vraies, NDA dédupliqués |
| Index Egapro | SIREN déclarant ou membre UES exact | score collectif, `NC`, millésime de référence | contexte UES, statut de calcul et historique visibles; aucune conclusion individuelle |
| ADEME RGE | SIRET exact | nombreuses lignes historiques | déduplication, statut actif/historique |
| BODACC | SIREN exact | événements hétérogènes | normalisation sans dirigeants |
| DECP | préfixe SIRET exact | qualité variable des champs acheteurs | montants et dates conservés tels que publiés |
| OSM | référence exacte, attributs communautaires | information ancienne ou incomplète | recroisement SIRENE actif et lien objet source |
| Sites publics | URL reliée par identifiant exact | contenu déclaratif, robots ou page indisponible | index hors ligne, attribution, confiance et diagnostic visible |
| Presse | nom exact + Guadeloupe | homonymie et index non exhaustif | confiance 0,58 à 0,65 et lien vers l'article |

## Couverture des sites publics

| Indicateur | Valeur |
| --- | ---: |
| Références uniques candidates | 323 |
| Entreprises concernées | 310 |
| Pages accessibles et autorisées | 224 |
| Descriptions courtes exploitables | 152 |
| Sites avec prestations explicites | 19 |
| Refus ou robots inaccessibles | 25 |
| Plateformes externes ignorées | 13 |
| Erreurs de récupération | 60 |

La couverture web est un enrichissement ciblé, pas un recensement. Les 321 références OSM et 2 URLs RNA autorisées sont conservées avec leur origine. Les descriptions sont limitées à 25 mots et leur origine est affichée. Une prestation n'est publiée que si elle figure dans une donnée Schema.org ou une rubrique de service explicite; les titres d'articles et contenus éditoriaux sont exclus. Les deux URLs RNA malformées restent en erreur plutôt que d'être corrigées par heuristique.

## Données Volontairement Exclues

- dirigeants, bénéficiaires effectifs et identités personnelles non nécessaires ;
- emails personnels ou nominatifs; les 40 boîtes OSM génériques filtrées restent autorisées comme signaux professionnels contributifs ;
- contenu intégral des articles ;
- profils de réseaux professionnels obtenus par scraping ;
- descriptions commerciales déduites sans source ;
- coordonnées restaurées depuis une source ancienne après restriction de diffusion.

## Prochaines Mesures

- taux de SIRET OSM actifs, anciens et non résolus à chaque import ;
- fraîcheur médiane par fournisseur ;
- couverture réelle des comptes financiers par catégorie d'entreprise ;
- taux de qualifications RGE actives contre historiques ;
- précision manuelle d'un échantillon de mentions presse ;
- disponibilité et latence p95 des fournisseurs externes.
- taux de validation humaine des descriptions et prestations extraites des sites.
- fraîcheur, taux de ressources SCDL valides et proportion de conventions reliées à un SIRET actif local.
- proportion et montant des aides ADEME sur SIRET actif local contre autres établissements de l'unité légale.
- proportion et montant des projets Fonds vert codés en Guadeloupe contre projets nationaux des mêmes unités légales.
- proportion des projets France Relance locaux/nationaux, avec description et avec indicateur CO2 à chaque rafraîchissement.
- couverture des organismes de formation par catégorie qualité, spécialité NSF, période BPF et périmètre local/national.
- couverture Egapro par année, tranche d'effectifs, rattachement direct/UES et proportion d'index calculables.
- couverture IDCC/OPCO par millésime, codes d'état, anomalies SIRO et écarts entre sources.

## Conventions collectives et OPCO, juillet 2026

- IDCC : 13 135 lignes locales, 11 232 entreprises, 12 109 établissements et 271 codes distincts.
- 8 981 IDCC substantifs, 4 154 codes d'état et 910 établissements multi-IDCC.
- Catalogue KALI : 390 conventions; 7 549 lignes locales disposent d'un titre officiel.
- SIRO : 17 327 rattachements, 16 080 entreprises, 16 437 OPCO attribués, 890 anomalies et 11 OPCO opérationnels distincts.
- Couverture unifiée : 16 520 entreprises; 5 695 établissements uniquement dans SIRO et 477 uniquement dans le jeu IDCC.
- Cohérence : 765 SIRET communs portent un IDCC différent entre avril et mai 2026; l'écart est signalé sans correction.
- Confidentialité : 49 lignes IDCC et 74 lignes SIRO restreintes exclues; aucune donnée de personne ou de salarié.
- Limite : couverture déclarative non exhaustive et potentiellement retardée; aucun droit applicable n'est dérivé.

## Portefeuilles de brevets, juillet 2026

- Export déposants : 949 226 lignes, 831 609 SIREN valides et 117 617 lignes sans SIREN exploitable.
- Correspondances exactes : 67 263 lignes sources, 66 233 couples unité légale-demande après déduplication et 70 entreprises couvertes.
- Familles : 17 258 familles DOCDB sources uniques et 19 588 rattachements entreprise-famille, car une famille peut avoir plusieurs déposants territoriaux.
- Statuts : 11 223 familles octroyées et 15 178 familles comportant une demande internationale.
- Complétude : 19 588 titres, 19 574 résumés, aucune demande ou famille compagnon non résolue.
- Technologies : 136 833 classifications CIB et 9 sections technologiques.
- Période des premières demandes : du 11 septembre 2007 au 14 octobre 2024.
- Territorialité : les portefeuilles sont nationaux; aucune famille n'est attribuée à l'établissement local sans donnée de localisation propre au brevet.
- Confidentialité : 3 lignes reliées à des unités à diffusion restreinte exclues; aucun inventeur, déposant personne physique ou contact conservé.
- Performance : 20 familles récentes maximum par réponse, avec agrégats exhaustifs; un portefeuille de 9 337 familles reste borné côté client.

## Ratios financiers BCE/INPI, juillet 2026

- Source nationale : 6 542 232 lignes, mise à jour le 1er juin 2026, Licence Ouverte 2.0.
- Périmètre interrogé : 109 825 SIREN actifs et diffusables; aucun des 10 883 SIREN restreints actifs n'est envoyé à l'API BCE.
- Couverture : 35 009 exercices, 9 281 entreprises, soit 8,45 % des unités légales interrogées disposant d'au moins un exercice dans ce jeu.
- Types : 21 563 bilans complets, 13 213 simplifiés et 233 consolidés, toujours séparés.
- Confidentialité : 7 526 exercices partiellement confidentiels; les quatre montants non diffusés sont masqués à l'affichage.
- Doublons : 213 lignes sources répétées à clé SIREN/date/type, toutes identiques; aucun conflit de métrique.
- Dates locales : 31 décembre 2011 au 28 février 2026; aucune clôture future dans ce sous-ensemble.
- Complétude : les cinq montants sont présents sur 35 009 lignes; les ratios vont de 25 265 valeurs pour le BFR à 34 998 pour l'autonomie financière.
- Reproductibilité : premier import 783 appels en 71,4 s; seconde exécution 733 caches, zéro appel réseau et mêmes agrégats en 6,4 s.
- Interprétation : aucune absence, valeur ou variation n'est convertie en score de solvabilité ou diagnostic financier.

## Bilans financiers détaillés BCE/INPI, juillet 2026

- Source nationale : Parquet de 2 820 473 022 octets, 6 368 964 lignes, mis à jour le 10 février 2026, Licence Ouverte 2.0.
- Périmètre : 109 825 SIREN actifs et diffusables; aucun document, dirigeant, contact ou SIREN restreint importé.
- Couverture : 34 020 exercices pour 9 087 entreprises, soit 8,27 % des unités légales ciblées.
- Types : 21 069 bilans complets, 12 701 simplifiés et 250 consolidés, sans fusion inter-type.
- Confidentialité : 7 176 exercices partiellement confidentiels; le compte de résultat détaillé devient `null` dans l'API publique.
- Période : du 31 décembre 2011 au 31 décembre 2025; aucune clôture future dans le sous-ensemble.
- Cellules : 2 377 454 cellules numériques valides après exclusion de 3 943 valeurs saturées aux bornes INT32.
- Complétude : total du bilan sur 33 814 exercices, capitaux propres sur 33 871, total des dettes sur 33 524, chiffre d'affaires sur 24 691 et résultat net sur 32 457.
- Intégrité : zéro ligne invalide, zéro doublon et zéro conflit SIREN/date/type.
- Reproductibilité : extraction initiale locale en 61,8 s après téléchargement segmenté; deuxième import servi depuis le Parquet territorial, mêmes 34 020 exercices et zéro appel réseau.
- API réelle TRANSBETON `352808042` : 9 exercices; bilan 2024 de 6 237 507 €, capitaux propres 2 489 037 €, chiffre d'affaires 16 710 965 € et résultat net 415 919 €.
- API réelle PHYTOBOKAZ `483700282` : bilan 2024 de 4 233 955 € et capitaux propres 2 032 164 €; compte de résultat masqué car diffusion partielle.
- Contrôle grand groupe ORANGE `380129866` : les bornes saturées ne sont plus exposées comme montants; les métriques concernées restent non renseignées.
- Contrat public : aucune occurrence de `liasse_json` ni code de cellule brut dans les réponses testées.

## Mandats publics RNE, juillet 2026

- Source : API officielle Recherche d'entreprises / Annuaire des Entreprises, interrogée par SIREN exact avec `include=dirigeants`.
- Index local : 10 599 SIREN en statut `ok` sur 120 710 SIREN du stock, soit 8,7805 %; 14 534 mandats publics dédupliqués. Les agrégats associés comptent 10 599 profils, 2 018 exercices financiers, 2 125 labels/signaux et 3 625 codes IDCC.
- Qualité de jointure : aucun rattachement par nom; chaque mandat est lié à l'unité légale par son SIREN exact et les personnes morales conservent leur SIREN lorsqu'il est publié.
- Minimisation contrôlée : aucune colonne de date de naissance, année de naissance, nationalité, adresse, email, téléphone ou bénéficiaire effectif dans la base SQLite ou la réponse BI.
- Recherche : FTS5 accent-insensible, recherche par identité et qualité, fallback fuzzy SQL borné pour les fautes simples et fallback vers l'API officielle pour les requêtes explicites; le moteur priorise les noms légaux/commerciaux, limite les payloads à 24 résultats et peut rester local lorsque le réseau est indisponible.
- Collecte territoriale : 10 000 résultats exposés par l'API sur 400 pages, 9 276 lignes correspondant au stock local, 9 242 SIREN traités pendant le run bulk; 34 lignes déjà présentes ont été ignorées par reprise idempotente.
- Limite de couverture : le plafond API observé représente 8,28 % des 120 710 résultats locaux avant déduplication et ne constitue pas une couverture territoriale complète; les 110 111 SIREN non indexés restent indéterminés.

## Agrégats Annuaire et veille média

- Snapshot local Annuaire : 10 599 profils sur 120 710 SIREN territoriaux, soit 8,7805 %; la couverture du profil suit celle du lot RNE exact et du lot départemental plafonné.
- Agrégats retenus : 2 018 exercices financiers, 2 125 labels/signaux positifs et 3 625 codes IDCC; les entreprises sans finances publiées restent distinguées des erreurs d'import.
- Minimisation : aucun payload Annuaire brut, élu, date de naissance, nationalité, adresse, email, téléphone ou bénéficiaire effectif n’est copié dans le snapshot.
- Veille média prioritaire : 401 SIREN dans le cache, 2 771 métadonnées d'articles, avec 3 `ok`, 238 `partial`, 5 `empty` et 155 `error`; titre, URL, domaine, date, fournisseur et confiance uniquement.
- Contrôle fournisseur : GDELT a produit des `429` pendant le batch; le collecteur active un cooldown de 60 secondes et continue le fournisseur Google News sans transformer le résultat partiel en résultat complet.
- Limite : le cache média reste ciblé et non exhaustif; les noms d'entreprise peuvent être homonymes et une absence de mention n'est jamais interprétée comme absence de couverture.

## BODACC Guadeloupe, juillet 2026

- Filtre source : département `971`, annonces publiées depuis le 1er janvier 2020.
- Volume lu : 144 756 annonces; volume rattaché : 90 930 lignes à SIREN exact.
- Couverture : 36 354 SIREN disposent d'au moins un événement dans cette fenêtre, soit 30,09 % des 120 710 SIREN du stock territorial.
- Projection : `data/bodacc-guadeloupe.sqlite`, clé `(siren, event_id)`, import JSON officiel par export et commits par tranches de 1 000.
- Données non persistées : payload brut, noms de personnes, actes, administrations, adresses issues des blocs juridiques et descriptions libres non nécessaires.
- Contrôles : 3 tests ciblés du parseur et du schéma; validation API d'une fiche avec 29 annonces locales et statut `snapshot`.
- Limite : BODACC couvre des publications légales datées, non une présence économique actuelle; la fenêtre 2020 ne constitue pas un historique exhaustif et l'absence d'événement ne permet aucune conclusion.
