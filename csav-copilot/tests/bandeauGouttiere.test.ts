import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Le bandeau de couleur du haut de page.
 *
 * CE QUE CES TESTS PROTÈGENT. Le bandeau déborde de la colonne pour toucher
 * les bords. Il débordait de 14 px quand l'espace libre n'en faisait que 8 :
 * il glissait sous la navigation, et sortait de l'écran sur téléphone — un
 * marchand l'a vu dès qu'il a choisi une couleur. L'espace libre et le
 * débordement sont maintenant la même valeur, `--gouttiere` ; ces tests
 * vérifient que personne ne change l'un sans l'autre.
 */

const css = readFileSync(fileURLToPath(new URL('../public/styles.css', import.meta.url)), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

test('le bandeau déborde exactement de la gouttière, et son contenu reste aligné', () => {
  const regle = css.match(/(?:^|\})\s*\.topzone\[data-teinte\]\s*\{([^}]*)\}/)![1]!;
  assert.match(regle, /margin: -11px calc\(-1 \* var\(--gouttiere, 8px\)\) 0;/);
  // Remplissage = débordement : le texte du bandeau reste au droit des cartes.
  assert.match(regle, /padding: 11px var\(--gouttiere, 8px\) 13px;/);
});

test('chaque marge de page déclare la gouttière qui va avec', () => {
  // Changer la marge de la page sans la gouttière referait déborder le
  // bandeau — sous la navigation, ou hors de l'écran.
  // Précédée d'une fin de règle, ou de l'ouverture d'un bloc @media : les
  // règles pour petits écrans commencent par une accolade ouvrante.
  const regles = [...css.matchAll(/(?:^|[{}])\s*\.app\s*\{([^}]*)\}/g)].map((m) => m[1]!);
  const avecMarge = regles.filter((corps) => /\bpadding:\s*\d+px/.test(corps));
  assert.ok(avecMarge.length >= 3, 'règles de marge introuvables');

  for (const corps of avecMarge) {
    const marge = corps.match(/\bpadding:\s*(\d+)px/)![1];
    const gouttiere = corps.match(/--gouttiere:\s*(\d+)px/)?.[1];
    assert.equal(gouttiere, marge, `« ${corps.trim()} » : la gouttière doit valoir la marge`);
  }
});

test('à côté de la navigation, l’écart vaut la gouttière', () => {
  // Sur ordinateur, le bandeau déborde à gauche dans l'écart avec la
  // navigation : s'il était plus petit, le bandeau repasserait dessous.
  const bureau = [...css.matchAll(/(?:^|\})\s*\.app\s*\{([^}]*grid-template-columns:\s*204px[^}]*)\}/g)];
  assert.equal(bureau.length, 1);
  const corps = bureau[0]![1]!;
  assert.equal(corps.match(/\bgap:\s*(\d+)px/)![1], corps.match(/--gouttiere:\s*(\d+)px/)![1]);
});
