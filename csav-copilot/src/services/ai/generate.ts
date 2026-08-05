import type { Intent } from '@prisma/client';
import type { OrderSummary } from '../shopify/orders.ts';
import { getAiProvider } from './factory.ts';

export interface DraftGeneration {
  body: string;
  confidence: number;
  /** Pourquoi ce niveau de confiance — affiché à l'agent dans le dashboard. */
  reasoning: string;
  /** L'IA estime qu'une intervention humaine est nécessaire avant envoi. */
  needsHuman: boolean;
}

export interface GenerationContext {
  merchantName: string;
  intent: Intent;
  customerName: string | null;
  subject: string | null;
  /** Fil du mail, du plus ancien au plus récent. */
  thread: Array<{ role: 'customer' | 'merchant'; text: string; at: Date }>;
  order: OrderSummary | null;
  /** Renseigné quand plusieurs commandes correspondent au client. */
  ambiguousOrders?: OrderSummary[];

  /**
   * Règles de la boutique : délais, retours, remboursements, douane.
   *
   * C'est ce qui distingue une réponse utile d'une politesse vague. Sans elles
   * le modèle ne peut qu'esquiver, puisqu'il lui est interdit d'inventer un
   * délai ou une condition.
   */
  playbook?: string | null;

  /**
   * Ce que la boutique sait déjà de ce client.
   *
   * Un huitième achat ne se traite pas comme un premier, et un client remboursé
   * le mois dernier n'entend pas la même phrase.
   */
  history?: {
    orders: number;
    spent: string | null;
    currency: string | null;
    previousTickets: number;
    refunds: number;
  } | null;

  /**
   * Langue du message reçu, en code ISO. La réponse est rédigée dedans :
   * répondre en français à un client de Portland est une faute.
   */
  language?: string | null;
}

const SYSTEM_PROMPT = `Tu rédiges des réponses de service après-vente pour une boutique en ligne.
Tu écris à la place de l'équipe SAV ; un humain relit avant envoi.

Langue : réponds dans la langue du message du client, jamais dans une autre.
Le champ « Langue détectée » te la donne ; en cas de doute, suis la langue du
dernier message reçu. Emploie la forme de politesse usuelle de cette langue.

Style : chaleureux mais bref. Pas de formule creuse
("Nous comprenons votre frustration"), pas d'emoji, pas de titre ni de puce
sauf si le contenu l'exige vraiment. Trois à six phrases suffisent presque
toujours.

Contraintes absolues :
- N'affirme que ce qui figure dans les données de commande fournies. Aucun
  numéro de suivi, aucune date de livraison, aucun montant inventé.
- Ne promets ni remboursement, ni geste commercial, ni délai que tu ne peux
  vérifier. Tu peux dire qu'un collègue revient vers le client.
- Si aucune commande n'est rattachée, ou si plusieurs correspondent, demande
  au client une précision (numéro de commande ou email utilisé à l'achat) au
  lieu de supposer laquelle.
- Signe du nom de la boutique, sans inventer de prénom d'agent.
- Les règles de la boutique, quand elles sont fournies, font autorité : cite
  le délai ou la condition exacte plutôt que de rester vague. Si la question
  porte sur un point qu'elles ne couvrent pas, dis qu'un collègue confirmera —
  n'extrapole pas une règle voisine.
- L'historique du client sert à ajuster le ton, pas à être récité : ne lui
  annonce pas son nombre de commandes.

Réponds en JSON, sans texte autour.`;

const SCHEMA = {
  type: 'object',
  properties: {
    body: {
      type: 'string',
      description: 'Le corps du mail, texte brut, prêt à envoyer.',
    },
    confidence: {
      type: 'number',
      description:
        'Ta confiance dans le fait que cette réponse peut partir telle quelle, entre 0 et 1.',
    },
    reasoning: {
      type: 'string',
      description: 'Une phrase expliquant ce qui limite ou soutient ta confiance.',
    },
    needsHuman: { type: 'boolean' },
  },
  required: ['body', 'confidence', 'reasoning', 'needsHuman'],
  additionalProperties: false,
} as const;

function formatOrder(order: OrderSummary): string {
  const lines = [
    `Commande ${order.name} passée le ${order.createdAt}`,
    `Montant : ${order.totalPrice} ${order.currency}`,
    `Statut paiement : ${order.displayFinancialStatus ?? 'inconnu'}`,
    `Statut préparation : ${order.displayFulfillmentStatus ?? 'inconnu'}`,
    `Articles : ${order.lineItems
      .map((item) => `${item.quantity} × ${item.title}${item.variantTitle ? ` (${item.variantTitle})` : ''}`)
      .join(', ')}`,
  ];

  if (order.fulfillments.length === 0) {
    lines.push('Livraison : aucun envoi enregistré pour le moment.');
  } else {
    for (const f of order.fulfillments) {
      lines.push(
        `Livraison : ${f.trackingCompany ?? 'transporteur non précisé'}` +
          `${f.trackingNumber ? `, suivi ${f.trackingNumber}` : ', sans numéro de suivi'}` +
          `, statut ${f.status}` +
          `${f.estimatedDeliveryAt ? `, livraison estimée ${f.estimatedDeliveryAt}` : ''}` +
          `${f.trackingUrl ? `, lien ${f.trackingUrl}` : ''}`,
      );
    }
  }

  if (order.customer) {
    lines.push(
      `Client : ${order.customer.displayName ?? 'inconnu'}, ` +
        `${order.customer.numberOfOrders ?? 0} commande(s), ` +
        `${order.customer.amountSpent ?? '0'} ${order.currency} dépensés, ` +
        `client depuis ${order.customer.createdAt ?? 'date inconnue'}`,
    );
  }

  return lines.join('\n');
}

function buildContextBlock(context: GenerationContext): string {
  const parts = [`Boutique : ${context.merchantName}`, `Intention détectée : ${context.intent}`];

  if (context.language) parts.push(`Langue détectée : ${context.language}`);

  // Les règles passent avant la commande : elles conditionnent ce qu'on a le
  // droit de promettre, la commande ne fait que décrire l'existant.
  if (context.playbook?.trim()) {
    parts.push(
      `\n--- Règles de la boutique (font autorité) ---\n${context.playbook.trim()}`,
    );
  }

  if (context.history) {
    const { orders, spent, currency, previousTickets, refunds } = context.history;
    parts.push(
      `\n--- Ce client chez nous ---\n` +
        `${orders} commande(s)` +
        `${spent ? `, ${spent} ${currency ?? ''} au total` : ''}` +
        `, ${previousTickets} échange(s) précédent(s) avec le SAV` +
        `, ${refunds} remboursement(s).` +
        `\nAdapte le ton, ne récite pas ces chiffres au client.`,
    );
  }

  if (context.order) {
    parts.push(`\n--- Données de commande (source de vérité) ---\n${formatOrder(context.order)}`);
  } else if (context.ambiguousOrders?.length) {
    parts.push(
      `\n--- Plusieurs commandes correspondent à ce client, aucune n'est certaine ---\n` +
        context.ambiguousOrders
          .map((o) => `${o.name} du ${o.createdAt}, ${o.totalPrice} ${o.currency}`)
          .join('\n') +
        `\nDemande au client de préciser laquelle. Ne choisis pas à sa place.`,
    );
  } else {
    parts.push(
      `\n--- Aucune commande rattachée ---\n` +
        `Demande au client son numéro de commande ou l'adresse email utilisée lors de l'achat.`,
    );
  }

  const thread = context.thread
    .map((m) => `[${m.role === 'customer' ? 'Client' : 'Boutique'}] ${m.text}`)
    .join('\n\n');

  parts.push(`\n--- Fil du mail ---\nObjet : ${context.subject ?? '(sans objet)'}\n\n${thread}`);

  return parts.join('\n');
}

function validate(value: unknown): DraftGeneration {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Réponse de génération : objet attendu');
  }

  const v = value as Record<string, unknown>;

  if (typeof v.body !== 'string' || v.body.trim() === '') {
    throw new TypeError('Réponse de génération : body doit être une chaîne non vide');
  }
  if (typeof v.confidence !== 'number') {
    throw new TypeError('Réponse de génération : confidence doit être un nombre');
  }
  if (typeof v.reasoning !== 'string') {
    throw new TypeError('Réponse de génération : reasoning doit être une chaîne');
  }
  if (typeof v.needsHuman !== 'boolean') {
    throw new TypeError('Réponse de génération : needsHuman doit être un booléen');
  }

  return {
    body: v.body,
    confidence: v.confidence,
    reasoning: v.reasoning,
    needsHuman: v.needsHuman,
  };
}

export async function generateReply(context: GenerationContext): Promise<DraftGeneration> {
  const provider = await getAiProvider();

  const result = await provider.completeJson<DraftGeneration>({
    system: SYSTEM_PROMPT,
    effort: 'medium',
    maxTokens: 2048,
    schema: SCHEMA,
    validate,
    user: buildContextBlock(context),
  });

  if (result.refused) {
    throw new Error(`Génération refusée par le modèle (${provider.name})`);
  }

  // Garde-fou : sans commande rattachée, aucune réponse ne peut être
  // considérée comme sûre, quoi qu'en dise le modèle. Appliqué après
  // validation, donc identique quel que soit le fournisseur.
  const hasOrder = context.order !== null;
  const confidence = Math.max(0, Math.min(1, result.data.confidence));

  return {
    ...result.data,
    confidence: hasOrder ? confidence : Math.min(confidence, 0.5),
    needsHuman: result.data.needsHuman || !hasOrder,
  };
}
