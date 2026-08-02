# Classification, rattachement et rédaction

## Classification (`services/ai/classify.ts`)

Un appel `messages.create` en sortie structurée (`output_config.format`,
JSON Schema) avec `effort: 'low'` — la tâche est courte et cadrée, un effort
supérieur coûterait sans gagner en justesse.

Sortie : `intent`, `confidence`, `mentionedOrderNumber`, `urgency`, `summary`.

`urgency` n'est pas utilisé en phase 1 mais est déjà collecté : la priorisation
de la file (post-MVP) n'aura pas besoin de re-traiter l'historique.

En dessous de `confidence < 0.7`, le ticket part en `NEEDS_REVIEW` quelle que
soit la qualité du brouillon. Les intentions `OTHER` et `POSITIVE` ne
déclenchent aucune génération : rien à répondre automatiquement à un
remerciement ou à un mail de prospection.

## Rattachement mail ↔ commande (`services/matching/orderMatcher.ts`)

Trois stratégies, du plus fiable au moins fiable. Le principe directeur :
**ne jamais deviner silencieusement**.

| # | Stratégie | Score | Condition |
|---|---|---|---|
| 1 | Numéro cité dans le corps + email expéditeur concordant | 0.99 | Une seule commande porte ce numéro |
| 1' | Numéro cité, email différent | 0.80 | Déclaratif : le client peut se tromper de commande |
| 2 | Email expéditeur, une seule commande | 0.95 | — |
| 2' | Email expéditeur, plusieurs commandes dont une seule non expédiée | 0.85 | Presque toujours celle dont on parle |
| 3 | Nom + commande dans les 60 derniers jours | 0.50 | Repli faible, jamais suffisant pour un envoi auto |

Tout autre cas renvoie `AMBIGUOUS` (plusieurs candidates) ou `NOT_FOUND`.

`extractOrderNumbers` est délibérément conservateur : seules les formes
explicites sont reconnues (`#1042`, `commande n° 1042`, `order number 1042`,
3 à 10 chiffres). Un nombre isolé dans une phrase — « j'ai attendu 15 jours
pour 2 articles à 129 euros » — n'est pas un numéro de commande. Mieux vaut
ne rien trouver et demander au client que rattacher la mauvaise commande et
lui annoncer le suivi d'un colis qui n'est pas le sien. Couvert par
`tests/orderMatcher.test.ts`.

### Chemins de secours

- `AMBIGUOUS` → le contexte de génération liste les commandes candidates et
  demande explicitement au modèle de faire préciser le client, sans choisir.
- `NOT_FOUND` → le brouillon demande le numéro de commande ou l'email d'achat.
- Dans les deux cas, le ticket passe en `NEEDS_REVIEW` et l'agent peut
  rattacher manuellement (`OrderMatchMethod.MANUAL`).

## Rédaction (`services/ai/generate.ts`)

`effort: 'medium'`, sortie structurée : `body`, `confidence`, `reasoning`,
`needsHuman`.

Le prompt système impose trois interdits :

1. N'affirmer que ce qui figure dans les données de commande fournies —
   aucun numéro de suivi, aucune date, aucun montant inventé.
2. Ne rien promettre de non vérifiable (remboursement, geste commercial, délai).
3. Sans commande rattachée, demander une précision plutôt que supposer.

Le garde-fou est aussi dans le code, pas seulement dans le prompt : sans
commande rattachée, `confidence` est plafonnée à 0.5 et `needsHuman` est forcé
à `true`, quoi qu'en dise le modèle. Un prompt n'est pas une garantie.

`reasoning` est affiché à l'agent dans le dashboard : il explique ce qui limite
la confiance, ce qui rend la relecture plus rapide qu'un score nu.

## Seuil d'envoi

`Merchant.autoSendThreshold` (défaut 0.9) et `autoSendEnabled` (défaut `false`)
existent en base. **En phase 1, aucun chemin de code n'envoie automatiquement** :
`process.ts` crée un brouillon et s'arrête. L'envoi passe exclusivement par
`POST /api/drafts/:id/send`, déclenché par un humain.

L'activation de l'auto-send est une décision de phase 3, à prendre après avoir
mesuré sur données réelles le taux de brouillons envoyés sans modification.

## Coût indicatif

Avec `claude-opus-5` (5 $ / 25 $ par million de tokens), un ticket consomme
environ 3 à 6 k tokens en entrée et 400 à 800 en sortie sur les deux appels,
soit de l'ordre de 0,04 à 0,05 $ par ticket. À valider sur trafic réel avant
de fixer le prix de l'abonnement. Deux leviers si nécessaire : baisser
`effort` sur la génération, ou basculer la classification seule sur un modèle
moins cher — à mesurer, pas à supposer.
