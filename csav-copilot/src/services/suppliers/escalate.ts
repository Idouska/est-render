import { env } from '../../config/env.ts';
import { recordAudit } from '../../lib/audit.ts';
import { signSupplierToken } from '../../lib/supplierToken.ts';
import { prisma } from '../../lib/prisma.ts';
import { generateSupplierDraft } from '../ai/supplierDraft.ts';
import { sendPlainEmail } from '../gmail/send.ts';
import { escalationHtml, escalationSubject, escalationText } from './notifyEmail.ts';
import { getShopifyClient } from '../shopify/client.ts';
import { formatAddress, getOrderById } from '../shopify/orders.ts';

export class SupplierNotConfiguredError extends Error {
  constructor(merchantId: string) {
    super(`Aucun fournisseur configuré pour le marchand ${merchantId}`);
    this.name = 'SupplierNotConfiguredError';
  }
}

/**
 * Crée une escalade et rédige le message vers le fournisseur.
 *
 * N'envoie rien : le message reste en `DRAFTING`, relu par l'agent comme un
 * brouillon client — même logique de confiance humaine, juste un
 * destinataire différent.
 */
type EscalationReason = 'OUT_OF_STOCK' | 'INCORRECT_ADDRESS' | 'MISSING_ITEM' | 'OTHER';

export async function createEscalation(params: {
  merchantId: string;
  ticketId: string;
  reason: EscalationReason;
  note?: string | null;
  userId: string;
  /** Destinataire choisi par l'agent. Absent, on route d'après le motif. */
  supplierId?: string | null;
}) {
  const [merchant, ticket, suppliers] = await Promise.all([
    prisma.merchant.findUniqueOrThrow({ where: { id: params.merchantId } }),
    prisma.ticket.findFirstOrThrow({
      where: { id: params.ticketId, merchantId: params.merchantId },
      include: { messages: { orderBy: { receivedAt: 'desc' }, take: 1 } },
    }),
    prisma.supplier.findMany({
      where: { merchantId: params.merchantId, active: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const supplier = params.supplierId
    ? suppliers.find((candidate) => candidate.id === params.supplierId)
    : // À défaut d'un destinataire explicite : le premier contact actif. Mieux
      // vaut une escalade adressée au mauvais contact qu'un agent bloqué devant
      // un ticket urgent.
      suppliers[0];

  if (!supplier) {
    throw new SupplierNotConfiguredError(params.merchantId);
  }

  let orderName: string | null = null;
  let orderItems: string[] = [];
  let shippingAddress: string | null = null;

  if (ticket.shopifyOrderId) {
    const shopify = await getShopifyClient(params.merchantId);
    const order = await getOrderById(shopify, ticket.shopifyOrderId);
    if (order) {
      orderName = order.name;
      orderItems = order.lineItems.map(
        (item) => `${item.quantity} × ${item.title}${item.variantTitle ? ` (${item.variantTitle})` : ''}`,
      );
      shippingAddress = formatAddress(order.shippingAddress);
    }
  }

  const draft = await generateSupplierDraft({
    merchantName: merchant.name ?? merchant.shopDomain,
    supplierName: supplier.name,
    reason: params.reason,
    agentNote: params.note?.trim() || null,
    orderName,
    orderItems,
    shippingAddress,
    customerMessage: ticket.messages[0]?.bodyText ?? '(message introuvable)',
  });

  const escalation = await prisma.supplierEscalation.create({
    data: {
      merchantId: params.merchantId,
      ticketId: ticket.id,
      supplierId: supplier.id,
      reason: params.reason,
      note: params.note?.trim() || null,
      status: 'DRAFTING',
      messages: {
        create: {
          merchantId: params.merchantId,
          direction: 'TO_SUPPLIER',
          authorType: 'AI',
          body: draft.body,
        },
      },
    },
    include: { messages: true, supplier: true },
  });

  await recordAudit({
    merchantId: params.merchantId,
    actorType: 'USER',
    actorId: params.userId,
    action: 'supplier.escalation_created',
    targetType: 'SupplierEscalation',
    targetId: escalation.id,
    metadata: { reason: params.reason, ticketId: ticket.id, orderName },
  });

  return { escalation, subject: draft.subject };
}

/**
 * Envoie la notification au fournisseur : un lien vers le portail, pas le
 * contenu du message lui-même — le fournisseur découvre l'échange dans son
 * contexte plutôt que dans un mail qu'il pourrait égarer ou répondre en
 * direct (ce qui recréerait le problème que le portail évite : personne
 * ne surveille une boîte mail supplémentaire).
 */
export async function sendEscalation(params: {
  merchantId: string;
  escalationId: string;
  userId: string;
}): Promise<void> {
  const escalation = await prisma.supplierEscalation.findFirstOrThrow({
    where: { id: params.escalationId, merchantId: params.merchantId },
    include: { supplier: true, ticket: true },
  });

  if (escalation.status !== 'DRAFTING') {
    throw new Error(`Escalade déjà envoyée (statut ${escalation.status})`);
  }

  const token = signSupplierToken({
    escalationId: escalation.id,
    merchantId: params.merchantId,
  });
  const portalUrl = `${env.APP_URL}/supplier/${escalation.id}?token=${token}`;

  const merchant = await prisma.merchant.findUniqueOrThrow({
    where: { id: params.merchantId },
    select: { name: true, brandName: true, shopDomain: true },
  });

  const context = {
    merchantName: merchant.brandName || merchant.name || merchant.shopDomain,
    supplierName: escalation.supplier.name,
    // Le numéro de commande, jamais l'identifiant interne : « commande
    // cmsj3nfsu000liz01f92sk2c7 » en objet ne disait rien au destinataire et
    // envoyait le message droit en indésirables.
    orderName: escalation.ticket.orderName,
    reason: escalation.reason,
    portalUrl,
  };

  await sendPlainEmail({
    merchantId: params.merchantId,
    to: escalation.supplier.contactEmail,
    fromName: context.merchantName,
    subject: escalationSubject(context),
    body: escalationText(context),
    html: escalationHtml(context),
  });

  await prisma.$transaction([
    prisma.supplierEscalation.update({
      where: { id: escalation.id },
      data: { status: 'OPEN', notifiedAt: new Date() },
    }),
    prisma.ticket.update({
      where: { id: escalation.ticketId },
      data: { status: 'AWAITING_SUPPLIER' },
    }),
  ]);

  await recordAudit({
    merchantId: params.merchantId,
    actorType: 'USER',
    actorId: params.userId,
    action: 'supplier.notified',
    targetType: 'SupplierEscalation',
    targetId: escalation.id,
    metadata: { supplierEmail: escalation.supplier.contactEmail },
  });
}

/** Clôture manuelle par l'agent — le fournisseur a répondu, le sujet est traité. */
export async function resolveEscalation(params: {
  merchantId: string;
  escalationId: string;
  userId: string;
}): Promise<void> {
  const escalation = await prisma.supplierEscalation.findFirstOrThrow({
    where: { id: params.escalationId, merchantId: params.merchantId },
  });

  await prisma.supplierEscalation.update({
    where: { id: escalation.id },
    data: { status: 'RESOLVED', resolvedAt: new Date() },
  });

  await recordAudit({
    merchantId: params.merchantId,
    actorType: 'USER',
    actorId: params.userId,
    action: 'supplier.escalation_resolved',
    targetType: 'SupplierEscalation',
    targetId: escalation.id,
  });
}
