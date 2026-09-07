/**
 * Reprise unique de l'état Gmail des fils déjà en base.
 *
 *   npm run gmail:reprise -- --simulation      # ne touche à rien, compte
 *   npm run gmail:reprise -- --limite 20       # essai sur vingt fils
 *   npm run gmail:reprise                      # la totalité
 *
 * POURQUOI
 *
 * `gmailUnread` et `gmailArchived` sont nés le 7 septembre, avec
 * `@default(true)` et `@default(false)`. Les fils entrés avant n'ont jamais
 * été interrogés : la base ne dit pas « ce fil est non lu », elle dit « je
 * n'ai jamais regardé ». Le compteur de la navigation ne fait pas la
 * différence et additionne les deux — d'où un badge qui ressemble au total de
 * la boîte plutôt qu'au reste à faire.
 *
 * La relève incrémentale corrige tout ce qui bouge *depuis* : elle écoute les
 * événements de libellé de Gmail. Elle ne dit rien du passé, par construction.
 * Ce script établit ce point de départ, une fois. Passé cette exécution, il ne
 * sert plus jamais : les lectures et archivages suivants arrivent tout seuls.
 *
 * CE QU'IL NE FILTRE PAS, ET POURQUOI C'EST L'ESSENTIEL
 *
 * On serait tenté de ne reprendre que les fils jamais relus (`threadSyncedAt`
 * vide). Ce serait faux. Le marqueur date du 8 août, les deux champs du
 * 7 septembre : tous les tickets ouverts entre ces deux dates portent
 * « fil déjà relu » alors que les champs n'existaient pas encore et n'ont donc
 * rien reçu. Filtrer sur le marqueur les rendrait invisibles — définitivement,
 * puisque rien ne les rouvrira jamais pour la première fois.
 *
 * La reprise passe donc sur toute la population que le compteur compte, et
 * `relireLibelles` lève le garde-fou côté `syncTicketThread`.
 *
 * SÛRETÉ
 *
 * Idempotent : relancé, il refait le même travail et écrit les mêmes valeurs.
 * Interrompu, il affiche où reprendre (`--apres`). Aucune écriture chez Gmail,
 * uniquement des lectures : le pire cas est une base qui reste telle quelle.
 * Un appel Gmail en échec n'écrit rien du tout — `syncTicketThread` ne pose
 * son marqueur qu'en cas de succès, ce dont ce script se sert pour compter.
 */

import { prisma } from '../src/lib/prisma.ts';
import { syncTicketThread } from '../src/services/gmail/thread.ts';
import { PORTEE_NON_LU } from '../src/services/gmail/unreadScope.ts';

/*
 * Exactement la population que le compteur compte — la portée est partagée,
 * pas recopiée — plus la seule condition propre à la reprise : un fil sans
 * identifiant Gmail ne peut pas être relu.
 */
const CIBLE = { ...PORTEE_NON_LU, gmailThreadId: { not: null } };

const TAILLE_LOT = 50;

/*
 * Un fil toutes les 150 ms, soit environ sept par seconde.
 *
 * Large sous les limites de Gmail, qui se comptent en dizaines d'appels par
 * seconde et par boîte. Le but n'est pas d'aller vite — c'est une exécution
 * unique — mais de ne jamais déclencher de limitation, qui ferait échouer des
 * fils au hasard et rendrait le compte final incompréhensible.
 */
const PAUSE_MS = 150;

/*
 * Dix échecs d'affilée sur la même boîte : ce n'est pas la faute des fils.
 * C'est un jeton expiré, un accès révoqué, Gmail en panne. Continuer
 * brûlerait des milliers d'appels pour rien et noierait le rapport.
 */
const SEUIL_ABANDON = 10;

/*
 * Ce que coûte réellement un fil : la pause, plus l'aller-retour chez Gmail,
 * plus deux requêtes en base. Estimer sur la seule pause annonçait un quart
 * d'heure pour un travail qui en prend trois fois plus — et une barre de
 * progression qui ment décourage de laisser tourner.
 */
const COUT_ESTIME_MS = PAUSE_MS + 400;

function drapeau(nom: string): boolean {
  return process.argv.includes(nom);
}

function valeur(nom: string): string | undefined {
  const index = process.argv.indexOf(nom);
  return index === -1 ? undefined : process.argv[index + 1];
}

function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function duree(ms: number): string {
  const secondes = Math.round(ms / 1000);
  if (secondes < 60) return `${secondes} s`;
  const minutes = Math.floor(secondes / 60);
  return `${minutes} min ${String(secondes % 60).padStart(2, '0')} s`;
}

async function simulation(): Promise<void> {
  const total = await prisma.ticket.count({ where: CIBLE });
  const jamaisRelus = await prisma.ticket.count({
    where: { ...CIBLE, threadSyncedAt: null },
  });
  const nonLus = await prisma.ticket.count({ where: { ...CIBLE, gmailUnread: true } });

  console.log('Simulation — aucune écriture, aucun appel à Gmail.\n');
  console.log(`  Fils concernés          : ${total}`);
  console.log(`    dont jamais relus     : ${jamaisRelus}`);
  console.log(`    dont relus avant les champs : ${total - jamaisRelus}`);
  console.log(`  Comptés « non lus » aujourd'hui : ${nonLus}`);
  console.log(`\n  Durée estimée : ${duree(total * COUT_ESTIME_MS)} — estimation, selon Gmail.`);
  console.log('\n  → Pour un essai réel sur un échantillon : --limite 20');
}

async function main(): Promise<void> {
  if (drapeau('--simulation')) {
    await simulation();
    return;
  }

  const limite = Number(valeur('--limite') ?? '0') || Infinity;
  const total = Math.min(await prisma.ticket.count({ where: CIBLE }), limite);

  if (total === 0) {
    console.log('Aucun fil à reprendre.');
    return;
  }

  const nonLusAvant = await prisma.ticket.count({ where: { ...CIBLE, gmailUnread: true } });

  console.log(`Reprise de ${total} fil(s), un toutes les ${PAUSE_MS} ms.`);
  console.log(`Comptés « non lus » avant : ${nonLusAvant}`);
  console.log(`Durée estimée : ${duree(total * COUT_ESTIME_MS)} (estimation)\n`);

  const debut = Date.now();
  let traites = 0;
  let reussis = 0;
  let messagesAjoutes = 0;
  let dernierId: string | undefined = valeur('--apres');

  /** Échecs d'affilée par boîte, et les boîtes abandonnées. */
  const echecs = new Map<string, number>();
  const abandonnees = new Set<string>();

  let interrompu = false;
  process.on('SIGINT', () => {
    // Le second Ctrl-C sort pour de bon : le premier attend la fin du fil en
    // cours, ce qui peut prendre quelques secondes, et sans cette porte on
    // aurait l'impression que l'interruption n'est pas prise.
    if (interrompu) process.exit(130);
    interrompu = true;
    console.log('\n\nInterruption demandée — fin du fil en cours… (Ctrl-C à nouveau pour forcer)');
  });

  while (traites < total && !interrompu) {
    const lot: { id: string; merchantId: string }[] = await prisma.ticket.findMany({
      where: CIBLE,
      select: { id: true, merchantId: true },
      orderBy: { id: 'asc' },
      take: Math.min(TAILLE_LOT, total - traites),
      ...(dernierId ? { cursor: { id: dernierId }, skip: 1 } : {}),
    });

    if (lot.length === 0) break;

    for (const ticket of lot) {
      if (interrompu) break;
      dernierId = ticket.id;
      traites += 1;

      if (abandonnees.has(ticket.merchantId)) continue;

      const avant = new Date();

      try {
        messagesAjoutes += await syncTicketThread(ticket.merchantId, ticket.id, {
          relireLibelles: true,
        });
      } catch (error) {
        console.error(`  ✗ ${ticket.id} : ${error instanceof Error ? error.message : error}`);
      }

      /*
       * Le succès se lit sur le marqueur, pas sur la valeur rendue : celle-ci
       * est le nombre de messages ajoutés, et vaut zéro aussi bien pour un fil
       * déjà complet que pour un appel Gmail tombé. `syncTicketThread` ne pose
       * le marqueur qu'après avoir vraiment lu le fil.
       */
      const apres = await prisma.ticket.findUnique({
        where: { id: ticket.id },
        select: { threadSyncedAt: true },
      });

      if (apres?.threadSyncedAt && apres.threadSyncedAt >= avant) {
        reussis += 1;
        echecs.set(ticket.merchantId, 0);
      } else {
        const suite = (echecs.get(ticket.merchantId) ?? 0) + 1;
        echecs.set(ticket.merchantId, suite);

        if (suite >= SEUIL_ABANDON) {
          abandonnees.add(ticket.merchantId);
          console.error(
            `\n  ✗ Boîte ${ticket.merchantId} : ${suite} échecs d'affilée, elle est laissée de côté.`,
          );
          console.error('    Jeton expiré, accès révoqué ou Gmail indisponible — à reconnecter.\n');
        }
      }

      await dormir(PAUSE_MS);
    }

    const pourcent = Math.round((traites / total) * 100);
    console.log(`  ${traites}/${total} (${pourcent} %) — ${reussis} relus, ${duree(Date.now() - debut)}`);
  }

  const nonLusApres = await prisma.ticket.count({ where: { ...CIBLE, gmailUnread: true } });
  const rates = traites - reussis;

  console.log(`\n${interrompu ? 'Interrompue' : 'Terminée'} en ${duree(Date.now() - debut)}.\n`);
  console.log(`  Fils traités        : ${traites}`);
  console.log(`  Relus avec succès   : ${reussis}`);
  if (rates > 0) console.log(`  En échec            : ${rates} (relancer le script les retentera)`);
  if (messagesAjoutes > 0) {
    console.log(`  Messages rapatriés  : ${messagesAjoutes} (réponses d'équipe qui manquaient au fil)`);
  }
  console.log(`\n  Comptés « non lus » : ${nonLusAvant} → ${nonLusApres}`);

  if (abandonnees.size > 0) {
    console.log(`\n  ⚠ ${abandonnees.size} boîte(s) laissée(s) de côté, à reconnecter :`);
    for (const id of abandonnees) console.log(`      ${id}`);
  }

  if (interrompu || rates > 0) {
    console.log(`\n  Pour reprendre où l'on s'est arrêté :`);
    console.log(`      npm run gmail:reprise -- --apres ${dernierId}`);
  }
}

try {
  await main();
} catch (error) {
  console.error('\n✗ La reprise s’est arrêtée sur une erreur inattendue.\n');
  console.error('  ', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
