import { getShopifyClient } from './client.ts';

/**
 * Politiques publiques de la boutique, telles qu'elles sont écrites sur le
 * site.
 *
 * C'est la source la plus fiable pour le playbook : ce que l'IA affirme à un
 * client doit être exactement ce que le client peut lire sur la boutique.
 * Recopier ces textes à la main, c'est garantir qu'ils divergeront le jour où
 * la politique de retour changera.
 */

/*
 * Une liste, plus un champ par politique.
 *
 * `refundPolicy`, `shippingPolicy`, `termsOfService`… ont été retirés de
 * l'API : la requête échouait en entier, et l'import des politiques avec elle.
 * Elles se lisent désormais dans `shopPolicies`, chacune avec son type.
 */
const QUERY = `
  query ShopPolicies {
    shop {
      name
      contactEmail
      shipsToCountries
      shopPolicies {
        type
        title
        body
      }
    }
  }
`;

interface PolicyNode {
  type: string;
  title: string | null;
  body: string | null;
}

interface PoliciesResponse {
  shop: {
    name: string | null;
    contactEmail: string | null;
    shipsToCountries: string[] | null;
    shopPolicies: PolicyNode[] | null;
  } | null;
}

/** Le corps arrive en HTML : le prompt veut du texte. */
function toPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface ShopPolicies {
  shopName: string | null;
  contactEmail: string | null;
  shipsToCountries: string[];
  sections: Array<{ title: string; body: string }>;
}

export async function fetchShopPolicies(merchantId: string): Promise<ShopPolicies> {
  const client = await getShopifyClient(merchantId);
  const data = await client.request<PoliciesResponse>(QUERY);
  const shop = data.shop;
  const politique = (type: string) => shop?.shopPolicies?.find((node) => node.type === type);

  const raw: Array<[string, PolicyNode | null | undefined]> = [
    ['Livraison', politique('SHIPPING_POLICY')],
    ['Retours et remboursements', politique('REFUND_POLICY')],
    // Les conditions de vente : celles de la boutique en a, sinon les
    // conditions d'utilisation, qui les contiennent souvent.
    ['Conditions générales de vente', politique('TERMS_OF_SALE') ?? politique('TERMS_OF_SERVICE')],
    ['Abonnements', politique('SUBSCRIPTION_POLICY')],
    // La politique de confidentialité et les mentions légales sont
    // délibérément écartées : elles parlent au régulateur, pas au client qui
    // demande où est son colis, et occuperaient le tiers du prompt sans rien
    // lui apprendre.
  ];

  const sections = raw
    .map(([fallbackTitle, node]) => {
      const body = node?.body ? toPlainText(node.body) : '';
      return { title: node?.title?.trim() || fallbackTitle, body };
    })
    .filter((section) => section.body.length > 0);

  return {
    shopName: shop?.name ?? null,
    contactEmail: shop?.contactEmail ?? null,
    shipsToCountries: shop?.shipsToCountries ?? [],
    sections,
  };
}

/**
 * Met les politiques en forme de playbook.
 *
 * Tronqué par section : une CGV entière ferait exploser le prompt à chaque
 * ticket pour un gain nul — les règles utiles au SAV tiennent dans les
 * premiers paragraphes, le reste est du juridique.
 */
export function policiesToPlaybook(policies: ShopPolicies, limit = 6000): string {
  const blocks = policies.sections.map(
    (section) => `## ${section.title}\n${section.body.slice(0, 1800)}`,
  );

  if (policies.shipsToCountries.length > 0 && !policies.shipsToCountries.includes('*')) {
    blocks.unshift(`## Pays livrés\n${policies.shipsToCountries.join(', ')}`);
  }

  return blocks.join('\n\n').slice(0, limit).trim();
}
