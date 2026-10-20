// Enregistre dans Shopify les textes des 8 pages « Livraison [ville] » de frescomarche.fr validés par Rachid le 20/10/2026.
// Pour chaque page : le texte de la ville, le titre Google et la description Google.
// Le titre affiché en haut de la page et son adresse ne changent pas.
//
// À lancer sur votre ordinateur, pas sur le serveur :
//   1. shopify store auth --store qi1fj4-ip.myshopify.com --scopes read_online_store_pages,write_online_store_pages
//      (le navigateur s'ouvre : cliquez « Installer » ou « Autoriser »)
//   2. node enregistrer-livraison.mjs --essai   -> vérifie les 8 pages sans rien modifier
//      node enregistrer-livraison.mjs           -> enregistre les 8 pages

import { execFileSync } from "node:child_process";

const BOUTIQUE = "qi1fj4-ip.myshopify.com"; // adresse permanente de la boutique Fresco (frescomarche.fr)
const ESSAI = process.argv.includes("--essai");

const LECTURE = `query LirePage($id: ID!) {
  page(id: $id) {
    id handle title body
    titre: metafield(namespace: "global", key: "title_tag") { type value }
    desc: metafield(namespace: "global", key: "description_tag") { type value }
  }
}`;

const MUTATION = `mutation EnregistrerPage($id: ID!, $page: PageUpdateInput!) {
  pageUpdate(id: $id, page: $page) {
    page { id handle title }
    userErrors { code field message }
  }
}`;

const PAGES = [
  {
    "ville": "Clichy",
    "handle": "livraison-clichy",
    "id": "gid://shopify/Page/726675915077",
    "body": "<p><strong>Fresco Marché est installé à Clichy, au 120 rue Martre.</strong> C'est de ce dépôt que partent toutes nos tournées : pour un restaurant, un snack ou une épicerie de Clichy, la marchandise ne quitte pas la commune.</p>\n\n<h2>Quatre créneaux par jour, même le dimanche</h2>\n<p>Vous choisissez votre créneau à la commande : 9h-10h, 12h30-13h30, 17h-18h ou 20h30-21h30, du lundi au dimanche. La commande reste ouverte jusqu'à 30 minutes avant le début du créneau : à 8h30, il est encore temps pour la livraison de 9h.</p>\n\n<h2>Un oubli en plein service ?</h2>\n<p>Il manque de la crème, des citrons ou du persil au moment de lancer le service : la livraison express « dès que possible » (19,90 €) est faite pour ce cas. Pour les commandes prévues à l'avance, le créneau standard suffit.</p>\n\n<h2>Les bases de la cuisine, au même endroit</h2>\n<p>Oignons, pommes de terre, tomates et herbes fraîches au rayon <a href=\"/collections/legumes\">légumes</a> ; agrumes et fruits de saison au rayon <a href=\"/collections/fruits\">fruits</a> ; lait, beurre, crème et œufs en <a href=\"/collections/cremerie\">crémerie</a> ; huile, riz, semoule et conserves en <a href=\"/collections/epicerie-salee\">épicerie salée</a>. Les viandes et la charcuterie sont halal, comme tout le catalogue : voir la <a href=\"/collections/boucherie\">boucherie</a>.</p>\n\n<h2>Questions des pros de Clichy</h2>\n<h3>Quel créneau choisir pour le service du midi ?</h3>\n<p>Le créneau 9h-10h laisse le temps de ranger la chambre froide et de faire la mise en place. Pour le soir, prenez 17h-18h.</p>\n<h3>Le dépôt de Clichy livre-t-il aussi les villes voisines ?</h3>\n<p>Oui, dans un rayon de 5,5 km autour du dépôt : <a href=\"/pages/livraison-levallois\">Levallois-Perret</a>, <a href=\"/pages/livraison-asnieres\">Asnières-sur-Seine</a>, <a href=\"/pages/livraison-gennevilliers\">Gennevilliers</a>, <a href=\"/pages/livraison-saint-ouen\">Saint-Ouen-sur-Seine</a>, <a href=\"/pages/livraison-neuilly\">Neuilly-sur-Seine</a>, et les <a href=\"/pages/livraison-paris-17\">17e</a> et <a href=\"/pages/livraison-paris-18\">18e</a> arrondissements de Paris.</p>\n\n<p><strong>Conditions</strong> : commande minimum 50 € HT ; livraison 10 € HT, offerte dès 100 € HT ; express « dès que possible » 19,90 €. Tout est détaillé dans la <a href=\"/pages/faq\">FAQ</a>.</p>",
    "seo": {
      "title": "Grossiste alimentaire à Clichy | Fresco Marché",
      "description": "Grossiste pro installé au 120 rue Martre à Clichy : frais, crémerie, épicerie, viandes halal. Livraison 7j/7 sur 4 créneaux ou en express. Dès 50 € HT."
    }
  },
  {
    "ville": "Asnières-sur-Seine",
    "handle": "livraison-asnieres",
    "id": "gid://shopify/Page/726677258565",
    "body": "<p><strong>Asnières-sur-Seine est sur l'autre rive, face à Clichy.</strong> Le pont de Clichy relie les deux villes. Fresco Marché livre les restaurants, snacks et épiceries d'Asnières, du centre-ville au quartier de la gare.</p>\n\n<h2>Un créneau pour le midi, un pour le soir</h2>\n<p>Un snack ouvert midi et soir peut se faire livrer deux fois dans la journée : une commande sur 9h-10h pour le déjeuner, une autre sur 17h-18h pour le soir. Chaque commande est indépendante et doit atteindre le minimum de 50 € HT. Les créneaux 12h30-13h30 et 20h30-21h30 complètent l'offre, du lundi au dimanche.</p>\n\n<h2>Burgers, kebabs et frites</h2>\n<ul>\n<li>Steaks hachés 100 % pur bœuf et burgers à l'oignon en boîtes de 800 g, au rayon <a href=\"/collections/boeuf\">bœuf</a>.</li>\n<li>Kebab de poulet et kebab grill volaille Hunkar 800 g, halal, au rayon <a href=\"/collections/volaille\">volaille</a>.</li>\n<li>Pains burger et hot-dog, sauces burger, algérienne et blanche, au rayon <a href=\"/collections/epicerie-salee\">épicerie salée</a>.</li>\n<li>Frites 9/9 en sac de 2,5 kg au rayon <a href=\"/collections/surgeles\">surgelés</a>, cheddar râpé au rayon <a href=\"/collections/fromage\">fromage</a>.</li>\n</ul>\n\n<h2>Questions des pros d'Asnières</h2>\n<h3>Livrez-vous tout Asnières ?</h3>\n<p>Oui, toute la ville : elle tient largement dans notre rayon de livraison de 5,5 km autour du dépôt.</p>\n<h3>Deux livraisons dans la journée, deux fois les frais ?</h3>\n<p>Chaque commande est livrée séparément : sous 100 € HT, chacune compte 10 € HT de livraison. Une seule commande de 100 € HT ou plus est livrée gratuitement.</p>\n\n<p><strong>Conditions</strong> : commande minimum 50 € HT ; livraison 10 € HT, offerte dès 100 € HT ; express « dès que possible » 19,90 €. Tout est détaillé dans la <a href=\"/pages/faq\">FAQ</a>.</p>",
    "seo": {
      "title": "Grossiste alimentaire à Asnières-sur-Seine | Fresco Marché",
      "description": "Snacks et restaurants d'Asnières-sur-Seine : pains burger, steaks hachés et kebab halal, frites, légumes. Livrés de Clichy 7j/7, midi et soir. Dès 50 € HT."
    }
  },
  {
    "ville": "Gennevilliers",
    "handle": "livraison-gennevilliers",
    "id": "gid://shopify/Page/726677291333",
    "body": "<p><strong>À Gennevilliers, les cuisines tournent souvent à gros volume.</strong> Snacks, restauration d'entreprise des zones d'activités, restaurants et épiceries de la ville : Fresco Marché livre depuis son dépôt de Clichy des produits en grands conditionnements, pour moins de manutention et des réassorts plus espacés.</p>\n\n<h2>Les grands formats du catalogue</h2>\n<ul>\n<li>Pommes de terre et oignons en filets de 5 kg, au rayon <a href=\"/collections/legumes\">légumes</a>.</li>\n<li>Frites 9/9 en sacs de 2,5 kg, au rayon <a href=\"/collections/surgeles\">surgelés</a>.</li>\n<li>Riz parfumé en sacs de 5 kg, huile de tournesol en bidon de 5 L et double concentré de tomate 700 g, en <a href=\"/collections/epicerie-salee\">épicerie salée</a>.</li>\n<li>Kebab Hunkar 800 g et galettes durum 30 cm par 16, au rayon <a href=\"/collections/produits-du-monde-turquie\">Turquie</a>. Comme tout le catalogue, ils sont halal.</li>\n<li>Œufs frais par plateaux de 30, au rayon <a href=\"/collections/oeufs\">œufs</a>.</li>\n</ul>\n\n<h2>Recevoir avant le rush</h2>\n<p>Pour une cantine ou un snack qui sert dès 11h30, le créneau 9h-10h est le plus sûr. Le créneau 20h30-21h30 permet de faire le plein la veille, quand l'équipe a fini le service. Les quatre créneaux (9h-10h, 12h30-13h30, 17h-18h, 20h30-21h30) sont ouverts 7 jours sur 7.</p>\n\n<h2>Questions des pros de Gennevilliers</h2>\n<h3>Toute la ville est-elle livrée ?</h3>\n<p>Oui. Nous livrons à 5,5 km à vol d'oiseau autour du dépôt, ce qui couvre tout Gennevilliers : le centre, le Luth, les Grésillons et le port. Le site confirme votre adresse au moment de commander.</p>\n<h3>La livraison est-elle offerte sur une grosse commande ?</h3>\n<p>Oui, dès 100 € HT de commande.</p>\n\n<p><strong>Conditions</strong> : commande minimum 50 € HT ; livraison 10 € HT, offerte dès 100 € HT ; express « dès que possible » 19,90 €. Tout est détaillé dans la <a href=\"/pages/faq\">FAQ</a>.</p>",
    "seo": {
      "title": "Grossiste alimentaire à Gennevilliers | Fresco Marché",
      "description": "Grands formats pour les pros de Gennevilliers : pommes de terre et oignons 5 kg, frites 2,5 kg, riz 5 kg, huile 5 L, kebab halal. Livré 7j/7, dès 50 € HT."
    }
  },
  {
    "ville": "Levallois-Perret",
    "handle": "livraison-levallois",
    "id": "gid://shopify/Page/726677324101",
    "body": "<p><strong>Levallois-Perret et Clichy se touchent.</strong> Nos tournées partent du 120 rue Martre et desservent Levallois chaque jour, pour les restaurants, traiteurs, snacks et épiceries de la ville.</p>\n\n<h2>Caler la livraison sur le déjeuner</h2>\n<p>Levallois compte beaucoup de bureaux, et donc un service du midi chargé. Deux créneaux s'y prêtent :</p>\n<ul>\n<li><strong>9h-10h</strong> : la marchandise arrive avant la mise en place du déjeuner.</li>\n<li><strong>20h30-21h30</strong> : vous êtes livré après le service et tout est prêt pour le lendemain matin.</li>\n</ul>\n<p>Les créneaux 12h30-13h30 et 17h-18h restent disponibles, 7 jours sur 7.</p>\n\n<h2>Pour les salades, bowls et formules</h2>\n<p>Salade iceberg, batavia, tomates cerises, concombres et poivrons au rayon <a href=\"/collections/legumes\">légumes</a> ; basilic, menthe, coriandre et aneth en <a href=\"/collections/herbes-aromatiques\">herbes aromatiques</a> ; avocats et mangues en <a href=\"/collections/fruits-exotiques\">fruits exotiques</a> ; mozzarella, feta et emmental râpé au rayon <a href=\"/collections/fromage\">fromage</a>. Pour accompagner les formules, sodas et eaux au rayon <a href=\"/collections/boissons\">boissons</a>.</p>\n\n<h2>Questions des pros de Levallois</h2>\n<h3>Peut-on être livré le soir pour le lendemain ?</h3>\n<p>Oui, c'est le rôle du créneau 20h30-21h30. Prévoyez quelqu'un sur place pour réceptionner et ranger le frais.</p>\n<h3>Les viandes sont-elles halal ?</h3>\n<p>Oui, tout le catalogue est halal : volaille, bœuf, kebab et charcuterie.</p>\n\n<p><strong>Conditions</strong> : commande minimum 50 € HT ; livraison 10 € HT, offerte dès 100 € HT ; express « dès que possible » 19,90 €. Tout est détaillé dans la <a href=\"/pages/faq\">FAQ</a>.</p>",
    "seo": {
      "title": "Grossiste alimentaire à Levallois-Perret | Fresco Marché",
      "description": "Restaurants et traiteurs de Levallois-Perret : légumes, crémerie, épicerie et viandes halal livrés depuis Clichy, 7j/7 de 9h à 21h30. Dès 50 € HT."
    }
  },
  {
    "ville": "Neuilly-sur-Seine",
    "handle": "livraison-neuilly",
    "id": "gid://shopify/Page/726677356869",
    "body": "<p><strong>À Neuilly-sur-Seine, une réception se joue souvent sur les produits.</strong> Traiteurs, restaurants et épiceries fines trouvent chez Fresco Marché les fromages italiens, les fruits exotiques et les herbes fraîches d'un buffet soigné, livrés depuis notre dépôt de Clichy.</p>\n\n<h2>Pour les buffets et les cartes italiennes</h2>\n<p>Burrata italienne, mozzarella di bufala en billes et parmesan affiné 24 mois sont au rayon <a href=\"/collections/produits-du-monde-europe-du-sud\">Europe du Sud</a>. Mangue, papaye, ananas, kiwi jaune et noix de coco garnissent les plateaux de fruits : voir les <a href=\"/collections/fruits-exotiques\">fruits exotiques</a>. Basilic, aneth, thym et menthe sont en <a href=\"/collections/herbes-aromatiques\">herbes aromatiques</a>, et la crème fleurette 30 % au rayon <a href=\"/collections/lait-beurre-creme\">lait, beurre et crème</a>.</p>\n\n<h2>Livré à l'heure de l'événement</h2>\n<p>Pour une réception en soirée, le créneau 17h-18h livre les produits frais quelques heures avant l'arrivée des invités. Pour un déjeuner, choisissez 9h-10h. Les mariages et réceptions du samedi et du dimanche sont couverts : nous livrons 7 jours sur 7, sur quatre créneaux (9h-10h, 12h30-13h30, 17h-18h, 20h30-21h30).</p>\n\n<h2>Questions des traiteurs de Neuilly</h2>\n<h3>Peut-on préparer la commande plusieurs jours avant la réception ?</h3>\n<p>Oui. Vous choisissez la date et le créneau au moment de commander.</p>\n<h3>Les produits sont-ils halal ?</h3>\n<p>Oui, tout le catalogue est halal, viandes et charcuterie comprises.</p>\n<h3>Livrez-vous tout Neuilly ?</h3>\n<p>Oui, jusqu'aux abords du bois de Boulogne : notre zone, 5,5 km à vol d'oiseau autour du dépôt, couvre toute la ville.</p>\n\n<p><strong>Conditions</strong> : commande minimum 50 € HT ; livraison 10 € HT, offerte dès 100 € HT ; express « dès que possible » 19,90 €. Tout est détaillé dans la <a href=\"/pages/faq\">FAQ</a>.</p>",
    "seo": {
      "title": "Grossiste alimentaire à Neuilly-sur-Seine | Fresco Marché",
      "description": "Traiteurs et restaurants de Neuilly-sur-Seine : burrata, mozzarella di bufala, parmesan 24 mois, fruits exotiques. Livraison 7j/7 depuis Clichy, dès 50 € HT."
    }
  },
  {
    "ville": "Saint-Ouen-sur-Seine",
    "handle": "livraison-saint-ouen",
    "id": "gid://shopify/Page/726677389637",
    "body": "<p><strong>Saint-Ouen-sur-Seine est la commune voisine, à l'est de Clichy.</strong> Des Puces aux Docks en passant par le centre-ville, Fresco Marché livre les snacks, restaurants, cafés et épiceries de la ville depuis son dépôt du 120 rue Martre.</p>\n\n<h2>Le week-end, on livre aussi</h2>\n<p>Le marché aux puces attire son public le samedi, le dimanche et le lundi : c'est souvent là que les stocks fondent. Nos quatre créneaux, 9h-10h, 12h30-13h30, 17h-18h et 20h30-21h30, sont ouverts 7 jours sur 7. Un samedi chargé peut donc se terminer par une livraison le samedi soir, pour repartir le dimanche avec des réserves pleines.</p>\n\n<h2>Sandwichs, wraps et boissons</h2>\n<p>Pain libanais au rayon <a href=\"/collections/produits-du-monde-maghreb-orient\">Maghreb et Orient</a>. Sauce blanche, sauce algérienne, sauce burger et sauce barbecue en <a href=\"/collections/epicerie-salee\">épicerie salée</a>. Délice de dinde et de poulet, bacon de dinde, tous halal, au rayon <a href=\"/collections/charcuterie\">charcuterie</a>. Coca-Cola, Orangina, Boga, Ice Tea et eaux de source au rayon <a href=\"/collections/boissons\">boissons</a>.</p>\n\n<h2>Questions des pros de Saint-Ouen</h2>\n<h3>Jusqu'à quelle heure puis-je commander pour le soir ?</h3>\n<p>Jusqu'à 30 minutes avant le début du créneau : 16h30 pour 17h-18h, 20h pour 20h30-21h30.</p>\n<h3>Et si j'ai besoin de marchandise tout de suite ?</h3>\n<p>Choisissez la livraison express « dès que possible », à 19,90 €.</p>\n\n<p><strong>Conditions</strong> : commande minimum 50 € HT ; livraison 10 € HT, offerte dès 100 € HT ; express « dès que possible » 19,90 €. Tout est détaillé dans la <a href=\"/pages/faq\">FAQ</a>.</p>",
    "seo": {
      "title": "Grossiste alimentaire à Saint-Ouen-sur-Seine | Fresco Marché",
      "description": "Snacks et restaurants de Saint-Ouen-sur-Seine : livraison le week-end aussi, 4 créneaux par jour depuis Clichy. Pain libanais, sauces, boissons. Dès 50 € HT."
    }
  },
  {
    "ville": "Paris 17e",
    "handle": "livraison-paris-17",
    "id": "gid://shopify/Page/726677422405",
    "body": "<p><strong>Le 17e arrondissement touche Clichy.</strong> Depuis notre dépôt de la rue Martre, nous livrons les Batignolles, les Épinettes, les Ternes, la Plaine-Monceau et la porte de Clichy.</p>\n\n<h2>Bistrots, brunchs et cuisine du marché</h2>\n<p>Pour une carte qui change avec les saisons : butternut, potimarron, poireaux et champignons l'automne, tomates, courgettes et aubergines l'été, au rayon <a href=\"/collections/legumes\">légumes</a>. Pour les brunchs, œufs frais par plateaux de 30 au rayon <a href=\"/collections/oeufs\">œufs</a>, beurre doux, crème fleurette et lait au rayon <a href=\"/collections/lait-beurre-creme\">lait, beurre et crème</a>. Fraises, framboises et myrtilles pour les desserts au rayon <a href=\"/collections/fruits\">fruits</a>.</p>\n\n<h2>Le bon créneau dans le 17e</h2>\n<p>Le samedi et le dimanche, le créneau 9h-10h arrive avant l'ouverture des brunchs. En semaine, 17h-18h prépare le service du soir. Les quatre créneaux (9h-10h, 12h30-13h30, 17h-18h, 20h30-21h30) sont proposés tous les jours.</p>\n\n<h2>Questions des pros du 17e</h2>\n<h3>Livrez-vous tout l'arrondissement ?</h3>\n<p>Oui, l'arrondissement entier, de la porte de Clichy à l'Étoile.</p>\n<h3>La viande est-elle halal ?</h3>\n<p>Oui, comme tout le catalogue. Bœuf, volaille et charcuterie sont au rayon <a href=\"/collections/boucherie\">boucherie</a>.</p>\n\n<p><strong>Conditions</strong> : commande minimum 50 € HT ; livraison 10 € HT, offerte dès 100 € HT ; express « dès que possible » 19,90 €. Tout est détaillé dans la <a href=\"/pages/faq\">FAQ</a>.</p>",
    "seo": {
      "title": "Grossiste alimentaire à Paris 17e | Fresco Marché",
      "description": "Bistrots et restaurants du 17e (Batignolles, Épinettes, Ternes) : crémerie, œufs, légumes de saison et viandes halal livrés 7j/7 depuis Clichy. Dès 50 € HT."
    }
  },
  {
    "ville": "Paris 18e",
    "handle": "livraison-paris-18",
    "id": "gid://shopify/Page/726677455173",
    "body": "<p><strong>Dans le 18e, de la Goutte-d'Or à La Chapelle, les cuisines du monde sont chez elles.</strong> Fresco Marché livre aux épiceries, restaurants et snacks de l'arrondissement, de Montmartre à la porte de Clignancourt, les produits d'Afrique, du Maghreb et de Turquie, tous halal.</p>\n\n<h2>Afrique, Maghreb, Turquie</h2>\n<ul>\n<li><strong>Afrique</strong> : manioc, igname, gombo, banane plantain, piment antillais et pâte d'arachide, au rayon <a href=\"/collections/produits-du-monde-afrique\">produits d'Afrique</a>.</li>\n<li><strong>Maghreb et Orient</strong> : couscous fin et moyen, semoule, feuilles de brick, meloui, harissa et huile d'olive, au rayon <a href=\"/collections/produits-du-monde-maghreb-orient\">Maghreb et Orient</a>.</li>\n<li><strong>Turquie</strong> : sucuk, pastirma de Kayseri, fromage Erzurum, yaourt à la grecque et galettes durum, au rayon <a href=\"/collections/produits-du-monde-turquie\">Turquie</a>.</li>\n<li><strong>Viandes halal</strong> : bœuf, volaille, kebab et charcuterie au rayon <a href=\"/collections/boucherie\">boucherie</a>.</li>\n</ul>\n\n<h2>Réapprovisionner une épicerie</h2>\n<p>Beaucoup d'épiceries de quartier font l'essentiel de leurs ventes en fin de journée. Le créneau 12h30-13h30 remplit les étals avant cette affluence ; 17h-18h permet un deuxième passage. Pour un restaurant, 9h-10h reste le plus simple. Les quatre créneaux sont ouverts 7 jours sur 7.</p>\n\n<h2>Questions des pros du 18e</h2>\n<h3>Les légumes africains sont-ils frais ?</h3>\n<p>Oui : manioc, igname et gombo sont vendus frais au rayon <a href=\"/collections/legumes\">légumes</a>, la banane plantain au rayon <a href=\"/collections/fruits-exotiques\">fruits exotiques</a>.</p>\n<h3>Livrez-vous Montmartre et la Goutte-d'Or ?</h3>\n<p>Oui, comme tout le 18e, de Clignancourt à La Chapelle et jusqu'à la rue d'Aubervilliers.</p>\n\n<p><strong>Conditions</strong> : commande minimum 50 € HT ; livraison 10 € HT, offerte dès 100 € HT ; express « dès que possible » 19,90 €. Tout est détaillé dans la <a href=\"/pages/faq\">FAQ</a>.</p>",
    "seo": {
      "title": "Grossiste alimentaire à Paris 18e | Fresco Marché",
      "description": "Épiceries et restaurants du 18e : manioc, igname, gombo, plantain, couscous, brick, sucuk et viandes halal. Livraison 7j/7 depuis Clichy, dès 50 € HT."
    }
  }
];

function executer(requete, variables, cle, ecriture) {
  const args = ["store", "execute", "--store", BOUTIQUE, "--json", "--no-color", "--query", requete, "--variables", JSON.stringify(variables)];
  if (ecriture) args.splice(4, 0, "--allow-mutations");
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

let ok = 0;
const erreurs = [];
for (const p of PAGES) {
  try {
    const avant = executer(LECTURE, { id: p.id }, "page", false);
    if (!avant) throw new Error("page introuvable");
    if (avant.handle !== p.handle) throw new Error(`l'identifiant mène à « ${avant.handle} », pas à « ${p.handle} » : rien n'est modifié`);
    if (ESSAI) {
      console.log(`\n— ${p.ville} (/pages/${p.handle}) : page trouvée, titre « ${avant.title} »`);
      console.log(`  Titre Google : ${avant.titre?.value || "(vide)"}  ->  ${p.seo.title}`);
      console.log(`  Description Google : ${p.seo.description}`);
      ok += 1;
      continue;
    }
    const page = {
      body: p.body,
      metafields: [
        { namespace: "global", key: "title_tag", type: avant.titre?.type || "single_line_text_field", value: p.seo.title },
        { namespace: "global", key: "description_tag", type: avant.desc?.type || "single_line_text_field", value: p.seo.description },
      ],
    };
    const res = executer(MUTATION, { id: p.id, page }, "pageUpdate", true);
    if (res.userErrors?.length) throw new Error(res.userErrors.map((e) => e.message).join(" ; "));
    if (!res.page) throw new Error("réponse inattendue");
    const apres = executer(LECTURE, { id: p.id }, "page", false);
    const conforme = texte(apres.body) === texte(p.body) && apres.titre?.value === p.seo.title && apres.desc?.value === p.seo.description;
    ok += 1;
    console.log(`${conforme ? "OK " : "OK (à vérifier)"}  ${p.ville}`);
  } catch (e) {
    erreurs.push(p.ville);
    console.log(`ERREUR  ${p.ville} : ${String(e.stderr || e.message).trim().slice(0, 300)}`);
  }
}
console.log(`\n${ok} page(s) sur ${PAGES.length} ${ESSAI ? "trouvée(s). Rien n'a été modifié." : "enregistrée(s)."}`);
if (erreurs.length) { console.log("À reprendre : " + erreurs.join(", ")); process.exitCode = 1; }
