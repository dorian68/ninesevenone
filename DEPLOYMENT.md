# Déploiement

## Développement

```bash
docker compose up -d
npm install
python scripts/import_sirene_stock_guadeloupe.py
python scripts/build_guadeloupe_sqlite.py
npm run dev
```

Pour réutiliser une archive SIRENE déjà présente, ajouter `--skip-download` à la commande d'import. Le chemin de l'index local peut être surchargé avec `GUADELOUPE_DB_PATH`.
Le Studio crée `data/workspaces.sqlite` pour les recherches, shortlists et brouillons explicitement enregistrés. En développement, le chemin est configurable par `WORKSPACE_DB_PATH`; le cookie de workspace est HttpOnly, SameSite=Lax et conservé 180 jours. En production, remplacer ce stockage local par les tables de `024_workspace_persistence.sql` et rattacher chaque workspace à un utilisateur authentifié.

## Production cible

- PostgreSQL avec PostGIS.
- Redis pour cache et queues.
- Stockage objet S3-compatible.
- Next.js déployé comme service web.
- FastAPI + workers déployés comme services séparés.
- Migrations contrôlées avant publication.
- Health checks sur web, API, DB et workers.

## Variables

Voir `.env.example`.

Pour activer la console de modération en environnement contrôlé, définir `ADMIN_ACCESS_TOKEN`, `ADMIN_SESSION_SECRET` et `ADMIN_ROLE` dans le secret manager. Ne jamais placer ces valeurs dans le bundle client. Le runtime local écrit les revendications, signalements, décisions et enrichissements déclarés dans `MODERATION_DB_PATH`; en production, migrer ce registre vers PostgreSQL et remplacer le rate limiting mémoire par Redis avant plusieurs instances web.
