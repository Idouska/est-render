/**
 * Reprise unique de l'état Gmail des fils déjà en base.
 *
 *   npm run gmail:reprise -- --simulation   # interroge Gmail, n'écrit rien
 *   npm run gmail:reprise                   # applique
 *
 * POURQUOI
 *
 * `gmailUnread` et `gmailArchived` sont nés le 7 septembre, avec des valeurs
 * par défaut. Les fils entrés avant n'ont jamais été interrogés : la base ne
 * dit pas « ce fil est non lu », elle dit « je n'ai jamais regardé ». Le
 * compteur de la navigation ne fait pas la différence et additionne les deux.
 *
 * La relève incrémentale corrige tout ce qui bouge *depuis*, en écoutant les
 * événements de libellé. Elle ne dit rien du passé, par construction : un flux
 * d'événements donne le présent, jamais l'état de tout. Ce script établit ce
 * point de départ, une fois.
 *
 * POURQUOI DEUX RECHERCHES ET NON CINQ MILLE LECTURES
 *
 * La première version relisait chaque fil, un par un, pour découvrir son état.
 * Elle a épuisé le quota Gmail au bout d'une trentaine d'appels, et l'histoire
 * mérite d'être écrite ici pour que personne ne la refasse.
 *
 * Le quota qui compte est `totalQueryCostPerMinutePerUser` : six mille unités
 * par minute et par boîte. Un `threads.get` en coûte dix. Lire cinq mille
 * fils coûte donc cinquante mille unités — près de dix minutes de quota
 * *total*, sans rien laisser à l'application, qui interroge Gmail en même
 * temps pour son travail normal. Ralentir la boucle ne change pas ce total :
 * cette approche ne pouvait pas tenir, quelle que soit sa cadence.
 *
 * Or on n'a pas besoin de lire les fils. Il suffit de demander à Gmail
 * *lesquels* sont non lus, ce que fait une recherche : `threads.list` avec
 * `q: is:unread` rend cinq cents identifiants par page, pour cinq unités. Deux
 * recherches — les non lus, et ceux en réception — décrivent la boîte entière
 * pour quelques dizaines d'unités et quelques secondes. Tout ce qui n'y figure
 * pas est lu, ou archivé, par définition.
 *
 * C'est aussi plus juste : une recherche donne un instantané cohérent, là où
 * cinq mille lectures étalées sur une heure décrivent cinq mille moments
 * différents.
 *
 * CE QU'IL NE FAIT PLUS
 *
 * L'ancienne version rapatriait au passage les réponses d'équipe manquantes,
 * puisqu'elle lisait les fils entiers. Ce n'est pas perdu : `syncTicketThread`
 * continue de le faire à l'ouverture de chaque ticket, comme avant. Cela n'a
 * simplement rien à faire dans la réparation d'un compteur.
 *
 * SÛRETÉ
 *
 * Aucune écriture chez Gmail, uniquement des recherches. Idempotent : relancé,
 * il écrit les mêmes valeurs. Les écritures en base passent par une
 * transaction par boîte — le compteur ne peut pas être lu dans un état
 * intermédiaire. Une boîte injoignable est signalée et n'empêche pas les
 * autres.
 */

import type { gmail_v1 } from 'googleapis';

import { prisma } from '../lib/prisma.ts';
import { getGmailClient } from '../services/gmail/client.ts';
import { PORTEE_NON_LU } from '../services/gmail/unreadScope.ts';

/** Gmail plafonne une page de `threads.list` à cinq cents. */
const PAR_PAGE = 500;

/** `IN (…)` reste raisonnable en base, et Postgres n'aime pas les listes sans fin. */
const PAR_LOT_SQL = 1000;

function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function morceaux<T>(liste: T[], taille: number): T[][] {
  const sortie: T[][] = [];
  for (let i = 0; i < liste.length; i += taille) sortie.push(liste.slice(i, i + taille));
  return sortie;
}

/**
 * Les identifiants de fils que Gmail rend pour une recherche donnée.
 *
 * Une limitation de débit n'est pas une panne : c'est « attends ». On patiente
 * et on reprend la même page — la version précédente de ce script prenait ce
 * refus pour une boîte morte et abandonnait tout, ce qui était l'erreur la
 * plus coûteuse de la journée.
 */
async function filsCorrespondant(
  gmail: gmail_v1.Gmail,
  requete: string,
): Promise<Set<string>> {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  let patience = 0;

  do {
    try {
      const { data } = await gmail.users.threads.list({
        userId: 'me',
        q: requete,
        maxResults: PAR_PAGE,
        ...(pageToken ? { pageToken } : {}),
      });

      for (const fil of data.threads ?? []) if (fil.id) ids.add(fil.id);
      pageToken = data.nextPageToken ?? undefined;
      patience = 0;
    } catch (error) {
      const limite = /rateLimitExceeded|Quota exceeded|429/i.test(
        error instanceof Error ? error.message : String(error),
      );
      if (!limite || patience >= 3) throw error;

      patience += 1;
      const attente = patience * 30_000;
      console.log(`    quota Gmail atteint, reprise dans ${attente / 1000} s…`);
      await dormir(attente);
    }
  } while (pageToken);

  return ids;
}

interface Boite {
  merchantId: string;
  mailboxId: string | null;
  fils: number;
}

async function boites(): Promise<Boite[]> {
  const groupes = await prisma.ticket.groupBy({
    by: ['merchantId', 'mailboxId'],
    where: PORTEE_NON_LU,
    _count: { _all: true },
  });

  return groupes.map((groupe) => ({
    merchantId: groupe.merchantId,
    mailboxId: groupe.mailboxId,
    fils: groupe._count._all,
  }));
}

async function main(): Promise<void> {
  const simulation = process.argv.includes('--simulation');

  const liste = await boites();
  if (liste.length === 0) {
    console.log('Aucun fil à reprendre.');
    return;
  }

  const avant = await prisma.ticket.count({ where: { ...PORTEE_NON_LU, gmailUnread: true } });
  console.log(
    simulation
      ? 'Simulation — Gmail est interrogé, la base n’est pas touchée.\n'
      : 'Reprise de l’état Gmail.\n',
  );
  console.log(`  Boîtes concernées   : ${liste.length}`);
  console.log(`  Comptés « non lus » : ${avant}\n`);

  const injoignables: string[] = [];
  let corriges = 0;

  for (const boite of liste) {
    const nom = boite.mailboxId ?? `${boite.merchantId} (boîte par défaut)`;
    console.log(`  ${nom} — ${boite.fils} fil(s)`);

    let nonLus: Set<string>;
    let enReception: Set<string>;

    try {
      const { gmail } = await getGmailClient(boite.merchantId, boite.mailboxId);
      nonLus = await filsCorrespondant(gmail, 'is:unread');
      enReception = await filsCorrespondant(gmail, 'in:inbox');
    } catch (error) {
      console.error(`    ✗ injoignable : ${error instanceof Error ? error.message : error}`);
      injoignables.push(nom);
      continue;
    }

    console.log(`    Gmail : ${nonLus.size} non lu(s), ${enReception.size} en réception`);

    const portee = {
      ...PORTEE_NON_LU,
      merchantId: boite.merchantId,
      mailboxId: boite.mailboxId,
    };

    const devraientEtreNonLus = await prisma.ticket.count({
      where: { ...portee, gmailThreadId: { in: [...nonLus] } },
    });
    const sontNonLus = await prisma.ticket.count({ where: { ...portee, gmailUnread: true } });

    console.log(`    En base : ${sontNonLus} non lu(s) → ${devraientEtreNonLus} après reprise`);
    corriges += Math.abs(sontNonLus - devraientEtreNonLus);

    if (simulation) continue;

    /*
     * Remise à plat puis pose de la vérité, en une transaction.
     *
     * Gmail dit qui est non lu et qui est en réception ; tout le reste est,
     * par déduction, lu et archivé. Écrire d'abord la déduction sur toute la
     * boîte puis corriger la minorité coûte trois requêtes au lieu d'une par
     * fil. Hors transaction, le compteur se lirait à zéro entre les deux.
     */
    await prisma.$transaction([
      prisma.ticket.updateMany({
        where: portee,
        data: { gmailUnread: false, gmailArchived: true },
      }),
      ...morceaux([...nonLus], PAR_LOT_SQL).map((lot) =>
        prisma.ticket.updateMany({
          where: { ...portee, gmailThreadId: { in: lot } },
          data: { gmailUnread: true },
        }),
      ),
      ...morceaux([...enReception], PAR_LOT_SQL).map((lot) =>
        prisma.ticket.updateMany({
          where: { ...portee, gmailThreadId: { in: lot } },
          data: { gmailArchived: false },
        }),
      ),
    ]);

    console.log('    ✓ appliqué');
  }

  const apres = await prisma.ticket.count({ where: { ...PORTEE_NON_LU, gmailUnread: true } });

  console.log(`\n${simulation ? 'Simulation terminée.' : 'Terminée.'}\n`);
  console.log(`  Comptés « non lus » : ${avant} → ${apres}`);
  if (simulation) console.log(`  (aucune écriture — ${corriges} ligne(s) seraient changées)`);

  if (injoignables.length > 0) {
    console.log(`\n  ⚠ ${injoignables.length} boîte(s) injoignable(s), à reconnecter :`);
    for (const nom of injoignables) console.log(`      ${nom}`);
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
