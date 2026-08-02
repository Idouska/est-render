# Architecture

## Choix de stack

| Décision | Choix | Pourquoi |
|---|---|---|
| Langage | Node.js 22 + TypeScript | SDK Shopify et `googleapis` officiels et bien maintenus, typage partagé avec le futur dashboard React |
| API | Fastify 5 | Léger, hooks natifs pour les preHandler d'isolation tenant, parseur de corps brut nécessaire aux HMAC Shopify |
| Base | PostgreSQL + Prisma | Contraintes d'unicité (idempotence Pub/Sub), transactions, JSON pour les métadonnées d'audit |
| File | BullMQ + Redis | Réessais avec backoff exponentiel, déduplication par `jobId`, concurrence réglable par file |
| IA | API Claude (`claude-opus-5`) | Classification en sortie structurée + génération, un seul fournisseur |

Alternative écartée : Next.js full-stack. Le dashboard et l'ingestion asynchrone
ont des profils d'exécution trop différents (requête courte vs. worker long),
et coupler les deux compliquerait le déploiement des workers.

## Processus

Trois processus indépendants, à déployer séparément :

```
  Shopify ──OAuth──┐
                   ├──▶  API (src/index.ts)  ──▶ PostgreSQL
  Gmail   ──OAuth──┘         │                        ▲
                             │ enqueue                │
  Gmail Pub/Sub ──push──▶    ▼                        │
                          Redis / BullMQ              │
                             │                        │
                             ▼                        │
                       Workers (src/worker.ts) ───────┘
                             │
                             ├──▶ API Claude (classification + rédaction)
                             ├──▶ Shopify Admin GraphQL (commande, client, livraison)
                             └──▶ Gmail API (création du brouillon)

  Cron (src/cron.ts) ──▶ renouvellement des watch Gmail, purge RGPD
```

L'API ne fait **jamais** d'appel Claude ni de lecture Gmail en synchrone : elle
acquitte le webhook Pub/Sub et met en file. Pub/Sub réessaie une notification
non acquittée sous ~10 s, ce qui déclencherait des ingestions concurrentes sur
le même marchand.

## Chemin d'un mail

1. **Notification** — Gmail publie sur Pub/Sub, qui pousse sur `POST /webhooks/gmail`
   avec un JWT OIDC. On vérifie l'émetteur, on résout le marchand par adresse,
   on enfile `gmail-ingest`, on répond 204.
2. **Ingestion** (`services/tickets/ingest.ts`) — `history.list` depuis le
   dernier `historyId`, repli sur `messages.list` si le curseur a expiré.
   Upsert du ticket (1 ticket = 1 fil Gmail), insertion du message.
   L'unicité `(merchantId, gmailMessageId)` rend l'opération idempotente.
3. **Traitement** (`services/tickets/process.ts`) — classification, rattachement
   de commande, génération, création du brouillon Gmail, écriture d'audit.
4. **Validation humaine** — le marchand relit dans le dashboard, édite si besoin
   (`PATCH /api/drafts/:id`), puis envoie (`POST /api/drafts/:id/send`).

## Isolation multi-tenant

Trois règles, appliquées sans exception :

1. Toute table métier porte `merchantId`.
2. Le `merchantId` d'une requête vient de la session signée (`plugins/auth.ts`),
   jamais du corps ni de l'URL. Une route qui accepterait un `merchantId` en
   paramètre serait une faille d'accès horizontal.
3. Les tokens Shopify et Google sont chiffrés en AES-256-GCM (`lib/crypto.ts`)
   et déchiffrés uniquement dans les modules `services/*/client.ts`.

## Points d'extension prévus

- `services/ai/generate.ts` accepte déjà un contexte structuré : le RAG
  post-MVP (embeddings des réponses passées) s'insère comme un champ
  supplémentaire du contexte, sans toucher au reste du pipeline.
- `Merchant.autoSendEnabled` / `autoSendThreshold` existent en base mais ne sont
  pas câblés à un envoi : la phase 1 ne produit que des brouillons.
- `User` et `UserRole` permettent le multi-agent sans migration destructive.
