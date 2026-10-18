import type { Prisma } from '@prisma/client';

import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';
import { translateToFrench, traduireDuFrancais } from '../ai/translate.ts';
import { sendPlainEmail } from '../gmail/send.ts';
import { langueAtelier, MOTS } from '../suppliers/langueAtelier.ts';
import {
  etatConsigne,
  textesConsigne,
  type ChoixConsigne,
  type ModeleConsigne,
} from './consigneTexte.ts';

/**
 * La réponse du marchand à l'atelier, sur une rupture.
 *
 * L'atelier écrit « réassort dans dix jours » et attend une décision. Jusqu'ici
 * le marchand n'avait qu'un geste : proposer un modèle de remplacement. Sans
 * modèle équivalent en stock, il n'avait rien à dire — le ticket restait « en
 * attente du marchand », la commande dormait chez l'atelier.
 *
 * Une consigne dit quoi faire de la commande : attendre, remplacer, ne pas
 * expédier, ou un message. L'atelier la lit dans sa langue et la confirme d'un
 * bouton ; la plus récente remplace les précédentes, qui restent à l'historique.
 */

/** Une traduction qui traîne ne doit pas bloquer l'envoi : l'original suffit. */
const DELAI_TRADUCTION_MS = 15_000;

async function avecDelai<T>(promesse: Promise<T>): Promise<T | null> {
  let minuteur: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promesse,
      new Promise<null>((resolve) => {
        minuteur = setTimeout(() => resolve(null), DELAI_TRADUCTION_MS);
      }),
    ]);
  } catch (error) {
    logger.warn({ err: error }, 'Traduction de la consigne en échec');
    return null;
  } finally {
    clearTimeout(minuteur);
  }
}

export const CHAMPS_CONSIGNE = {
  id: true,
  ticketId: true,
  supplierId: true,
  choix: true,
  expedierAvant: true,
  modeles: true,
  articlesCommande: true,
  mot: true,
  motTraduit: true,
  reponse: true,
  modeleChoisi: true,
  reponseNote: true,
  reponseNoteFr: true,
  reponduLe: true,
  remplaceeLe: true,
  relancerLe: true,
  createdAt: true,
} satisfies Prisma.RuptureConsigneSelect;
const champs = CHAMPS_CONSIGNE;

type ConsigneEnBase = Prisma.RuptureConsigneGetPayload<{ select: typeof champs }>;

const lireModeles = (valeur: Prisma.JsonValue | null): ModeleConsigne[] =>
  Array.isArray(valeur)
    ? valeur.filter(
        (modele): modele is Prisma.JsonObject & { productTitle: string } =>
          typeof modele === 'object' && modele !== null && typeof (modele as { productTitle?: unknown }).productTitle === 'string',
      ).map((modele) => modele as unknown as ModeleConsigne)
    : [];

const lireTraduction = (valeur: Prisma.JsonValue | null): { en?: string; zh?: string } | null =>
  valeur && typeof valeur === 'object' && !Array.isArray(valeur) ? (valeur as { en?: string; zh?: string }) : null;

/** Ce que les deux écrans reçoivent : la consigne, ses mots dans chaque langue, son état. */
export function vueConsigne(consigne: ConsigneEnBase) {
  const modeles = lireModeles(consigne.modeles);
  const aEcrire = {
    choix: consigne.choix,
    expedierAvant: consigne.expedierAvant,
    modeles,
    articlesCommande: consigne.articlesCommande,
    modeleChoisi: consigne.modeleChoisi,
  };
  return {
    id: consigne.id,
    ticketId: consigne.ticketId,
    choix: consigne.choix,
    expedierAvant: consigne.expedierAvant,
    modeles,
    articlesCommande: consigne.articlesCommande,
    mot: consigne.mot,
    motTraduit: lireTraduction(consigne.motTraduit),
    reponse: consigne.reponse,
    modeleChoisi: consigne.modeleChoisi,
    reponseNote: consigne.reponseNote,
    reponseNoteFr: consigne.reponseNoteFr,
    reponduLe: consigne.reponduLe,
    remplaceeLe: consigne.remplaceeLe,
    relancerLe: consigne.relancerLe,
    envoyeeLe: consigne.createdAt,
    etat: etatConsigne(consigne),
    textes: textesConsigne(aEcrire),
  };
}

export type VueConsigne = ReturnType<typeof vueConsigne>;

/**
 * Les consignes de plusieurs dossiers, en une requête, de la plus ancienne à
 * la plus récente. Bornées à un atelier quand c'est lui qui les lit : une
 * consigne donnée à un autre fournisseur sur la même commande ne le regarde pas.
 */
export async function consignesDesTickets(
  merchantId: string,
  ticketIds: readonly string[],
  supplierId?: string,
): Promise<Map<string, VueConsigne[]>> {
  const parTicket = new Map<string, VueConsigne[]>();
  if (ticketIds.length === 0) return parTicket;

  const consignes = await prisma.ruptureConsigne.findMany({
    where: { merchantId, ticketId: { in: [...ticketIds] }, ...(supplierId ? { supplierId } : {}) },
    orderBy: { createdAt: 'asc' },
    select: champs,
  });
  for (const consigne of consignes) {
    parTicket.set(consigne.ticketId, [...(parTicket.get(consigne.ticketId) ?? []), vueConsigne(consigne)]);
  }
  return parTicket;
}

/** La consigne qui vaut encore sur un dossier : la dernière, si elle n'est pas remplacée. */
export const consigneCourante = (consignes: readonly VueConsigne[] | undefined): VueConsigne | null => {
  const derniere = consignes?.at(-1);
  return derniere && !derniere.remplaceeLe ? derniere : null;
};

/**
 * Envoie une consigne à l'atelier.
 *
 * Les précédentes sont marquées remplacées dans la même transaction : deux
 * consignes ouvertes à la fois sur le même dossier diraient deux choses à
 * l'atelier, et il ferait la première qu'il lit.
 */
export async function envoyerConsigne(params: {
  merchantId: string;
  ticketId: string;
  supplierId: string;
  choix: ChoixConsigne;
  expedierAvant: Date | null;
  modeles: readonly ModeleConsigne[];
  articlesCommande: number | null;
  mot: string | null;
  /** ATTENDRE : le jour où relancer le client. */
  relancerLe?: Date | null;
  createdById: string | null;
}): Promise<VueConsigne> {
  const mot = params.mot?.trim() || null;
  const traduit = mot ? await avecDelai(traduireDuFrancais(mot)) : null;
  const maintenant = new Date();

  const [, creee] = await prisma.$transaction([
    prisma.ruptureConsigne.updateMany({
      where: { merchantId: params.merchantId, ticketId: params.ticketId, remplaceeLe: null },
      data: { remplaceeLe: maintenant },
    }),
    prisma.ruptureConsigne.create({
      data: {
        merchantId: params.merchantId,
        ticketId: params.ticketId,
        supplierId: params.supplierId,
        choix: params.choix,
        expedierAvant: params.choix === 'ATTENDRE' ? params.expedierAvant : null,
        modeles: params.choix === 'REMPLACER' ? (params.modeles as unknown as Prisma.InputJsonValue) : undefined,
        articlesCommande: params.choix === 'ANNULER' ? params.articlesCommande : null,
        relancerLe: params.choix === 'ATTENDRE' ? (params.relancerLe ?? null) : null,
        mot,
        motTraduit: traduit ? { en: traduit.en, zh: traduit.zh } : undefined,
        createdById: params.createdById,
      },
      select: champs,
    }),
  ]);

  return vueConsigne(creee);
}

/**
 * « Ne pas expédier » part tout de suite, par mail : la commande peut être
 * emballée avant le récapitulatif du lendemain. Les autres consignes
 * n'arrêtent aucun geste en cours — elles attendent le récapitulatif.
 *
 * L'envoi ne bloque pas la consigne : elle est déjà dans l'espace de l'atelier.
 */
export async function prevenirSansAttendre(params: {
  merchantId: string;
  consigne: VueConsigne;
  orderName: string | null;
  atelier: { contactEmail: string; langue: string };
  fromName: string;
}): Promise<boolean> {
  if (params.consigne.choix !== 'ANNULER') return false;

  const langue = langueAtelier(params.atelier.langue);
  const mots = MOTS[langue];
  const texte = params.consigne.textes[langue];
  const mot =
    langue === 'fr' ? params.consigne.mot : (params.consigne.motTraduit?.[langue] ?? params.consigne.mot);

  try {
    await sendPlainEmail({
      merchantId: params.merchantId,
      to: params.atelier.contactEmail,
      fromName: params.fromName,
      subject: `${mots.urgent} — ${texte.titre}${params.orderName ? ` · ${params.orderName}` : ''}`,
      body: [
        texte.titre,
        texte.detail,
        params.orderName ? mots.commande(params.orderName) : null,
        mot ? `« ${mot} »` : null,
        '',
        mots.repondre,
      ]
        .filter((ligne) => ligne !== null)
        .join('\n'),
    });
    await prisma.ruptureConsigne.updateMany({
      where: { id: params.consigne.id, merchantId: params.merchantId },
      data: { avisLe: new Date() },
    });
    return true;
  } catch (error) {
    logger.warn({ err: error, consigneId: params.consigne.id }, 'Consigne « ne pas expédier » non envoyée');
    return false;
  }
}

export class ReponseRefusee extends Error {
  readonly code: 'introuvable' | 'deja' | 'invalide';

  constructor(code: 'introuvable' | 'deja' | 'invalide', message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * L'atelier répond à la consigne courante : compris, impossible (avec la
 * raison), ou une réponse à un message.
 *
 * Seulement la consigne courante, et une seule fois : répondre à une consigne
 * remplacée ferait croire au marchand que la nouvelle est acceptée.
 */
export async function repondreConsigne(params: {
  merchantId: string;
  supplierId: string;
  consigneId: string;
  reponse: 'COMPRIS' | 'IMPOSSIBLE' | 'REPONDU';
  note: string | null;
  modeleChoisi: number | null;
  /** La langue dans laquelle l'atelier a écrit : en français, rien à traduire. */
  langue: string | null;
}): Promise<VueConsigne> {
  const consigne = await prisma.ruptureConsigne.findFirst({
    where: { id: params.consigneId, merchantId: params.merchantId, supplierId: params.supplierId },
    select: champs,
  });
  if (!consigne) throw new ReponseRefusee('introuvable', 'Cette consigne ne vous est pas adressée.');
  if (consigne.remplaceeLe) throw new ReponseRefusee('deja', 'Le marchand a changé sa consigne : rechargez la page.');
  if (consigne.reponse) throw new ReponseRefusee('deja', 'Vous avez déjà répondu à cette consigne.');

  const note = params.note?.trim() || null;
  const estMessage = consigne.choix === 'MESSAGE';
  if (estMessage !== (params.reponse === 'REPONDU')) {
    throw new ReponseRefusee('invalide', 'Réponse invalide pour cette consigne.');
  }
  if (params.reponse !== 'COMPRIS' && !note) {
    throw new ReponseRefusee('invalide', 'Écrivez la raison, ou votre réponse.');
  }

  const modeles = lireModeles(consigne.modeles);
  let modeleChoisi: number | null = null;
  if (consigne.choix === 'REMPLACER' && params.reponse === 'COMPRIS') {
    // Un seul modèle : c'est celui-là. Plusieurs : il dit lequel il expédie.
    modeleChoisi = modeles.length === 1 ? 0 : params.modeleChoisi;
    if (modeleChoisi === null || modeleChoisi < 0 || modeleChoisi >= modeles.length) {
      throw new ReponseRefusee('invalide', 'Choisissez le modèle que vous expédiez.');
    }
  }

  const enFrancais =
    note && params.langue !== 'fr' ? await avecDelai(translateToFrench([note])) : null;

  const maintenant = new Date();
  const misAJour = await prisma.ruptureConsigne.updateMany({
    // La condition protège d'un double clic : la seconde écriture ne trouve plus rien.
    where: { id: consigne.id, reponse: null, remplaceeLe: null },
    data: {
      reponse: params.reponse,
      modeleChoisi,
      reponseNote: note,
      reponseNoteFr: enFrancais?.translations[0]?.trim() || null,
      reponduLe: maintenant,
    },
  });
  if (misAJour.count === 0) throw new ReponseRefusee('deja', 'Vous avez déjà répondu à cette consigne.');

  const relue = await prisma.ruptureConsigne.findUniqueOrThrow({ where: { id: consigne.id }, select: champs });
  return vueConsigne(relue);
}

/** La consigne sur une ligne, pour la commande de l'atelier. */
export function consigneDeCommande(consigne: VueConsigne) {
  return {
    choix: consigne.choix,
    reponse: consigne.reponse,
    textes: Object.fromEntries(
      Object.entries(consigne.textes).map(([langue, texte]) => [langue, texte.court]),
    ) as Record<string, string>,
  };
}

