// Enregistre dans Shopify 4 fiches produit test de frescomarche.fr : couscous Dari, colorant marocain, lessive 3 L, pommes de terre 5 kg.
// Pour chacune : le texte, le titre Google et la description Google ; pour le couscous, aussi le nom (faute « COUCOUS » corrigée).
// Adresses, photos et prix ne changent pas. Avant d'écrire, le script sauvegarde la version actuelle dans sauvegarde-fiches-test-avant-<date>.json.
//
// À lancer sur votre ordinateur (même autorisation que pour la charcuterie) :
//   1. shopify store auth --store qi1fj4-ip.myshopify.com --scopes read_products,write_products
//   2. node enregistrer-fiches-test.mjs --essai   -> vérifie les 4 fiches sans rien modifier
//      node enregistrer-fiches-test.mjs           -> enregistre

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const BOUTIQUE = "qi1fj4-ip.myshopify.com"; // adresse permanente de la boutique Fresco (frescomarche.fr)
const VERSION_API = "2026-10";
const ESSAI = process.argv.includes("--essai");

const LECTURE = `query Lire($id: ID!) { element: product(id: $id) { id handle title descriptionHtml seo { title description } } }`;
const ECRITURE = `mutation Ecrire($data: ProductUpdateInput!) { resultat: productUpdate(product: $data) { product { id } userErrors { field message } } }`;

const FICHES = [
  {
    "nom": "Couscous moyen Dari 1 kg",
    "id": "gid://shopify/Product/16033680752965",
    "handle": "coucous-moyen-dari-1kg-6111094000013",
    "descriptionHtml": "<p>Couscous moyen Dari, 100 % semoule de blé dur, importé du Maroc. Le paquet de 1 kg.</p>\n<p>Son grain régulier et sa belle couleur jaune en font la référence du couscous traditionnel. La granulométrie moyenne est la plus polyvalente : elle tient parfaitement dans les plats en sauce, les couscous familiaux et les accompagnements de légumes ou de viandes braisées.</p>\n<ul>\n<li>Paquet de 1 kg</li>\n<li>100 % semoule de blé dur</li>\n<li>Grain moyen</li>\n</ul>\n<p>En cuisine : couscous aux légumes, à la viande ou royal, et accompagnement des tajines. Il se cuit à la vapeur au couscoussier, ou se réhydrate simplement à l'eau bouillante salée.</p>\n<p>Pour un grain plus léger : le <a href=\"/products/couscous-fin-dari-1kg-6111094000228\">couscous fin Dari</a>. Semoules, harissa et feuilles de brick sont au rayon <a href=\"/collections/produits-du-monde-maghreb-orient\">Maghreb et Orient</a>.</p>",
    "seo": {
      "title": "Couscous moyen Dari 1 kg, semoule de blé dur | Fresco Marché",
      "description": "Couscous moyen Dari, paquet de 1 kg, 100 % semoule de blé dur importée du Maroc : le grain polyvalent des restaurants et traiteurs. Commande pro, livré 7j/7."
    },
    "title": "Couscous moyen Dari 1 kg"
  },
  {
    "nom": "Colorant Alimentaire Marocain 10x100 Sachets Les Chaînes",
    "id": "gid://shopify/Product/16059549090117",
    "handle": "colorant-alimentaire",
    "descriptionHtml": "<p>Le colorant alimentaire marocain Les Chaînes, c'est le petit sachet qu'on verse dans le riz, les tajines ou les pâtisseries pour leur donner leur couleur. Un sachet par préparation : le résultat reste le même d'un service à l'autre.</p>\n<ul>\n<li>10 étuis de 100 sachets, soit 1 000 sachets</li>\n<li>Poids net total : 25 g</li>\n<li>Sachets individuels</li>\n</ul>\n<p>En cuisine : riz, tajines, couscous et pâtisseries orientales.</p>\n<p>Avec les épices du même rayon : <a href=\"/products/samia-curcuma-moulu-100g\">curcuma</a>, <a href=\"/products/samia-epices-tajine-100g\">épices pour tajine</a> et <a href=\"/products/samia-raz-el-hanout-100g\">ras el hanout</a>. Tout est au rayon <a href=\"/collections/epicerie-salee\">épicerie salée</a>.</p>",
    "seo": {
      "title": "Colorant alimentaire marocain, 1 000 sachets | Fresco Marché",
      "description": "Colorant alimentaire marocain Les Chaînes : 10 étuis de 100 sachets pour colorer riz, tajines et pâtisseries. Commande pro, livraison 7j/7 depuis Clichy."
    }
  },
  {
    "nom": "Lessive Liquide 3L Facile",
    "id": "gid://shopify/Product/16033702707525",
    "handle": "lessive-liquide-facile-3l-5902114230432",
    "descriptionHtml": "<p>Lessive liquide Facile en bidon de 3 L, pour le linge d'un restaurant ou d'un commerce : torchons, tabliers, nappes, serviettes et tenues de cuisine. Elle se dose au bouchon, machine après machine, en suivant les doses indiquées sur le bidon.</p>\n<ul>\n<li>Bidon de 3 L</li>\n<li>Dosage au bouchon</li>\n<li>À conserver à température ambiante, hors de portée des enfants</li>\n</ul>\n<p>Même format, d'autres parfums : <a href=\"/products/facile-fraicheur-florale-40-lavages-3l-5902114230449\">Fraîcheur florale</a> et <a href=\"/products/facile-fraicheur-ocean-40-lavages-3l-5902114230425\">Fraîcheur océan</a>. Pour la plonge : le <a href=\"/products/liquide-vaisselle-pomme-1l\">liquide vaisselle 1 L</a>. Tout l'entretien est au rayon <a href=\"/collections/hygiene\">hygiène</a>.</p>",
    "seo": {
      "title": "Lessive liquide Facile 3 L pour le linge pro | Fresco Marché",
      "description": "Lessive liquide Facile, bidon de 3 L dosé au bouchon : torchons, tabliers, nappes et tenues de cuisine. Pour restaurants et commerces, livrée 7j/7."
    }
  },
  {
    "nom": "Pommes de Terre Filet 5kg",
    "id": "gid://shopify/Product/16033678786885",
    "handle": "pdt-filet-5kg-2000000001838",
    "descriptionHtml": "<p>Pommes de terre en filet de 5 kg, le format des cuisines qui en utilisent tous les jours : restaurants, snacks, traiteurs et cantines.</p>\n<ul>\n<li>Filet de 5 kg</li>\n<li>À conserver au frais et à l'abri de la lumière, hors du réfrigérateur</li>\n</ul>\n<p>Pourquoi pas au réfrigérateur ? Au froid, l'amidon de la pomme de terre se transforme en sucres, et elle colore trop vite à la friture. À la lumière, elle verdit. Une réserve fraîche et sombre lui convient mieux.</p>\n<p>Pour les frites : les <a href=\"/products/pdt-speciales-frites-2-5kg\">pommes de terre spéciales frites 2,5 kg</a>. En plus petit format : l'<a href=\"/products/pdt-agata-filet-2-5kg\">Agata en filet de 2,5 kg</a>. Avec les <a href=\"/products/oignons-filet-5-kg-2000000001814\">oignons en filet de 5 kg</a>, tout est au rayon <a href=\"/collections/legumes\">légumes</a>.</p>",
    "seo": {
      "title": "Pommes de terre en filet de 5 kg pour pros | Fresco Marché",
      "description": "Pommes de terre en filet de 5 kg pour restaurants, snacks et traiteurs : le format des cuisines qui en utilisent chaque jour. Commande pro, livrée 7j/7."
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

// 1. Lecture et contrôle des 4 fiches avant toute écriture
const avant = [];
for (const f of FICHES) {
  const actuel = executer(LECTURE, { id: f.id }, "element", false);
  if (!actuel) throw new Error(`${f.nom} : introuvable, rien n'a été modifié`);
  if (actuel.handle !== f.handle) throw new Error(`${f.nom} : l'identifiant mène à « ${actuel.handle} », pas à « ${f.handle} ». Rien n'a été modifié.`);
  avant.push({ id: f.id, handle: f.handle, title: actuel.title, descriptionHtml: actuel.descriptionHtml, seo: actuel.seo });
  if (ESSAI) console.log(`— ${actuel.title} : trouvée. Titre Google « ${actuel.seo?.title || "(vide)"} »  ->  « ${f.seo.title} »`);
}
if (ESSAI) {
  console.log(`\n${avant.length} fiche(s) sur ${FICHES.length} trouvée(s). Rien n'a été modifié.`);
  process.exit(0);
}
const fichier = `sauvegarde-fiches-test-avant-${new Date().toISOString().slice(0, 10)}.json`;
writeFileSync(fichier, JSON.stringify(avant, null, 1));
console.log(`Version actuelle sauvegardée dans ${fichier}\n`);

// 2. Écriture puis relecture
let ok = 0;
const erreurs = [];
for (const f of FICHES) {
  try {
    const data = { id: f.id, descriptionHtml: f.descriptionHtml, seo: f.seo };
    if (f.title) data.title = f.title;
    const res = executer(ECRITURE, { data }, "resultat", true);
    if (res.userErrors?.length) throw new Error(res.userErrors.map((x) => x.message).join(" ; "));
    const apres = executer(LECTURE, { id: f.id }, "element", false);
    const conforme = texte(apres.descriptionHtml) === texte(f.descriptionHtml) && apres.seo?.title === f.seo.title
      && apres.seo?.description === f.seo.description && (!f.title || apres.title === f.title);
    ok += 1;
    console.log(`${conforme ? "OK " : "OK (à vérifier)"}  ${f.nom}`);
  } catch (err) {
    erreurs.push(f.nom);
    console.log(`ERREUR  ${f.nom} : ${String(err.stderr || err.message).trim().slice(0, 300)}`);
  }
}
console.log(`\n${ok} fiche(s) sur ${FICHES.length} enregistrée(s).`);
if (erreurs.length) { console.log("À reprendre : " + erreurs.join(", ")); process.exitCode = 1; }
