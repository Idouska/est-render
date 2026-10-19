import type { ShopifyClient } from './client.ts';

/*
 * La différence de prix d'un échange, payée par le client.
 *
 * Un échange contre un modèle plus cher : le client doit l'écart. Shopify le
 * fait sans carte saisie chez nous — une commande provisoire (draft order)
 * d'une seule ligne, « Différence de prix », dont Shopify envoie lui-même la
 * facture par mail avec son lien de paiement. Payée, la commande provisoire
 * passe en COMPLETED : c'est ce qui libère l'envoi de la nouvelle paire.
 *
 * Demande l'autorisation `write_draft_orders`. Sans elle, Shopify refuse et
 * le dossier garde « Lien non envoyé », avec la raison.
 */

/** Une commande provisoire simulée en mode test : jamais relue chez Shopify. */
export const brouillonSimule = (id: string | null | undefined) => Boolean(id?.startsWith('gid://csav/ModeTest'));

export async function creerLienDifference(
  client: ShopifyClient,
  params: { email: string; montant: number; devise: string | null; orderName: string | null; modele: string },
): Promise<{ id: string; invoiceUrl: string | null }> {
  const titre = `Différence de prix — échange${params.orderName ? ` ${params.orderName}` : ''}`;
  const cree = await client.request<{
    draftOrderCreate: { draftOrder: { id: string; invoiceUrl: string | null } | null; userErrors: Array<{ message: string }> };
  }>(
    /* GraphQL */ `
      mutation CreerLienDifference($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder {
            id
            invoiceUrl
          }
          userErrors {
            message
          }
        }
      }
    `,
    {
      input: {
        email: params.email,
        note: `Échange contre ${params.modele}`,
        tags: ['csav-echange', 'difference-de-prix'],
        ...(params.devise ? { presentmentCurrencyCode: params.devise } : {}),
        lineItems: [
          {
            title: titre,
            quantity: 1,
            originalUnitPrice: params.montant.toFixed(2),
            requiresShipping: false,
            taxable: false,
          },
        ],
      },
    },
  );
  const erreur = cree.draftOrderCreate.userErrors[0]?.message;
  if (erreur || !cree.draftOrderCreate.draftOrder) throw new Error(erreur ?? 'Shopify n’a pas créé le lien de paiement.');
  const brouillon = cree.draftOrderCreate.draftOrder;

  // Shopify envoie la facture lui-même : le lien part de la boutique, pas de nous.
  const envoi = await client.request<{ draftOrderInvoiceSend: { userErrors: Array<{ message: string }> } }>(
    /* GraphQL */ `
      mutation EnvoyerLienDifference($id: ID!, $email: EmailInput) {
        draftOrderInvoiceSend(id: $id, email: $email) {
          draftOrder {
            id
          }
          userErrors {
            message
          }
        }
      }
    `,
    {
      id: brouillon.id,
      email: {
        to: params.email,
        subject: titre,
        customMessage: `Votre échange contre ${params.modele} : il reste ${params.montant.toFixed(2).replace('.', ',')} à régler. La nouvelle paire part dès le paiement.`,
      },
    },
  );
  const erreurEnvoi = envoi.draftOrderInvoiceSend.userErrors[0]?.message;
  if (erreurEnvoi) throw new Error(erreurEnvoi);
  return brouillon;
}

/** Payée ? La commande provisoire passe en COMPLETED quand le client a réglé. */
export async function lienPaye(client: ShopifyClient, id: string): Promise<boolean> {
  const data = await client.request<{ draftOrder: { status: string } | null }>(
    /* GraphQL */ `
      query StatutLienDifference($id: ID!) {
        draftOrder(id: $id) {
          status
        }
      }
    `,
    { id },
  );
  return data.draftOrder?.status === 'COMPLETED';
}

/** Le prix d'une déclinaison, relu chez Shopify : on ne facture pas un prix venu de l'écran. */
export async function prixDeclinaison(client: ShopifyClient, id: string): Promise<number | null> {
  const data = await client.request<{ productVariant: { price: string | null } | null }>(
    /* GraphQL */ `
      query PrixDeclinaison($id: ID!) {
        productVariant(id: $id) {
          price
        }
      }
    `,
    { id },
  );
  const prix = Number(data.productVariant?.price);
  return Number.isFinite(prix) && data.productVariant?.price ? prix : null;
}
