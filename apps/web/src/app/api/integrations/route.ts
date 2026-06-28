import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import * as schema from '@/lib/schema';
import { eq } from 'drizzle-orm';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const items = await db.select({
    id: schema.integrations.id,
    platform: schema.integrations.platform,
    status: schema.integrations.status,
    shopDomain: schema.integrations.shopDomain,
    storeUrl: schema.integrations.storeUrl,
    lastSyncAt: schema.integrations.lastSyncAt,
    syncedOrders: schema.integrations.syncedOrders,
    syncedCustomers: schema.integrations.syncedCustomers,
  }).from(schema.integrations)
    .where(eq(schema.integrations.tenantId, session.user.tenantId));

  return NextResponse.json(items);
}
