import { env } from '../config/env.ts';
import { hmacSha256Hex, safeEqual } from './crypto.ts';

/* ------------------------------------------------- accès permanent fournisseur */

export interface SupplierWorkspacePayload {
  supplierId: string;
  merchantId: string;
  version: number;
}

/**
 * Lien de travail permanent d'un fournisseur.
 *
 * Il ne périme pas, contrairement à l'ancien jeton d'escalade (retiré avec
 * son portail) : un fournisseur l'ouvre tous les matins pour saisir les
 * envois de la veille. Un
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
