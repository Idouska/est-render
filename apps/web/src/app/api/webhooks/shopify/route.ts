import { NextResponse } from 'next/server';
import { ShopifyClient } from '@/lib/shopify';
import { db } from '@/lib/db';
import * as schema from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export async function POST(req: Request) {
  const topic = req.headers.get('x-shopify-topic') ?? '';
  const shopDomain = req.headers.get('x-shopify-shop-domain') ?? '';
  const signature = req.headers.get('x-shopify-hmac-sha256') ?? '';

  const rawBody = await req.text();

  const [integration] = await db.select({ tenantId: schema.integrations.tenantId, webhookSecret: schema.integrations.webhookSecret })
    .from(schema.integrations)
    .where(and(eq(schema.integrations.platform, 'SHOPIFY'), eq(schema.integrations.shopDomain, shopDomain)))
    .limit(1);

  if (!integration) return NextResponse.json({ error: 'Unknown shop' }, { status: 404 });

  const secret = integration.webhookSecret ?? process.env.SHOPIFY_WEBHOOK_SECRET ?? '';
  if (secret && !ShopifyClient.verifyWebhookSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const tenantId = integration.tenantId;
  const now = new Date().toISOString();

  try {
    if (topic.startsWith('orders/')) {
      const order = payload;
      const custRef = order.customer;
      if (!custRef?.email) return NextResponse.json({ ok: true });

      const [existingCustomer] = await db.select({ id: schema.customers.id }).from(schema.customers)
        .where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.email, custRef.email))).limit(1);

      let customerId: string;
      if (existingCustomer) {
        customerId = existingCustomer.id;
        await db.update(schema.customers).set({ firstName: custRef.first_name, lastName: custRef.last_name, updatedAt: now })
          .where(eq(schema.customers.id, customerId));
      } else {
        customerId = randomUUID();
        await db.insert(schema.customers).values({
          id: customerId, tenantId, email: custRef.email,
          firstName: custRef.first_name, lastName: custRef.last_name,
          externalId: String(custRef.id), platform: 'shopify', createdAt: now, updatedAt: now,
        });
      }

      const [existingOrder] = await db.select({ id: schema.orders.id }).from(schema.orders)
        .where(and(eq(schema.orders.tenantId, tenantId), eq(schema.orders.externalId, String(order.id)), eq(schema.orders.platform, 'shopify'))).limit(1);

      if (existingOrder) {
        await db.update(schema.orders).set({
          status: order.fulfillment_status ?? order.financial_status ?? 'pending',
          total: parseFloat(order.total_price ?? '0'), updatedAt: now,
        }).where(eq(schema.orders.id, existingOrder.id));
      } else {
        const orderId = randomUUID();
        await db.insert(schema.orders).values({
          id: orderId, tenantId, externalId: String(order.id),
          orderNumber: String(order.order_number),
          status: order.fulfillment_status ?? order.financial_status ?? 'pending',
          total: parseFloat(order.total_price ?? '0'), currency: order.currency ?? 'EUR',
          customerId, platform: 'shopify', createdAt: now, updatedAt: now,
        });
      }
    }

    if (topic.startsWith('customers/')) {
      const cust = payload;
      const [existing] = await db.select({ id: schema.customers.id }).from(schema.customers)
        .where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.email, cust.email))).limit(1);

      if (existing) {
        await db.update(schema.customers).set({ firstName: cust.first_name, lastName: cust.last_name, phone: cust.phone ?? null, updatedAt: now })
          .where(eq(schema.customers.id, existing.id));
      } else {
        await db.insert(schema.customers).values({
          id: randomUUID(), tenantId, email: cust.email,
          firstName: cust.first_name, lastName: cust.last_name, phone: cust.phone ?? null,
          externalId: String(cust.id), platform: 'shopify', createdAt: now, updatedAt: now,
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[webhook/shopify]', err);
    return NextResponse.json({ error: 'Processing error' }, { status: 500 });
  }
}
