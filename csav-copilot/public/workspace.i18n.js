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
    'head.xlsx': 'Télécharger .xlsx',
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

    'nav.orders': 'Commandes',
    'nav.tracking': 'Suivi',
    'nav.catalog': 'Catalogue',
    'nav.updates': 'Changements',

    'range.yesterday': 'Hier',
    'range.today': "Aujourd'hui",
    'range.week': '7 jours',
    'range.custom': 'Dates',

    'progress.orders': '{done} / {total} commandes préparées',
    'progress.parcels': '{done} / {total} colis',

    'tracking.title': 'Colis enregistrés',
    'tracking.search': 'Numéro de suivi ou commande',
    'tracking.empty': 'Aucun colis enregistré pour le moment.',
    'tracking.photo': 'étiquette',

    'catalog.title': 'Catalogue',
    'catalog.empty': "Aucun article ne vous est encore attribué. Le marchand doit renseigner vos marques.",
    'catalog.variants': '{n} déclinaison(s)',
    'catalog.stock': 'stock {n}',

    'updates.title': 'Demandes de changement',
    'updates.empty': 'Aucune demande en cours.',
    'updates.pending': 'En attente',
    'updates.accept': "C'est fait",
    'updates.refuse': 'Impossible',
    'updates.why': 'Pourquoi ? (colis déjà parti, article indisponible…)',
    'updates.accepted': 'Pris en compte',
    'updates.refused': 'Refusé',
    'updates.banner': '{n} changement(s) à confirmer',
    'updates.sent': 'Réponse envoyée au marchand.',
    'updates.needWhy': 'Dites en un mot pourquoi.',

    'kind.ADDRESS': 'Adresse à corriger',
    'kind.PHONE': 'Téléphone à corriger',
    'kind.PRODUCT': 'Modèle à changer',
    'kind.SIZE': 'Taille à changer',
    'kind.COLOR': 'Couleur à changer',
    'kind.HOLD': 'Ne pas expédier',
    'kind.CANCEL': 'Commande annulée',
    'kind.OTHER': 'Message urgent',

    'filter.left': 'À préparer',
    'filter.all': 'Toutes',
    'orders.allDone': 'Tout est préparé pour cette période.',
    'parcel.tracked': 'Suivi {number}',

    'parcel.delete': 'Supprimer ce colis',
    'parcel.deleteAsk': 'Supprimer le colis {number} ? Le numéro disparaît de votre liste et de celle du marchand.',
    'parcel.deleted': 'Colis supprimé.',

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
    'head.xlsx': 'Download .xlsx',
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

    'nav.orders': 'Orders',
    'nav.tracking': 'Tracking',
    'nav.catalog': 'Catalogue',
    'nav.updates': 'Changes',

    'range.yesterday': 'Yesterday',
    'range.today': 'Today',
    'range.week': '7 days',
    'range.custom': 'Dates',

    'progress.orders': '{done} / {total} orders prepared',
    'progress.parcels': '{done} / {total} parcels',

    'tracking.title': 'Recorded parcels',
    'tracking.search': 'Tracking number or order',
    'tracking.empty': 'No parcels recorded yet.',
    'tracking.photo': 'label',

    'catalog.title': 'Catalogue',
    'catalog.empty': 'No items assigned to you yet. The merchant needs to set your brands.',
    'catalog.variants': '{n} variant(s)',
    'catalog.stock': 'stock {n}',

    'updates.title': 'Change requests',
    'updates.empty': 'No pending requests.',
    'updates.pending': 'Pending',
    'updates.accept': 'Confirm',
    'updates.refuse': "Can't do",
    'updates.why': 'Why? (parcel already shipped, item unavailable…)',
    'updates.accepted': 'Taken into account',
    'updates.refused': 'Refused',
    'updates.banner': '{n} change(s) to confirm',
    'updates.sent': 'Reply sent to the merchant.',
    'updates.needWhy': 'Say why in a few words.',

    'kind.ADDRESS': 'Address to correct',
    'kind.PHONE': 'Phone to correct',
    'kind.PRODUCT': 'Model to change',
    'kind.SIZE': 'Size to change',
    'kind.COLOR': 'Colour to change',
    'kind.HOLD': 'Do not ship',
    'kind.CANCEL': 'Order cancelled',
    'kind.OTHER': 'Urgent message',

    'filter.left': 'To prepare',
    'filter.all': 'All',
    'orders.allDone': 'Everything is prepared for this period.',
    'parcel.tracked': 'Tracking {number}',

    'parcel.delete': 'Delete this parcel',
    'parcel.deleteAsk': 'Delete parcel {number}? The number disappears from your list and from the merchant\u2019s.',
    'parcel.deleted': 'Parcel deleted.',

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
    'head.xlsx': '下载 .xlsx',
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

    'nav.orders': '订单',
    'nav.tracking': '物流',
    'nav.catalog': '产品目录',
    'nav.updates': '变更',

    'range.yesterday': '昨天',
    'range.today': '今天',
    'range.week': '近 7 天',
    'range.custom': '日期',

    'progress.orders': '已处理 {done} / {total} 个订单',
    'progress.parcels': '{done} / {total} 个包裹',

    'tracking.title': '已登记包裹',
    'tracking.search': '运单号或订单号',
    'tracking.empty': '暂无已登记的包裹。',
    'tracking.photo': '面单',

    'catalog.title': '产品目录',
    'catalog.empty': '暂无分配给您的商品。请商家设置您的品牌。',
    'catalog.variants': '{n} 个规格',
    'catalog.stock': '库存 {n}',

    'updates.title': '变更请求',
    'updates.empty': '暂无待处理请求。',
    'updates.pending': '待处理',
    'updates.accept': '已确认处理',
    'updates.refuse': '无法处理',
    'updates.why': '原因？（包裹已发出、商品缺货……）',
    'updates.accepted': '已处理',
    'updates.refused': '已拒绝',
    'updates.banner': '{n} 项变更待确认',
    'updates.sent': '回复已发送给商家。',
    'updates.needWhy': '请简要说明原因。',

    'kind.ADDRESS': '需修改地址',
    'kind.PHONE': '需修改电话',
    'kind.PRODUCT': '需更换型号',
    'kind.SIZE': '需更换尺码',
    'kind.COLOR': '需更换颜色',
    'kind.HOLD': '请勿发货',
    'kind.CANCEL': '订单已取消',
    'kind.OTHER': '紧急消息',

    'filter.left': '待处理',
    'filter.all': '全部',
    'orders.allDone': '该时间段的订单已全部处理完毕。',
    'parcel.tracked': '运单号 {number}',

    'parcel.delete': '删除该包裹',
    'parcel.deleteAsk': '删除包裹 {number}？该运单号将从您和商家的列表中移除。',
    'parcel.deleted': '包裹已删除。',

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
