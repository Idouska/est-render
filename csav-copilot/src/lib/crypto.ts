import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { env } from '../config/env.ts';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recommandé pour GCM
const VERSION = 'v1';

const key = Buffer.from(env.ENCRYPTION_KEY, 'base64');

/**
 * Chiffre un secret marchand (access token, refresh token).
 * Format : v1:<iv b64>:<tag b64>:<ciphertext b64>
 *
 * Le préfixe de version permet une rotation de clé future sans migration
 * destructive : on ajoutera un `v2` déchiffrable en parallèle.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(
    ':',
  );
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(':');

  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Payload chiffré illisible ou de version inconnue');
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Comparaison à temps constant de deux chaînes (HMAC, state OAuth). */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** HMAC-SHA256 en base64 — utilisé pour vérifier les webhooks Shopify. */
export function hmacSha256Base64(secret: string, payload: string | Buffer): string {
  return createHmac('sha256', secret).update(payload).digest('base64');
}

/** HMAC-SHA256 en hexadécimal — utilisé pour l'OAuth Shopify. */
export function hmacSha256Hex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}
