import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { cookies } from 'next/headers';
import { authOptions } from '@/lib/auth';
import { ShopifyClient } from '@/lib/shopify';
import { db } from '@/lib/db';
import * as schema from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.redirect(new URL('/login', req.url));

  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  const cookieStore = await cookies();
  const savedState = cookieStore.get('shopify_oauth_state')?.value;
  const shopDomain = cookieStore.get('shopify_oauth_shop')?.value;

  if (!code || !state || state !== savedState || !shopDomain) {
    return NextResponse.redirect(new URL('/integrations?error=oauth_failed', req.url));
  }

  try {
    const accessToken = await ShopifyClient.exchangeCodeForToken(
      shopDomain, code,
      process.env.SHOPIFY_CLIENT_ID!,
      process.env.SHOPIFY_CLIENT_SECRET!
    );

    const client = new ShopifyClient(shopDomain, accessToken);
    await client.registerWebhooks(process.env.NEXT_PUBLIC_APP_URL!);

    const tenantId = session.user.tenantId;
    const now = new Date().toISOString();

    const [existing] = await db.select({ id: schema.integrations.id }).from(schema.integrations)
      .where(and(eq(schema.integrations.tenantId, tenantId), eq(schema.integrations.platform, 'SHOPIFY')))
      .limit(1);

    if (existing) {
      await db.update(schema.integrations)
        .set({ status: 'ACTIVE', shopDomain, accessToken, updatedAt: now })
        .where(eq(schema.integrations.id, existing.id));
    } else {
      await db.insert(schema.integrations).values({
        id: randomUUID(), tenantId, platform: 'SHOPIFY', status: 'ACTIVE',
        shopDomain, accessToken,
        webhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET ?? null,
        createdAt: now, updatedAt: now,
      });
    }

    const res = NextResponse.redirect(new URL('/integrations?connected=shopify', req.url));
    res.cookies.delete('shopify_oauth_state');
    res.cookies.delete('shopify_oauth_shop');
    return res;
  } catch (err) {
    console.error('[shopify/callback]', err);
    return NextResponse.redirect(new URL('/integrations?error=oauth_failed', req.url));
  }
}
