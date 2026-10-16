/**
 * Vérifications du numéro et de l'adresse d'une commande, pour la fenêtre
 * « Signaler un problème ».
 *
 * Des repères, pas un verdict : l'atelier voit le numéro et l'adresse tels
 * qu'ils sont écrits, et une pastille orange lui montre ce qui cloche
 * probablement. Les règles sont prudentes, parce qu'un faux avertissement
 * sur un client étranger ferait signaler une commande juste :
 *
 * - la longueur d'un numéro n'est contrôlée que pour les indicatifs où elle
 *   est fixe ; ailleurs, seul un numéro manifestement trop court (moins de
 *   huit chiffres) ou trop long (plus de quinze, la limite internationale)
 *   est signalé ;
 * - l'adresse : rue, numéro de rue, code postal et ville absents, et le
 *   format du code postal là où il est sans ambiguïté (France).
 *
 * Chaque avertissement est une clé de traduction et ses valeurs : le module
 * ne connaît pas la langue de l'écran.
 */

/*
 * Chiffres attendus après l'indicatif, pour les pays où la longueur est
 * fixe — du plus long indicatif au plus court, pour que « 351 » passe avant
 * « 3… ». Les pays à longueur variable (Allemagne, Italie, Autriche…) n'y
 * sont pas : on n'en dirait rien de sûr.
 */
const LONGUEURS = [
  ['351', 9, 9], // Portugal
  ['33', 9, 9], // France
  ['32', 8, 9], // Belgique
  ['41', 9, 9], // Suisse
  ['34', 9, 9], // Espagne
  ['31', 9, 9], // Pays-Bas
  ['44', 9, 10], // Royaume-Uni
  ['86', 10, 11], // Chine
  ['1', 10, 10], // États-Unis, Canada
];

/** Les pays qu'on reconnaît pour un numéro écrit sans indicatif. */
const FRANCE = /^(france|fr)$/i;

/**
 * @param {string | null | undefined} brut le numéro tel qu'il est écrit
 * @param {string | null | undefined} pays le pays de l'adresse de livraison
 * @returns {Array<{ cle: string, valeurs?: Record<string, string | number> }>}
 */
export function verifierTelephone(brut, pays) {
  const texte = (brut ?? '').trim();
  if (!texte) return [];

  let chiffres = texte.replace(/\D/g, '');
  const international = texte.startsWith('+') || chiffres.startsWith('00');
  if (chiffres.startsWith('00')) chiffres = chiffres.slice(2);

  if (international) {
    const regle = LONGUEURS.find(([indicatif]) => chiffres.startsWith(indicatif));
    if (regle) {
      const [indicatif, min, max] = regle;
      // Le zéro national recopié après l'indicatif (+33 0 6…) ne compte pas.
      const national = chiffres.slice(indicatif.length).replace(/^0/, '');
      if (national.length < min || national.length > max) {
        return [{ cle: 'issue.warn.phoneLen', valeurs: { n: national.length, attendu: min === max ? min : `${min}–${max}` } }];
      }
      return [];
    }
  } else if (FRANCE.test((pays ?? '').trim()) && chiffres.startsWith('0')) {
    // En France, sans indicatif : un zéro puis neuf chiffres.
    const national = chiffres.slice(1);
    if (national.length !== 9) {
      return [{ cle: 'issue.warn.phoneLen', valeurs: { n: national.length, attendu: 9 } }];
    }
    return [];
  }

  if (chiffres.length < 8) return [{ cle: 'issue.warn.phoneShort' }];
  if (chiffres.length > 15) return [{ cle: 'issue.warn.phoneLong' }];
  return [];
}

/* Pays sans code postal, ou où il reste facultatif : ne rien réclamer. */
const SANS_CODE_POSTAL = /^(hong kong|ireland|irlande|united arab emirates|émirats arabes unis|qatar|macau|macao)$/i;

/**
 * @param {{ address1?: string | null, address2?: string | null, zip?: string | null, city?: string | null, country?: string | null } | null | undefined} adresse
 * @returns {Array<{ cle: string, valeurs?: Record<string, string | number> }>}
 */
export function verifierAdresse(adresse) {
  if (!adresse) return [];
  const avertissements = [];
  const rue = [adresse.address1, adresse.address2].filter(Boolean).join(' ').trim();
  const pays = (adresse.country ?? '').trim();

  if (!rue) avertissements.push({ cle: 'issue.warn.noStreet' });
  // Un numéro n'importe où dans la rue ou son complément : « 12 rue… »,
  // « rue… 12 », « Bât. B, 4 allée… ». Sans aucun chiffre, il manque
  // probablement — un lieu-dit en est la rare exception, d'où un repère et
  // non un refus.
  else if (!/\d/.test(rue)) avertissements.push({ cle: 'issue.warn.noNumber' });

  const zip = (adresse.zip ?? '').trim();
  if (!zip) {
    if (!SANS_CODE_POSTAL.test(pays)) avertissements.push({ cle: 'issue.warn.noZip' });
  } else if (FRANCE.test(pays) && !/^\d{5}$/.test(zip.replace(/\s/g, ''))) {
    avertissements.push({ cle: 'issue.warn.zip' });
  }

  if (!(adresse.city ?? '').trim()) avertissements.push({ cle: 'issue.warn.noCity' });
  return avertissements;
}
