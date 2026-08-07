/**
 * Traductions de l'atelier fournisseur.
 *
 * L'atelier est le seul écran de l'outil qu'une personne extérieure ouvre
 * chaque jour — et cette personne est souvent en Chine. Lui présenter
 * « Numéro de suivi » et « Article indisponible » en français, c'est lui
 * demander de deviner : une taille mal comprise part en colis, une adresse
 * mal lue revient au bout de trois semaines. Le dashboard du marchand reste
 * en français ; ici la langue est celle de qui travaille.
 *
 * Trois langues, une par population réelle : le marchand (fr), les
 * prestataires anglophones (en), les ateliers chinois (zh). Rien de plus tant
 * qu'un fournisseur ne le demande — une traduction que personne ne relit
 * vieillit plus vite qu'elle ne sert.
 *
 * Le dictionnaire est plat et les clés sont lisibles : `orders.empty` se
 * retrouve d'un coup d'œil dans le HTML, là où un identifiant numéroté
 * obligerait à ouvrir deux fichiers pour comprendre une phrase.
 */

export const LANGS = [
  { code: 'fr', label: 'FR', name: 'Français' },
  { code: 'en', label: 'EN', name: 'English' },
  { code: 'zh', label: '中文', name: '中文' },
];

export const STRINGS = {
  fr: {
    'doc.title': 'Atelier — commandes à préparer',
    'gate.title': 'Lien invalide',
    'gate.help': "Demandez au marchand de vous renvoyer votre lien d'accès.",
    'gate.noToken': 'Aucun jeton dans le lien.',

    'head.crumb': 'Atelier',
    'head.title': 'Commandes à préparer',
    'head.workshop': 'Atelier {name}',
    'head.from': 'Du',
    'head.to': 'au',
    'head.reload': 'Actualiser',
    'head.xlsx': 'Feuille Excel',
    'head.csv': 'CSV',
    'head.lang': 'Langue',

    'orders.count': '{n} commande(s) sur la période',
    'orders.empty': 'Aucune commande sur cette période. Changez les dates ci-dessus.',
    'orders.customer': 'Client',
    'orders.phone': 'Téléphone :',
    'orders.phoneMissing': 'absent',
    'orders.parcelCount': 'Nombre de colis',
    'orders.parcelOption': '{n} colis',
    'orders.report': 'Signaler un problème',

    'parcel.head': 'Colis {index}/{total}',
    'parcel.saved': 'enregistré',
    'parcel.tracking': 'Numéro de suivi',
    'parcel.carrier': 'Transporteur (facultatif)',
    'parcel.shoot': 'Prendre une photo',
    'parcel.reshoot': 'Reprendre la photo',
    'parcel.save': 'Enregistrer',
    'parcel.label': 'Étiquette {index}',
    'parcel.needTracking': 'Le numéro de suivi est obligatoire.',
    'parcel.savedToast': 'Colis {index}/{total} enregistré.',
    'parcel.badPhoto': 'Photo illisible — reprenez-la.',

    'issue.title': 'Signaler un problème',
    'issue.order': 'Commande {name}',
    'issue.kind': 'Nature du problème',
    'issue.kind.PHONE': 'Numéro de téléphone incomplet ou invalide',
    'issue.kind.ADDRESS': 'Adresse incomplète ou incorrecte',
    'issue.kind.STOCK': 'Article indisponible',
    'issue.kind.DAMAGE': 'Article abîmé',
    'issue.kind.OTHER': 'Autre problème',
    'issue.product': 'Modèle',
    'issue.productHint': 'Ex. : Nike Mind 001',
    'issue.color': 'Couleur',
    'issue.size': 'Taille',
    'issue.qty': 'Quantité',
    'issue.sku': 'Référence (SKU)',
    'issue.note': 'Détail',
    'issue.noteHint': 'Ex. : le numéro fait 8 chiffres, il en manque un.',
    'issue.cancel': 'Annuler',
    'issue.send': 'Envoyer au marchand',
    'issue.needNote': 'Décrivez le problème en une phrase.',
    'issue.sent': 'Signalement envoyé au marchand.',

    'alert.ADDRESS': 'Adresse à corriger',
    'alert.PHONE': 'Téléphone à corriger',
    'alert.PRODUCT': 'Article à changer',
    'alert.HOLD': 'Ne pas expédier',
    'alert.OTHER': 'Message urgent',
    'alert.fallback': 'Urgent',
    'alert.ack': "J'ai vu",

    'error.generic': 'Erreur ({status})',
  },

  en: {
    'doc.title': 'Workshop — orders to prepare',
    'gate.title': 'Invalid link',
    'gate.help': 'Ask the merchant to send you your access link again.',
    'gate.noToken': 'No token in the link.',

    'head.crumb': 'Workshop',
    'head.title': 'Orders to prepare',
    'head.workshop': '{name} workshop',
    'head.from': 'From',
    'head.to': 'to',
    'head.reload': 'Refresh',
    'head.xlsx': 'Excel sheet',
    'head.csv': 'CSV',
    'head.lang': 'Language',

    'orders.count': '{n} order(s) in this period',
    'orders.empty': 'No orders in this period. Change the dates above.',
    'orders.customer': 'Customer',
    'orders.phone': 'Phone:',
    'orders.phoneMissing': 'missing',
    'orders.parcelCount': 'Number of parcels',
    'orders.parcelOption': '{n} parcel(s)',
    'orders.report': 'Report a problem',

    'parcel.head': 'Parcel {index}/{total}',
    'parcel.saved': 'saved',
    'parcel.tracking': 'Tracking number',
    'parcel.carrier': 'Carrier (optional)',
    'parcel.shoot': 'Take a photo',
    'parcel.reshoot': 'Retake the photo',
    'parcel.save': 'Save',
    'parcel.label': 'Label {index}',
    'parcel.needTracking': 'The tracking number is required.',
    'parcel.savedToast': 'Parcel {index}/{total} saved.',
    'parcel.badPhoto': 'Unreadable photo — take it again.',

    'issue.title': 'Report a problem',
    'issue.order': 'Order {name}',
    'issue.kind': 'Type of problem',
    'issue.kind.PHONE': 'Phone number incomplete or invalid',
    'issue.kind.ADDRESS': 'Address incomplete or incorrect',
    'issue.kind.STOCK': 'Item out of stock',
    'issue.kind.DAMAGE': 'Item damaged',
    'issue.kind.OTHER': 'Other problem',
    'issue.product': 'Model',
    'issue.productHint': 'e.g. Nike Mind 001',
    'issue.color': 'Colour',
    'issue.size': 'Size',
    'issue.qty': 'Quantity',
    'issue.sku': 'Reference (SKU)',
    'issue.note': 'Details',
    'issue.noteHint': 'e.g. the number has 8 digits, one is missing.',
    'issue.cancel': 'Cancel',
    'issue.send': 'Send to merchant',
    'issue.needNote': 'Describe the problem in one sentence.',
    'issue.sent': 'Report sent to the merchant.',

    'alert.ADDRESS': 'Address to correct',
    'alert.PHONE': 'Phone to correct',
    'alert.PRODUCT': 'Item to change',
    'alert.HOLD': 'Do not ship',
    'alert.OTHER': 'Urgent message',
    'alert.fallback': 'Urgent',
    'alert.ack': 'Seen',

    'error.generic': 'Error ({status})',
  },

  zh: {
    'doc.title': '工作台 — 待处理订单',
    'gate.title': '链接无效',
    'gate.help': '请联系商家重新发送您的访问链接。',
    'gate.noToken': '链接中缺少令牌。',

    'head.crumb': '工作台',
    'head.title': '待处理订单',
    'head.workshop': '{name} 工作台',
    'head.from': '从',
    'head.to': '至',
    'head.reload': '刷新',
    'head.xlsx': 'Excel 表格',
    'head.csv': 'CSV',
    'head.lang': '语言',

    'orders.count': '本期共 {n} 个订单',
    'orders.empty': '该时间段没有订单。请修改上方日期。',
    'orders.customer': '客户',
    'orders.phone': '电话：',
    'orders.phoneMissing': '缺失',
    'orders.parcelCount': '包裹数量',
    'orders.parcelOption': '{n} 个包裹',
    'orders.report': '报告问题',

    'parcel.head': '包裹 {index}/{total}',
    'parcel.saved': '已保存',
    'parcel.tracking': '运单号',
    'parcel.carrier': '承运商（选填）',
    'parcel.shoot': '拍照',
    'parcel.reshoot': '重新拍照',
    'parcel.save': '保存',
    'parcel.label': '面单 {index}',
    'parcel.needTracking': '运单号为必填项。',
    'parcel.savedToast': '包裹 {index}/{total} 已保存。',
    'parcel.badPhoto': '照片无法识别，请重拍。',

    'issue.title': '报告问题',
    'issue.order': '订单 {name}',
    'issue.kind': '问题类型',
    'issue.kind.PHONE': '电话号码不完整或无效',
    'issue.kind.ADDRESS': '地址不完整或有误',
    'issue.kind.STOCK': '商品缺货',
    'issue.kind.DAMAGE': '商品损坏',
    'issue.kind.OTHER': '其他问题',
    'issue.product': '型号',
    'issue.productHint': '例如：Nike Mind 001',
    'issue.color': '颜色',
    'issue.size': '尺码',
    'issue.qty': '数量',
    'issue.sku': '货号（SKU）',
    'issue.note': '详情',
    'issue.noteHint': '例如：号码只有 8 位，缺一位。',
    'issue.cancel': '取消',
    'issue.send': '发送给商家',
    'issue.needNote': '请用一句话描述问题。',
    'issue.sent': '问题已发送给商家。',

    'alert.ADDRESS': '需修改地址',
    'alert.PHONE': '需修改电话',
    'alert.PRODUCT': '需更换商品',
    'alert.HOLD': '请勿发货',
    'alert.OTHER': '紧急消息',
    'alert.fallback': '紧急',
    'alert.ack': '已阅',

    'error.generic': '错误（{status}）',
  },
};

/**
 * Langue retenue, dans cet ordre : le choix explicite du fournisseur, puis
 * celle de son navigateur, puis le français.
 *
 * Le choix est mémorisé par lien et non globalement : deux ateliers ouverts
 * sur le même poste — cela arrive chez un marchand qui vérifie — ne doivent
 * pas se voler leur langue.
 */
export function pickLang(supplierId) {
  const saved = localStorage.getItem(`csav.ws.lang.${supplierId}`);
  if (saved && STRINGS[saved]) return saved;

  const browser = (navigator.language ?? 'fr').toLowerCase();
  if (browser.startsWith('zh')) return 'zh';
  if (browser.startsWith('en')) return 'en';
  return 'fr';
}

export function saveLang(supplierId, lang) {
  localStorage.setItem(`csav.ws.lang.${supplierId}`, lang);
}

/**
 * Traduit une clé, en remplaçant les jetons `{nom}`.
 *
 * Une clé absente se rabat sur le français plutôt que de rendre la clé nue :
 * un écran qui affiche `parcel.tracking` à côté d'un champ de saisie est plus
 * déroutant qu'un mot dans la mauvaise langue.
 */
export function translator(lang) {
  const table = STRINGS[lang] ?? STRINGS.fr;

  return function t(key, values = {}) {
    const raw = table[key] ?? STRINGS.fr[key] ?? key;
    return raw.replace(/\{(\w+)\}/g, (match, name) =>
      name in values ? String(values[name]) : match,
    );
  };
}

/** Locale de formatage des dates, dérivée de la langue choisie. */
export const LOCALES = { fr: 'fr-FR', en: 'en-GB', zh: 'zh-CN' };
