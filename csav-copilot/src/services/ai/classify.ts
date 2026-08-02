import type { Intent } from '@prisma/client';
import { anthropic, MODEL, textFromResponse } from './client.ts';

export interface Classification {
  intent: Intent;
  confidence: number;
  /** Numéro de commande cité par le client, si l'IA en repère un. */
  mentionedOrderNumber: string | null;
  /** Le client exprime-t-il de l'urgence ou du mécontentement ? */
  urgency: 'low' | 'normal' | 'high';
  summary: string;
}

const INTENTS: Intent[] = [
  'WISMO',
  'RETURN',
  'DISPUTE',
  'REFUND',
  'PRODUCT_QUESTION',
  'POSITIVE',
  'OTHER',
];

const SYSTEM_PROMPT = `Tu classes des emails de service après-vente reçus par une boutique en ligne.

Catégories :
- WISMO : le client demande où en est sa commande, sa livraison, son suivi.
- RETURN : le client veut retourner ou échanger un article.
- DISPUTE : réclamation, article cassé/manquant/non conforme, litige.
- REFUND : le client demande explicitement un remboursement.
- PRODUCT_QUESTION : question avant-vente ou sur l'usage d'un produit.
- POSITIVE : remerciement, avis positif, message sans demande.
- OTHER : tout le reste (spam, partenariat, facture, message hors SAV).

Règles :
- Une seule catégorie, celle de la demande principale du client.
- REFUND l'emporte sur RETURN si le client demande son argent, pas un échange.
- DISPUTE l'emporte sur WISMO si le colis est arrivé abîmé ou incomplet.
- "confidence" reflète ta certitude réelle. En dessous de 0.7, un humain relira :
  reste honnête plutôt que confiant.
- "mentionedOrderNumber" : uniquement si le client cite un numéro de commande
  explicite. Ne devine pas à partir d'un numéro de suivi ou de facture.`;

const SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: INTENTS },
    confidence: { type: 'number' },
    mentionedOrderNumber: { type: ['string', 'null'] },
    urgency: { type: 'string', enum: ['low', 'normal', 'high'] },
    summary: {
      type: 'string',
      description: 'Résumé en une phrase de la demande, en français.',
    },
  },
  required: ['intent', 'confidence', 'mentionedOrderNumber', 'urgency', 'summary'],
  additionalProperties: false,
} as const;

export async function classifyEmail(input: {
  subject: string | null;
  bodyText: string;
}): Promise<Classification> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    // Tâche courte et cadrée : effort bas suffit et réduit coût et latence.
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: `Objet : ${input.subject ?? '(sans objet)'}\n\nMessage :\n${input.bodyText.slice(0, 8000)}`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    // Rare, mais ne doit jamais faire tomber l'ingestion : on remonte le
    // ticket à un humain.
    return {
      intent: 'OTHER',
      confidence: 0,
      mentionedOrderNumber: null,
      urgency: 'normal',
      summary: 'Classification indisponible, relecture humaine requise.',
    };
  }

  const parsed = JSON.parse(textFromResponse(response.content)) as Classification;

  return {
    ...parsed,
    confidence: Math.max(0, Math.min(1, parsed.confidence)),
  };
}
