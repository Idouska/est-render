import { recordAudit } from '../../lib/audit.ts';
import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';
import { classifyEmail } from '../ai/classify.ts';
import { describeActiveModel } from '../ai/factory.ts';
import { generateReply, type GenerationContext } from '../ai/generate.ts';
import { detectLanguage } from '../ai/language.ts';
import { createReplyDraft } from '../gmail/drafts.ts';
import { matchOrder } from '../matching/orderMatcher.ts';
import { getShopifyClient } from '../shopify/client.ts';
import type { OrderSummary } from '../shopify/orders.ts';

/**
 * Traite un ticket de bout en bout : classification, rattachement commande,
 * génération de la réponse, création du brouillon Gmail.
 *
 * Phase 1 : la sortie est toujours un brouillon. `autoSendEnabled` reste false
 * et n'est pas encore câblé à un envoi — c'est une décision de la phase 3.
 */
export async function processTicket(merchantId: string, ticketId: string): Promise<void> {
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, merchantId },
    include: {
      merchant: true,
      messages: { orderBy: { receivedAt: 'asc' }, take: 20 },
    },
  });

  if (!ticket) {
    logger.warn({ merchantId, ticketId }, 'Ticket introuvable, traitement abandonné');
    return;
  }

  const lastInbound = [...ticket.messages]
    .reverse()
    .find((message) => message.direction === 'INBOUND');

  if (!lastInbound) {
    logger.warn({ merchantId, ticketId }, 'Aucun message entrant, rien à traiter');
    return;
  }

  await prisma.ticket.update({
    where: { id: ticket.id },
    data: { status: 'PROCESSING' },
  });

  try {
    // 1. Classification
    const classification = await classifyEmail({
      subject: lastInbound.subject,
      bodyText: lastInbound.bodyText,
    });

    // Hors périmètre SAV : on classe et on s'arrête là, sans brouillon.
    if (classification.intent === 'OTHER' || classification.intent === 'POSITIVE') {
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          intent: classification.intent,
          intentConfidence: classification.confidence,
          status: 'NEEDS_REVIEW',
        },
      });
      return;
    }

    // 2. Rattachement commande
    const shopify = await getShopifyClient(merchantId);
    const match = await matchOrder(shopify, {
      customerEmail: ticket.customerEmail,
      customerName: ticket.customerName,
      bodyText: lastInbound.bodyText,
      receivedAt: lastInbound.receivedAt,
    });

    let order: OrderSummary | null = null;
    let ambiguousOrders: OrderSummary[] | undefined;

    if (match.status === 'MATCHED') {
      order = match.order;
    } else if (match.status === 'AMBIGUOUS') {
      ambiguousOrders = match.candidates;
    }

    await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        intent: classification.intent,
        intentConfidence: classification.confidence,
        shopifyOrderId: order?.id ?? null,
        orderName: order?.name ?? null,
        orderMatchMethod: match.status === 'NOT_FOUND' ? null : match.method,
        orderMatchScore: match.status === 'MATCHED' ? match.score : null,
      },
    });

    // 3. Ce que la boutique sait déjà de ce client, et dans quelle langue il
    // écrit. Deux requêtes locales : le coût est négligeable devant l'appel au
    // modèle, et l'écart de qualité de la réponse ne l'est pas.
    const [previousTickets, refunds] = await Promise.all([
      prisma.ticket.count({
        where: {
          merchantId,
          customerEmail: ticket.customerEmail,
          id: { not: ticket.id },
        },
      }),
      prisma.refund.count({
        where: { merchantId, ticket: { customerEmail: ticket.customerEmail } },
      }),
    ]);

    const language = detectLanguage(lastInbound.bodyText, lastInbound.subject);

    await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        language,
        // Échéance de première réponse : l'ancienneté dit qu'un ticket traîne,
        // l'échéance dit s'il est en faute.
        dueAt: new Date(
          lastInbound.receivedAt.getTime() + ticket.merchant.slaHours * 60 * 60 * 1000,
        ),
      },
    });

    const context: GenerationContext = {
      playbook: ticket.merchant.playbook,
      language,
      history: {
        orders: order ? (order.customer?.numberOfOrders ?? 1) : 0,
        spent: order?.customer?.amountSpent ?? null,
        currency: order?.currency ?? null,
        previousTickets,
        refunds,
      },
      merchantName: ticket.merchant.name ?? ticket.merchant.shopDomain,
      intent: classification.intent,
      customerName: ticket.customerName,
      subject: ticket.subject,
      thread: ticket.messages.map((message) => ({
        role: message.direction === 'INBOUND' ? 'customer' : 'merchant',
        text: message.bodyText,
        at: message.receivedAt,
      })),
      order,
      ambiguousOrders,
    };

    const generated = await generateReply(context);

    // 4. Brouillon Gmail
    const { draftId } = await createReplyDraft({
      merchantId,
      // Le brouillon se crée dans la boîte qui a reçu le message : c'est
      // l'adresse que le client connaît.
      mailboxId: ticket.mailboxId,
      threadId: ticket.gmailThreadId,
      to: ticket.customerEmail,
      subject: ticket.subject ?? 'Votre demande',
      body: generated.body,
      inReplyToMessageId: lastInbound.gmailMessageId,
    });

    await prisma.draft.create({
      data: {
        merchantId,
        ticketId: ticket.id,
        gmailDraftId: draftId,
        body: generated.body,
        // Modèle réellement interrogé, pas une constante : indispensable pour
        // comparer deux fournisseurs sur le même trafic.
        model: await describeActiveModel(),
        confidence: generated.confidence,
        reasoning: generated.reasoning,
        status: 'PENDING_REVIEW',
        createdBy: 'AI',
      },
    });

    const needsReview =
      generated.needsHuman ||
      classification.confidence < 0.7 ||
      generated.confidence < ticket.merchant.autoSendThreshold;

    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: needsReview ? 'NEEDS_REVIEW' : 'DRAFT_READY' },
    });

    await recordAudit({
      merchantId,
      actorType: 'AI',
      action: 'draft.created',
      targetType: 'Ticket',
      targetId: ticket.id,
      metadata: {
        intent: classification.intent,
        intentConfidence: classification.confidence,
        draftConfidence: generated.confidence,
        orderMatch: match.status,
        orderName: order?.name ?? null,
      },
    });
  } catch (error) {
    logger.error({ merchantId, ticketId, err: error }, 'Échec du traitement du ticket');
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: 'FAILED' },
    });
    throw error;
  }
}
