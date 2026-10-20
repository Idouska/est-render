import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Intent, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.ts';
import { lignesArticle, MOTIFS_SIGNALEMENT } from '../suppliers/signalement.ts';
import { CLIENTS, clientDemo, commandesDemo, DEMO, orderIdDemo, produitDemo, PRODUITS, scenariosColis, skuDemo } from './catalogue.ts';
import { MAILS, type MailDemo } from './mails.ts';
import { NUMEROS_RETOUR_DEMO } from './suivi.ts';

/*
 * (Re)crée la boutique de démonstration, de zéro.
 *
 * Tout ce qui appartient au marchand de démo est effacé — les suppressions en
 * cascade du schéma s'en chargent — puis réécrit. Les identifiants du
 * marchand et de ses comptes sont fixes : une session ouverte sur la démo
 * reste valable après une réinitialisation.
 */

const MINUTE = 60_000;
const HEURE = 60 * MINUTE;
const JOUR = 24 * HEURE;

const IMAGES = join(dirname(fileURLToPath(import.meta.url)), '../../../public/demo');
const image = (nom: string): Uint8Array<ArrayBuffer> => new Uint8Array(readFileSync(join(IMAGES, `${nom}.svg`)));

const PLAYBOOK = `Kairo — baskets et vêtements, préparés et expédiés par notre atelier partenaire.

Livraison : préparation 2 à 4 jours ouvrés, puis 6 à 9 jours de transport (YunExpress). Offerte dès 60 €, sinon 4,90 €. Livraison en France, Belgique, Suisse et Espagne.
Retours : 30 jours après réception, article non porté, dans sa boîte. Étiquette de retour envoyée par mail. Remboursement sous 5 jours après réception et contrôle.
Échanges : gratuits (taille ou coloris). Différence de prix réglée par lien de paiement si le nouveau modèle est plus cher.
Défauts : photo demandée ; remplacement ou remboursement au choix du client.
Code BIENVENUE10 : 10 % sur la première commande.`;

/** Les comptes de l'équipe, pour les statistiques par personne. */
const EQUIPE = [
  { ...DEMO.proprietaire, role: 'OWNER' as const },
  { ...DEMO.agents[0], role: 'SUPERVISOR' as const },
  { ...DEMO.agents[1], role: 'AGENT' as const },
];
const agentId = (cle?: 'hugo' | 'maelle'): string | null =>
  cle === 'hugo' ? DEMO.agents[0].id : cle === 'maelle' ? DEMO.agents[1].id : null;

export async function preparerDemo(maintenant = Date.now()): Promise<{ merchantId: string; tickets: number }> {
  const il = (minutes: number) => new Date(maintenant - minutes * MINUTE);
  const ilJ = (jours: number) => new Date(maintenant - jours * JOUR);
  const commandes = commandesDemo(maintenant);
  const commande = (numero: number) => commandes.find((c) => c.name === `#${numero}`)!;
  const id = DEMO.merchantId;

  await prisma.merchant.deleteMany({ where: { id } });
  await prisma.merchant.create({
    data: {
      id,
      shopDomain: DEMO.shopDomain,
      name: DEMO.marque,
      brandName: DEMO.marque,
      demo: true,
      testMode: true,
      playbook: PLAYBOOK,
      emailSignature: 'Inès — Service client Kairo',
      slaHours: 24,
      envoiMode: 'MANUEL',
      envoiDepuis: ilJ(30),
      coutsSav: { bonRetour: 6.5, fraisAgence: 3, colisAgence: 7.9, colisAtelier: 9.5, prixPaire: 38 },
    },
  });

  await prisma.user.createMany({
    data: EQUIPE.map((membre, rang) => ({
      id: membre.id,
      merchantId: id,
      email: membre.email,
      name: membre.name,
      role: membre.role,
      createdAt: ilJ(120 - rang * 20),
      lastLoginAt: il(rang * 90 + 5),
    })),
  });

  /* ------------------------------------------------- ateliers et agences */
  const lianhua = 'demo-kairo-lianhua';
  const fenix = 'demo-kairo-fenix';
  await prisma.supplier.createMany({
    data: [
      {
        id: lianhua, merchantId: id, name: 'Atelier Lianhua', contactEmail: 'atelier@lianhua-demo.test', contactName: 'M. Chen',
        phone: '+86 20 8888 1234', langue: 'zh', isDefault: true, vendors: [DEMO.marque], skuPrefixes: [], createdAt: ilJ(110),
        notes: 'Atelier principal : prépare et expédie toutes les baskets.',
      },
      {
        id: fenix, merchantId: id, name: 'Atelier Fenix', contactEmail: 'orders@fenix-demo.test', contactName: 'Ana Costa',
        phone: '+351 22 123 4567', langue: 'en', vendors: [], skuPrefixes: ['KR-SWE', 'KR-CHA'], createdAt: ilJ(80),
        notes: 'Textile et accessoires.',
      },
    ],
  });
  const agenceParis = 'demo-kairo-agence-fr';
  await prisma.returnAgency.createMany({
    data: [
      { id: agenceParis, merchantId: id, country: 'FR', name: 'Agence Retours Paris', email: 'retours-paris@kairo-demo.test', phone: '+33 1 84 00 00 00', address: '14 rue des Entrepôts\n93200 Saint-Denis' },
      { id: 'demo-kairo-agence-be', merchantId: id, country: 'BE', name: 'Agence Retours Bruxelles', email: 'retours-bxl@kairo-demo.test', address: 'Rue de l’Industrie 8\n1000 Bruxelles' },
    ],
  });

  await prisma.cannedReply.createMany({
    data: [
      { title: 'Délais de livraison', intent: 'WISMO', useCount: 41, body: 'Bonjour {prénom},\n\nVotre commande est préparée sous 2 à 4 jours ouvrés, puis livrée en 6 à 9 jours. Vous recevez le numéro de suivi dès l’expédition.' },
      { title: 'Étiquette de retour', intent: 'RETURN', useCount: 23, body: 'Bonjour {prénom},\n\nVous trouverez ci-joint votre étiquette de retour prépayée. Déposez le colis dans un bureau de poste sous 14 jours.' },
      { title: 'Échange de taille', intent: 'RETURN', useCount: 18, body: 'Bonjour {prénom},\n\nL’échange de taille est gratuit : renvoyez-nous la paire avec l’étiquette jointe, la nouvelle taille part dès réception.' },
      { title: 'Délai de remboursement', intent: 'REFUND', useCount: 12, body: 'Bonjour {prénom},\n\nLe remboursement a été émis. Selon votre banque, il apparaît sous 3 à 10 jours ouvrés.' },
      { title: 'Guide des tailles', intent: 'PRODUCT_QUESTION', useCount: 9, body: 'Bonjour {prénom},\n\nNos modèles taillent normalement. Entre deux tailles, prenez la plus grande pour la Runner 01 et la Trail X.' },
    ].map((reponse) => ({ ...reponse, intent: reponse.intent as Intent, merchantId: id })),
  });

  /* ---------------------------------------------------------- mails ouverts */
  const ticketDe = new Map<string, string>();
  for (const [rang, mail] of MAILS.entries()) {
    ticketDe.set(mail.cle, await creerFil(mail, rang));
  }

  async function creerFil(mail: MailDemo, rang: number): Promise<string> {
    const client = CLIENTS.find((c) => c.nom === mail.client);
    const email = mail.email ?? client!.email;
    const ticketId = `demo-t-${mail.cle}`;
    const dernier = mail.messages.at(-1)!;
    const premier = mail.messages[0]!;
    const cmd = mail.commande ? commande(mail.commande) : null;
    await prisma.ticket.create({
      data: {
        id: ticketId,
        merchantId: id,
        gmailThreadId: `demo-${mail.cle}`,
        subject: mail.sujet,
        customerEmail: email,
        customerName: mail.client,
        intent: mail.intent,
        intentConfidence: mail.confiance,
        status: mail.statut,
        shopifyOrderId: cmd?.id ?? null,
        orderName: cmd?.name ?? null,
        orderMatchMethod: cmd ? (mail.match ?? 'CUSTOMER_EMAIL') : null,
        orderMatchScore: cmd ? 0.97 : null,
        orderTotal: cmd ? cmd.total : null,
        assignedToId: agentId(mail.assigne),
        language: mail.langue ?? 'fr',
        dueAt: new Date(il(premier.il).getTime() + 24 * HEURE),
        gmailUnread: !mail.lu,
        openedAt: mail.lu ? il(dernier.il - 5) : null,
        lastMessageAt: il(dernier.il),
        threadSyncedAt: new Date(maintenant),
        createdAt: il(premier.il),
        messages: {
          create: mail.messages.map((message, n) => ({
            id: `${ticketId}-m${n}`,
            merchantId: id,
            gmailMessageId: `demo-${mail.cle}-${n}`,
            direction: message.sens === 'in' ? 'INBOUND' : 'OUTBOUND',
            fromEmail: message.sens === 'in' ? email : 'sav@kairo-demo.test',
            toEmail: message.sens === 'in' ? 'sav@kairo-demo.test' : email,
            subject: n === 0 ? mail.sujet : `Re: ${mail.sujet.replace(/^Re: /, '')}`,
            bodyText: message.corps,
            snippet: message.corps.replace(/\s+/g, ' ').slice(0, 160),
            receivedAt: il(message.il),
            createdAt: il(message.il),
          })),
        },
      },
    });

    if (mail.photos?.length) {
      const messageId = `${ticketId}-m${mail.messages.length - 1}`;
      await prisma.attachment.createMany({
        data: mail.photos.map((nom, n) => {
          const data = image(nom);
          return { merchantId: id, messageId, filename: `photo-${n + 1}.svg`, mimeType: 'image/svg+xml', size: data.byteLength, data };
        }),
      });
    }

    if (mail.brouillon) {
      await prisma.draft.create({
        data: {
          merchantId: id,
          ticketId,
          gmailDraftId: `demo-draft-${rang}`,
          body: mail.brouillon.corps,
          model: 'demo',
          confidence: mail.brouillon.confiance,
          reasoning: mail.brouillon.raisonnement,
          summary: mail.brouillon.resume,
          ask: mail.brouillon.demande,
          createdAt: il(dernier.il - 1),
        },
      });
    }
    return ticketId;
  }

  /* ------------------------------------------- deux mois d'historique (stats) */
  const historique = historiqueDemo(maintenant);
  await prisma.ticket.createMany({ data: historique.tickets });
  await prisma.message.createMany({ data: historique.messages });
  await prisma.draft.createMany({ data: historique.brouillons });
  await prisma.auditLog.createMany({ data: historique.journal });

  /* ------------------------------------------------- colis et lots de l'atelier */
  const scenarios = scenariosColis();
  await prisma.parcel.createMany({
    data: [...scenarios.entries()].map(([numero, scenario]) => ({
      merchantId: id,
      shopifyOrderId: orderIdDemo(scenario.numero),
      orderName: `#${scenario.numero}`,
      trackingNumber: numero,
      carrier: scenario.transporteur,
      index: 1,
      total: 1,
      createdAt: ilJ(scenario.expedie),
    })),
  });

  // Les lots envoyés à l'atelier : ceux des jours passés, et celui d'hier,
  // encore en préparation. Ce qui reste partira dans le lot du jour.
  const lots: Array<{ jours: number; numeros: number[] }> = [
    { jours: 13, numeros: [4116, 4117, 4118, 4119, 4120] },
    { jours: 10, numeros: [4121, 4122, 4123, 4124, 4125] },
    { jours: 7, numeros: [4126, 4127, 4128, 4129, 4130, 4131] },
    { jours: 4, numeros: [4132, 4133] },
    { jours: 3, numeros: [4134] },
    { jours: 1, numeros: [4135, 4136, 4137, 4138] },
  ];
  for (const [rang, lot] of lots.entries()) {
    await prisma.envoiFournisseur.create({
      data: {
        id: `demo-lot-${rang}`,
        merchantId: id,
        supplierId: lianhua,
        mode: 'MANUEL',
        userId: DEMO.proprietaire.id,
        combien: lot.numeros.length,
        emailedAt: new Date(ilJ(lot.jours).getTime() + 2 * HEURE),
        simule: true,
        createdAt: ilJ(lot.jours),
        commandes: {
          create: lot.numeros.map((numero) => ({
            merchantId: id,
            shopifyOrderId: orderIdDemo(numero),
            orderName: `#${numero}`,
            articles: commande(numero).items.map((item) => `${item.quantity} × ${item.title} — ${item.variantTitle}`).join('\n'),
          })),
        },
      },
    });
  }

  /* --------------------------------------- demandes à l'atelier (Modification, Update) */
  const alerte = (data: Omit<Prisma.SupplierAlertUncheckedCreateInput, 'merchantId'>) =>
    prisma.supplierAlert.create({ data: { merchantId: id, createdById: DEMO.proprietaire.id, ...data } });

  await alerte({
    supplierId: lianhua, kind: 'ADDRESS', shopifyOrderId: orderIdDemo(4138), orderName: '#4138', ticketId: ticketDe.get('modif-sophie'),
    message: 'Nouvelle adresse de livraison : 12 rue Oberkampf, 75011 Paris.',
    beforeValue: '48 rue Lafayette, 75009 Paris', afterValue: '12 rue Oberkampf, 75011 Paris', createdAt: il(12),
  });
  await alerte({
    supplierId: lianhua, kind: 'SIZE', shopifyOrderId: orderIdDemo(4137), orderName: '#4137', ticketId: ticketDe.get('modif-lucas'),
    message: 'Changer la pointure : Runner 01 Noir / Rouge en 43 au lieu de 42.', beforeValue: '42', afterValue: '43',
    status: 'ACKNOWLEDGED', supplierNote: '已改为43码 — taille modifiée, 43.', createdAt: il(3 * 60), acknowledgedAt: il(95), emailedAt: il(3 * 60 - 2),
  });
  await alerte({
    supplierId: lianhua, kind: 'CANCEL', shopifyOrderId: orderIdDemo(4135), orderName: '#4135', ticketId: ticketDe.get('remb-bilal'),
    message: 'Annuler la commande : le client s’est trompé de coloris. Ne pas expédier.', createdAt: il(40), emailedAt: il(39),
  });
  // Update : une demande en attente (à relancer), une répondue, une close.
  await alerte({
    supplierId: lianhua, kind: 'TRACKING', shopifyOrderId: orderIdDemo(4118), orderName: '#4118', ticketId: ticketDe.get('wismo-mehdi'),
    message: 'Le colis de la commande #4118 ne bouge plus depuis 9 jours (dernier scan : arrivée à Roissy). Pouvez-vous vérifier avec le transporteur ?',
    createdAt: il(3 * 1440 + 80), emailedAt: il(3 * 1440 + 79),
  });
  await alerte({
    supplierId: lianhua, kind: 'TRACKING', shopifyOrderId: orderIdDemo(4121), orderName: '#4121',
    message: 'Le colis de la commande #4121 ne bouge plus depuis 5 jours. Où en est-il ?',
    status: 'ACKNOWLEDGED', supplierNote: '包裹在海关，明天放行 — Colis en douane, libéré demain.', createdAt: il(1440 + 300), acknowledgedAt: il(400), emailedAt: il(1440 + 299),
  });
  await alerte({
    supplierId: lianhua, kind: 'TRACKING', shopifyOrderId: orderIdDemo(4124), orderName: '#4124',
    message: 'Le colis de la commande #4124 ne bouge plus. Pouvez-vous vérifier ?',
    status: 'ACKNOWLEDGED', supplierNote: 'Transporteur relancé : nouvelle tentative de livraison prévue.', createdAt: il(2 * 1440), acknowledgedAt: il(1440 + 600), handledAt: il(1440 + 100),
  });

  // Une erreur de préparation remontée à l'atelier, avec son fil.
  await prisma.supplierEscalation.create({
    data: {
      merchantId: id, ticketId: ticketDe.get('litige-theo')!, supplierId: lianhua, reason: 'MISSING_ITEM', status: 'OPEN',
      note: 'Le client a reçu des Court Low Blanc au lieu des Runner 01 Noir / Rouge en 42.',
      createdAt: il(1440 + 420), notifiedAt: il(1440 + 410),
      messages: {
        create: [{
          merchantId: id, direction: 'TO_SUPPLIER', authorType: 'HUMAN', createdAt: il(1440 + 410),
          body: 'Bonjour, erreur de préparation sur la commande #4112 : le client a reçu des Court Low Blanc au lieu des Runner 01 Noir / Rouge en 42. Pouvez-vous expédier la bonne paire aujourd’hui ? Merci.',
        }],
      },
    },
  });

  /* ----------------------------------------- ruptures signalées par l'atelier */
  const ruptures = [
    { numero: 4136, cle: 'trail', coloris: 0, taille: '43', note: 'Plus de 43 en kaki, réassort dans 10 jours.', il: 5 * 60 },
    { numero: 4134, cle: 'street', coloris: 1, taille: '41', note: '沙色41码缺货 — plus de Sable en 41.', il: 26 * 60 },
  ];
  for (const rupture of ruptures) {
    const cmd = commande(rupture.numero);
    const produit = produitDemo(rupture.cle);
    const fil = `supplier:${lianhua}:${cmd.id}:STOCK`;
    const sujet = `${MOTIFS_SIGNALEMENT.STOCK.libelle} — ${cmd.name}`;
    const detail = lignesArticle({
      produit: produit.titre,
      couleur: produit.coloris[rupture.coloris]!.nom,
      taille: rupture.taille,
      reference: skuDemo(rupture.cle, rupture.coloris, rupture.taille),
      quantite: 1,
    });
    await prisma.ticket.create({
      data: {
        merchantId: id, gmailThreadId: fil, subject: sujet, customerEmail: cmd.customerEmail, customerName: 'Atelier Lianhua',
        status: 'NEEDS_REVIEW', intent: 'OTHER', shopifyOrderId: cmd.id, orderName: cmd.name, orderTotal: cmd.total,
        lastMessageAt: il(rupture.il), createdAt: il(rupture.il), threadSyncedAt: new Date(maintenant),
        messages: {
          create: [{
            merchantId: id, gmailMessageId: `${fil}:${rupture.il}`, direction: 'INBOUND', fromEmail: `fournisseur+${lianhua}@local`,
            subject: sujet, snippet: rupture.note, receivedAt: il(rupture.il),
            bodyText: ['Signalé par Atelier Lianhua depuis l\'atelier.', '', detail.join('\n'), '', rupture.note].join('\n'),
          }],
        },
      },
    });
  }

  /* ------------------------------------------------------------- retours */
  const retour = async (
    data: Omit<Prisma.ReturnCaseUncheckedCreateInput, 'merchantId'>,
    photos: Array<{ source: string; image: string }> = [],
  ) => {
    const cas = await prisma.returnCase.create({ data: { merchantId: id, ...data } });
    if (photos.length) {
      await prisma.returnPhoto.createMany({
        data: photos.map((photo, n) => ({
          merchantId: id, returnCaseId: cas.id, source: photo.source, data: image(photo.image), mime: 'image/svg+xml',
          createdAt: new Date((data.receivedAt as Date | undefined)?.getTime() ?? maintenant - n * MINUTE),
        })),
      });
    }
    return cas;
  };
  const infosClient = (numero: number) => {
    const cmd = commande(numero);
    const client = clientDemo(cmd.customerName);
    return {
      orderName: cmd.name, shopifyOrderId: cmd.id, customerName: client.nom, customerEmail: client.email,
      customerPhone: client.tel, country: client.pays, devise: 'EUR',
    };
  };

  await retour({
    ...infosClient(4109), productTitle: 'Kairo Runner 01', variantTitle: 'Blanc / Gris / 39', sku: skuDemo('runner', 0, '39'),
    wantedTitle: 'Kairo Runner 01', wantedVariantTitle: 'Blanc / Gris / 40', wantedSku: skuDemo('runner', 0, '40'),
    prixRetour: 129, prixVoulu: 129, ecartPrix: 0, reason: 'SIZE', resolution: 'EXCHANGE', status: 'OPEN', createdAt: il(15), lastContactAt: il(22),
  });
  await retour({
    ...infosClient(4105), productTitle: 'Kairo Trail X', variantTitle: 'Noir / 44', sku: skuDemo('trail', 1, '44'), prixRetour: 149,
    reason: 'MODEL', resolution: 'REFUND', status: 'LABEL_SENT', labelSent: true, labelSentAt: il(150), createdAt: il(170), lastContactAt: il(150),
  });
  await retour({
    ...infosClient(4098), productTitle: 'Kairo Street Mid', variantTitle: 'Bleu nuit / 42', sku: skuDemo('street', 0, '42'), prixRetour: 139,
    reason: 'MODEL', resolution: 'REFUND', status: 'IN_TRANSIT', labelSent: true, labelSentAt: ilJ(5), agencyId: agenceParis,
    trackingNumber: NUMEROS_RETOUR_DEMO[0], createdAt: ilJ(6), lastContactAt: il(340),
  });
  // Reçu à l'agence avec ses trois photos : il attend la décision du marchand.
  await retour(
    {
      ...infosClient(4110), productTitle: 'Kairo Court Low', variantTitle: 'Crème / Vert / 43', sku: skuDemo('court', 1, '43'),
      wantedTitle: 'Kairo Court Low', wantedVariantTitle: 'Crème / Vert / 44', wantedSku: skuDemo('court', 1, '44'),
      prixRetour: 109, prixVoulu: 109, ecartPrix: 0, reason: 'SIZE', resolution: 'EXCHANGE', status: 'RECEIVED',
      labelSent: true, labelSentAt: ilJ(9), agencyId: agenceParis, trackingNumber: NUMEROS_RETOUR_DEMO[1], receivedAt: il(200),
      createdAt: ilJ(10), lastContactAt: il(200),
    },
    [
      { source: 'AGENCE', image: 'court-creme-vert' },
      { source: 'AGENCE', image: 'court-creme-vert' },
      { source: 'AGENCE', image: 'court-creme-vert' },
    ],
  );
  // Un défaut signalé avec les photos du client, pas encore renvoyé.
  await retour(
    {
      ...infosClient(4102), productTitle: 'Kairo Aero Knit', variantTitle: 'Rose poudré / 38', sku: skuDemo('aero', 1, '38'), prixRetour: 119,
      reason: 'DEFECT', resolution: 'EXCHANGE', status: 'OPEN', createdAt: il(250), lastContactAt: il(260),
      note: 'Couture latérale qui se défait après trois ports.',
    },
    [
      { source: 'CLIENT', image: 'aero-rose' },
      { source: 'CLIENT', image: 'aero-rose' },
    ],
  );
  // Remboursé et clos.
  await retour({
    ...infosClient(4114), productTitle: 'Kairo Street Mid', variantTitle: 'Bleu nuit / 38', sku: skuDemo('street', 0, '38'), prixRetour: 139,
    reason: 'SIZE', resolution: 'REFUND', status: 'CLOSED', labelSent: true, labelSentAt: ilJ(12), agencyId: agenceParis,
    trackingNumber: NUMEROS_RETOUR_DEMO[2], receivedAt: ilJ(4), controleLe: ilJ(3), createdAt: ilJ(13), lastContactAt: ilJ(3),
  });
  // Remis en stock : une paire prête à repartir — elle correspond à la
  // commande #4140, que l'envoi du jour proposera de servir depuis le stock.
  await retour(
    {
      orderName: '#4071', customerName: 'Chloé Martin', customerEmail: 'chloe.martin@gmail.com', country: 'FR', devise: 'EUR',
      productTitle: 'Kairo Street Mid', variantTitle: 'Bleu nuit / 43', sku: skuDemo('street', 0, '43'), prixRetour: 139,
      reason: 'SIZE', resolution: 'REFUND', status: 'RESTOCKED', labelSent: true, agencyId: agenceParis,
      receivedAt: ilJ(14), controleLe: ilJ(13), restockedAt: ilJ(13), createdAt: ilJ(20), lastContactAt: ilJ(13),
    },
    [
      { source: 'AGENCE', image: 'street-bleu-nuit' },
      { source: 'AGENCE', image: 'street-bleu-nuit' },
      { source: 'AGENCE', image: 'street-bleu-nuit' },
    ],
  );

  /*
   * Onze mois de retours déjà clos, pour la page Coûts SAV : des échanges
   * (un colis de l'atelier), des paires réemployées (une économie), des
   * paires abîmées (perdues). Le volume monte avec la boutique.
   */
  const RAISONS = ['SIZE', 'MODEL', 'SIZE', 'DEFECT', 'OTHER'] as const;
  const anciens: Prisma.ReturnCaseCreateManyInput[] = [];
  for (let mois = 11; mois >= 1; mois -= 1) {
    const combien = 2 + Math.round((12 - mois) / 2) + ((mois * 7) % 3);
    for (let k = 0; k < combien; k += 1) {
      const rang = mois * 10 + k;
      const produit = PRODUITS[rang % 6]!;
      const client = CLIENTS[rang % CLIENTS.length]!;
      const raison = RAISONS[rang % RAISONS.length]!;
      const cree = maintenant - mois * 30 * JOUR - k * 2 * JOUR;
      const recu = cree + 6 * JOUR;
      const echange = raison === 'SIZE';
      const perdue = raison === 'DEFECT' && rang % 2 === 0;
      const reemploi = !perdue && !echange && rang % 3 === 0;
      anciens.push({
        merchantId: id, orderName: `#${3600 + rang * 3}`, customerName: client.nom, customerEmail: client.email, country: client.pays,
        productTitle: produit.titre, variantTitle: `${produit.coloris[rang % 2]!.nom} / ${produit.tailles[rang % produit.tailles.length]}`,
        prixRetour: produit.prix, devise: 'EUR', reason: raison, resolution: echange ? 'EXCHANGE' : 'REFUND',
        status: perdue ? 'UNUSABLE' : 'CLOSED', labelSent: true, labelSentAt: new Date(cree + JOUR), agencyId: agenceParis,
        receivedAt: new Date(recu), controleLe: new Date(recu),
        ...(echange
          ? { exchangeSupplierId: lianhua, exchangeShippedAt: new Date(recu + JOUR), exchangeTrackingNumber: `YT2609${String(rang).padStart(10, '0')}` }
          : {}),
        ...(perdue ? { unusableAt: new Date(recu + JOUR), unusableNote: 'Semelle décollée' } : {}),
        ...(reemploi ? { restockedAt: new Date(recu), reusedAt: new Date(recu + 9 * JOUR), reusedOrderName: `#${3700 + rang}` } : {}),
        createdAt: new Date(cree), lastContactAt: new Date(recu),
      });
    }
  }
  await prisma.returnCase.createMany({ data: anciens });

  /* ------------------------------------------------------ remboursements */
  await prisma.remboursementAFaire.create({
    data: {
      merchantId: id, ticketId: ticketDe.get('remb-bilal'), motif: 'Annulation avant expédition', clientNom: 'Bilal Kaci',
      clientEmail: 'bilal.kaci@gmail.com', orderName: '#4135', shopifyOrderId: orderIdDemo(4135),
      article: 'Kairo Trail X — Kaki / 42', montant: 149, devise: 'EUR', demandeParId: DEMO.agents[0].id, createdAt: il(30),
    },
  });
  const remboursements: Array<{ numero: number; montant: number; jours: number; motif: string; partiel?: boolean }> = [
    { numero: 4114, montant: 139, jours: 3, motif: 'Retour reçu et accepté' },
    { numero: 4108, montant: 38.7, jours: 6, motif: 'Geste commercial — défaut de couture', partiel: true },
    ...Array.from({ length: 9 }, (_, n) => ({
      numero: 4040 + n * 4,
      montant: [129, 109, 39, 149, 15, 119, 79, 139, 12.9][n]!,
      jours: 9 + n * 5,
      motif: ['Retour reçu et accepté', 'Colis perdu par le transporteur', 'Article abîmé', 'Erreur de préparation'][n % 4]!,
      partiel: n === 8,
    })),
  ];
  await prisma.refund.createMany({
    data: remboursements.map((remb, n) => ({
      id: `demo-refund-${n}`,
      merchantId: id,
      shopifyOrderId: orderIdDemo(remb.numero),
      shopifyRefundId: `gid://csav/ModeTest/Refund/${n}`,
      amount: remb.montant,
      currency: 'EUR',
      reason: remb.motif,
      kind: remb.partiel ? 'PARTIAL' : 'FULL',
      status: 'COMPLETED',
      requestedByUserId: n % 2 ? DEMO.agents[0].id : DEMO.proprietaire.id,
      createdAt: ilJ(remb.jours),
      completedAt: ilJ(remb.jours),
    })),
  });
  await prisma.auditLog.createMany({
    data: remboursements.map((remb, n) => ({
      merchantId: id, actorType: 'USER' as const, actorId: n % 2 ? DEMO.agents[0].id : DEMO.proprietaire.id,
      action: 'refund.completed', targetType: 'Refund', targetId: `demo-refund-${n}`, createdAt: ilJ(remb.jours),
    })),
  });

  return { merchantId: id, tickets: MAILS.length + historique.tickets.length + ruptures.length };
}

/*
 * Deux mois de SAV déjà traité : de quoi remplir les statistiques. Le volume
 * suit la semaine (plus le lundi, moins le dimanche), et les délais de
 * réponse raccourcissent avec le temps — l'outil fait son effet.
 */
const MODELES: Array<{ intent: MailDemo['intent']; sujet: string; corps: string; reponse: string }> = [
  { intent: 'WISMO', sujet: 'Où est ma commande ?', corps: 'Bonjour, je n’ai pas encore reçu ma commande, pouvez-vous me dire où elle en est ? Merci', reponse: 'Bonjour, votre commande est en route et arrivera sous 2 à 3 jours. Belle journée, Inès — Service client Kairo' },
  { intent: 'WISMO', sujet: 'Suivi de colis', corps: 'Bonjour, le lien de suivi ne fonctionne pas, pouvez-vous m’aider ?', reponse: 'Bonjour, voici le bon lien de suivi : le colis avance normalement. Belle journée, Inès — Service client Kairo' },
  { intent: 'RETURN', sujet: 'Échange de taille', corps: 'Bonjour, la taille est un peu juste, puis-je échanger pour la taille au-dessus ?', reponse: 'Bonjour, bien sûr : voici l’étiquette de retour, la nouvelle taille part dès réception. Belle journée, Inès — Service client Kairo' },
  { intent: 'WISMO', sujet: 'Date de livraison', corps: 'Bonjour, quand vais-je recevoir mes baskets ?', reponse: 'Bonjour, livraison prévue d’ici 3 jours ouvrés. Belle journée, Inès — Service client Kairo' },
  { intent: 'PRODUCT_QUESTION', sujet: 'Question sur une pointure', corps: 'Bonjour, ce modèle taille-t-il grand ?', reponse: 'Bonjour, il taille normalement : prenez votre pointure habituelle. Belle journée, Inès — Service client Kairo' },
  { intent: 'REFUND', sujet: 'Remboursement', corps: 'Bonjour, quand serai-je remboursé de mon retour ?', reponse: 'Bonjour, le remboursement a été émis aujourd’hui. Belle journée, Inès — Service client Kairo' },
  { intent: 'RETURN', sujet: 'Retour d’un article', corps: 'Bonjour, je souhaite retourner ma commande, comment faire ?', reponse: 'Bonjour, voici votre étiquette de retour prépayée. Belle journée, Inès — Service client Kairo' },
  { intent: 'WISMO', sujet: 'Commande pas encore expédiée ?', corps: 'Bonjour, ma commande est-elle partie ?', reponse: 'Bonjour, elle a été expédiée ce matin, vous avez reçu le suivi par mail. Belle journée, Inès — Service client Kairo' },
  { intent: 'DISPUTE', sujet: 'Colis abîmé', corps: 'Bonjour, le colis est arrivé ouvert et la boîte est écrasée.', reponse: 'Bonjour, désolés : nous vous renvoyons une paire neuve sans frais. Belle journée, Inès — Service client Kairo' },
  { intent: 'POSITIVE', sujet: 'Merci', corps: 'Bonjour, bien reçu, merci pour la rapidité !', reponse: 'Merci à vous, à bientôt chez Kairo ! Inès — Service client Kairo' },
  { intent: 'PRODUCT_QUESTION', sujet: 'Réassort', corps: 'Bonjour, ce coloris revient-il bientôt en stock ?', reponse: 'Bonjour, réassort prévu sous 10 jours. Belle journée, Inès — Service client Kairo' },
  { intent: 'OTHER', sujet: 'Modification de commande', corps: 'Bonjour, puis-je modifier l’adresse de livraison ?', reponse: 'Bonjour, c’est fait, l’adresse a été corrigée avant l’expédition. Belle journée, Inès — Service client Kairo' },
];

function historiqueDemo(maintenant: number) {
  const tickets: Prisma.TicketCreateManyInput[] = [];
  const messages: Prisma.MessageCreateManyInput[] = [];
  const brouillons: Prisma.DraftCreateManyInput[] = [];
  const journal: Prisma.AuditLogCreateManyInput[] = [];
  const equipe = [DEMO.proprietaire.id, DEMO.proprietaire.id, DEMO.agents[0].id, DEMO.agents[0].id, DEMO.agents[1].id];
  let n = 0;

  for (let jours = 60; jours >= 0; jours -= 1) {
    const jour = new Date(maintenant - jours * JOUR);
    const semaine = [1, 6, 5, 5, 4, 4, 2][jour.getUTCDay()]!;
    const volume = semaine + ((jours * 7) % 3);
    for (let i = 0; i < volume; i += 1, n += 1) {
      const modele = MODELES[(n * 5 + jours) % MODELES.length]!;
      const client = CLIENTS[(n * 7) % CLIENTS.length]!;
      const recu = new Date(jour.getTime() - jour.getUTCHours() * HEURE + (8 + ((n * 3) % 13)) * HEURE + ((n * 17) % 60) * MINUTE);
      // Le délai de réponse fond au fil des semaines : de 6 h à 40 min.
      const delai = (40 + ((n * 37) % 90)) * MINUTE * (1 + (jours / 60) * 5);
      const repondu = new Date(recu.getTime() + delai);
      // Aujourd'hui, seulement ce qui a déjà eu sa réponse : rien dans le futur.
      if (repondu.getTime() > maintenant - 10 * MINUTE) continue;
      const id = `demo-h-${n}`;
      const confiance = 0.72 + ((n * 13) % 26) / 100;
      tickets.push({
        id, merchantId: DEMO.merchantId, gmailThreadId: id, subject: modele.sujet, customerEmail: client.email, customerName: client.nom,
        intent: modele.intent, intentConfidence: confiance, status: 'CLOSED', language: 'fr', gmailUnread: false, gmailArchived: true,
        openedAt: repondu, lastMessageAt: repondu, threadSyncedAt: repondu, createdAt: recu, updatedAt: repondu,
      });
      messages.push(
        { id: `${id}-in`, merchantId: DEMO.merchantId, ticketId: id, gmailMessageId: `${id}-in`, direction: 'INBOUND', fromEmail: client.email, toEmail: 'sav@kairo-demo.test', subject: modele.sujet, bodyText: modele.corps, snippet: modele.corps, receivedAt: recu, createdAt: recu },
        { id: `${id}-out`, merchantId: DEMO.merchantId, ticketId: id, gmailMessageId: `${id}-out`, direction: 'OUTBOUND', fromEmail: 'sav@kairo-demo.test', toEmail: client.email, subject: `Re: ${modele.sujet}`, bodyText: modele.reponse, snippet: modele.reponse, receivedAt: repondu, createdAt: repondu },
      );
      // Un brouillon sur dix réécrit à la main : la part de l'IA reste lisible.
      brouillons.push({
        merchantId: DEMO.merchantId, ticketId: id, body: modele.reponse, model: 'demo', confidence: confiance,
        summary: [], status: n % 10 === 3 ? 'EDITED' : 'SENT', createdBy: 'AI', createdAt: new Date(recu.getTime() + 2 * MINUTE), sentAt: repondu,
      });
      journal.push({
        merchantId: DEMO.merchantId, actorType: 'USER', actorId: equipe[n % equipe.length]!, action: 'draft.sent',
        targetType: 'Ticket', targetId: id, createdAt: repondu,
      });
    }
  }
  return { tickets, messages, brouillons, journal };
}

