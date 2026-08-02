import { env } from '../config/env.ts';
import { hmacSha256Hex, safeEqual } from './crypto.ts';

export const SESSION_COOKIE = 'csav_session';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface SessionPayload {
  merchantId: string;
  userId: string;
  issuedAt: number;
}

/**
 * Session applicative signée (HMAC), stockée dans un cookie httpOnly.
 * Suffisant pour le MVP mono-utilisateur ; à remplacer par une session en base
 * (révocable) quand plusieurs agents partageront un marchand.
 */
export function signSession(payload: Omit<SessionPayload, 'issuedAt'>): string {
  const body = JSON.stringify({ ...payload, issuedAt: Date.now() } satisfies SessionPayload);
  const encoded = Buffer.from(body, 'utf8').toString('base64url');
  return `${encoded}.${hmacSha256Hex(env.ENCRYPTION_KEY, encoded)}`;
}

export function verifySession(token: string | undefined): SessionPayload | null {
  if (!token) return null;

  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;

  if (!safeEqual(signature, hmacSha256Hex(env.ENCRYPTION_KEY, encoded))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (Date.now() - payload.issuedAt > MAX_AGE_MS) return null;
    return payload;
  } catch {
    return null;
  }
}
