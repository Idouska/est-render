import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config/env.ts";
import { recordAudit } from "../lib/audit.ts";
import { decryptSecret } from "../lib/crypto.ts";
import { prisma } from "../lib/prisma.ts";
import { PREVIEW_COOKIE, requirePermission, requireSession } from "../plugins/auth.ts";
import { backfillMailbox, backfillProgress } from "../services/gmail/backfill.ts";
import { createOAuthClient, getGmailClient } from "../services/gmail/client.ts";
import { importMailboxHistory } from "../services/gmail/importHistory.ts";
import { stopWatch } from "../services/gmail/watch.ts";
import { ingestMerchantInbox } from "../services/tickets/ingest.ts";
import { ShopifyScopeError } from "../services/shopify/client.ts";
import { fetchShopPolicies, policiesToPlaybook } from "../services/shopify/policies.ts";
import { decodePhoto, photoSchema } from "./parcels.ts";

/**
 * Boîtes dont l'import tourne, pour ne pas le lancer deux fois et pour que
 * l'interface montre l'attente. En mémoire du processus : l'information ne
 * survit pas à un redémarrage, et c'est acceptable — un import interrompu se
 * relance, il est idempotent.
 */
const importsRunning = new Set<string>();

/**
 * Réglages du marchand.
 *
 * Rien ici ne demande de coller une clé d'API : les accès Shopify et Gmail
 * s'obtiennent par OAuth (boutons connecter/déconnecter), et les identifiants
 * de la plateforme appartiennent à l'éditeur, pas au marchand — ils se règlent
 * dans la console d'administration (`/admin`).
 *
 * Ce que le marchand décide vraiment : le degré d'autonomie laissé à l'IA, et
 * la durée de conservation de ses données.
 */

const patchBody = z
  .object({
    name: z.string().min(1).max(200).nullable().optional(),
    brandName: z.string().max(120).nullish(),
    // Une URL d'image, pas un envoi de fichier : le marchand héberge déjà son
    // logo sur son thème Shopify ou son site, et stocker des binaires
    // demanderait un espace de fichiers à sauvegarder et à purger.
    logoUrl: z.string().url().max(500).nullish(),
    /**
     * Logo téléversé, en data URL. `null` efface l'image et fait retomber sur
     * `logoUrl`, puis sur les initiales — un logo qu'on ne peut pas retirer
     * oblige à en mettre un autre pour s'en débarrasser.
     */
    logo: photoSchema.nullish(),
    trackingUrlTemplate: z.string().max(300).nullish(),
    playbook: z.string().max(8000).nullish(),
    slaHours: z.number().int().min(1).max(240).optional(),
    autoSendEnabled: z.boolean().optional(),
    // Un seuil sous 0,5 reviendrait à envoyer des réponses que le modèle
    // lui-même juge douteuses. Le plancher est volontairement haut.
    autoSendThreshold: z.number().min(0.5).max(1).optional(),
    // 30 jours au minimum pour rester exploitable, 3 ans au maximum : au-delà,
    // la conservation devient difficile à justifier au titre du RGPD.
    retentionDays: z.number().int().min(30).max(1095).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Aucun champ à mettre à jour",
  });

/**
 * Une autorisation accordée en couvre-t-elle une autre ?
 *
 * Shopify n'énumère pas `read_orders` quand `write_orders` est accordé — la
 * lecture est incluse. Sans cette règle, l'écran réclame en permanence une
 * autorisation déjà obtenue, et le marchand réinstalle son application pour
 * rien.
 */
function covers(granted: string[], required: string): boolean {
  if (granted.includes(required)) return true;

  const readable = required.startsWith("read_")
    ? `write_${required.slice(5)}`
    : null;
  return readable !== null && granted.includes(readable);
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireSession);

  /**
   * Logo de la boutique.
   *
   * Servi par l'application plutôt que depuis une URL publique : le logo suit
   * la boutique, et un lien externe finit toujours par casser.
   */
  app.get("/api/branding/logo", async (request, reply) => {
    const merchant = await prisma.merchant.findUnique({
      where: { id: request.session.merchantId },
      select: { logoData: true, logoMime: true },
    });

    if (!merchant?.logoData || !merchant.logoMime) {
      return reply.code(404).send({ error: "Aucun logo" });
    }

    return reply
      .type(merchant.logoMime)
      .header("Cache-Control", "private, max-age=300")
      .send(Buffer.from(merchant.logoData));
  });

  app.get("/api/settings", async (request, reply) => {
    const { merchantId } = request.session;

    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      include: {
        shopify: {
          select: { installedAt: true, uninstalledAt: true, scopes: true },
        },
        mailboxes: {
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
          select: {
            id: true,
            emailAddress: true,
            label: true,
            isDefault: true,
            watchExpiration: true,
            createdAt: true,
          },
        },
      },
    });

    if (!merchant)
      return reply.code(404).send({ error: "Marchand introuvable" });

    return reply.send({
      merchant: {
        name: merchant.name,
        brandName: merchant.brandName,
        logoUrl: merchant.logoUrl,
        hasLogo: Boolean(merchant.logoMime),
        logoUpdatedAt: merchant.updatedAt,
        trackingUrlTemplate: merchant.trackingUrlTemplate,
        playbook: merchant.playbook,
        slaHours: merchant.slaHours,
        shopDomain: merchant.shopDomain,
        status: merchant.status,
        autoSendEnabled: merchant.autoSendEnabled,
        autoSendThreshold: merchant.autoSendThreshold,
        retentionDays: merchant.retentionDays,
      },
      connections: {
        shopify: (() => {
          const granted =
            merchant.shopify?.scopes
              ?.split(",")
              .map((s) => s.trim())
              .filter(Boolean) ?? [];

          return {
            connected: Boolean(
              merchant.shopify && !merchant.shopify.uninstalledAt,
            ),
            simulated: env.SHOPIFY_MOCK,
            scopes: granted,
            // Le jeton conserve les autorisations obtenues le jour de
            // l'installation : élargir la liste demandée ne change rien tant que
            // l'application n'a pas été réinstallée. Sans cet écart affiché, la
            // panne se manifeste seulement par un « accès refusé » sur un écran.
            requiredScopes: env.SHOPIFY_SCOPES,
            missingScopes: env.SHOPIFY_SCOPES.filter(
              (scope) => !covers(granted, scope),
            ),
            installedAt: merchant.shopify?.installedAt ?? null,
          };
        })(),
        gmail: {
          connected: merchant.mailboxes.length > 0,
          simulated: env.GMAIL_MOCK,
          // Boîtes listées une à une : chacune a son propre watch, et une
          // seule expirée suffit à faire disparaître silencieusement une
          // partie du courrier.
          mailboxes: merchant.mailboxes.map((mailbox) => ({
            id: mailbox.id,
            emailAddress: mailbox.emailAddress,
            label: mailbox.label,
            isDefault: mailbox.isDefault,
            connectedAt: mailbox.createdAt,
            watchExpiration: mailbox.watchExpiration,
            watchActive: Boolean(
              mailbox.watchExpiration && mailbox.watchExpiration > new Date(),
            ),
          })),
        },
      },
    });
  });

  /**
   * Réglages d'une boîte : libellé, boîte par défaut, débranchement.
   *
   * Débrancher n'efface pas les tickets reçus — la relation les laisse
   * orphelins plutôt que de les emporter. Perdre l'historique du SAV parce
   * qu'on retire une adresse serait une catastrophe silencieuse.
   */
  app.patch<{ Params: { id: string } }>(
    "/api/mailboxes/:id",
    { preHandler: requirePermission("configure") },
    async (request, reply) => {
      const parsed = z
        .object({
          label: z.string().max(60).nullish(),
          isDefault: z.literal(true).optional(),
        })
        .safeParse(request.body);

      if (!parsed.success)
        return reply.code(400).send({ error: "Requête invalide" });

      const { merchantId, userId } = request.session;

      const mailbox = await prisma.gmailConnection.findFirst({
        where: { id: request.params.id, merchantId },
        select: { id: true, emailAddress: true },
      });
      if (!mailbox) return reply.code(404).send({ error: "Boîte introuvable" });

      // Une seule boîte par défaut : la désignation se fait en deux temps dans
      // une transaction, sinon un échec laisserait la boutique sans aucune.
      if (parsed.data.isDefault) {
        await prisma.$transaction([
          prisma.gmailConnection.updateMany({
            where: { merchantId },
            data: { isDefault: false },
          }),
          prisma.gmailConnection.update({
            where: { id: mailbox.id },
            data: { isDefault: true },
          }),
        ]);
      }

      if (parsed.data.label !== undefined) {
        await prisma.gmailConnection.update({
          where: { id: mailbox.id },
          data: { label: parsed.data.label?.trim() || null },
        });
      }

      await recordAudit({
        merchantId,
        actorType: "USER",
        actorId: userId,
        action: "mailbox.updated",
        targetType: "GmailConnection",
        targetId: mailbox.id,
        metadata: { emailAddress: mailbox.emailAddress, ...parsed.data },
        ipAddress: request.ip,
      });

      return reply.send({ ok: true });
    },
  );

  /**
   * Apprentissage sur l'historique d'une boîte.
   *
   * Déclenché à la main, boîte par boîte, jamais en tâche de fond : une
   * adresse connectée pour des essais ne doit pas être aspirée parce qu'elle
   * était branchée. Le marchand choisit celle dont les réponses font
   * référence.
   *
   * Réponse immédiate, travail en arrière-plan : parcourir plusieurs centaines
   * de fils dépasse largement le temps d'une requête HTTP. L'avancement se lit
   * sur `GET /api/learning`.
   */
  app.post<{ Params: { id: string } }>(
    "/api/mailboxes/:id/learn",
    { preHandler: requirePermission("configure") },
    async (request, reply) => {
      const parsed = z
        .object({ months: z.number().int().min(1).max(24).optional() })
        .safeParse(request.body ?? {});
      if (!parsed.success)
        return reply.code(400).send({ error: "Requête invalide" });

      const { merchantId, userId } = request.session;

      const mailbox = await prisma.gmailConnection.findFirst({
        where: { id: request.params.id, merchantId },
        select: { id: true, emailAddress: true },
      });
      if (!mailbox) return reply.code(404).send({ error: "Boîte introuvable" });

      if (importsRunning.has(mailbox.id)) {
        return reply
          .code(409)
          .send({ error: "Un apprentissage est déjà en cours sur cette boîte." });
      }

      await recordAudit({
        merchantId,
        actorType: "USER",
        actorId: userId,
        action: "mailbox.learn",
        targetType: "GmailConnection",
        targetId: mailbox.id,
        metadata: {
          emailAddress: mailbox.emailAddress,
          months: parsed.data.months ?? 6,
        },
        ipAddress: request.ip,
      });

      importsRunning.add(mailbox.id);
      void importMailboxHistory({
        merchantId,
        mailboxId: mailbox.id,
        ...(parsed.data.months ? { months: parsed.data.months } : {}),
      })
        .catch((error: unknown) => {
          request.log.error(
            { err: error, mailboxId: mailbox.id },
            "Import historique échoué",
          );
        })
        .finally(() => importsRunning.delete(mailbox.id));

      return reply.code(202).send({ started: true });
    },
  );

  /**
   * Politiques publiques de la boutique, mises en forme de playbook.
   *
   * En lecture seule : on propose un texte, c'est le marchand qui l'enregistre
   * après relecture. Écrire directement dans le playbook écraserait sans
   * prévenir des consignes que Shopify ne connaît pas.
   */
  app.get(
    "/api/settings/policies",
    { preHandler: requirePermission("configure") },
    async (request, reply) => {
      const { merchantId } = request.session;

      try {
        const policies = await fetchShopPolicies(merchantId);
        return reply.send({
          playbook: policiesToPlaybook(policies),
          sections: policies.sections.length,
          shopName: policies.shopName,
        });
      } catch (error) {
        if (error instanceof ShopifyScopeError) {
          return reply.code(409).send({
            error:
              "Shopify refuse l'accès aux politiques. Réautorisez l'application depuis les réglages.",
          });
        }
        request.log.error({ err: error, merchantId }, "Lecture des politiques échouée");
        return reply
          .code(502)
          .send({ error: "Shopify n'a pas répondu. Réessayez dans un instant." });
      }
    },
  );

  /**
   * Simulation de rôle.
   *
   * Un propriétaire doit pouvoir constater ce que voit un agent avant de lui
   * confier la boutique. La restriction est appliquée par le serveur, pas
   * seulement masquée à l'écran : une simulation graphique laisserait passer
   * les requêtes qu'elle prétend interdire, et donnerait une fausse assurance.
   *
   * Aucune vérification de droits ici : `effectiveRole` ne retient jamais
   * qu'un rôle plus étroit que le rôle réel, donc demander à voir en
   * propriétaire quand on est agent ne produit rien.
   */
  app.post("/api/preview-role", async (request, reply) => {
    const parsed = z
      .object({
        role: z.enum(["OWNER", "SUPERVISOR", "AGENT", "VIEWER"]).nullable(),
      })
      .safeParse(request.body);

    if (!parsed.success) return reply.code(400).send({ error: "Rôle inconnu" });

    if (parsed.data.role === null) {
      reply.clearCookie(PREVIEW_COOKIE, { path: "/" });
      return reply.send({ role: null });
    }

    reply.setCookie(PREVIEW_COOKIE, parsed.data.role, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      // Deux heures : une simulation oubliée qui survit à la nuit ferait
      // croire à une perte de droits le lendemain matin.
      maxAge: 7200,
    });

    return reply.send({ role: parsed.data.role });
  });

  /**
   * Bilan de santé d'une boîte.
   *
   * L'ingestion échoue en silence par construction : Pub/Sub pousse, une file
   * encaisse, un worker traite. Si l'un des trois manque, rien ne se produit et
   * rien ne le dit — l'écran affiche « écoute active » pendant que le courrier
   * s'accumule ailleurs. Ce relevé interroge Gmail en direct et compare à ce
   * que la base contient, ce qui désigne l'étage en panne au lieu de laisser
   * chercher.
   */
  app.get<{ Params: { id: string } }>(
    "/api/mailboxes/:id/diagnose",
    { preHandler: requirePermission("configure") },
    async (request, reply) => {
      const { merchantId } = request.session;

      const mailbox = await prisma.gmailConnection.findFirst({
        where: { id: request.params.id, merchantId },
      });
      if (!mailbox) return reply.code(404).send({ error: "Boîte introuvable" });

      const report: Record<string, unknown> = {
        emailAddress: mailbox.emailAddress,
        watchActive: Boolean(
          mailbox.watchExpiration && mailbox.watchExpiration > new Date(),
        ),
        watchExpiration: mailbox.watchExpiration,
        // Sans curseur, l'ingestion incrémentale n'a pas de point de départ et
        // retombe sur un balayage des deux derniers jours.
        hasCursor: Boolean(mailbox.lastHistoryId),
      };

      try {
        const { gmail } = await getGmailClient(merchantId, mailbox.id);

        // Le profil prouve que le jeton vit encore. C'est le premier point à
        // écarter : une autorisation révoquée ressemble à une file vide.
        const { data: profile } = await gmail.users.getProfile({ userId: "me" });
        report.tokenValid = true;
        report.totalMessages = profile.messagesTotal ?? null;

        // `-from:me` écarte ce que la boutique a elle-même envoyé, que
        // l'ingestion ignore délibérément. Sans cette exclusion, le rapport
        // comptait comme « absents » des messages qui n'ont jamais eu vocation
        // à entrer — et annonçait une panne là où il n'y avait qu'une règle.
        const { data: list } = await gmail.users.messages.list({
          userId: "me",
          q: "in:inbox newer_than:7d -from:me",
          // Cent plutôt que vingt-cinq : à vingt-cinq, le compte butait sur le
          // plafond et se lisait comme un total alors qu'il était une troncature.
          maxResults: 100,
        });

        const ids = (list.messages ?? []).map((m) => m.id!).filter(Boolean);
        report.inboxLast7Days = ids.length;
        report.truncated = ids.length >= 100;

        // Combien de ces messages sont déjà en base : l'écart entre les deux
        // est exactement ce qui manque à la file.
        const known = await prisma.message.count({
          where: { merchantId, gmailMessageId: { in: ids } },
        });
        report.alreadyIngested = known;
        report.missing = ids.length - known;
      } catch (error) {
        report.tokenValid = false;
        report.error =
          error instanceof Error ? error.message : "Gmail n’a pas répondu";
      }

      return reply.send(report);
    },
  );

  /**
   * Relève la boîte tout de suite, sans passer par la file de travaux.
   *
   * Volontairement synchrone : c'est le seul appel qui court-circuite Redis et
   * le worker. S'il ramène du courrier alors que l'arrivée automatique reste
   * muette, la panne est dans la chaîne Pub/Sub — pas dans l'accès Gmail.
   */
  app.post<{ Params: { id: string } }>(
    "/api/mailboxes/:id/poll",
    { preHandler: requirePermission("configure") },
    async (request, reply) => {
      const { merchantId } = request.session;

      const mailbox = await prisma.gmailConnection.findFirst({
        where: { id: request.params.id, merchantId },
        select: { id: true },
      });
      if (!mailbox) return reply.code(404).send({ error: "Boîte introuvable" });

      const parsed = z
        .object({ days: z.number().int().min(1).max(180).optional() })
        .safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: "Requête invalide" });

      const days = parsed.data.days ?? 7;

      // Au-delà d'une semaine, le travail dépasse le temps d'une requête HTTP :
      // il part en arrière-plan et rend compte par `progress`. En deçà, la
      // réponse immédiate vaut mieux qu'un avancement à interroger.
      if (days > 7) {
        if (backfillProgress.get(mailbox.id)?.done === false) {
          return reply
            .code(409)
            .send({ error: "Un rattrapage est déjà en cours sur cette boîte." });
        }

        void backfillMailbox({ merchantId, mailboxId: mailbox.id, days }).catch(
          (error: unknown) => {
            request.log.error({ err: error }, "Rattrapage en échec");
          },
        );

        return reply.code(202).send({ started: true, days });
      }

      try {
        // Relève manuelle = rattrapage. Suivre le curseur ici répondrait
        // « rien de nouveau » sur une boîte pleine de courrier antérieur au
        // branchement, ce qui est vrai et parfaitement inutile.
        const result = await ingestMerchantInbox(merchantId, mailbox.id, {
          backfillDays: days,
        });
        return reply.send(result);
      } catch (error) {
        request.log.error({ err: error }, "Relève manuelle en échec");
        return reply.code(502).send({
          error: error instanceof Error ? error.message : "Relève impossible",
        });
      }
    },
  );

  /** Avancement d'un rattrapage en cours. */
  app.get<{ Params: { id: string } }>(
    "/api/mailboxes/:id/backfill",
    { preHandler: requirePermission("configure") },
    async (request, reply) => {
      const mailbox = await prisma.gmailConnection.findFirst({
        where: { id: request.params.id, merchantId: request.session.merchantId },
        select: { id: true },
      });
      if (!mailbox) return reply.code(404).send({ error: "Boîte introuvable" });

      return reply.send(backfillProgress.get(mailbox.id) ?? null);
    },
  );

  /**
   * Ce que l'IA a appris : volume du corpus et imports en cours.
   *
   * Compté par boîte, pas globalement. Un total unique répété sous chaque
   * carte laissait croire que toutes avaient appris autant — deux boîtes
   * affichaient « 304 échanges appris » alors qu'une seule avait été
   * analysée. Un chiffre faux à cet endroit fait douter de tout le reste.
   */
  app.get("/api/learning", async (request, reply) => {
    const { merchantId } = request.session;

    const [rows, mailboxes] = await Promise.all([
      prisma.ticket.groupBy({
        by: ["mailboxId"],
        where: { merchantId, isHistorical: true },
        _count: { _all: true },
      }),
      prisma.gmailConnection.findMany({
        where: { merchantId },
        select: { id: true },
      }),
    ]);

    const byMailbox: Record<string, number> = {};
    let imported = 0;

    for (const row of rows) {
      imported += row._count._all;
      if (row.mailboxId) byMailbox[row.mailboxId] = row._count._all;
    }

    return reply.send({
      imported,
      byMailbox,
      running: mailboxes
        .map((mailbox) => mailbox.id)
        .filter((id) => importsRunning.has(id)),
    });
  });

  app.delete<{ Params: { id: string } }>(
    "/api/mailboxes/:id",
    { preHandler: requirePermission("configure") },
    async (request, reply) => {
      const { merchantId, userId } = request.session;

      const mailbox = await prisma.gmailConnection.findFirst({
        where: { id: request.params.id, merchantId },
        select: {
          id: true,
          emailAddress: true,
          isDefault: true,
          refreshTokenEnc: true,
        },
      });
      if (!mailbox) return reply.code(404).send({ error: "Boîte introuvable" });

      /*
       * Couper chez Google avant d'effacer chez nous.
       *
       * Supprimer la ligne en base ne retirait rien du côté Google :
       * l'abonnement continuait de pousser des notifications pour une boîte
       * devenue inconnue, et surtout l'autorisation restait vivante — le jeton
       * permettait encore de lire la boîte que le marchand croyait débranchée.
       * « Débrancher » doit vouloir dire ce qu'il dit.
       *
       * Les deux gestes sont tentés séparément et sans bloquer : si Google
       * refuse, on retire quand même l'accès de l'application. Laisser une
       * boîte branchée parce qu'une révocation a échoué serait le pire des
       * deux mondes.
       */
      try {
        await stopWatch(merchantId, mailbox.id);
      } catch (error) {
        request.log.warn({ err: error }, "Arrêt du watch Gmail en échec");
      }

      try {
        const auth = await createOAuthClient();
        await auth.revokeToken(decryptSecret(mailbox.refreshTokenEnc));
      } catch (error) {
        request.log.warn({ err: error }, "Révocation du jeton Google en échec");
      }

      const remaining = await prisma.gmailConnection.findFirst({
        where: { merchantId, id: { not: mailbox.id } },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });

      // Débrancher la dernière boîte couperait toute entrée de courrier : on
      // laisse faire, mais l'envoi automatique n'a plus de sens sans elle.
      await prisma.$transaction([
        prisma.gmailConnection.delete({ where: { id: mailbox.id } }),
        ...(mailbox.isDefault && remaining
          ? [
              prisma.gmailConnection.update({
                where: { id: remaining.id },
                data: { isDefault: true },
              }),
            ]
          : []),
        ...(remaining
          ? []
          : [
              prisma.merchant.update({
                where: { id: merchantId },
                data: { autoSendEnabled: false },
              }),
            ]),
      ]);

      await recordAudit({
        merchantId,
        actorType: "USER",
        actorId: userId,
        action: "mailbox.disconnected",
        targetType: "GmailConnection",
        targetId: mailbox.id,
        metadata: { emailAddress: mailbox.emailAddress },
        ipAddress: request.ip,
      });

      return reply.send({ ok: true });
    },
  );

  app.patch(
    "/api/settings",
    { preHandler: requirePermission("configure") },
    async (request, reply) => {
      const parsed = patchBody.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Requête invalide", details: parsed.error.issues });
      }

      const { merchantId, userId } = request.session;

      // L'envoi automatique fait partir des mails sans relecture : on refuse de
      // l'activer tant que Gmail n'est pas connecté, sinon le réglage promet un
      // comportement que rien ne peut exécuter.
      if (parsed.data.autoSendEnabled === true) {
        const gmail = await prisma.gmailConnection.findFirst({
          where: { merchantId },
          select: { id: true },
        });
        if (!gmail && !env.GMAIL_MOCK) {
          return reply.code(409).send({
            error:
              "Connectez une boîte Gmail avant d’activer l’envoi automatique.",
          });
        }
      }

      const { logo, ...fields } = parsed.data;

      const logoFields =
        logo === undefined
          ? {}
          : logo === null
            ? { logoData: null, logoMime: null }
            : (() => {
                const decoded = decodePhoto(logo);
                return { logoData: decoded.data, logoMime: decoded.mime };
              })();

      const merchant = await prisma.merchant.update({
        where: { id: merchantId },
        data: { ...fields, ...logoFields },
      });

      await recordAudit({
        merchantId,
        actorType: "USER",
        actorId: userId,
        action: "merchant.settings_updated",
        targetType: "Merchant",
        targetId: merchantId,
        // On consigne les champs touchés, pas seulement le fait qu'il y a eu une
        // modification : activer l'envoi automatique doit être traçable.
        metadata: parsed.data,
        ipAddress: request.ip,
      });

      return reply.send({
        merchant: {
          name: merchant.name,
          brandName: merchant.brandName,
          logoUrl: merchant.logoUrl,
          hasLogo: Boolean(merchant.logoMime),
          logoUpdatedAt: merchant.updatedAt,
          trackingUrlTemplate: merchant.trackingUrlTemplate,
        playbook: merchant.playbook,
        slaHours: merchant.slaHours,
          shopDomain: merchant.shopDomain,
          status: merchant.status,
          autoSendEnabled: merchant.autoSendEnabled,
          autoSendThreshold: merchant.autoSendThreshold,
          retentionDays: merchant.retentionDays,
        },
      });
    },
  );
}
