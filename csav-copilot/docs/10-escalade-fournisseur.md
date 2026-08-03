# Escalade fournisseur

Certains tickets ne peuvent pas être résolus avec les seules données
Shopify/Gmail : rupture de stock, adresse de livraison incorrecte ou
incomplète, article manquant. Il faut alors interroger le fournisseur, et le
faire vite — c'est tout l'objectif de cette fonctionnalité.

## Choix de conception

- **Un seul fournisseur par boutique.** Pas de notion d'article rattaché à un
  fournisseur (le champ `vendor` de Shopify n'est pas exploité) : en phase 1,
  toute escalade part vers le même contact, configuré une fois
  (`PUT /api/suppliers`). Passer à plusieurs fournisseurs demanderait de
  résoudre cette association produit → fournisseur, non couverte ici.
- **Portail, pas de compte fournisseur.** Le fournisseur n'a ni identifiant ni
  mot de passe : il reçoit un lien signé par email et l'ouvre
  (`GET /supplier/:id?token=...`). Voir `lib/supplierToken.ts` pour le détail
  du jeton (HMAC, 30 jours, scopé à une seule escalade). Limite assumée : un
  jeton signé ne se révoque pas individuellement — clore l'escalade côté
  marchand rend le lien inutilisable en écriture, mais il reste lisible
  jusqu'à expiration.
- **Même logique de confiance humaine que les brouillons client.** Le message
  vers le fournisseur est rédigé par l'IA (`services/ai/supplierDraft.ts`),
  mais reste en statut `DRAFTING` tant qu'un agent ne l'a pas envoyé
  (`POST /api/escalations/:id/send`). L'IA ne parle jamais au fournisseur sans
  relecture, exactement comme elle ne répond jamais au client sans relecture.
- **Notification interne, pas une réponse client.** L'email envoyé au
  fournisseur (`services/gmail/send.ts`, `sendPlainEmail`) contredit en
  apparence la règle « rien ne part sans validation humaine » : il part seul,
  sans relecture. C'est volontaire — ce n'est pas la conversation elle-même,
  seulement un lien vers le portail (« vous avez une nouvelle demande »). Ce
  mail ne fait aucune promesse au client ni n'engage le marchand ; il n'y a
  donc rien à relire.

## Cycle de vie d'une escalade

```
DRAFTING ──send──▶ OPEN ──réponse fournisseur──▶ ANSWERED
                     │                              │
                     └──────────resolve─────────────┘
                                  ▼
                              RESOLVED
```

1. **Création** (`createEscalation`, `services/suppliers/escalate.ts`) —
   l'agent choisit un motif (`EscalationReason`) et peut ajouter une note
   libre. L'IA rédige le message à partir du contexte disponible : commande,
   articles, **adresse de livraison** (`formatAddress`, dans
   `services/shopify/orders.ts` — c'est ce qui alimente le cas
   `INCORRECT_ADDRESS`), message original du client. Rien n'est envoyé.
2. **Relecture et envoi** (`sendEscalation`) — l'agent édite le brouillon si
   besoin (`PATCH /api/escalations/:id`), puis envoie
   (`POST /api/escalations/:id/send`). Un jeton de portail est signé, la
   notification part via la boîte Gmail déjà connectée du marchand, le ticket
   passe en `AWAITING_SUPPLIER`.
3. **Réponse du fournisseur** — via le portail public
   (`routes/supplierPortal.ts`), sans repasser par l'agent. L'escalade passe
   en `ANSWERED`.
4. **Clôture** (`resolveEscalation`) — décision humaine, côté marchand
   uniquement : le fournisseur ne peut pas clore une escalade lui-même.

Chaque transition est auditée (`recordAudit`), y compris la réponse du
fournisseur — avec `actorType: 'SUPPLIER'`, le seul acteur non humain et non
IA du journal.

## Ce qui reste hors phase 1

- Relance automatique si le fournisseur ne répond pas sous N jours.
- Notification au marchand quand le fournisseur répond (aujourd'hui, l'agent
  découvre la réponse en rouvrant le ticket).
- Plusieurs fournisseurs par boutique (nécessite l'association produit →
  fournisseur évoquée plus haut).
