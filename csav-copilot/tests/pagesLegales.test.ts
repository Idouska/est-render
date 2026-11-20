import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { listePorteesGmail, remplirPageLegale } from '../src/services/platform/legal.ts';

/*
 * Les pages légales publiques.
 *
 * CE QUE CES TESTS PROTÈGENT. Elles affichaient des champs entre crochets et
 * deux affirmations fausses : la liste des autorisations Gmail oubliait celles
 * réellement demandées, et « aucun message ne part sans action explicite »
 * ignorait l'envoi automatique.
 */
const lire = (f: string) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const mentions = { societe: 'Ma Société SAS', adresse: '1 rue A\n75000 Paris', email: 'contact@exemple.fr' };
const scopes = ['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.send'];

test('plus aucun crochet ni repère non rempli une fois les mentions réglées', () => {
  for (const f of ['privacy.html', 'terms.html']) {
    const page = remplirPageLegale(lire(f), mentions, scopes);
    assert.doesNotMatch(page, /\{\{|<mark>|draft-banner"|Modèle de départ/, f);
    assert.match(page, /Ma Société SAS/);
    assert.match(page, /1 rue A<br \/>75000 Paris/);
  }
});

test('sans les mentions, la page le dit au lieu d’afficher des crochets', () => {
  const page = remplirPageLegale(lire('privacy.html'), {}, scopes);
  assert.match(page, /Page incomplète/);
  assert.match(page, /<mark>à compléter<\/mark>/);
  assert.doesNotMatch(page, /\{\{/);
});

test('les autorisations Gmail affichées sont celles réellement demandées', () => {
  const liste = listePorteesGmail(scopes);
  assert.match(liste, /<code>gmail\.modify<\/code>/);
  assert.match(liste, /<code>gmail\.send<\/code>/);
  assert.doesNotMatch(liste, /gmail\.readonly/);
});

test('l’envoi automatique est dit, la mention ne peut pas injecter de balise', () => {
  assert.match(lire('privacy.html'), /S'il active l'envoi automatique/);
  assert.doesNotMatch(lire('privacy.html'), /n'envoie jamais de message sans une action explicite/);
  const page = remplirPageLegale(lire('terms.html'), { ...mentions, societe: '<script>x</script>' }, scopes);
  assert.doesNotMatch(page, /<script>x/);
});
