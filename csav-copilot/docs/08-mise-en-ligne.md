# Mise en ligne

Guide pas à pas, de zéro à une application accessible sur Internet et branchée
sur une vraie boutique.

Comptez **une demi-journée** pour arriver à une application en ligne qui traite
les mails d'une boutique de test. L'ouverture au grand public demande en plus
la vérification Google (6 à 10 semaines) et la validation Shopify — voir la
dernière section.

## Ce qu'il faut créer

| Où | Quoi | Coût |
|---|---|---|
| console.anthropic.com | Une clé API | à l'usage, ~0,05 $ par ticket traité |
| partners.shopify.com | Une application publique | gratuit |
| console.cloud.google.com | Identifiants OAuth + topic Pub/Sub | gratuit à ce volume |
| render.com | L'hébergement | quelques dizaines d'euros par mois |

Sur l'hébergement : le projet a besoin de quatre briques — un service web, un
service de fond (les workers), une base PostgreSQL et un Redis. Sur Render, la
somme des offres d'entrée de gamme se situe autour de 30 à 40 $ par mois.
Vérifiez les tarifs en vigueur, ils bougent.

Render n'a rien d'obligatoire : le `Dockerfile` fonctionne sur n'importe quel
hébergeur qui sait lancer un conteneur (Fly.io, Railway, Scaleway, un VPS avec
Docker Compose). Le fichier `render.yaml` fourni est un raccourci, pas une
dépendance.

---

## Étape 1 — Clé Anthropic

1. Créez un compte sur **console.anthropic.com**.
2. Ajoutez un moyen de paiement, puis créez une clé API.
3. Gardez-la de côté : ce sera `ANTHROPIC_API_KEY`.

C'est la seule des trois intégrations qui se règle en deux minutes.

---

## Étape 2 — Application Shopify

1. Créez un compte sur **partners.shopify.com** (gratuit, distinct d'un compte
   marchand).
2. **Apps → Create app → Create app manually**. Nommez-la, par exemple
   « cSAV Copilot ».
3. Notez le **Client ID** et le **Client secret** : ce seront
   `SHOPIFY_API_KEY` et `SHOPIFY_API_SECRET`.
4. Laissez les URL de redirection de côté pour l'instant : vous ne connaîtrez
   l'adresse de l'application qu'après le déploiement (étape 5).
5. Créez aussi une **boutique de développement** (Stores → Add store →
   Development store). Elle est gratuite, et c'est sur elle que vous testerez.
   Ajoutez-lui deux ou trois produits et passez une commande de test, sinon il
   n'y aura rien à rattacher.

---

## Étape 3 — Google Cloud

L'étape la plus longue. Deux choses à configurer : l'accès OAuth à Gmail, et le
canal de notification qui prévient l'application qu'un mail est arrivé.

### 3a. Projet et API

1. Sur **console.cloud.google.com**, créez un projet.
2. **APIs & Services → Library** : activez **Gmail API** et **Cloud Pub/Sub API**.

### 3b. Écran de consentement OAuth

1. **APIs & Services → OAuth consent screen**, type **External**.
2. Renseignez le nom de l'application, votre email de contact, et les liens vers
   votre politique de confidentialité et vos conditions d'utilisation. Ces deux
   pages doivent exister et être en ligne : Google les vérifie.
3. Ajoutez les trois scopes :
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.compose`
   - `https://www.googleapis.com/auth/gmail.send`
4. Restez en mode **Testing** et ajoutez votre propre adresse Gmail comme
   utilisateur de test. Ce mode plafonne à 100 utilisateurs — largement assez
   pour la phase pilote, et il évite d'attendre la vérification pour commencer.

### 3c. Identifiants OAuth

**Credentials → Create credentials → OAuth client ID → Web application**.
Vous obtenez `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET`. L'URL de redirection
sera ajoutée à l'étape 5.

### 3d. Pub/Sub

1. **Pub/Sub → Topics → Create topic**, nommé par exemple `gmail-notifications`.
   Son nom complet (`projects/VOTRE-PROJET/topics/gmail-notifications`) sera
   `GOOGLE_PUBSUB_TOPIC`.
2. Sur ce topic, **Permissions → Add principal** :
   - principal : `gmail-api-push@system.gserviceaccount.com`
   - rôle : **Pub/Sub Publisher**

   Sans cette autorisation, l'activation de l'écoute Gmail échoue avec une
   erreur peu explicite. C'est l'oubli le plus fréquent.
3. Créez un **compte de service** (IAM → Service accounts), par exemple
   `gmail-push`. Son adresse sera `GOOGLE_PUBSUB_SERVICE_ACCOUNT`.
4. La souscription push sera créée à l'étape 5, quand l'URL existera.

---

## Étape 4 — Déployer

1. Poussez le projet sur un dépôt GitHub auquel Render a accès.
2. Sur **render.com** : **New → Blueprint**, sélectionnez le dépôt. Render lit
   `render.yaml` et propose de créer les quatre services d'un coup.
3. Render demandera les valeurs marquées comme secrètes. Renseignez :
   `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, `GOOGLE_PUBSUB_TOPIC`,
   `GOOGLE_PUBSUB_SERVICE_ACCOUNT`, `ANTHROPIC_API_KEY`.
   Laissez `APP_URL` vide pour l'instant.
4. `ENCRYPTION_KEY` est générée automatiquement par Render, et recopiée dans les
   workers et le cron. **Ne la changez jamais après coup** : elle déchiffre les
   tokens Shopify et Google déjà en base. La modifier revient à déconnecter
   tous les marchands.
5. Lancez le déploiement. Les migrations de base s'appliquent automatiquement
   avant la mise en service (`preDeployCommand`).

Quand le service web est vert, Render affiche son adresse, du type
`https://csav-api.onrender.com`.

> **Si vous n'utilisez pas Render** : le `Dockerfile` construit une image unique
> pour les trois processus. Lancez `node dist/index.js` pour l'API,
> `node dist/worker.js` pour les workers, `node dist/cron.js` une fois par jour.
> Appliquez `npx prisma migrate deploy` à chaque déploiement, avant de basculer
> le trafic.

---

## Étape 5 — Reboucler les URL

Maintenant que l'adresse existe, il faut la déclarer partout. Remplacez
`https://votre-app.onrender.com` par la vôtre.

**Sur Render**, service `csav-api` → Environment :

```
APP_URL = https://votre-app.onrender.com
```

Redéployez pour que la valeur soit prise en compte. Elle se propage aux workers
et au cron.

**Sur Shopify Partners**, dans la configuration de l'app :

- App URL : `https://votre-app.onrender.com/dashboard`
- Allowed redirection URL : `https://votre-app.onrender.com/auth/shopify/callback`
- Webhook de désinstallation : sujet `app/uninstalled`, URL
  `https://votre-app.onrender.com/webhooks/shopify/app-uninstalled`, format JSON.

**Sur Google Cloud**, dans l'identifiant OAuth :

- Authorized redirect URI : `https://votre-app.onrender.com/auth/google/callback`

**Sur Google Cloud**, Pub/Sub → votre topic → **Create subscription** :

- Type : **Push**
- Endpoint URL : `https://votre-app.onrender.com/webhooks/gmail`
- Cochez **Enable authentication**, choisissez le compte de service créé plus tôt
- Audience : `https://votre-app.onrender.com/webhooks/gmail`

L'application vérifie l'émetteur et l'audience du jeton à chaque notification.
Si l'audience ne correspond pas exactement, les notifications sont rejetées en
401 — c'est voulu, mais c'est aussi une source classique de confusion.

---

## Étape 6 — Installer sur la boutique de test

Ouvrez dans votre navigateur :

```
https://votre-app.onrender.com/auth/shopify?shop=votre-boutique-test.myshopify.com
```

Le parcours enchaîne : autorisation Shopify → autorisation Google → dashboard.

Envoyez ensuite un mail à l'adresse Gmail connectée, depuis l'adresse d'un
client ayant passé une commande de test, avec un objet du genre « Où en est ma
commande #1001 ? ». Dans la minute, le ticket doit apparaître dans la file avec
son brouillon.

### Si rien n'arrive

Dans l'ordre, sur les journaux Render :

1. **Service web** — voyez-vous une ligne pour `POST /webhooks/gmail` ? Non :
   le problème vient de la souscription Pub/Sub. Un 401 : l'audience ne
   correspond pas.
2. **Worker** — le job d'ingestion s'exécute-t-il ? Une erreur Shopify ou
   Anthropic apparaîtra ici.
3. **Dashboard** — la pastille en haut à droite indique « écoute inactive » si
   le watch Gmail n'est pas actif.

Le mail que vous envoyez ne doit pas venir de l'adresse connectée elle-même :
l'application ignore ses propres messages, sinon elle se répondrait en boucle.

---

## Avant d'ouvrir au public

Quatre chantiers, indépendants les uns des autres :

1. **Vérification Google** — obligatoire pour dépasser 100 utilisateurs. Les
   scopes Gmail sont classés sensibles, ce qui implique un audit de sécurité
   par un cabinet agréé (CASA). Comptez 6 à 10 semaines et un coût d'audit.
   C'est le chemin critique : lancez la demande dès que l'application tourne.
2. **Validation Shopify** — pour figurer sur l'App Store. Exige notamment les
   webhooks de confidentialité `customers/redact`, `shop/redact` et
   `customers/data_request`, qui ne sont **pas encore implémentés**.
3. **Facturation** — Shopify Billing API, pour encaisser sans monter un système
   de paiement séparé.
4. **Contrat de sous-traitance** — le marchand est responsable de traitement,
   vous êtes sous-traitant. Voir [06-rgpd.md](06-rgpd.md).

---

## Points de vigilance en production

- **`ENCRYPTION_KEY` est irremplaçable.** Sauvegardez-la hors de Render. Sans
  elle, les tokens en base sont illisibles et tous les marchands doivent
  reconnecter leurs comptes.
- **Le cron n'est pas optionnel.** Le watch Gmail expire au bout de 7 jours sans
  produire la moindre erreur : l'ingestion s'arrête et rien ne le signale.
  Vérifiez que le job `csav-cron` s'exécute bien tous les jours.
- **Ne mettez jamais `SHOPIFY_MOCK` ou `GMAIL_MOCK` à 1 en production** :
  l'application refuse de démarrer, c'est délibéré.
- **Surveillez la file Redis.** Si les jobs s'accumulent, c'est que les workers
  sont tombés ou que l'API Claude répond en erreur.
- **Le plan gratuit de Render met les services en veille** après inactivité. Un
  service web endormi ne répond pas assez vite à Pub/Sub, qui abandonne la
  notification. Prenez un plan payant pour l'API et le worker.
