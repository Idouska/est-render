import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { WooCommerceClient } from '@/lib/woocommerce';
import { db } from '@/lib/db';
import * as schema from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const connectSchema = z.object({
  storeUrl: z.string().url(),
  consumerKey: z.string().min(1),
  consumerSecret: z.string().min(1),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const body = await req.json();
  const parsed = connectSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'URL ou clés invalides.' }, { status: 400 });

  const { storeUrl, consumerKey, consumerSecret } = parsed.data;
  const client = new WooCommerceClient(storeUrl, consumerKey, consumerSecret);

  const ok = await client.testConnection();
  if (!ok) {
    return NextResponse.json(
      { error: "Impossible de se connecter. Vérifiez l'URL et les clés API." },
      { status: 400 }
    );
  }

  const webhookSecret = randomUUID();
  const deliveryUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/woocommerce`;
  await client.registerWebhooks(deliveryUrl, webhookSecret).catch(() => {});

  const tenantId = session.user.tenantId;
  const now = new Date().toISOString();

  const [existing] = await db.select({ id: schema.integrations.id }).from(schema.integrations)
    .where(and(eq(schema.integrations.tenantId, tenantId), eq(schema.integrations.platform, 'WOOCOMMERCE')))
    .limit(1);

  if (existing) {
    await db.update(schema.integrations)
      .set({ status: 'ACTIVE', storeUrl, consumerKey, consumerSecret, webhookSecret, updatedAt: now })
      .where(eq(schema.integrations.id, existing.id));
  } else {
    await db.insert(schema.integrations).values({
      id: randomUUID(), tenantId, platform: 'WOOCOMMERCE', status: 'ACTIVE',
      storeUrl, consumerKey, consumerSecret, webhookSecret,
      createdAt: now, updatedAt: now,
    });
  }

  return NextResponse.json({ success: true });
}
