import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.ts';
import {
  ADMIN_COOKIE,
  adminEnabled,
  checkAdminPassword,
  signAdminSession,
  verifyAdminSession,
} from '../lib/adminSession.ts';
import { logger } from '../lib/logger.ts';
import {
  CREDENTIAL_KEYS,
  SECRET_KEYS,
  describeCredentials,
  setCredentials,
  type CredentialKey,
} from '../services/platform/credentials.ts';
import { CHECKS, type CheckName } from '../services/platform/healthchecks.ts';

/**
 * Console d'administration de la plateforme.
 *
 * Elle n'existe que si `ADMIN_PASSWORD` est configuré : sans mot de passe, les
 * routes ne sont pas enregistrées du tout, plutôt qu'exposées derrière un
 * contrôle vide.
 *
 * Ce qu'elle ne fait jamais : renvoyer un secret déjà enregistré. Une clé
 * s'écrit, se teste et s'efface, mais ne se relit pas — sinon un seul accès
 * admin suffirait à récupérer tous les identifiants de la plateforme.
 */

const loginBody = z.object({ password: z.string().min(1) });

const patchBody = z.object({
  values: z.record(z.string(), z.string().max(4000).nullable()),
});

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!verifyAdminSession(request.cookies[ADMIN_COOKIE])) {
    await reply.code(401).send({ error: 'Session administrateur absente ou expirée' });
  }
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  if (!adminEnabled) {
    logger.warn(
      'ADMIN_PASSWORD absent : la console d’administration est désactivée. Les identifiants de plateforme restent lus depuis les variables d’environnement.',
    );

    app.get('/admin', async (request, reply) =>
      reply.code(404).type('text/plain; charset=utf-8').send(
        'Console d’administration désactivée : définissez ADMIN_PASSWORD (12 caractères minimum) pour l’activer.',
      ),
    );
    return;
  }

  app.get('/admin', async (request, reply) => reply.type('text/html').sendFile('admin.html'));

  app.post('/api/admin/login', async (request, reply) => {
    const parsed = loginBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Mot de passe requis' });

    if (!checkAdminPassword(parsed.data.password)) {
      // Journalisé : c'est la seule porte d'entrée vers les identifiants de
      // toute la plateforme, les tentatives ratées doivent laisser une trace.
      logger.warn({ ip: request.ip }, 'Tentative de connexion administrateur refusée');
      return reply.code(401).send({ error: 'Mot de passe incorrect' });
    }

    reply.setCookie(ADMIN_COOKIE, signAdminSession(), {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    });

    logger.info({ ip: request.ip }, 'Connexion administrateur');
    return reply.send({ ok: true });
  });

  app.post('/api/admin/logout', async (request, reply) => {
    reply.clearCookie(ADMIN_COOKIE, { path: '/' });
    return reply.send({ ok: true });
  });

  app.get('/api/admin/settings', { preHandler: requireAdmin }, async (request, reply) => {
    const resolved = await describeCredentials();

    return reply.send({
      settings: resolved.map((entry) => {
        const secret = SECRET_KEYS.has(entry.key);

        return {
          key: entry.key,
          secret,
          configured: Boolean(entry.value),
          source: entry.source,
          updatedAt: entry.updatedAt,
          updatedBy: entry.updatedBy,
          // Un secret ne ressort jamais : seule une empreinte, de quoi
          // reconnaître qu'on a collé la bonne clé sans jamais l'exposer.
          value: secret ? null : (entry.value ?? null),
          fingerprint:
            secret && entry.value
              ? `${entry.value.length} caractères · …${entry.value.slice(-4)}`
              : null,
        };
      }),
    });
  });

  app.patch('/api/admin/settings', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = patchBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Requête invalide', details: parsed.error.issues });
    }

    const unknown = Object.keys(parsed.data.values).filter(
      (key) => !CREDENTIAL_KEYS.includes(key as CredentialKey),
    );
    if (unknown.length > 0) {
      return reply.code(400).send({ error: `Réglages inconnus : ${unknown.join(', ')}` });
    }

    const entries: Partial<Record<CredentialKey, string | null>> = {};

    for (const [rawKey, rawValue] of Object.entries(parsed.data.values)) {
      const key = rawKey as CredentialKey;

      if (rawValue === null) {
        entries[key] = null;
        continue;
      }

      const value = rawValue.trim();

      // Une chaîne vide vaut effacement : sans ça, vider un champ écrirait un
      // secret vide en base, qui masquerait la variable d'environnement.
      if (value.length === 0) {
        entries[key] = null;
        continue;
      }

      if (key === 'AI_PROVIDER' && value !== 'anthropic' && value !== 'deepseek') {
        return reply.code(400).send({ error: 'AI_PROVIDER doit valoir anthropic ou deepseek.' });
      }

      if (key === 'DEEPSEEK_BASE_URL') {
        try {
          new URL(value);
        } catch {
          return reply.code(400).send({ error: 'DEEPSEEK_BASE_URL n’est pas une URL valide.' });
        }
      }

      entries[key] = value;
    }

    if (Object.keys(entries).length === 0) {
      return reply.code(400).send({ error: 'Aucun réglage à mettre à jour' });
    }

    await setCredentials(entries, `admin@${request.ip}`);

    // Les clés modifiées, jamais les valeurs.
    logger.info({ keys: Object.keys(entries), ip: request.ip }, 'Réglages de plateforme modifiés');

    return reply.send({ ok: true, updated: Object.keys(entries) });
  });

  app.post<{ Params: { name: string } }>(
    '/api/admin/check/:name',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const name = request.params.name as CheckName;
      const check = CHECKS[name];

      if (!check) {
        return reply.code(404).send({ error: `Test inconnu : ${request.params.name}` });
      }

      return reply.send({ result: await check() });
    },
  );
}
