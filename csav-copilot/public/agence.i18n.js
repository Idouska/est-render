/**
 * Le vocabulaire du portail des agences, en quatre langues.
 *
 * Les agences sont en France, en Espagne, en Italie et en Belgique : on ne
 * demande à personne de travailler dans une langue qu'il lit mal. L'anglais
 * sert de repli commun. Même mécanique que l'atelier : une table par langue,
 * `{nom}` remplacé à l'affichage, et une clé absente retombe sur le français
 * plutôt que sur son propre nom.
 */

export const LANGS = [
  { code: 'fr', label: 'FR', name: 'Français' },
  { code: 'en', label: 'EN', name: 'English' },
  { code: 'es', label: 'ES', name: 'Español' },
  { code: 'it', label: 'IT', name: 'Italiano' },
];

export const STRINGS = {
  fr: {
    'ag.title': 'Expéditions depuis votre stock',
    'ag.refresh': 'Rafraîchir',
    'ag.toShip': 'À expédier',
    'ag.shipped': 'Expédiées — 30 derniers jours',
    'ag.none': 'Rien à expédier pour le moment. Les commandes que le marchand confie à votre stock apparaissent ici.',
    'ag.noneShipped': 'Aucune expédition ces trente derniers jours.',
    'ag.entrusted': 'Confiée il y a {jours} j',
    'ag.address': 'Adresse du client',
    'ag.copy': 'Copier l’adresse',
    'ag.copied': 'Adresse copiée.',
    'ag.copyFail': 'Copie impossible : sélectionnez l’adresse à la main.',
    'ag.toSend': 'À envoyer',
    'ag.fromReturn': 'retour {commande}',
    'ag.photo': 'Photo',
    'ag.tracking': 'Numéro de suivi',
    'ag.carrier': 'Transporteur (facultatif)',
    'ag.ship': 'Enregistrer et expédier',
    'ag.saving': 'Enregistrement…',
    'ag.shippedOk': 'Commande expédiée : le client a reçu son numéro de suivi.',
    'ag.shippedFail': 'Numéro enregistré, mais Shopify n’a pas pu expédier : {raison} Le marchand est prévenu.',
    'ag.shippedTest': 'Mode test : numéro enregistré, aucune expédition, aucun e-mail.',
    'ag.correct': 'Corriger le numéro',
    'ag.correctConfirm': 'Le numéro {ancien} a déjà été envoyé au client. Le remplacer par {numero} ? Shopify lui enverra le numéro corrigé.',
    'ag.correctConfirmTest': 'Mode test : le numéro {ancien} avait été envoyé au client. Le remplacer par {numero} ? Aucun e-mail ne partira.',
    'ag.corrected': 'Numéro corrigé.',
    'ag.correctedNotified': 'Numéro corrigé — le client a reçu le bon.',
    'ag.needTracking': 'Le numéro de suivi est obligatoire.',
    'ag.addressDown': 'Adresses indisponibles pour le moment : rafraîchissez dans un instant.',
    'ag.testBanner': 'Vos saisies sont enregistrées, mais aucune commande n’est expédiée et aucun client n’est prévenu.',
    'ag.err.lien_invalide': 'Lien invalide.',
    'ag.err.lien_revoque': 'Ce lien a été révoqué. Demandez-en un nouveau au marchand.',
    'ag.err.introuvable': 'Cette commande n’est pas confiée à votre agence.',
    'ag.err.invalide': 'Numéro de suivi invalide : entre 3 et 80 caractères.',
    'ag.err.abime_excel': 'Numéro abîmé par Excel : retapez-le en texte.',
    'ag.err.shopify': 'Shopify n’a pas répondu : réessayez dans un instant.',
    'ag.err.shopify_refus': 'Shopify a refusé la correction : {raison}',
    'test.title': 'Mode test',
  },
  en: {
    'ag.title': 'Shipments from your stock',
    'ag.refresh': 'Refresh',
    'ag.toShip': 'To ship',
    'ag.shipped': 'Shipped — last 30 days',
    'ag.none': 'Nothing to ship right now. Orders the merchant assigns to your stock appear here.',
    'ag.noneShipped': 'No shipment in the last thirty days.',
    'ag.entrusted': 'Assigned {jours} days ago',
    'ag.address': 'Customer address',
    'ag.copy': 'Copy the address',
    'ag.copied': 'Address copied.',
    'ag.copyFail': 'Copy failed: select the address by hand.',
    'ag.toSend': 'To send',
    'ag.fromReturn': 'return {commande}',
    'ag.photo': 'Photo',
    'ag.tracking': 'Tracking number',
    'ag.carrier': 'Carrier (optional)',
    'ag.ship': 'Save and ship',
    'ag.saving': 'Saving…',
    'ag.shippedOk': 'Order shipped: the customer received the tracking number.',
    'ag.shippedFail': 'Number saved, but Shopify could not ship: {raison} The merchant has been told.',
    'ag.shippedTest': 'Test mode: number saved, nothing shipped, no email.',
    'ag.correct': 'Correct the number',
    'ag.correctConfirm': 'Tracking number {ancien} was already sent to the customer. Replace it with {numero}? Shopify will send them the corrected number.',
    'ag.correctConfirmTest': 'Test mode: number {ancien} had been sent to the customer. Replace it with {numero}? No email will be sent.',
    'ag.corrected': 'Number corrected.',
    'ag.correctedNotified': 'Number corrected — the customer received the right one.',
    'ag.needTracking': 'The tracking number is required.',
    'ag.addressDown': 'Addresses unavailable right now: refresh in a moment.',
    'ag.testBanner': 'Your entries are saved, but no order is shipped and no customer is notified.',
    'ag.err.lien_invalide': 'Invalid link.',
    'ag.err.lien_revoque': 'This link was revoked. Ask the merchant for a new one.',
    'ag.err.introuvable': 'This order is not assigned to your agency.',
    'ag.err.invalide': 'Invalid tracking number: 3 to 80 characters.',
    'ag.err.abime_excel': 'Number damaged by Excel: retype it as text.',
    'ag.err.shopify': 'Shopify did not respond: try again in a moment.',
    'ag.err.shopify_refus': 'Shopify refused the correction: {raison}',
    'test.title': 'Test mode',
  },
  es: {
    'ag.title': 'Envíos desde su stock',
    'ag.refresh': 'Actualizar',
    'ag.toShip': 'Por enviar',
    'ag.shipped': 'Enviados — últimos 30 días',
    'ag.none': 'Nada que enviar por ahora. Los pedidos que el comerciante asigna a su stock aparecen aquí.',
    'ag.noneShipped': 'Ningún envío en los últimos treinta días.',
    'ag.entrusted': 'Asignado hace {jours} días',
    'ag.address': 'Dirección del cliente',
    'ag.copy': 'Copiar la dirección',
    'ag.copied': 'Dirección copiada.',
    'ag.copyFail': 'No se pudo copiar: seleccione la dirección a mano.',
    'ag.toSend': 'Por enviar',
    'ag.fromReturn': 'devolución {commande}',
    'ag.photo': 'Foto',
    'ag.tracking': 'Número de seguimiento',
    'ag.carrier': 'Transportista (opcional)',
    'ag.ship': 'Guardar y enviar',
    'ag.saving': 'Guardando…',
    'ag.shippedOk': 'Pedido enviado: el cliente ha recibido su número de seguimiento.',
    'ag.shippedFail': 'Número guardado, pero Shopify no pudo enviar: {raison} El comerciante ha sido avisado.',
    'ag.shippedTest': 'Modo de prueba: número guardado, sin envío y sin correo.',
    'ag.correct': 'Corregir el número',
    'ag.correctConfirm': 'El número {ancien} ya se envió al cliente. ¿Reemplazarlo por {numero}? Shopify le enviará el número corregido.',
    'ag.correctConfirmTest': 'Modo de prueba: el número {ancien} se había enviado al cliente. ¿Reemplazarlo por {numero}? No se enviará ningún correo.',
    'ag.corrected': 'Número corregido.',
    'ag.correctedNotified': 'Número corregido — el cliente ha recibido el correcto.',
    'ag.needTracking': 'El número de seguimiento es obligatorio.',
    'ag.addressDown': 'Direcciones no disponibles ahora mismo: actualice en un momento.',
    'ag.testBanner': 'Sus registros se guardan, pero no se envía ningún pedido ni se avisa a ningún cliente.',
    'ag.err.lien_invalide': 'Enlace no válido.',
    'ag.err.lien_revoque': 'Este enlace fue revocado. Pida uno nuevo al comerciante.',
    'ag.err.introuvable': 'Este pedido no está asignado a su agencia.',
    'ag.err.invalide': 'Número de seguimiento no válido: entre 3 y 80 caracteres.',
    'ag.err.abime_excel': 'Número dañado por Excel: escríbalo de nuevo como texto.',
    'ag.err.shopify': 'Shopify no respondió: inténtelo de nuevo en un momento.',
    'ag.err.shopify_refus': 'Shopify rechazó la corrección: {raison}',
    'test.title': 'Modo de prueba',
  },
  it: {
    'ag.title': 'Spedizioni dal vostro stock',
    'ag.refresh': 'Aggiorna',
    'ag.toShip': 'Da spedire',
    'ag.shipped': 'Spedite — ultimi 30 giorni',
    'ag.none': 'Niente da spedire per ora. Gli ordini che il commerciante affida al vostro stock compaiono qui.',
    'ag.noneShipped': 'Nessuna spedizione negli ultimi trenta giorni.',
    'ag.entrusted': 'Affidato {jours} giorni fa',
    'ag.address': 'Indirizzo del cliente',
    'ag.copy': 'Copia l’indirizzo',
    'ag.copied': 'Indirizzo copiato.',
    'ag.copyFail': 'Copia non riuscita: selezionate l’indirizzo a mano.',
    'ag.toSend': 'Da inviare',
    'ag.fromReturn': 'reso {commande}',
    'ag.photo': 'Foto',
    'ag.tracking': 'Numero di tracciamento',
    'ag.carrier': 'Corriere (facoltativo)',
    'ag.ship': 'Salva e spedisci',
    'ag.saving': 'Salvataggio…',
    'ag.shippedOk': 'Ordine spedito: il cliente ha ricevuto il numero di tracciamento.',
    'ag.shippedFail': 'Numero salvato, ma Shopify non ha potuto spedire: {raison} Il commerciante è stato avvisato.',
    'ag.shippedTest': 'Modalità test: numero salvato, nessuna spedizione, nessuna email.',
    'ag.correct': 'Correggi il numero',
    'ag.correctConfirm': 'Il numero {ancien} è già stato inviato al cliente. Sostituirlo con {numero}? Shopify gli invierà il numero corretto.',
    'ag.correctConfirmTest': 'Modalità test: il numero {ancien} era stato inviato al cliente. Sostituirlo con {numero}? Nessuna email partirà.',
    'ag.corrected': 'Numero corretto.',
    'ag.correctedNotified': 'Numero corretto — il cliente ha ricevuto quello giusto.',
    'ag.needTracking': 'Il numero di tracciamento è obbligatorio.',
    'ag.addressDown': 'Indirizzi non disponibili al momento: aggiornate tra poco.',
    'ag.testBanner': 'Le vostre registrazioni sono salvate, ma nessun ordine viene spedito e nessun cliente viene avvisato.',
    'ag.err.lien_invalide': 'Link non valido.',
    'ag.err.lien_revoque': 'Questo link è stato revocato. Chiedetene uno nuovo al commerciante.',
    'ag.err.introuvable': 'Questo ordine non è affidato alla vostra agenzia.',
    'ag.err.invalide': 'Numero di tracciamento non valido: da 3 a 80 caratteri.',
    'ag.err.abime_excel': 'Numero danneggiato da Excel: riscrivetelo come testo.',
    'ag.err.shopify': 'Shopify non ha risposto: riprovate tra poco.',
    'ag.err.shopify_refus': 'Shopify ha rifiutato la correzione: {raison}',
    'test.title': 'Modalità test',
  },
};

/** Langue retenue, ou celle du navigateur, ou le français. */
export function pickLang() {
  try {
    const gardee = localStorage.getItem('csav.agence.lang');
    if (gardee && STRINGS[gardee]) return gardee;
  } catch {
    // Navigateur sans stockage : la langue vaut pour la visite.
  }
  const navigateur = (navigator.language ?? 'fr').slice(0, 2).toLowerCase();
  return STRINGS[navigateur] ? navigateur : 'fr';
}

export function saveLang(lang) {
  try {
    localStorage.setItem('csav.agence.lang', lang);
  } catch {
    // Sans stockage, la langue repart au français à la prochaine visite.
  }
}

export function translator(lang) {
  const table = STRINGS[lang] ?? STRINGS.fr;
  return function t(key, values = {}) {
    const brut = table[key] ?? STRINGS.fr[key] ?? key;
    return brut.replace(/\{(\w+)\}/g, (match, nom) => (nom in values ? String(values[nom]) : match));
  };
}

export const LOCALES = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES', it: 'it-IT' };
