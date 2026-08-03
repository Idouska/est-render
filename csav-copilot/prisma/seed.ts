/**
 * Jeu de données de démarrage : une boutique fictive et six tickets couvrant
 * les cas qui comptent — commande identifiée, litige transporteur, ambiguïté
 * non tranchée, demande de remboursement, retour, message positif.
 *
 * À lancer avec `npm run db:seed`. Idempotent : relançable sans doublon.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SHOP = 'atelier-lumen.myshopify.com';

// Décalages en minutes par rapport à maintenant, pour que la file reste
// crédible quel que soit le jour où la démo est lancée.
const minutesAgo = (n: number) => new Date(Date.now() - n * 60 * 1000);

const tickets = [
  {
    key: 'thread-10428',
    customerEmail: 'lea.fontaine@gmail.com',
    customerName: 'Léa Fontaine',
    subject: 'Toujours pas reçu ma commande',
    intent: 'WISMO' as const,
    intentConfidence: 0.93,
    status: 'DRAFT_READY' as const,
    shopifyOrderId: 'gid://shopify/Order/10428',
    orderName: '#10428',
    orderMatchMethod: 'ORDER_NUMBER_IN_BODY' as const,
    orderMatchScore: 0.99,
    receivedMinutesAgo: 12,
    body:
      "Bonjour,\n\nJ'ai commandé le 3 février et je n'ai toujours rien reçu. " +
      "Le suivi n'a pas bougé depuis une semaine. Pouvez-vous me dire où en est ma commande #10428 ?\n\nMerci,\nLéa",
    draft: {
      confidence: 0.93,
      reasoning:
        "Commande identifiée par le numéro cité et confirmée par l'adresse de l'expéditrice. Suivi et estimation issus de Shopify.",
      body:
        "Bonjour Léa,\n\nVotre commande #10428 a bien été expédiée le 5 février par Colissimo, " +
        "sous le numéro de suivi 6A18492037561. Le dernier passage enregistré date du 8 février " +
        "au centre de tri, et la livraison est estimée au 12 février.\n\n" +
        "Ce type d'arrêt d'affichage est fréquent entre deux passages en centre de tri. Si rien ne bouge " +
        "d'ici le 13, écrivez-nous : nous ouvrirons une enquête auprès de Colissimo et vous renverrons " +
        "la commande sans frais.\n\nBien à vous,\nL'équipe Atelier Lumen",
    },
  },
  {
    key: 'thread-10391',
    customerEmail: 'm.delaunay@orange.fr',
    customerName: 'Marc Delaunay',
    subject: "Colis annoncé livré mais je n'ai rien",
    intent: 'DISPUTE' as const,
    intentConfidence: 0.88,
    status: 'NEEDS_REVIEW' as const,
    shopifyOrderId: 'gid://shopify/Order/10391',
    orderName: '#10391',
    orderMatchMethod: 'CUSTOMER_EMAIL' as const,
    orderMatchScore: 0.95,
    receivedMinutesAgo: 38,
    body:
      "Bonjour, le suivi indique « livré » depuis hier 14h mais je n'ai rien reçu, " +
      "ni dans la boîte aux lettres ni chez les voisins. J'étais chez moi toute la journée. Que fait-on ?",
    draft: {
      confidence: 0.62,
      reasoning:
        "Litige transporteur : la suite dépend d'une réclamation et éventuellement d'un geste commercial. Ces décisions ne s'automatisent pas.",
      body:
        "Bonjour Marc,\n\nJe comprends, le suivi de votre commande #10391 indique bien une livraison " +
        "hier à 14 h 02 par Mondial Relay.\n\nAvant d'aller plus loin, deux vérifications utiles : " +
        "le colis a-t-il pu être déposé en point relais plutôt qu'à votre adresse, et avez-vous reçu " +
        "un avis de passage ? Si ce n'est pas le cas, nous ouvrons dès aujourd'hui une réclamation " +
        "auprès du transporteur.\n\nDites-nous ce qu'il en est et nous enchaînons immédiatement.\n\n" +
        "Bien à vous,\nL'équipe Atelier Lumen",
    },
  },
  {
    key: 'thread-ambigu',
    customerEmail: 'julien.meyer91@gmail.com',
    customerName: 'Julien Meyer',
    subject: 'Où en est ma commande ?',
    intent: 'WISMO' as const,
    intentConfidence: 0.91,
    status: 'NEEDS_REVIEW' as const,
    // Volontairement vide : trois commandes correspondent, aucune n'a été
    // retenue. C'est le cas que le brief demandait de ne jamais deviner.
    shopifyOrderId: null,
    orderName: null,
    orderMatchMethod: 'CUSTOMER_EMAIL' as const,
    orderMatchScore: null,
    receivedMinutesAgo: 64,
    body:
      "Bonjour, je voudrais savoir où en est ma commande s'il vous plaît. Merci d'avance.",
    draft: {
      confidence: 0.42,
      reasoning:
        "Trois commandes correspondent à cette adresse et aucune n'est certaine. Le brouillon demande une précision plutôt que de choisir à la place du client.",
      body:
        "Bonjour Julien,\n\nJe retrouve trois commandes à votre nom et je préfère ne pas me tromper : " +
        "pouvez-vous m'indiquer le numéro figurant dans votre e-mail de confirmation, ou l'adresse " +
        "utilisée lors de l'achat ?\n\nJe vous réponds dès réception.\n\nBien à vous,\nL'équipe Atelier Lumen",
    },
  },
  {
    key: 'thread-10375',
    customerEmail: 'a.rousseau@free.fr',
    customerName: 'Amélie Rousseau',
    subject: 'Abat-jour fêlé — remboursement',
    intent: 'REFUND' as const,
    intentConfidence: 0.94,
    status: 'NEEDS_REVIEW' as const,
    shopifyOrderId: 'gid://shopify/Order/10375',
    orderName: '#10375',
    orderMatchMethod: 'CUSTOMER_EMAIL' as const,
    orderMatchScore: 0.95,
    receivedMinutesAgo: 124,
    body:
      "Bonjour,\n\nJ'ai reçu ma lampe hier, l'abat-jour en verre est fêlé sur tout un côté. " +
      "Le carton était intact. Je ne souhaite pas d'échange, je préfère être remboursée.\n\n" +
      "Photos en pièce jointe.\n\nAmélie Rousseau",
    draft: {
      confidence: 0.71,
      reasoning:
        "Le remboursement paraît justifié mais il engage de l'argent : le brouillon l'annonce, c'est à vous de déclencher l'opération.",
      body:
        "Bonjour Amélie,\n\nMerci pour les photos, la fêlure est nette et il n'y a pas de discussion à avoir : " +
        "nous vous remboursons la commande #10375, soit 96,00 €.\n\nLe remboursement part sur votre carte " +
        "aujourd'hui et met deux à cinq jours ouvrés à apparaître selon votre banque. Vous n'avez pas besoin " +
        "de nous renvoyer la lampe.\n\nDésolés pour ce défaut, et merci de nous l'avoir signalé si clairement.\n\n" +
        "Bien à vous,\nL'équipe Atelier Lumen",
    },
  },
  {
    key: 'thread-10402',
    customerEmail: 'sophie.nguyen@laposte.net',
    customerName: 'Sophie Nguyen',
    subject: 'Retour — mauvaise finition commandée',
    intent: 'RETURN' as const,
    intentConfidence: 0.9,
    status: 'DRAFT_READY' as const,
    shopifyOrderId: 'gid://shopify/Order/10402',
    orderName: '#10402',
    orderMatchMethod: 'ORDER_NUMBER_IN_BODY' as const,
    orderMatchScore: 0.99,
    receivedMinutesAgo: 190,
    body:
      "Bonjour, je me suis trompée de finition, j'ai pris le laiton alors que je voulais le noir. " +
      "Comment faire pour l'échanger ? Commande 10402.",
    draft: {
      confidence: 0.88,
      reasoning:
        'Commande identifiée par le numéro cité, dans les délais de retour. Réponse standard sans engagement financier.',
      body:
        "Bonjour Sophie,\n\nAucun problème. Votre commande #10402 a été livrée le 7 février, " +
        "vous êtes donc dans les délais de retour.\n\nRenvoyez-nous l'applique dans son emballage " +
        "d'origine à l'adresse indiquée sur votre bon de livraison. Dès réception, nous expédions " +
        "la version noir mat ; s'il reste une différence de prix, nous l'ajustons à ce moment-là.\n\n" +
        "Bien à vous,\nL'équipe Atelier Lumen",
    },
  },
  {
    key: 'thread-merci',
    customerEmail: 'thomas.girard@gmail.com',
    customerName: 'Thomas Girard',
    subject: 'Merci pour la rapidité',
    intent: 'POSITIVE' as const,
    intentConfidence: 0.97,
    status: 'NEEDS_REVIEW' as const,
    shopifyOrderId: null,
    orderName: null,
    orderMatchMethod: null,
    orderMatchScore: null,
    receivedMinutesAgo: 1080,
    body:
      "Juste un mot pour vous remercier, commande reçue en 48 h et l'emballage était impeccable. Bravo !",
    // Aucun brouillon : un remerciement n'appelle pas de réponse automatique.
    draft: null,
  },
];

async function main(): Promise<void> {
  const merchant = await prisma.merchant.upsert({
    where: { shopDomain: SHOP },
    create: { shopDomain: SHOP, name: 'Atelier Lumen', status: 'ACTIVE' },
    update: { name: 'Atelier Lumen', status: 'ACTIVE' },
  });

  const user = await prisma.user.upsert({
    where: { merchantId_email: { merchantId: merchant.id, email: 'claire@atelier-lumen.fr' } },
    create: {
      merchantId: merchant.id,
      email: 'claire@atelier-lumen.fr',
      name: 'Claire Mercier',
      role: 'OWNER',
    },
    update: { name: 'Claire Mercier' },
  });

  for (const seed of tickets) {
    const receivedAt = minutesAgo(seed.receivedMinutesAgo);

    const ticket = await prisma.ticket.upsert({
      where: { merchantId_gmailThreadId: { merchantId: merchant.id, gmailThreadId: seed.key } },
      create: {
        merchantId: merchant.id,
        gmailThreadId: seed.key,
        subject: seed.subject,
        customerEmail: seed.customerEmail,
        customerName: seed.customerName,
        intent: seed.intent,
        intentConfidence: seed.intentConfidence,
        status: seed.status,
        shopifyOrderId: seed.shopifyOrderId,
        orderName: seed.orderName,
        orderMatchMethod: seed.orderMatchMethod,
        orderMatchScore: seed.orderMatchScore,
        lastMessageAt: receivedAt,
      },
      update: {
        status: seed.status,
        intent: seed.intent,
        intentConfidence: seed.intentConfidence,
        shopifyOrderId: seed.shopifyOrderId,
        orderName: seed.orderName,
        lastMessageAt: receivedAt,
      },
    });

    await prisma.message.upsert({
      where: {
        merchantId_gmailMessageId: { merchantId: merchant.id, gmailMessageId: `${seed.key}-msg-1` },
      },
      create: {
        merchantId: merchant.id,
        ticketId: ticket.id,
        gmailMessageId: `${seed.key}-msg-1`,
        direction: 'INBOUND',
        fromEmail: seed.customerEmail,
        toEmail: 'sav@atelier-lumen.fr',
        subject: seed.subject,
        bodyText: seed.body,
        snippet: seed.body.slice(0, 120),
        receivedAt,
      },
      update: { bodyText: seed.body, receivedAt },
    });

    const existingDraft = await prisma.draft.findFirst({ where: { ticketId: ticket.id } });

    if (seed.draft && !existingDraft) {
      await prisma.draft.create({
        data: {
          merchantId: merchant.id,
          ticketId: ticket.id,
          gmailDraftId: `seed-draft-${seed.key}`,
          body: seed.draft.body,
          model: 'claude-opus-5',
          confidence: seed.draft.confidence,
          reasoning: seed.draft.reasoning,
          status: 'PENDING_REVIEW',
          createdBy: 'AI',
        },
      });
    }
  }

  // Fournisseur unique + une escalade déjà en cours, sur le ticket Marc
  // Delaunay (#10391) — c'est la commande dont l'adresse mock est
  // volontairement incomplète (voir services/shopify/mock.ts).
  const supplier = await prisma.supplier.upsert({
    where: { merchantId: merchant.id },
    create: {
      merchantId: merchant.id,
      name: 'Atelier Nord',
      contactEmail: 'contact@atelier-nord.example',
    },
    update: {},
  });

  const disputeTicket = await prisma.ticket.findFirst({
    where: { merchantId: merchant.id, gmailThreadId: 'thread-10391' },
  });

  if (disputeTicket) {
    const existingEscalation = await prisma.supplierEscalation.findFirst({
      where: { ticketId: disputeTicket.id },
    });

    if (!existingEscalation) {
      await prisma.supplierEscalation.create({
        data: {
          merchantId: merchant.id,
          ticketId: disputeTicket.id,
          supplierId: supplier.id,
          reason: 'INCORRECT_ADDRESS',
          note: 'Le numéro de rue manque, à confirmer avant réexpédition.',
          status: 'OPEN',
          notifiedAt: minutesAgo(20),
          messages: {
            create: {
              merchantId: merchant.id,
              direction: 'TO_SUPPLIER',
              authorType: 'AI',
              body:
                'Bonjour,\n\nPouvez-vous confirmer le numéro de rue pour la commande #10391 ' +
                '(Applique Halo) avant réexpédition ? L\'adresse actuelle indique ' +
                '« Résidence Les Tilleuls » sans numéro.\n\nMerci,\nAtelier Lumen',
            },
          },
        },
      });
    }
  }

  const auditCount = await prisma.auditLog.count({ where: { merchantId: merchant.id } });
  if (auditCount === 0) {
    await prisma.auditLog.createMany({
      data: [
        {
          merchantId: merchant.id,
          actorType: 'SYSTEM',
          action: 'shopify.connected',
          metadata: { shopDomain: SHOP },
        },
        {
          merchantId: merchant.id,
          actorType: 'SYSTEM',
          action: 'gmail.connected',
          metadata: { emailAddress: 'sav@atelier-lumen.fr' },
        },
        {
          merchantId: merchant.id,
          actorType: 'AI',
          action: 'draft.created',
          metadata: { intent: 'WISMO', orderName: '#10428', draftConfidence: 0.93 },
        },
      ],
    });
  }

  console.log(`Boutique de démonstration prête : ${merchant.name} (${merchant.shopDomain})`);
  console.log(`Utilisateur : ${user.email}`);
  console.log(`${tickets.length} tickets insérés.`);
  console.log('\nOuvrez http://localhost:3000/dev/login pour entrer dans le dashboard.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
