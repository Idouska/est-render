# Console d'administration

`/admin` — réservée à l'éditeur. Elle règle les identifiants qui appartiennent
à la plateforme : l'app Shopify, le projet Google Cloud, le fournisseur d'IA.

Ce n'est pas l'écran de réglages du marchand. Celui-là est dans le dashboard
(bouton « Réglages ») et ne contient aucune clé d'API : un marchand autorise
Shopify et Gmail par OAuth, il ne colle jamais de secret.

## Ce que la console règle

| Groupe | Clés | Où les obtenir |
|---|---|---|
| Intelligence artificielle | `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_BASE_URL` | console Anthropic / platform.deepseek.com |
| Application Shopify | `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` | Shopify Partners → votre app |
| Google / Gmail | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_PUBSUB_TOPIC`, `GOOGLE_PUBSUB_SERVICE_ACCOUNT` | Google Cloud → Identifiants, Pub/Sub |

Restent obligatoirement des variables d'environnement : `DATABASE_URL`,
`ENCRYPTION_KEY`, `REDIS_URL`, `APP_URL`, `ADMIN_PASSWORD`. Les mettre en base
serait circulaire — il faut déjà la base et la clé de chiffrement pour lire la
table des réglages.

## Ordre de priorité

1. la table `PlatformSetting`, réglée depuis la console ;
2. la variable d'environnement du même nom ;
3. une valeur par défaut, quand il en existe une (`AI_PROVIDER=anthropic`,
   `DEEPSEEK_BASE_URL`, les noms de modèles).

Une base vide se comporte donc **exactement** comme avant l'existence de cette
console. Vider un champ supprime le réglage et rend la main à l'environnement :
c'est le seul moyen de revenir à la configuration de déploiement sans toucher
la base à la main.

Chaque champ affiche d'où vient sa valeur — « réglé ici », « variable
d'environnement », « valeur par défaut », « non réglé ».

## Activation

La console n'existe que si `ADMIN_PASSWORD` est défini (12 caractères
minimum). Sans lui, les routes ne sont pas enregistrées du tout et `/admin`
répond 404 avec la marche à suivre — plutôt qu'un écran protégé par un
contrôle vide.

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

Sur Render : `ADMIN_PASSWORD` en `sync: false` sur le service `csav-api`
uniquement. Le worker et le cron n'exposent pas d'interface HTTP, ils n'en ont
pas besoin.

## Ce que la console ne fait jamais

**Réafficher un secret.** Une clé s'écrit, se teste et s'efface, mais ne se
relit pas : sinon un seul accès admin suffirait à récupérer tous les
identifiants de la plateforme. Le champ reste vide, et une empreinte —
longueur et quatre derniers caractères — permet de vérifier qu'on a collé la
bonne clé.

Conséquence pratique : laisser un champ secret vide veut dire « ne change
rien ». Pour supprimer une clé, il faut le bouton « Effacer ».

Les valeurs sont chiffrées au repos en AES-256-GCM avec `ENCRYPTION_KEY`, comme
les tokens marchands. Une ligne devenue indéchiffrable après rotation de la clé
est ignorée avec un log d'erreur, et le repli par variable d'environnement
reprend la main — plutôt que de faire tomber les trois processus.

## Tester la connexion

Chaque groupe a un bouton qui fait un vrai aller-retour réseau. Une clé
« présente » ne prouve rien ; c'est la différence entre une clé collée et une
clé qui fonctionne qui compte.

- **IA** — envoie une requête minuscule au modèle actif et rapporte le temps de
  réponse, le modèle ayant répondu et les jetons consommés. Traduit les échecs
  courants en action : 401 (clé refusée), 402 (compte sans crédit), domaine
  bloqué par le réseau de l'hébergement.
- **Google** — présente un code d'autorisation volontairement invalide au point
  de terminaison de jeton. Google répond `invalid_client` si l'app est mal
  identifiée, `invalid_grant` si l'app est reconnue mais le code ne vaut rien.
  Le second est la preuve que les identifiants sont bons. Aucun compte marchand
  n'est touché.
- **Shopify** — les identifiants d'app ne se testent pas seuls : ils ne servent
  qu'au moment d'une installation. Le test appelle donc l'Admin API d'une
  boutique déjà installée, ce qui valide la chaîne complète. Sans boutique
  installée, il se limite à constater la présence des identifiants et le dit.

## Délai de propagation

L'API, le worker et le cron sont trois processus distincts : une écriture dans
l'un ne peut pas vider le cache des autres. Les valeurs sont donc mises en
cache 30 secondes, ce qui borne le délai de propagation d'un changement. C'est
le prix à payer pour éviter une requête SQL sur chaque appel de modèle — et ça
reste sans commune mesure avec le redéploiement complet qu'imposait la
configuration par variables d'environnement.

## Journal

Les connexions réussies et refusées sont journalisées avec l'IP. Les
modifications le sont aussi, **avec les noms des clés touchées mais jamais
leurs valeurs**. Ces réglages n'appartenant à aucun marchand, ils ne passent
pas par `AuditLog`, qui est multi-tenant par construction.
