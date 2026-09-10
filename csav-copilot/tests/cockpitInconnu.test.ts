import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * « Zéro » et « on ne sait pas » ne se disent pas pareil.
 *
 * CE QUE CES TESTS PROTÈGENT. Le poste de pilotage est l'écran qu'on ouvre
 * pour savoir si quelque chose brûle. Quand une de ses sources ne répond pas,
 * il se remplissait de zéros — c'est-à-dire de « tout va bien », soit
 * exactement l'inverse de ce qu'on sait. Le motif fautif était partout le
 * même : `counts.X ?? 0`, qui écrase l'absence par une valeur rassurante.
 *
 * Trois sources, trois silences possibles, et ils ne se confondent pas :
 * `/api/metrics` porte les compteurs, `/api/stats` la tendance, et la file
 * déjà chargée porte les quatre alertes d'échéance. Chacune peut manquer
 * seule, et un tiret ne doit apparaître que là où l'on ignore vraiment.
 *
 * Le piège inverse existe aussi : une clé absente d'une réponse REÇUE veut
 * bien dire zéro — le serveur ne liste que les statuts présents. Afficher un
 * tiret là serait une fausse alerte, et une fausse alerte use la vraie.
 */

const APP = fileURLToPath(new URL('../public/app.js', import.meta.url));
const source = readFileSync(APP, 'utf8');

function extraire(debut: string, fin = '\n}'): string {
  const i = source.indexOf(debut);
  assert.ok(i >= 0, `introuvable dans public/app.js : ${debut}`);
  const j = source.indexOf(fin, i);
  assert.ok(j >= 0, `fin introuvable après ${debut}`);
  return source.slice(i, j + fin.length);
}

const ovCompte = new Function(
  `${extraire('function ovCompte')} return ovCompte;`,
)() as (metrics: unknown, counts: Record<string, number>, cle: string) => string;

test('sans réponse des compteurs, un tiret — jamais un zéro', () => {
  assert.equal(
    ovCompte(null, {}, 'DRAFT_READY'),
    '—',
    'un zéro se lirait « tout va bien » alors qu’on ne sait rien',
  );
});

test('avec une réponse reçue, une clé absente vaut bien zéro', () => {
  // Le serveur ne renvoie que les statuts présents : l'absence de la clé est
  // une information, pas un manque. Un tiret ici serait une fausse alerte.
  assert.equal(ovCompte({ tickets: {} }, {}, 'DRAFT_READY'), '0');
});

test('une valeur reçue est rendue telle quelle', () => {
  assert.equal(ovCompte({ tickets: {} }, { DRAFT_READY: 115 }, 'DRAFT_READY'), '115');
  assert.equal(ovCompte({ tickets: {} }, { DRAFT_READY: 0 }, 'DRAFT_READY'), '0');
});

/* ---- le bandeau qui nomme la source manquante ---- */

interface Boite {
  hidden: boolean | null;
  innerHTML: string;
  textContent?: string;
}

function bandeau(sources: { metrics: boolean; stats: boolean }): Boite[] {
  const boites: Record<string, Boite> = {
    'ov-panne': { hidden: null, innerHTML: '' },
    'ov-panne-txt': { hidden: null, innerHTML: '' },
  };

  new Function(
    'boites',
    `const $ = (id) => boites[id];
     ${extraire('function esc')}
     ${extraire('function renderOvPanne')}
     return renderOvPanne;`,
  )(boites)(sources);

  return [boites['ov-panne'], boites['ov-panne-txt']];
}

test('quand tout répond, le bandeau reste caché', () => {
  const [boite] = bandeau({ metrics: true, stats: true });
  assert.equal(boite.hidden, true);
});

test('le bandeau nomme la source manquante, et accorde son verbe', () => {
  const [boiteUne, texteUne] = bandeau({ metrics: true, stats: false });
  assert.equal(boiteUne.hidden, false);
  assert.match(texteUne.innerHTML, /tendance sur sept jours/);
  assert.match(texteUne.innerHTML, /n’a pas répondu/, 'une seule source : singulier');
  assert.equal(
    /compteurs/.test(texteUne.innerHTML),
    false,
    'nommer une source qui a répondu ferait douter de chiffres justes',
  );

  const [, texteDeux] = bandeau({ metrics: false, stats: false });
  assert.match(texteDeux.innerHTML, /n’ont pas répondu/, 'deux sources : pluriel');
});

test('le bandeau commence par une majuscule', () => {
  // La liste des sources ouvre une phrase après un point. Assemblée telle
  // quelle, elle donnait « Chiffres incomplets. les compteurs… ».
  const [, texte] = bandeau({ metrics: false, stats: true });
  const apresLePoint = texte.innerHTML.split('</b> ')[1] ?? '';
  assert.match(apresLePoint, /^[A-ZÀÉÈ]/, `commence par une minuscule : « ${apresLePoint.slice(0, 30)} »`);
});

test('le bandeau explique ce qu’un tiret veut dire', () => {
  // Sans cette phrase, six tirets font douter de l'outil plutôt que du réseau.
  const [, texte] = bandeau({ metrics: false, stats: false });
  assert.match(texte.innerHTML, /ce ne sont pas des zéros/);
});

/* ---- la file, troisième source, silencieuse d'une autre façon ---- */

test('les alertes d’échéance attendent que la file ait répondu', () => {
  // Ces quatre lignes se comptent sur `state.tickets`, que `loadOverview` ne
  // charge pas : arriver directement ici laissait quatre zéros rassurants sur
  // le panneau dont c'est le contraire du rôle.
  const risques = extraire('function renderOvRisques');

  assert.match(
    risques,
    /state\.queueLoaded \? String\(nombre\) : '—'/,
    'la valeur doit dépendre du chargement de la file',
  );
  assert.equal(
    /valeur: String\((horsDelai|litiges|plusVieuxQue)/.test(risques),
    false,
    'une valeur brute ne distingue pas « aucun » de « pas encore demandé »',
  );

  // Et le drapeau doit bien être levé quelque part, sinon il reste faux à vie
  // et l'écran n'affiche plus jamais que des tirets.
  assert.ok(
    source.includes('state.queueLoaded = true;'),
    'loadQueue doit lever le drapeau après avoir renseigné state.tickets',
  );
});
