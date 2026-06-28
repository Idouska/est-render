import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { WooCommerceClient } from '@/lib/woocommerce';
import { db } from '@/lib/db';
import * as schema from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const tenantId = session.user.tenantId;
  const [integration] = await db.select().from(schema.integrations)
    .where(and(eq(schema.integrations.tenantId, tenantId), eq(schema.integrations.platform, 'WOOCOMMERCE')))
    .limit(1);

  if (!integration?.storeUrl || !integration.consumerKey || !integration.consumerSecret) {
    return NextResponse.json({ error: 'Intégration WooCommerce non configurée.' }, { status: 400 });
  }

  const client = new WooCommerceClient(integration.storeUrl, integration.consumerKey, integration.consumerSecret);

  try {
    const orders = await client.getOrders(100);
    let syncedOrders = 0;
    let syncedCustomers = 0;

    for (const order of orders) {
      const billing = order.billing;
      const email = billing.email;
      if (!email) continue;

      const now = new Date().toISOString();

      const [existing] = await db.select({ id: schema.customers.id }).from(schema.customers)
        .where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.email, email)))
        .limit(1);

      let customerId: string;
      if (existing) {
        await db.update(schema.customers).set({ firstName: billing.first_name, lastName: billing.last_name, updatedAt: now })
          .where(eq(schema.customers.id, existing.id));
        customerId = existing.id;
      } else {
        customerId = randomUUID();
        await db.insert(schema.customers).values({
          id: customerId, tenantId, email,
          firstName: billing.first_name, lastName: billing.last_name,
          phone: billing.phone ?? null,
          externalId: order.customer_id > 0 ? String(order.customer_id) : null,
          platform: 'woocommerce', createdAt: now, updatedAt: now,
        });
        syncedCustomers++;
      }

      const [existingOrder] = await db.select({ id: schema.orders.id }).from(schema.orders)
        .where(and(
          eq(schema.orders.tenantId, tenantId),
          eq(schema.orders.externalId, String(order.id)),
          eq(schema.orders.platform, 'woocommerce')
        )).limit(1);

      if (existingOrder) {
        await db.update(schema.orders).set({ status: order.status, total: parseFloat(order.total), updatedAt: now })
          .where(eq(schema.orders.id, existingOrder.id));
      } else {
        const orderId = randomUUID();
        await db.insert(schema.orders).values({
          id: orderId, tenantId, externalId: String(order.id),
          orderNumber: order.number, status: order.status,
          total: parseFloat(order.total), currency: order.currency,
          customerId, platform: 'woocommerce', createdAt: now, updatedAt: now,
        });
        if (order.line_items?.length) {
          await db.insert(schema.orderItems).values(
            order.line_items.map((item) => ({
              id: randomUUID(), orderId,
              name: item.name, sku: item.sku || null,
              quantity: item.quantity, price: item.price,
              imageUrl: item.image?.src ?? null,
            }))
          );
        }
        syncedOrders++;
      }
    }

    await db.update(schema.integrations).set({
      lastSyncAt: new Date().toISOString(), syncedOrders, syncedCustomers, updatedAt: new Date().toISOString(),
    }).where(eq(schema.integrations.id, integration.id));

    return NextResponse.json({ synced: { orders: syncedOrders, customers: syncedCustomers } });
  } catch (err) {
    console.error('[woocommerce/sync]', err);
    return NextResponse.json({ error: 'Erreur de synchronisation.' }, { status: 500 });
  }
}
