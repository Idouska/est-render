import { env } from '../../config/env.ts';
import type { MockOrder } from '../shopify/mock.ts';

/*
 * La boutique de démonstration : Kairo, des baskets.
 *
 * Tout est inventé — la marque, les modèles, les clients, les adresses. Les
 * dates sont relatives à « maintenant » : une démo montrée dans trois mois a
 * toujours des commandes d'hier et des colis bloqués depuis six jours. Rien
 * n'est tiré au hasard : deux démonstrations successives montrent la même
 * boutique, et un écran qui changerait à chaque rechargement ferait douter du
 * vrai.
 */

export const DEMO = {
  merchantId: 'demo-kairo',
  shopDomain: 'kairo-demo.myshopify.com',
  marque: 'Kairo',
  /** La personne connectée pendant la démo. */
  proprietaire: { id: 'demo-kairo-ines', name: 'Inès Garnier', email: 'ines@kairo-demo.test' },
  agents: [
    { id: 'demo-kairo-hugo', name: 'Hugo Lambert', email: 'hugo@kairo-demo.test' },
    { id: 'demo-kairo-maelle', name: 'Maëlle Roche', email: 'maelle@kairo-demo.test' },
  ],
} as const;

const JOUR = 86_400_000;
const HEURE = 3_600_000;

export interface ProduitDemo {
  cle: string;
  titre: string;
  type: string;
  prix: number;
  coloris: Array<{ nom: string; image: string }>;
  tailles: string[];
}

const POINTURES = ['38', '39', '40', '41', '42', '43', '44', '45'];

export const PRODUITS: ProduitDemo[] = [
  { cle: 'runner', titre: 'Kairo Runner 01', type: 'Baskets', prix: 129, tailles: POINTURES,
    coloris: [{ nom: 'Blanc / Gris', image: 'runner-blanc-gris' }, { nom: 'Noir / Rouge', image: 'runner-noir-rouge' }] },
  { cle: 'court', titre: 'Kairo Court Low', type: 'Baskets', prix: 109, tailles: POINTURES,
    coloris: [{ nom: 'Blanc', image: 'court-blanc' }, { nom: 'Crème / Vert', image: 'court-creme-vert' }] },
  { cle: 'trail', titre: 'Kairo Trail X', type: 'Baskets', prix: 149, tailles: POINTURES,
    coloris: [{ nom: 'Kaki', image: 'trail-kaki' }, { nom: 'Noir', image: 'trail-noir' }] },
  { cle: 'street', titre: 'Kairo Street Mid', type: 'Baskets', prix: 139, tailles: POINTURES,
    coloris: [{ nom: 'Bleu nuit', image: 'street-bleu-nuit' }, { nom: 'Sable', image: 'street-sable' }] },
  { cle: 'aero', titre: 'Kairo Aero Knit', type: 'Baskets', prix: 119, tailles: POINTURES,
    coloris: [{ nom: 'Gris chiné', image: 'aero-gris' }, { nom: 'Rose poudré', image: 'aero-rose' }] },
  { cle: 'slide', titre: 'Kairo Slide', type: 'Claquettes', prix: 39, tailles: POINTURES,
    coloris: [{ nom: 'Noir', image: 'slide-noir' }, { nom: 'Blanc', image: 'slide-blanc' }] },
  { cle: 'chaussettes', titre: 'Chaussettes Kairo (lot de 3)', type: 'Accessoires', prix: 15, tailles: ['39-42', '43-46'],
    coloris: [{ nom: 'Blanc', image: 'chaussettes-blanc' }, { nom: 'Noir', image: 'chaussettes-noir' }] },
  { cle: 'sweat', titre: 'Sweat Kairo Club', type: 'Textile', prix: 79, tailles: ['S', 'M', 'L', 'XL'],
    coloris: [{ nom: 'Gris', image: 'sweat-gris' }, { nom: 'Marine', image: 'sweat-marine' }] },
];

export const produitDemo = (cle: string): ProduitDemo => PRODUITS.find((produit) => produit.cle === cle)!;

/** L'adresse publique d'une image du catalogue : servie par l'application elle-même. */
export const imageDemo = (nom: string): string => `${env.APP_URL}/static/demo/${nom}.svg`;

export const skuDemo = (cle: string, coloris: number, taille: string): string =>
  `KR-${cle.slice(0, 3).toUpperCase()}-${coloris + 1}-${taille}`;

export interface ClientDemo {
  nom: string;
  email: string;
  adresse: string;
  cp: string;
  ville: string;
  pays: string;
  tel: string;
  /** Client depuis N jours. */
  depuis: number;
}

export const CLIENTS: ClientDemo[] = [
  { nom: 'Léa Fontaine', email: 'lea.fontaine@gmail.com', adresse: '12 rue des Lilas', cp: '75011', ville: 'Paris', pays: 'FR', tel: '+33 6 11 24 58 30', depuis: 420 },
  { nom: 'Karim Benali', email: 'karim.benali@outlook.fr', adresse: '4 avenue Jean Jaurès', cp: '69007', ville: 'Lyon', pays: 'FR', tel: '+33 6 72 18 44 09', depuis: 210 },
  { nom: 'Camille Petit', email: 'camille.petit@yahoo.fr', adresse: '27 boulevard Carnot', cp: '59000', ville: 'Lille', pays: 'FR', tel: '+33 7 45 33 21 76', depuis: 95 },
  { nom: 'James Carter', email: 'james.carter@gmail.com', adresse: '18 Rue Neuve', cp: '1000', ville: 'Bruxelles', pays: 'BE', tel: '+32 470 12 34 56', depuis: 60 },
  { nom: 'Sarah Cohen', email: 'sarah.cohen@gmail.com', adresse: '9 rue Paradis', cp: '13001', ville: 'Marseille', pays: 'FR', tel: '+33 6 50 77 81 12', depuis: 3 },
  { nom: 'Mehdi Amrani', email: 'mehdi.amrani@hotmail.fr', adresse: '31 rue de la République', cp: '31000', ville: 'Toulouse', pays: 'FR', tel: '+33 6 03 91 27 45', depuis: 140 },
  { nom: 'Pauline Mercier', email: 'pauline.mercier@orange.fr', adresse: '6 place du Marché', cp: '35000', ville: 'Rennes', pays: 'FR', tel: '+33 6 88 14 52 60', depuis: 300 },
  { nom: 'Antoine Faure', email: 'antoine.faure@free.fr', adresse: '55 cours Victor Hugo', cp: '33000', ville: 'Bordeaux', pays: 'FR', tel: '+33 6 21 64 90 38', depuis: 75 },
  { nom: 'Emma Dubois', email: 'emma.dubois@gmail.com', adresse: '3 rue Saint-Michel', cp: '44000', ville: 'Nantes', pays: 'FR', tel: '+33 7 61 09 48 22', depuis: 50 },
  { nom: 'Rayan Haddou', email: 'rayan.haddou@gmail.com', adresse: '22 rue du Faubourg', cp: '67000', ville: 'Strasbourg', pays: 'FR', tel: '+33 6 39 70 15 84', depuis: 45 },
  { nom: 'Zoé Laurent', email: 'zoe.laurent@laposte.net', adresse: '14 allée des Pins', cp: '06000', ville: 'Nice', pays: 'FR', tel: '+33 6 93 22 47 01', depuis: 38 },
  { nom: 'Nicolas Blanc', email: 'nicolas.blanc@gmail.com', adresse: '8 rue Nationale', cp: '37000', ville: 'Tours', pays: 'FR', tel: '+33 6 47 58 36 29', depuis: 260 },
  { nom: 'Olivia Brown', email: 'olivia.brown@icloud.com', adresse: '5 Grand-Rue', cp: '1204', ville: 'Genève', pays: 'CH', tel: '+41 79 123 45 67', depuis: 33 },
  { nom: 'Clara Henry', email: 'clara.henry@gmail.com', adresse: '19 rue Gambetta', cp: '21000', ville: 'Dijon', pays: 'FR', tel: '+33 6 18 85 73 40', depuis: 120 },
  { nom: 'Bilal Kaci', email: 'bilal.kaci@gmail.com', adresse: '40 avenue de Paris', cp: '78000', ville: 'Versailles', pays: 'FR', tel: '+33 7 82 40 19 63', depuis: 2 },
  { nom: 'Jade Morel', email: 'jade.morel@sfr.fr', adresse: '2 impasse des Tilleuls', cp: '34000', ville: 'Montpellier', pays: 'FR', tel: '+33 6 66 31 08 52', depuis: 41 },
  { nom: 'Maxime Roux', email: 'maxime.roux@gmail.com', adresse: '73 rue de Brest', cp: '29200', ville: 'Brest', pays: 'FR', tel: '+33 6 14 92 60 37', depuis: 52 },
  { nom: 'Lina Chevalier', email: 'lina.chevalier@outlook.com', adresse: '11 rue Pasteur', cp: '38000', ville: 'Grenoble', pays: 'FR', tel: '+33 6 58 07 33 91', depuis: 48 },
  { nom: 'Théo Masson', email: 'theo.masson@gmail.com', adresse: '25 rue de Metz', cp: '54000', ville: 'Nancy', pays: 'FR', tel: '+33 6 30 49 82 17', depuis: 36 },
  { nom: 'Alice Perrin', email: 'alice.perrin@gmail.com', adresse: '7 quai de la Loire', cp: '45000', ville: 'Orléans', pays: 'FR', tel: '+33 6 71 26 05 48', depuis: 600 },
  { nom: 'Diego Martín', email: 'diego.martin@gmail.com', adresse: 'Calle Mayor 14', cp: '28013', ville: 'Madrid', pays: 'ES', tel: '+34 612 345 678', depuis: 1 },
  { nom: 'Manon Lefèvre', email: 'manon.lefevre@gmail.com', adresse: '16 rue des Carmes', cp: '76000', ville: 'Rouen', pays: 'FR', tel: '+33 6 24 81 57 90', depuis: 180 },
  { nom: 'Yanis Robert', email: 'yanis.robert@gmail.com', adresse: '30 rue Thiers', cp: '51100', ville: 'Reims', pays: 'FR', tel: '+33 7 50 62 14 85', depuis: 12 },
  { nom: 'Sophie Nguyen', email: 'sophie.nguyen@laposte.net', adresse: '48 rue Lafayette', cp: '75009', ville: 'Paris', pays: 'FR', tel: '+33 6 12 73 49 26', depuis: 380 },
  { nom: 'Lucas Bernard', email: 'lucas.bernard@gmail.com', adresse: '10 rue du Port', cp: '17000', ville: 'La Rochelle', pays: 'FR', tel: '+33 6 85 30 61 74', depuis: 4 },
  { nom: 'Julien Meyer', email: 'julien.meyer91@gmail.com', adresse: '5 rue des Écoles', cp: '91000', ville: 'Évry', pays: 'FR', tel: '+33 6 49 18 72 03', depuis: 230 },
  { nom: 'Amélie Rousseau', email: 'a.rousseau@free.fr', adresse: '21 rue Victor Hugo', cp: '87000', ville: 'Limoges', pays: 'FR', tel: '+33 6 07 55 28 61', depuis: 700 },
  { nom: 'Thomas Girard', email: 'thomas.girard@gmail.com', adresse: '63 avenue Foch', cp: '63000', ville: 'Clermont-Ferrand', pays: 'FR', tel: '+33 6 36 47 19 52', depuis: 160 },
  { nom: 'Marc Delaunay', email: 'm.delaunay@orange.fr', adresse: '1 place Bellecour', cp: '69002', ville: 'Lyon', pays: 'FR', tel: '+33 6 12 34 56 78', depuis: 520 },
  { nom: 'Nora Haddad', email: 'nora.haddad@gmail.com', adresse: '8 allée des Tanneurs', cp: '44000', ville: 'Nantes', pays: 'FR', tel: '+33 7 81 22 40 19', depuis: 90 },
  { nom: 'Chloé Martin', email: 'chloe.martin@gmail.com', adresse: '17 rue Sainte-Catherine', cp: '33000', ville: 'Bordeaux', pays: 'FR', tel: '+33 6 90 13 57 24', depuis: 270 },
  { nom: 'Hélène Vidal', email: 'helene.vidal@wanadoo.fr', adresse: '9 chemin des Vignes', cp: '84000', ville: 'Avignon', pays: 'FR', tel: '+33 6 44 26 81 35', depuis: 66 },
];

export const clientDemo = (nom: string): ClientDemo => CLIENTS.find((client) => client.nom === nom)!;

/*
 * Le suivi d'un colis, tel que l'invente la démo. `bloque` : plus aucun scan
 * depuis `sansScan` jours — ce que la page Update doit repérer.
 */
export type EtatColis = 'prise' | 'transit' | 'bloque' | 'relais' | 'livre';

export interface ScenarioColis {
  etat: EtatColis;
  /** Expédié il y a N jours. */
  expedie: number;
  /** Pour un colis bloqué : jours sans scan. */
  sansScan?: number;
}

type EtatCommande = 'NONPAYEE' | 'A_EXPEDIER' | 'REMBOURSEE' | 'PARTIEL' | EtatColis;

interface SpecCommande {
  numero: number;
  /** Passée il y a N jours. */
  il: number;
  client: string;
  /** [produit, coloris, taille, quantité] */
  articles: Array<[string, number, string, number?]>;
  etat: EtatCommande;
  /** Jours entre la commande et l'expédition. */
  delai?: number;
  sansScan?: number;
  transporteur?: 'YunExpress' | 'Colissimo';
}

/*
 * Les commandes. Les numéros sont ceux d'une jeune boutique ; les clients
 * qui écrivent au SAV y retrouvent la leur, les autres font le volume.
 */
const SPECS: SpecCommande[] = [
  { numero: 4098, il: 26, client: 'Nicolas Blanc', articles: [['street', 0, '42']], etat: 'livre', delai: 2 },
  { numero: 4099, il: 24, client: 'Amélie Rousseau', articles: [['court', 1, '39'], ['chaussettes', 0, '39-42']], etat: 'livre', delai: 1 },
  { numero: 4100, il: 23, client: 'Maxime Roux', articles: [['runner', 1, '43']], etat: 'livre', delai: 2 },
  { numero: 4101, il: 22, client: 'Hélène Vidal', articles: [['aero', 0, '38']], etat: 'livre', delai: 1 },
  { numero: 4102, il: 21, client: 'Zoé Laurent', articles: [['aero', 1, '38']], etat: 'livre', delai: 2 },
  { numero: 4103, il: 20, client: 'Thomas Girard', articles: [['trail', 1, '44']], etat: 'livre', delai: 1 },
  { numero: 4104, il: 19, client: 'Lina Chevalier', articles: [['street', 1, '39']], etat: 'livre', delai: 2 },
  { numero: 4105, il: 19, client: 'Rayan Haddou', articles: [['trail', 1, '44'], ['sweat', 1, 'L']], etat: 'livre', delai: 1 },
  { numero: 4106, il: 18, client: 'Chloé Martin', articles: [['slide', 0, '40']], etat: 'livre', delai: 1 },
  { numero: 4107, il: 18, client: 'Nora Haddad', articles: [['court', 0, '40']], etat: 'livre', delai: 2 },
  { numero: 4108, il: 17, client: 'Jade Morel', articles: [['runner', 0, '39']], etat: 'PARTIEL', delai: 1 },
  { numero: 4109, il: 16, client: 'Emma Dubois', articles: [['runner', 0, '39']], etat: 'livre', delai: 2 },
  { numero: 4110, il: 16, client: 'Marc Delaunay', articles: [['court', 1, '43'], ['slide', 1, '43']], etat: 'livre', delai: 1 },
  { numero: 4111, il: 15, client: 'Olivia Brown', articles: [['aero', 0, '39']], etat: 'livre', delai: 2 },
  { numero: 4112, il: 15, client: 'Théo Masson', articles: [['runner', 1, '42']], etat: 'livre', delai: 1 },
  { numero: 4113, il: 14, client: 'Alice Perrin', articles: [['sweat', 0, 'M']], etat: 'livre', delai: 1 },
  { numero: 4114, il: 14, client: 'Clara Henry', articles: [['street', 0, '38']], etat: 'REMBOURSEE', delai: 2 },
  { numero: 4115, il: 13, client: 'Manon Lefèvre', articles: [['court', 0, '38'], ['chaussettes', 1, '39-42']], etat: 'livre', delai: 1 },
  { numero: 4116, il: 13, client: 'Antoine Faure', articles: [['trail', 0, '42']], etat: 'livre', delai: 2 },
  { numero: 4117, il: 12, client: 'Yanis Robert', articles: [['runner', 0, '44']], etat: 'livre', delai: 1 },
  { numero: 4118, il: 14, client: 'Mehdi Amrani', articles: [['street', 0, '43']], etat: 'bloque', delai: 2, sansScan: 9 },
  { numero: 4119, il: 11, client: 'Hélène Vidal', articles: [['chaussettes', 0, '39-42', 2]], etat: 'livre', delai: 1 },
  { numero: 4120, il: 11, client: 'Julien Meyer', articles: [['trail', 1, '43']], etat: 'livre', delai: 2 },
  { numero: 4121, il: 10, client: 'Chloé Martin', articles: [['aero', 1, '38']], etat: 'bloque', delai: 1, sansScan: 5 },
  { numero: 4122, il: 12, client: 'Karim Benali', articles: [['runner', 1, '42'], ['chaussettes', 1, '39-42']], etat: 'bloque', delai: 2, sansScan: 6 },
  { numero: 4123, il: 10, client: 'Nora Haddad', articles: [['sweat', 1, 'S']], etat: 'livre', delai: 1 },
  { numero: 4124, il: 9, client: 'Thomas Girard', articles: [['slide', 0, '44']], etat: 'bloque', delai: 1, sansScan: 4 },
  { numero: 4125, il: 9, client: 'Pauline Mercier', articles: [['court', 1, '38']], etat: 'relais', delai: 2 },
  { numero: 4126, il: 8, client: 'Amélie Rousseau', articles: [['street', 1, '39']], etat: 'transit', delai: 1 },
  { numero: 4127, il: 8, client: 'James Carter', articles: [['trail', 0, '45']], etat: 'transit', delai: 2 },
  { numero: 4128, il: 7, client: 'Marc Delaunay', articles: [['runner', 0, '43']], etat: 'transit', delai: 1 },
  { numero: 4129, il: 7, client: 'Camille Petit', articles: [['aero', 0, '40']], etat: 'transit', delai: 2 },
  { numero: 4130, il: 6, client: 'Alice Perrin', articles: [['court', 0, '39']], etat: 'transit', delai: 1 },
  { numero: 4131, il: 8, client: 'Léa Fontaine', articles: [['runner', 0, '38'], ['chaussettes', 0, '39-42']], etat: 'transit', delai: 2 },
  { numero: 4132, il: 5, client: 'Hélène Vidal', articles: [['sweat', 0, 'L']], etat: 'prise', delai: 1 },
  { numero: 4133, il: 5, client: 'Camille Petit', articles: [['chaussettes', 1, '39-42']], etat: 'prise', delai: 2 },
  { numero: 4134, il: 4, client: 'Nora Haddad', articles: [['street', 1, '41']], etat: 'A_EXPEDIER' },
  { numero: 4135, il: 2, client: 'Bilal Kaci', articles: [['trail', 0, '42']], etat: 'A_EXPEDIER' },
  { numero: 4136, il: 3, client: 'Marc Delaunay', articles: [['trail', 0, '43']], etat: 'A_EXPEDIER' },
  { numero: 4137, il: 3, client: 'Lucas Bernard', articles: [['runner', 1, '42']], etat: 'A_EXPEDIER' },
  { numero: 4138, il: 2, client: 'Sophie Nguyen', articles: [['court', 0, '38'], ['slide', 1, '38']], etat: 'A_EXPEDIER' },
  { numero: 4139, il: 2, client: 'Sarah Cohen', articles: [['aero', 1, '39']], etat: 'A_EXPEDIER' },
  { numero: 4140, il: 1, client: 'Julien Meyer', articles: [['street', 0, '43']], etat: 'A_EXPEDIER' },
  { numero: 4141, il: 1, client: 'Thomas Girard', articles: [['runner', 0, '44'], ['sweat', 1, 'XL']], etat: 'A_EXPEDIER' },
  { numero: 4142, il: 0.4, client: 'Chloé Martin', articles: [['court', 1, '39']], etat: 'A_EXPEDIER' },
  { numero: 4143, il: 0.2, client: 'Yanis Robert', articles: [['chaussettes', 0, '43-46']], etat: 'NONPAYEE' },
];

export const orderIdDemo = (numero: number): string => `gid://shopify/Order/${numero}`;

/** Le numéro de suivi d'une commande : stable d'une démo à l'autre. */
export function numeroSuiviDemo(numero: number, transporteur: string): string {
  const chiffres = String((numero * 7_919_311) % 9_999_999_999).padStart(10, '0');
  return transporteur === 'Colissimo' ? `6A${chiffres}0` : `YT2610${chiffres}`;
}

/** Les colis de la démo, par numéro de suivi : ce que le suivi fictif raconte. */
export function scenariosColis(): Map<string, ScenarioColis & { numero: number; transporteur: string }> {
  const carte = new Map<string, ScenarioColis & { numero: number; transporteur: string }>();
  for (const spec of SPECS) {
    const etat = spec.etat === 'REMBOURSEE' || spec.etat === 'PARTIEL' ? 'livre' : spec.etat;
    if (etat === 'NONPAYEE' || etat === 'A_EXPEDIER') continue;
    const transporteur = spec.transporteur ?? 'YunExpress';
    carte.set(numeroSuiviDemo(spec.numero, transporteur), {
      numero: spec.numero,
      transporteur,
      etat,
      expedie: Math.max(0, spec.il - (spec.delai ?? 1)),
      sansScan: spec.sansScan,
    });
  }
  return carte;
}

/** Les commandes au format de la boutique fictive, datées depuis `maintenant`. */
export function commandesDemo(maintenant = Date.now()): MockOrder[] {
  const parClient = new Map<string, SpecCommande[]>();
  for (const spec of SPECS) parClient.set(spec.client, [...(parClient.get(spec.client) ?? []), spec]);

  return SPECS.map((spec) => {
    const client = clientDemo(spec.client);
    // Une heure de commande plausible, et stable : entre 8 h et 23 h.
    const passee = maintenant - spec.il * JOUR - ((spec.numero * 37) % 9) * HEURE;
    const items = spec.articles.map(([cle, coloris, taille, quantite = 1]) => {
      const produit = produitDemo(cle);
      return {
        title: produit.titre,
        quantity: quantite,
        variantTitle: `${produit.coloris[coloris]!.nom} / ${taille}`,
        sku: skuDemo(cle, coloris, taille),
        image: imageDemo(produit.coloris[coloris]!.image),
        prix: produit.prix,
        vendor: DEMO.marque,
      };
    });
    // Livraison offerte dès 60 €, comme dans la plupart des boutiques.
    const sousTotal = items.reduce((somme, item) => somme + item.prix * item.quantity, 0);
    const total = sousTotal + (sousTotal < 60 ? 4.9 : 0);
    const commandesClient = parClient.get(spec.client)!;
    const depense = commandesClient.reduce(
      (somme, autre) => somme + autre.articles.reduce((s, [cle, , , q = 1]) => s + produitDemo(cle).prix * q, 0),
      0,
    );

    const transporteur = spec.transporteur ?? 'YunExpress';
    const expedie = spec.etat !== 'NONPAYEE' && spec.etat !== 'A_EXPEDIER';
    const scenario = spec.etat === 'REMBOURSEE' || spec.etat === 'PARTIEL' ? 'livre' : spec.etat;
    const expedieLe = passee + (spec.delai ?? 1) * JOUR;
    const suivi = suiviDemo({ etat: scenario as EtatColis, expedie: Math.max(0, spec.il - (spec.delai ?? 1)), sansScan: spec.sansScan }, transporteur, maintenant);

    return {
      id: orderIdDemo(spec.numero),
      name: `#${spec.numero}`,
      createdAt: new Date(passee).toISOString(),
      displayFinancialStatus:
        spec.etat === 'NONPAYEE' ? 'PENDING' : spec.etat === 'REMBOURSEE' ? 'REFUNDED' : spec.etat === 'PARTIEL' ? 'PARTIALLY_REFUNDED' : 'PAID',
      displayFulfillmentStatus: !expedie
        ? 'UNFULFILLED'
        : scenario === 'livre'
          ? 'FULFILLED'
          : 'IN_TRANSIT',
      total: total.toFixed(2),
      currency: 'EUR',
      customerEmail: client.email,
      customerName: client.nom,
      customerSince: new Date(maintenant - client.depuis * JOUR).toISOString(),
      customerOrders: commandesClient.length,
      customerSpent: depense.toFixed(2),
      items,
      fulfillments: expedie
        ? [
            {
              status: STATUT_SHOPIFY[scenario as EtatColis],
              updatedAt: suivi.lastUpdatedAt ?? new Date(expedieLe).toISOString(),
              estimatedDeliveryAt: scenario === 'livre' ? null : new Date(expedieLe + 9 * JOUR).toISOString(),
              company: transporteur,
              number: numeroSuiviDemo(spec.numero, transporteur),
            },
          ]
        : [],
      address: {
        name: client.nom,
        address1: client.adresse,
        city: client.ville,
        zip: client.cp,
        province: '',
        country: client.pays,
        phone: client.tel,
      },
    };
  });
}

const STATUT_SHOPIFY: Record<EtatColis, string> = {
  prise: 'CONFIRMED',
  transit: 'IN_TRANSIT',
  bloque: 'IN_TRANSIT',
  relais: 'READY_FOR_PICKUP',
  livre: 'DELIVERED',
};

/*
 * Le suivi fictif : la route d'un colis parti d'un atelier en Chine, telle
 * qu'un transporteur la raconte. Les étapes s'égrènent depuis l'expédition ;
 * un colis bloqué s'arrête `sansScan` jours avant aujourd'hui.
 */
const ETAPES: Array<{ apres: number; quoi: string; lieu: string; statut: string }> = [
  { apres: 0, quoi: 'Colis pris en charge par le transporteur', lieu: 'Guangzhou, CN', statut: 'InfoReceived' },
  { apres: 0.6, quoi: 'Départ du centre de tri', lieu: 'Guangzhou, CN', statut: 'InTransit' },
  { apres: 1.8, quoi: 'Remis à la compagnie aérienne', lieu: 'Shenzhen, CN', statut: 'InTransit' },
  { apres: 3.2, quoi: 'Arrivé à l’aéroport de destination', lieu: 'Roissy-Charles-de-Gaulle, FR', statut: 'InTransit' },
  { apres: 4.1, quoi: 'Dédouané, remis au transporteur local', lieu: 'Roissy-Charles-de-Gaulle, FR', statut: 'InTransit' },
  { apres: 5.3, quoi: 'Arrivé au centre de tri régional', lieu: 'Wissous, FR', statut: 'InTransit' },
  { apres: 6.4, quoi: 'En cours de livraison', lieu: 'Plateforme de distribution', statut: 'OutForDelivery' },
];

export function suiviDemo(
  scenario: ScenarioColis,
  transporteur: string,
  maintenant = Date.now(),
): { status: string; events: Array<{ at: string; status: string; location: string | null }>; deliveredAt: string | null; lastUpdatedAt: string | null } {
  const depart = maintenant - scenario.expedie * JOUR;
  // Jusqu'où le colis est allé : un colis bloqué s'est arrêté il y a `sansScan` jours.
  const limite = scenario.etat === 'bloque' ? maintenant - (scenario.sansScan ?? 4) * JOUR : maintenant;
  const etapes = ETAPES.filter((etape) => depart + etape.apres * JOUR <= limite);
  if (scenario.etat === 'prise') etapes.splice(1);
  const events: Array<{ at: string; status: string; location: string | null }> = etapes.map((etape) => ({
    at: new Date(depart + etape.apres * JOUR).toISOString(),
    status: etape.quoi,
    location: etape.lieu,
  }));

  let status = scenario.etat === 'prise' ? 'InfoReceived' : 'InTransit';
  let deliveredAt: string | null = null;
  if (scenario.etat === 'relais') {
    status = 'AvailableForPickup';
    events.push({ at: new Date(maintenant - 1.2 * JOUR).toISOString(), status: 'Disponible en point relais', location: 'Relais Pickup, centre-ville' });
  }
  if (scenario.etat === 'livre') {
    status = 'Delivered';
    const livre = Math.min(maintenant - 0.5 * JOUR, depart + 7.1 * JOUR);
    deliveredAt = new Date(livre).toISOString();
    events.push({ at: deliveredAt, status: transporteur === 'Colissimo' ? 'Votre colis est livré' : 'Livré dans la boîte aux lettres', location: null });
  }
  if (scenario.etat === 'bloque' && events.length === 0) {
    events.push({ at: new Date(limite).toISOString(), status: ETAPES[0]!.quoi, location: ETAPES[0]!.lieu });
  }

  events.sort((a, b) => b.at.localeCompare(a.at));
  return { status, events, deliveredAt, lastUpdatedAt: events[0]?.at ?? null };
}
