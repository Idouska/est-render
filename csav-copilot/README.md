# cSAV Copilot

SAV automatisé pour marchands Shopify. L'IA lit les mails entrants, les enrichit
avec les données de commande Shopify et prépare une réponse ; le marchand relit
et envoie depuis un dashboard.

**État : squelette Phase 1 (WISMO en brouillon).** L'ingestion, la
classification, le rattachement de commande, la génération et la création du
brouillon Gmail sont implémentés et vérifiés par `tsc` et les tests unitaires.
Le dashboard React et le cron ne sont pas écrits — voir
[docs/07-roadmap.md](docs/07-roadmap.md).

Aucune réponse ne part automatiquement : la phase 1 ne produit que des
brouillons Gmail.

## Démarrer

```bash
npm install
cp .env.example .env          # puis remplir
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # ENCRYPTION_KEY

npm run db:generate
npx prisma migrate dev --name init

npm run dev:api               # API + webhooks, port 3000
npm run dev:worker            # workers d'ingestion et de traitement
```

Vérifications :

```bash
npm run typecheck
npm test
```

## Structure

```
src/
  config/env.ts             validation de la configuration au démarrage
  lib/                      chiffrement, session signée, audit, logger, Prisma
  plugins/auth.ts           garde-fou d'isolation multi-tenant
  routes/
    auth.shopify.ts         OAuth Shopify (state + HMAC)
    auth.google.ts          OAuth Google + activation du watch Gmail
    webhooks.gmail.ts       push Pub/Sub (JWT vérifié) + désinstallation Shopify
    tickets.ts              file, détail, indicateurs, édition et envoi de brouillon
    refunds.ts              aperçu + remboursement confirmé
  services/
    gmail/                  client, parsing, sync incrémentale, brouillons, watch
    shopify/                client GraphQL, commandes, remboursements
    ai/                     classification et rédaction (API Claude)
    matching/orderMatcher   rattachement mail ↔ commande
    tickets/                ingestion et traitement de bout en bout
  queue/                    files BullMQ
  server.ts / index.ts      API
  worker.ts                 workers
prisma/schema.prisma        modèle multi-tenant
docs/                       architecture, OAuth, ingestion, IA, remboursement, RGPD, roadmap
tests/                      logique pure : matcher, parsing Gmail, chiffrement
```

## Trois invariants

Ils sont tenus par le code, pas seulement par l'interface :

1. **Isolation tenant** — le `merchantId` d'une requête vient de la session
   signée, jamais du corps ni de l'URL.
2. **Pas de rattachement deviné** — si plusieurs commandes correspondent, ou
   aucune, le brouillon demande une précision au client et le ticket part en
   relecture. La confiance est plafonnée à 0.5 sans commande rattachée, quel
   que soit l'avis du modèle.
3. **Pas de remboursement en un clic** — deux appels, jeton de confirmation
   signé, audit écrit avant l'appel Shopify, `requestedByUserId` obligatoire.

## Points de vigilance

- **Vérification OAuth Google** : `gmail.readonly` et `gmail.send` sont des
  scopes restreints. Audit CASA obligatoire avant ouverture publique, 6 à
  10 semaines. À lancer en phase 1, c'est le chemin critique de la phase 3.
- **Scope Shopify** : `write_refunds` n'existe pas ; le remboursement exige
  `write_orders`, plus large. D'où le verrouillage applicatif du bouton.
- **Watch Gmail** : expire à 7 jours, en silence. Le cron de renouvellement
  reste à écrire — c'est le mode de panne le plus discret de l'intégration.
