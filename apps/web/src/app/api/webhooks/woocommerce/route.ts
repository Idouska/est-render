import { NextResponse } from 'next/server';
import { WooCommerceClient } from '@/lib/woocommerce';
import { db } from '@/lib/db';
import * as schema from '@/lib/schema';
import { eq, and, like } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export async function POST(req: Request) {
  const topic = req.headers.get('x-wc-webhook-topic') ?? '';
  const source = req.headers.get('x-wc-webhook-source') ?? '';
  const signature = req.headers.get('x-wc-webhook-signature') ?? '';

  const rawBody = await req.text();

  const hostname = (() => {
    try { return new URL(source || 'https://placeholder.com').hostname; } catch { return ''; }
  })();

  const integrations = await db.select().from(schema.integrations)
    .where(and(eq(schema.integrations.platform, 'WOOCOMMERCE'), like(schema.integrations.storeUrl!, `%${hostname}%`)));

  const integration = integrations[0];
  if (!integration) return NextResponse.json({ ok: true });

  if (integration.webhookSecret && signature) {
    const valid = WooCommerceClient.verifyWebhookSignature(rawBody, signature, integration.webhookSecret);
    if (!valid) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const tenantId = integration.tenantId;
  const now = new Date().toISOString();

  try {
    if (topic.startsWith('order.')) {
      const order = payload;
      const billing = order.billing ?? {};
      const email = billing.email;
      if (!email) return NextResponse.json({ ok: true });

      const [existingCustomer] = await db.select({ id: schema.customers.id }).from(schema.customers)
        .where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.email, email))).limit(1);

      let customerId: string;
      if (existingCustomer) {
        customerId = existingCustomer.id;
        await db.update(schema.customers).set({ firstName: billing.first_name, lastName: billing.last_name, updatedAt: now })
          .where(eq(schema.customers.id, customerId));
      } else {
        customerId = randomUUID();
        await db.insert(schema.customers).values({
          id: customerId, tenantId, email, firstName: billing.first_name, lastName: billing.last_name,
          phone: billing.phone ?? null, platform: 'woocommerce', createdAt: now, updatedAt: now,
        });
      }

      const [existingOrder] = await db.select({ id: schema.orders.id }).from(schema.orders)
        .where(and(eq(schema.orders.tenantId, tenantId), eq(schema.orders.externalId, String(order.id)), eq(schema.orders.platform, 'woocommerce'))).limit(1);

      if (existingOrder) {
        await db.update(schema.orders).set({ status: order.status, total: parseFloat(order.total ?? '0'), updatedAt: now })
          .where(eq(schema.orders.id, existingOrder.id));
      } else {
        const orderId = randomUUID();
        await db.insert(schema.orders).values({
          id: orderId, tenantId, externalId: String(order.id), orderNumber: String(order.number),
          status: order.status, total: parseFloat(order.total ?? '0'), currency: order.currency ?? 'EUR',
          customerId, platform: 'woocommerce', createdAt: now, updatedAt: now,
        });
      }
    }

    if (topic.startsWith('customer.')) {
      const cust = payload;
      if (!cust.email) return NextResponse.json({ ok: true });

      const [existing] = await db.select({ id: schema.customers.id }).from(schema.customers)
        .where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.email, cust.email))).limit(1);

      if (existing) {
        await db.update(schema.customers).set({ firstName: cust.first_name, lastName: cust.last_name, updatedAt: now })
          .where(eq(schema.customers.id, existing.id));
      } else {
        await db.insert(schema.customers).values({
          id: randomUUID(), tenantId, email: cust.email,
          firstName: cust.first_name, lastName: cust.last_name,
          platform: 'woocommerce', externalId: String(cust.id), createdAt: now, updatedAt: now,
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[webhook/woocommerce]', err);
    return NextResponse.json({ error: 'Processing error' }, { status: 500 });
  }
}
