import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import crypto from 'crypto';
import { authOptions } from '@/lib/auth';
import { ShopifyClient } from '@/lib/shopify';

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const shop = searchParams.get('shop');

  if (!shop) return NextResponse.json({ error: 'Paramètre shop manquant.' }, { status: 400 });

  const shopDomain = shop.endsWith('.myshopify.com') ? shop : `${shop}.myshopify.com`;
  const state = crypto.randomBytes(16).toString('hex');
  const clientId = process.env.SHOPIFY_CLIENT_ID!;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/shopify/callback`;

  const authUrl = ShopifyClient.getOAuthUrl(shopDomain, clientId, redirectUri, state);

  const res = NextResponse.redirect(authUrl);
  res.cookies.set('shopify_oauth_state', state, { httpOnly: true, secure: true, maxAge: 600 });
  res.cookies.set('shopify_oauth_shop', shopDomain, { httpOnly: true, secure: true, maxAge: 600 });
  return res;
}
