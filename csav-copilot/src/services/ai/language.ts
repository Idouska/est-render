/**
 * Langue d'un message entrant.
 *
 * Détection par mots-outils plutôt que par modèle : c'est instantané, gratuit,
 * et suffisant pour trancher entre les quelques langues d'une clientèle
 * européenne et nord-américaine. Le modèle reçoit ensuite l'indication et suit
 * de toute façon la langue du fil s'il constate une erreur.
 *
 * Les mots retenus sont fréquents, courts et propres à une langue : « the » ou
 * « and » n'existent pas en français, « les » et « votre » pas en anglais.
 */

const MARKERS: Record<string, string[]> = {
  fr: ['le', 'les', 'des', 'une', 'vous', 'votre', 'bonjour', 'merci', 'commande', 'livraison', 'pas', 'reçu'],
  en: ['the', 'and', 'you', 'your', 'hello', 'hi', 'thanks', 'order', 'delivery', 'received', 'please'],
  es: ['el', 'los', 'una', 'usted', 'hola', 'gracias', 'pedido', 'entrega', 'recibido', 'por favor'],
  de: ['der', 'die', 'das', 'und', 'ihre', 'hallo', 'danke', 'bestellung', 'lieferung', 'erhalten'],
  it: ['il', 'gli', 'una', 'sua', 'ciao', 'grazie', 'ordine', 'consegna', 'ricevuto', 'per favore'],
  nl: ['de', 'het', 'een', 'uw', 'hallo', 'bedankt', 'bestelling', 'levering', 'ontvangen'],
};

export function detectLanguage(bodyText: string, subject?: string | null): string {
  const words = `${subject ?? ''} ${bodyText}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z]+/)
    .filter(Boolean)
    // Un mail contient souvent une signature et une citation du fil : les
    // premiers mots portent la langue du message qu'on traite.
    .slice(0, 220);

  if (words.length === 0) return 'fr';

  const counts = new Map<string, number>();
  for (const word of words) {
    for (const [language, markers] of Object.entries(MARKERS)) {
      if (markers.includes(word)) counts.set(language, (counts.get(language) ?? 0) + 1);
    }
  }

  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];

  // Un seul mot commun ne suffit pas à décider : « the » apparaît dans des
  // mails français citant un nom de produit.
  return best && best[1] >= 2 ? best[0] : 'fr';
}
