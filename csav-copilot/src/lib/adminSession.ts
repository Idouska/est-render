import { timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.ts';
import { hmacSha256Hex, safeEqual } from './crypto.ts';

export const ADMIN_COOKIE = 'csav_admin';
const MAX_AGE_MS = 4 * 60 * 60 * 1000;

/**
 * Session de la console d'administration.
 *
 * Séparée de la session marchand : même cookie signé, mais un préfixe de
 * domaine différent dans le HMAC. Sans lui, un jeton marchand valide serait
 * accepté comme jeton admin, puisque les deux sont signés avec la même clé.
 *
 * Durée volontairement courte (4 h contre 12 h côté marchand) : cette session
 * donne accès aux identifiants de toute la plateforme.
 */
const DOMAIN = 'admin';

interface AdminPayload {
  issuedAt: number;
}

/** La console n'existe que si un mot de passe est configuré. */
export const adminEnabled = Boolean(env.ADMIN_PASSWORD);

export function signAdminSession(): string {
  const encoded = Buffer.from(JSON.stringify({ issuedAt: Date.now() } satisfies AdminPayload)).toString(
    'base64url',
  );
  return `${encoded}.${hmacSha256Hex(env.ENCRYPTION_KEY, `${DOMAIN}|${encoded}`)}`;
}

export function verifyAdminSession(token: string | undefined): boolean {
  if (!adminEnabled || !token) return false;

  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return false;

  if (!safeEqual(signature, hmacSha256Hex(env.ENCRYPTION_KEY, `${DOMAIN}|${encoded}`))) return false;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as AdminPayload;
    return Date.now() - payload.issuedAt <= MAX_AGE_MS;
  } catch {
    return false;
  }
}

/**
 * Compare le mot de passe fourni à celui configuré, à temps constant.
 *
 * `safeEqual` renvoie `false` immédiatement quand les longueurs diffèrent, ce
 * qui laisse fuir la longueur du mot de passe. On compare donc des empreintes
 * HMAC, toujours de même taille.
 */
export function checkAdminPassword(candidate: string): boolean {
  if (!env.ADMIN_PASSWORD) return false;

  const a = Buffer.from(hmacSha256Hex(env.ENCRYPTION_KEY, `password|${candidate}`), 'hex');
  const b = Buffer.from(hmacSha256Hex(env.ENCRYPTION_KEY, `password|${env.ADMIN_PASSWORD}`), 'hex');

  return timingSafeEqual(a, b);
}
