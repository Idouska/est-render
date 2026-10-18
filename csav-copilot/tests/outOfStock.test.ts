import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  chiffresRuptures,
  fileDossier,
  modelesEnRupture,
  type ConsigneDuTableau,
  type DossierDuTableau,
} from '../src/services/ruptures/tableau.ts';
import { delaiAnnonce, MODELE_RUPTURE, remplirMail } from '../src/services/ruptures/mailTexte.ts';
import { ligneRelance, recapDuJour } from '../src/services/suppliers/recapTexte.ts';

/*
 * La note « Out of stock » : ce que voit l'équipe, et ce qui part au client.
 *
 * CE QUE CES TESTS PROTÈGENT. Les chiffres du haut sont aussi les filtres de
 * la liste ; s'ils se trompent, l'équipe croit qu'il n'y a rien à faire alors
 * qu'un client attend. Et un mail au client mal rempli — « Bonjour {{prenom}} »
 * — part en son nom.
 */

const T0 = new Date('2026-10-14T09:40:00Z');
const apres = (heures: number) => new Date(T0.getTime() + heures * 3_600_000);
const MAINTENANT = apres(72);

const consigne = (patch: Partial<ConsigneDuTableau> = {}): ConsigneDuTableau => ({
  choix: 'ATTENDRE',
  reponse: null,
  remplaceeLe: null,
  envoyeeLe: apres(2),
  ...patch,
});

const dossier = (patch: Partial<DossierDuTableau> = {}): DossierDuTableau => ({
  resolu: false,
  creeLe: T0,
  mailClientLe: null,
  nouveauSuiviLe: null,
  remboursementFait: null,
  joursAnnonces: null,
  consignes: [],
  produit: { cle: 'sku:rh-0381', nom: 'Runner Halo', variante: 'Noir · 38 2/3' },
  ...patch,
});

test('sans décision, le dossier est à traiter — et dit pourquoi', () => {
  assert.equal(fileDossier(dossier(), MAINTENANT).cle, 'A_TRAITER');
  assert.equal(fileDossier(dossier({ joursAnnonces: 10 }), MAINTENANT).sous, 'réassort dans 10 j');
  const mail = fileDossier(dossier({ mailClientLe: apres(1) }), MAINTENANT);
  assert.equal(mail.attenteClient, true, 'le mail est parti : le client a la parole');
  assert.equal(mail.sous, 'mail parti, pas de décision');
});

test('le 2e choix qui manque aussi : à traiter, et rupture répétée', () => {
  const file = fileDossier(
    dossier({ consignes: [consigne({ choix: 'REMPLACER', reponse: 'IMPOSSIBLE', reponduLe: apres(20) })] }),
    MAINTENANT,
  );
  assert.equal(file.aTraiter, true);
  assert.equal(file.repete, true);
  assert.equal(file.sous, '2e choix aussi en rupture');
});

test('Restock : en attente jusqu’au jour de relance, puis de nouveau à traiter', () => {
  const attente = fileDossier(dossier({ consignes: [consigne({ relancerLe: apres(240) })] }), MAINTENANT);
  assert.equal(attente.cle, 'ATTENTE_ATELIER');
  assert.equal(attente.libelle, 'Restock');
  assert.match(attente.sous, /^relance du client le /);

  const relance = fileDossier(dossier({ consignes: [consigne({ relancerLe: apres(48) })] }), MAINTENANT);
  assert.equal(relance.aTraiter, true);
  assert.equal(relance.libelle, 'Client à relancer');
});

test('Remboursement : à rembourser, puis remboursé', () => {
  const annuler = [consigne({ choix: 'ANNULER' })];
  assert.equal(fileDossier(dossier({ consignes: annuler, remboursementFait: false }), MAINTENANT).cle, 'A_REMBOURSER');
  assert.equal(fileDossier(dossier({ consignes: annuler, remboursementFait: true }), MAINTENANT).cle, 'REMBOURSE');
});

test('le nouveau suivi tranche : expédiée', () => {
  const file = fileDossier(
    dossier({ consignes: [consigne({ choix: 'REMPLACER', reponse: 'COMPRIS' })], nouveauSuiviLe: apres(30) }),
    MAINTENANT,
  );
  assert.equal(file.cle, 'EXPEDIEE');
});

test('les chiffres : ouverts seulement, et un délai mesuré, jamais inventé', () => {
  const chiffres = chiffresRuptures(
    [
      dossier(),
      dossier({ mailClientLe: apres(1) }),
      dossier({ consignes: [consigne({ choix: 'REMPLACER', reponse: 'IMPOSSIBLE' })] }),
      dossier({ consignes: [consigne({ choix: 'REMPLACER' })] }),
      dossier({ resolu: true, nouveauSuiviLe: apres(72) }),
    ],
    MAINTENANT,
  );
  assert.equal(chiffres.aTraiter, 3);
  assert.equal(chiffres.attenteClient, 1);
  assert.equal(chiffres.repetees, 1);
  assert.equal(chiffres.attenteAtelier, 1);
  assert.equal(chiffres.delaiMoyenHeures, 72);
  assert.equal(chiffres.delaiMesure, 1);

  assert.equal(chiffresRuptures([dossier()], MAINTENANT).delaiMoyenHeures, null, 'sans colis, pas de délai');
});

test('les modèles en rupture : combien de fois, dont en 2e choix', () => {
  const graphite = { productTitle: 'Runner Halo', variantTitle: 'Graphite · 38 2/3', sku: 'RH-0382' };
  const modeles = modelesEnRupture(
    [
      dossier(),
      dossier({ creeLe: apres(10) }),
      dossier({ consignes: [consigne({ choix: 'REMPLACER', reponse: 'IMPOSSIBLE', reponduLe: apres(20), modeles: [graphite] })] }),
      // Plus de quatre-vingt-dix jours : ne compte plus.
      dossier({ creeLe: new Date(T0.getTime() - 100 * 86_400_000) }),
    ],
    MAINTENANT,
  );
  const noir = modeles.find((modele) => modele.cle === 'sku:rh-0381');
  const deuxieme = modeles.find((modele) => modele.cle === 'sku:rh-0382');
  assert.equal(noir?.fois, 3);
  assert.equal(deuxieme?.fois, 1);
  assert.equal(deuxieme?.deuxiemeChoix, 1);
  assert.equal(modeles[0]?.cle, 'sku:rh-0381', 'le plus fréquent en tête');
});

test('le mail type : jamais de « {{…} } » laissé, ni de « Bonjour , »', () => {
  const corps = remplirMail(MODELE_RUPTURE.corps, {
    prenom: null,
    commande: '#12890',
    article: 'Runner Halo (Noir, 38 2/3)',
    boutique: 'Atelier Lumen',
    jours: 10,
  });
  assert.doesNotMatch(corps, /\{\{/);
  assert.match(corps, /^Bonjour,/);
  assert.match(corps, /Runner Halo \(Noir, 38 2\/3\)/);
  assert.match(corps, /sous 10 jours/);
  assert.match(remplirMail(MODELE_RUPTURE.sujet, { prenom: 'Inès', commande: '#12890', article: null, boutique: 'X', jours: null }), /#12890/);
});

test('le délai annoncé par l’atelier se lit dans sa note et dans ses puces', () => {
  assert.equal(delaiAnnonce('Réassort prévu dans 10 jours.'), 10);
  assert.equal(delaiAnnonce('Réassort sous 2 semaines'), 14);
  assert.equal(delaiAnnonce('Réassort sous 1 mois.'), 30);
  assert.equal(delaiAnnonce('Date de réassort inconnue.'), null);
  // Les puces de l'atelier partent en français : l'outil doit savoir les lire.
  const ws = readFileSync(fileURLToPath(new URL('../public/workspace.js', import.meta.url)), 'utf8');
  assert.match(ws, /j10: 'Réassort sous 10 jours\.'/);
  assert.match(ws, /m1: 'Réassort sous 1 mois\.'/);
});

test('le jour de la relance, l’atelier est prévenu dans son récapitulatif', () => {
  assert.equal(ligneRelance({ orderName: '#12862' }, 'fr'), '- #12862 — Réassort attendu : le client est relancé aujourd’hui. Où en êtes-vous ?');
  const recap = recapDuJour({
    langue: 'zh',
    merchantName: 'Atelier Lumen',
    nouvelles: { demandes: [], ruptures: [], relances: [{ orderName: '#12862' }] },
    enAttente: { demandes: [], ruptures: [] },
    lien: null,
  });
  assert.ok(recap);
  assert.match(recap.body, /#12862 — 等待补货/);
});

test('plusieurs articles en rupture : un dossier chacun, toujours lus comme une rupture', () => {
  const route = readFileSync(fileURLToPath(new URL('../src/routes/supplierWorkspace.ts', import.meta.url)), 'utf8');
  assert.match(route, /articles: z\.array\(article\)\.min\(1\)\.max\(20\)\.nullish\(\)/);
  // La clé du fil garde le préfixe de l'atelier et finit par le motif.
  assert.match(route, /`supplier:\$\{workspace\.supplierId\}:\$\{donnees\.shopifyOrderId\}:\$\{cleArticle\}\$\{donnees\.kind\}`/);
  // La note n'est requise que hors rupture.
  assert.match(route, /if \(!rupture && note\.length < 3\)/);
  // Le mail automatique ne part que pour un dossier nouveau.
  assert.match(route, /for \(const ticketId of nouveaux\)/);
});
