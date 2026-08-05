import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config/env.ts";
import { recordAudit } from "../lib/audit.ts";
import { prisma } from "../lib/prisma.ts";
import { requirePermission, requireSession } from "../plugins/auth.ts";
import { importMailboxHistory } from "../services/gmail/importHistory.ts";
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

  /** Ce que l'IA a appris : volume du corpus et imports en cours. */
  app.get("/api/learning", async (request, reply) => {
    const { merchantId } = request.session;

    const [imported, mailboxes] = await Promise.all([
      prisma.ticket.count({ where: { merchantId, isHistorical: true } }),
      prisma.gmailConnection.findMany({
        where: { merchantId },
        select: { id: true },
      }),
    ]);

    return reply.send({
      imported,
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
        select: { id: true, emailAddress: true, isDefault: true },
      });
      if (!mailbox) return reply.code(404).send({ error: "Boîte introuvable" });

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
