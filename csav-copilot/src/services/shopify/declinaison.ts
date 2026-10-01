/**
 * Couleur et taille d'une déclinaison Shopify.
 *
 * Shopify joint les options par une barre oblique ENTOURÉE d'espaces —
 * « Black / 45 1/3 ». C'est l'exigence d'espaces qui fait tout le travail :
 * la barre de « 45 1/3 » n'est pas un séparateur. Découper sur chaque barre
 * donnait « Taille : 45 1 » et « Couleur : 3 ».
 *
 * Même règle que l'espace atelier (`repartirDeclinaison` dans workspace.js) et
 * que la fenêtre « Contacter le fournisseur » (app.js) : un test vérifie que
 * les trois répondent pareil.
 */

/** Une pointure : « 42 », « 45 1/3 », « 38,5 », « 10.5 ». Pas « Black ». */
export function ressembleAUneTaille(valeur: string | null | undefined): boolean {
  return /^\d{1,2}([.,]\d)?(\s+\d\/\d)?$/.test((valeur ?? '').trim());
}

export function repartirDeclinaison(variante: string | null | undefined): { couleur: string; taille: string } {
  const texte = (variante ?? '').trim();
  if (!texte) return { couleur: '', taille: '' };

  const morceaux = texte.split(/\s+\/\s+/).map((morceau) => morceau.trim()).filter(Boolean);
  const taille = morceaux.find(ressembleAUneTaille);
  if (!taille) return { couleur: texte, taille: '' };

  return { couleur: morceaux.filter((morceau) => morceau !== taille).join(' / '), taille };
}
