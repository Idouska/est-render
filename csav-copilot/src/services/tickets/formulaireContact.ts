import { adresseAutomatique, estWebmail, repondreAHumain } from './notification.ts';

/*
 * Le vrai client derrière un formulaire de contact.
 *
 * Un message laissé sur le formulaire de la boutique n'arrive pas de la
 * personne qui l'a écrit : Shopify l'envoie depuis `mailer@shopify.com`, au
 * nom de la boutique (« RunningUpscale.com (Shopify) »). Pris tel quel, ce
 * robot devenait le client : la réponse partait vers `mailer@shopify.com`,
 * que personne ne lit — le client ne la recevait jamais —, aucune commande ne
 * se retrouvait par son adresse, et tous ces messages se comptaient comme un
 * seul client revenu des dizaines de fois, ce que l'IA lisait aussi.
 *
 * Le client est pourtant là, deux fois : dans l'en-tête « Répondre à », que
 * Shopify remplit avec l'adresse saisie, et dans le corps du message, champ
 * par champ — un libellé seul sur sa ligne, sa valeur dessous :
 *
 *   Vous avez reçu un nouveau message du formulaire de contact de
 *   votre boutique en ligne.
 *
 *   Indicatif de pays:
 *   FR
 *
 *   Nom:
 *   Maxence Picard
 *
 *   E-mail:
 *   …
 *
 * Les libellés suivent le thème et la langue de la boutique — « Nom » ou
 * « Name », « E-mail » ou « Adresse e-mail », « Corps », « message » — d'où
 * des familles de libellés plutôt qu'une liste exacte.
 */

export interface ChampsFormulaire {
  email: string | null;
  nom: string | null;
  /** Ce que le client a écrit, sans l'habillage de Shopify. */
  message: string | null;
  telephone: string | null;
  pays: string | null;
}

export interface VraiClient {
  email: string;
  nom: string | null;
  /** Les mots du client, quand le message est un formulaire lisible. */
  message: string | null;
  /** Le message est un formulaire de contact : jamais une notification. */
  formulaire: boolean;
}

const sansAccents = (texte: string) => texte.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** `Adresse e-mail*` → `adresse e-mail` : la clé sur laquelle on reconnaît un libellé. */
const cleDe = (libelle: string) =>
  sansAccents(libelle).toLowerCase().replace(/[*_]/g, ' ').replace(/\s+/g, ' ').trim();

const LIBELLES = {
  email:
    /^(?:votre |your |l'|adresse |address )?(?:e-?mail|courriel|mail)(?: address| adresse)?$|^e-?mail-?adresse$|^correo(?: electronico)?$|^indirizzo e-?mail$/,
  nom: /^(?:votre |your )?(?:nom|name|nom complet|full name|nombre|nome|naam|nom et prenom|prenom et nom|nom prenom|prenom nom|vor- und nachname)$/,
  prenom: /^(?:votre |your )?(?:prenom|first ?name|vorname)$/,
  nomFamille: /^(?:nom de famille|last ?name|surname|nachname|apellidos?|cognome|achternaam)$/,
  message:
    /^(?:votre |your )?(?:message|messages|corps|body|commentaires?|comments?|mensaje|messaggio|nachricht|bericht|question|demande|texte|contenu)$/,
  telephone: /^(?:(?:numero de |votre )?telephone|phone(?: number)?|tel|telefono|telefon|mobile|portable)$/,
  pays: /^(?:country(?: code)?|indicatif de pays|pays|code pays|pais|land)$/,
} as const;

const libelleConnu = (cle: string) => Object.values(LIBELLES).some((motif) => motif.test(cle));

/** `Libellé:` seul sur sa ligne, ou `Libellé : valeur`. */
const LIGNE_LIBELLE = /^\s*([\p{L}][\p{L}\p{N} '’.\-_/()*]{0,40}?)\s*:\s*(.*)$/u;

const ADRESSE = /[^\s<>()"'@,;:]+@[^\s<>()"'@,;:]+\.[a-z]{2,}/i;

/**
 * Les champs d'un formulaire de contact, lus dans le texte du message.
 *
 * Un libellé ouvre un champ quand on le reconnaît, ou quand il est seul sur
 * sa ligne après une ligne vide — c'est ainsi que Shopify sépare les champs
 * qu'un thème a ajoutés (« Numéro de commande: »). Dans le message lui-même,
 * seul un libellé reconnu après une ligne vide ouvre un nouveau champ : « Voici
 * ma demande : » reste dans ce que le client a écrit.
 */
export function lireFormulaire(texte: string): ChampsFormulaire | null {
  const champs: Array<{ cle: string; lignes: string[] }> = [];
  let courant: { cle: string; lignes: string[] } | null = null;
  let precedenteVide = true;

  for (const brute of texte.replace(/\r\n?/g, '\n').split('\n')) {
    const ligne = brute.trimEnd();
    const trouve = ligne.match(LIGNE_LIBELLE);
    const cle = trouve ? cleDe(trouve[1]!) : null;
    const connu = cle !== null && libelleConnu(cle);
    const dansLeMessage = courant !== null && LIBELLES.message.test(courant.cle);
    const ouvre =
      trouve !== null &&
      cle !== null &&
      (dansLeMessage ? connu && precedenteVide : connu || (precedenteVide && trouve[2] === ''));

    if (ouvre) {
      courant = { cle: cle!, lignes: trouve![2] ? [trouve![2]] : [] };
      champs.push(courant);
    } else if (courant) {
      courant.lignes.push(ligne);
    }
    precedenteVide = ligne.trim() === '';
  }

  const valeur = (motif: RegExp): string | null => {
    const champ = champs.find((c) => motif.test(c.cle));
    const texteChamp = champ?.lignes.join('\n').trim();
    return texteChamp ? texteChamp : null;
  };
  const uneLigne = (texteChamp: string | null) => texteChamp?.replace(/\s+/g, ' ').trim().slice(0, 120) || null;

  const email = valeur(LIBELLES.email)?.match(ADRESSE)?.[0]?.toLowerCase() ?? null;
  const prenom = uneLigne(valeur(LIBELLES.prenom));
  const famille = uneLigne(valeur(LIBELLES.nomFamille)) ?? uneLigne(valeur(LIBELLES.nom));
  let nom = prenom && famille ? `${prenom} ${famille}` : (famille ?? prenom);
  // Une adresse tapée dans la case du nom n'est pas un nom.
  if (nom && ADRESSE.test(nom)) nom = null;
  const message = valeur(LIBELLES.message);

  if (!email && !nom && !message) return null;
  return {
    email,
    nom,
    message,
    telephone: uneLigne(valeur(LIBELLES.telephone)),
    pays: uneLigne(valeur(LIBELLES.pays)),
  };
}

/** Ce que Shopify écrit en tête d'un formulaire de contact, dans les langues des boutiques. */
const AMORCE_FORMULAIRE =
  /formulaire de contact|contact form|formulario de contacto|kontaktformular|modulo di contatto|contactformulier|formul[aá]rio de contato/i;

/**
 * L'objet daté que Shopify donne à un formulaire de contact : « Nouveau
 * message de client le 22 novembre 2026 à 11:57 », « Nouveau message client
 * du 23 janvier 2024 à 10:22 », « New customer message on… ».
 */
export const OBJET_FORMULAIRE =
  /^(?:nouveau message (?:de )?client|new customer message|nuevo mensaje (?:de |del )?cliente|neue kundennachricht|nuovo messaggio (?:del |di )?cliente|nieuw klantbericht)\b/i;

export function ressembleAUnFormulaire(mail: { subject?: string | null; bodyText?: string | null }): boolean {
  return OBJET_FORMULAIRE.test((mail.subject ?? '').trim()) || AMORCE_FORMULAIRE.test((mail.bodyText ?? '').slice(0, 800));
}

const domaine = (email: string) => email.slice(email.lastIndexOf('@') + 1).toLowerCase();

/** L'adresse de la boutique elle-même, ou une autre de son domaine. */
function deLaBoutique(adresse: string, boite: string | null | undefined): boolean {
  if (!boite) return false;
  const a = adresse.toLowerCase();
  const b = boite.toLowerCase();
  return a === b || (!estWebmail(a) && domaine(a) === domaine(b));
}

/**
 * Le client réel d'un mail envoyé par un robot ou une appli, ou `null`.
 *
 * Ne touche jamais un mail écrit par une personne : un client qui écrit depuis
 * son adresse en reste le client, même si son « Répondre à » en donne une
 * autre. Pour un robot, « Répondre à » d'abord — c'est là que Gmail lui-même
 * répondrait —, puis l'adresse saisie dans le formulaire. L'adresse de la
 * boutique n'est jamais retenue : répondre à soi-même ne prévient personne.
 */
export function vraiClient(mail: {
  fromEmail: string;
  toEmail?: string | null;
  replyTo?: string | null;
  replyToName?: string | null;
  subject?: string | null;
  bodyText?: string | null;
}): VraiClient | null {
  if (!mail.fromEmail || !adresseAutomatique(mail.fromEmail)) return null;

  const champs = ressembleAUnFormulaire(mail) ? lireFormulaire(mail.bodyText ?? '') : null;
  const repondreA = repondreAHumain(mail);
  const candidats = [repondreA, champs?.email].filter(
    (adresse): adresse is string => Boolean(adresse) && !deLaBoutique(adresse!, mail.toEmail),
  );
  const email = candidats[0];
  if (!email) return null;

  return {
    email,
    nom: champs?.nom ?? (mail.replyToName?.trim() || null),
    message: champs?.message ?? null,
    formulaire: champs !== null,
  };
}

/** Les premiers mots du client, pour l'aperçu de la file — pas le préambule de Shopify. */
export function apercuDuMessage(message: string): string {
  const texte = message.replace(/\s+/g, ' ').trim();
  return texte.length > 200 ? `${texte.slice(0, 199)}…` : texte;
}

/**
 * Un destinataire qui ne lira jamais : l'expéditeur d'un formulaire, une
 * adresse « ne pas répondre ». Une réponse qui y part est perdue sans bruit.
 */
export function destinataireRobot(email: string | null | undefined): boolean {
  const adresse = (email ?? '').trim().toLowerCase();
  if (!adresse.includes('@')) return false;
  if (/^(?:mailer|no-?reply|do-?not-?reply|ne-?pas-?repondre|nepasrepondre|mailer-daemon|postmaster)@/.test(adresse)) {
    return true;
  }
  return ['shopify.com', 'shopifyemail.com'].includes(domaine(adresse));
}
