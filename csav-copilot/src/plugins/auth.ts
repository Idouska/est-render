import type { UserRole } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.ts';
import { SESSION_COOKIE, verifySession, type SessionPayload } from '../lib/session.ts';

declare module 'fastify' {
  interface FastifyRequest {
    session: SessionPayload & {
      /** Rôle appliqué à cette requête — celui simulé, s'il est plus étroit. */
      role: UserRole;
      /** Rôle réel du compte, indépendant de toute simulation. */
      realRole: UserRole;
      email: string;
    };
  }
}

/**
 * Droits par rôle.
 *
 * Nommés par ce qu'ils permettent de casser, pas par l'organigramme : envoyer
 * un mail au nom du marchand, rendre de l'argent, changer la configuration. Un
 * agent qui répond toute la journée n'a aucune raison de pouvoir rembourser, et
 * quelqu'un en observation ne doit rien pouvoir envoyer.
 *
 * La table est explicite plutôt que hiérarchique : « OWNER > SUPERVISOR >
 * AGENT » se lit bien jusqu'au jour où un droit doit sauter un niveau, et
 * l'inclusion implicite rend alors les exceptions invisibles.
 */
export const PERMISSIONS = {
  /** Lire tickets, commandes, clients, journal. */
  read: ['OWNER', 'SUPERVISOR', 'AGENT', 'VIEWER'],
  /** Modifier un brouillon, envoyer une réponse, rattacher une commande. */
  reply: ['OWNER', 'SUPERVISOR', 'AGENT'],
  /** Créer et envoyer une escalade fournisseur. */
  escalate: ['OWNER', 'SUPERVISOR', 'AGENT'],
  /** Rembourser — irréversible, argent réel. */
  refund: ['OWNER', 'SUPERVISOR'],
  /** Réglages de la boutique, contacts fournisseurs. */
  configure: ['OWNER', 'SUPERVISOR'],
  /** Gérer l'équipe : inviter, changer un rôle, désactiver. */
  manageTeam: ['OWNER'],
} as const satisfies Record<string, readonly UserRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: UserRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly UserRole[]).includes(role);
}

/** Nom du cookie portant le rôle simulé. */
export const PREVIEW_COOKIE = 'csav_preview_role';

/**
 * Classement des rôles, du plus large au plus étroit.
 *
 * Sert uniquement à interdire qu'une simulation élargisse les droits. La table
 * PERMISSIONS reste la référence pour savoir qui peut quoi : ce rang ne dit pas
 * les droits, il dit seulement lequel est contenu dans l'autre.
 */
const RANK: Record<UserRole, number> = {
  OWNER: 3,
  SUPERVISOR: 2,
  AGENT: 1,
  VIEWER: 0,
};

/**
 * Rôle effectif d'une requête.
 *
 * Un propriétaire doit pouvoir constater ce que voit un agent : décrire les
 * droits dans une page d'aide ne remplace jamais l'écran lui-même, et une
 * simulation seulement graphique mentirait — le serveur continuerait
 * d'autoriser ce que l'écran prétend interdire.
 *
 * D'où la règle unique : la simulation ne peut que **restreindre**. Un cookie
 * falsifié en `OWNER` par un agent ne lui donne rien, puisque le rang retenu
 * est toujours le plus étroit des deux. C'est ce qui permet de ne pas signer ce
 * cookie sans créer de faille.
 */
export function effectiveRole(real: UserRole, previewed: string | undefined): UserRole {
  if (!previewed || !(previewed in RANK)) return real;
  const candidate = previewed as UserRole;
  return RANK[candidate] < RANK[real] ? candidate : real;
}

/**
 * Garde-fou d'isolation multi-tenant : toute route du dashboard passe par ici,
 * et le `merchantId` de toute requête vient d'ici — jamais du corps ou de l'URL.
 *
 * L'utilisateur est relu en base à chaque requête plutôt que porté par le
 * cookie : désactiver un compte ou lui retirer un droit prend effet tout de
 * suite, sans attendre l'expiration d'une session signée.
 */
export async function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const session = verifySession(request.cookies[SESSION_COOKIE]);

  if (!session) {
    await reply.code(401).send({ error: 'Session absente ou expirée' });
    return;
  }

  const user = await prisma.user.findFirst({
    where: { id: session.userId, merchantId: session.merchantId },
    select: { role: true, email: true, active: true },
  });

  if (!user || !user.active) {
    await reply.code(401).send({ error: 'Compte désactivé ou introuvable' });
    return;
  }

  const role = effectiveRole(user.role, request.cookies[PREVIEW_COOKIE]);

  request.session = { ...session, role, email: user.email, realRole: user.role };
}

const DENIALS: Record<Permission, string> = {
  read: 'Vous n’avez pas accès à ces données.',
  reply: 'Votre rôle ne permet pas d’envoyer de réponse — vous êtes en lecture seule.',
  escalate: 'Votre rôle ne permet pas d’escalader un ticket.',
  refund: 'Seuls le propriétaire et les superviseurs peuvent rembourser.',
  configure: 'Seuls le propriétaire et les superviseurs peuvent modifier la configuration.',
  manageTeam: 'Seul le propriétaire peut gérer l’équipe.',
};

/**
 * `preHandler` de route. À poser après `requireSession`, qui renseigne le rôle.
 *
 * Le message de refus dit quel rôle est requis : un « accès refusé » nu laisse
 * croire à une panne et envoie l'utilisateur ouvrir un ticket au support.
 */
export function requirePermission(permission: Permission) {
  return async function check(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!can(request.session.role, permission)) {
      await reply.code(403).send({ error: DENIALS[permission] });
    }
  };
}
