import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError } from 'fastify';
import { devMode, env } from './config/env.ts';
import { logger } from './lib/logger.ts';
import { prisma } from './lib/prisma.ts';
import { googleAuthRoutes } from './routes/auth.google.ts';
import { shopifyAuthRoutes } from './routes/auth.shopify.ts';
import { adminRoutes } from './routes/admin.ts';
import { commerceRoutes } from './routes/commerce.ts';
import { devRoutes } from './routes/dev.ts';
import { refundRoutes } from './routes/refunds.ts';
import { cannedReplyRoutes } from './routes/cannedReplies.ts';
import { parcelRoutes } from './routes/parcels.ts';
import { attachmentRoutes } from './routes/attachments.ts';
import { settingsRoutes } from './routes/settings.ts';
import { shopRoutes } from './routes/shops.ts';
import { supplierWorkspaceRoutes } from './routes/supplierWorkspace.ts';
import { supplierPortalRoutes } from './routes/supplierPortal.ts';
import { statsRoutes } from './routes/stats.ts';
import { returnRoutes } from './routes/returns.ts';
import { supplierRoutes } from './routes/suppliers.ts';
import { teamRoutes } from './routes/team.ts';
import { ticketRoutes } from './routes/tickets.ts';
import { gmailWebhookRoutes } from './routes/webhooks.gmail.ts';

// `public/` est à la racine du projet, hors de `src/` : le chemin est donc le
// même que l'on exécute les sources TypeScript ou le build dans `dist/`.
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export async function buildServer() {
  const app = Fastify({ loggerInstance: logger, trustProxy: true });

  await app.register(cookie);

  // Le corps brut est nécessaire pour vérifier le HMAC des webhooks Shopify :
  // toute re-sérialisation JSON change les octets et casse la signature.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (request, body, done) => {
      const raw = typeof body === 'string' ? body : body.toString('utf8');
      request.rawBody = raw;
      try {
        done(null, raw.length === 0 ? {} : JSON.parse(raw));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  app.get('/health', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  });

  // Lue par le dashboard avant toute session, pour proposer le bon chemin de
  // connexion : installation Shopify en production, raccourci en local.

  await app.register(fastifyStatic, {
    root: join(projectRoot, 'public'),
    prefix: '/static/',
    /*
     * Revalidation obligatoire à chaque chargement.
     *
     * Sans en-tête de cache explicite, le navigateur applique son heuristique
     * et garde `app.js` plusieurs heures : on déploie un correctif, on
     * recharge, et l'ancien fichier s'exécute. Le symptôme est le pire qui
     * soit — « je ne vois aucune différence » — parce qu'il ressemble à un
     * code qui ne marche pas. `max-age=0` avec l'ETag ne coûte qu'un aller-
     * retour de quelques octets quand le fichier n'a pas bougé.
     */
    cacheControl: true,
    maxAge: 0,
    setHeaders(response) {
      response.setHeader('Cache-Control', 'no-cache, must-revalidate');
    },
  });

  /**
   * Empreinte des fichiers servis, pour forcer le rechargement après un
   * déploiement.
   *
   * Calculée au démarrage depuis la date de modification des fichiers : un
   * nouveau conteneur, donc un nouveau déploiement, donc une nouvelle
   * empreinte. Elle s'ajoute aux URL des scripts et feuilles de style de la
   * page, ce qui rend le cache du navigateur inoffensif sans l'empêcher de
   * servir les chargements suivants.
   */
  const assetVersion = await (async () => {
    const { stat } = await import('node:fs/promises');
    const files = ['app.js', 'styles.css', 'workspace.js', 'workspace.css'];
    const times = await Promise.all(
      files.map((file) =>
        stat(join(projectRoot, 'public', file))
          .then((info) => info.mtimeMs)
          .catch(() => 0),
      ),
    );
    return Math.max(...times).toString(36);
  })();

  const startedAt = new Date().toISOString();

  /*
   * Ce que le navigateur exécute réellement.
   *
   * Deux fois déjà, une panne signalée n'en était pas une : le serveur avait
   * la correction, le navigateur servait encore l'ancien fichier. L'empreinte
   * du déploiement, affichée dans les Réglages, distingue « ça ne marche pas »
   * de « ce n'est pas encore déployé » en une seconde — au lieu d'un
   * aller-retour et d'une correction cherchée là où elle n'est pas.
   */
  app.get('/api/config', async () => ({ devMode, assetVersion, startedAt }));

  const { readFile } = await import('node:fs/promises');
  const pageCache = new Map<string, string>();

  /** Sert une page en marquant ses ressources de l'empreinte du déploiement. */
  async function sendPage(reply: import('fastify').FastifyReply, file: string) {
    let html = pageCache.get(file);

    if (!html) {
      html = (await readFile(join(projectRoot, 'public', file), 'utf8')).replace(
        /(\/static\/[\w.-]+\.(?:js|css))/g,
        `$1?v=${assetVersion}`,
      );
      pageCache.set(file, html);
    }

    // La page elle-même n'est jamais mise en cache : c'est elle qui porte
    // l'empreinte, la garder reviendrait à garder l'ancienne version.
    return reply
      .header('Cache-Control', 'no-store')
      .type('text/html')
      .send(html);
  }

  // Le dashboard est une page unique servie par l'API : pas de second serveur
  // à lancer, pas de CORS, pas d'étape de build.
  app.get('/', async (request, reply) => reply.redirect('/dashboard'));
  app.get('/dashboard', async (request, reply) => sendPage(reply, 'dashboard.html'));

  // Politique de confidentialité et CGU : URL stables, exigées telles quelles
  // par l'écran de consentement OAuth Google et par la fiche Shopify Partners.
  // Contenu à faire valider avant tout usage réel — voir le bandeau sur ces
  // pages et docs/08-mise-en-ligne.md.
  // Page de demande de lien : la seule entrée pour un membre d'équipe qui
  // n'est pas passé par l'installation Shopify.
  app.get('/login', async (request, reply) => reply.type('text/html').sendFile('login.html'));

  app.get('/privacy', async (request, reply) => reply.type('text/html').sendFile('privacy.html'));
  app.get('/terms', async (request, reply) => reply.type('text/html').sendFile('terms.html'));

  await app.register(shopifyAuthRoutes);
  await app.register(googleAuthRoutes);
  await app.register(gmailWebhookRoutes);
  await app.register(ticketRoutes);
  await app.register(refundRoutes);
  await app.register(settingsRoutes);
  await app.register(attachmentRoutes);
  await app.register(cannedReplyRoutes);
  await app.register(parcelRoutes);
  await app.register(shopRoutes);
  await app.register(commerceRoutes);
  await app.register(statsRoutes);
  await app.register(supplierRoutes);
  await app.register(returnRoutes);
  await app.register(teamRoutes);
  await app.register(supplierPortalRoutes);
  await app.register(supplierWorkspaceRoutes);
  await app.register(adminRoutes);

  if (devMode) {
    await app.register(devRoutes);
  }

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, 'Erreur non gérée');
    const status = error.statusCode ?? 500;
    void reply.code(status).send({
      error: status >= 500 ? 'Erreur interne' : error.message,
    });
  });

  return app;
}

export async function startServer() {
  const app = await buildServer();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  return app;
}
