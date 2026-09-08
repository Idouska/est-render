import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * La composition d'un numéro WhatsApp, éprouvée sur des exemples réels.
 *
 * `public/app.js` est un module de navigateur : il touche au DOM dès son
 * chargement et ne s'importe pas dans Node. On en extrait donc les deux
 * morceaux qui nous intéressent — la table des indicatifs et la fonction qui
 * s'en sert — et on les évalue seuls. Le test porte ainsi sur le code
 * réellement servi, pas sur une copie qui divergerait au premier correctif.
 *
 * CE QUE CE TEST PROTÈGE. Un indicatif faux ne casse rien : il produit un
 * numéro plausible. Le marchand ouvre alors une conversation WhatsApp avec un
 * inconnu, depuis son compte, à propos de la commande d'un client. Le préfixe
 * national est le champ le plus exposé : noté « 0 » pour un pays qui n'en a
 * pas, il mange le premier chiffre ; noté vide pour un pays qui en a un, il
 * laisse un zéro parasite. Chaque pays de la table doit donc passer son propre
 * exemple.
 */

const APP = fileURLToPath(new URL('../public/app.js', import.meta.url));

function extraire(source: string, debut: string, fin: string): string {
  const i = source.indexOf(debut);
  assert.ok(i >= 0, `introuvable dans public/app.js : ${debut}`);
  const j = source.indexOf(fin, i);
  assert.ok(j >= 0, `fin introuvable après ${debut}`);
  return source.slice(i, j + fin.length);
}

type Table = Record<string, { dial: string; trunk: string }>;
type Composer = (raw: string, pays: string | null | undefined) => string | null;

const source = readFileSync(APP, 'utf8');
const { DIAL_CODES, whatsappNumber } = new Function(
  `${extraire(source, 'const DIAL_CODES', '\n};')}
   ${extraire(source, 'function whatsappNumber', '\n}')}
   return { DIAL_CODES, whatsappNumber };`,
)() as { DIAL_CODES: Table; whatsappNumber: Composer };

/*
 * Un numéro national, et le même en E.164 sans le « + ».
 *
 * Les numéros sont pris dans les plages que les régulateurs réservent à la
 * fiction quand ils en publient une — 07700 900xxx pour l'Ofcom britannique,
 * 555-01xx pour l'Amérique du Nord — sinon dans une plage mobile valide, sous
 * une forme qui n'est attribuée à personne.
 */
const EXEMPLES: Array<[iso: string, national: string, e164: string, quoi: string]> = [
  ['AD', '612 345', '376612345', 'Numéros à 6 chiffres, aucun préfixe national'],
  ['AE', '050 123 4567', '971501234567', 'UIT : préfixe 0, NSN 8-9'],
  ['AG', '268 555 0100', '12685550100', 'NPA unique 268 (depuis 1996)'],
  ['AI', '264 555 0100', '12645550100', 'NPA unique 264 (depuis 1996)'],
  ['AL', '069 123 4567', '355691234567', 'Mobiles en 067, 068, 069'],
  ['AO', '923 123 456', '244923123456', 'NSN de 9 chiffres composés intégralement, sans préfixe national ; les'],
  ['AS', '684 555 0123', '16845550123', 'Territoire NANP'],
  ['AT', '0664 123456', '43664123456', 'Longueur NON fixe : ni les indicatifs ni les numéros d\'abonné n\'ont de'],
  ['AU', '0491 570 156', '61491570156', 'Préfixe national 0'],
  ['AX', '040 123 4567', '358401234567', 'AX est un code ISO 3166-1 alpha-2 valide que Shopify peut livrer'],
  ['BA', '061 123 456', '38761123456', 'Mobiles sur les codes 60 à 67'],
  ['BB', '246 555 0100', '12465550100', 'NPA unique 246 (depuis 1995)'],
  ['BD', '01712 345678', '8801712345678', 'Préfixe national 0, plan fermé'],
  ['BE', '0470 12 34 56', '32470123456', 'Tous les mobiles en 04xx, 10 chiffres avec le 0'],
  ['BF', '60 12 34 56', '22660123456', 'Pas de préfixe national, NSN 8 chiffres'],
  ['BG', '088 123 4567', '359881234567', 'Mobiles en 087 (Vivacom), 088 (A1), 089 (Yettel), 098 (MVNO)'],
  ['BH', '3312 3456', '97333123456', 'Pas de préfixe national ni d\'indicatif de zone, NSN 8 chiffres'],
  ['BI', '79 12 34 56', '25779123456', 'Pas de préfixe national, NSN 8 chiffres'],
  ['BJ', '01 96 12 34 56', '2290196123456', 'PIÈGE MAJEUR'],
  ['BM', '441 555 0100', '14415550100', 'NPA unique 441 (depuis 1994), le premier détachement caribéen du 809 h'],
  ['BO', '71234567', '59171234567', 'Plan fermé à 8 chiffres depuis 2001, administré par l\'ATT'],
  ['BR', '011 91234-5678', '5511912345678', 'ANATEL (via UIT) : « mobile numbers will have the following format: +5'],
  ['BS', '242 555 0100', '12425550100', 'NPA unique 242 (depuis 1995)'],
  ['BW', '71 123 456', '26771123456', 'Pas de préfixe national ni d\'indicatif de zone'],
  ['BZ', '620 1234', '5016201234', 'Le Belize est en Amérique centrale mais N\'EST PAS dans le NANP : il a'],
  ['CA', '416 555 0100', '14165550100', 'Une quarantaine de NPA (416 = Toronto)'],
  ['CD', '0820 123 456', '243820123456', 'UIT : préfixe national 0'],
  ['CG', '06 100 12 34', '242061001234', 'PIÈGE MAJEUR, et à ne pas confondre avec la RD Congo (+243) qui suit l'],
  ['CH', '079 123 45 67', '41791234567', 'Format fixe à 10 chiffres, 0 compris'],
  ['CI', '07 07 12 34 56', '2250707123456', 'PIÈGE MAJEUR'],
  ['CL', '9 1234 5678', '56912345678', 'Subtel (via UIT, 8'],
  ['CM', '6 70 12 34 56', '237670123456', 'Pas de préfixe national'],
  ['CN', '138 1234 5678', '8613812345678', 'Le préfixe national 0 ne sert qu\'aux indicatifs de zone des fixes'],
  ['CO', '300 123 4567', '573001234567', 'Résolution CRC 5826 de 2019, pleinement en vigueur depuis le 1er mars'],
  ['CR', '8123 4567', '50681234567', 'SUTEL via UIT (16'],
  ['CV', '991 22 33', '2389912233', 'Pas de préfixe national, NSN 7 chiffres'],
  ['CY', '96 123456', '35796123456', 'AUCUN préfixe national'],
  ['CZ', '601 123 456', '420601123456', 'AUCUN préfixe national — absent de la liste du brief'],
  ['DE', '0171 392 0000', '491713920000', 'Exemple pris dans la plage « Drama Numbers » de la Bundesnetzagentur ('],
  ['DJ', '77 12 34 56', '25377123456', 'Pas de préfixe national (case vide chez l\'UIT)'],
  ['DK', '20 12 34 56', '4520123456', 'AUCUN préfixe national'],
  ['DM', '767 555 0100', '17675550100', 'NPA unique 767 (depuis 1996)'],
  ['DO', '809 555 0100', '18095550100', 'TROIS NPA en superposition : 809 (1958, l\'ancien code de toutes les Ca'],
  ['DZ', '0551 23 45 67', '213551234567', 'UIT : préfixe 0, NSN 8-9 chiffres'],
  ['EC', '096 123 4567', '593961234567', 'CONATEL via UIT : le numéro mobile international équatorien est « 593'],
  ['EE', '5123 4567', '37251234567', 'AUCUN préfixe national — absent de la liste du brief'],
  ['EG', '0100 123 4567', '201001234567', 'Préfixe 0 confirmé par l\'UIT'],
  ['ER', '07 123 456', '2917123456', 'UIT : préfixe 0, NSN 7 chiffres seulement'],
  ['ES', '612 345 678', '34612345678', 'AUCUN préfixe national : l\'ancien préfixe « 9 » a été intégré au numér'],
  ['ET', '0911 123 456', '251911123456', 'UIT : préfixe 0, NSN 9'],
  ['FI', '040 123 4567', '358401234567', 'CORRECTION DU BRIEF : la Finlande A un préfixe national, « 0 » (passé'],
  ['FJ', '701 2345', '6797012345', 'La source dit explicitement : « Fiji has no area codes and no leading'],
  ['FO', '21 12 34', '298211234', 'AUCUN préfixe national'],
  ['FR', '06 39 98 12 34', '33639981234', 'Exemple pris dans la plage 06 39 98 réservée par l\'Arcep aux œuvres au'],
  ['GA', '066 11 11 11', '24166111111', 'Le 0 SE RETIRE, contrairement à ce que laisse croire Wikipédia'],
  ['GB', '07700 900123', '447700900123', 'Exemple pris dans la plage 07700 900000 à 07700 900999 réservée par Of'],
  ['GD', '473 555 0100', '14735550100', 'NPA unique 473 (depuis 1996)'],
  ['GF', '0694 12 34 56', '594694123456', 'Département français, plan de numérotation français : préfixe national'],
  ['GG', '07781 123456', '447781123456', 'Shopify livre l\'iso2 GG, distinct de GB'],
  ['GH', '024 123 4567', '233241234567', 'UIT : préfixe 0'],
  ['GI', '5612 3456', '35056123456', 'Source régulateur (GRA, plan mis à jour mars 2024)'],
  ['GL', '22 12 34', '299221234', 'AUCUN préfixe national'],
  ['GM', '701 2345', '2207012345', 'Pas de préfixe national, NSN 7 chiffres seulement — le plus court de l'],
  ['GN', '620 12 34 56', '224620123456', 'Pas de préfixe national'],
  ['GQ', '222 12 34 56', '240222123456', 'Pas de préfixe national, NSN 9 chiffres'],
  ['GR', '691 234 5678', '306912345678', 'AUCUN préfixe national — absent de la liste du brief'],
  ['GT', '5123 4567', '50251234567', 'Plan fermé à 8 chiffres, sans indicatif de zone et sans préfixe nation'],
  ['GU', '671 555 0123', '16715550123', 'Territoire NANP dans le Pacifique'],
  ['GY', '609 1234', '5926091234', 'Telecommunications Agency via UIT (22'],
  ['HK', '9123 4567', '85291234567', 'AUCUN préfixe national et aucun indicatif de zone depuis fin 1989'],
  ['HN', '9123 4567', '50491234567', 'CONATEL via UIT : mobiles à 8 chiffres depuis le 25 février 2007, form'],
  ['HR', '091 234 5678', '385912345678', 'Mobiles en 091, 092, 095, 097, 098, 099'],
  ['HU', '06 20 123 4567', '36201234567', 'PIÈGE MAJEUR : le préfixe national fait DEUX chiffres, « 06 », et non'],
  ['ID', '0812 3456 7890', '6281234567890', 'Préfixe national 0'],
  ['IE', '089 011 0123', '353890110123', 'Exemple pris dans la plage mobile 089 011 0xxx réservée par ComReg à l'],
  ['IL', '054 123 4567', '972541234567', 'UIT : préfixe national 0, NSN 8-9'],
  ['IM', '07624 123456', '447624123456', 'Shopify livre l\'iso2 IM, distinct de GB'],
  ['IN', '098765 43210', '919876543210', 'Plan fermé : le NSN fait toujours exactement 10 chiffres'],
  ['IQ', '0770 123 4567', '9647701234567', 'UIT : préfixe 0, 8 à 10 chiffres'],
  ['IR', '0912 345 6789', '989123456789', 'UIT : préfixe 0'],
  ['IS', '611 2345', '3546112345', 'AUCUN préfixe national'],
  ['IT', '333 123 4567', '393331234567', 'AUCUN préfixe national depuis 1998 : le 0 de tête des FIXES fait parti'],
  ['JE', '07797 123456', '447797123456', 'Shopify livre l\'iso2 JE, distinct de GB'],
  ['JM', '876 555 0100', '18765550100', 'DEUX NPA en superposition : 876 (1996) et 658 (2018)'],
  ['JO', '079 123 4567', '962791234567', 'UIT : préfixe 0'],
  ['JP', '090 1234 5678', '819012345678', 'Préfixe national 0'],
  ['KE', '0722 123 456', '254722123456', 'UIT : préfixe 0'],
  ['KH', '012 345 678', '85512345678', 'Préfixe national 0'],
  ['KN', '869 555 0100', '18695550100', 'NPA unique 869 (depuis 1996)'],
  ['KR', '010 1234 5678', '821012345678', 'Préfixe national 0'],
  ['KW', '5012 3456', '96550123456', 'Pas de préfixe national, NSN 8 chiffres depuis le 17'],
  ['KY', '345 555 0100', '13455550100', 'NPA unique 345 (depuis 1996)'],
  ['KZ', '8 701 234 5678', '77012345678', 'DOUBLE PIÈGE'],
  ['LB', '71 123 456', '96171123456', 'Préfixe national 0, mais LONGUEUR VARIABLE : l\'UIT donne 7 à 8 chiffre'],
  ['LC', '758 555 0100', '17585550100', 'NPA unique 758 (depuis 1996)'],
  ['LI', '791 23 45', '4237912345', 'AUCUN préfixe national'],
  ['LK', '071 234 5678', '94712345678', 'Préfixe national 0'],
  ['LR', '0770 123 456', '231770123456', 'NSN mobile de 9 chiffres (55x, 77x, 88x)'],
  ['LS', '5812 3456', '26658123456', 'Pas de préfixe national, NSN 8 chiffres'],
  ['LU', '621 123 456', '352621123456', 'AUCUN préfixe national — absent de la liste du brief'],
  ['LV', '21 234 567', '37121234567', 'AUCUN préfixe national — absent de la liste du brief'],
  ['LY', '091 234 5678', '218912345678', 'UIT : préfixe 0, NSN 8-9'],
  ['MA', '0612 34 56 78', '212612345678', 'UIT : préfixe national 0, NSN 9 chiffres'],
  ['MC', '46 12 34 56', '37746123456', 'AUCUN préfixe national, plan fermé à 8 chiffres, indicatif propre +377'],
  ['MD', '069 123 456', '37369123456', 'Plan fermé, NSN de 8 chiffres'],
  ['ME', '067 123 456', '38267123456', 'Mobiles sur les codes 60, 63, 66, 67, 68, 69'],
  ['MG', '032 12 345 67', '261321234567', 'NSN de 9 chiffres, mobiles en 32 (Orange), 33 (Airtel), 34/38 (Telma)'],
  ['MK', '070 123 456', '38970123456', 'Mobiles en 070 à 079'],
  ['ML', '65 12 34 56', '22365123456', 'Pas de préfixe national, 8 chiffres, pas d\'indicatif de zone'],
  ['MP', '670 555 0100', '16705550100', 'NPA unique 670'],
  ['MR', '44 12 34 56', '22244123456', 'Pas de préfixe national (case vide chez l\'UIT)'],
  ['MS', '664 555 0100', '16645550100', 'NPA unique 664 (depuis 1996)'],
  ['MT', '9912 3456', '35699123456', 'AUCUN préfixe national'],
  ['MU', '5251 2345', '23052512345', 'Pas de préfixe national'],
  ['MW', '0888 123 456', '265888123456', 'NSN de 9 chiffres, mobiles en 88x (TNM) et 98x/99x (Airtel), le 0 se r'],
  ['MX', '55 1234 5678', '525512345678', 'Depuis le 3 août 2019, marquage uniforme à 10 chiffres ; l\'IFT a suppr'],
  ['MY', '012 345 6789', '60123456789', 'Préfixe national 0'],
  ['MZ', '84 123 4567', '258841234567', 'PAS de préfixe national'],
  ['NA', '081 123 4567', '264811234567', 'UIT : préfixe 0'],
  ['NE', '96 12 34 56', '22796123456', 'Pas de préfixe national, NSN 8 chiffres depuis la refonte de 2006'],
  ['NG', '0803 123 4567', '2348031234567', 'Préfixe 0 confirmé par l\'UIT'],
  ['NI', '8123 4567', '50581234567', 'Plan fermé à 8 chiffres depuis 2009, sans indicatif de zone ni préfixe'],
  ['NL', '06 12345678', '31612345678', 'Tous les mobiles en 06 suivi de 8 chiffres'],
  ['NO', '406 12 345', '4740612345', 'AUCUN préfixe national depuis le plan fermé de 1993'],
  ['NZ', '021 123 4567', '64211234567', 'Préfixe national 0'],
  ['OM', '9212 3456', '96892123456', 'Pas de préfixe national, NSN 8 chiffres'],
  ['PA', '6123 4567', '50761234567', 'Pas d\'indicatif de zone ni de préfixe national'],
  ['PE', '912 345 678', '51912345678', 'Le préfixe national 0 existe et sert devant l\'indicatif de département'],
  ['PG', '7012 3456', '67570123456', 'AUCUN préfixe national'],
  ['PH', '0917 123 4567', '639171234567', 'Préfixe national 0'],
  ['PK', '0301 2345678', '923012345678', 'Préfixe national 0'],
  ['PL', '512 345 678', '48512345678', 'AUCUN préfixe national — absent de la liste du brief'],
  ['PR', '787 555 0100', '17875550100', 'DEUX NPA en superposition : 787 (1995) et 939 (2000)'],
  ['PS', '0599 123 456', '970599123456', 'Préfixe national 0, NSN 9 chiffres pour les mobiles (059x Jawwal, 056x'],
  ['PT', '912 345 678', '351912345678', 'AUCUN préfixe national : le « 0 » a disparu avec le passage au plan fe'],
  ['PY', '0981 234567', '595981234567', 'CONATEL via UIT (17'],
  ['QA', '3312 3456', '97433123456', 'Pas de préfixe national, NSN 8 chiffres depuis le plan de 2010'],
  ['RO', '0721 234 567', '40721234567', 'Le 0 est bien un préfixe national à retirer, pas une partie du numéro'],
  ['RS', '064 123 4567', '381641234567', 'Mobiles sur les codes 60 à 69'],
  ['RU', '8 912 345 67 89', '79123456789', 'Le préfixe national est « 8 », PAS « 0 »'],
  ['RW', '0788 123 456', '250788123456', 'NSN 9 chiffres, mobiles en 72/73 (Airtel) et 78 (MTN)'],
  ['SA', '050 123 4567', '966501234567', 'UIT : préfixe national 0, NSN 8-9'],
  ['SC', '251 23 45', '2482512345', 'Pas de préfixe national, NSN 7 chiffres'],
  ['SD', '0912 345 678', '249912345678', 'UIT : préfixe 0, NSN 9'],
  ['SE', '070 174 06 05', '46701740605', 'Exemple pris dans la plage mobile 070 174 06 05 à 070 174 06 99 réserv'],
  ['SG', '9123 4567', '6591234567', 'AUCUN préfixe national (le 0 via la Malaisie a disparu en 1995)'],
  ['SI', '031 123 456', '38631123456', '9 chiffres au total, préfixe 0 inclus'],
  ['SJ', '406 12 345', '4740612345', 'SJ est un code ISO 3166-1 alpha-2 valide que Shopify peut livrer'],
  ['SK', '0901 123 456', '421901123456', 'Contrairement à la Tchéquie voisine, la Slovaquie A conservé le préfix'],
  ['SL', '076 123 456', '23276123456', 'UIT : préfixe national 0, NSN 8 chiffres'],
  ['SM', '66 12 34 56', '37866123456', 'AUCUN préfixe national : tous les chiffres sont toujours composés'],
  ['SN', '77 123 45 67', '221771234567', 'PAS de préfixe national, NSN 9 chiffres'],
  ['SR', '711 2345', '5977112345', 'TAS via UIT (8'],
  ['SV', '7123 4567', '50371234567', 'SIGET via UIT : plan à 8 chiffres incluant le NDC, sans préfixe nation'],
  ['SX', '721 555 0100', '17215550100', 'NPA unique 721, en service depuis le 30/09/2011, obligatoire depuis le'],
  ['SY', '0932 123 456', '963932123456', 'UIT : préfixe 0'],
  ['SZ', '7612 3456', '26876123456', 'Pas de préfixe national, NSN 8 chiffres'],
  ['TC', '649 555 0100', '16495550100', 'NPA unique 649 (depuis 1997)'],
  ['TD', '66 12 34 56', '23566123456', 'Pas de préfixe national, NSN 8 chiffres'],
  ['TG', '90 12 34 56', '22890123456', 'Pas de préfixe national, NSN 8 chiffres'],
  ['TH', '081 234 5678', '66812345678', 'Préfixe national 0, obligatoire même en local (plan fermé)'],
  ['TN', '20 123 456', '21620123456', 'PAS de préfixe national (case vide chez l\'UIT), 8 chiffres'],
  ['TR', '0532 123 45 67', '905321234567', 'UIT : préfixe 0, NSN 10 chiffres exactement'],
  ['TT', '868 555 0100', '18685550100', 'NPA unique 868 (depuis 1996)'],
  ['TW', '0912 345 678', '886912345678', 'Préfixe national 0'],
  ['TZ', '0754 123 456', '255754123456', 'UIT : préfixe 0, NSN 9'],
  ['UA', '067 123 4567', '380671234567', 'Le préfixe est « 0 » depuis l\'alignement européen de 2009 ; il était «'],
  ['UG', '0772 123 456', '256772123456', 'UIT : préfixe 0, NSN 9'],
  ['US', '202 555 0100', '12025550100', 'Des centaines de NPA géographiques (202 = Washington DC)'],
  ['UY', '099 123 456', '59899123456', 'PIÈGE D\'ÉCRITURE'],
  ['UZ', '90 123 45 67', '998901234567', 'AUCUN préfixe national aujourd\'hui (l\'ancien 8~10 a été remplacé par 0'],
  ['VC', '784 555 0100', '17845550100', 'NPA unique 784 (depuis 1997)'],
  ['VE', '0412-1234567', '584121234567', 'CONATEL via UIT (7'],
  ['VG', '284 555 0100', '12845550100', 'NPA unique 284 (depuis 1996)'],
  ['VI', '340 555 0100', '13405550100', 'NPA unique 340 (depuis 1997)'],
  ['VN', '091 234 5678', '84912345678', 'Préfixe national 0'],
  ['XK', '044 123 456', '38344123456', 'XK n\'est pas un code ISO 3166-1 officiel mais un code d\'usage que Shop'],
  ['ZA', '082 123 4567', '27821234567', 'UIT : préfixe 0, NSN 9 chiffres'],
  ['ZM', '0977 123 456', '260977123456', 'UIT : préfixe 0, NSN 9'],
  ['ZW', '0772 123 456', '263772123456', 'UIT : préfixe 0'],
];

test('chaque pays de la table compose son propre exemple', () => {
  for (const [iso, national, attendu, quoi] of EXEMPLES) {
    assert.ok(DIAL_CODES[iso], `${iso} absent de DIAL_CODES`);
    assert.equal(whatsappNumber(national, iso), attendu, `${iso} — ${quoi}`);
  }
});

test('chaque entrée de la table a un exemple qui la couvre', () => {
  const couverts = new Set(EXEMPLES.map(([iso]) => iso));
  const orphelins = Object.keys(DIAL_CODES).filter((iso) => !couverts.has(iso));
  assert.deepEqual(
    orphelins,
    [],
    `pays sans exemple : ${orphelins.join(', ')} — une entrée non éprouvée est une entrée non vérifiée`,
  );
});

test('en Amérique du Nord, le 1 en tête ne se double pas', () => {
  // Les clients écrivent leur numéro des deux façons. Préfixer sans regarder
  // donnait un numéro à douze chiffres, plausible, et qui n'est celui de
  // personne — le pire cas : pas une erreur, un inconnu.
  assert.equal(whatsappNumber('4783490262', 'US'), '14783490262');
  assert.equal(whatsappNumber('1 478 349 0262', 'US'), '14783490262');
  assert.equal(whatsappNumber('(478) 349-0262', 'US'), '14783490262');
  assert.equal(whatsappNumber('+1 478 349 0262', 'US'), '14783490262');

  // Un indicatif régional ne commence jamais par 0 ni par 1 : ce qui n'a pas
  // la bonne forme est refusé plutôt que complété.
  assert.equal(whatsappNumber('0783490262', 'US'), null);
  assert.equal(whatsappNumber('478349026', 'US'), null);
  assert.equal(whatsappNumber('147834902621', 'US'), null);
});

test('un numéro déjà international passe sans connaître le pays', () => {
  // C'est le seul chemin qui fonctionne aujourd'hui hors des pays connus, et
  // il explique pourquoi le même client est joignable ou non selon la façon
  // dont son numéro a été saisi dans Shopify.
  assert.equal(whatsappNumber('+1 478 349 0262', 'US'), '14783490262');
  assert.equal(whatsappNumber('001 478 349 0262', 'US'), '14783490262');
});

test('un pays inconnu refuse de composer plutôt que de deviner', () => {
  // Refuser est le bon réflexe : préfixer au hasard ouvrirait une conversation
  // avec un inconnu. C'est le message affiché qui doit dire la vérité, pas la
  // prudence qui doit céder.
  assert.equal(whatsappNumber('4783490262', 'ZZ'), null);
  assert.equal(whatsappNumber('0612345678', null), null);
});

test('ce qui n’est pas un numéro ne devient pas un numéro', () => {
  assert.equal(whatsappNumber('', 'FR'), null);
  assert.equal(whatsappNumber('   ', 'FR'), null);
  assert.equal(whatsappNumber('12', 'FR'), null);
  assert.equal(whatsappNumber('abc', 'FR'), null);
});
