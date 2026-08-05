import type { Intent } from '@prisma/client';
import type { OrderSummary } from '../shopify/orders.ts';
import { getAiProvider } from './factory.ts';

export interface DraftGeneration {
  /**
   * Le message du client ramené à deux ou quatre points.
   *
   * C'est ce qui change le métier d'agent : décider sans lire le fil. Sur cent
   * tickets par jour, la lecture intégrale est le poste de temps principal, et
   * la plupart des fils ne disent qu'une chose.
   */
  summary: string[];
  /** La demande concrète, en une ligne. */
  ask: string;
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

  /**
   * Fichiers joints par le client.
   *
   * Le modèle ne les voit pas — il n'a pas d'yeux ici. Mais savoir qu'ils
   * existent lui évite la faute la plus agaçante du SAV : redemander les photos
   * que le client vient d'envoyer.
   */
  attachments?: Array<{ filename: string; mimeType: string }>;
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
   * Réponses réellement envoyées par l'équipe sur des cas semblables.
   *
   * Le ton d'une maison se transmet par l'exemple, pas par une consigne de
   * style : ces échanges apprennent au modèle comment *cette* boutique répond.
   */
  examples?: Array<{ question: string; answer: string }>;

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
- Quand des fichiers sont joints, tu ne peux pas les regarder. Ne décris jamais
  leur contenu et n'en déduis rien. Mais ne les redemande pas non plus :
  accuse réception (« j'ai bien vos photos ») et dis qu'un collègue les
  examine si la décision en dépend.
- Les réponses passées de l'équipe montrent le ton et les tournures de la
  maison : inspire-t'en. Ne recopie jamais leurs faits — montants, numéros,
  dates appartiennent à d'autres dossiers.

Avant de rédiger, résume le message du client :
- « summary » : deux à quatre points, une phrase courte chacun, à l'indicatif.
  Les faits que l'agent doit connaître pour trancher — ce qui s'est passé, ce
  qui a déjà été tenté, ce qui bloque, le ton s'il est menaçant ou détendu.
  N'y mets pas ce que tu vas répondre, ni de formule de politesse.
- « ask » : ce que le client veut obtenir, en une ligne, à l'infinitif quand
  c'est possible (« Être remboursé du montant total », « Savoir où est le
  colis »). S'il ne demande rien de précis, dis-le.

Le résumé sert un agent qui n'ouvrira pas le fil : s'il y manque un fait
décisif, il répondra à côté.

Réponds en JSON, sans texte autour.`;

const SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'array',
      items: { type: 'string' },
      description: 'Deux à quatre points résumant le message du client.',
    },
    ask: {
      type: 'string',
      description: 'Ce que le client demande, en une ligne.',
    },
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
  required: ['summary', 'ask', 'body', 'confidence', 'reasoning', 'needsHuman'],
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

  if (context.attachments && context.attachments.length > 0) {
    const names = context.attachments.map((file) => file.filename).join(', ');
    parts.push(
      `\n--- Fichiers joints par le client (${context.attachments.length}) ---\n${names}\n` +
        'Tu ne peux pas les ouvrir. Accuse-en réception sans décrire ce qu’ils montrent.',
    );
  }

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

  if (context.examples?.length) {
    parts.push(
      `\n--- Réponses déjà envoyées par l'équipe sur des cas semblables ---\n` +
        context.examples
          .map(
            (example, index) =>
              `Exemple ${index + 1}\nClient : ${example.question}\nÉquipe : ${example.answer}`,
          )
          .join('\n\n') +
        `\nReprends le ton et les tournures, jamais les faits.`,
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

  // Le résumé est toléré absent : un modèle qui l'oublie doit quand même
  // livrer sa réponse, l'écran sait afficher un résumé vide. L'inverse — un
  // brouillon rejeté pour un résumé manquant — coûterait un ticket non traité.
  const summary = Array.isArray(v.summary)
    ? v.summary.filter((line): line is string => typeof line === 'string' && line.trim() !== '')
    : [];

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
    summary: summary.slice(0, 4).map((line) => line.trim()),
    ask: typeof v.ask === 'string' ? v.ask.trim() : '',
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
