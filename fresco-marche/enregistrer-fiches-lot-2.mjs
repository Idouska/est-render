// Enregistre dans Shopify 6 fiches produit de frescomarche.fr (Fiches produit, lot 2).
// Pour chacune : le texte, le titre Google et la description Google.
// Adresses, photos et prix ne changent pas. Avant d'écrire, le script sauvegarde la version actuelle dans sauvegarde-fiches-lot-2-avant-<date>.json.
//
// À lancer sur votre ordinateur (même autorisation que pour la charcuterie) :
//   1. shopify store auth --store qi1fj4-ip.myshopify.com --scopes read_products,write_products
//   2. node enregistrer-fiches-lot-2.mjs --essai   -> vérifie les fiches sans rien modifier
//      node enregistrer-fiches-lot-2.mjs           -> enregistre

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const BOUTIQUE = "qi1fj4-ip.myshopify.com"; // adresse permanente de la boutique Fresco (frescomarche.fr)
const VERSION_API = "2026-10";
const ESSAI = process.argv.includes("--essai");

const LECTURE = `query Lire($id: ID!) { element: product(id: $id) { id handle title descriptionHtml seo { title description } } }`;
const ECRITURE = `mutation Ecrire($data: ProductUpdateInput!) { resultat: productUpdate(product: $data) { product { id } userErrors { field message } } }`;

const FICHES = [
  {
    "nom": "Kebab de Poulet Hunkar 800g - Surgelé Halal",
    "id": "gid://shopify/Product/16033691795781",
    "handle": "kebab-poulet-hunkar-800g",
    "descriptionHtml": "<p>Lamelles de poulet marinées et grillées, prêtes à réchauffer : avec le kebab de poulet Hunkar, un snack sert un kebab, un tacos ou une assiette sans broche ni découpe. Surgelé, il se garde au congélateur jusqu'au service.</p>\n<ul>\n<li>800 g, surgelé</li>\n<li>Certifié halal</li>\n<li>À conserver à -18 °C</li>\n<li>Cuisson à la poêle, au four ou au micro-ondes</li>\n</ul>\n<p>En cuisine : sandwichs kebab, galettes, tacos, assiettes frites-salade, pizzas au poulet.</p>\n<p>Pour compléter : les <a href=\"/products/16-durums-fins-30cm-samia-1-28kg-3276650115433\">galettes durum 30 cm</a>, les <a href=\"/products/frites-9-9-2-5k-ecoprix\">frites 9/9 en 2,5 kg</a> et la <a href=\"/products/sce-blanche350g-samia\">sauce blanche halal</a>. Les autres kebabs Hunkar sont au rayon <a href=\"/collections/volaille\">volaille</a>.</p>",
    "seo": {
      "title": "Kebab de poulet Hunkar 800 g surgelé halal | Fresco Marché",
      "description": "Kebab de poulet Hunkar : lamelles marinées et grillées, surgelées, 800 g, certifié halal. Prêt à réchauffer pour kebabs, tacos et assiettes. Commande pro."
    }
  },
  {
    "nom": "Citrons Confits 500g Samia",
    "id": "gid://shopify/Product/16059538145605",
    "handle": "citrons-confits-500g-samia",
    "descriptionHtml": "<p>Les citrons confits sont un ingrédient clé de la cuisine marocaine : leur écorce, adoucie par le sel, parfume les tajines, le poulet aux olives et les poissons. Ceux-ci, de la marque Samia, sont vendus en seau refermable.</p>\n<ul>\n<li>Poids net égoutté : 500 g</li>\n<li>Seau refermable</li>\n<li>Marque Samia</li>\n</ul>\n<p>En cuisine : on utilise surtout l'écorce, rincée puis taillée en lanières ou en dés, ajoutée en fin de cuisson. Quelques dés suffisent pour relever une salade, une marinade ou une sauce.</p>\n<p>Avec les <a href=\"/products/300g-olives-vertes-denoy-samia\">olives vertes dénoyautées Samia</a>, le <a href=\"/products/samia-raz-el-hanout-100g\">ras el hanout</a> et les <a href=\"/products/samia-epices-tajine-100g\">épices pour tajine</a>. Tout est au rayon <a href=\"/collections/epicerie-salee\">épicerie salée</a>.</p>",
    "seo": {
      "title": "Citrons confits Samia 500 g pour tajines | Fresco Marché",
      "description": "Citrons confits Samia en seau refermable, 500 g égouttés : pour tajines, poulet aux olives, poissons et salades. Commande pro, livraison 7j/7 depuis Clichy."
    }
  },
  {
    "nom": "Bacon de Dinde Fumé à Poêler 8 Tranches 120g",
    "id": "gid://shopify/Product/16059535982917",
    "handle": "bacon-de-dinde-a-poeler-8tr-120g",
    "descriptionHtml": "<p>Bacon de dinde fumé, taillé dans la cuisse de dinde (93,8 % de viande). Il se saisit à la poêle en quelques secondes et se sert chaud et doré : l'alternative halal au bacon dans les burgers et les petits-déjeuners.</p>\n<ul>\n<li>8 tranches, 120 g</li>\n<li>Cuisse de dinde 93,8 %, origine UE</li>\n<li>Certifié halal</li>\n<li>22 g de protéines pour 100 g</li>\n</ul>\n<p>En cuisine : burgers, croque-monsieur, club sandwichs, salades César, œufs et brunchs.</p>\n<p>Pour les burgers : les <a href=\"/products/steak-hache-100-800g-3760195571507\">steaks hachés 100 % pur bœuf Biladi</a>. Toute la charcuterie halal est au rayon <a href=\"/collections/charcuterie\">charcuterie</a>.</p>",
    "seo": {
      "title": "Bacon de dinde fumé halal, 8 tranches 120 g | Fresco Marché",
      "description": "Bacon de dinde fumé halal à poêler, 8 tranches (120 g), 93,8 % de cuisse de dinde : pour burgers, croques et petits-déjeuners. Commande pro, livré 7j/7."
    }
  },
  {
    "nom": "Coco à Boire",
    "id": "gid://shopify/Product/16033702674757",
    "handle": "coco-a-boire-fraiche",
    "descriptionHtml": "<p>La coco à boire est une jeune noix de coco, récoltée avant que sa chair ne durcisse. On la perce pour boire son eau, légèrement sucrée, directement à la paille. Sa chair, encore tendre, se mange ensuite à la cuillère.</p>\n<ul>\n<li>Fruit frais, vendu en vrac</li>\n</ul>\n<p>Pour qui : bars à jus et cafés, restaurants exotiques, épiceries. Servie fraîche, elle fait une boisson de carte originale.</p>\n<p>Pour râper ou cuisiner, prenez plutôt la <a href=\"/products/noix-coco-piece-fraiche\">noix de coco mûre</a>. Avec la <a href=\"/products/mangue-avion\">mangue avion</a> et l'<a href=\"/products/ananas-frais\">ananas</a>, au rayon <a href=\"/collections/fruits-exotiques\">fruits exotiques</a>.</p>",
    "seo": {
      "title": "Coco à boire, jeune noix de coco fraîche | Fresco Marché",
      "description": "Coco à boire : une jeune noix de coco à percer pour boire son eau fraîche et manger sa chair tendre. Pour bars à jus, restaurants et épiceries. Commande pro."
    }
  },
  {
    "nom": "Arôme Fleur d'Oranger 50cl Samia",
    "id": "gid://shopify/Product/16033700413765",
    "handle": "fleur-d-oranger-arome-50cl-samia-3276650115976",
    "descriptionHtml": "<p>L'arôme fleur d'oranger Samia parfume les pâtisseries orientales et les desserts : cornes de gazelle, makrouts, briouates au miel, crêpes, crèmes et salades d'oranges. Le flacon de 50 cl convient aux cuisines et aux pâtisseries qui en utilisent chaque semaine.</p>\n<ul>\n<li>Flacon de 50 cl</li>\n<li>À conserver au sec, à l'abri de la chaleur</li>\n</ul>\n<p>Le parfum est puissant : quelques gouttes suffisent, dosez petit à petit.</p>\n<p>Existe aussi en <a href=\"/products/arome-rose-50cl-samia\">arôme rose</a>. Retrouvez-le au rayon <a href=\"/collections/epicerie-sucree\">épicerie sucrée</a> et parmi les produits <a href=\"/collections/produits-du-monde-maghreb-orient\">Maghreb et Orient</a>.</p>",
    "seo": {
      "title": "Arôme fleur d'oranger Samia 50 cl | Fresco Marché",
      "description": "Arôme fleur d'oranger Samia, flacon de 50 cl : pour cornes de gazelle, makrouts, crêpes, crèmes et salades d'oranges. Commande pro, livraison 7j/7."
    }
  },
  {
    "nom": "Chèvre Fouetté Nature Soignon",
    "id": "gid://shopify/Product/16033703625029",
    "handle": "chevre-fouette-nature-soignon",
    "descriptionHtml": "<p>Fromage de chèvre fouetté nature Soignon : une texture légère et crémeuse, qui s'étale telle quelle, sans être travaillée.</p>\n<ul>\n<li>Marque Soignon</li>\n<li>Fromage frais, à conserver au réfrigérateur</li>\n</ul>\n<p>En cuisine : tartines et bruschettas, verrines, wraps, burgers au chèvre, ou détendu avec un peu de crème pour une sauce.</p>\n<p>Au même rayon : la <a href=\"/products/feta-grecque-tranchee-150g\">feta grecque tranchée</a> et la <a href=\"/products/mozzarella-125g-belle-france\">mozzarella</a>. Tous les fromages sont au rayon <a href=\"/collections/fromage\">fromage</a>.</p>",
    "seo": {
      "title": "Chèvre fouetté nature Soignon, à tartiner | Fresco Marché",
      "description": "Chèvre fouetté nature Soignon, texture légère à tartiner : pour tartines, bruschettas, verrines, wraps et burgers au chèvre. Commande pro, livraison 7j/7."
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

// 1. Lecture et contrôle des fiches avant toute écriture
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
const fichier = `sauvegarde-fiches-lot-2-avant-${new Date().toISOString().slice(0, 10)}.json`;
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
