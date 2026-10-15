import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Barre des menus, Centre de contrôle, Spotlight — comme sur le Mac.
 *
 * Les réglages qu'on touche plusieurs fois par jour étaient éparpillés entre
 * le menu du compte, les Réglages et Apparence : ils se retrouvent en tuiles,
 * derrière une icône au bout de la barre du haut. La recherche ⌘K prend la
 * capsule de Spotlight, ses boutons ronds et ses résultats rangés.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const app = lire('public/app.js');
const css = lire('public/styles.css');
const dashboard = lire('public/dashboard.html');

const corps = (signature: string) => {
  const debut = app.indexOf(signature);
  assert.ok(debut >= 0, `${signature} introuvable`);
  return app.slice(debut, app.indexOf('\n}\n', debut) + 2);
};

test('au bout de la barre du haut : la lune, puis le Centre de contrôle', () => {
  const tete = dashboard.slice(dashboard.indexOf('<header class="head">'), dashboard.indexOf('</header>'));
  const rangs = ['id="refresh"', 'id="head-lune"', 'id="cc-btn"'].map((id) => tete.indexOf(id));
  assert.ok(rangs.every((r) => r > 0));
  assert.deepEqual([...rangs].sort((a, b) => a - b), rangs);
  assert.match(tete, /<span class="head-lune" id="head-lune" role="img" aria-label="Ne pas déranger activé"\s+title="Ne pas déranger" hidden>/);
  assert.match(tete, /id="cc-btn" type="button" aria-label="Centre de contrôle"/);
});

test('les tuiles réunissent ce qui était éparpillé', () => {
  const panneau = dashboard.slice(dashboard.indexOf('<div class="cc" id="cc"'), dashboard.indexOf('id="cc-reglages"'));
  for (const id of ['cc-shopify', 'cc-gmail', 'cc-envoi', 'cc-jour', 'cc-apparence', 'cc-actualiser', 'cc-dnd', 'auto-refresh', 'cc-test']) {
    assert.ok(panneau.includes(`id="${id}"`), id);
  }
  // L'actualisation automatique a quitté le menu du compte.
  const compte = dashboard.slice(dashboard.indexOf('id="compte-menu"'), dashboard.indexOf('</aside>'));
  assert.doesNotMatch(compte, /auto-refresh/);
  // Les réglages du marchand passent par la même porte que les Réglages.
  assert.match(corps('async function basculerReglage('), /await api\('\/api\/settings', \{ method: 'PATCH', body: JSON\.stringify\(\{ \[cle\]: actif \}\) \}\);/);
  assert.match(corps('async function basculerReglage('), /if \(!canI\('configure'\)\) \{/);
  // Le panneau relit l'état à chaque ouverture, se ferme à côté et à Échap.
  assert.match(corps('function ouvrirCentre('), /rendreCentre\(\);/);
  assert.match(app, /if \(\$\('cc'\)\?\.hidden \|\| event\.target\.closest\('#cc, #cc-btn'\)\) return;/);
  assert.match(app, /if \(event\.key !== 'Escape' \|\| \$\('cc'\)\?\.hidden\) return;/);
});

test('« Ne pas déranger » coupe les bulles et allume la lune', () => {
  assert.match(corps('function annoncer('), /if \(nePasDeranger\(\)\) return;/);
  assert.match(corps('function nePasDeranger('), /localStorage\.getItem\('csav\.dnd'\) === '1'/);
  assert.match(corps('function rendreLune('), /if \(lune\) lune\.hidden = !nePasDeranger\(\);/);
});

test('verre dépoli, avec une couleur unie de secours', () => {
  assert.match(css, /\.cc \{\n  position: fixed;[\s\S]*?backdrop-filter: blur\(30px\) saturate\(1\.8\);/);
  assert.match(css, /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\) \{/);
  assert.match(css, /\.cc-on \.cc-rond \{ background: #fff; color: var\(--accent\); \}/);
});

test('Spotlight : une capsule, quatre boutons ronds, des résultats rangés', () => {
  const pal = dashboard.slice(dashboard.indexOf('<div class="pal" id="pal"'), dashboard.indexOf('class="pal-resultats"'));
  assert.match(pal, /<label class="pal-champ">/);
  for (const portee of ['message', 'commande', 'client', 'action']) {
    assert.match(pal, new RegExp(`data-portee="${portee}" aria-pressed="false"`), portee);
  }
  const sections = corps('function sectionsPalette(');
  // Sans rien taper : les récents et les écrans courants.
  assert.match(sections, /\['Récents', recents\]/);
  // Le meilleur résultat en tête.
  assert.match(sections, /\['Meilleur résultat', \[\{ \.\.\.meilleur, meilleur: true \}\]\]/);
  // Les messages viennent de la base, après une pause de frappe ; pas Shopify.
  assert.match(corps('function chercherMessagesPalette('), /const data = await api\(`\/api\/tickets\?\$\{params\}`\);/);
  assert.match(corps('function chercherMessagesPalette('), /if \(tour !== paletteTour \|\| \$\('pal'\)\.hidden\) return;/);
  assert.doesNotMatch(sections, /\/api\/(orders|customers)/);
  // Pas de voile : Spotlight flotte au-dessus.
  assert.match(css, /\.pal \{ background: transparent; padding: 14vh 20px 20px; \}/);
  assert.match(css, /\.pal-champ \{\n  flex: 1;[\s\S]*?border-radius: 29px;/);
});
