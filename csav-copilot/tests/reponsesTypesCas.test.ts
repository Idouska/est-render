import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/*
 * Réponses types pour tout cas de figure.
 *
 * CE QUE CES TESTS PROTÈGENT. Une réponse ne se rangeait que sous l'un des
 * sept motifs de l'IA, et un message n'en proposait que six : la septième et
 * les suivantes existaient sans qu'on puisse les insérer.
 */
const lire = (chemin: string) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8');
const app = lire('public/app.js');
const routes = lire('src/routes/cannedReplies.ts');

test('un cas de figure libre, enregistré et rendu', () => {
  assert.match(lire('prisma/schema.prisma'), /model CannedReply \{[\s\S]*?\n  category   String\?\n/);
  assert.match(lire('prisma/migrations/20261120150000_reponse_type_categorie/migration.sql'), /ALTER TABLE "CannedReply" ADD COLUMN "category" TEXT;/);
  assert.match(routes, /category: z\.string\(\)\.trim\(\)\.max\(60\)\.nullish\(\),/);
  assert.match(routes, /category: parsed\.data\.category \|\| null,/);
  assert.match(app, /category: \$\('canned-f-cat'\)\.value\.trim\(\) \|\| null,/);
});

test('depuis un message, toutes les réponses sont atteignables et se cherchent', () => {
  assert.match(app, /\(tout \? vues : vues\.slice\(0, 6\)\)/);
  assert.match(app, /data-canned-tout>\$\{tout \? 'Réduire' : `Toutes \(\$\{sorted\.length\}\)`\}/);
  assert.match(lire('public/dashboard.html'), /<input type="search" id="canned-chips-q"/);
});

test('les modèles courants : chacun a un titre unique, un cas, un motif connu et un texte', () => {
  const bloc = app.slice(app.indexOf('const MODELES_REPONSES = ['), app.indexOf('/** Les cas de figure déjà utilisés'));
  const modeles = new Function(`${bloc}; return MODELES_REPONSES;`)() as string[][];
  assert.ok(modeles.length >= 20);
  assert.equal(new Set(modeles.map((m) => m[0])).size, modeles.length);
  const motifs = [...routes.matchAll(/^  '([A-Z_]+)',$/gm)].map((m) => m[1]);
  for (const [titre, cas, motif, texte] of modeles) {
    assert.ok(titre && titre.length <= 120 && cas && cas.length <= 60, titre);
    assert.ok(motifs.includes(motif!), `${titre} : motif ${motif}`);
    assert.match(texte!, /^Bonjour \{\{prenom\}\},/);
    // Seules les variables que l'insertion sait remplacer.
    for (const v of texte!.matchAll(/\{\{(\w+)\}\}/g)) assert.ok(['prenom', 'commande', 'suivi', 'boutique'].includes(v[1]!), `${titre} : {{${v[1]}}}`);
  }
  // Ceux dont le titre existe déjà ne sont pas ajoutés deux fois.
  assert.match(app, /MODELES_REPONSES\.filter\(\(\[titre\]\) => !state\.canned\.some\(\(item\) => item\.title === titre\)\)/);
});
