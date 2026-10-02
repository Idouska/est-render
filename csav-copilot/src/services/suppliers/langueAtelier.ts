/**
 * Les mots des mails envoyés à l'atelier, dans sa langue.
 *
 * Son espace se lit en français, en anglais ou en chinois ; ses mails, eux,
 * partaient tous en français. Un « Ne pas expédier » qu'on comprend à moitié
 * est un colis qui part quand même. La langue est choisie sur la fiche du
 * fournisseur ; à défaut, le français, comme avant.
 *
 * Sans base ni réseau : se teste seul.
 */

export const LANGUES_ATELIER = ['fr', 'en', 'zh'] as const;
export type LangueAtelier = (typeof LANGUES_ATELIER)[number];

export const langueAtelier = (valeur: string | null | undefined): LangueAtelier =>
  (LANGUES_ATELIER as readonly string[]).includes(valeur ?? '') ? (valeur as LangueAtelier) : 'fr';

/** Pour les dates écrites dans le mail. */
export const LOCALE_ATELIER: Record<LangueAtelier, string> = { fr: 'fr-FR', en: 'en-GB', zh: 'zh-CN' };

const pluriel = (n: number, mot: string) => `${mot}${n > 1 ? 's' : ''}`;

export const MOTS = {
  fr: {
    titres: {
      ADDRESS: 'Adresse à corriger',
      PHONE: 'Téléphone à corriger',
      PRODUCT: 'Modèle à changer',
      SIZE: 'Taille à changer',
      COLOR: 'Couleur à changer',
      HOLD: 'Ne pas expédier',
      CANCEL: 'Commande annulée',
      MISSING_ITEM: 'Article manquant',
      DELAY: 'Date d’expédition demandée',
      TRACKING: 'Point sur le colis',
      OTHER: 'Message',
    } as Record<string, string>,
    articleManquant: (article: string) => `Article manquant : ${article}`,
    colis: (numeros: string) => `Colis : ${numeros}`,
    expeditionAttendue: (date: string) => `Expédition attendue au plus tard le ${date}`,
    auPlusTard: (date: string) => `au plus tard le ${date}`,
    demande: 'Demande',
    urgent: 'URGENT',
    commande: (numero: string) => `Commande : ${numero}`,
    repondre: 'Ouvrez votre espace de travail, rubrique « Tickets », pour répondre d’un bouton.',
    rappelSujet: 'RAPPEL — demande sans réponse',
    rappelCorps: [
      'Cette demande attend votre réponse depuis hier. Ouvrez votre espace',
      'de travail, rubrique Tickets, pour confirmer — ou dire pourquoi c’est',
      'impossible.',
    ],
    bonjour: 'Bonjour,',
    recapSujet: (n: number) => `Récapitulatif du jour — ${n} ${pluriel(n, 'demande')} à traiter`,
    recapIntro: 'Voici ce qui attend votre réponse. Tout se répond d’un bouton dans votre atelier, rubrique « Tickets ».',
    nouvelles: 'Nouvelles demandes :',
    enAttente: 'Toujours sans réponse :',
    sansCommande: 'Sans commande',
    depuis: (jours: number) => ` (depuis ${jours} j)`,
    rupture: (n: number) =>
      `Rupture : ${n > 1 ? `${n} modèles de remplacement` : 'un modèle de remplacement'} à valider`,
    lienHabituel: 'Ouvrez votre atelier avec le lien habituel.',
    retardSujet: (n: number, delai: number) =>
      `Rappel — ${n} ${pluriel(n, 'commande')} à expédier depuis plus de ${delai} jours`,
    retardIntro: (delai: number) =>
      `Ces commandes vous ont été envoyées il y a plus de ${delai} jours et n'ont pas encore de colis :`,
    retardLien: 'Saisissez leur numéro de suivi dans votre atelier, onglet « Lots reçus »',
    jourSujet: (jour: string, n: number) => `Commandes du ${jour} — ${n} à préparer`,
    jourIntro: (n: number) => `Voici les ${n} commande(s) à préparer, dans le fichier joint.`,
    jourStock:
      'Les commandes que nous expédions nous-mêmes depuis notre stock ne sont pas dans le fichier : ne les préparez pas.',
  },
  en: {
    titres: {
      ADDRESS: 'Address to correct',
      PHONE: 'Phone number to correct',
      PRODUCT: 'Model to change',
      SIZE: 'Size to change',
      COLOR: 'Colour to change',
      HOLD: 'Do not ship',
      CANCEL: 'Order cancelled',
      MISSING_ITEM: 'Missing item',
      DELAY: 'Requested shipping date',
      TRACKING: 'Parcel status check',
      OTHER: 'Message',
    } as Record<string, string>,
    articleManquant: (article: string) => `Missing item: ${article}`,
    colis: (numeros: string) => `Parcel: ${numeros}`,
    expeditionAttendue: (date: string) => `Expected to ship by ${date}`,
    auPlusTard: (date: string) => `by ${date}`,
    demande: 'Request',
    urgent: 'URGENT',
    commande: (numero: string) => `Order: ${numero}`,
    repondre: 'Open your workspace, “Tickets” section, to answer with one button.',
    rappelSujet: 'REMINDER — request awaiting your answer',
    rappelCorps: [
      'This request has been waiting for your answer since yesterday. Open your',
      'workspace, “Tickets” section, to confirm — or say why it is not possible.',
    ],
    bonjour: 'Hello,',
    recapSujet: (n: number) => `Daily summary — ${n} ${pluriel(n, 'request')} to handle`,
    recapIntro: 'Here is what is waiting for your answer. Everything is answered with one button in your workspace, “Tickets” section.',
    nouvelles: 'New requests:',
    enAttente: 'Still awaiting your answer:',
    sansCommande: 'No order',
    depuis: (jours: number) => ` (for ${jours} d)`,
    rupture: (n: number) =>
      `Out of stock: ${n > 1 ? `${n} replacement models` : 'one replacement model'} to confirm`,
    lienHabituel: 'Open your workspace with your usual link.',
    retardSujet: (n: number, delai: number) =>
      `Reminder — ${n} ${pluriel(n, 'order')} not shipped after ${delai} days`,
    retardIntro: (delai: number) =>
      `These orders were sent to you more than ${delai} days ago and have no parcel yet:`,
    retardLien: 'Enter their tracking numbers in your workspace, “Batches received” tab',
    jourSujet: (jour: string, n: number) => `Orders of ${jour} — ${n} to prepare`,
    jourIntro: (n: number) => `Here are the ${n} order(s) to prepare, in the attached file.`,
    jourStock: 'The orders we ship ourselves from our stock are not in the file: do not prepare them.',
  },
  zh: {
    titres: {
      ADDRESS: '地址需更正',
      PHONE: '电话需更正',
      PRODUCT: '需更换款式',
      SIZE: '需更换尺码',
      COLOR: '需更换颜色',
      HOLD: '暂停发货',
      CANCEL: '订单已取消',
      MISSING_ITEM: '缺少商品',
      DELAY: '要求的发货日期',
      TRACKING: '包裹进度查询',
      OTHER: '留言',
    } as Record<string, string>,
    articleManquant: (article: string) => `缺少商品：${article}`,
    colis: (numeros: string) => `包裹：${numeros}`,
    expeditionAttendue: (date: string) => `最迟发货日期：${date}`,
    auPlusTard: (date: string) => `最迟 ${date}`,
    demande: '请求',
    urgent: '紧急',
    commande: (numero: string) => `订单：${numero}`,
    repondre: '请打开您的工作台“工单”栏目，一键回复。',
    rappelSujet: '提醒 — 请求尚未回复',
    rappelCorps: ['此请求自昨天起等待您的回复。请打开您的工作台“工单”栏目确认，或说明无法处理的原因。'],
    bonjour: '您好，',
    recapSujet: (n: number) => `每日汇总 — ${n} 项待处理请求`,
    recapIntro: '以下事项等待您的回复。所有事项均可在您的工作台“工单”栏目中一键回复。',
    nouvelles: '新请求：',
    enAttente: '仍未回复：',
    sansCommande: '无订单',
    depuis: (jours: number) => `（已 ${jours} 天）`,
    rupture: (n: number) => `缺货：${n > 1 ? `${n} 个替代款式` : '1 个替代款式'}待确认`,
    lienHabituel: '请使用常用链接打开您的工作台。',
    retardSujet: (n: number, delai: number) => `提醒 — ${n} 个订单已超过 ${delai} 天未发货`,
    retardIntro: (delai: number) => `以下订单已于 ${delai} 天前发给您，至今尚无包裹：`,
    retardLien: '请在您的工作台“已收批次”标签中录入运单号',
    jourSujet: (jour: string, n: number) => `${jour} 订单 — ${n} 单待备货`,
    jourIntro: (n: number) => `附件中为 ${n} 个待备货订单。`,
    jourStock: '我们从自有库存发出的订单不在文件中，请勿备货。',
  },
} satisfies Record<LangueAtelier, unknown>;

/** La demande en une ligne, lisible sur un écran verrouillé : « 44 → 45 ». */
export function changementDemande(
  kind: string,
  beforeValue: string | null | undefined,
  afterValue: string | null | undefined,
  langue: LangueAtelier = 'fr',
): string | null {
  const mots = MOTS[langue];
  if (kind === 'MISSING_ITEM') return beforeValue ? mots.articleManquant(beforeValue) : null;
  if (kind === 'TRACKING') return beforeValue ? mots.colis(beforeValue) : null;
  if (kind === 'DELAY') return afterValue ? mots.expeditionAttendue(afterValue) : null;
  return afterValue ? `${beforeValue ?? '?'} → ${afterValue}` : null;
}

/** Le mail d'une demande urgente. */
export function mailUrgent(
  demande: { kind: string; orderName: string | null; beforeValue: string | null; afterValue: string | null; message: string },
  langue: LangueAtelier = 'fr',
): { subject: string; body: string } {
  const mots = MOTS[langue];
  return {
    subject: `${mots.urgent} — ${mots.titres[demande.kind] ?? mots.demande}${demande.orderName ? ` · ${demande.orderName}` : ''}`,
    body: [
      // Le changement en premier, avant toute phrase : c'est ce qu'on lit
      // sur l'écran verrouillé d'un téléphone.
      changementDemande(demande.kind, demande.beforeValue, demande.afterValue, langue),
      demande.orderName ? mots.commande(demande.orderName) : null,
      demande.message.trim() || null,
      '',
      mots.repondre,
    ]
      .filter((ligne) => ligne !== null)
      .join('\n'),
  };
}

/** Le rappel d'une demande urgente restée sans réponse. */
export function mailRappelUrgent(
  demande: { kind: string; orderName: string | null; beforeValue: string | null; afterValue: string | null; message: string },
  langue: LangueAtelier = 'fr',
): { subject: string; body: string } {
  const mots = MOTS[langue];
  return {
    subject: `${mots.rappelSujet}${demande.orderName ? ` · ${demande.orderName}` : ''}`,
    body: [
      changementDemande(demande.kind, demande.beforeValue, demande.afterValue, langue),
      demande.orderName ? mots.commande(demande.orderName) : null,
      demande.message || null,
      '',
      ...mots.rappelCorps,
    ]
      .filter((ligne) => ligne !== null)
      .join('\n'),
  };
}

/** Le mail du fichier du jour. */
export function mailDuJour(contexte: {
  langue: LangueAtelier;
  date: Date;
  fuseau: string;
  combien: number;
  signature: string;
}): { subject: string; body: string } {
  const mots = MOTS[contexte.langue];
  const jour = contexte.date.toLocaleDateString(LOCALE_ATELIER[contexte.langue], {
    timeZone: contexte.fuseau,
    day: 'numeric',
    month: 'short',
  });
  return {
    subject: mots.jourSujet(jour, contexte.combien),
    body: [mots.bonjour, '', mots.jourIntro(contexte.combien), mots.jourStock, '', contexte.signature].join('\n'),
  };
}
