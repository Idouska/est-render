# Note de passation — bascule vers le compte client

Écrite le 2026-09-06 pour qu'une session Claude Code démarrée sur un autre
compte retrouve le contexte sans relire l'historique de conversation
précédent, qui ne se transfère pas d'un compte à l'autre.

## Où trouver l'état réel du projet

- [`07-roadmap.md`](07-roadmap.md) : ce qui est livré, ce qui reste par phase,
  et les décisions encore à trancher avec les pilotes. C'est la référence —
  ne pas la reconstruire de mémoire.
- `git log` : chaque commit explique un problème réel et pourquoi il a été
  corrigé ainsi, pas seulement le quoi. Les 15-20 derniers suffisent pour
  comprendre la direction récente (densité d'interface du dashboard, purge
  des brouillons Gmail orphelins, escalade fournisseur).

## Dernier commit avant la bascule

`3a6abfe` — correction de `prisma/seed.ts`, cassé depuis le passage des
fournisseurs en multi-tenant (le seed créait encore des fournisseurs sans les
rattacher à un marchand).

## Accès dépôt sur ce compte

Le clone a été fait avec un jeton d'accès personnel fine-grained (dépôt
`idouska/est-render` seul, `Contents: Read and write`), le connecteur GitHub
du compte n'ayant pas pu s'authentifier (échec récurrent, cause non
diagnostiquée — jamais résolu, contournement uniquement). Le remote `origin`
pointe vers une URL contenant ce jeton : pas de ré-authentification
nécessaire pour `git push`, mais le jeton expire (30 jours depuis sa
création) et devra être régénéré à ce moment-là.

Le connecteur GitHub du chat (actions du type « ouvrir une PR depuis la
conversation ») reste non fonctionnel sur ce compte. Sans impact sur le
travail de code avec Claude Code, qui passe par `git` en ligne de commande.
