import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { ShopifyClient } from '@/lib/shopify';
import { db } from '@/lib/db';
import * as schema from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const tenantId = session.user.tenantId;

  const [integration] = await db.select().from(schema.integrations)
    .where(and(eq(schema.integrations.tenantId, tenantId), eq(schema.integrations.platform, 'SHOPIFY')))
    .limit(1);

  if (!integration || integration.status !== 'ACTIVE' || !integration.shopDomain || !integration.accessToken) {
    return NextResponse.json({ error: 'Intégration Shopify non configurée.' }, { status: 400 });
  }

  const client = new ShopifyClient(integration.shopDomain, integration.accessToken);

  try {
    const orders = await client.getOrders(250);
    let syncedOrders = 0;
    let syncedCustomers = 0;

    for (const order of orders) {
      const custRef = order.customer;
      if (!custRef?.email) continue;

      const now = new Date().toISOString();

      const [existing] = await db.select({ id: schema.customers.id }).from(schema.customers)
        .where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.email, custRef.email)))
        .limit(1);

      let customerId: string;
      if (existing) {
        await db.update(schema.customers).set({ firstName: custRef.first_name, lastName: custRef.last_name, updatedAt: now })
          .where(eq(schema.customers.id, existing.id));
        customerId = existing.id;
      } else {
        customerId = randomUUID();
        await db.insert(schema.customers).values({
          id: customerId, tenantId, email: custRef.email,
          firstName: custRef.first_name, lastName: custRef.last_name,
          externalId: String(custRef.id), platform: 'shopify',
          createdAt: now, updatedAt: now,
        });
        syncedCustomers++;
      }

      const [existingOrder] = await db.select({ id: schema.orders.id }).from(schema.orders)
        .where(and(
          eq(schema.orders.tenantId, tenantId),
          eq(schema.orders.externalId, String(order.id)),
          eq(schema.orders.platform, 'shopify')
        )).limit(1);

      if (existingOrder) {
        await db.update(schema.orders).set({
          status: order.fulfillment_status ?? order.financial_status,
          total: parseFloat(order.total_price),
          updatedAt: now,
        }).where(eq(schema.orders.id, existingOrder.id));
      } else {
        const orderId = randomUUID();
        await db.insert(schema.orders).values({
          id: orderId, tenantId, externalId: String(order.id),
          orderNumber: String(order.order_number),
          status: order.fulfillment_status ?? order.financial_status ?? 'pending',
          total: parseFloat(order.total_price), currency: order.currency,
          customerId, platform: 'shopify',
          platformUrl: order.order_status_url ?? null,
          createdAt: now, updatedAt: now,
        });
        if (order.line_items?.length) {
          await db.insert(schema.orderItems).values(
            order.line_items.map((item) => ({
              id: randomUUID(), orderId,
              name: item.title, sku: item.sku || null,
              quantity: item.quantity, price: parseFloat(item.price),
              imageUrl: item.image?.src ?? null,
            }))
          );
        }
        syncedOrders++;
      }
    }

    await db.update(schema.integrations).set({
      lastSyncAt: new Date().toISOString(),
      syncedOrders, syncedCustomers, updatedAt: new Date().toISOString(),
    }).where(eq(schema.integrations.id, integration.id));

    return NextResponse.json({ synced: { orders: syncedOrders, customers: syncedCustomers } });
  } catch (err) {
    console.error('[shopify/sync]', err);
    await db.update(schema.integrations).set({ status: 'ERROR', updatedAt: new Date().toISOString() })
      .where(eq(schema.integrations.id, integration.id));
    return NextResponse.json({ error: 'Erreur de synchronisation.' }, { status: 500 });
  }
}
