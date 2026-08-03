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

  // Fournisseur actif : un seul point de bascule, lu uniquement par
  // services/ai/factory.ts. Ni classify.ts ni generate.ts ne savent lequel
  // tourne.
  AI_PROVIDER: z.enum(['anthropic', 'deepseek']).default('anthropic'),

  // Optionnelles au niveau du schéma : la présence requise dépend du
  // AI_PROVIDER choisi, vérifiée explicitement plus bas.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),

  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_MODEL: z.string().default('deepseek-chat'),
  DEEPSEEK_BASE_URL: z.string().default('https://api.deepseek.com/v1'),

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

if (env.AI_PROVIDER === 'deepseek' && !env.DEEPSEEK_API_KEY) {
  throw new Error('AI_PROVIDER=deepseek nécessite DEEPSEEK_API_KEY');
}

if (env.AI_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
  throw new Error('AI_PROVIDER=anthropic (par défaut) nécessite ANTHROPIC_API_KEY');
}

/** Les raccourcis de développement (connexion sans OAuth, données fictives). */
export const devMode = env.NODE_ENV !== 'production';

export const shopifyRedirectUri = `${env.APP_URL}/auth/shopify/callback`;
export const googleRedirectUri = `${env.APP_URL}/auth/google/callback`;
