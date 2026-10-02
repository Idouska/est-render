import ExcelJS from 'exceljs';
import { prisma } from '../../lib/prisma.ts';
import { bornesDuMois, composerReleve, type Releve } from './releve.ts';

/**
 * Les données du relevé : les commandes des lots partis dans le mois chez
 * cet atelier, leurs colis, et ce qui leur est arrivé ensuite — annulation,
 * remplacement accepté, retour client.
 *
 * `null` pour un mois mal écrit : la route répond 400 plutôt que de deviner.
 */
export async function releveDuMois(params: {
  merchantId: string;
  supplierId: string;
  mois: string;
}): Promise<Releve | null> {
  const bornes = bornesDuMois(params.mois);
  if (!bornes) return null;
  const { merchantId, supplierId } = params;

  const commandes = await prisma.envoiCommande.findMany({
    where: {
      merchantId,
      envoi: { supplierId, emailedAt: { not: null, gte: bornes.debut, lt: bornes.fin } },
    },
    select: { shopifyOrderId: true, orderName: true, articles: true, envoi: { select: { emailedAt: true } } },
  });
  const ids = commandes.map((commande) => commande.shopifyOrderId);

  const [colis, annulations, remplacements, retours] = ids.length
    ? await Promise.all([
        prisma.parcel.findMany({
          where: { merchantId, shopifyOrderId: { in: ids } },
          select: { shopifyOrderId: true, trackingNumber: true, createdAt: true },
        }),
        prisma.supplierAlert.findMany({
          where: { merchantId, supplierId, kind: 'CANCEL', shopifyOrderId: { in: ids } },
          select: { shopifyOrderId: true },
        }),
        prisma.ruptureSubstitution.findMany({
          where: { merchantId, supplierId, accepte: true, ticket: { shopifyOrderId: { in: ids } } },
          orderBy: { reponduLe: 'desc' },
          select: { productTitle: true, variantTitle: true, ticket: { select: { shopifyOrderId: true } } },
        }),
        prisma.returnCase.findMany({
          where: { merchantId, shopifyOrderId: { in: ids } },
          orderBy: { createdAt: 'asc' },
          select: { shopifyOrderId: true, reason: true },
        }),
      ])
    : [[], [], [], []];

  const remplacementDe = new Map<string, string>();
  for (const remplacement of remplacements) {
    const id = remplacement.ticket.shopifyOrderId;
    // Le plus récent accepté : c'est celui qui est parti.
    if (id && !remplacementDe.has(id)) {
      remplacementDe.set(id, [remplacement.productTitle, remplacement.variantTitle].filter(Boolean).join(' · '));
    }
  }

  return composerReleve({
    mois: params.mois,
    commandes: commandes.map((commande) => ({
      shopifyOrderId: commande.shopifyOrderId,
      orderName: commande.orderName,
      articles: commande.articles,
      envoyeLe: commande.envoi.emailedAt!,
    })),
    colis: colis.flatMap((ligne) =>
      ligne.shopifyOrderId ? [{ shopifyOrderId: ligne.shopifyOrderId, trackingNumber: ligne.trackingNumber, createdAt: ligne.createdAt }] : [],
    ),
    annulees: new Set(annulations.map((annulation) => annulation.shopifyOrderId!)),
    remplacements: remplacementDe,
    retours: new Map(retours.map((retour) => [retour.shopifyOrderId!, retour.reason])),
  });
}

const STATUTS = { EXPEDIEE: 'Expédiée', NON_EXPEDIEE: 'Non expédiée', ANNULEE: 'Annulée' } as const;

const jour = (date: Date | null) =>
  date ? date.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

/** Le relevé en classeur : les totaux en tête, puis une ligne par commande. */
export async function releveEnXlsx(releve: Releve, atelier: string): Promise<Buffer> {
  const classeur = new ExcelJS.Workbook();
  classeur.creator = 'cSAV Copilot';
  classeur.created = new Date();
  const feuille = classeur.addWorksheet(`Relevé ${releve.mois}`);

  feuille.addRow([`Relevé ${releve.mois} — ${atelier}`]).font = { bold: true, size: 14 };
  const t = releve.totaux;
  for (const [libelle, valeur] of [
    ['Commandes envoyées', t.envoyees],
    ['Expédiées', t.expediees],
    ['Non expédiées', t.nonExpediees],
    ['Annulées', t.annulees],
    ['Remplacées', t.remplacees],
    ['Retours clients', t.retours],
  ] as const) {
    feuille.addRow([libelle, valeur]);
  }
  feuille.addRow([]);

  const entete = feuille.addRow([
    'Commande',
    'Articles',
    'Envoyée le',
    'Expédiée le',
    'Suivi',
    'Statut',
    'Remplacement',
    'Retour client',
  ]);
  entete.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  entete.eachCell((cellule) => {
    cellule.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
  });
  feuille.views = [{ state: 'frozen', ySplit: entete.number }];

  for (const ligne of releve.lignes) {
    feuille.addRow([
      ligne.commande,
      ligne.articles ?? '',
      jour(ligne.envoyeLe),
      jour(ligne.expedieeLe),
      ligne.suivis.join(', '),
      STATUTS[ligne.statut],
      ligne.remplacement ?? '',
      ligne.retour ?? '',
    ]);
  }

  feuille.columns.forEach((colonne, rang) => {
    colonne.width = [14, 44, 13, 13, 26, 14, 30, 14][rang] ?? 14;
  });

  return Buffer.from(await classeur.xlsx.writeBuffer());
}
