/**
 * Ce que les moteurs de recherche ont le droit de garder.
 *
 * Deux pages seulement : la politique de confidentialité et les CGU, que
 * Google et Shopify vont lire à leurs adresses stables. Tout le reste est
 * privé — et une partie l'est par la seule URL : le lien de travail d'un
 * fournisseur (`/fournisseur/<jeton>`) ne périme pas. Recopié une fois dans un
 * document public, il serait exploré ; Googlebot exécute le JavaScript, il
 * indexerait les commandes et les adresses des clients affichées par l'atelier.
 *
 * D'où un `X-Robots-Tag: noindex` posé par défaut sur toutes les réponses, et
 * levé pour ces deux pages. Par défaut plutôt que page par page : une route
 * ajoutée demain est privée sans que personne ait à y penser.
 */
export const PAGES_PUBLIQUES = ['/privacy', '/terms'] as const;

export const NE_PAS_INDEXER = 'noindex, nofollow';

/** Le chemin seul : `/privacy?ref=x` reste la même page. */
export function estIndexable(url: string): boolean {
  const chemin = url.split(/[?#]/, 1)[0] ?? '';
  return (PAGES_PUBLIQUES as readonly string[]).includes(chemin);
}

const racine = (appUrl: string) => appUrl.replace(/\/+$/, '');

/**
 * L'application répond sous deux noms (`onrender.com` et le domaine propre) :
 * le canonique désigne celui d'`APP_URL`, pour que les deux copies d'une page
 * ne se fassent pas concurrence. En en-tête HTTP, faute de pouvoir l'écrire
 * dans un fichier HTML statique qui ignore l'adresse de déploiement.
 */
export function lienCanonique(appUrl: string, chemin: string): string {
  return `<${racine(appUrl)}${chemin}>; rel="canonical"`;
}

/**
 * Aucun `Disallow`, et c'est voulu. Une URL interdite d'exploration peut
 * quand même entrer dans l'index, nue, si un lien y mène ailleurs — jeton
 * compris. Laissée explorable, elle montre son `noindex` et en sort.
 */
export function robotsTxt(appUrl: string): string {
  return ['User-agent: *', 'Disallow:', '', `Sitemap: ${racine(appUrl)}/sitemap.xml`, ''].join('\n');
}

/**
 * Sans `<lastmod>` : la seule date à portée serait celle des fichiers, qui
 * change à chaque déploiement. Google ignore une date qui ment ; autant ne
 * pas en donner.
 */
export function sitemapXml(appUrl: string, chemins: readonly string[] = PAGES_PUBLIQUES): string {
  const urls = chemins.map((chemin) => `  <url><loc>${racine(appUrl)}${chemin}</loc></url>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}
