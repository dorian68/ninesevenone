# État Actuel

Date d'audit: 2026-07-18.

## Constats

- Le dossier `C:\Users\Labry\Documents\GUAD` était vide.
- Aucun dépôt Git n'était initialisé.
- Aucune architecture, base de données, authentification, composant UI ou convention de code n'existait.
- Outils locaux disponibles: Node.js 24.12.0, npm 11.8.0, Python 3.11.9.

## Dette technique initiale

- Aucun historique projet.
- Aucun pipeline d'import.
- Aucun schéma relationnel.
- Aucun mécanisme d'authentification ou RBAC.
- Aucun test.

## Décision

Créer un socle neuf mais séparé par responsabilités: application Next.js côté produit et squelette FastAPI/PostGIS côté ingestion, données et API industrielle.

## Mise à jour du 2026-07-19

Le socle dispose maintenant d'un index SIRENE territorial réel, d'une carte MapLibre, d'un Studio de prospection, d'un dossier BI sourcé par SIREN et d'une fiche SSR. Les actions publiques de revendication, signalement et proposition d'enrichissement sont persistées dans `data/moderation.sqlite`; la console `/admin` les traite derrière un jeton serveur signé et un journal d'audit. Les faits officiels restent en lecture seule et les champs approuvés par l'administration sont exposés séparément comme déclarés.

Les limites structurantes restent l'authentification multi-utilisateur, le workspace anonyme, la bascule Postgres/PostGIS multi-instance, le rate limiting Redis, les opérations d'import depuis l'UI et la couverture partielle de certaines sources externes.
