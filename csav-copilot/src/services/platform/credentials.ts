import { env } from '../../config/env.ts';
import { decryptSecret, encryptSecret } from '../../lib/crypto.ts';
import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';

/**
 * Identifiants de la plateforme : ceux de l'éditeur, pas ceux des marchands.
 *
 * Deux sources, dans cet ordre : la table `PlatformSetting` (réglée depuis la
 * console d'administration, chiffrée au repos) puis la variable
 * d'environnement du même nom. Une base vide se comporte donc exactement comme
 * avant l'existence de cette table.
 *
 * Pourquoi ne pas tout garder en variables d'environnement : sur Render, les
 * modifier redémarre les trois services et impose de retrouver l'interface
 * d'hébergement. Corriger une clé d'IA expirée devient une opération de
 * déploiement alors que c'est un geste d'exploitation.
 *
 * Pourquoi ne pas tout basculer en base : `DATABASE_URL`, `ENCRYPTION_KEY`,
 * `APP_URL` et `REDIS_URL` restent des variables d'environnement obligatoires.
 * Les mettre en base serait circulaire — il faut déjà la base et la clé de
 * chiffrement pour lire la table.
 */

export const CREDENTIAL_KEYS = [
  'AI_PROVIDER',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_MODEL',
  'DEEPSEEK_BASE_URL',
  'SHOPIFY_API_KEY',
  'SHOPIFY_API_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_PUBSUB_TOPIC',
  'GOOGLE_PUBSUB_SERVICE_ACCOUNT',
  'TRACK17_API_KEY',
  'PARCELSAPP_API_KEY',
] as const;

export type CredentialKey = (typeof CREDENTIAL_KEYS)[number];

/**
 * Clés dont la valeur ne ressort jamais de l'API d'administration : elles
 * s'écrivent, se testent, mais ne se relisent pas. Une console qui réaffiche
 * les secrets transforme un accès admin en fuite de tous les identifiants.
 */
export const SECRET_KEYS: ReadonlySet<CredentialKey> = new Set<CredentialKey>([
  'ANTHROPIC_API_KEY',
  'DEEPSEEK_API_KEY',
  'SHOPIFY_API_SECRET',
  'GOOGLE_CLIENT_SECRET',
  'TRACK17_API_KEY',
  'PARCELSAPP_API_KEY',
]);

/** Valeurs de repli quand ni la base ni l'environnement ne fournissent rien. */
const DEFAULTS: Partial<Record<CredentialKey, string>> = {
  AI_PROVIDER: 'anthropic',
  ANTHROPIC_MODEL: 'claude-opus-5',
  DEEPSEEK_MODEL: 'deepseek-chat',
  DEEPSEEK_BASE_URL: 'https://api.deepseek.com/v1',
};

export type CredentialSource = 'database' | 'environment' | 'default' | 'missing';

export interface ResolvedCredential {
  key: CredentialKey;
  value: string | undefined;
  source: CredentialSource;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export type Credentials = Record<CredentialKey, string | undefined>;

export class MissingCredentialError extends Error {
  readonly key: CredentialKey;

  constructor(key: CredentialKey, usage: string) {
    super(
      `Identifiant de plateforme manquant : ${key}. ${usage} Réglez-le dans la console d’administration (/admin) ou en variable d’environnement.`,
    );
    this.name = 'MissingCredentialError';
    this.key = key;
  }
}

/**
 * Cache mémoire court.
 *
 * L'API, le worker et le cron sont trois processus distincts : une écriture
 * dans l'un ne peut pas vider le cache des autres. La durée de vie borne donc
 * le délai de propagation d'un changement — quelques secondes, contre un
 * redéploiement complet auparavant. Elle évite en même temps une requête SQL
 * sur chaque appel de modèle.
 */
const CACHE_TTL_MS = 30_000;

let cache: { values: Credentials; expiresAt: number } | null = null;

/** Vide le cache local. Appelé après toute écriture dans ce processus. */
export function invalidateCredentialsCache(): void {
  cache = null;
}

function fromEnvironment(key: CredentialKey): string | undefined {
  const value = (env as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

async function readDatabase(): Promise<Map<CredentialKey, { value: string; updatedAt: Date; updatedBy: string | null }>> {
  const rows = await prisma.platformSetting.findMany({
    where: { key: { in: [...CREDENTIAL_KEYS] } },
  });

  const map = new Map<CredentialKey, { value: string; updatedAt: Date; updatedBy: string | null }>();

  for (const row of rows) {
    try {
      map.set(row.key as CredentialKey, {
        value: decryptSecret(row.valueEnc),
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
      });
    } catch (error) {
      // ENCRYPTION_KEY a changé depuis l'écriture : la ligne est illisible.
      // On l'ignore plutôt que de faire tomber tout le processus — le repli
      // par variable d'environnement reprend la main, et la console affiche
      // la clé comme non réglée.
      logger.error({ key: row.key, err: error }, 'Réglage de plateforme indéchiffrable');
    }
  }

  return map;
}

/** Détail par clé, source comprise — ce qu'affiche la console d'administration. */
export async function describeCredentials(): Promise<ResolvedCredential[]> {
  const stored = await readDatabase();

  return CREDENTIAL_KEYS.map((key) => {
    const row = stored.get(key);
    if (row) {
      return { key, value: row.value, source: 'database' as const, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
    }

    const fromEnv = fromEnvironment(key);
    if (fromEnv !== undefined) {
      return { key, value: fromEnv, source: 'environment' as const, updatedAt: null, updatedBy: null };
    }

    const fallback = DEFAULTS[key];
    return {
      key,
      value: fallback,
      source: fallback === undefined ? ('missing' as const) : ('default' as const),
      updatedAt: null,
      updatedBy: null,
    };
  });
}

/** Valeurs effectives, mises en cache. C'est ce que le code applicatif consomme. */
export async function getCredentials(): Promise<Credentials> {
  if (cache && cache.expiresAt > Date.now()) return cache.values;

  const values = Object.fromEntries(
    (await describeCredentials()).map((entry) => [entry.key, entry.value]),
  ) as Credentials;

  cache = { values, expiresAt: Date.now() + CACHE_TTL_MS };
  return values;
}

/** Comme `getCredentials`, mais lève si la clé demandée est absente partout. */
export async function requireCredential(key: CredentialKey, usage: string): Promise<string> {
  const value = (await getCredentials())[key];
  if (!value) throw new MissingCredentialError(key, usage);
  return value;
}

/**
 * Écrit ou efface des réglages.
 *
 * Une valeur `null` supprime la ligne et rend la main à la variable
 * d'environnement : c'est le seul moyen de revenir à la configuration de
 * déploiement sans vider la base à la main.
 */
export async function setCredentials(
  entries: Partial<Record<CredentialKey, string | null>>,
  updatedBy: string,
): Promise<void> {
  const operations = Object.entries(entries).map(([rawKey, value]) => {
    const key = rawKey as CredentialKey;

    if (value === null) {
      return prisma.platformSetting.deleteMany({ where: { key } });
    }

    const valueEnc = encryptSecret(value);
    return prisma.platformSetting.upsert({
      where: { key },
      create: { key, valueEnc, updatedBy },
      update: { valueEnc, updatedBy },
    });
  });

  await prisma.$transaction(operations);
  invalidateCredentialsCache();
}
