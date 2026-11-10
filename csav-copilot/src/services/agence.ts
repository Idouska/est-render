import { prisma } from '../lib/prisma.ts';

/**
 * Les comptes de l'agence : un Propriétaire automatique sur chaque boutique.
 *
 * L'agence (Rachid et quiconque il ajoute à la liste) n'a pas besoin d'être
 * invitée boutique par boutique. Dès qu'une boutique se branche — ou dès
 * qu'un admin clique « Appliquer aux boutiques existantes » — chaque email de
 * la liste reçoit un compte Propriétaire actif dessus, sans rien demander au
 * marchand.
 *
 * Toutes les boutiques rejoignent la MÊME Organization, réservée à l'agence :
 * c'est ce qui réunit « Toutes les boutiques » dans son sélecteur. Ça ne fuit
 * rien côté marchand — être dans le même groupe ne donne accès à personne
 * d'autre, seul un compte `User` explicite par boutique le fait
 * (`routes/shops.ts`, `listShopsFor`). Un marchand qui ajoute lui-même une
 * seconde boutique au même groupe ne voit toujours que ce qu'il a le droit de
 * voir : les siennes, pas celles d'un autre client.
 */

/** Identifiant fixe, pour que toute boutique retombe sur le même groupe sans jamais le chercher. */
export const AGENCE_ORGANIZATION_ID = 'agence-organisation';

/** Pose l'Organization de l'agence si elle n'existe pas encore. Idempotent. */
export async function assurerOrganisationAgence(): Promise<string> {
  await prisma.organization.upsert({
    where: { id: AGENCE_ORGANIZATION_ID },
    create: { id: AGENCE_ORGANIZATION_ID, name: 'Agence' },
    update: {},
  });
  return AGENCE_ORGANIZATION_ID;
}

/**
 * Pose (ou remet d'aplomb) un compte Propriétaire pour chaque email de
 * l'agence, sur cette boutique. Toujours Propriétaire, toujours actif : si un
 * marchand avait par hasard déjà invité cette adresse à un rôle plus faible,
 * ce geste la remet au niveau que l'agence attend — c'est tout l'intérêt
 * d'appuyer sur le bouton.
 */
export async function provisionnerComptesAgence(merchantId: string): Promise<void> {
  const comptes = await prisma.agenceAdmin.findMany({ select: { email: true } });
  for (const { email } of comptes) {
    await prisma.user.upsert({
      where: { merchantId_email: { merchantId, email } },
      create: { merchantId, email, role: 'OWNER', active: true, agence: true },
      update: { role: 'OWNER', active: true, agence: true },
    });
  }
}

/**
 * Rattache une boutique déjà existante au groupe de l'agence et lui pose les
 * comptes — le geste de « Appliquer aux boutiques existantes », pour une
 * boutique qui tournait déjà avant que l'agence n'existe.
 */
export async function rattacherBoutiqueAgence(merchantId: string): Promise<void> {
  const organizationId = await assurerOrganisationAgence();
  await prisma.merchant.update({ where: { id: merchantId }, data: { organizationId } });
  await provisionnerComptesAgence(merchantId);
}
