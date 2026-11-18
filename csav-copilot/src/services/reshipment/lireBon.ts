import Anthropic from '@anthropic-ai/sdk';
import { getCredentials } from '../platform/credentials.ts';

/**
 * Lire un bon de retour : numéro de suivi, transporteur, et les noms qui
 * permettent de retrouver le dossier.
 *
 * Le bon arrive en PDF (étiquette générée par le transporteur) ou en photo.
 * Claude lit les deux. Sans clé, ou si la lecture échoue, on tente le nom du
 * fichier — beaucoup d'étiquettes s'appellent par leur numéro de suivi — et
 * l'agent complète à la main ce qui manque.
 */

export interface BonLu {
  numero: string | null;
  transporteur: string | null;
  /** L'expéditeur du colis retour : le client, en principe. */
  expediteur: string | null;
  /** Une référence de commande imprimée sur le bon, s'il y en a une. */
  reference: string | null;
  /** Lu par l'IA, ou seulement deviné d'après le nom du fichier. */
  source: 'ia' | 'fichier' | 'aucune';
}

export const TYPES_BON = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
export type TypeBon = (typeof TYPES_BON)[number];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['numero', 'transporteur', 'expediteur', 'reference'],
  properties: {
    numero: { type: ['string', 'null'], description: 'Numéro de suivi du colis, sans espaces.' },
    transporteur: { type: ['string', 'null'], description: 'Transporteur : Colissimo, Mondial Relay, Chronopost, DPD, GLS, UPS, DHL, La Poste, Correos, SEUR, InPost…' },
    expediteur: { type: ['string', 'null'], description: 'Nom de l’expéditeur du colis (la personne qui renvoie).' },
    reference: { type: ['string', 'null'], description: 'Référence ou numéro de commande imprimé sur le bon, s’il y en a un.' },
  },
} as const;

const CONSIGNE =
  'Tu lis une étiquette de retour de colis. Donne le numéro de suivi exact (sans espaces), le transporteur, ' +
  'le nom de l’expéditeur et une éventuelle référence de commande. Si une information est absente ou illisible, renvoie null — n’invente rien.';

/** Les formes connues d'un numéro de suivi, pour le nom de fichier. */
const MOTIFS_NUMERO: Array<{ motif: RegExp; transporteur: string | null }> = [
  { motif: /\b(\d[A-Z]\d{11})\b/, transporteur: 'Colissimo' },
  { motif: /\b([A-Z]{2}\d{9}[A-Z]{2})\b/, transporteur: 'La Poste' },
  { motif: /\b(1Z[0-9A-Z]{16})\b/, transporteur: 'UPS' },
  { motif: /\b(\d{8,22})\b/, transporteur: null },
];

export function devinerDepuisNom(nom: string): BonLu {
  const base = nom.replace(/\.[a-z0-9]+$/i, '').toUpperCase().replace(/[\s_-]+/g, ' ');
  for (const { motif, transporteur } of MOTIFS_NUMERO) {
    const trouve = motif.exec(base)?.[1];
    if (trouve) return { numero: trouve, transporteur, expediteur: null, reference: null, source: 'fichier' };
  }
  return { numero: null, transporteur: null, expediteur: null, reference: null, source: 'aucune' };
}

const nettoyer = (valeur: unknown, max = 120): string | null => {
  if (typeof valeur !== 'string') return null;
  const propre = valeur.trim().slice(0, max);
  return propre ? propre : null;
};

export async function lireBon(fichier: { nom: string; mime: TypeBon; contenu: Buffer }): Promise<BonLu> {
  const parNom = devinerDepuisNom(fichier.nom);
  const { ANTHROPIC_API_KEY, ANTHROPIC_MODEL } = await getCredentials();
  if (!ANTHROPIC_API_KEY) return parNom;

  const donnees = fichier.contenu.toString('base64');
  const bloc =
    fichier.mime === 'application/pdf'
      ? ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: donnees } } as const)
      : ({ type: 'image', source: { type: 'base64', media_type: fichier.mime, data: donnees } } as const);

  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const reponse = await client.messages.create({
      model: ANTHROPIC_MODEL ?? 'claude-opus-5',
      max_tokens: 400,
      system: CONSIGNE,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [bloc, { type: 'text', text: `Fichier : ${fichier.nom}` }] }],
    } as Anthropic.MessageCreateParamsNonStreaming);
    const texte = reponse.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    const lu = JSON.parse(texte) as Record<string, unknown>;
    const numero = nettoyer(lu.numero, 60)?.replace(/\s+/g, '') ?? null;
    return {
      numero: numero ?? parNom.numero,
      transporteur: nettoyer(lu.transporteur, 60) ?? parNom.transporteur,
      expediteur: nettoyer(lu.expediteur),
      reference: nettoyer(lu.reference, 60),
      source: 'ia',
    };
  } catch {
    return parNom;
  }
}

/* --------------------------------------------------------- rattachement -- */

const normaliser = (texte: string) =>
  texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export interface DossierCandidat {
  id: string;
  orderName: string | null;
  customerName: string | null;
}

/**
 * Le dossier d'un bon : par la référence de commande si elle est imprimée,
 * sinon par le nom de l'expéditeur. Un seul candidat, ou rien : deux
 * dossiers au même nom se tranchent à la main.
 */
export function rattacherBon(bon: Pick<BonLu, 'expediteur' | 'reference'>, dossiers: DossierCandidat[]): string | null {
  if (bon.reference) {
    const ref = bon.reference.replace(/\D/g, '');
    if (ref.length >= 3) {
      const parRef = dossiers.filter((d) => d.orderName && d.orderName.replace(/\D/g, '') === ref);
      if (parRef.length === 1) return parRef[0]!.id;
    }
  }
  if (bon.expediteur) {
    const mots = new Set(normaliser(bon.expediteur).split(' ').filter((m) => m.length > 1));
    const parNom = dossiers.filter((d) => {
      const nom = normaliser(d.customerName ?? '').split(' ').filter((m) => m.length > 1);
      return nom.length > 0 && nom.every((m) => mots.has(m));
    });
    if (parNom.length === 1) return parNom[0]!.id;
  }
  return null;
}
