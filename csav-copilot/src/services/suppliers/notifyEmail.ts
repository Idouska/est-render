/**
 * Le mail que reçoit un fournisseur, et l'idée qu'il se fait de la boutique.
 *
 * Le précédent portait en objet un identifiant technique de vingt-cinq
 * caractères — « commande cmsj3nfsu000liz01f92sk2c7 » — et pour tout corps
 * trois lignes suivies d'une URL de trois cents caractères, nue. Aucun nom de
 * boutique, aucune commande lisible, aucune signature. Les filtres le
 * classaient en indésirables, et l'atelier qui le trouvait quand même n'y
 * apprenait rien qu'il n'ait déjà.
 *
 * Ce qu'un mail professionnel doit faire ici : dire de qui il vient, sur quelle
 * commande, ce qu'on attend, et offrir un bouton — pas un pavé de jeton.
 */

const REASON_LABELS: Record<string, string> = {
  OUT_OF_STOCK: 'rupture de stock',
  INCORRECT_ADDRESS: 'adresse incorrecte ou incomplète',
  MISSING_ITEM: 'article manquant',
  DAMAGED: 'article abîmé',
  LATE: 'retard de livraison',
  OTHER: 'demande particulière',
};

export interface EscalationMailContext {
  merchantName: string;
  supplierName: string;
  orderName: string | null;
  reason: string;
  portalUrl: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * L'objet du mail.
 *
 * Le numéro de commande quand on l'a — c'est ce que l'atelier cherche dans sa
 * boîte trois jours plus tard. Jamais d'identifiant interne : il ne veut rien
 * dire pour le destinataire, et un objet incompréhensible est le premier
 * critère de mise en indésirables.
 */
export function escalationSubject(context: EscalationMailContext): string {
  const about = context.orderName ? `commande ${context.orderName}` : 'une commande';
  return `${context.merchantName} — ${about} : ${REASON_LABELS[context.reason] ?? 'demande'}`;
}

/** Version texte. Elle doit se suffire : certains clients n'affichent qu'elle. */
export function escalationText(context: EscalationMailContext): string {
  return [
    `Bonjour ${context.supplierName},`,
    '',
    context.orderName
      ? `Nous avons une demande à vous soumettre sur la commande ${context.orderName}.`
      : 'Nous avons une demande à vous soumettre sur une commande.',
    `Motif : ${REASON_LABELS[context.reason] ?? 'demande particulière'}.`,
    '',
    'Le détail et le formulaire de réponse sont ici :',
    context.portalUrl,
    '',
    'Ce lien vous est réservé : il ouvre directement la demande, sans mot de',
    'passe. Merci de ne pas le transférer.',
    '',
    `— ${context.merchantName}`,
  ].join('\n');
}

/**
 * Version HTML.
 *
 * Volontairement sobre et en styles en ligne : les clients de messagerie
 * ignorent les feuilles de style, et un mail qui tente une mise en page riche
 * finit décomposé une fois sur deux. Le lien devient un bouton — c'est tout ce
 * qui manquait pour que le message cesse de ressembler à un hameçonnage.
 */
export function escalationHtml(context: EscalationMailContext): string {
  const merchant = escapeHtml(context.merchantName);
  const supplier = escapeHtml(context.supplierName);
  const reason = escapeHtml(REASON_LABELS[context.reason] ?? 'demande particulière');
  const order = context.orderName ? escapeHtml(context.orderName) : null;
  const url = escapeHtml(context.portalUrl);

  return `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:24px;background:#f5f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#14162a">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e6e7ef;border-radius:14px">
      <tr>
        <td style="padding:26px 28px">
          <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8b8ea3">${merchant}</p>
          <h1 style="margin:0 0 18px;font-size:19px;line-height:1.35;font-weight:650">
            ${order ? `Demande sur la commande ${order}` : 'Demande sur une commande'}
          </h1>

          <p style="margin:0 0 16px;font-size:14.5px;line-height:1.6">
            Bonjour ${supplier},<br />
            nous avons une demande à vous soumettre. Motif : <b>${reason}</b>.
          </p>

          <p style="margin:0 0 24px;font-size:14.5px;line-height:1.6">
            Le détail complet et le formulaire de réponse vous attendent sur votre
            espace. Vous pouvez répondre directement depuis la page.
          </p>

          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px">
            <tr>
              <td style="border-radius:10px;background:#5b4ee0">
                <a href="${url}" style="display:inline-block;padding:13px 22px;font-size:14.5px;font-weight:600;color:#ffffff;text-decoration:none">
                  Voir la demande et répondre
                </a>
              </td>
            </tr>
          </table>

          <p style="margin:0;font-size:12.5px;line-height:1.6;color:#8b8ea3">
            Ce lien vous est réservé : il ouvre directement la demande, sans mot de
            passe. Merci de ne pas le transférer.
          </p>
        </td>
      </tr>
    </table>

    <p style="max-width:520px;margin:14px auto 0;font-size:11.5px;color:#8b8ea3;text-align:center">
      Message envoyé par ${merchant} à propos d'une commande en cours.
    </p>
  </body>
</html>`;
}
