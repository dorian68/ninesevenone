# MCP Caraaios CRM

Le serveur MCP donne à Codex et ChatGPT un accès métier au suivi commercial Caraaios. Il lit et écrit les mêmes sociétés, contacts et cartes d'entreprise que l'interface du CRM. L'analyse d'une vidéo, d'une capture ou d'un document reste réalisée dans ChatGPT ou Codex ; le serveur reçoit les données structurées et les conserve.

## Architecture

```text
ChatGPT / Codex ── Streamable HTTP ── /mcp (Next.js)
                                        │
CRM UI / API ──────────────────────────┤
                                        ↓
                          Services CRM et cartographie
                                        ↓
                            SQLite du suivi commercial
```

Le projet utilise Next.js 16, TypeScript et `node:sqlite`, sans ORM pour le CRM. Le serveur MCP est une route du même serveur Next.js que l'interface, sous `/mcp`. Les services existants `prospect-factory-crm-db.ts` et `account-map-db.ts` restent la source de vérité. `PROSPECTS_CRM_DB_PATH` choisit le fichier SQLite ; si la variable est absente, le CRM utilise `data/prospects-db/prospect_factory_crm.sqlite` dans ce dépôt. Une route MCP et l'interface démarrées dans le même processus utilisent donc nécessairement la même base.

Le transport est Streamable HTTP. Le [SDK TypeScript MCP v2](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions) permet au même point d'entrée de servir le protocole `2026-07-28` et les clients MCP encore sur l'échange `2025`. Les outils exposent des opérations CRM nommées ; ils n'exposent ni SQL générique, ni commande système, ni suppression.

## Démarrage local sur Windows (PowerShell)

Depuis la racine de ce dépôt :

```powershell
npm ci
$env:CARAAIOS_MCP_TOKEN = Read-Host 'Jeton privé Caraaios MCP (32 caractères minimum)'
npm run mcp:dev
```

`npm run mcp:dev` démarre **l'interface et le MCP ensemble** sur `127.0.0.1:3100`. L'URL MCP locale est **`http://127.0.0.1:3100/mcp`**. Pour choisir un autre port, définir `CARAAIOS_MCP_PORT` avant le démarrage. Le démarrage habituel `npm run dev` sert aussi `/mcp` sur le port Next.js habituel, `3000` si libre.

La valeur de `CARAAIOS_MCP_TOKEN` doit être secrète et contenir **au moins 32 caractères**. Elle n'est pas une clé OpenAI. Ne la commitez pas. Pour utiliser la base CRM déjà située ailleurs, définir **un chemin absolu** `PROSPECTS_CRM_DB_PATH` avant de lancer Next.js. C'est ce chemin qui détermine les données visibles à la fois dans l'interface et depuis MCP. La variable n'est pas nécessaire si le fichier par défaut de ce dépôt est le bon.

Sur ce poste, la base commerciale existante a été trouvée ici :

```powershell
$env:PROSPECTS_CRM_DB_PATH = 'C:\Users\Labry\documents\GUAD\data\prospects-db\prospect_factory_crm.sqlite'
npm run mcp:migrate
npm run mcp:dev
```

`mcp:migrate` crée une sauvegarde SQLite dans le sous-dossier `backups`, initialise le nouveau schéma par le même code CRM, puis contrôle la version et l'intégrité de la base. Le schéma CRM actuel est **v11** (`PRAGMA user_version = 11`) : il ajoute aux signaux les brouillons de copywriting par personne et leur historique. Il exige un fichier SQLite **déjà existant** ; ne l'exécutez pas pour une base neuve. Il doit être lancé avant `mcp:dev` si vous ciblez les données commerciales existantes du répertoire `GUAD`.

Le schéma CRM est initialisé par les services SQLite du projet à l'ouverture de la base. Les commandes de vérification sont :

```powershell
npm run mcp:test
npm run mcp:smoke
npm run typecheck
npm run test
```

Pour inclure une découverte automatisée par MCP Inspector dans le test HTTP isolé :

```powershell
$env:CARAAIOS_MCP_INSPECTOR = '1'
npm run mcp:smoke
```

Cette option lance Inspector via `npx` pendant le smoke test et demande donc un accès au paquet npm s'il n'est pas déjà présent en cache. La suite générale `npm run test` couvre aussi des modules hors MCP ; dans ce worktree isolé, leurs données Prospect Factory et la base Guadeloupe doivent être accessibles via les chemins externes prévus, notamment `PROSPECTS_DB_PATH` et `GUADELOUPE_DB_PATH`.

## Authentification et limites

Toutes les requêtes MCP, y compris la découverte des outils, demandent le jeton de `CARAAIOS_MCP_TOKEN`. Codex l'envoie comme `Authorization: Bearer <jeton>`. Le client Secure MCP Tunnel peut aussi l'injecter dans `X-Caraaios-Mcp-Key` depuis son environnement. Les deux voies sont vérifiées par le même serveur. Un appel sans jeton valide doit recevoir `401` ; un jeton ne doit apparaître ni dans les paramètres d'outil, ni dans les journaux.

Le serveur écoute sur l'interface locale par défaut. Si l'URL devient publiquement accessible, il faut ajouter une authentification adaptée aux utilisateurs, du TLS et des règles d'accès de production. Le tunnel décrit plus bas garde le serveur local privé.

## Outils métier

| Outil | Utilité |
| --- | --- |
| `crm_search_companies` | Rechercher des sociétés avant une création. |
| `crm_get_company` | Lire la fiche structurée d'une société. |
| `crm_get_company_map` | Récupérer la carte, les personnes et le contexte commercial. |
| `crm_search_contacts` | Rechercher des personnes pour éviter les doublons. |
| `crm_get_contact` | Lire un contact identifié. |
| `crm_upsert_company` | Créer ou enrichir une société. |
| `crm_upsert_contact` | Créer ou enrichir une personne dans une société. |
| `crm_import_company_map` | Importer en masse personnes, relations, rôles d'achat et hypothèses. |
| `crm_get_company_icps` | Lire les qualifications ICP d'une société. |
| `crm_upsert_opportunity` | Créer ou retrouver le contexte d'une campagne, d'un ICP ou d'un cas d'usage pour le buying committee. |
| `crm_upsert_company_icp` | Ajouter ou actualiser une qualification ICP contextualisée. |
| `crm_add_company_research` | Enregistrer une note, une preuve, un pain ou une hypothèse avec provenance. |
| `crm_get_company_signals` | Lire les signaux de fit/timing et les métadonnées des pièces jointes, par pages. |
| `crm_upsert_company_signal` | Créer, modifier ou archiver un signal avec contrôle de version. |
| `crm_add_company_signal_attachment` | Joindre le PDF ou l'image d'origine à un signal. |
| `crm_get_company_signal_attachment` | Relire une pièce jointe précise en Base64, seulement si nécessaire. |
| `crm_get_outreach_context` | Lire un contexte de rédaction compact pour une personne : ICP, persona, carte, rôles d'achat, signaux, observations et brouillons. |
| `crm_list_outreach_drafts` | Relire les brouillons d'une société ou d'un contact, avec pagination et archives facultatives. |
| `crm_upsert_outreach_draft` | Créer ou modifier un brouillon ciblant un seul contact, avec contrôle de version et références aux signaux. |

Les outils de lecture portent l'annotation MCP `readOnlyHint`. Les outils d'écriture sont identifiés comme tels et leurs entrées sont validées par schéma. Les annotations aident le client à traiter l'action, mais [ne remplacent pas le contrôle d'accès côté serveur](https://developers.openai.com/plugins/build/mcp-server).

`crm_get_company_map` synchronise au besoin les contacts déjà présents en nœuds de la carte, comme le fait l'interface CRM. Son annotation signale donc correctement cet effet de persistance, même si la réponse est une lecture. `crm_get_company_icps` fournit aussi le catalogue des ICP existants et leurs identifiants. Pour associer un rôle d'achat à un ICP ou cas d'usage, créer ou retrouver d'abord son contexte avec `crm_upsert_opportunity`, puis passer `opportunity_id` dans `buying_committee`.

Appeler `crm_get_company_map` avec `{"company_id":"<UUID>","include_evidence":true}` pour relire les liens de preuves de la cartographie. La réponse `map.evidence` associe chaque relation, affirmation ou rôle d'achat à une source par `subjectKind`, `subjectId` et `sourceId`, avec `locator`, `excerpt` et **`evidenceType` exact** : `observed`, `verified`, `declared`, `inferred` ou `unknown`. `map.sources` donne les sources correspondantes. Le statut métier `evidenceStatus` de la relation ou du rôle reste distinct de ce type de preuve ; un champion potentiel inféré reste donc inféré après relecture. Un lien ancien créé dans l'interface sans qualification explicite peut avoir `evidenceType: null` ; la migration ne lui attribue pas artificiellement un fait vérifié. `include_evidence:false` retire `sources` et `evidence` de la réponse.

`crm_get_company_map` inclut aussi les **50 signaux les plus récents** dans `map.signals` (texte, liens et métadonnées de fichiers, jamais les octets). Passer `include_signals:false` pour une carte plus légère. `crm_get_company_signals` permet de parcourir tous les signaux avec `limit` (1–100), `offset` et `include_archived`.

### Copywriting ciblé par personne

L'onglet **Copywriting** du suivi commercial permet de sélectionner une personne déjà présente dans la société et de créer **uniquement les brouillons utiles**. Il n'existe aucun brouillon généré automatiquement pour tous les employés. Depuis la fiche d'un contact dans la vue marché, le bouton **Rédiger une approche** ouvre cet onglet avec cette personne sélectionnée. L'interface affiche ses brouillons, le contexte ICP/persona, les signaux disponibles et un formulaire de rédaction. La rédaction, la réflexion stratégique et la validation des affirmations restent dans Codex ou ChatGPT ; le CRM stocke le résultat. Aucun outil MCP n'envoie de message.

Depuis MCP, rechercher d'abord la société et la personne avec `crm_search_companies` et `crm_search_contacts`, puis appeler `crm_get_outreach_context` avec `company_id` et `contact_id`. Ajouter `icp_id`, `persona_id` ou `opportunity_id` si ce contexte est connu. La réponse distingue l'état de qualification de l'ICP, les rôles d'achat et les éléments sourcés des hypothèses ; une piste inférée ne doit pas devenir une promesse ou un pain affirmé dans le texte. `crm_get_outreach_context` peut synchroniser un nœud de cartographie manquant, comme `crm_get_company_map`.

Pour enregistrer, `crm_upsert_outreach_draft` reçoit `company_id`, une `idempotency_key` stable à la création, et `draft` : `contact_id` obligatoire, `icp_id`, `persona_id` et `opportunity_id` facultatifs (`null` si inconnus), `channel` (`email`, `linkedin_connection`, `linkedin_message`, `phone`, `other`), `status` (`draft`, `ready`, `archived`), `angle`, `subject`, `body`, `call_to_action` et `signal_ids`. Le persona doit appartenir à l'ICP choisi ; le contact, le cas d'usage et chaque signal doivent appartenir à la société. `ready` signifie **prêt à relire**, jamais envoyé. Pour modifier, fournir `draft_id`, `expected_version` et le brouillon complet ; une version périmée est rejetée et l'ancienne version reste dans l'historique. `crm_list_outreach_drafts` permet ensuite de vérifier l'enregistrement, filtré par `contact_id` si nécessaire.

Exemple :

```json
{
  "company_id": "<UUID_SOCIETE>",
  "idempotency_key": "premier-email-paul-2026-10",
  "draft": {
    "contact_id": "<UUID_CONTACT_PAUL>",
    "icp_id": "<UUID_ICP_PARTENARIATS>",
    "persona_id": "<UUID_PERSONA_REV_OPS>",
    "opportunity_id": null,
    "channel": "email",
    "status": "draft",
    "angle": "Le signal de recrutement suggère un besoin possible ; à vérifier.",
    "subject": "Échange sur les opérations partenariats ?",
    "body": "Bonjour Paul, ...",
    "call_to_action": "Seriez-vous disponible 15 minutes ?",
    "signal_ids": ["<UUID_SIGNAL_SOURCE>"]
  }
}
```

### Import d'une cartographie

`crm_import_company_map` est l'outil à privilégier pour une vidéo ou une liste volumineuse. Rechercher d'abord la société avec `crm_search_companies`. L'import accepte **`company_id` d'une société existante ou `company` avec son identité** (`name`, et si possible `domain` ou `linkedin_url`) : dans ce second cas, il retrouve ou crée la société à l'application. Avec `dry_run: true`, une nouvelle société est simplement annoncée comme `would_create` et **aucune écriture** n'est effectuée. Une requête associe cette société à une source et à des ensembles de personnes, de relations, de rôles d'achat et d'hypothèses. Elle peut aussi contenir une `idempotency_key`. L'entrée accepte jusqu'à 500 personnes et traite l'écriture par lots de 100 pour respecter la limite des observations par lot. Pour une centaine de personnes ou plus, appeler d'abord l'outil avec `dry_run: true`, puis examiner les conflits et les profils incertains avant l'écriture.

Exemple d'entrée pour une société encore absente du CRM :

```json
{
  "company": { "name": "Kactus", "domain": "kactus.com" },
  "source": {
    "source_type": "linkedin_video",
    "source_reference": "PROSPECTION_KACTUS.mp4",
    "observed_at": "2026-10-01T10:00:00+02:00"
  },
  "people": [
    {
      "name": "Paul Averseng",
      "title_raw": "Lead Rev Ops chez Kactus",
      "employment_status": "current_employee",
      "evidence_type": "observed",
      "evidence": { "locator": "00:14", "excerpt": "Nom et poste visibles" }
    },
    {
      "name": "Nicolas Debock",
      "title_raw": "Early Stage European Tech Investor",
      "employment_status": "investor",
      "evidence_type": "observed",
      "evidence": { "locator": "02:31" }
    }
  ],
  "dry_run": true,
  "idempotency_key": "kactus-prospection-video-2026-10-01"
}
```

Pour une société déjà identifiée, remplacer `company` par `"company_id": "<UUID_RETOURNE_PAR_LA_RECHERCHE>"`. Le `dry_run` d'une société nouvelle donne une projection des créations et des conflits dans le lot ; les rapprochements à la base et les liens de la carte sont vérifiés lorsque la société existe effectivement.

`people` accepte notamment `first_name`, `last_name`, `title_normalized`, `department`, `team`, `seniority`, `linkedin_url`, `professional_email`, `location`, `notes` et `contact_id`. L'identité d'une personne doit être `observed`, `verified` ou `declared` pour créer un contact ; une identité `inferred` ou `unknown` ressort en conflit à examiner. `relationships` relie les entrées par `from_person_index` et `to_person_index` ; `buying_committee` utilise `person_index` et l'`opportunity_id` UUID d'une opportunité de la carte, à obtenir avec `crm_upsert_opportunity` ; `hypotheses` peut viser un `person_index` ou la société. Chaque entrée conserve son propre `evidence_type`, avec justification et question de vérification pour une inférence.

Chaque personne doit porter son statut d'emploi lorsqu'il est connu : `current_employee`, `former_employee`, `board`, `investor`, `advisor`, `external`, `homonym` ou `uncertain`. Ne jamais déduire `current_employee` du seul fait qu'un profil apparaît pendant une recherche. Les preuves distinguent `observed`, `verified`, `declared`, `inferred` et `unknown`. Exemple : un intitulé visible dans une vidéo peut être `observed` ; la proposition que cette personne serait `potential_champion` reste `inferred`. Une ligne hiérarchique suggérée sans preuve doit rester une relation inférée.

La carte graphique de l'interface possède un vocabulaire de liens et de rôles plus restreint. Lorsqu'un rôle ou un lien MCP est plus précis, l'import conserve aussi son libellé d'origine dans une observation sourcée de **la même carte**. `crm_get_company_map` restitue le rôle exact dans `buying_committee.role` et sa catégorie graphique dans `mapRole` ; les types de liens d'origine se retrouvent dans `relationship_observations`. Une catégorie graphique large ne doit donc pas être interprétée comme une qualification confirmée.

La source précise son type, sa référence (par exemple `PROSPECTION_KACTUS.mp4`) et, si possible, sa date d'observation. Le résultat contient `import_batch_ids`, un `summary` des créations, mises à jour, entrées inchangées, conflits et erreurs, ainsi qu'un résultat par ligne. Une ligne invalide ne doit pas faire perdre le reste du lot. Si plusieurs personnes peuvent correspondre à la même entrée, le résultat signale un conflit ; le serveur ne fusionne pas arbitrairement leurs fiches. Relancer un même import ne doit pas créer de doublons. Après écriture, appeler `crm_get_company_map` pour confirmer le contenu réellement enregistré dans la carte utilisée par l'interface.

### ICP et recherches

Une société peut avoir plusieurs ICP simultanément. `crm_get_company_icps` lit leurs statuts et l'historique des observations ; `crm_upsert_company_icp` reçoit l'identifiant d'un ICP existant, un statut (`candidate`, `investigating`, `qualified`, `disqualified` ou `unknown`), un type de preuve, la source et d'éventuelles notes. `qualified` et `disqualified` exigent une preuve `observed`, `verified` ou `declared` : une simple inférence ne suffit pas. Une mise à jour réellement différente ajoute une observation et conserve les précédentes.

`crm_add_company_research` sépare `observed_fact`, `hypothesis`, `declared_pain`, `confirmed_use_case` et `note`. Une hypothèse utilise `inferred` ou `unknown` et indique une justification ainsi qu'une question de vérification ; un pain déclaré utilise `declared` ; un cas d'usage confirmé exige `declared` ou `verified`. Pour toute assertion présentée comme observée, déclarée ou vérifiée, fournir une source repérable. Les types de source prévus comprennent `linkedin_video`, `linkedin_profile`, `company_website`, `press`, `job_posting`, `user_manual`, `chatgpt_research`, `codex_research` et `other`.

### Signaux de fit et de timing

Chaque entreprise possède une liste de signaux éditables dans l'onglet **Recherche → Signaux de fit et de timing**. L'entité `prospect_factory_company_signals` vit dans la base CRM existante ; l'interface et MCP appellent le même service `company-signals.ts`. Les signaux ne modifient pas automatiquement le score de qualification. Ils fournissent la matière première pour analyser le fit, le timing et, plus tard, rédiger une approche adaptée à l'ICP, au persona et au buying committee.

Un signal contient `kind` (`job_posting`, `article`, `press_release`, `company_announcement`, `funding`, `leadership_change`, `product_launch`, `website` ou `other`), `title`, `description`, `readiness_dimension` (`fit`, `timing`, `both` ou `unknown`), `evidence_type`, `source_reference` ou `source_url`, et éventuellement `published_at`, `observed_at` et `interpretation`. La **description** reprend ce que la source montre ; l'**interprétation** reste une hypothèse commerciale affichée séparément. `observed`, `verified` et `declared` exigent un lien ou une référence de source. Les dates sont au format `YYYY-MM-DD` ; une date inconnue reste `null`.

Exemple de création via `crm_upsert_company_signal` :

```json
{
  "company_id": "<UUID_KACTUS>",
  "idempotency_key": "kactus-offre-finance-2026-10",
  "signal": {
    "kind": "job_posting",
    "title": "Recrutement Lead Finance Ops",
    "description": "L'offre mentionne la consolidation de données financières et le reporting mensuel.",
    "readiness_dimension": "timing",
    "interpretation": "Un besoin de fiabiliser le reporting est possible ; à vérifier avec l'équipe finance.",
    "evidence_type": "observed",
    "source_reference": "Offre d'emploi Kactus",
    "source_url": "https://example.org/offre-kactus",
    "published_at": null,
    "observed_at": "2026-10-02",
    "archived": false
  }
}
```

Pour modifier ou archiver, relire d'abord le signal, puis fournir `signal_id`, `expected_version` et tous les champs `signal`. Un changement concurrent produit un conflit plutôt qu'une écriture silencieuse. Les versions antérieures sont conservées dans `prospect_factory_company_signal_revisions`. Une même `idempotency_key` rejouée avec le même contenu ne crée pas de doublon. L'archivage conserve le texte et les pièces jointes et peut être annulé.

L'interface accepte les PDF, PNG, JPEG et WebP jusqu'à **10 Mo par fichier**. Les octets et les métadonnées sont stockés dans la même base SQLite, afin qu'une sauvegarde de la base couvre aussi les pièces jointes. Le service contrôle le type réel du fichier, calcule son SHA-256 et évite un second enregistrement des mêmes octets pour le même signal. Côté MCP, appeler `crm_add_company_signal_attachment` avec `company_id`, `signal_id`, `file_name`, `mime_type` et `content_base64`. Les lectures ordinaires retournent uniquement le nom, le type, la taille et l'identifiant du fichier ; `crm_get_company_signal_attachment` restitue une image comme bloc image MCP ou un PDF en Base64, sur demande, avec ces trois identifiants (`company_id`, `signal_id`, `attachment_id`). Pour le raisonnement et le copywriting, saisir la partie pertinente du document dans la description du signal et conserver l'original en pièce jointe.

### Exemple de séquence dans ChatGPT ou Codex

1. Rechercher « Kactus » avec `crm_search_companies` ; utiliser son `company_id` si elle existe, sinon son identité `company` dans l'import.
2. Extraire les personnes de la vidéo avec les capacités de vision du client, en séparant observations et inférences.
3. Prévisualiser `crm_import_company_map` avec `dry_run: true` et une référence de source stable ; une société encore absente sera prévisualisée sans être créée.
4. Résoudre les conflits d'identité ou les laisser explicitement à examiner, puis exécuter l'import.
5. Relire avec `crm_get_company_map` (`include_evidence: true`) et raisonner sur les champions et sponsors possibles sans promouvoir une hypothèse en fait.

## Connecter Codex local

Dans un terminal PowerShell qui possède **le même jeton** que le serveur :

```powershell
$env:CARAAIOS_MCP_TOKEN = Read-Host 'Même jeton privé Caraaios MCP'
codex mcp add caraaios --url http://127.0.0.1:3100/mcp --bearer-token-env-var CARAAIOS_MCP_TOKEN
codex mcp list
codex
```

Dans Codex, `/mcp` affiche l'état de la connexion. La commande `--bearer-token-env-var` est prise en charge par la CLI Codex et évite d'écrire le jeton dans `config.toml`. Pour une connexion à `npm run dev` sur le port usuel, remplacer `3100` par `3000`. La configuration équivalente dans `~/.codex/config.toml` est :

```toml
[mcp_servers.caraaios]
url = "http://127.0.0.1:3100/mcp"
bearer_token_env_var = "CARAAIOS_MCP_TOKEN"
```

La CLI, l'extension Codex et l'application ChatGPT de bureau partagent cette configuration locale. ChatGPT dans le navigateur ne lit pas ce fichier ; il faut une connexion distante, telle que le tunnel ci-dessous. Voir la [documentation officielle Codex MCP](https://learn.chatgpt.com/docs/extend/mcp).

## Tester avec MCP Inspector

Avec le CRM démarré, lancer dans un autre terminal :

```powershell
npx @modelcontextprotocol/inspector@latest
```

Dans Inspector, choisir **Streamable HTTP**, saisir `http://127.0.0.1:3100/mcp`, renseigner l'en-tête `Authorization: Bearer <votre jeton>` dans les paramètres du serveur et se connecter. Vérifier l'initialisation, la liste des outils et un appel de lecture. La commande Inspector suivante permet aussi de lister les outils depuis PowerShell :

```powershell
npx @modelcontextprotocol/inspector@latest --cli http://127.0.0.1:3100/mcp --transport http --header "Authorization: Bearer $env:CARAAIOS_MCP_TOKEN" --method tools/list
```

Vérifier également qu'un appel sans authentification est refusé. [OpenAI recommande Inspector](https://developers.openai.com/plugins/deploy/connect-chatgpt) pour contrôler les schémas, annotations et réponses avant l'ajout dans ChatGPT. La [référence Inspector](https://github.com/modelcontextprotocol/inspector/blob/main/docs/mcp-server-configuration.md#ad-hoc-servers) documente les paramètres `--cli`, `--transport`, `--header` et `--method`.

## Connecter ChatGPT dans le navigateur avec Secure MCP Tunnel

[Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) établit une connexion sortante depuis le poste qui exécute le CRM ; il ne publie pas `127.0.0.1:3100` sur Internet. Il faut un accès au [paramétrage des tunnels OpenAI Platform](https://platform.openai.com/settings/organization/tunnels), l'autorisation Platform **Tunnels Read + Manage** pour créer un tunnel, **Read + Use** pour l'utiliser, et le mode développeur autorisé dans l'espace ChatGPT concerné. Associer le tunnel à cet espace ChatGPT et à l'organisation Platform utilisée. La disponibilité de ces réglages dépend du compte et des droits de l'espace.

1. Créer un tunnel dans OpenAI Platform et relever son `tunnel_id`. Télécharger `tunnel-client` depuis la [dernière version officielle](https://github.com/openai/tunnel-client/releases/latest), puis placer l'exécutable sur `PATH`. Garder le CRM démarré à l'adresse locale indiquée plus haut.
2. Dans un **nouveau terminal PowerShell**, renseigner les valeurs demandées. Le jeton Caraaios doit être exactement celui employé au démarrage du CRM :

```powershell
$env:CONTROL_PLANE_API_KEY = Read-Host 'Clé runtime du tunnel OpenAI'
$env:CARAAIOS_MCP_TOKEN = Read-Host 'Même jeton privé Caraaios MCP'
$env:CARAAIOS_TUNNEL_ID = Read-Host 'tunnel_id OpenAI'
$env:MCP_EXTRA_HEADERS = 'X-Caraaios-Mcp-Key: env:CARAAIOS_MCP_TOKEN'
$env:MCP_DISCOVERY_EXTRA_HEADERS = 'X-Caraaios-Mcp-Key: env:CARAAIOS_MCP_TOKEN'

tunnel-client init --sample sample_mcp_remote_no_auth --profile caraaios --tunnel-id $env:CARAAIOS_TUNNEL_ID --mcp-server-url http://127.0.0.1:3100/mcp
tunnel-client doctor --profile caraaios --explain
tunnel-client run --profile caraaios
```

`MCP_EXTRA_HEADERS` et `MCP_DISCOVERY_EXTRA_HEADERS` injectent le jeton **dans la requête locale envoyée au CRM**, y compris pendant la découverte. Leur syntaxe `env:...` est documentée dans la [configuration officielle de tunnel-client](https://github.com/openai/tunnel-client/blob/master/docs/configuration.md#mcp-server). Ne mettez pas la valeur du jeton dans la commande ou le profil.

3. Dans ChatGPT, activer **Settings → Security and login → Developer mode**. Ouvrir [Plugins](https://chatgpt.com/plugins), cliquer sur **+**, créer une application de développement, choisir **Connection → Tunnel**, sélectionner le tunnel ou saisir le `tunnel_id`, puis vérifier les outils détectés. Ouvrir un nouveau chat et sélectionner cette connexion dans le menu des outils. La [procédure officielle ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt) décrit cet écran.

Si ChatGPT ne voit pas le tunnel, contrôler son association à l'espace ChatGPT, le droit **Tunnels Use**, puis la sortie de `tunnel-client doctor`. Le client doit rester actif pendant les appels. Secure MCP Tunnel sert aux connexions privées et aux tests en mode développeur ; une publication publique de plugin exige une URL HTTPS stable.

## Exemple de demande ChatGPT

> Analyse la vidéo `PROSPECTION_KACTUS.mp4` pour la société Kactus. Identifie toutes les personnes visibles et sépare employés actuels, anciens employés, investisseurs, board et profils incertains. Garde les intitulés observés tels quels et marque séparément toute inférence sur l'organisation ou les rôles d'achat. Recherche d'abord Kactus dans Caraaios. Prévisualise l'import complet avec `crm_import_company_map` en `dry_run`, montre-moi les conflits, puis importe les entrées non ambiguës dans la cartographie. Relis ensuite `crm_get_company_map` avec `include_evidence: true`, vérifie les sources et propose, comme hypothèses, les champions et sponsors possibles pour l'ICP Partenariats.

## Dépannage

| Symptôme | Contrôle |
| --- | --- |
| `401` dès la liste des outils | Vérifier que `CARAAIOS_MCP_TOKEN` est défini côté CRM et que le client envoie exactement le même jeton. |
| `503` sur `/mcp` | Fournir au serveur un `CARAAIOS_MCP_TOKEN` d'au moins 32 caractères, puis le redémarrer. |
| Codex ne voit pas le serveur | Vérifier `codex mcp list`, le port effectif et la présence du jeton dans l'environnement du processus Codex ; relancer Codex après la configuration. |
| Import visible dans MCP mais pas dans l'interface | Vérifier le chemin absolu `PROSPECTS_CRM_DB_PATH` et que l'interface et `/mcp` ciblent le même processus ou fichier SQLite. |
| Un profil ressort en conflit | Contrôler LinkedIn, courriel et identité ; ne pas fusionner sur le seul nom. |
| Tunnel absent dans ChatGPT | Vérifier l'association à l'espace ChatGPT et les droits Tunnels Read + Use. |
| Tunnel connecté, appel impossible | Lancer `tunnel-client doctor --profile caraaios --explain`, garder `tunnel-client run` actif, vérifier le serveur local et les en-têtes d'authentification. |

Sources : [spécification MCP actuelle](https://blog.modelcontextprotocol.io/posts/2026-07-28/), [SDK TypeScript v2 et double compatibilité](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions), [configuration Codex MCP](https://learn.chatgpt.com/docs/extend/mcp), [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels), [connexion ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt).
