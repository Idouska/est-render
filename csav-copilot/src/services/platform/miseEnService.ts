import { env } from '../../config/env.ts';
import { prisma } from '../../lib/prisma.ts';
import { getCredentials } from './credentials.ts';

/*
 * Prêt à passer en réel ?
 *
 * Couper le mode test, c'est laisser partir les réponses, les remboursements
 * et les mails aux ateliers. Avant, six choses doivent tenir : Shopify relié
 * et accepté, la boîte mail écoutée, une signature au bas des réponses, les
 * règles de la boutique (l'IA n'affirme rien qui n'y figure pas), quelques
 * réponses types, et des pages légales complètes. Chaque point se calcule sur
 * l'état réel, avec le geste qui le règle quand il manque.
 */

/** Où mène le geste : un volet des Réglages, un écran, ou une adresse. */
export type Vers =
  | { volet: 'connexions' | 'boutique' | 'assistant' }
  | { vue: 'canned' }
  | { lien: string };

export interface Etape {
  cle: 'shopify' | 'gmail' | 'signature' | 'regles' | 'reponses' | 'legal';
  titre: string;
  ok: boolean;
  detail: string;
  geste: { libelle: string; vers: Vers } | null;
}

const DEPENDANCES = { prisma, getCredentials, maintenant: () => new Date() };
export type DependancesMiseEnService = typeof DEPENDANCES;

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

/**
 * Une autorisation accordée en couvre-t-elle une autre ?
 *
 * Shopify n'énumère pas `read_orders` quand `write_orders` est accordé — la
 * lecture est incluse. Sans cette règle, l'écran réclame en permanence une
 * autorisation déjà obtenue, et le marchand réinstalle son application pour
 * rien.
 */
export function couvre(accordees: string[], demandee: string): boolean {
  if (accordees.includes(demandee)) return true;
  const ecriture = demandee.startsWith('read_') ? `write_${demandee.slice(5)}` : null;
  return ecriture !== null && accordees.includes(ecriture);
}

export async function etapesMiseEnService(
  merchantId: string,
  deps: DependancesMiseEnService = DEPENDANCES,
): Promise<{ demo: boolean; testMode: boolean; etapes: Etape[] }> {
  const [marchand, reponses, cles] = await Promise.all([
    deps.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: {
        demo: true,
        testMode: true,
        shopDomain: true,
        emailSignature: true,
        playbook: true,
        shopify: { select: { uninstalledAt: true, scopes: true, accesRefuseLe: true } },
        mailboxes: { select: { emailAddress: true, watchExpiration: true, panneLe: true } },
      },
    }),
    deps.prisma.cannedReply.count({ where: { merchantId } }),
    deps.getCredentials(),
  ]);

  if (!marchand) return { demo: false, testMode: false, etapes: [] };
  // La démonstration n'a rien à brancher : tout y est simulé.
  if (marchand.demo) return { demo: true, testMode: true, etapes: [] };

  const maintenant = deps.maintenant();
  const etapes: Etape[] = [];

  // 1. Shopify : relié, accepté, avec toutes ses autorisations.
  const shopify = marchand.shopify;
  const accordees = shopify?.scopes?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  const manquantes = env.SHOPIFY_SCOPES.filter((scope) => !couvre(accordees, scope));
  const relie = Boolean(shopify && !shopify.uninstalledAt);
  const reautoriser = { libelle: 'Réautoriser', vers: { lien: `/auth/shopify?shop=${encodeURIComponent(marchand.shopDomain)}` } };
  if (env.SHOPIFY_MOCK) {
    etapes.push({ cle: 'shopify', titre: 'Shopify', ok: true, detail: 'Simulé sur ce serveur.', geste: null });
  } else if (!relie) {
    etapes.push({ cle: 'shopify', titre: 'Shopify', ok: false, detail: 'La boutique n’est pas reliée.', geste: { ...reautoriser, libelle: 'Connecter' } });
  } else if (shopify?.accesRefuseLe) {
    etapes.push({ cle: 'shopify', titre: 'Shopify', ok: false, detail: 'Shopify refuse l’accès de l’outil.', geste: reautoriser });
  } else if (manquantes.length > 0) {
    etapes.push({ cle: 'shopify', titre: 'Shopify', ok: false, detail: `Autorisations manquantes : ${manquantes.join(', ')}.`, geste: reautoriser });
  } else {
    etapes.push({ cle: 'shopify', titre: 'Shopify', ok: true, detail: `${marchand.shopDomain} relié, accès accepté.`, geste: null });
  }

  // 2. La boîte mail : au moins une, toutes écoutées, aucune refusée par Google.
  const boites = marchand.mailboxes;
  const enPanne = boites.filter((boite) => boite.panneLe);
  const sourdes = boites.filter((boite) => !boite.watchExpiration || boite.watchExpiration <= maintenant);
  const connexions = { libelle: 'Ouvrir les connexions', vers: { volet: 'connexions' as const } };
  if (env.GMAIL_MOCK) {
    etapes.push({ cle: 'gmail', titre: 'Boîte mail', ok: true, detail: 'Simulée sur ce serveur.', geste: null });
  } else if (boites.length === 0) {
    etapes.push({ cle: 'gmail', titre: 'Boîte mail', ok: false, detail: 'Aucune boîte connectée : aucun message n’entre.', geste: connexions });
  } else if (enPanne.length > 0) {
    etapes.push({ cle: 'gmail', titre: 'Boîte mail', ok: false, detail: `Google refuse l’accès à ${enPanne.map((b) => b.emailAddress).join(', ')}.`, geste: connexions });
  } else if (sourdes.length > 0) {
    etapes.push({ cle: 'gmail', titre: 'Boîte mail', ok: false, detail: `Écoute expirée sur ${sourdes.map((b) => b.emailAddress).join(', ')} : les messages arrivent en retard.`, geste: connexions });
  } else {
    etapes.push({ cle: 'gmail', titre: 'Boîte mail', ok: true, detail: `${boites.map((b) => b.emailAddress).join(', ')} : écoute active.`, geste: null });
  }

  // 3. La signature au bas des réponses.
  const signature = marchand.emailSignature?.trim() ?? '';
  etapes.push(
    signature
      ? { cle: 'signature', titre: 'Signature', ok: true, detail: 'Ajoutée au bas de chaque réponse.', geste: null }
      : { cle: 'signature', titre: 'Signature', ok: false, detail: 'Les réponses partiraient sans signature.', geste: { libelle: 'Écrire la signature', vers: { volet: 'boutique' } } },
  );

  // 4. Les règles de la boutique : l'IA n'affirme rien qui n'y figure pas.
  const regles = marchand.playbook?.trim() ?? '';
  etapes.push(
    regles
      ? { cle: 'regles', titre: 'Règles de la boutique', ok: true, detail: `${pluriel(regles.split('\n').filter((l) => l.trim()).length, 'ligne')} que l’IA respecte.`, geste: null }
      : { cle: 'regles', titre: 'Règles de la boutique', ok: false, detail: 'Vides : l’IA ne peut rien affirmer sur la livraison ni les retours.', geste: { libelle: 'Reprendre les politiques de Shopify', vers: { volet: 'assistant' } } },
  );

  // 5. Des réponses types, pour les cas qui reviennent.
  etapes.push(
    reponses > 0
      ? { cle: 'reponses', titre: 'Réponses types', ok: true, detail: `${pluriel(reponses, 'réponse')} prête${reponses > 1 ? 's' : ''}.`, geste: null }
      : { cle: 'reponses', titre: 'Réponses types', ok: false, detail: 'Aucune : chaque réponse s’écrit de zéro.', geste: { libelle: 'Ouvrir les réponses types', vers: { vue: 'canned' } } },
  );

  // 6. Les pages légales : société, adresse et contact, réglés dans /admin.
  const manquant = [
    !cles.LEGAL_COMPANY?.trim() && 'société',
    !cles.LEGAL_ADDRESS?.trim() && 'adresse',
    !cles.LEGAL_EMAIL?.trim() && 'e-mail de contact',
  ].filter(Boolean);
  etapes.push(
    manquant.length === 0
      ? { cle: 'legal', titre: 'Mentions légales', ok: true, detail: 'Confidentialité et conditions d’utilisation complètes.', geste: null }
      : { cle: 'legal', titre: 'Mentions légales', ok: false, detail: `À compléter : ${manquant.join(', ')}.`, geste: { libelle: 'Ouvrir l’administration', vers: { lien: '/admin' } } },
  );

  return { demo: false, testMode: marchand.testMode, etapes };
}
