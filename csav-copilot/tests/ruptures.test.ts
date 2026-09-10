import assert from 'node:assert/strict';
import test from 'node:test';

import {
  commandesParSku,
  compteursVues,
  etatDossier,
  kpisRuptures,
  prioriteDossier,
  syntheseDossier,
  type DossierRupture,
} from '../src/services/ruptures/console.ts';

/*
 * La console des ruptures : les seuls jugements de la page.
 *
 * CE QUE CES TESTS PROTÈGENT. Cet écran ne montre presque rien de brut. Un
 * état, une priorité, un nombre de commandes impactées, une recommandation :
 * tout est déduit. Une déduction fausse ne se signale pas — elle s'affiche
 * exactement comme une déduction juste, et range le travail dans un ordre que
 * personne ne peut discuter.
 *
 * Le cas le plus coûteux est « Client à prévenir » : le fournisseur a répondu,
 * le client attend, et personne ne le lui a dit. Le manquer ne provoque
 * aucune erreur — juste un client qui n'a pas de nouvelles.
 */

const T = new Date('2026-09-10T09:00:00Z').getTime();
const ilYa = (jours: number) => new Date(T - jours * 86_400_000);

const dossier = (patch: Partial<DossierRupture> = {}): DossierRupture => ({
  id: 'e1',
  ticketId: 't1',
  statut: 'OPEN',
  creeLe: ilYa(1),
  notifieLe: ilYa(1),
  resoluLe: null,
  reponseFournisseurLe: null,
  reponseClientLe: null,
  rembourse: false,
  sku: 'NK-AM90',
  montant: 129,
  ...patch,
});

/* ---- l'état ---- */

test('un brouillon d’escalade est un dossier à traiter', () => {
  // Le message au fournisseur n'est pas parti : rien n'a encore été demandé.
  assert.equal(etatDossier(dossier({ statut: 'DRAFTING' })), 'A_TRAITER');
});

test('une escalade envoyée sans réponse attend le fournisseur', () => {
  assert.equal(etatDossier(dossier({ statut: 'OPEN' })), 'FOURNISSEUR_EN_ATTENTE');
});

test('le fournisseur a répondu et le client ne le sait pas', () => {
  // Le cas qui justifie l'écran : l'information existe, elle n'est pas
  // transmise, et rien dans le produit ne le signalait jusqu'ici.
  const cas = dossier({
    statut: 'ANSWERED',
    reponseFournisseurLe: ilYa(1),
    reponseClientLe: ilYa(3),
  });

  assert.equal(etatDossier(cas), 'CLIENT_A_PREVENIR');
});

test('une réponse au client postérieure au fournisseur clôt l’attente', () => {
  const cas = dossier({
    statut: 'ANSWERED',
    reponseFournisseurLe: ilYa(3),
    reponseClientLe: ilYa(1),
  });

  assert.equal(etatDossier(cas), 'FOURNISSEUR_CONTACTE');
});

test('un client jamais recontacté est à prévenir, pas déjà informé', () => {
  // `null` n'est pas « avant » : le traiter comme une date ferait passer le
  // dossier pour réglé alors que le client n'a jamais eu de réponse.
  const cas = dossier({
    statut: 'ANSWERED',
    reponseFournisseurLe: ilYa(1),
    reponseClientLe: null,
  });

  assert.equal(etatDossier(cas), 'CLIENT_A_PREVENIR');
});

test('un remboursement engagé décide de l’issue', () => {
  assert.equal(etatDossier(dossier({ rembourse: true })), 'REMBOURSEMENT');
});

test('un dossier clos reste clos, même remboursé', () => {
  assert.equal(etatDossier(dossier({ statut: 'RESOLVED', rembourse: true })), 'RESOLU');
});

/* ---- la priorité ---- */

test('la priorité monte avec l’ancienneté, le nombre de commandes et le montant', () => {
  assert.equal(prioriteDossier(dossier({ creeLe: ilYa(0.2) }), 1, T), 'basse');
  assert.equal(prioriteDossier(dossier({ creeLe: ilYa(1) }), 1, T), 'moyenne');
  assert.equal(prioriteDossier(dossier({ creeLe: ilYa(4) }), 6, T), 'haute');
});

test('une rupture qui bloque plusieurs clients pèse plus qu’un dossier isolé', () => {
  // Huit commandes sur le même SKU ne sont pas huit incidents : c'en est un,
  // huit fois plus urgent.
  const jeune = dossier({ creeLe: ilYa(0.2), montant: 20 });

  assert.equal(prioriteDossier(jeune, 1, T), 'basse');
  assert.equal(prioriteDossier(jeune, 8, T), 'moyenne');
});

test('un dossier résolu n’a pas de priorité', () => {
  assert.equal(
    prioriteDossier(dossier({ statut: 'RESOLVED', creeLe: ilYa(9) }), 8, T),
    null,
    'la lui laisser ferait remonter du travail terminé en tête de liste',
  );
});

/* ---- l'agrégation ---- */

test('les commandes se comptent par SKU, dossiers clos exclus', () => {
  const parSku = commandesParSku([
    dossier({ id: 'a', sku: 'NK-AM90' }),
    dossier({ id: 'b', sku: 'NK-AM90' }),
    dossier({ id: 'c', sku: 'NK-AM90', statut: 'RESOLVED' }),
    dossier({ id: 'd', sku: 'AD-SAMBA' }),
    dossier({ id: 'e', sku: null }),
  ]);

  assert.equal(parSku.get('NK-AM90'), 2, 'le dossier clos ne bloque plus personne');
  assert.equal(parSku.get('AD-SAMBA'), 1);
  assert.equal(parSku.has('null'), false);
});

/* ---- les compteurs et les KPI ---- */

test('« Tous » compte le travail restant, pas l’historique', () => {
  const compteurs = compteursVues([
    dossier({ id: 'a', statut: 'DRAFTING' }),
    dossier({ id: 'b', statut: 'OPEN' }),
    dossier({ id: 'c', statut: 'RESOLVED', resoluLe: ilYa(1) }),
  ]);

  assert.equal(compteurs.tous, 2, 'les résolus ont leur propre onglet');
  assert.equal(compteurs.RESOLU, 1);
  assert.equal(compteurs.A_TRAITER, 1);
});

test('les références actives se comptent une fois, pas une par commande', () => {
  const kpis = kpisRuptures([
    dossier({ id: 'a', sku: 'NK-AM90' }),
    dossier({ id: 'b', sku: 'NK-AM90' }),
    dossier({ id: 'c', sku: 'AD-SAMBA' }),
  ]);

  assert.equal(kpis.rupturesActives, 2, 'deux produits bloqués');
  assert.equal(kpis.commandesImpactees, 3, 'trois clients qui attendent');
});

test('le délai de résolution ignore les dossiers ouverts et les horloges de travers', () => {
  const kpis = kpisRuptures([
    dossier({ id: 'a', statut: 'RESOLVED', creeLe: ilYa(2), resoluLe: ilYa(1) }),
    dossier({ id: 'b', statut: 'RESOLVED', creeLe: ilYa(4), resoluLe: ilYa(1) }),
    // Clos avant d'être ouvert : impossible, donc écarté.
    dossier({ id: 'c', statut: 'RESOLVED', creeLe: ilYa(1), resoluLe: ilYa(2) }),
    dossier({ id: 'd', statut: 'OPEN' }),
  ]);

  assert.equal(kpis.resolutionMesuree, 2);
  assert.equal(kpis.resolutionMinutes, (1440 + 4320) / 2);
});

test('sans dossier clos, aucun délai n’est inventé', () => {
  const kpis = kpisRuptures([dossier({ statut: 'OPEN' })]);
  assert.equal(
    kpis.resolutionMinutes,
    null,
    'zéro se lirait « réglé sur-le-champ », l’inverse de « aucune mesure »',
  );
});

/* ---- la synthèse ---- */

test('la synthèse dit le problème, l’impact et le geste qui manque', () => {
  const phrases = syntheseDossier({
    dossier: dossier({ statut: 'ANSWERED', reponseFournisseurLe: ilYa(1), creeLe: ilYa(5) }),
    produit: 'Nike Air Max 90',
    fournisseur: 'Nike',
    commandesImpactees: 8,
    maintenant: T,
  });

  assert.match(phrases[0]!, /Nike Air Max 90 est en rupture chez Nike depuis 5 jours/);
  assert.match(phrases[1]!, /8 commandes sont bloquées/);
  assert.match(phrases[2]!, /le client ne le sait pas encore/);
});

test('la synthèse ne parle pas de commandes multiples quand il n’y en a qu’une', () => {
  const phrases = syntheseDossier({
    dossier: dossier(),
    produit: 'Adidas Samba',
    fournisseur: null,
    commandesImpactees: 1,
    maintenant: T,
  });

  assert.equal(phrases.length, 2, 'une phrase d’impact vide serait du bruit');
  assert.equal(/chez/.test(phrases[0]!), false, 'aucun fournisseur : on ne l’invente pas');
});
