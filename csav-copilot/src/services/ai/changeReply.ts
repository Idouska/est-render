import { getAiProvider } from './factory.ts';

/**
 * Réponse au client après le verdict du fournisseur.
 *
 * Le maillon qui manquait à la boucle : l'atelier confirme « 44 → 45 », et
 * l'agent devait rouvrir le mail, relire le fil, retrouver ce qui avait été
 * demandé, puis écrire — pour transmettre une information de deux lignes.
 * Trente fois par jour, c'est la moitié du métier.
 *
 * Deux situations qui n'ont rien à voir, et c'est tout l'enjeu :
 *
 * — le fournisseur accepte : on annonce, on est factuel, on ne surjoue pas la
 *   victoire pour un changement de pointure ;
 * — le fournisseur refuse : on annonce une mauvaise nouvelle. Le motif brut
 *   (« colis déjà parti ») est destiné au marchand, pas au client — il faut
 *   l'expliquer, et surtout proposer la suite (retour, échange, remboursement)
 *   sans rien promettre que le marchand n'ait décidé.
 *
 * Le modèle n'invente jamais de geste commercial : il propose de faire le
 * nécessaire, l'agent tranche avant d'envoyer. C'est la règle du reste de
 * l'outil, elle vaut ici aussi — surtout ici, puisqu'on écrit sur un dossier
 * qui a déjà déraillé une fois.
 */

export interface ChangeReplyContext {
  merchantName: string;
  customerName: string | null;
  /** Langue du client, code ISO. La réponse est rédigée dedans. */
  language?: string | null;
  kind: string;
  beforeValue: string | null;
  afterValue: string | null;
  /** Note interne écrite par l'agent au moment de la demande. */
  note: string | null;
  accepted: boolean;
  /** Motif du fournisseur, en cas de refus. Interne, à reformuler. */
  supplierNote: string | null;
  orderName: string | null;
  /** Dernier message du client, pour retrouver son ton et sa formulation. */
  lastCustomerMessage?: string | null;
}

const KIND_LABELS: Record<string, string> = {
  SIZE: 'un changement de taille',
  COLOR: 'un changement de couleur',
  PRODUCT: 'un changement de modèle',
  ADDRESS: "un changement d'adresse de livraison",
  PHONE: 'une correction du numéro de téléphone',
  HOLD: "une suspension de l'expédition",
  CANCEL: 'une annulation de commande',
  OTHER: 'une demande particulière',
};

const SCHEMA = {
  type: 'object',
  properties: {
    body: { type: 'string', description: 'Le corps du mail, texte brut, prêt à envoyer.' },
    confidence: { type: 'number' },
    reasoning: { type: 'string' },
  },
  required: ['body', 'confidence', 'reasoning'],
  additionalProperties: false,
} as const;

export async function draftChangeReply(context: ChangeReplyContext): Promise<{
  body: string;
  confidence: number;
  reasoning: string;
  model: string;
}> {
  const provider = await getAiProvider();

  const change =
    context.beforeValue && context.afterValue
      ? `${context.beforeValue} → ${context.afterValue}`
      : (context.afterValue ?? context.note ?? '');

  const result = await provider.completeJson<{
    body: string;
    confidence: number;
    reasoning: string;
  }>({
    system: [
      `Tu écris au nom du service après-vente de ${context.merchantName}.`,
      'Un humain relit avant envoi.',
      '',
      'Contexte : le client avait demandé une modification sur sa commande,',
      "l'atelier vient de répondre. Tu annonces cette réponse au client.",
      '',
      context.accepted
        ? [
            "L'atelier a accepté. Annonce-le simplement : ce qui change, et que",
            "c'est pris en compte avant l'expédition. Trois phrases suffisent.",
            "Ne remercie pas le client de sa patience s'il n'a pas attendu, et",
            'ne transforme pas un changement de pointure en événement.',
          ].join('\n')
        : [
            "L'atelier ne peut pas. Annonce-le franchement, sans tourner autour,",
            'et explique pourquoi en langage de client — le motif interne ne se',
            'recopie pas tel quel.',
            '',
            "Puis propose la suite concrète : selon le cas, un retour à réception,",
            'un échange, ou un remboursement. Formule-la comme une proposition que',
            "l'équipe met en place, jamais comme une promesse chiffrée : aucun",
            'montant, aucun délai que tu ne peux vérifier.',
          ].join('\n'),
      '',
      'Contraintes absolues :',
      "- N'invente aucun numéro de suivi, aucune date, aucun montant.",
      '- Ne cite pas le fournisseur ni son nom : le client a acheté chez nous,',
      "  notre organisation interne ne le regarde pas et l'inquiéterait.",
      '- Pas de formule creuse, pas d\'emoji, pas de titre ni de puce.',
      '- Signe du nom de la boutique, sans inventer de prénom.',
      context.language
        ? `- Réponds en ${context.language}, la langue du client.`
        : '- Réponds dans la langue du dernier message du client.',
      '',
      'Réponds en JSON, sans texte autour.',
    ].join('\n'),
    user: [
      `Client : ${context.customerName ?? 'inconnu'}`,
      context.orderName ? `Commande : ${context.orderName}` : null,
      `Demande : ${KIND_LABELS[context.kind] ?? 'une modification'}${change ? ` (${change})` : ''}`,
      context.note ? `Note interne de l'agent : ${context.note}` : null,
      '',
      context.accepted
        ? "Réponse de l'atelier : accepté."
        : `Réponse de l'atelier : impossible. Motif interne : ${
            context.supplierNote ?? 'non précisé'
          }`,
      '',
      context.lastCustomerMessage
        ? `Dernier message du client (pour le ton et la langue) :\n${context.lastCustomerMessage.slice(0, 1500)}`
        : null,
    ]
      .filter((line) => line !== null)
      .join('\n'),
    schema: SCHEMA,
    validate: (value) => {
      const parsed = value as { body?: unknown; confidence?: unknown; reasoning?: unknown };
      if (typeof parsed.body !== 'string' || parsed.body.trim() === '') {
        throw new Error('body manquant');
      }
      return {
        body: parsed.body.trim(),
        // Une confiance absente ne doit pas bloquer la rédaction : l'agent
        // relit de toute façon, et un brouillon sans score vaut mieux qu'un
        // ticket sans brouillon.
        confidence:
          typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
      };
    },
    maxTokens: 1200,
  });

  return { ...result.data, model: result.model };
}
