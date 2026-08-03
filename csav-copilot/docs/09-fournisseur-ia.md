# Fournisseur d'IA — Claude ou DeepSeek

L'application ne s'adresse jamais directement au SDK Claude. Elle passe par
`services/ai/factory.ts`, qui construit un `AiProvider` (interface définie
dans `services/ai/provider.ts` : un seul verbe, `completeJson`) d'après la
variable `AI_PROVIDER`. Ni `classify.ts` ni `generate.ts` ne savent quel
fournisseur tourne — ils écrivent une consigne, un schéma, et reçoivent un
objet validé.

Basculer de l'un à l'autre est une variable d'environnement, pas une
réécriture.

## Pourquoi ce n'est pas juste une histoire de prix

Le sujet posé par ce choix est la localisation des données. DeepSeek est une
entreprise chinoise ; les mails envoyés à son API sont traités sur des
serveurs situés en Chine, qui ne bénéficie pas de décision d'adéquation
européenne. Utiliser DeepSeek en production implique de le documenter dans le
contrat de sous-traitance signé avec chaque marchand, au même titre
qu'Anthropic. Voir [06-rgpd.md](06-rgpd.md).

Ce fichier documente comment comparer les deux. Le choix vous revient.

## Différence technique entre les deux

| | Anthropic | DeepSeek (et tout fournisseur compatible OpenAI) |
|---|---|---|
| Format de sortie | Imposé par l'API (`output_config.format`) | « Mode JSON » best-effort, non garanti |
| Conformité au schéma | Garantie | Validée côté application, avec un réessai |
| Coût par ticket | ~0,05 $ | ~10 à 30× moins cher (à vérifier sur les tarifs actuels) |
| Localisation | États-Unis | Chine |

La conséquence concrète : `providers/openaiCompatible.ts` décrit le schéma
dans la consigne plutôt que de le faire respecter par l'API, valide chaque
réponse, et **réessaie une fois** en cas de JSON non conforme — en disant au
modèle ce qui n'allait pas, pas en relançant à l'identique. Le nombre de
réessais remonte dans `JsonCompletionResult.retries` : c'est la mesure à
surveiller si vous adoptez ce fournisseur, un taux de réessai élevé indique
un modèle ou un prompt mal calibrés pour de la sortie structurée.

## Basculer

Deux chemins, au même effet.

**Depuis la console d'administration** — `/admin`, groupe « Intelligence
artificielle » : choisir le fournisseur, coller la clé, cliquer sur « Tester la
connexion ». Le changement est pris en compte par l'API, le worker et le cron
en une trentaine de secondes, sans redéploiement. Voir
[11-console-admin.md](11-console-admin.md).

**Par variables d'environnement** — le repli, toujours valable :

```bash
# .env
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_MODEL=deepseek-chat        # ou deepseek-reasoner
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
```

Aucune autre variable ne change. `ANTHROPIC_API_KEY` devient inutile mais peut
rester renseignée sans effet — seul `AI_PROVIDER` décide.

Un réglage saisi dans la console **prime** sur la variable d'environnement du
même nom. Effacer le réglage rend la main à l'environnement.

Une configuration incohérente — `AI_PROVIDER=deepseek` sans clé DeepSeek — ne
bloque plus le démarrage, parce que la clé peut arriver ensuite par la console.
Elle échoue au premier appel de modèle, avec un message qui dit quoi régler et
où. Le bouton « Tester la connexion » de la console, et `npm run check:ai` en
ligne de commande, existent pour ne pas découvrir ça sur un vrai mail.

## Comparer les deux sur les mêmes mails

Chaque brouillon enregistre le fournisseur et le modèle qui l'ont produit
(`Draft.model`, par exemple `anthropic:claude-opus-5` ou
`deepseek:deepseek-chat`). Pour comparer :

1. Traitez un lot de mails avec `AI_PROVIDER=anthropic`.
2. Rejouez les mêmes mails avec `AI_PROVIDER=deepseek` — le plus simple est de
   dupliquer la boutique de test.
3. Comparez, ticket par ticket : le score de confiance, le nombre de réessais,
   et surtout — c'est le seul qui compte vraiment — **est-ce que la réponse
   invente un numéro de suivi, une date, un montant qui n'est pas dans les
   données Shopify fournies ?** Le prompt l'interdit explicitement aux deux
   fournisseurs ; seule une lecture ligne à ligne dit lequel le respecte
   réellement.

Trois points à vérifier en particulier, propres à ce produit :

- **Le cas ambigu.** Sur un mail sans numéro de commande et plusieurs
  commandes correspondant au client, le brouillon doit demander une précision,
  jamais choisir. C'est le comportement sur lequel repose toute la confiance
  dans l'outil — à vérifier en priorité sur tout nouveau fournisseur.
- **Le français.** Un ton juste avec un client mécontent ne se mesure pas à un
  score : lisez les brouillons.
- **La stabilité du JSON.** Un `retries` fréquemment supérieur à 0 sur
  DeepSeek indique qu'il faut soit affiner la consigne, soit accepter le coût
  latence/fiabilité de ce fournisseur pour cet usage.

## Ajouter un troisième fournisseur

Toute API compatible OpenAI (Mistral, un modèle auto-hébergé derrière vLLM…)
se branche en réutilisant `createOpenAiCompatibleProvider` avec sa propre
`baseUrl` — pas besoin d'écrire un nouveau fichier de fournisseur. Ajoutez
la valeur à l'énumération `AI_PROVIDER` dans `config/env.ts`, une branche dans
`factory.ts` : le compilateur signale toute branche manquante (le
`switch` est exhaustif).
