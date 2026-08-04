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

/* ------------------------------------------------- accès permanent fournisseur */

export interface SupplierWorkspacePayload {
  supplierId: string;
  merchantId: string;
  version: number;
}

/**
 * Lien de travail permanent d'un fournisseur.
 *
 * Distinct du jeton d'escalade ci-dessus : celui-là ne périme pas, parce qu'un
 * fournisseur l'ouvre tous les matins pour saisir les envois de la veille. Un
 * lien qui expire au bout de trente jours obligerait le marchand à en renvoyer
 * un chaque mois, et finirait recopié dans un carnet.
 *
 * En contrepartie il est révocable : le numéro de version est comparé à celui
 * stocké sur le fournisseur, et l'incrémenter invalide tous les liens émis
 * jusque-là. C'est la parade en cas de fuite, ou quand on cesse de travailler
 * avec quelqu'un.
 *
 * Le préfixe de signature diffère (`supplier-ws:`) pour qu'un jeton d'escalade
 * ne puisse jamais servir de jeton d'atelier, ni l'inverse.
 */
export function signSupplierWorkspaceToken(payload: SupplierWorkspacePayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${hmacSha256Hex(env.ENCRYPTION_KEY, `supplier-ws:${encoded}`)}`;
}

export function verifySupplierWorkspaceToken(
  token: string | undefined | null,
): SupplierWorkspacePayload | null {
  if (!token) return null;

  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  if (!safeEqual(signature, hmacSha256Hex(env.ENCRYPTION_KEY, `supplier-ws:${encoded}`))) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}
