import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Finitions d'interface.
 *
 * CE QUE CES TESTS PROTÈGENT. La console admin ne repasse jamais par les
 * fenêtres du navigateur (« csav-api.onrender.com indique… ») ; la
 * suppression d'une boutique exige toujours le domaine tapé, mais dans la
 * fenêtre de l'outil. Le lien d'invitation de secours se copie, il ne
 * s'affiche pas d'office : affiché, il finissait en capture d'écran. Le
 * sélecteur de boutiques montre le nom de la boutique, pas le préfixe de son
 * domaine. Le classement produits montre une photo, ou des initiales.
 */

const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const sansCommentaires = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');

const adminJs = sansCommentaires(lire('public/admin.js'));
const alerte = lire('public/alerte.js');
const appJs = lire('public/app.js');
const dashboard = lire('public/dashboard.html');

test('la console admin n’ouvre plus aucune fenêtre du navigateur', () => {
  assert.doesNotMatch(adminJs, /\bconfirm\(|\bprompt\(|\balert\(/);
  assert.match(adminJs, /import \{ demander, saisir \} from '\.\/alerte\.js';/);
});

test('l’alerte à saisir n’allume son bouton que sur le texte attendu', () => {
  assert.match(alerte, /export function saisir\(options\)/);
  assert.match(alerte, /\$\{champ\?\.attendu \? ' disabled' : ''\}/);
  assert.match(alerte, /valider\.disabled = !conforme\(\);/);
  assert.match(alerte, /if \(bouton && !bouton\.disabled\) fermer/);
});

test('le lien d’invitation de secours se copie, il ne s’affiche pas d’office', () => {
  assert.match(dashboard, /id="team-f-link-copy">Copier le lien<\/button>/);
  assert.match(dashboard, /<code id="team-f-link-url" hidden><\/code>/);
  assert.match(appJs, /await navigator\.clipboard\.writeText\(url\);/);
  // Le lien n'apparaît que si la copie échoue.
  const copie = appJs.slice(appJs.indexOf("$('team-f-link-copy').addEventListener"));
  assert.match(copie, /catch \{\s*\$\('team-f-link-url'\)\.hidden = false;/);
});

test('le nom de la boutique vient de Shopify, jamais par-dessus celui choisi par le marchand', () => {
  const service = lire('src/services/shopify/nomBoutique.ts');
  assert.match(service, /query NomBoutique \{ shop \{ name \} \}/);
  assert.match(service, /data: \{ name: nom \}/);
  const shops = lire('src/routes/shops.ts');
  assert.match(shops, /merchant\.status === 'ACTIVE' && !merchant\.brandName && !merchant\.name/);
  assert.match(lire('src/routes/auth.shopify.ts'), /if \(!merchant\.name\) await nommerBoutique\(merchant\.id\);/);
});

test('le classement produits montre une photo, ou des initiales à défaut', () => {
  assert.match(lire('src/services/shopify/produitsPeriode.ts'), /url\(transform: \{ maxWidth: 96, maxHeight: 96 \}\)/);
  const rendu = appJs.slice(appJs.indexOf('function produitsMarkup()'));
  assert.match(rendu, /const photoDe = \(l\) => l\.image \?\?/);
  assert.match(rendu, /sta-initiales/);
});

test('la vue d’ensemble charge la file elle-même, sans passer par « SAV client »', () => {
  const fn = appJs.slice(appJs.indexOf('async function loadOverview()'), appJs.indexOf('function renderOvPanne'));
  assert.match(fn, /state\.queueLoaded \? null : loadQueue\(\)/);
});

test('le lien de connexion essaie la boîte de chaque boutique jusqu’à ce qu’une l’envoie', () => {
  const team = lire('src/routes/team.ts');
  const fn = team.slice(team.indexOf("app.post('/api/auth/request-link'"));
  assert.match(fn, /for \(const merchantId of new Set\(accounts\.map\(\(account\) => account\.merchantId\)\)\) \{\s*if \(await deliverLink\(\{ merchantId, \.\.\.corps \}\)\) break;/);
});

test('une photo refusée par Shopify ne fait plus disparaître le classement produits', async () => {
  process.env.ENCRYPTION_KEY ??= 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=';
  const { fetchProduitsEntre } = await import('../src/services/shopify/produitsPeriode.ts');
  const avecPhoto: boolean[] = [];
  const client = {
    async request(q: string) {
      avecPhoto.push(q.includes('image {'));
      if (q.includes('image {')) throw new Error('Access denied for image field');
      return {
        orders: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [{ cancelledAt: null, shippingAddress: { countryCodeV2: 'FR' }, lineItems: { nodes: [
            { title: 'Crampon X', variantTitle: '42', sku: null, quantity: 2, image: null, discountedTotalSet: { shopMoney: { amount: '120' } } },
          ] } }],
        },
      };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await fetchProduitsEntre(client as any, new Date(0), new Date());
  assert.deepEqual(avecPhoto, [true, false]);
  assert.equal(r.commandes[0]!.lignes[0]!.titre, 'Crampon X');
});
