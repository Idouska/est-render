# Migration Running Upscale -> WordPress

Outillage pour reprendre le catalogue de `runningupscale.com` (Shopify) sur un site WordPress.

## Ce que fait l'export

`export_shopify.py` lit les endpoints publics Shopify (`/products.json`,
`/collections/<handle>/products.json`). Aucun identifiant admin n'est requis.

```bash
python3 export_shopify.py \
  --base https://runningupscale.com \
  --out export \
  --target-domain https://ton-domaine.com
```

| Fichier | Contenu |
|---|---|
| `products_woocommerce.csv` | 198 produits variables + 2 974 variations, format WooCommerce Product CSV Importer |
| `categories.csv` | Les 72 collections, avec leur volume et leur statut (`ok`, `vide`, `fourre-tout`) |
| `images.csv` | Les 1 341 URL d'images, pour rapatriement |
| `redirects.csv` | 257 redirections Shopify -> WordPress, pour la bascule de domaine |

L'export ignore les collections vides et les collections fourre-tout : elles ne
portent aucune information de classement et deviendraient des pages sans contenu.

## Etat du catalogue source

Releve au 16/09/2026, sur les 198 produits.

- **11 collections vides** mais indexables : Mizuno, On Running (x3), The North Face,
  Brooks Hyperion Max 2, Nike Mind 002, Puma Fast-RB Nitro Elite, Randonnee,
  Sandales repos (x2).
- **« Best Seller » contient les 198 produits**, soit l'integralite du catalogue.
  Une collection best-seller qui ne trie rien ne sert ni au visiteur ni a la conversion.
- **« Chaussures de Sport Femme » : 197 produits sur 198.**
- **La segmentation homme/femme est sans effet** pour Nike (91 = 91), Asics, Hoka
  et New Balance : les deux collections contiennent exactement les memes produits.
- **La collection Enfant annonce 113 produits** mais contient des tailles adultes
  jusqu'au 45.5. Le tag est applique sans discernement.

Ces problemes viennent de tags surappliques au niveau produit, que les collections
automatiques Shopify transforment ensuite en pages quasi identiques. Reproduire cette
taxonomie telle quelle sur WordPress reconduirait la cannibalisation SEO. L'export
fournit la matiere ; le plan de categories reste a decider.

## Contraintes de destination

Le site vise (`royallegendscom.wordpress.com`) est un WordPress.com au plan gratuit,
jamais lance : aucune extension installable, donc aucune boutique possible en l'etat.
Un plan payant (des Personal) autorise desormais l'installation d'extensions, donc
WooCommerce. L'acces SFTP/SSH/WP-CLI, lui, reste reserve aux paliers superieurs.
