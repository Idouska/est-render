# cSAV Copilot

SAV automatisé pour marchands Shopify. L'IA lit les mails entrants, les enrichit
avec les données de commande Shopify et prépare une réponse ; le marchand relit
et envoie depuis un dashboard.

Aucune réponse ne part automatiquement : la phase 1 ne produit que des
brouillons, validés par un humain.

---

## Voir sans rien installer

`npm run build:demo` produit **`demo/csav-demo.html`** : un fichier unique,
ouvrable dans n'importe quel navigateur, envoyable par mail. C'est l'interface
réelle — mêmes fichiers `public/`, même code — avec un faux serveur en mémoire
à la place de l'API. Aucun mail lu ni envoyé, aucun euro déplacé.

Pratique pour montrer le produit à un marchand pilote avant d'avoir déployé
quoi que ce soit. À régénérer après toute modification de l'interface.

## Voir tourner en 3 commandes

Prérequis : **Node.js 22+** et **Docker** (pour la base de données).

```bash
docker compose up -d      # PostgreSQL + Redis
npm install
cp .env.example .env      # SHOPIFY_MOCK=1 et GMAIL_MOCK=1 sont déjà activés
```

Générez la clé de chiffrement et collez-la dans `.env` à la ligne `ENCRYPTION_KEY=` :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Puis :

```bash
npx prisma migrate deploy   # crée les tables
npm run db:seed             # boutique de démonstration + 6 tickets
npm run dev:api             # démarre l'application
```

Ouvrez **http://localhost:3000/dev/login** — le dashboard s'affiche avec une
session de démonstration.

En mode démonstration, Shopify et Gmail sont simulés : les commandes, clients et
livraisons sont fictifs, aucun mail n'est lu ni envoyé, aucun remboursement
n'est réellement exécuté. **Tout le reste est vrai** : la base de données, la
file de tickets, le rattachement de commande, l'édition de brouillon, le
journal d'audit et les garde-fous du remboursement.

`npm run db:reset` remet la démonstration à zéro.

### Ce qu'il faut regarder

| Ticket | Ce qu'il démontre |
|---|---|
| **Léa Fontaine** | Cas nominal : commande identifiée par le numéro cité, suivi et ETA remontés de Shopify dans le brouillon |
| **Julien Meyer** | Trois commandes correspondent à son adresse. L'IA refuse de choisir : elle demande une précision, et vous propose de rattacher vous-même |
| **Amélie Rousseau** | Remboursement : bouton → modale obligatoire → confiance explicite → journal d'audit |
| **Thomas Girard** | Un remerciement ne déclenche aucune réponse automatique |

---

## Fournisseur d'IA

Anthropic par défaut. DeepSeek est supporté comme alternative moins chère, avec
une réserve importante : DeepSeek traite les mails en Chine, ce qui a des
implications RGPD à documenter dans votre contrat de sous-traitance. Détails
et comparatif : **[docs/09-fournisseur-ia.md](docs/09-fournisseur-ia.md)**.

```bash
AI_PROVIDER=deepseek   # ou anthropic (par défaut)
DEEPSEEK_API_KEY=sk-...
```

## Mettre en ligne

Guide complet pas à pas : **[docs/08-mise-en-ligne.md](docs/08-mise-en-ligne.md)**
— création des comptes Shopify Partners, Google Cloud et Anthropic, déploiement,
puis branchement sur une vraie boutique. Comptez une demi-journée.

Le projet se déploie en trois processus qui partagent la même image Docker :

| Processus | Commande | Rôle |
|---|---|---|
| API | `node dist/index.js` | Dashboard, OAuth, webhooks, API |
| Workers | `node dist/worker.js` | Ingestion, classification, rédaction |
| Cron | `node dist/cron.js` | Renouvellement du watch Gmail, purge RGPD |

`render.yaml` crée les quatre services d'un coup sur Render (API, workers, cron,
plus PostgreSQL et Redis). Le `Dockerfile` fonctionne sur n'importe quel
hébergeur de conteneurs.

**Le cron n'est pas optionnel** : le watch Gmail expire au bout de 7 jours sans
lever d'erreur. Sans lui, l'ingestion s'arrête en silence.

**Délai à anticiper** : Google exige un audit de sécurité (CASA) avant
d'autoriser une application à lire les Gmail de vrais clients — 6 à 10 semaines.
À lancer dès que l'application tourne, c'est le chemin critique.

---

## Structure

```
public/                     dashboard (HTML/CSS/JS servis par l'API, sans build)
src/
  config/env.ts             validation de la configuration au démarrage
  lib/                      chiffrement, session signée, audit, logger, Prisma
  plugins/auth.ts           garde-fou d'isolation multi-tenant
  routes/
    auth.shopify.ts         OAuth Shopify (state + HMAC)
    auth.google.ts          OAuth Google + activation du watch Gmail
    webhooks.gmail.ts       push Pub/Sub (JWT vérifié) + désinstallation Shopify
    tickets.ts              file, détail, indicateurs, rattachement, brouillons
    refunds.ts              aperçu + remboursement confirmé
    dev.ts                  connexion de développement (jamais en production)
  services/
    gmail/                  client, parsing, sync incrémentale, brouillons, watch
    shopify/                client GraphQL, commandes, remboursements, simulation
    ai/                     classification et rédaction (API Claude)
    matching/orderMatcher   rattachement mail ↔ commande
    tickets/                ingestion et traitement de bout en bout
  queue/                    files BullMQ
  server.ts / index.ts      API + dashboard
  worker.ts                 workers
prisma/                     schéma multi-tenant, migration, données de démo
docs/                       architecture, OAuth, ingestion, IA, remboursement, RGPD, roadmap
tests/                      logique pure : matcher, parsing Gmail, chiffrement
```

Le dashboard est une page unique servie par l'API : pas de second serveur à
lancer, pas d'étape de build, pas de CORS. Il consomme les mêmes endpoints
`/api/*` qu'un futur front React, qui pourra le remplacer sans toucher au
backend.

## Vérifications

```bash
npm run typecheck
npm test
```

## Trois invariants

Tenus par le code, pas seulement par l'interface :

1. **Isolation tenant** — le `merchantId` d'une requête vient de la session
   signée, jamais du corps ni de l'URL.
2. **Pas de rattachement deviné** — si plusieurs commandes correspondent, ou
   aucune, le brouillon demande une précision et le ticket part en relecture.
   La confiance est plafonnée à 0,5 sans commande rattachée, quel que soit
   l'avis du modèle.
3. **Pas de remboursement en un clic** — l'aperçu délivre un jeton signé que le
   POST exige ; l'audit est écrit avant l'appel Shopify ; `requestedByUserId`
   est obligatoire en base.

## Ce qui manque encore

Suivi dans [docs/07-roadmap.md](docs/07-roadmap.md). Les trois plus urgents :

- **Webhooks `customers/redact`, `shop/redact`, `customers/data_request`** —
  obligation Shopify pour publier l'application sur l'App Store.
- **Régénérer un brouillon** après rattachement manuel d'une commande : la
  réponse continue sinon de demander une précision déjà obtenue.
- **Supervision** — alerte si un watch Gmail expire ou si la file s'accumule.
  Le cron corrige, mais rien ne prévient encore quand il échoue.
