# Caraaios CRM — consignes pour les agents

Quand une demande concerne le suivi commercial Caraaios (« ajoute cette société », « enrichis cette société », « ajoute ces personnes », « mets à jour la cartographie », « ajoute le buying committee »), utilise les outils métier du serveur MCP Caraaios CRM décrits dans [docs/MCP_CARAAIOS_CRM.md](docs/MCP_CARAAIOS_CRM.md). Ne manipule pas directement la base pour accomplir une demande CRM quand ces outils sont disponibles.

- Avant une création, recherche la société ou la personne dans le CRM. Réutilise l'identifiant existant lorsqu'il est établi avec certitude.
- Pour plusieurs collaborateurs, privilégie `crm_import_company_map` : un appel structuré peut contenir les personnes, les relations, les rôles d'achat et les hypothèses. Utilise d'abord `dry_run: true` pour un import massif et traite les conflits signalés avant l'écriture.
- Conserve la provenance et le niveau de preuve de chaque information. Une inférence reste `inferred` ; ne la transforme jamais en observation, déclaration ou fait vérifié.
- Ne fusionne pas volontairement deux personnes ambiguës. Laisse un conflit à examiner si l'identité n'est pas certaine.
- Après une écriture importante, relis la société avec `crm_get_company_map` pour vérifier ce qui a réellement été conservé.
- Ne mets aucun jeton MCP, clé OpenAI ou donnée commerciale sensible dans le code, les exemples committés ou les journaux.

L'analyse des documents, captures et vidéos est faite par ChatGPT ou Codex. Le MCP ne fournit que l'accès contrôlé aux données et actions du CRM.
