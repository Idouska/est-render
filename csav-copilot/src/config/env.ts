import { z } from 'zod';

const csv = (value: string) =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  // 32 octets en base64 => 44 caractères avec padding.
  ENCRYPTION_KEY: z
    .string()
    .refine((value) => Buffer.from(value, 'base64').length === 32, {
      message: 'ENCRYPTION_KEY doit être 32 octets encodés en base64',
    }),

  SHOPIFY_API_KEY: z.string().min(1),
  SHOPIFY_API_SECRET: z.string().min(1),
  SHOPIFY_SCOPES: z.string().transform(csv),
  SHOPIFY_API_VERSION: z.string().default('2025-01'),

  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_SCOPES: z.string().transform(csv),
  GOOGLE_PUBSUB_TOPIC: z.string().min(1),
  GOOGLE_PUBSUB_SERVICE_ACCOUNT: z.string().min(1),

  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),

  // Développement uniquement : remplace les appels Shopify par un jeu de
  // commandes fictives, pour travailler l'interface sans boutique réelle.
  // Refusé en production (cf. contrôle ci-dessous).
  SHOPIFY_MOCK: z
    .enum(['0', '1'])
    .default('0')
    .transform((value) => value === '1'),

  // Idem pour Gmail : les brouillons sont simulés, aucun mail n'est écrit ni
  // envoyé. Indispensable pour faire tourner le dashboard sans boîte connectée.
  GMAIL_MOCK: z
    .enum(['0', '1'])
    .default('0')
    .transform((value) => value === '1'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Configuration invalide :\n${details}`);
}

export const env = parsed.data;

if (env.NODE_ENV === 'production' && (env.SHOPIFY_MOCK || env.GMAIL_MOCK)) {
  throw new Error('SHOPIFY_MOCK et GMAIL_MOCK ne peuvent pas être activés en production');
}

/** Les raccourcis de développement (connexion sans OAuth, données fictives). */
export const devMode = env.NODE_ENV !== 'production';

export const shopifyRedirectUri = `${env.APP_URL}/auth/shopify/callback`;
export const googleRedirectUri = `${env.APP_URL}/auth/google/callback`;
