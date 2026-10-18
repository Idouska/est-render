/**
 * Le texte du mail « Rupture de stock », sans base ni réseau : se teste seul.
 * L'envoi, lui, vit dans `mailClient.ts`.
 */

/** Le titre de la réponse type qui remplace le texte par défaut. */
export const TITRE_REPONSE_TYPE = 'Rupture de stock';

export const MODELE_RUPTURE = {
  sujet: 'Votre commande {{commande}} : un article en rupture',
  corps: [
    'Bonjour {{prenom}},',
    '',
    'Votre commande {{commande}} contient l’article {{article}}, momentanément en rupture chez notre atelier. {{delai}}',
    '',
    'Si vous préférez, nous pouvons vous proposer un autre modèle ou vous rembourser : il suffit de répondre à ce mail.',
    '',
    'L’équipe {{boutique}}',
  ].join('\n'),
};

export interface ValeursMail {
  prenom: string | null;
  commande: string | null;
  article: string | null;
  boutique: string;
  /** Le délai annoncé par l'atelier, en jours, s'il en a donné un. */
  jours: number | null;
}

/** Le délai que l'atelier a écrit : « réassort dans 10 jours », « sous 2 semaines ». */
export function delaiAnnonce(texte: string | null | undefined): number | null {
  const jours = /(\d{1,3})\s*(?:jours?|j\b)/i.exec(texte ?? '');
  if (jours) return Number(jours[1]);
  const semaines = /(\d{1,2})\s*semaines?/i.exec(texte ?? '');
  if (semaines) return Number(semaines[1]) * 7;
  if (/\b1\s*mois\b|un mois/i.test(texte ?? '')) return 30;
  return null;
}

/** Remplit un modèle. Une variable sans valeur ne reste jamais « {{…}} » dans le mail. */
export function remplirMail(modele: string, valeurs: ValeursMail): string {
  const delai = valeurs.jours
    ? `Le réassort est prévu sous ${valeurs.jours} jours : nous vous l’expédierons dès son arrivée.`
    : 'Nous revenons vers vous dès son retour en stock.';
  return modele
    .replaceAll('{{prenom}}', valeurs.prenom ?? '')
    .replaceAll('{{commande}}', valeurs.commande ?? '')
    .replaceAll('{{article}}', valeurs.article ?? '')
    .replaceAll('{{boutique}}', valeurs.boutique)
    .replaceAll('{{delai}}', delai)
    .replaceAll('{{suivi}}', '')
    // « Bonjour ," quand le prénom manque : on retire l'espace orpheline.
    .replace(/Bonjour ,/g, 'Bonjour,')
    .replace(/[ \t]+\n/g, '\n');
}
