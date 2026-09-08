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
référence est **89 tests, 89 passent** (86 à l'écriture de cette note), typecheck propre.

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

## Reprise de l'état Gmail — passée le 2026-09-08, ne pas la refaire

`src/scripts/repriseGmail.ts`, lancé via `npm run gmail:reprise`, est un
script de maintenance **ponctuel**. Il a été exécuté en production le
8 septembre 2026. Résultat : le compteur « SAV client » est passé de **5 260
à 17**, et douze tickets ont rejoint le dossier « Archivés ».

Il n'y a rien à relancer. Ce qu'il corrigeait ne peut pas se reproduire.

### Ce qu'il réparait

`Ticket.gmailUnread` et `Ticket.gmailArchived` sont nés le 7 septembre, avec
des valeurs par défaut. Les fils entrés avant n'avaient jamais été
interrogés : la base ne disait pas « ce fil est non lu », elle disait « je
n'ai jamais regardé ». Le compteur additionnait les deux, d'où un badge qui
affichait le total de la boîte.

La relève incrémentale (`services/gmail/sync.ts`) corrige tout ce qui bouge
*depuis*, en écoutant les événements de libellé. Elle ne dit rien du passé,
par construction : un flux d'événements donne le présent, jamais l'état de
tout. C'est la raison d'être de ce script, et la raison pour laquelle il ne
sert qu'une fois. Toute donnée branchée sur un flux d'événements demande une
reprise pour établir son point de départ — sinon le flux entretient
fidèlement un état initial qui était faux.

Le relancer est sans danger : il est idempotent, il réécrira les mêmes
valeurs.

### Le piège, pour que personne ne le refasse

La première version lisait les fils un par un pour découvrir leur état. Elle
a épuisé le quota Gmail au bout d'une trentaine d'appels, en production.

Le quota qui compte est `totalQueryCostPerMinutePerUser` : six mille unités
par minute et par boîte. Un `threads.get` en coûte dix. Lire cinq mille fils
coûte cinquante mille unités — près de dix minutes de quota *total*, sans
rien laisser à l'application, qui interroge Gmail en même temps. **Ralentir
la boucle ne change pas ce total.** Un quota qu'on n'arrive pas à respecter
en ralentissant est le signe qu'on interroge mal, pas trop vite.

La version retenue demande à Gmail *lesquels* sont non lus — `threads.list`
avec `q: is:unread` rend cinq cents identifiants par page pour cinq unités —
et déduit le reste. Quinze appels au lieu de cinq mille, quelques secondes au
lieu d'une heure.

Deux erreurs de conception accompagnaient la première version, à connaître
parce qu'elles se reproduisent facilement ailleurs :

- **Le disjoncteur confondait « attends » et « abandonne ».** Dix erreurs de
  quota d'affilée lui ont fait déclarer la boîte morte et sauter les 5 360
  fils restants. Une limitation de débit est passagère ; un jeton révoqué ne
  l'est pas. Les traiter pareil coûte cher.
- **Le rapport comptait les fils sautés comme des échecs.** « 5 360 en
  échec » là où il y en avait dix. Trois catégories — traités, en échec,
  jamais tentés — confondues en une.

### Le garde-fou à ne pas retirer

La méthode repose sur une déduction : ce que Gmail ne nomme pas est lu et
archivé. Elle est juste tant que la réponse est complète. Une recherche qui
rendrait zéro **sans lever d'erreur** — périmètre d'accès insuffisant,
pagination interrompue — se lirait « tout est lu et archivé », et viderait la
file en silence. Deux listes vides valent donc refus d'écrire.

Cette prudence existait dans `services/gmail/thread.ts` (« on ne réécrit pas
un état sur la foi d'un appel qui a échoué ») et avait été perdue à la
réécriture. Elle a été remise. Ne pas la retirer au motif qu'elle n'a jamais
servi : c'est précisément son état normal.

Un audit adversarial passé après l'exécution a trouvé trois défauts dans la
version qui avait tourné — sans dégât, parce que Gmail avait répondu du
premier coup. Le pire : la boucle de pagination sortait sur un refus de quota
à la *première* page et rendait un ensemble vide, que la remise à plat prenait
pour la vérité. Le garde-fou ci-dessus ne l'attrapait pas quand une seule des
deux recherches échouait. Depuis : la boucle ne sort qu'après une page lue, un
second garde-fou refuse une réponse Gmail qui ne recoupe aucun de nos fils
(jeton d'un autre compte), et la remise à plat ne touche que les tickets
antérieurs à la photographie — l'ingestion continue pendant la reprise.

## La feuille de style : une seule règle à tenir

`public/styles.css` avait grandi en trois couches successives. Chacune
redéclarait, au niveau racine et donc **après** les blocs `@media` écrits plus
haut, des propriétés que ces blocs avaient réglées. Une requête média n'ajoute
aucune spécificité : à égalité, la règle la plus tardive gagne, à toutes les
largeurs. Vingt déclarations responsive étaient mortes sans qu'aucun outil ne
le signale — la grille du shell laissait une piste vide de 204 px sous 1080 px,
la bande d'indicateurs mesurait huit cents pixels de haut, la loupe de la
recherche recouvrait le texte du champ.

Les soixante requêtes média vivent désormais **toutes en fin de feuille**, dans
leur ordre d'origine, sous un commentaire qui le dit. Elles gagnent donc par
construction.

**La règle à tenir : ne rien écrire après ce commentaire qui ne soit dans une
requête média.** Une seule règle inconditionnelle ajoutée plus bas rouvrirait
le trou, et rien ne le dirait — ni un test, ni un typecheck, ni la revue.

Sept déclarations média ont été supprimées avant ce déplacement : c'étaient des
vestiges d'un design antérieur, que la dernière couche avait délibérément
remplacés, et les déplacer les aurait ressuscités. La distinction s'est faite
cas par cas, en lisant les commentaires des deux règles concernées — cette
feuille explique presque toujours pourquoi une valeur a été choisie, et c'est
ce qui a permis de trancher.

Vérification faite avant de livrer : relevé des styles calculés de 1 597
éléments sur cinq écrans à six largeurs, avant et après. **Aucune différence à
1280, 1440 et 1920 px.** Les seuls changements sont sous 1024 px, et chacun
correspond à un réglage responsive rendu à sa fonction.

