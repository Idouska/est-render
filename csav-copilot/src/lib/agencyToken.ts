import { env } from '../config/env.ts';
import { hmacSha256Hex, safeEqual } from './crypto.ts';

export interface AgencyTokenPayload {
  agencyId: string;
  merchantId: string;
  version: number;
}

/**
 * Lien de travail permanent d'une agence de retours.
 *
 * Même principe que celui de l'atelier : un lien signé, pas un compte. Il ne
 * périme pas — l'agence l'ouvre chaque fois qu'une commande lui est confiée —
 * mais il se révoque : le numéro de version est comparé à celui de l'agence,
 * et l'incrémenter invalide tous les liens déjà transmis.
 *
 * Le préfixe de signature (`agence:`) diffère de celui de l'atelier : un lien
 * d'atelier ne peut jamais ouvrir le portail d'une agence, ni l'inverse.
 */
export function signAgencyToken(payload: AgencyTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${hmacSha256Hex(env.ENCRYPTION_KEY, `agence:${encoded}`)}`;
}

export function verifyAgencyToken(token: string | undefined | null): AgencyTokenPayload | null {
  if (!token) return null;

  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  if (!safeEqual(signature, hmacSha256Hex(env.ENCRYPTION_KEY, `agence:${encoded}`))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as AgencyTokenPayload;
    return typeof payload.agencyId === 'string' && typeof payload.version === 'number' ? payload : null;
  } catch {
    return null;
  }
}
