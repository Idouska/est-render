# Ingestion des mails

## Pub/Sub push

Mise en place côté Google Cloud :

1. Créer un topic `gmail-notifications`.
2. Donner à `gmail-api-push@system.gserviceaccount.com` le rôle
   `roles/pubsub.publisher` sur ce topic — sans ça, `users.watch` échoue.
3. Créer une souscription **push** vers `https://<APP_URL>/webhooks/gmail`,
   avec authentification par compte de service et audience égale à cette URL.
4. Renseigner `GOOGLE_PUBSUB_TOPIC` et `GOOGLE_PUBSUB_SERVICE_ACCOUNT`.

L'endpoint vérifie le JWT OIDC (émetteur + audience) avant tout traitement.
Sans cette vérification, l'endpoint est ouvert : n'importe qui pourrait
déclencher des ingestions au nom d'un marchand.

## Le watch expire

`users.watch` vaut **7 jours**. `services/gmail/watch.ts` expose
`renewExpiringWatches()`, à appeler par un cron quotidien : il renouvelle tout
watch expirant dans moins de 24 h. Un watch expiré = ingestion silencieusement
arrêtée, sans erreur nulle part. C'est le mode de panne le plus vicieux de
cette intégration ; il mérite une alerte de supervision, pas seulement un cron.

## Curseur et repli

`fetchNewMessages` utilise `history.list` depuis `lastHistoryId`. Gmail purge
l'historique au-delà d'environ une semaine et répond alors **404** : on retombe
sur `messages.list` avec `q: 'in:inbox newer_than:2d'`, ce qui est aussi le
fallback polling prévu au brief. Le même code sert donc les deux chemins.

## Idempotence

Pub/Sub garantit une livraison *at-least-once* : le même mail est régulièrement
notifié plusieurs fois. Trois garde-fous se cumulent :

1. `enqueueIngest` utilise un `jobId` par marchand et par tranche de 5 secondes,
   ce qui absorbe les rafales de notifications.
2. `fetchNewMessages` interroge la base avant de re-télécharger un message.
3. La contrainte d'unicité `(merchantId, gmailMessageId)` est le filet final :
   une violation `P2002` est traitée comme un doublon et ignorée.

## Ce qui est ignoré

- Les messages envoyés par le marchand lui-même (`from` = adresse connectée).
- Les libellés `DRAFT` et `SENT` — sans quoi nos propres brouillons
  déclencheraient un nouveau cycle de traitement, en boucle.

## Fil et citations

Un ticket = un fil Gmail (`threadId`). Un nouveau message sur un fil déjà clos
rouvre le ticket en statut `NEW`.

`stripQuotedText` retire les citations (`>`, « Le … a écrit : », « On … wrote: »,
signatures) avant stockage. Sans ça, chaque nouveau tour ré-injecterait tout
l'historique dans le prompt de classification, ce qui fait dériver l'intention
détectée et gonfle le coût à chaque échange.
