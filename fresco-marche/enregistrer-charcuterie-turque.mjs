// Enregistre dans Shopify le rayon « Charcuterie turque » et ses 7 fiches produit (frescomarche.fr), validés par Rachid le 30/10/2026.
// Pour chacun : le texte, le titre Google et la description Google. Noms, adresses, photos et prix ne changent pas.
// Avant d'écrire, le script sauvegarde la version actuelle dans sauvegarde-charcuterie-avant-<date>.json.
//
// À lancer sur votre ordinateur :
//   1. shopify store auth --store qi1fj4-ip.myshopify.com --scopes read_products,write_products
//   2. node enregistrer-charcuterie-turque.mjs --essai   -> vérifie les 8 éléments sans rien modifier
//      node enregistrer-charcuterie-turque.mjs           -> enregistre

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const BOUTIQUE = "qi1fj4-ip.myshopify.com"; // adresse permanente de la boutique Fresco (frescomarche.fr)
const VERSION_API = "2026-10";
const ESSAI = process.argv.includes("--essai");

const LECTURE = {
  collection: `query Lire($id: ID!) { element: collection(id: $id) { id handle title descriptionHtml seo { title description } } }`,
  product: `query Lire($id: ID!) { element: product(id: $id) { id handle title descriptionHtml seo { title description } } }`,
};
const ECRITURE = {
  collection: `mutation Ecrire($data: CollectionUpdateInput!) { resultat: collectionUpdate(collection: $data) { collection { id } userErrors { field message } } }`,
  product: `mutation Ecrire($data: ProductUpdateInput!) { resultat: productUpdate(product: $data) { product { id } userErrors { field message } } }`,
};

const ELEMENTS = [
  {
    "type": "collection",
    "nom": "Rayon charcuterie turque",
    "id": "gid://shopify/Collection/690654708037",
    "handle": "charcuterie-turque",
    "descriptionHtml": "<p>Charcuterie turque halal pour les snacks, les restaurants turcs, les pizzerias et les épiceries : sucuk en tranches, pastirma de Kayseri avec ou sans çemen, salamis turcs aux épices, aux piments ou au poivre, et saucisses bœuf-poulet Sibel. Tout est halal, comme l'ensemble du catalogue.</p>\n<h2>Sucuk, pastirma ou salami : lequel choisir ?</h2>\n<ul>\n<li><strong>Sucuk</strong> : la saucisse sèche épicée de la cuisine turque, en tranches. À la poêle avec des œufs, sur une pide, une pizza ou dans un toast chaud.</li>\n<li><strong>Pastirma</strong> : du bœuf séché enrobé de çemen, une pâte d'épices au fenugrec, à l'ail et au paprika. La version sans çemen est plus douce. Pour les plateaux du petit-déjeuner, les pides et les œufs.</li>\n<li><strong>Salami turc</strong> : en barquettes de 80 g pré-tranchées, pour les sandwichs froids, les wraps et les pizzas.</li>\n<li><strong>Saucisses Sibel</strong> : en sachet de 400 g, à poêler ou à griller pour les assiettes et les sandwichs chauds.</li>\n</ul>\n<p>Tarifs HT réservés aux professionnels, visibles une fois le compte validé. Livraison 7 jours sur 7 depuis notre dépôt de Clichy.</p>",
    "seo": {
      "title": "Charcuterie turque halal, salami turc, sucuk | Fresco Marché",
      "description": "Salami turc, sucuk en tranches, pastirma de Kayseri, saucisses bœuf-poulet : la charcuterie turque halal des snacks et restaurants. Livraison 7j/7."
    }
  },
  {
    "type": "product",
    "nom": "Sucuk en Tranches 200g",
    "id": "gid://shopify/Product/16033687044421",
    "handle": "dilim-sucuk-en-tranche-200g-4017979028009",
    "descriptionHtml": "<p>Le sucuk est la saucisse sèche épicée de la cuisine turque. Celui-ci est déjà coupé en tranches : il passe directement de la barquette à la poêle.</p>\n<ul>\n<li>Barquette de 200 g, en tranches</li>\n<li>À conserver au frais, entre 0 et 6 °C</li>\n<li>Halal, comme tout le catalogue</li>\n</ul>\n<p>En cuisine : œufs au sucuk, pide, toast au fromage, pizza ou sandwich chaud. Une poêle sans matière grasse suffit, le sucuk rend sa propre graisse.</p>\n<p>Pour les plateaux du petit-déjeuner : le <a href=\"/products/kayseri-pastirma-100g-gurkan-4260127932028\">pastirma de Kayseri</a>. Voir aussi les salamis et les saucisses du rayon <a href=\"/collections/charcuterie-turque\">charcuterie turque</a>.</p>",
    "seo": {
      "title": "Sucuk turc halal en tranches 200 g | Fresco Marché",
      "description": "Sucuk turc halal en tranches, barquette de 200 g : pour œufs au sucuk, pides, toasts et pizzas. Tarif HT réservé aux pros, livraison 7j/7 depuis Clichy."
    }
  },
  {
    "type": "product",
    "nom": "Pastirma de Kayseri 100g Isla Délice",
    "id": "gid://shopify/Product/16033699168581",
    "handle": "kayseri-pastirma-100g-gurkan-4260127932028",
    "descriptionHtml": "<p>Le pastirma est la charcuterie emblématique de Kayseri, en Anatolie : du bœuf salé et séché, enrobé de çemen, une pâte d'épices au fenugrec, à l'ail et au paprika. Celui-ci arrive en tranches fines, prêt à servir.</p>\n<ul>\n<li>Barquette de 100 g, pré-tranché</li>\n<li>À conserver au frais, entre 0 et 6 °C</li>\n<li>Halal, comme tout le catalogue</li>\n</ul>\n<p>En cuisine : sur un plateau de petit-déjeuner turc, poêlé quelques secondes avec des œufs, sur une pide en fin de cuisson ou dans un sandwich chaud.</p>\n<p>Plus doux, sans la croûte d'épices : le <a href=\"/products/cemeni-siyrilmis-pastirma-80g-4260127930017\">pastirma sans çemen</a>. Sucuk, salamis et saucisses complètent le rayon <a href=\"/collections/charcuterie-turque\">charcuterie turque</a>.</p>",
    "seo": {
      "title": "Pastirma de Kayseri halal 100 g en tranches | Fresco Marché",
      "description": "Pastirma de Kayseri halal en tranches, barquette de 100 g : bœuf séché au çemen pour pides, œufs et petits-déjeuners turcs. Commande pro, livré depuis Clichy."
    }
  },
  {
    "type": "product",
    "nom": "Pastirma sans Çemen 80g Isla Délice",
    "id": "gid://shopify/Product/16033698349381",
    "handle": "cemeni-siyrilmis-pastirma-80g-4260127930017",
    "descriptionHtml": "<p>Ce pastirma est vendu sans son çemen : la croûte d'épices au fenugrec et au paprika a été retirée. Il garde le goût du bœuf séché, avec moins de piquant que le pastirma classique.</p>\n<ul>\n<li>Barquette de 80 g, pré-tranché</li>\n<li>À conserver au frais, entre 0 et 6 °C</li>\n<li>Halal, comme tout le catalogue</li>\n</ul>\n<p>En cuisine : plateaux froids et mezzés, sandwichs, salades composées, ou en garniture de pide à la sortie du four.</p>\n<p>Version épicée : le <a href=\"/products/kayseri-pastirma-100g-gurkan-4260127932028\">pastirma de Kayseri</a> avec son çemen. Les autres spécialités sont au rayon <a href=\"/collections/charcuterie-turque\">charcuterie turque</a>.</p>",
    "seo": {
      "title": "Pastirma sans çemen halal 80 g en tranches | Fresco Marché",
      "description": "Pastirma halal sans çemen, 80 g en tranches : le goût du bœuf séché, sans la croûte d'épices. Pour plateaux et pides. Commande pro, livré depuis Clichy."
    }
  },
  {
    "type": "product",
    "nom": "Salami aux Épices en Tranches 80g",
    "id": "gid://shopify/Product/16059534147909",
    "handle": "cesnili-dilim-salam-80gr-salami-aux-epices",
    "descriptionHtml": "<p>Salami turc aux épices, pré-tranché en barquette de 80 g. Les tranches se posent directement sur le pain ou la pâte, sans découpe ni perte.</p>\n<ul>\n<li>Barquette de 80 g, pré-tranché</li>\n<li>Halal, comme tout le catalogue</li>\n</ul>\n<p>En cuisine : sandwichs froids, wraps, paninis, pizzas et planches à partager.</p>\n<p>Plus relevé : le <a href=\"/products/biberli-dilim-salam-80gr-salami-aux-piments\">salami aux piments</a>. Avec une note poivrée : le <a href=\"/products/cesnili-salami-de-volaille-a-la-boeuf-enrobe-de-poivre-80g\">salami volaille-bœuf au poivre Çesnili</a>. Toute la gamme est au rayon <a href=\"/collections/charcuterie-turque\">charcuterie turque</a>.</p>",
    "seo": {
      "title": "Salami turc aux épices halal tranché 80 g | Fresco Marché",
      "description": "Salami turc aux épices halal, pré-tranché, barquette de 80 g : pour sandwichs, wraps et pizzas. Tarif HT réservé aux pros, livraison 7j/7 depuis Clichy."
    }
  },
  {
    "type": "product",
    "nom": "Salami aux Piments en Tranches 80g",
    "id": "gid://shopify/Product/16059528675653",
    "handle": "biberli-dilim-salam-80gr-salami-aux-piments",
    "descriptionHtml": "<p>La version relevée du salami turc : des tranches pimentées, prêtes à l'emploi, pour les clients qui aiment quand ça pique.</p>\n<ul>\n<li>Barquette de 80 g, pré-tranché</li>\n<li>Halal, comme tout le catalogue</li>\n</ul>\n<p>En cuisine : pizzas piquantes, sandwichs, tacos et paninis, ou sur une planche à l'apéritif.</p>\n<p>Plus doux : le <a href=\"/products/cesnili-dilim-salam-80gr-salami-aux-epices\">salami aux épices</a>. Pour les plats chauds : le <a href=\"/products/dilim-sucuk-en-tranche-200g-4017979028009\">sucuk en tranches</a>. Les trois salamis sont au rayon <a href=\"/collections/charcuterie-turque\">charcuterie turque</a>.</p>",
    "seo": {
      "title": "Salami turc aux piments halal tranché 80 g | Fresco Marché",
      "description": "Salami turc aux piments halal, la version relevée, en barquette de 80 g pré-tranchée : pour pizzas piquantes et sandwichs. Tarif HT pro, livraison 7j/7."
    }
  },
  {
    "type": "product",
    "nom": "Salami de Volaille et Bœuf Enrobé de Poivre 80g Çesnili",
    "id": "gid://shopify/Product/16059540668741",
    "handle": "cesnili-salami-de-volaille-a-la-boeuf-enrobe-de-poivre-80g",
    "descriptionHtml": "<p>Salami de volaille et de bœuf de la marque Çesnili, enrobé de poivre. Le poivre en bordure de tranche donne du relief aux assiettes froides.</p>\n<ul>\n<li>Barquette de 80 g, pré-tranché</li>\n<li>À conserver au frais, entre 0 et 6 °C</li>\n<li>Halal, comme tout le catalogue</li>\n</ul>\n<p>En cuisine : plateaux de charcuterie halal, sandwichs, salades et buffets.</p>\n<p>Sans poivre : le <a href=\"/products/cesnili-dilim-salam-80gr-salami-aux-epices\">salami aux épices</a>. Retrouvez sucuk et pastirma dans notre <a href=\"/collections/charcuterie-turque\">charcuterie turque</a>.</p>",
    "seo": {
      "title": "Salami halal volaille-bœuf au poivre Çesnili | Fresco Marché",
      "description": "Salami halal volaille et bœuf au poivre Çesnili, 80 g pré-tranché : pour plateaux, sandwichs et assiettes froides. Commande pro, livré depuis Clichy."
    }
  },
  {
    "type": "product",
    "nom": "Saucisses de Bœuf et Poulet 400g Sibel",
    "id": "gid://shopify/Product/16059542044997",
    "handle": "saucisses-de-boeuf-avec-poulet-400g-sibel",
    "descriptionHtml": "<p>Saucisses de bœuf et de poulet Sibel, en sachet de 400 g. Prêtes à cuire, elles se poêlent ou se grillent en quelques minutes.</p>\n<ul>\n<li>Sachet de 400 g</li>\n<li>À conserver au frais, entre 0 et 6 °C</li>\n<li>Halal, comme tout le catalogue</li>\n</ul>\n<p>En cuisine : assiettes grillées, hot-dogs, sandwichs chauds, et petits-déjeuners avec des œufs.</p>\n<p>Pour une saveur plus épicée : le <a href=\"/products/dilim-sucuk-en-tranche-200g-4017979028009\">sucuk en tranches</a>. Tout le reste est au rayon <a href=\"/collections/charcuterie-turque\">charcuterie turque</a>.</p>",
    "seo": {
      "title": "Saucisses halal bœuf-poulet Sibel 400 g | Fresco Marché",
      "description": "Saucisses halal de bœuf et poulet Sibel, sachet de 400 g : à poêler ou griller pour assiettes, hot-dogs et petits-déjeuners. Commande pro, livraison 7j/7."
    }
  }
];

function executer(requete, variables, cle, ecriture) {
  const args = ["store", "execute", "--store", BOUTIQUE, "--version", VERSION_API, "--json", "--no-color", "--query", requete, "--variables", JSON.stringify(variables)];
  if (ecriture) args.push("--allow-mutations");
  const sortie = execFileSync("shopify", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const objets = [];
  for (const ligne of [sortie, ...sortie.split("\n")]) {
    try { objets.push(JSON.parse(ligne.trim())); } catch {}
  }
  const erreurCli = objets.find((o) => o && o.error);
  if (erreurCli) throw new Error(erreurCli.error.message || JSON.stringify(erreurCli.error));
  const trouve = objets.map((o) => (o && cle in o) ? o : (o?.data && cle in o.data) ? o.data : (o?.result?.data && cle in o.result.data) ? o.result.data : null).find(Boolean);
  if (!trouve) throw new Error("réponse inattendue : " + sortie.slice(0, 300));
  return trouve[cle];
}

const texte = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// 1. Lecture et contrôle de tous les éléments avant toute écriture
const avant = [];
for (const e of ELEMENTS) {
  const actuel = executer(LECTURE[e.type], { id: e.id }, "element", false);
  if (!actuel) throw new Error(`${e.nom} : introuvable, rien n'a été modifié`);
  if (actuel.handle !== e.handle) throw new Error(`${e.nom} : l'identifiant mène à « ${actuel.handle} », pas à « ${e.handle} ». Rien n'a été modifié.`);
  avant.push({ type: e.type, id: e.id, handle: e.handle, descriptionHtml: actuel.descriptionHtml, seo: actuel.seo });
  if (ESSAI) console.log(`— ${e.nom} : trouvé. Titre Google « ${actuel.seo?.title || "(vide)"} »  ->  « ${e.seo.title} »`);
}
if (ESSAI) {
  console.log(`\n${avant.length} élément(s) sur ${ELEMENTS.length} trouvé(s). Rien n'a été modifié.`);
  process.exit(0);
}
const fichier = `sauvegarde-charcuterie-avant-${new Date().toISOString().slice(0, 10)}.json`;
writeFileSync(fichier, JSON.stringify(avant, null, 1));
console.log(`Version actuelle sauvegardée dans ${fichier}\n`);

// 2. Écriture puis relecture
let ok = 0;
const erreurs = [];
for (const e of ELEMENTS) {
  try {
    const res = executer(ECRITURE[e.type], { data: { id: e.id, descriptionHtml: e.descriptionHtml, seo: e.seo } }, "resultat", true);
    if (res.userErrors?.length) throw new Error(res.userErrors.map((x) => x.message).join(" ; "));
    const apres = executer(LECTURE[e.type], { id: e.id }, "element", false);
    const conforme = texte(apres.descriptionHtml) === texte(e.descriptionHtml) && apres.seo?.title === e.seo.title && apres.seo?.description === e.seo.description;
    ok += 1;
    console.log(`${conforme ? "OK " : "OK (à vérifier)"}  ${e.nom}`);
  } catch (err) {
    erreurs.push(e.nom);
    console.log(`ERREUR  ${e.nom} : ${String(err.stderr || err.message).trim().slice(0, 300)}`);
  }
}
console.log(`\n${ok} élément(s) sur ${ELEMENTS.length} enregistré(s).`);
if (erreurs.length) { console.log("À reprendre : " + erreurs.join(", ")); process.exitCode = 1; }
