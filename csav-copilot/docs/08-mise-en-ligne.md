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
hébergeur qui sait lancer un conteneur (Fly.io, Railway, Scaleway, Clever Cloud,
un VPS avec Docker Compose). Le fichier `render.yaml` fourni est un raccourci,
pas une dépendance.

### Où héberger, et pourquoi ça compte

L'application stocke des mails de clients : des données personnelles au sens du
RGPD. Le lieu de stockage n'est donc pas un détail technique, il détermine ce
que vous devrez écrire dans le contrat de sous-traitance signé avec chaque
marchand.

| Option | Données | Effort |
|---|---|---|
| **Render, région Frankfurt** | Union européenne, éditeur américain | Le plus simple : `render.yaml` fait tout |
| **Scaleway ou Clever Cloud** | France, éditeur français | Un peu plus de configuration, meilleur argument commercial |
| **VPS (OVH, Hetzner, Scaleway)** | France ou Allemagne | Le moins cher, mais base, sauvegardes et mises à jour à votre charge |

`render.yaml` fixe `region: frankfurt` sur les cinq composants. **Sans ce champ,
Render déploie en Oregon** et les mails de vos clients français partent aux
États-Unis. Si vous changez d'avis, changez-le partout : services et base
doivent partager la même région pour se voir sur le réseau privé.

Un hébergeur français (Scaleway, Clever Cloud, OVH) simplifie encore le
discours : « vos données restent en France » se vend mieux auprès d'un marchand
que « elles restent en Europe chez un prestataire américain ». C'est un
argument commercial autant que juridique.

> **Un transfert reste inévitable, quel que soit l'hébergeur.** Le contenu des
> mails part chez Anthropic pour être classé et rédigé. C'est un sous-traitant
> ultérieur situé hors de l'Union : il doit être nommé dans votre contrat de
> sous-traitance, avec les garanties contractuelles associées. Héberger en
> France ne dispense pas de le déclarer — voir [06-rgpd.md](06-rgpd.md).

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
4. Restez en mode **Testing** et ajoutez l'adresse Gmail de test comme
   utilisateur autorisé. Ce mode plafonne à 100 utilisateurs — largement assez
   pour la phase pilote, et il évite d'attendre la vérification pour commencer.

> ⚠️ **En mode Testing, les refresh tokens Google expirent au bout de 7 jours.**
> Passé ce délai, l'application perd l'accès à la boîte connectée et
> l'ingestion s'arrête, sans que rien ne l'annonce autrement que par des
> erreurs d'authentification dans les journaux. Ce n'est pas un bug du projet :
> c'est une limite du mode test de Google.
>
> Pendant la phase de test, il suffit de repasser par
> `/auth/google` pour reconnecter la boîte. Cette expiration disparaît une fois
> l'application vérifiée (publiée en **In production**).

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

> **Alternative pour la seule phase de test : un tunnel vers votre machine.**
>
> Shopify et Google exigent une adresse HTTPS publique, mais celle-ci peut
> pointer vers votre ordinateur plutôt que vers un hébergeur :
>
> ```bash
> cloudflared tunnel --url http://localhost:3000    # ou : ngrok http 3000
> ```
>
> Vous obtenez une URL du type `https://xxx.trycloudflare.com` à utiliser comme
> `APP_URL` partout où le guide dit « votre adresse ». Vous ne payez rien
> pendant les essais, et vous voyez les journaux en direct dans votre terminal.
>
> Deux limites : l'URL change à chaque redémarrage du tunnel — il faut alors la
> remettre à jour chez Shopify **et** chez Google, ce qui est vite fastidieux —
> et rien ne tourne quand votre machine est éteinte. Pour un aller-retour rapide
> c'est confortable ; dès que le test s'étale sur plusieurs jours, déployez.
>
> N'oubliez pas de lancer aussi `npm run dev:worker` : sans les workers, les
> mails entrent en base mais ne sont ni classés ni rédigés.

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

## Étape 6 — Préparer le jeu de test

L'application ne peut rattacher un mail à une commande que si les données
existent. Une boutique de développement vide donnera systématiquement
« aucune commande rattachée » — ce qui est le bon comportement, mais ne teste
rien d'intéressant.

Il vous faut **trois adresses email distinctes** :

| Rôle | Exemple | Usage |
|---|---|---|
| Boîte SAV | `sav.test@gmail.com` | Celle que vous connectez à l'application |
| Client A | `client.a@gmail.com` | Email du client sur les commandes de test, et expéditeur des mails |
| Client B | `client.b@gmail.com` | Pour tester le cas ambigu (plusieurs commandes) |

Seule la boîte SAV doit être un compte **Gmail** (c'est elle qu'on connecte).
Les deux adresses client peuvent être n'importe quelles adresses depuis
lesquelles vous savez envoyer un mail : une perso, un autre fournisseur, peu
importe. Évitez en revanche les alias en `+` : Gmail sait les recevoir mais pas
envoyer depuis, et ici vous devez envoyer.

Ce qui compte : **l'adresse d'expédition du mail de test doit être exactement
celle enregistrée comme email client sur la commande Shopify.** C'est sur cette
égalité que repose le rattachement.

Enfin, n'envoyez jamais le mail de test depuis la boîte SAV elle-même :
l'application ignore ses propres messages, sinon elle se répondrait en boucle.

### Monter la boutique de test

1. **Activer les paiements de test.** Boutique → *Settings → Payments →
   (Bogus Gateway / passerelle de test)*. Sans paiement enregistré, la commande
   n'a aucune transaction remboursable et le bouton rembourser renverra
   « aucune transaction remboursable ».
2. **Créer deux ou trois produits** avec des noms reconnaissables.
3. **Passer les commandes de test depuis la vitrine**, en payant avec la carte
   de test (numéro `1`, date future, CVV `111`). À la caisse, saisissez comme
   email client **`client.a@gmail.com`** — c'est cette adresse qui permettra le
   rattachement.
4. **Ajouter un suivi sur une commande.** *Orders → la commande → Fulfill item*,
   puis renseignez un transporteur et un numéro de suivi. Sans ça, le brouillon
   WISMO n'a rien à annoncer et se contentera de dire que la commande n'est pas
   encore expédiée.
5. **Pour le cas ambigu** : passez **trois commandes** avec l'adresse
   `client.b@gmail.com`.

### Installer

```
https://votre-app.onrender.com/auth/shopify?shop=votre-boutique-test.myshopify.com
```

Le parcours enchaîne : autorisation Shopify → autorisation Google → dashboard.

### Les trois mails à envoyer

Envoyez-les **à** la boîte SAV connectée, **depuis** l'adresse client concernée.

| Depuis | Objet / contenu | Ce que ça doit produire |
|---|---|---|
| `client.a@…` | « Où en est ma commande #1001 ? » (mettez le vrai numéro) | Rattachement direct par le numéro cité, confiance élevée, brouillon citant le transporteur et le suivi |
| `client.a@…` | « Bonjour, je n'ai toujours rien reçu, pouvez-vous m'aider ? » | Rattachement par l'adresse email — une seule commande, donc pas d'ambiguïté |
| `client.b@…` | Le même message, sans numéro | **Trois commandes correspondent** : le brouillon doit demander une précision, et la colonne de droite doit proposer de rattacher à la main |

Le troisième est le plus important : c'est le comportement sur lequel repose la
confiance dans l'outil. S'il choisit une commande au lieu de demander, il y a un
problème.

Comptez une à deux minutes entre l'envoi et l'apparition du ticket : Gmail
notifie, la file traite, l'API Claude répond.

### Si rien n'arrive

Dans l'ordre, sur les journaux Render :

1. **Service web** — voyez-vous une ligne pour `POST /webhooks/gmail` ? Non :
   le problème vient de la souscription Pub/Sub. Un 401 : l'audience ne
   correspond pas.
2. **Worker** — le job d'ingestion s'exécute-t-il ? Une erreur Shopify ou
   Anthropic apparaîtra ici.
3. **Dashboard** — la pastille en haut à droite indique « écoute inactive » si
   le watch Gmail n'est pas actif.

Trois causes reviennent le plus souvent :

- **Le mail vient de la boîte connectée elle-même.** L'application ignore ses
  propres messages, sinon elle se répondrait en boucle.
- **Ça marchait, et ça s'est arrêté au bout d'une semaine.** C'est l'expiration
  des refresh tokens en mode Testing chez Google (voir étape 3b). Repassez par
  `/auth/google` pour reconnecter la boîte.
- **Le ticket apparaît mais sans commande.** L'adresse d'expédition ne
  correspond pas à l'email client de la commande Shopify. Vérifiez-la dans
  *Orders → la commande → Contact information*.

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
