# RGPD

## Rôles

Le marchand est **responsable de traitement** : ce sont ses clients, ses mails.
cSAV Copilot est **sous-traitant** au sens de l'article 28. Il faut donc un
contrat de sous-traitance (DPA) signé à l'installation, pas seulement des CGU.

Anthropic est sous-traitant ultérieur : à déclarer nommément dans le DPA, avec
son rôle (classification et rédaction), sa localisation et le fait que les
données ne sont pas utilisées pour l'entraînement.

## Base légale

Intérêt légitime (art. 6.1.f) : traiter les demandes SAV entrantes est attendu
par le client qui écrit. Cette base doit être **documentée par une analyse de
balance des intérêts** (LIA) fournie clé en main aux marchands, sans quoi ils
ne peuvent pas justifier le traitement en cas de contrôle.

L'alternative « exécution du contrat » (art. 6.1.b) est plus fragile : elle ne
couvre pas les mails de clients sans commande.

## Données traitées

| Donnée | Origine | Finalité |
|---|---|---|
| Adresse email, nom | En-têtes Gmail | Identification du client, rattachement commande |
| Corps du mail | Gmail | Classification et rédaction |
| Commande, montant, adresse de livraison | Shopify | Contexte de réponse |
| Historique d'achat (ancienneté, total dépensé) | Shopify | Contexte de réponse |

Aucune donnée sensible au sens de l'article 9 n'est recherchée. Un client peut
toutefois en écrire spontanément dans un mail (santé, par exemple) : le
minimum est de ne pas les indexer et de les faire disparaître avec le message.

## Conservation

`Merchant.retentionDays` (défaut 365). Une purge quotidienne doit supprimer les
`Message` et `Draft` plus anciens, et anonymiser les `Ticket` correspondants
(email et nom remplacés, statistiques conservées).

Les `AuditLog` sont conservés plus longtemps — ils tracent des actions
financières et relèvent d'une obligation comptable, pas du même régime.

> **À implémenter.** `src/cron.ts` n'est pas encore écrit : la purge et le
> renouvellement des watch Gmail sont les deux tâches qu'il doit porter.
> Sans elles, la promesse de conservation n'est pas tenue.

## Droits des personnes

Le client final exerce ses droits auprès du marchand, qui les répercute :

| Droit | Mise en œuvre |
|---|---|
| Accès / portabilité | Export des tickets d'une adresse email — **à implémenter** |
| Effacement | Suppression des tickets et messages d'une adresse — **à implémenter** |
| Opposition | Exclusion d'une adresse du traitement automatique — **à implémenter** |

Le marchand, lui, dispose déjà de :

- `POST /auth/google/disconnect` — coupure de l'accès Gmail,
- désinstallation Shopify → statut `UNINSTALLED`, ingestion arrêtée.

La suppression complète des données d'un marchand après désinstallation
(obligation Shopify : webhooks `shop/redact` et `customers/redact` sous 48 h)
reste **à implémenter** — c'est un prérequis à la validation de l'app publique
par Shopify, au même titre que la vérification Google l'est côté Gmail.

## Mesures techniques

Déjà en place :

- tokens OAuth chiffrés en AES-256-GCM, clé hors base (`ENCRYPTION_KEY`) ;
- corps de mails exclus des logs (`redact` dans `lib/logger.ts`) ;
- isolation stricte par `merchantId`, jamais accepté depuis une requête client ;
- journal d'audit horodaté et non modifiable par l'application.

À prévoir : chiffrement au repos du disque PostgreSQL, rotation de
`ENCRYPTION_KEY` (le préfixe `v1:` des payloads existe pour ça), et
sous-traitance hébergement en UE pour éviter un transfert hors UE non couvert.
