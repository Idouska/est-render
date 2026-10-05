import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  estIndexable,
  lienCanonique,
  PAGES_PUBLIQUES,
  robotsTxt,
  sitemapXml,
} from '../src/lib/indexation.ts';

/*
 * Ce que Google garde de l'application.
 *
 * Le lien d'un atelier ne périme pas, et l'atelier affiche les commandes et
 * les adresses des clients. Une seule de ces pages dans l'index, et elle se
 * trouve par une recherche sur le nom d'un client. Le jour où elle y entre,
 * rien ne casse, aucune erreur : ces tests sont le seul signal.
 */

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const pages = readdirSync(PUBLIC).filter((fichier) => fichier.endsWith('.html'));
const lire = (fichier: string) => readFileSync(`${PUBLIC}${fichier}`, 'utf8');
const publiques = new Set(PAGES_PUBLIQUES.map((chemin) => `${chemin.slice(1)}.html`));

test('seules la confidentialité et les CGU sont indexables', () => {
  assert.equal(estIndexable('/privacy'), true);
  assert.equal(estIndexable('/terms?utm_source=google'), true);
  for (const url of ['/', '/dashboard', '/fournisseur/abc.def', '/agence/x', '/api/config', '/static/app.js']) {
    assert.equal(estIndexable(url), false, url);
  }
});

test("toute page privée se déclare noindex, même servie sans l'en-tête", () => {
  for (const page of pages.filter((p) => !publiques.has(p))) {
    assert.match(lire(page), /<meta name="robots" content="noindex/, page);
  }
});

test('les pages publiques ont une description de longueur utile', () => {
  for (const page of publiques) {
    const html = lire(page);
    assert.doesNotMatch(html, /name="robots"/, page);
    const description = /name="description"\s+content="([^"]*)"/.exec(html)?.[1] ?? '';
    const longueur = [...description].length;
    assert.ok(longueur >= 120 && longueur <= 160, `${page} : ${longueur} caractères`);
  }
});

test("robots.txt n'interdit rien et désigne le sitemap", () => {
  const robots = robotsTxt('https://sav.example.com/');
  assert.match(robots, /^Disallow:$/m);
  assert.match(robots, /^Sitemap: https:\/\/sav\.example\.com\/sitemap\.xml$/m);
});

test("le sitemap et le canonique portent l'adresse d'APP_URL", () => {
  const sitemap = sitemapXml('https://sav.example.com');
  assert.deepEqual(
    [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]),
    ['https://sav.example.com/privacy', 'https://sav.example.com/terms'],
  );
  assert.equal(
    lienCanonique('https://sav.example.com/', '/privacy'),
    '<https://sav.example.com/privacy>; rel="canonical"',
  );
});
