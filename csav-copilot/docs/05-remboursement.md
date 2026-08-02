# Remboursement

Action financière et irréversible. Trois contraintes non négociables, chacune
appliquée dans le code et pas seulement dans l'interface.

## 1. Jamais en un clic

Le remboursement se fait en deux appels :

```
GET  /api/refunds/preview?orderId=...   → montant remboursable + confirmationToken
POST /api/refunds                        → exige ce confirmationToken
```

Le `confirmationToken` est un HMAC signé côté serveur, lié au marchand, à la
commande et à une fenêtre de 15 minutes (la fenêtre précédente reste acceptée
pour ne pas invalider une modale ouverte juste avant un changement de tranche).

Il n'est délivré que par l'endpoint d'aperçu, donc **il est impossible de
rembourser sans être passé par la modale de confirmation**. Un jeton
simplement dérivé du temps aurait pu être fabriqué côté client : la signature
est ce qui rend la garantie réelle.

## 2. Jamais par l'IA

Aucun worker, aucun chemin automatique n'importe `services/shopify/refunds.ts`.
Le seul appelant est `src/routes/refunds.ts`, derrière `requireSession`.
`Refund.requestedByUserId` est obligatoire en base : un remboursement sans
utilisateur humain identifié ne peut littéralement pas être écrit.

## 3. Toujours tracé

L'audit est écrit **avant** l'appel Shopify, pas après :

| Action | Moment |
|---|---|
| `refund.requested` | Avant l'appel Shopify, avec montant, devise, motif, type |
| `refund.completed` | Après succès, avec l'ID Shopify du remboursement |
| `refund.failed` | Après échec, avec le message d'erreur |

Si le processus meurt entre l'appel Shopify et l'écriture du résultat, on
garde une trace `PENDING` et l'entrée `refund.requested` — un remboursement
orphelin est détectable. L'ordre inverse perdrait l'information.

## Contrôles de montant

- Format `^\d+(\.\d{1,2})?$` — pas de flottant approximatif transitant en JSON.
- Montant relu depuis `suggestedRefund` de Shopify à chaque requête, jamais
  depuis le client : un montant supérieur au remboursable est rejeté en 400.
- `kind` (`FULL` / `PARTIAL`) est déduit côté serveur par comparaison au
  montant remboursable, pas déclaré par le client.
- Stockage en `Decimal(12,2)`, jamais en flottant.

## Ce qui manque encore

- Remboursement ligne par ligne : `createRefund` accepte déjà des
  `refundLineItems`, mais l'API HTTP n'expose que le montant global. À ajouter
  quand le dashboard proposera la sélection d'articles.
- Restockage (`restockType`) non géré : à trancher avec les marchands pilotes.
- Aucune limite de montant par utilisateur ni par jour. À ajouter avant
  d'ouvrir le multi-agent : aujourd'hui tout utilisateur connecté peut
  rembourser sans plafond.
