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

## Premier réflexe sur un clone frais

`npm install`. Le dépôt ne versionne pas `node_modules`, et sans lui
`npm run typecheck` répond `tsc: command not found` pendant que `npm test`
annonce deux fichiers en échec. Ces échecs ne disent rien du code : les tests
concernés importent `zod` via `src/config/env.ts`, qui n'est pas là. Cherchée
comme une régression, la piste coûte une demi-heure. Une fois installé, la
référence est **86 tests, 86 passent**, typecheck propre.

`npm run db:seed` demande en plus un PostgreSQL — `docker compose up -d` le
fournit, ainsi que le Redis de la file.

## Où en était le dépôt au moment de la bascule

`3a6abfe` — correction de `prisma/seed.ts`, cassé depuis le passage des
fournisseurs en multi-tenant (le seed créait encore des fournisseurs sans les
rattacher à un marchand).

Ce n'est pas l'état courant : la branche a avancé depuis, et c'est `git log`
qui fait foi, pas cette ligne. Elle ne sert qu'à situer le point de reprise.

## Accès dépôt sur ce compte

Le remote `origin` pointe sur `https://github.com/Idouska/est-render.git`, et
les identifiants viennent du CLI `gh`, authentifié sur le compte `Idouska` et
posé en assistant d'identification git (`gh auth setup-git`). `git push` et
`gh pr create` fonctionnent sans rien saisir.

Ne pas remettre de jeton dans l'URL du remote. Un jeton écrit là se retrouve
en clair dans `.git/config`, dans la sortie de `git remote -v` et dans les
messages d'erreur de `git push` ; il expire sans prévenir, et le jour où il
expire la panne se lit « could not read Password », ce qui n'oriente vers
rien. `gh` détient le sien ailleurs et le renouvelle lui-même.

Le connecteur GitHub du chat (actions du type « ouvrir une PR depuis la
conversation ») reste non fonctionnel sur ce compte. Sans impact sur le
travail de code avec Claude Code, qui passe par `git` et `gh` en ligne de
commande — ce sont deux choses distinctes, et la première marche.

### Ce que cette section affirmait à tort

Elle décrivait un jeton fine-grained placé dans l'URL du remote, valable
trente jours, dispensant de toute ré-authentification. Rien de tout cela
n'était vrai. L'URL contenait la chaîne littérale `TON_TOKEN` — le texte
d'exemple, jamais remplacé. Aucun secret n'a donc fuité, mais aucun `push`
n'était possible non plus, et la note affirmait le contraire avec assez
d'aplomb pour qu'on ne pense pas à vérifier.

C'est noté ici plutôt que corrigé en silence : une note de passation qui se
trompe coûte plus cher qu'une note absente. Absente, on va voir ; fausse, on
la croit et on cherche la panne ailleurs. Le réflexe à garder pour la suite
de ce document — vérifier avant de recopier une affirmation d'accès ou de
configuration, `git push` et `gh auth status` suffisent.
