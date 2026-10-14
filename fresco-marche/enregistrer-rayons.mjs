// Enregistre dans Shopify les textes des 25 rayons de frescomarche.fr validés par Rachid le 14/10/2026.
// Pour chaque rayon : description, titre Google et description Google.
//
// À lancer sur votre ordinateur, pas sur le serveur :
//   1. npm install -g @shopify/cli
//   2. shopify store auth --store fresco-marche.myshopify.com --scopes read_products,write_products
//      (le navigateur s'ouvre : cliquez « Installer » ou « Autoriser »)
//   3. node enregistrer-rayons.mjs            -> enregistre les 25 rayons
//      node enregistrer-rayons.mjs --essai    -> affiche seulement ce qui serait enregistré

import { execFileSync } from "node:child_process";

const BOUTIQUE = "fresco-marche.myshopify.com";
const ESSAI = process.argv.includes("--essai");

const MUTATION = `mutation EnregistrerRayon($input: CollectionInput!) {
  collectionUpdate(input: $input) {
    collection { id handle title }
    userErrors { field message }
  }
}`;

const RAYONS = [
  {
    "handle": "fruits",
    "id": "gid://shopify/Collection/690565906757",
    "descriptionHtml": "<p>Fruits frais et fruits secs pour les professionnels de la restauration : bananes, agrumes, pommes, poires, melons, fruits rouges et fruits exotiques selon la saison, mais aussi dattes, amandes, noix de cajou et pistaches. En vrac, à la pièce ou en filet, pour cuisines, snacks, pâtisseries et épiceries. Commande en ligne réservée aux professionnels, livraison depuis notre dépôt de Clichy.</p>",
    "seo": {
      "title": "Grossiste fruits frais et secs à Clichy | Fresco Marché",
      "description": "Fruits frais et secs pour professionnels : agrumes, pommes, melons, fruits exotiques, dattes, amandes… En vrac, pièce ou filet. Commande pro à Clichy."
    }
  },
  {
    "handle": "legumes",
    "id": "gid://shopify/Collection/690565939525",
    "descriptionHtml": "<p>Légumes frais pour les cuisines professionnelles : pommes de terre (dont spéciales frites en 2,5 kg), oignons en filet de 1 à 5 kg, tomates, poivrons, courgettes, salades, herbes fraîches en botte et légumes du monde comme l'igname, le manioc, le gombo ou la patate douce. En vrac ou conditionnés. Commande en ligne réservée aux professionnels, livraison depuis notre dépôt de Clichy.</p>",
    "seo": {
      "title": "Grossiste légumes frais à Clichy (92) | Fresco Marché",
      "description": "Légumes frais pour restaurants et snacks : pommes de terre, oignons en filet, tomates, poivrons, salades, herbes en botte. Vrac ou filet, commande pro."
    }
  },
  {
    "handle": "cremerie",
    "id": "gid://shopify/Collection/690654249285",
    "descriptionHtml": "<p>Crémerie pour la restauration : lait en brique ou en pack, beurre, crème fleurette et crème fraîche, fromages pour pizzas et sandwichs (mozzarella, cube spécial pizza, cheddar et emmental râpés, feta, burrata), fromages en portions et en tranches, yaourts, ayran et kéfir. Marques nationales et Belle France. Commande en ligne réservée aux professionnels, livraison depuis notre dépôt de Clichy.</p>",
    "seo": {
      "title": "Crémerie et fromages pour professionnels | Fresco Marché",
      "description": "Lait, beurre, crème, mozzarella, fromage pizza, cheddar râpé, feta, ayran, kéfir… La crémerie des restaurants et snacks, en commande pro à Clichy."
    }
  },
  {
    "handle": "epicerie-salee",
    "id": "gid://shopify/Collection/690654806341",
    "descriptionHtml": "<p>Épicerie salée pour les cuisines professionnelles : épices et mélanges Samia (cumin, curcuma, épices pour kebab, tajine ou couscous), couscous et semoules, riz en sacs jusqu'à 5 kg, concentré de tomate Tamek, conserves, bouillons, pains durum, chips et cornichons. L'essentiel du garde-manger des restaurants, snacks et traiteurs. Commande en ligne réservée aux professionnels, livraison depuis notre dépôt de Clichy.</p>",
    "seo": {
      "title": "Épicerie salée pour restaurants et snacks | Fresco Marché",
      "description": "Épices Samia, couscous, semoule, riz 5 kg, concentré de tomate Tamek, conserves, bouillons, durums… L'épicerie salée des restaurants et snacks, commande pro."
    }
  },
  {
    "handle": "charcuterie",
    "id": "gid://shopify/Collection/690654576965",
    "descriptionHtml": "<p>Charcuterie halal de volaille et de bœuf pour sandwichs, pizzas et plats : délices de poulet et de dinde, bacon et lardons de volaille, chorizo, saucisson, salami, ainsi que les spécialités turques sucuk et pastirma. Isla Délice, Çesnili, Sibel et d'autres marques. Commande en ligne réservée aux professionnels, livraison depuis notre dépôt de Clichy.</p>",
    "seo": {
      "title": "Charcuterie halal de volaille et bœuf | Fresco Marché",
      "description": "Charcuterie halal : délices de poulet et dinde, bacon de dinde, chorizo, saucisson, sucuk, pastirma… Pour restaurants et snacks, en commande pro à Clichy."
    }
  },
  {
    "handle": "boucherie",
    "id": "gid://shopify/Collection/690654347589",
    "descriptionHtml": "<p>Viandes halal pour la restauration rapide : viande de kebab de poulet Hünkar en 800 g, lamelles de kebab bœuf-volaille Hünkar, steaks hachés 100 % pur bœuf et burgers de bœuf Biladi en 800 g, allumettes de poulet et dés de dinde, délices de volaille en tranches. Détail par espèce dans les rayons Volaille et Bœuf. Commande en ligne réservée aux professionnels, livraison depuis notre dépôt de Clichy.</p>",
    "seo": {
      "title": "Viande halal : kebab, burgers, steaks hachés | Fresco Marché",
      "description": "Viande halal pour snacks et restaurants : kebab de poulet Hünkar, lamelles bœuf-volaille, steaks hachés et burgers Biladi 800 g… Commande pro à Clichy."
    }
  },
  {
    "handle": "volaille",
    "id": "gid://shopify/Collection/690654380357",
    "descriptionHtml": "<p>Volaille halal pour snacks et restaurants : viande de kebab de poulet Hünkar en 800 g, allumettes de poulet et dés de dinde, délices et tranchés de poulet et de dinde pour les sandwichs. Commande en ligne réservée aux professionnels, livraison depuis notre dépôt de Clichy.</p>",
    "seo": {
      "title": "Volaille halal : kebab, poulet, dinde | Fresco Marché",
      "description": "Volaille halal : kebab de poulet Hünkar, allumettes de poulet, dés de dinde, délices de dinde et de poulet… Pour snacks et restaurants, commande pro à Clichy."
    }
  },
  {
    "handle": "boeuf",
    "id": "gid://shopify/Collection/690654413125",
    "descriptionHtml": "<p>Bœuf halal pour burgers et kebabs : steaks hachés 100 % pur bœuf, burgers de bœuf nature ou à l'oignon Biladi en 800 g et lamelles de kebab bœuf et volaille Hünkar. Surgelés, prêts à cuisiner pour la restauration rapide. Commande en ligne réservée aux professionnels, livraison depuis notre dépôt de Clichy.</p>",
    "seo": {
      "title": "Steaks hachés et burgers de bœuf halal | Fresco Marché",
      "description": "Bœuf halal surgelé : steaks hachés 100 % pur bœuf, burgers Biladi nature ou à l'oignon 800 g, lamelles de kebab Hünkar. Pour snacks, commande pro à Clichy."
    }
  },
  {
    "handle": "surgeles",
    "id": "gid://shopify/Collection/690654773573",
    "descriptionHtml": "<p>Surgelés pour la restauration : frites en 1 kg et 2,5 kg, viandes halal (kebab, steaks hachés, burgers de bœuf), légumes surgelés (haricots verts, chou-fleur, persil), crêpes feuilletées msemen et meloui, künefe et tartes Almondy pour les desserts. Commande en ligne réservée aux professionnels, livraison depuis notre dépôt de Clichy.</p>",
    "seo": {
      "title": "Surgelés pour pros : frites, kebab, msemen | Fresco Marché",
      "description": "Frites 2,5 kg, kebab, steaks hachés, burgers, légumes surgelés, msemen, meloui, künefe, tartes Almondy… Les surgelés des snacks et restaurants, commande pro."
    }
  },
  {
    "handle": "boissons",
    "id": "gid://shopify/Collection/690655789381",
    "descriptionHtml": "<p>Boissons pour votre carte : sodas en 1,5 L (Coca-Cola, Orangina, Boga, Selecto, limonade), thé glacé, mini Coca-Cola en 20 cl, eaux de source et minérales en pack. Pour restaurants, snacks et épiceries. Commande en ligne réservée aux professionnels, livraison depuis notre dépôt de Clichy.</p>",
    "seo": {
      "title": "Boissons pour restaurants et snacks | Fresco Marché",
      "description": "Coca-Cola, Orangina, Boga, Selecto, Lipton Ice Tea, Cristaline, Hépar… Sodas et eaux en bouteilles et packs pour restaurants et snacks, en commande pro."
    }
  },
  {
    "handle": "epicerie-sucree",
    "id": "gid://shopify/Collection/690655428933",
    "descriptionHtml": "<p>Épicerie sucrée pour la pâtisserie et le service : sucres, levures, arômes fleur d'oranger et rose, miels, pâtes à tartiner, pâte d'arachide, cafés, thés verts et infusions, biscuits et muesli. Pour restaurants, salons de thé, traiteurs et épiceries. Commande en ligne réservée aux professionnels, livraison depuis notre dépôt de Clichy.</p>",
    "seo": {
      "title": "Sucre, café, thé et miel pour professionnels | Fresco Marché",
      "description": "Sucre, levures, arôme fleur d'oranger, miel, pâte à tartiner, café, thé vert, biscuits… L'épicerie sucrée des restaurants et salons de thé, en commande pro."
    }
  },
  {
    "handle": "produits-du-monde",
    "id": "gid://shopify/Collection/690566070597",
    "descriptionHtml": "<p>Produits du monde pour une carte authentique : couscous, semoules, feuilles de brick et meloui du Maghreb ; concentré de tomate Tamek, sucuk, pastirma et fromage Erzurum de Turquie ; igname, manioc, gombo et pâte d'arachide d'Afrique et des Antilles ; burrata, mozzarella et parmesan d'Europe du Sud. Commande en ligne réservée aux professionnels, livraison depuis notre dépôt de Clichy.</p>",
    "seo": {
      "title": "Produits du monde pour restaurants et snacks | Fresco Marché",
      "description": "Couscous, semoule, feuilles de brick, Tamek, sucuk, pastirma, igname, manioc, burrata… Les produits du Maghreb, de Turquie et d'Afrique pour les pros."
    }
  },
  {
    "handle": "produits-du-monde-maghreb-orient",
    "id": "gid://shopify/Collection/690653724997",
    "descriptionHtml": "<p>Épicerie du Maghreb et d'Orient : couscous fin et moyen Dari, semoules Renard, feuilles de brick, crêpes meloui, sardines à la harissa, sauce Alger, arôme fleur d'oranger, huile d'olive Oued Souss, lait fermenté et pain libanais. Pour restaurants, snacks et traiteurs. Commande en ligne réservée aux professionnels, livraison depuis notre dépôt de Clichy.</p>",
    "seo": {
      "title": "Produits du Maghreb et d'Orient pour pros | Fresco Marché",
      "description": "Couscous Dari, semoule Renard, feuilles de brick, meloui, sauce Alger, huile d'olive Oued Souss, pain libanais… L'épicerie orientale des pros, à Clichy."
    }
  },
  {
    "handle": "produits-du-monde-turquie",
    "id": "gid://shopify/Collection/690653757765",
    "descriptionHtml": "<p>Produits turcs pour kebabs, durums et mezzés : concentré de tomate Tamek, galettes durum de 30 cm, viande de kebab de poulet Hünkar, sucuk, pastirma de Kayseri, fromage traditionnel Erzurum et yaourt à la grecque en 1 kg. Commande en ligne réservée aux professionnels, livraison depuis notre dépôt de Clichy.</p>",
    "seo": {
      "title": "Produits turcs pour snacks et kebabs | Fresco Marché",
      "description": "Tamek, galettes durum 30 cm, viande de kebab Hünkar, sucuk, pastirma de Kayseri, fromage Erzurum… Les produits turcs des snacks, en commande pro à Clichy."
    }
  },
  {
    "handle": "produits-du-monde-afrique",
    "id": "gid://shopify/Collection/690653692229",
    "descriptionHtml": "<p>Produits d'Afrique et des Antilles : igname, manioc, gombo, banane plantain, piment antillais et pâtes d'arachide Tantie pour le mafé et les sauces. Pour restaurants et traiteurs africains et antillais. Commande en ligne réservée aux professionnels, livraison depuis notre dépôt de Clichy.</p>",
    "seo": {
      "title": "Produits africains et antillais pour pros | Fresco Marché",
      "description": "Igname, manioc, gombo, banane plantain, piment antillais, pâte d'arachide Tantie… Les produits d'Afrique et des Antilles pour les pros, commande à Clichy."
    }
  },
  {
    "handle": "produits-du-monde-europe-du-sud",
    "id": "gid://shopify/Collection/695691870533",
    "descriptionHtml": "<p>Spécialités d'Italie, de Grèce et d'Espagne : burrata, mozzarella buffala en billes, mozzarella en boule ou en tranches, parmesan affiné 24 mois, mascarpone, feta grecque tranchée et magdalenas. Pour pizzerias, restaurants et traiteurs. Commande en ligne réservée aux professionnels, livraison depuis notre dépôt de Clichy.</p>",
    "seo": {
      "title": "Burrata, mozzarella, parmesan pour pizzerias | Fresco Marché",
      "description": "Burrata, mozzarella buffala, parmesan 24 mois, mascarpone, feta… Les spécialités d'Italie et de Grèce pour pizzerias et restaurants, en commande pro."
    }
  },
  {
    "handle": "fruits-exotiques",
    "id": "gid://shopify/Collection/690566005061",
    "descriptionHtml": "<p>Fruits exotiques pour desserts, jus et cocktails : mangues (dont la mangue avion), ananas, papaye, kiwis vert et jaune, noix de coco et coco à boire, avocat, pomelos, anone, aloe vera et pastèque selon la saison. Commande en ligne réservée aux professionnels, livraison depuis notre dépôt de Clichy.</p>",
    "seo": {
      "title": "Fruits exotiques frais pour professionnels | Fresco Marché",
      "description": "Mangue avion, ananas, papaye, kiwi jaune, noix de coco, coco à boire, avocat, pomelos… Les fruits exotiques des restaurants et snacks, en commande pro."
    }
  },
  {
    "handle": "herbes-aromatiques",
    "id": "gid://shopify/Collection/690565972293",
    "descriptionHtml": "<p>Herbes fraîches en botte pour vos cuisines : persil plat et frisé, coriandre, menthe fraîche, basilic, aneth et thym, ainsi que du persil coupé surgelé en 250 g. Commande en ligne réservée aux professionnels, livraison depuis notre dépôt de Clichy.</p>",
    "seo": {
      "title": "Persil, coriandre, menthe en botte pour pros | Fresco Marché",
      "description": "Persil plat et frisé, coriandre, menthe fraîche, basilic, aneth, thym, persil surgelé… Les herbes aromatiques des cuisines pro, en commande à Clichy."
    }
  },
  {
    "handle": "legumes-exotiques",
    "id": "gid://shopify/Collection/690566037829",
    "descriptionHtml": "<p>Légumes exotiques : chayotte, gombo et manioc, pour les cuisines africaines, antillaises et créoles. L'igname, la patate douce et la banane plantain sont dans les rayons Légumes et Afrique. Commande en ligne réservée aux professionnels, livraison depuis notre dépôt de Clichy.</p>",
    "seo": {
      "title": "Chayotte, gombo, manioc : légumes exotiques | Fresco Marché",
      "description": "Chayotte, gombo et manioc pour les cuisines africaines, antillaises et créoles, en vrac pour les professionnels. Commande en ligne, livraison depuis Clichy."
    }
  },
  {
    "handle": "fromage",
    "id": "gid://shopify/Collection/694003728709",
    "descriptionHtml": "<p>Fromages pour pizzas, burgers, sandwichs et plateaux : mozzarella buffala, cheddar, emmental et comté râpés, tranches pour croque-monsieur, maasdam, mimolette et Leerdammer, chèvre, bleu d'Auvergne, fromages fondus et à tartiner, fromage blanc et fromage frais en 500 g et 1 kg. Commande en ligne réservée aux professionnels, livraison depuis notre dépôt de Clichy.</p>",
    "seo": {
      "title": "Fromages pour pizzas, burgers et snacks | Fresco Marché",
      "description": "Mozzarella, cheddar et emmental râpés, tranches pour croque et burger, chèvre, bleu, fromages fondus… Les fromages des restaurants et snacks, commande pro."
    }
  },
  {
    "handle": "lait-beurre-creme",
    "id": "gid://shopify/Collection/690654314821",
    "descriptionHtml": "<p>Lait, beurre et crème pour la cuisine et la pâtisserie : lait demi-écrémé et entier en brique ou en pack de 6, lait sans lactose, beurre doux et demi-sel, crème fleurette 30 %, crème fraîche, crème légère UHT, ainsi qu'ayran, kéfir et lait fermenté. Commande en ligne réservée aux professionnels, livraison depuis notre dépôt de Clichy.</p>",
    "seo": {
      "title": "Lait, beurre et crème pour professionnels | Fresco Marché",
      "description": "Lait demi-écrémé en pack, beurre doux et demi-sel, crème fleurette 30 %, crème fraîche, ayran, kéfir… L'essentiel laitier des cuisines pro, commande à Clichy."
    }
  },
  {
    "handle": "oeufs",
    "id": "gid://shopify/Collection/690654282053",
    "descriptionHtml": "<p>Œufs frais en boîte de 12 et en plateau de 30, pour la cuisine, la pâtisserie et le petit-déjeuner. Commande en ligne réservée aux professionnels, livraison depuis notre dépôt de Clichy.</p>",
    "seo": {
      "title": "Œufs frais en plateau de 30 pour pros | Fresco Marché",
      "description": "Œufs frais moyens en boîte de 12 et œufs bruns en plateau de 30 pour restaurants, boulangeries et snacks. Commande en ligne pro, livraison depuis Clichy."
    }
  },
  {
    "handle": "charcuterie-turque",
    "id": "gid://shopify/Collection/690654708037",
    "descriptionHtml": "<p>Charcuterie turque halal pour sandwichs, pides et petits-déjeuners : sucuk en tranches, pastirma de Kayseri et pastirma sans çemen Isla Délice, salamis aux épices ou aux piments, salami volaille-bœuf au poivre Çesnili et saucisses bœuf-poulet Sibel. Commande en ligne réservée aux professionnels, livraison depuis notre dépôt de Clichy.</p>",
    "seo": {
      "title": "Sucuk et pastirma halal : charcuterie turque | Fresco Marché",
      "description": "Sucuk en tranches, pastirma de Kayseri, salamis aux épices, saucisses bœuf-poulet Sibel… La charcuterie turque halal des snacks, en commande pro à Clichy."
    }
  },
  {
    "handle": "consommables",
    "id": "gid://shopify/Collection/690655920453",
    "descriptionHtml": "<p>Ustensiles et petit matériel de cuisine : couteaux, éplucheurs, râpes, zesteurs, pinces, spatules, fouets, roulettes à pizza, poches à douille, saladiers, passoires, planches à découper, boîtes de conservation et sacs de congélation. Pour équiper restaurants, snacks et laboratoires. Commande en ligne réservée aux professionnels, livraison depuis notre dépôt de Clichy.</p>",
    "seo": {
      "title": "Ustensiles de cuisine pour professionnels | Fresco Marché",
      "description": "Couteaux, éplucheurs, râpes, roulettes à pizza, poches à douille, passoires, planches à découper, sacs de congélation… Le petit matériel des cuisines pro."
    }
  },
  {
    "handle": "hygiene",
    "id": "gid://shopify/Collection/690566103365",
    "descriptionHtml": "<p>Hygiène et entretien pour votre établissement : liquides vaisselle, éponges et tampons à récurer, nettoyants sols et multi-surfaces, dégraissant, anticalcaire, javel, lessives, papier toilette, mouchoirs, savon pour les mains et sacs poubelle. Commande en ligne réservée aux professionnels, livraison depuis notre dépôt de Clichy.</p>",
    "seo": {
      "title": "Produits d'entretien et d'hygiène pour pros | Fresco Marché",
      "description": "Liquide vaisselle, éponges, nettoyant sol, dégraissant, javel, lessive, papier toilette, sacs poubelle… L'entretien des restaurants et snacks, commande pro."
    }
  }
];

let ok = 0;
const erreurs = [];
for (const r of RAYONS) {
  const input = { id: r.id, descriptionHtml: r.descriptionHtml, seo: r.seo };
  if (ESSAI) {
    console.log(`\n— ${r.handle}\n  Titre Google : ${r.seo.title}\n  Description Google : ${r.seo.description}`);
    continue;
  }
  try {
    const sortie = execFileSync("shopify", [
      "store", "execute", "--store", BOUTIQUE, "--allow-mutations", "--json", "--no-color",
      "--query", MUTATION, "--variables", JSON.stringify({ input }),
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const objets = [];
    for (const ligne of [sortie, ...sortie.split("\n")]) {
      try { objets.push(JSON.parse(ligne.trim())); } catch {}
    }
    const erreurCli = objets.find((o) => o && o.error);
    if (erreurCli) throw new Error(erreurCli.error.message || JSON.stringify(erreurCli.error));
    const trouve = objets.map((o) => o?.collectionUpdate ? o : o?.data?.collectionUpdate ? o.data : o?.result?.data?.collectionUpdate ? o.result.data : null).find(Boolean);
    const userErrors = trouve?.collectionUpdate?.userErrors ?? [];
    if (userErrors.length) throw new Error(userErrors.map((e) => e.message).join(" ; "));
    if (!trouve?.collectionUpdate?.collection) throw new Error("réponse inattendue : " + sortie.slice(0, 300));
    ok += 1;
    console.log(`OK  ${r.handle}`);
  } catch (e) {
    erreurs.push(r.handle);
    console.log(`ERREUR  ${r.handle} : ${String(e.stderr || e.message).trim().slice(0, 300)}`);
  }
}
if (!ESSAI) {
  console.log(`\n${ok} rayon(s) enregistré(s) sur ${RAYONS.length}.`);
  if (erreurs.length) { console.log("À reprendre : " + erreurs.join(", ")); process.exitCode = 1; }
}
