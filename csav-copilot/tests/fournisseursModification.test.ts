import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Fournisseur et Modification, d'après la maquette.
 *
 * CE QUE CES TESTS PROTÈGENT. Le bandeau « 1 changement à répercuter » menait
 * à Modification, où rien n'attendait : la demande était d'un autre type. La
 * carte disait « 5 en attente » et la liste « Aucune demande en attente » :
 * les autres étaient des ruptures. « 100 % de refus » s'affichait en rouge
 * sur une seule demande. Maintenant, chaque retour d'atelier a sa ligne dans
 * « À traiter », avec son geste ; « en attente » dit ce qu'il contient ; un
 * pourcentage ne s'affiche qu'à partir de cinq cas.
 */

const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const app = lire('public/app.js');
const html = lire('public/dashboard.html');
const routes = lire('src/routes/suppliers.ts');

const corps = (source: string, signature: string) => {
  const debut = source.indexOf(signature);
  assert.ok(debut >= 0, signature);
  return source.slice(debut, source.indexOf('\n}\n', debut) + 2);
};
const fonction = <T>(signature: string, ...avant: string[]) =>
  new Function(`${avant.join('\n')}\n${corps(app, signature)}; return ${signature.match(/function (\w+)/)![1]};`)() as T;

const aPrevenir = fonction<(c: object) => boolean>('function aPrevenir(');
const passeLeStatut = fonction<(c: object, s: string) => boolean>('function passeLeStatut(', corps(app, 'function aPrevenir('));

test('« À prévenir » : une réponse de l’atelier dont le client n’a pas été prévenu', () => {
  assert.equal(aPrevenir({ status: 'REFUSED', handledAt: null }), true);
  assert.equal(aPrevenir({ status: 'ACKNOWLEDGED', handledAt: null }), true);
  assert.equal(aPrevenir({ status: 'ACKNOWLEDGED', handledAt: '2026-10-16' }), false);
  assert.equal(aPrevenir({ status: 'PENDING', handledAt: null }), false);
  assert.equal(passeLeStatut({ status: 'REFUSED', handledAt: null }, 'PREVENIR'), true);
  assert.equal(passeLeStatut({ status: 'REFUSED', handledAt: null }, 'PENDING'), false);
  assert.equal(passeLeStatut({ status: 'PENDING', handledAt: null }, ''), true);
});

test('la liste vide dit pourquoi', () => {
  const renderDemandes = fonction<(rows: object, compteur: object, shown: object[], statut: string) => void>('function renderDemandes(');
  const rows = { innerHTML: '', dataset: {} } as { innerHTML: string; dataset: object };
  renderDemandes(rows, { textContent: '' }, [], 'PREVENIR');
  assert.match(rows.innerHTML, /Aucun client à prévenir : tout est transmis\./);
});

test('toutes les réponses à transmettre arrivent, quel que soit leur âge', () => {
  const route = routes.slice(routes.indexOf("app.get('/api/changes'"));
  assert.match(route, /OR: \[\{ status: 'PENDING' \}, \{ status: \{ not: 'PENDING' \}, handledAt: null \}\]/);
  // Qui a demandé, pour l'historique de la fiche.
  assert.match(route, /creePar: createdById \? \(noms\.get\(createdById\) \?\? null\) : null,/);
});

test('« en attente » dit de quoi il est fait ; la pastille ne compte pas les ruptures', () => {
  assert.match(routes, /by: \['supplierId', 'reason'\],/);
  assert.match(routes, /ruptures: escalationsDe\(supplier\.id, true\),/);
  const activite = routes.slice(routes.indexOf("app.get('/api/supplier-activity'"));
  assert.match(activite, /where: \{ merchantId, status: 'ANSWERED', reason: \{ not: 'OUT_OF_STOCK' \} \},/);
  assert.match(activite, /total: answered \+ issues \+ changes,\n\s+answered,\n\s+issues,\n\s+changes,\n\s+ruptures,/);
  const carte = corps(app, 'function atelierMarkup(');
  assert.match(carte, /demandes \? pluriel\(demandes, 'demande'\) : ''/);
  assert.match(carte, /ruptures \? pluriel\(ruptures, 'rupture'\) : ''/);
  assert.match(carte, /data-sup-attente=/);
});

test('sous cinq réponses, un compte et pas un pourcentage', () => {
  assert.match(app, /const ECHANTILLON_MIN = 5;/);
  const fiab = corps(app, 'function fiabiliteMarkup(');
  assert.match(fiab, /valeur: f\.refusPct === null \? '—' : assez\(repondues\) \? `\$\{f\.refusPct\} %` : `\$\{refus\} sur \$\{repondues\}`,/);
  assert.match(fiab, /chaud: assez\(repondues\) && f\.refusPct >= 33,/);
  assert.match(lire('src/services/suppliers/fiabilite.ts'), /refus: repondues\.filter\(\(demande\) => demande\.statut === 'REFUSED'\)\.length,/);
});

test('« À traiter » : chaque retour d’atelier, avec son geste', () => {
  assert.match(html, /<section class="fo-bloc fo-traiter" id="fo-traiter" hidden/);
  const rendu = corps(app, 'function renderATraiter(');
  assert.match(rendu, /for \(const change of \(state\.changesRows \?\? \[\]\)\.filter\(aPrevenir\)\)/);
  assert.match(rendu, /data-dem-prevenu=/);
  assert.match(rendu, /data-traiter-voir=/);
  assert.match(rendu, /data-goto="ruptures"/);
  // Le compte affiché ne prend pas la ligne d'information des ruptures.
  assert.ok(rendu.indexOf('const aFaire = lignes.length;') < rendu.indexOf('if (activite?.ruptures)'));
});

test('la liste et la fiche côte à côte, poussée au téléphone', () => {
  assert.match(html, /<aside class="fo-fiche" id="sup-dem-fiche"/);
  assert.match(html, /<aside class="fo-fiche mod-fiche" id="changes-fiche"/);
  assert.match(app, /\$\('changes-fiche-corps'\)\.innerHTML = ficheDemandeMarkup\(choisie\);/);
  assert.match(app, /\$\('sup-dem-fiche'\)\.innerHTML = ficheDemandeMarkup\(choisie\);/);
  // Un refus : ne rien confirmer au client.
  assert.match(corps(app, 'function ficheDemandeMarkup('), /Ne confirmez rien au client : l’atelier n’a pas pu le faire\./);
  // Retour au doigt, comme pour un message ou une commande.
  assert.match(app, /retourModification: \{ pane: \(\) => \$\('changes-fiche'\), fermer: \(\) => fermerPileModif\(\) \}/);
  // La pastille de Modification : les clients à prévenir.
  assert.match(app, /const pending = modificationsAPrevenir\(demandes\);/);
});
