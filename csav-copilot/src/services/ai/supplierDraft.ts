import type { EscalationReason } from '@prisma/client';
import { getAiProvider } from './factory.ts';

export interface SupplierDraftContext {
  merchantName: string;
  supplierName: string;
  reason: EscalationReason;
  /** Note libre de l'agent au moment de l'escalade — peut être vide. */
  agentNote: string | null;
  orderName: string | null;
  orderItems: string[];
  shippingAddress: string | null;
  /** Ce que le client a écrit, pour donner au fournisseur le contexte exact. */
  customerMessage: string;
}

export interface SupplierDraft {
  subject: string;
  body: string;
}

const REASON_LABELS: Record<EscalationReason, string> = {
  OUT_OF_STOCK: 'rupture de stock probable sur un article commandé',
  INCORRECT_ADDRESS: "adresse de livraison incorrecte ou incomplète, à corriger avant réexpédition",
  MISSING_ITEM: 'article manquant à la réception du colis',
  OTHER: 'problème à qualifier avec le fournisseur',
};

const SYSTEM_PROMPT = `Tu rédiges, pour le compte d'un marchand, un email professionnel adressé à son
fournisseur afin de résoudre un problème sur une commande client.

Ce n'est PAS un mail au client final : le ton est direct et opérationnel, entre
professionnels qui se connaissent. Pas de formule d'excuse envers le
fournisseur, pas de politesse excessive.

Contraintes :
- Indique clairement la référence de commande et les articles concernés.
- Pose une question précise et actionnable (date de réassort possible ?
  confirmer la bonne adresse ? renvoyer l'article manquant ?), pas une
  simple description du problème.
- N'invente aucune information qui ne figure pas dans les données fournies.
- Reste bref : un fournisseur traite beaucoup de mails, une réponse rapide
  vaut mieux qu'un mail détaillé.
- Le sujet du mail est court et identifie immédiatement la commande concernée.

Réponds en JSON, sans texte autour.`;

const SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    body: { type: 'string' },
  },
  required: ['subject', 'body'],
  additionalProperties: false,
} as const;

function validate(value: unknown): SupplierDraft {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Réponse de rédaction fournisseur : objet attendu');
  }
  const v = value as Record<string, unknown>;
  if (typeof v.subject !== 'string' || v.subject.trim() === '') {
    throw new TypeError('Réponse de rédaction fournisseur : subject manquant');
  }
  if (typeof v.body !== 'string' || v.body.trim() === '') {
    throw new TypeError('Réponse de rédaction fournisseur : body manquant');
  }
  return { subject: v.subject, body: v.body };
}

function buildContextBlock(context: SupplierDraftContext): string {
  const lines = [
    `Marchand : ${context.merchantName}`,
    `Fournisseur destinataire : ${context.supplierName}`,
    `Nature du problème : ${REASON_LABELS[context.reason]}`,
    context.orderName ? `Commande concernée : ${context.orderName}` : null,
    context.orderItems.length > 0 ? `Articles : ${context.orderItems.join(', ')}` : null,
    context.shippingAddress ? `Adresse de livraison actuelle : ${context.shippingAddress}` : null,
    context.agentNote ? `Note de l'agent : ${context.agentNote}` : null,
    `\nMessage original du client (contexte, ne pas citer mot pour mot au fournisseur) :\n${context.customerMessage}`,
  ].filter((line): line is string => line !== null);

  return lines.join('\n');
}

export async function generateSupplierDraft(
  context: SupplierDraftContext,
): Promise<SupplierDraft> {
  const provider = await getAiProvider();

  const result = await provider.completeJson<SupplierDraft>({
    system: SYSTEM_PROMPT,
    effort: 'low',
    maxTokens: 1024,
    schema: SCHEMA,
    validate,
    user: buildContextBlock(context),
  });

  if (result.refused) {
    throw new Error(`Rédaction du message fournisseur refusée par le modèle (${provider.name})`);
  }

  return result.data;
}
