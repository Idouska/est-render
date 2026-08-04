import { env } from '../config/env.ts';
import { hmacSha256Hex, safeEqual } from './crypto.ts';

/**
 * Lien de connexion nominatif, signé, à usage unique dans les faits.
 *
 * Pourquoi pas de mot de passe : l'application n'a rien à stocker de plus
 * sensible qu'elle ne stocke déjà, et un mot de passe de plus dans une équipe
 * SAV finit sur un post-it partagé. Le lien arrive dans la boîte de la
 * personne, ce qui prouve qu'elle la contrôle — la même garantie qu'un
 * « mot de passe oublié », sans l'étape inutile.
 *
 * Limite assumée, identique à celle du portail fournisseur : un jeton signé par
 * HMAC ne se révoque pas individuellement. La parade est la durée courte, et le
 * fait que `requireSession` relise le compte en base à chaque requête — un
 * compte désactivé perd l'accès immédiatement, jeton valide ou non.
 */

const INVITE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_MAX_AGE_MS = 30 * 60 * 1000;

export type LoginTokenKind = 'invite' | 'login';

export interface LoginTokenPayload {
  userId: string;
  merchantId: string;
  kind: LoginTokenKind;
  issuedAt: number;
}

const MAX_AGE: Record<LoginTokenKind, number> = {
  invite: INVITE_MAX_AGE_MS,
  login: LOGIN_MAX_AGE_MS,
};

export function signLoginToken(payload: Omit<LoginTokenPayload, 'issuedAt'>): string {
  const body = JSON.stringify({ ...payload, issuedAt: Date.now() } satisfies LoginTokenPayload);
  const encoded = Buffer.from(body, 'utf8').toString('base64url');
  // Préfixe de domaine : un jeton de session marchand ou de portail
  // fournisseur, signé avec la même clé, ne doit pas pouvoir passer ici.
  return `${encoded}.${hmacSha256Hex(env.ENCRYPTION_KEY, `login:${encoded}`)}`;
}

export function verifyLoginToken(token: string | undefined | null): LoginTokenPayload | null {
  if (!token) return null;

  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;

  if (!safeEqual(signature, hmacSha256Hex(env.ENCRYPTION_KEY, `login:${encoded}`))) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as LoginTokenPayload;

    if (payload.kind !== 'invite' && payload.kind !== 'login') return null;
    if (Date.now() - payload.issuedAt > MAX_AGE[payload.kind]) return null;

    return payload;
  } catch {
    return null;
  }
}
