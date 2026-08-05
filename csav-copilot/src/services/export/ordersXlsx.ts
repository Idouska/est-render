import ExcelJS from 'exceljs';
import { logger } from '../../lib/logger.ts';
import type { OrderSummary } from '../shopify/orders.ts';

/**
 * Feuille de préparation des commandes, au format Excel.
 *
 * Reprend la mise en page que l'atelier utilise déjà : **une ligne par
 * article**, pas par commande — une commande de deux pointures se prépare comme
 * deux gestes distincts, et la fusionner en une ligne oblige à relire la
 * cellule pour savoir quoi mettre dans le carton.
 *
 * L'image du produit est incorporée dans la cellule, pas mise en lien : la
 * personne qui emballe reconnaît une chaussure à sa photo bien plus vite qu'à
 * sa référence, et un classeur ouvert hors connexion n'afficherait rien.
 */

export interface XlsxRowSource {
  order: OrderSummary;
  storeUrl: string;
  trackingNumbers?: string[];
}

/** Vignette Shopify redimensionnée : l'originale pèse souvent 1 Mo. */
function thumbnailUrl(raw: string | null): string | null {
  if (!raw) return null;

  try {
    const url = new URL(raw);
    url.searchParams.set('width', '160');
    return url.toString();
  } catch {
    return raw;
  }
}

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    logger.warn({ url, err: error }, 'Vignette produit inaccessible');
    return null;
  }
}

/** Adresse du client sur plusieurs lignes, telle qu'elle sert à l'expédition. */
function customerBlock(order: OrderSummary): string {
  const address = order.shippingAddress;

  return [
    order.customer?.displayName ?? address?.name ?? '',
    [address?.address1, address?.address2].filter(Boolean).join(' '),
    [address?.zip, address?.city, address?.province, address?.country]
      .filter(Boolean)
      .join(', '),
    address?.phone ?? '',
    order.customer?.email ?? '',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function ordersToXlsx(rows: XlsxRowSource[]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = 'cSAV Copilot';
  book.created = new Date();

  const sheet = book.addWorksheet('Commandes', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = [
    { header: 'Order', key: 'order', width: 12 },
    { header: 'Items', key: 'items', width: 20 },
    { header: 'Quantity', key: 'quantity', width: 10 },
    { header: 'Size', key: 'size', width: 24 },
    { header: 'Customer', key: 'customer', width: 44 },
    { header: 'Note', key: 'note', width: 22 },
    { header: 'Product Link', key: 'link', width: 16 },
    { header: 'Tracking', key: 'tracking', width: 24 },
  ];

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.alignment = { horizontal: 'center', vertical: 'middle' };
  header.height = 20;
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
  });

  // Une même image revient sur plusieurs lignes d'une commande : on ne la
  // télécharge et ne l'incorpore qu'une fois par URL.
  const images = new Map<string, number>();

  for (const { order, storeUrl, trackingNumbers = [] } of rows) {
    for (const item of order.lineItems ?? []) {
      const row = sheet.addRow({
        order: order.name,
        items: '',
        quantity: item.quantity,
        size: item.variantTitle ? `Size : ${item.variantTitle}` : '',
        customer: customerBlock(order),
        note: '',
        link: '',
        tracking: trackingNumbers.join('\n'),
      });

      // Cinq lignes de client tiennent dans 90 points ; en dessous, l'adresse
      // se coupe et l'atelier expédie à une adresse incomplète.
      row.height = 90;
      row.alignment = { vertical: 'top', wrapText: true };
      row.getCell('quantity').alignment = { vertical: 'top', horizontal: 'right' };

      if (item.image) {
        const url = thumbnailUrl(item.image)!;

        if (!images.has(url)) {
          const data = await fetchImage(url);
          if (data) {
            // `addImage` attend un `Buffer<ArrayBuffer>` : la recopie garantit
            // un tampon simple, un Buffer pouvant reposer sur un tampon partagé.
            images.set(
              url,
              book.addImage({ buffer: Uint8Array.from(data).buffer, extension: 'png' }),
            );
          }
        }

        const imageId = images.get(url);
        if (imageId !== undefined) {
          sheet.addImage(imageId, {
            tl: { col: 1.1, row: row.number - 0.9 },
            ext: { width: 105, height: 105 },
          });
        }
      }

      if (storeUrl) {
        const cell = row.getCell('link');
        cell.value = {
          text: 'View Product',
          hyperlink: `${storeUrl}/admin/orders`,
        };
        cell.font = { color: { argb: 'FF1155CC' }, underline: true };
      }

      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
          left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
          bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
          right: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        };
      });
    }
  }

  return Buffer.from(await book.xlsx.writeBuffer());
}
