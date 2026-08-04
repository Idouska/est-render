import type { OrderSummary } from '../shopify/orders.ts';

/**
 * Export du carnet de commandes au format CSV.
 *
 * Destiné à être ouvert dans Excel : c'est ce que fait l'atelier tous les
 * matins pour préparer les envois de la veille. D'où trois choix qui ne vont
 * pas de soi ailleurs :
 *
 * — le séparateur est le point-virgule, parce qu'Excel en configuration
 *   française lit la virgule comme un séparateur décimal et empile toute la
 *   ligne dans une seule colonne ;
 * — le fichier commence par un BOM UTF-8, sans lequel Excel affiche « Ã© » à
 *   la place de « é » ;
 * — une cellule commençant par `=`, `+`, `-` ou `@` est préfixée d'une
 *   apostrophe : Excel l'interpréterait comme une formule, ce qui est un
 *   vecteur d'injection connu dès lors que la donnée vient d'un client.
 */

const SEPARATOR = ';';

export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;

  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(SEPARATOR)];
  for (const row of rows) lines.push(row.map(csvCell).join(SEPARATOR));

  // BOM en tête, fins de ligne Windows : c'est ce qu'attend Excel.
  return `﻿${lines.join('\r\n')}\r\n`;
}

export interface ParcelExport {
  index: number;
  total: number;
  trackingNumber: string;
  photoUrl: string | null;
}

export interface OrderExportRow {
  order: OrderSummary;
  parcels?: ParcelExport[];
}

const HEADERS = [
  'Numéro de commande',
  'Date',
  'Client',
  'Email',
  'Téléphone',
  'Adresse',
  'Code postal',
  'Ville',
  'Pays',
  'Articles',
  'Références',
  'Quantité totale',
  'Photo produit',
  'Montant',
  'Devise',
  'Paiement',
  'Préparation',
  'Colis saisis',
  'Numéros de suivi',
  'Photos des colis',
];

export function ordersToCsv(rows: OrderExportRow[], baseUrl: string): string {
  return toCsv(
    HEADERS,
    rows.map(({ order, parcels = [] }) => {
      const address = order.shippingAddress;
      const items = order.lineItems ?? [];

      return [
        order.name,
        new Date(order.createdAt).toLocaleString('fr-FR'),
        order.customer?.displayName ?? address?.name ?? '',
        order.customer?.email ?? '',
        // Le téléphone de l'adresse de livraison, pas celui du compte : c'est
        // celui que le transporteur appellera devant la porte.
        address?.phone ?? '',
        [address?.address1, address?.address2].filter(Boolean).join(' '),
        address?.zip ?? '',
        address?.city ?? '',
        address?.country ?? '',
        items
          .map(
            (item) =>
              `${item.quantity} × ${item.title}${item.variantTitle ? ` (${item.variantTitle})` : ''}`,
          )
          .join(' | '),
        items.map((item) => item.sku).filter(Boolean).join(' | '),
        items.reduce((sum, item) => sum + item.quantity, 0),
        items.map((item) => item.image).filter(Boolean).join(' | '),
        order.totalPrice ?? '',
        order.currency ?? '',
        order.displayFinancialStatus ?? '',
        order.displayFulfillmentStatus ?? '',
        parcels.length ? `${parcels.length}/${parcels[0]?.total ?? parcels.length}` : '',
        parcels
          .map((parcel) => `${parcel.index}/${parcel.total} ${parcel.trackingNumber}`)
          .join(' | '),
        // Liens absolus : le fichier est ouvert hors de l'application, un
        // chemin relatif n'y mènerait nulle part.
        parcels
          .map((parcel) => (parcel.photoUrl ? `${baseUrl}${parcel.photoUrl}` : ''))
          .filter(Boolean)
          .join(' | '),
      ];
    }),
  );
}
