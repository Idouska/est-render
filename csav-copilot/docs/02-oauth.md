# OAuth Shopify et Google

## Shopify Public App

Scopes demandés (`SHOPIFY_SCOPES`) :

| Scope | Usage |
|---|---|
| `read_orders` | Commande, articles, montants, statuts |
| `read_customers` | Ancienneté, nombre de commandes, total dépensé |
| `read_fulfillments` | Transporteur, numéro de suivi, ETA |
| `write_orders` | **Requis par Shopify pour `refundCreate`.** Il n'existe pas de scope `write_refunds` : le remboursement passe par le scope commandes en écriture. |

Le brief mentionnait `write_refunds` — ce scope n'existe pas dans l'API Admin.
C'est `write_orders` qu'il faut demander, ce qui est plus large que souhaité :
raison de plus pour que le bouton rembourser soit verrouillé côté applicatif
(confirmation + audit), puisque le token, lui, peut faire plus que rembourser.

Flux implémenté dans `src/routes/auth.shopify.ts` :

1. `GET /auth/shopify?shop=...` — validation stricte du domaine
   (`*.myshopify.com` uniquement), pose d'un `state` en cookie httpOnly,
   redirection vers l'écran d'autorisation.
2. `GET /auth/shopify/callback` — vérification du `state`, puis du HMAC
   (tous les paramètres sauf `hmac`, triés, concaténés). Sans ces deux
   contrôles, n'importe qui peut forger un callback et créer un marchand.
3. Échange du code contre un token permanent, chiffré avant écriture.
4. Ouverture de session, redirection vers l'étape Google.

Webhook `app/uninstalled` (`POST /webhooks/shopify/app-uninstalled`) : HMAC
base64 vérifié sur le **corps brut** — d'où le `addContentTypeParser` dans
`server.ts`, car une re-sérialisation JSON casse la signature.

## Google / Gmail

Scopes demandés :

| Scope | Usage |
|---|---|
| `gmail.readonly` | Lecture des mails entrants |
| `gmail.compose` | Création et mise à jour des brouillons |
| `gmail.send` | Envoi du brouillon validé |

`gmail.readonly` et `gmail.send` sont des **scopes restreints** au sens de
Google : ouverture publique conditionnée à une vérification OAuth incluant un
audit de sécurité par un tiers agréé (CASA). Compter **6 à 10 semaines** et un
coût d'audit à la charge de l'éditeur.

À lancer dès la phase 1, en parallèle du développement — c'est le chemin
critique de la phase 3, pas une formalité de fin de projet. Prérequis à
préparer tôt :

- domaine vérifié dans la Search Console,
- page de politique de confidentialité et CGU en ligne, cohérentes avec les
  scopes demandés,
- vidéo de démonstration du parcours utilisateur montrant l'usage de chaque scope,
- justification écrite du besoin de `gmail.readonly` plutôt qu'un scope plus
  étroit (`gmail.metadata` ne suffit pas : il faut le corps du mail).

En attendant la vérification : mode test Google, plafonné à 100 utilisateurs,
suffisant pour les marchands pilotes.

### Points d'attention techniques

- `prompt: 'consent'` est indispensable : sans lui, Google ne renvoie un refresh
  token qu'à la toute première autorisation. Une reconnexion sans refresh token
  laisserait une intégration morte au bout d'une heure.
- Le refresh token est chiffré ; l'access token est rafraîchi par la librairie
  Google et re-chiffré au vol via le listener `tokens` (`services/gmail/client.ts`).
- `POST /auth/google/disconnect` supprime la connexion — c'est le droit de
  retrait du marchand, distinct de la désinstallation de l'app Shopify.
