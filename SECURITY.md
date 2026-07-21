# Sécurité et Conformité

## Rôles

- `SUPER_ADMIN`
- `DATA_ADMIN`
- `MODERATOR`
- `COMPANY_OWNER`
- `USER`

Les contrôles doivent être serveur, jamais uniquement UI.

## Mesures prévues

- validation Zod/Pydantic;
- RBAC côté API;
- rate limiting;
- protection XSS et CSP;
- secrets via variables d'environnement;
- audit administratif;
- séparation données officielles, enrichies et déclarées;
- pas de collecte automatique d'emails ou téléphones personnels;
- journalisation des corrections et revendications.
- les recherches, shortlists et brouillons du studio sont envoyés au serveur uniquement après action explicite d'enregistrement; ils sont liés à un jeton aléatoire stocké sous cookie HttpOnly, jamais au nom ou à l'email d'une personne dans ce vertical slice;
- le workspace anonyme expire après 180 jours et expose une purge complète; avant un usage multi-utilisateur, appliquer authentification, RBAC, quotas, chiffrement au repos, audit des exports et contrôle d'accès par utilisateur;
- les brouillons peuvent contenir des informations saisies par l'utilisateur : ils ne sont pas indexés, partagés ni utilisés pour enrichir une entreprise.

## Enrichissements Externes

- les noms et prénoms de personnes physiques ne sont pas sélectionnés depuis `StockUniteLegale` ;
- les nouveaux champs SIRENE sont limités aux statuts administratifs, agrégats d'effectif, identifiants d'association, périodes et dates de traitement; aucun nom de personne, email ou téléphone n'est ajouté ;
- l'import RNA sélectionne explicitement les attributs de l'association; `adrg_declarant`, `dir_civilite`, adresses de gestion, emails, téléphones et observations libres ne sont ni lus dans la requête DuckDB, ni stockés ;
- les statuts de diffusion SIRENE courants bloquent toute réinjection d'adresse ou de géolocalisation historique ;
- les événements BODACC excluent les champs d'administration contenant des identités de dirigeants ;
- la veille média conserve seulement titre, éditeur, date et URL, jamais le corps de l'article ;
- toutes les URL externes sont limitées aux protocoles HTTP/HTTPS ;
- aucune donnée LinkedIn ou issue d'un courtier n'est collectée sans contrat et base légale explicites.
- l'extrait OSM Geofabrik utilisé ne contient ni nom de contributeur, ni identifiant utilisateur, ni changeset; seuls les attributs professionnels attachés à un SIREN/SIRET exact sont conservés ;
- les emails présents dans les sources ADEME RGE ou OSM ne sont pas importés ni exposés ;
- les certificats RGE sont limités aux liens de documents publiés par l'ADEME et les organismes de qualification.
- l'import RNE/Annuaire des Entreprises ne conserve que le nom public affiché, la qualité du mandat, le type de dirigeant et le SIREN d'une personne morale lorsqu'il est publié; dates de naissance, nationalité, adresse, email, téléphone, bénéficiaires effectifs et actes sont exclus dès le parsing ;
- la couverture de l'index des mandats est mesurée par SIREN et affichée comme partielle; une absence de mandat dans l'index ne signifie jamais absence de mandat dans la source ;
- le collecteur web refuse les URL avec identifiants, les ports hors 80/443 et toute résolution DNS privée, locale, réservée ou non globale afin de prévenir les SSRF ;
- `robots.txt` est contrôlé selon RFC 9309 sur chaque origine après redirection; une erreur serveur ou réseau interdit la collecte, et cinq redirections au maximum sont suivies ;
- les pages sont limitées à 1 Mio, le HTML brut n'est jamais stocké, les emails ne sont pas extraits et les directives `noindex`/`nosnippet` interdisent toute réutilisation du contenu ;
- les plateformes sociales et annuaires externes sont ignorés par le collecteur web automatisé.
- l'import SCDL accepte uniquement les jeux munis d'une licence ouverte explicite (`lov2`, `fr-lo`, `odc-odbl`), plafonne la taille de chaque ressource et rejette les pages HTML ou schémas non conformes ;
- les bénéficiaires de subvention sont reliés uniquement par SIRET exact ou RNA exact non ambigu; aucun rapprochement nominatif n'est publié ;
- l'API Data.Subvention restreinte aux agents habilités ou usagers authentifiés n'est ni appelée ni exposée par l'application publique ;
- les conventions importées ne contiennent que des données sur l'attribution, l'organisme bénéficiaire et la provenance; aucune identité de représentant, coordonnée personnelle ou pièce de dossier n'est collectée.
- l'import des aides ADEME utilise l'export officiel sous Licence Ouverte, contrôle le type et la taille du fichier, et ne sélectionne que les champs du dossier d'aide et l'identifiant SIRET professionnel ;
- les montants ADEME sont séparés selon que le SIRET appartient ou non au stock actif guadeloupéen, afin d'éviter de présenter un engagement national de groupe comme une aide locale.
- l'import Fonds vert accepte uniquement les ressources CSV officielles sous Licence Ouverte, plafonne leur taille, refuse le HTML et n'utilise jamais le nom du bénéficiaire comme clé de jointure ;
- la localisation Fonds vert est calculée depuis les codes département/commune publiés et reste distincte du rattachement SIREN/SIRET; le fichier biodiversité sans identifiant est exclu.
- l'import France Relance exige la Licence Ouverte 2.0, plafonne l'export CSV, refuse le HTML et joint uniquement les SIREN/SIRET exacts; aucun nom n'est utilisé comme clé de rapprochement ;
- les descriptions France Relance restent attribuées aux projets lauréats, ne sont pas analysées pour extraire des personnes et ne sont jamais substituées à une description actuelle ou vérifiée de l'entreprise ;
- l'absence de montant individuel dans la source France Relance est conservée comme telle; aucune estimation financière n'est calculée.
- l'import des organismes de formation exige une licence ouverte, limite le téléchargement, refuse le HTML et joint uniquement les SIREN/SIRET exacts ;
- les dénominations, voies, contacts et informations sur les organismes étrangers représentés ne sont ni sélectionnés ni stockés ;
- les volumes BPF restent des agrégats de stagiaires et formateurs attribués à une période; ils ne sont jamais assimilés à l'effectif salarié actuel ;
- un certificat qualité est affiché uniquement lorsque la catégorie correspondante vaut explicitement `true` dans le snapshot quotidien.
- l'import Egapro exige la Licence Ouverte 2.0, plafonne le classeur, contrôle sa signature XLSX et ne rapproche jamais les entreprises par dénomination ;
- les rattachements UES proviennent uniquement des SIREN explicitement publiés dans la déclaration et restent identifiés comme scores collectifs ;
- aucune raison sociale source, donnée de salarié, rémunération, adresse précise ou coordonnée de contact Egapro n'est stockée ;
- les scores `NC` et indicateurs non applicables restent distincts afin d'empêcher toute conversion trompeuse en zéro.

La console `/admin` dispose désormais d'un bootstrap serveur contrôlé : `ADMIN_ACCESS_TOKEN` n'est comparé que côté serveur, `ADMIN_SESSION_SECRET` signe une session HMAC HttpOnly de huit heures et `ADMIN_ROLE` détermine le rôle serveur. Les endpoints de revendication, signalement et mise à jour valident les payloads avec Zod, limitent les appels par IP et n'écrivent que dans le registre local de modération. Les propositions approuvées sont publiées dans une projection déclarée séparée; les faits SIRENE ne sont jamais mutés. Les décisions et références de SIREN sont journalisées, sans recopier les messages ou emails dans la liste d'audit.

Ce mécanisme ne remplace pas l'authentification utilisateurs complète attendue en production : `COMPANY_OWNER` et `USER`, récupération de compte, MFA, stockage Postgres multi-instance, chiffrement des contacts, CSRF pour les sessions applicatives et limitation Redis restent à brancher. Aucun secret par défaut ne doit être utilisé et l'accès à la console doit rester privé tant que ces éléments ne sont pas déployés.

## Conventions collectives et OPCO

- téléchargements bornés et licences validées avant traitement ;
- intégrité SHA-512 du paquet KALI contrôlée avant extraction ;
- extraction limitée aux métadonnées `KALICONT`, sans articles ni texte intégral ;
- jointure SIRET exacte et exclusion des établissements à diffusion restreinte ;
- aucun salarié, représentant, nom personnel, email, téléphone ou rémunération importé ;
- champs déclaratifs présentés comme signaux de source, jamais comme conclusion juridique automatisée.

## Brevets

- les quatre jeux utilisés exigent une Licence Ouverte confirmée dans l'API data.gouv.fr ;
- la jointure est exclusivement fondée sur un SIREN exact actif et publiable ;
- les clés de personnes présentes dans l'export source ne sont jamais stockées ;
- inventeurs, déposants personnes physiques, adresses et contacts sont exclus ;
- les résumés publics sont bornés à 4 000 caractères et aucun texte de brevet complet n'est recopié ;
- les appels API sont bornés, paginés, mis en cache et rejouables ;
- l'API publique limite l'affichage à 20 familles tout en calculant les agrégats exhaustifs côté serveur.

## Ratios financiers

- seules les unités légales actives et diffusables sont requêtées; les SIREN restreints ne quittent jamais le stock local dans ce pipeline ;
- la licence et les 23 champs attendus sont contrôlés avant tout import ;
- la jointure est exclusivement fondée sur le SIREN exact, sans nom, dirigeant, adresse ou contact ;
- les montants bruts d'un exercice partiellement confidentiel restent auditables hors ligne mais sont remplacés par `null` dans l'API publique ;
- les types de bilan C, S et K ne sont jamais agrégés dans une même série ;
- aucune notation de crédit, solvabilité, risque de défaut ou recommandation financière n'est produite.

## Bilans financiers détaillés

- le téléchargement provient exclusivement de la ressource HTTPS officielle référencée par data.gouv.fr, avec licence, taille, plages et signature Parquet contrôlées ;
- les actes et PDF INPI ne sont pas importés : ils peuvent contenir signatures, dirigeants, adresses ou autres données personnelles et nécessitent une authentification dédiée ;
- le rapprochement utilise uniquement le SIREN exact, jamais un nom ou une personne ;
- `liasse_json` reste dans l'index hors ligne et n'appartient pas aux colonnes sélectionnées par le lecteur serveur public ;
- tous les agrégats de compte de résultat deviennent `null` pour un exercice partiellement confidentiel ;
- aucune cellule fiscale, notation de crédit ou inférence de solvabilité n'est envoyée au navigateur.
