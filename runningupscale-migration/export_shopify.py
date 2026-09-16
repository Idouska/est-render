#!/usr/bin/env python3
"""Exporte un catalogue Shopify public vers des CSV importables par WooCommerce.

Lit les endpoints publics /products.json et /collections/<handle>/products.json,
n'exige aucun identifiant admin, et produit :
  - products_woocommerce.csv : produits variables + variations (format WooCommerce Product CSV Importer)
  - categories.csv           : collections Shopify -> categories WooCommerce
  - images.csv               : toutes les URL d'images, pour rapatriement
  - redirects.csv            : anciennes URL Shopify -> nouvelles URL, pour la bascule de domaine
"""
import argparse, csv, json, sys, time, urllib.request
from pathlib import Path

UA = {"User-Agent": "Mozilla/5.0 (compatible; catalog-export)"}


def fetch(url, retries=4):
    for attempt in range(retries):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30))
        except Exception as exc:
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt)


def fetch_products(base):
    products, page = [], 1
    while True:
        batch = fetch(f"{base}/products.json?limit=250&page={page}").get("products", [])
        if not batch:
            return products
        products += batch
        page += 1


def fetch_collection_map(base):
    mapping = {}
    for col in fetch(f"{base}/collections.json?limit=250").get("collections", []):
        handle = col["handle"]
        members = fetch(f"{base}/collections/{handle}/products.json?limit=250").get("products", [])
        mapping[handle] = {"title": col["title"], "handles": [p["handle"] for p in members]}
        time.sleep(0.15)
    return mapping


WC_COLUMNS = [
    "ID", "Type", "SKU", "Name", "Published", "Is featured?", "Visibility in catalog",
    "Short description", "Description", "Tax status", "In stock?", "Stock",
    "Backorders allowed?", "Weight (kg)", "Allow customer reviews?", "Sale price",
    "Regular price", "Categories", "Tags", "Images", "Parent", "Position",
    "Attribute 1 name", "Attribute 1 value(s)", "Attribute 1 visible", "Attribute 1 global",
]


def build_rows(products, colmap, skip_collections):
    """Une ligne parent par produit, puis une ligne variation par taille."""
    by_handle = {}
    for handle, data in colmap.items():
        if handle in skip_collections:
            continue
        for product_handle in data["handles"]:
            by_handle.setdefault(product_handle, []).append(data["title"])

    rows = []
    for product in products:
        handle = product["handle"]
        variants = product.get("variants", [])
        images = [img["src"] for img in product.get("images", [])]
        option_name = (product.get("options") or [{}])[0].get("name") or "Taille"
        sizes = [v["title"] for v in variants]
        prices = [float(v["price"]) for v in variants if v.get("price")]

        rows.append({
            "ID": handle, "Type": "variable", "SKU": handle,
            "Name": product["title"], "Published": 1, "Is featured?": 0,
            "Visibility in catalog": "visible", "Short description": "",
            "Description": product.get("body_html") or "", "Tax status": "taxable",
            "In stock?": 1, "Stock": "", "Backorders allowed?": 0, "Weight (kg)": "",
            "Allow customer reviews?": 1, "Sale price": "",
            "Regular price": f"{min(prices):.2f}" if prices else "",
            "Categories": ", ".join(sorted(set(by_handle.get(handle, [])))),
            "Tags": ", ".join(product.get("tags", [])),
            "Images": ", ".join(images), "Parent": "", "Position": 0,
            "Attribute 1 name": option_name,
            "Attribute 1 value(s)": " | ".join(sizes),
            "Attribute 1 visible": 1, "Attribute 1 global": 1,
        })

        for position, variant in enumerate(variants, 1):
            available = variant.get("available")
            rows.append({
                "ID": f"{handle}-{variant['id']}", "Type": "variation",
                "SKU": variant.get("sku") or f"{handle}-{variant['id']}",
                "Name": f"{product['title']} - {variant['title']}", "Published": 1,
                "Is featured?": 0, "Visibility in catalog": "visible",
                "Short description": "", "Description": "", "Tax status": "taxable",
                "In stock?": 1 if available else 0, "Stock": "",
                "Backorders allowed?": 0,
                "Weight (kg)": round(variant["grams"] / 1000, 3) if variant.get("grams") else "",
                "Allow customer reviews?": 0,
                "Sale price": "",
                "Regular price": f"{float(variant['price']):.2f}" if variant.get("price") else "",
                "Categories": "", "Tags": "",
                "Images": variant.get("featured_image", {}).get("src", "") if variant.get("featured_image") else "",
                "Parent": f"id:{handle}", "Position": position,
                "Attribute 1 name": option_name,
                "Attribute 1 value(s)": variant["title"],
                "Attribute 1 visible": 1, "Attribute 1 global": 1,
            })
    return rows


def write_csv(path, columns, rows):
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)
    print(f"  {path.name}: {len(rows)} lignes")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="https://runningupscale.com")
    parser.add_argument("--out", default="export")
    parser.add_argument("--target-domain", default="https://example.com",
                        help="Domaine de destination, pour la table de redirections")
    args = parser.parse_args()

    base = args.base.rstrip("/")
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    print(f"Catalogue: {base}")
    products = fetch_products(base)
    print(f"  {len(products)} produits")
    colmap = fetch_collection_map(base)
    print(f"  {len(colmap)} collections")

    # Une collection vide ne merite pas une categorie, et une collection fourre-tout
    # qui contient tout le catalogue n'apporte aucune information de classement.
    empty = {h for h, d in colmap.items() if not d["handles"]}
    catchall = {h for h, d in colmap.items() if len(d["handles"]) == len(products)}
    skip = empty | catchall
    print(f"  ignorees: {len(empty)} vides, {len(catchall)} fourre-tout")

    rows = build_rows(products, colmap, skip)
    write_csv(out / "products_woocommerce.csv", WC_COLUMNS, rows)

    write_csv(out / "categories.csv", ["handle", "titre", "produits", "statut"], [
        {"handle": h, "titre": d["title"], "produits": len(d["handles"]),
         "statut": "vide" if h in empty else ("fourre-tout" if h in catchall else "ok")}
        for h, d in sorted(colmap.items())
    ])

    write_csv(out / "images.csv", ["produit", "position", "url"], [
        {"produit": p["handle"], "position": i, "url": img["src"]}
        for p in products for i, img in enumerate(p.get("images", []), 1)
    ])

    target = args.target_domain.rstrip("/")
    write_csv(out / "redirects.csv", ["source", "destination"],
        [{"source": f"/products/{p['handle']}", "destination": f"{target}/produit/{p['handle']}/"}
         for p in products] +
        [{"source": f"/collections/{h}", "destination": f"{target}/categorie/{h}/"}
         for h in sorted(colmap) if h not in skip])


if __name__ == "__main__":
    sys.exit(main())
