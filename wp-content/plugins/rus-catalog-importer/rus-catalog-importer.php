<?php
/**
 * Plugin Name:       Running Upscale — Importateur de catalogue
 * Description:       Importe le catalogue exporté depuis Shopify (produits variables, tailles, images, catégories) dans WooCommerce.
 * Version:           1.0.0
 * Requires at least: 6.4
 * Requires PHP:      8.0
 * Text Domain:       rus-importer
 *
 * @package RUS\Importer
 */

declare( strict_types = 1 );

namespace RUS\Importer;

defined( 'ABSPATH' ) || exit;

const ATTRIBUTE = 'taille';

/**
 * Importe une ligne « parent » de l'export comme produit variable.
 *
 * Le handle Shopify sert de SKU : il est stable, unique, et permet de rejouer
 * l'import sans créer de doublon.
 *
 * @param array<string,string> $row Ligne du CSV d'export.
 * @return int ID du produit créé ou mis à jour.
 * @throws \RuntimeException Si WooCommerce refuse l'enregistrement.
 */
function import_parent( array $row ): int {
	$existing = \wc_get_product_id_by_sku( $row['SKU'] );
	$product  = $existing ? new \WC_Product_Variable( $existing ) : new \WC_Product_Variable();

	$product->set_name( $row['Name'] );
	$product->set_sku( $row['SKU'] );
	$product->set_slug( $row['ID'] );
	$product->set_description( $row['Description'] );
	$product->set_status( 'publish' );
	$product->set_catalog_visibility( 'visible' );
	$product->set_reviews_allowed( true );

	if ( '' !== $row['Categories'] ) {
		$product->set_category_ids( resolve_category_ids( $row['Categories'] ) );
	}

	$sizes = array_map( 'trim', explode( '|', $row['Attribute 1 value(s)'] ) );
	$product->set_attributes( array( build_size_attribute( $sizes ) ) );

	$product_id = $product->save();

	if ( ! $product_id ) {
		throw new \RuntimeException( sprintf( 'Enregistrement impossible pour %s', $row['SKU'] ) );
	}

	return $product_id;
}

/**
 * Construit l'attribut de taille à partir du taxonomie globale `pa_taille`.
 *
 * Un attribut global — plutôt que local au produit — est indispensable ici :
 * il rend le filtrage par taille possible en façade, et évite de dupliquer
 * 2 974 valeurs d'attribut dans la base.
 *
 * @param string[] $sizes Tailles du produit.
 */
function build_size_attribute( array $sizes ): \WC_Product_Attribute {
	$taxonomy = \wc_attribute_taxonomy_name( ATTRIBUTE );
	$term_ids = array();

	foreach ( $sizes as $size ) {
		$term = \get_term_by( 'name', $size, $taxonomy );

		if ( ! $term ) {
			$created = \wp_insert_term( $size, $taxonomy );

			if ( \is_wp_error( $created ) ) {
				continue;
			}

			$term_ids[] = (int) $created['term_id'];
			continue;
		}

		$term_ids[] = (int) $term->term_id;
	}

	$attribute = new \WC_Product_Attribute();
	$attribute->set_id( \wc_attribute_taxonomy_id_by_name( ATTRIBUTE ) );
	$attribute->set_name( $taxonomy );
	$attribute->set_options( $term_ids );
	$attribute->set_visible( true );
	$attribute->set_variation( true );

	return $attribute;
}

/**
 * Crée une variation rattachée à un produit variable.
 *
 * @param int                  $parent_id ID du produit parent.
 * @param array<string,string> $row       Ligne « variation » du CSV.
 */
function import_variation( int $parent_id, array $row ): int {
	$existing  = \wc_get_product_id_by_sku( $row['SKU'] );
	$variation = $existing ? new \WC_Product_Variation( $existing ) : new \WC_Product_Variation();

	$variation->set_parent_id( $parent_id );
	$variation->set_sku( $row['SKU'] );
	$variation->set_regular_price( $row['Regular price'] );
	$variation->set_attributes( array( ATTRIBUTE => \sanitize_title( $row['Attribute 1 value(s)'] ) ) );

	// L'export conserve la disponibilité réelle par taille : 392 des 2 974
	// variantes sont en rupture chez la source, et doivent le rester ici.
	$variation->set_stock_status( '1' === $row['In stock?'] ? 'instock' : 'outofstock' );

	if ( '' !== $row['Weight (kg)'] ) {
		$variation->set_weight( $row['Weight (kg)'] );
	}

	return $variation->save();
}

/**
 * Résout des noms de catégories en identifiants de termes, en les créant au besoin.
 *
 * @param string $names Noms séparés par des virgules.
 * @return int[]
 */
function resolve_category_ids( string $names ): array {
	$ids = array();

	foreach ( array_map( 'trim', explode( ',', $names ) ) as $name ) {
		if ( '' === $name ) {
			continue;
		}

		$term = \get_term_by( 'name', $name, 'product_cat' );

		if ( ! $term ) {
			$created = \wp_insert_term( $name, 'product_cat' );
			$term_id = \is_wp_error( $created ) ? 0 : (int) $created['term_id'];
		} else {
			$term_id = (int) $term->term_id;
		}

		if ( $term_id ) {
			$ids[] = $term_id;
		}
	}

	return $ids;
}

/**
 * Télécharge une image distante et l'attache au produit.
 *
 * Les URL du CDN Shopify restent valides après migration, mais en dépendre
 * laisserait la boutique tributaire d'un compte qu'on quitte : on rapatrie.
 *
 * @param int    $product_id Produit auquel rattacher l'image.
 * @param string $url        URL source.
 * @return int ID de la pièce jointe, 0 en cas d'échec.
 */
function sideload_image( int $product_id, string $url ): int {
	require_once ABSPATH . 'wp-admin/includes/media.php';
	require_once ABSPATH . 'wp-admin/includes/file.php';
	require_once ABSPATH . 'wp-admin/includes/image.php';

	$attachment_id = \media_sideload_image( $url, $product_id, null, 'id' );

	return \is_wp_error( $attachment_id ) ? 0 : (int) $attachment_id;
}

/**
 * Commande WP-CLI : wp rus import <fichier.csv> [--images] [--dry-run]
 *
 * L'import se fait par lots avec vidage du cache objet : sans cela, 3 172 lignes
 * saturent la mémoire avant la fin.
 */
function cli_import( array $args, array $assoc_args ): void {
	list( $file ) = $args;

	if ( ! is_readable( $file ) ) {
		\WP_CLI::error( sprintf( 'Fichier illisible : %s', $file ) );
	}

	$with_images = isset( $assoc_args['images'] );
	$dry_run     = isset( $assoc_args['dry-run'] );

	$handle  = fopen( $file, 'rb' );
	$columns = fgetcsv( $handle );
	$parents = array();
	$counts  = array( 'parents' => 0, 'variations' => 0, 'images' => 0, 'erreurs' => 0 );

	while ( false !== ( $line = fgetcsv( $handle ) ) ) {
		$row = array_combine( $columns, $line );

		try {
			if ( 'variable' === $row['Type'] ) {
				if ( ! $dry_run ) {
					$product_id            = import_parent( $row );
					$parents[ $row['ID'] ] = $product_id;

					if ( $with_images && '' !== $row['Images'] ) {
						foreach ( array_map( 'trim', explode( ',', $row['Images'] ) ) as $url ) {
							if ( sideload_image( $product_id, $url ) ) {
								++$counts['images'];
							}
						}
					}
				}

				++$counts['parents'];
			} else {
				$parent_key = substr( $row['Parent'], 3 ); // Retire le préfixe « id: ».

				if ( ! $dry_run && isset( $parents[ $parent_key ] ) ) {
					import_variation( $parents[ $parent_key ], $row );
				}

				++$counts['variations'];
			}
		} catch ( \Throwable $error ) {
			\WP_CLI::warning( $error->getMessage() );
			++$counts['erreurs'];
		}

		if ( 0 === ( $counts['parents'] + $counts['variations'] ) % 200 ) {
			\wp_cache_flush();
		}
	}

	fclose( $handle );

	\WP_CLI::success( sprintf(
		'%d produits, %d variations, %d images, %d erreurs.%s',
		$counts['parents'],
		$counts['variations'],
		$counts['images'],
		$counts['erreurs'],
		$dry_run ? ' (simulation)' : ''
	) );
}

if ( defined( 'WP_CLI' ) && WP_CLI ) {
	\WP_CLI::add_command( 'rus import', __NAMESPACE__ . '\\cli_import' );
}
