import { env } from '../config/env.ts';
import { hmacSha256Hex, safeEqual } from './crypto.ts';

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

export interface SupplierTokenPayload {
  escalationId: string;
  merchantId: string;
  issuedAt: number;
}

/**
 * Accès du fournisseur au portail : un lien signé, pas un compte.
 *
 * Le fournisseur n'a ni identifiant ni mot de passe à retenir — il reçoit un
 * lien par email et l'ouvre. Le jeton est scopé à une seule escalade : il ne
 * donne accès qu'à ce fil-là, jamais au reste des données du marchand.
 *
 * Limite assumée pour la phase 1 : un jeton signé par HMAC ne se révoque pas
 * individuellement (contrairement à une session en base). Si un lien fuite,
 * la seule parade est de clore l'escalade côté marchand — elle devient
 * inaccessible en écriture (cf. verifySupplierToken dans les routes) même si
 * le jeton reste valide 30 jours. Pour plusieurs fournisseurs actifs, un vrai
 * compte avec jetons révocables en base deviendra nécessaire.
 */
export function signSupplierToken(payload: Omit<SupplierTokenPayload, 'issuedAt'>): string {
  const body = JSON.stringify({
    ...payload,
    issuedAt: Date.now(),
  } satisfies SupplierTokenPayload);
  const encoded = Buffer.from(body, 'utf8').toString('base64url');
  return `${encoded}.${hmacSha256Hex(env.ENCRYPTION_KEY, `supplier:${encoded}`)}`;
}

export function verifySupplierToken(token: string | undefined | null): SupplierTokenPayload | null {
  if (!token) return null;

  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;

  if (!safeEqual(signature, hmacSha256Hex(env.ENCRYPTION_KEY, `supplier:${encoded}`))) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as SupplierTokenPayload;
    if (Date.now() - payload.issuedAt > MAX_AGE_MS) return null;
    return payload;
  } catch {
    return null;
  }
}
