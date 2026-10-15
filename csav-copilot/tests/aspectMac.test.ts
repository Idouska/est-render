import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * L'aspect Mac, partout.
 *
 * CE QUE CES TESTS PROTÈGENT. Les pièces communes de l'outil portent le même
 * habit que les Réglages : la page ouverte remplie de l'accent dans la
 * colonne, des intitulés en casse normale, des boutons poussoirs sans
 * décollement, des menus à double flèche. La feuille empile ses couches et
 * la dernière déclaration gagne : c'est elle qu'on lit ici, pas la première.
 */

const feuille = readFileSync(fileURLToPath(new URL('../public/styles.css', import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** La dernière valeur d'une propriété pour un sélecteur exact, dans l'ordre de la feuille. */
function derniere(selecteur: string, propriete: string): string | undefined {
  let valeur: string | undefined;
  for (const [, selecteurs, corps] of feuille.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const liste = selecteurs.split(',').map((s) => s.trim().replace(/\s+/g, ' '));
    if (!liste.includes(selecteur)) continue;
    for (const [, nom, v] of corps.matchAll(/(?:^|;)\s*([a-z-]+)\s*:\s*([^;]+)/g)) {
      if (nom === propriete) valeur = v.trim();
    }
  }
  return valeur;
}

test('les intitulés sortent des petites capitales', () => {
  for (const selecteur of ['.nav-title', '.panel-title', '.rail-title', '.kpi-label', '.grid th', '.field label', '.crumb']) {
    assert.equal(derniere(selecteur, 'text-transform'), 'none', selecteur);
    assert.equal(derniere(selecteur, 'letter-spacing'), '0', selecteur);
  }
});

test('la page ouverte se surligne de gris, l’icône seule garde l’accent', () => {
  // Comme le Finder et Mail : la colonne n'est pas un bandeau de couleur.
  assert.equal(derniere('.nav-item[aria-current="true"]', 'background'), 'color-mix(in srgb, var(--ink) 9%, transparent)');
  assert.equal(derniere('.nav-item[aria-current="true"]', 'color'), 'var(--ink)');
  assert.equal(derniere('.nav-item[aria-current="true"] svg', 'color'), 'var(--accent-ink)');
  assert.equal(derniere('.nav-item[aria-current="true"]::before', 'display'), 'none');
});

test('le titre de l’écran n’a plus de trait de couleur', () => {
  assert.equal(derniere('.head h1::after', 'display'), 'none');
});

test('les boutons sont des poussoirs : un filet, pas de décollement au survol', () => {
  assert.equal(derniere('.btn', 'border-radius'), '6px');
  assert.equal(derniere('.btn', 'box-shadow'), 'var(--mac-filet)');
  assert.equal(derniere('.btn:hover:not(:disabled)', 'transform'), 'none');
  assert.equal(derniere('.btn-primary', 'background'), 'var(--accent)');
  assert.equal(derniere('.actbtn.on', 'background'), 'var(--accent)');
});

test('les menus ont la double flèche des menus locaux du Mac', () => {
  assert.equal(derniere(':root select:not([multiple])', 'appearance'), 'none');
  assert.match(derniere(':root select:not([multiple])', 'background-image') ?? '', /M1\.5 4\.5L4\.5 1\.5l3 3/);
  // Le tri de la file garde sa pastille : son menu reste nu à l'intérieur.
  assert.equal(derniere(':root .qsort select:not([multiple])', 'background'), 'none');
});

test('les choix « ceci ou cela » sont des contrôles segmentés', () => {
  assert.equal(derniere('.seg2 button[aria-pressed=\'true\']', 'background'), 'var(--surface)');
  assert.equal(derniere('.seg button[aria-pressed="true"]', 'background'), 'var(--surface)');
});

test('les initiales de la boutique se lisent dans leur pastille', () => {
  // `.brand span` imposait au monogramme le gris et la chasse fixe du domaine.
  assert.equal(derniere('.brand .brand-mark', 'color'), 'var(--on-accent)');
  assert.equal(derniere('.brand .brand-mark', 'font-family'), 'var(--font-ui)');
});

test('la police est celle du système, SF Pro sur un Mac', () => {
  assert.match(derniere(':root', '--font-ui') ?? '', /^-apple-system, BlinkMacSystemFont/);
});
