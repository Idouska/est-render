import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { env } from '../../config/env.ts';
import { getCredentials } from './credentials.ts';

/**
 * Les pages légales publiques, remplies avec les mentions de l'éditeur.
 *
 * Les fichiers portent des repères `{{SOCIETE}}`, `{{ADRESSE}}`, `{{EMAIL}}`…
 * remplacés ici par ce qui est réglé dans la console d'administration. Tant
 * qu'une mention manque, la page le dit dans un bandeau : mieux vaut une page
 * qui s'annonce incomplète qu'une page qui affiche des crochets.
 */

const echapper = (texte: string) =>
  texte.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const A_COMPLETER = '<mark>à compléter</mark>';

/** Les autorisations Gmail réellement demandées, d'après la configuration. */
const PORTEES_GMAIL: Record<string, string> = {
  'gmail.readonly': 'lire les messages entrants, pour les classer et y répondre',
  'gmail.modify': 'lire les messages et poser les libellés de traitement (lu, traité) dans la boîte',
  'gmail.compose': 'préparer des brouillons de réponse',
  'gmail.send': 'envoyer une réponse : après validation du marchand, ou automatiquement s’il a activé l’envoi automatique',
  'gmail.labels': 'créer et lire les libellés utilisés pour ranger les messages',
};

export function listePorteesGmail(scopes: readonly string[]): string {
  const lignes = scopes
    .map((scope) => scope.replace(/^https:\/\/www\.googleapis\.com\/auth\//, ''))
    .filter((nom) => nom.startsWith('gmail.'))
    .map((nom) => `<li><code>${echapper(nom)}</code> — ${PORTEES_GMAIL[nom] ?? 'accès nécessaire au traitement des messages'} ;</li>`);
  return lignes.length ? lignes.join('\n        ') : '<li>Aucune autorisation Gmail n’est configurée.</li>';
}

export function remplirPageLegale(
  gabarit: string,
  mentions: { societe?: string; adresse?: string; email?: string; ia?: string },
  scopes: readonly string[],
  maintenant = new Date(),
): string {
  const complet = Boolean(mentions.societe && mentions.adresse && mentions.email);
  const valeur = (v: string | undefined) => (v ? echapper(v).replace(/\n/g, '<br />') : A_COMPLETER);
  const bandeau = complet
    ? ''
    : `<div class="draft-banner"><b>⚠</b><div><b>Page incomplète.</b> Les mentions de l’éditeur (société, adresse, email de contact) ne sont pas encore renseignées.</div></div>`;
  return gabarit
    .replaceAll('{{BANDEAU}}', bandeau)
    .replaceAll('{{SOCIETE}}', valeur(mentions.societe))
    .replaceAll('{{ADRESSE}}', valeur(mentions.adresse))
    .replaceAll('{{EMAIL}}', valeur(mentions.email))
    .replaceAll('{{IA}}', echapper(mentions.ia === 'deepseek' ? 'DeepSeek' : 'Anthropic'))
    .replaceAll('{{IA_PAYS}}', mentions.ia === 'deepseek' ? 'Chine' : 'États-Unis')
    .replaceAll('{{PORTEES_GMAIL}}', listePorteesGmail(scopes))
    .replaceAll('{{DATE}}', maintenant.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }));
}

export async function pageLegale(fichier: 'privacy.html' | 'terms.html'): Promise<string> {
  const gabarit = await readFile(fileURLToPath(new URL(`../../../public/${fichier}`, import.meta.url)), 'utf8');
  const cles = await getCredentials();
  return remplirPageLegale(
    gabarit,
    { societe: cles.LEGAL_COMPANY, adresse: cles.LEGAL_ADDRESS, email: cles.LEGAL_EMAIL, ia: cles.AI_PROVIDER },
    env.GOOGLE_SCOPES,
  );
}
