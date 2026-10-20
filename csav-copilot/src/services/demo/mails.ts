/*
 * Les trente mails ouverts de la démonstration.
 *
 * Un SAV de baskets un mardi ordinaire : des « où est mon colis », des
 * tailles à échanger, un colis livré que personne n'a vu, une menace
 * d'opposition bancaire, des questions de pointure, deux remerciements. Les
 * brouillons sont ceux qu'écrirait l'IA ; la démo n'a pas à attendre qu'elle
 * tourne pour montrer la file.
 */

export type IntentDemo = 'WISMO' | 'RETURN' | 'DISPUTE' | 'REFUND' | 'PRODUCT_QUESTION' | 'POSITIVE' | 'OTHER';
export type StatutDemo = 'DRAFT_READY' | 'NEEDS_REVIEW' | 'AWAITING_SUPPLIER' | 'NEW';

export interface MailDemo {
  cle: string;
  client: string;
  /** Adresse d'un expéditeur hors fichier client. */
  email?: string;
  commande?: number;
  sujet: string;
  intent: IntentDemo;
  confiance: number;
  statut: StatutDemo;
  langue?: 'fr' | 'en' | 'es';
  match?: 'ORDER_NUMBER_IN_BODY' | 'CUSTOMER_EMAIL' | 'NAME_AND_RECENT_DATE';
  assigne?: 'hugo' | 'maelle';
  /** Le fil, du plus ancien au plus récent ; `il` en minutes. */
  messages: Array<{ sens: 'in' | 'out'; il: number; corps: string }>;
  /** Photos jointes au dernier message du client (images du catalogue). */
  photos?: string[];
  lu?: boolean;
  brouillon?: { corps: string; confiance: number; raisonnement: string; resume: string[]; demande: string };
}

const SIGNATURE = '\n\nBelle journée,\nInès — Service client Kairo';

export const MAILS: MailDemo[] = [
  /* ---------------------------------------------------------- où est mon colis */
  {
    cle: 'wismo-lea', client: 'Léa Fontaine', commande: 4131, sujet: 'Où en est ma commande ?',
    intent: 'WISMO', confiance: 0.96, statut: 'DRAFT_READY', match: 'ORDER_NUMBER_IN_BODY',
    messages: [{ sens: 'in', il: 9, corps: "Bonjour,\n\nJ'ai passé la commande #4131 il y a une semaine et je n'ai pas eu de nouvelles depuis le mail d'expédition. Pouvez-vous me dire quand je vais la recevoir ?\n\nMerci beaucoup,\nLéa" }],
    brouillon: {
      confiance: 0.94,
      raisonnement: 'Commande citée dans le mail et confirmée par l’adresse. Le suivi YunExpress montre un colis arrivé en France, en cours d’acheminement.',
      resume: ['Commande #4131 expédiée il y a 6 jours par YunExpress.', 'Le colis est arrivé en France et avance normalement.', 'Livraison attendue sous 2 à 3 jours.'],
      demande: 'Savoir quand la commande arrivera',
      corps: "Bonjour Léa,\n\nBonne nouvelle : votre commande #4131 est bien en route. Elle est arrivée en France et se trouve au centre de tri régional ; la livraison devrait intervenir d'ici 2 à 3 jours ouvrés.\n\nVous pouvez suivre son trajet avec le numéro de suivi indiqué dans votre mail d'expédition." + SIGNATURE,
    },
  },
  {
    cle: 'wismo-karim', client: 'Karim Benali', commande: 4122, sujet: 'Colis bloqué depuis une semaine',
    intent: 'WISMO', confiance: 0.93, statut: 'DRAFT_READY', match: 'CUSTOMER_EMAIL', assigne: 'hugo',
    messages: [{ sens: 'in', il: 47, corps: "Bonjour,\n\nLe suivi de ma commande n'a plus bougé depuis 6 jours, il est marqué « arrivé à l'aéroport de destination » et puis plus rien. C'est normal ? J'en ai besoin pour samedi.\n\nKarim Benali" }],
    brouillon: {
      confiance: 0.71,
      raisonnement: 'Aucun scan depuis 6 jours après l’arrivée à Roissy : probable attente de dédouanement. Une demande à l’atelier est conseillée avant de promettre une date.',
      resume: ['Commande #4122 trouvée par l’adresse du client.', 'Dernier scan il y a 6 jours, à l’aéroport de Roissy.', 'Le client en a besoin pour samedi.'],
      demande: 'Recevoir le colis avant samedi',
      corps: "Bonjour Karim,\n\nMerci de nous avoir prévenus. Votre colis (commande #4122) est arrivé en France il y a quelques jours et attend vraisemblablement son passage en douane, ce qui explique l'absence de mise à jour.\n\nNous avons demandé à notre transporteur de vérifier sa position et revenons vers vous dès que nous avons sa réponse. S'il ne pouvait pas arriver à temps, nous trouverons une solution ensemble." + SIGNATURE,
    },
  },
  {
    cle: 'wismo-camille', client: 'Camille Petit', sujet: 'Nouveau message depuis le formulaire de contact',
    intent: 'WISMO', confiance: 0.82, statut: 'NEEDS_REVIEW',
    messages: [{ sens: 'in', il: 64, corps: "Nom : Camille Petit\nE-mail : camille.petit@yahoo.fr\n\nMessage :\nBonjour, je n'ai toujours pas reçu mes baskets, pouvez-vous vérifier ? Merci" }],
  },
  {
    cle: 'wismo-james', client: 'James Carter', commande: 4127, sujet: 'Where is my order #4127?',
    intent: 'WISMO', confiance: 0.95, statut: 'DRAFT_READY', langue: 'en', match: 'ORDER_NUMBER_IN_BODY',
    messages: [{ sens: 'in', il: 95, corps: "Hi there,\n\nI ordered the Trail X a week ago (order #4127) and I'd like to know when it will arrive in Brussels. Thanks!\n\nJames" }],
    brouillon: {
      confiance: 0.92,
      raisonnement: 'Commande citée, suivi en mouvement : colis au centre de tri, livraison prochaine. Réponse en anglais, la langue du client.',
      resume: ['Commande #4127 expédiée il y a 6 jours.', 'Le colis est au centre de tri, il avance normalement.', 'Le client écrit en anglais.'],
      demande: 'Savoir quand la commande arrivera à Bruxelles',
      corps: "Hi James,\n\nThanks for reaching out! Your order #4127 is on its way: it has reached the regional sorting centre and should be delivered within the next 2–3 business days.\n\nYou can follow it at any time with the tracking number from your shipping confirmation.\n\nBest regards,\nInès — Kairo Customer Care",
    },
  },
  {
    cle: 'wismo-sarah', client: 'Sarah Cohen', commande: 4139, sujet: 'Expédition de ma commande',
    intent: 'WISMO', confiance: 0.91, statut: 'DRAFT_READY', match: 'CUSTOMER_EMAIL',
    messages: [{ sens: 'in', il: 130, corps: "Bonjour,\n\nJ'ai commandé avant-hier les Aero Knit rose. Savez-vous quand elles seront expédiées ? C'est pour un anniversaire la semaine prochaine.\n\nSarah" }],
    brouillon: {
      confiance: 0.88,
      raisonnement: 'Commande payée il y a 2 jours, pas encore expédiée : dans les délais annoncés (2 à 4 jours de préparation).',
      resume: ['Commande #4139 payée il y a 2 jours.', 'En préparation, pas encore expédiée.', 'Cadeau d’anniversaire pour la semaine prochaine.'],
      demande: 'Connaître la date d’expédition',
      corps: "Bonjour Sarah,\n\nVotre commande #4139 est en cours de préparation et partira dans les 48 heures. Vous recevrez aussitôt un mail avec le numéro de suivi.\n\nComptez ensuite 6 à 8 jours de livraison : pour un anniversaire la semaine prochaine, ce sera juste — si vous le souhaitez, nous pouvons glisser une carte cadeau à imprimer en attendant." + SIGNATURE,
    },
  },
  {
    cle: 'wismo-mehdi', client: 'Mehdi Amrani', commande: 4118, sujet: 'Re: Ma commande #4118',
    intent: 'WISMO', confiance: 0.9, statut: 'AWAITING_SUPPLIER', match: 'ORDER_NUMBER_IN_BODY', assigne: 'maelle',
    messages: [
      { sens: 'in', il: 3 * 1440 + 200, corps: "Bonjour, ma commande #4118 n'avance plus, le suivi est bloqué. Pouvez-vous regarder ?" },
      { sens: 'out', il: 3 * 1440 + 90, corps: "Bonjour Mehdi,\n\nNous avons bien noté le blocage et interrogeons notre transporteur. Nous revenons vers vous très vite." + SIGNATURE },
      { sens: 'in', il: 38, corps: "Bonjour,\n\nTrois jours plus tard, toujours rien. Le suivi n'a pas bougé depuis plus d'une semaine maintenant. Si le colis est perdu, je préfère être remboursé.\n\nMehdi Amrani" },
    ],
  },
  {
    cle: 'wismo-pauline', client: 'Pauline Mercier', commande: 4125, sujet: 'Colis en point relais mais je suis absente',
    intent: 'WISMO', confiance: 0.87, statut: 'DRAFT_READY', match: 'CUSTOMER_EMAIL',
    messages: [{ sens: 'in', il: 210, corps: "Bonjour,\n\nJ'ai reçu un avis : mon colis est en point relais, mais je suis en déplacement jusqu'à la fin de la semaine prochaine. Que se passe-t-il s'il n'est pas retiré à temps ?\n\nPauline" }],
    brouillon: {
      confiance: 0.86,
      raisonnement: 'Colis disponible en point relais depuis 1 jour. Délai de garde habituel : 14 jours.',
      resume: ['Commande #4125 disponible en point relais depuis hier.', 'La cliente est absente jusqu’à la fin de la semaine prochaine.'],
      demande: 'Savoir si le colis attendra son retour',
      corps: "Bonjour Pauline,\n\nPas d'inquiétude : le point relais garde votre colis 14 jours à compter de son arrivée, il vous attendra donc à votre retour.\n\nSi vous préférez qu'un proche le retire à votre place, il lui suffira de présenter une pièce d'identité et le code reçu par SMS." + SIGNATURE,
    },
  },

  {
    cle: 'wismo-helene', client: 'Hélène Vidal', commande: 4132, sujet: 'Suivi qui ne bouge pas',
    intent: 'WISMO', confiance: 0.9, statut: 'DRAFT_READY', match: 'CUSTOMER_EMAIL',
    messages: [{ sens: 'in', il: 4 * 60 + 15, corps: "Bonjour,\n\nLe suivi de mon sweat indique « pris en charge » depuis plusieurs jours, sans autre étape. Est-ce que le colis est vraiment parti ?\n\nHélène Vidal" }],
    brouillon: {
      confiance: 0.76,
      raisonnement: 'Étiquette créée il y a 4 jours, aucun scan depuis : le colis n’a peut-être pas encore été remis au transporteur. À vérifier auprès de l’atelier.',
      resume: ['Commande #4132 : un Sweat Kairo Club Gris, taille L.', 'Suivi « pris en charge » depuis 4 jours, sans autre étape.'],
      demande: 'Savoir si le colis est bien parti',
      corps: "Bonjour Hélène,\n\nMerci pour votre message. Le numéro de suivi de votre commande #4132 a bien été créé, mais le transporteur n'a pas encore scanné le colis : nous vérifions avec notre entrepôt qu'il lui a bien été remis et revenons vers vous dans la journée." + SIGNATURE,
    },
  },

  /* ---------------------------------------------------------------- retours */
  {
    cle: 'retour-emma', client: 'Emma Dubois', commande: 4109, sujet: 'Échange de taille Runner 01',
    intent: 'RETURN', confiance: 0.95, statut: 'DRAFT_READY', match: 'CUSTOMER_EMAIL',
    messages: [{ sens: 'in', il: 22, corps: "Bonjour,\n\nLes Runner 01 en 39 sont un peu trop petites, est-ce que je peux les échanger contre du 40 ? Elles n'ont pas été portées, juste essayées.\n\nMerci,\nEmma" }],
    brouillon: {
      confiance: 0.9,
      raisonnement: 'Échange de taille dans les 30 jours, article non porté : accepté par la politique de la boutique. La taille 40 est en stock.',
      resume: ['Commande #4109 livrée il y a 9 jours.', 'Runner 01 Blanc / Gris en 39, non portées.', 'Souhaite la taille 40, disponible en stock.'],
      demande: 'Échanger du 39 contre du 40',
      corps: "Bonjour Emma,\n\nBien sûr ! Vous trouverez ci-joint l'étiquette de retour prépayée : il suffit de déposer le colis dans un bureau de poste.\n\nDès réception, nous vous envoyons la paire en 40 — elle est en stock et partira le jour même." + SIGNATURE,
    },
  },
  {
    cle: 'retour-rayan', client: 'Rayan Haddou', commande: 4105, sujet: 'Retour Trail X',
    intent: 'RETURN', confiance: 0.92, statut: 'DRAFT_READY', match: 'CUSTOMER_EMAIL',
    messages: [{ sens: 'in', il: 180, corps: "Bonjour,\n\nJe souhaite retourner les Trail X noires, finalement elles ne me plaisent pas trop une fois aux pieds. Je garde le sweat. Comment je fais ?\n\nRayan" }],
    brouillon: {
      confiance: 0.89,
      raisonnement: 'Retour partiel (une ligne sur deux) dans le délai de 30 jours. Remboursement de la paire à réception.',
      resume: ['Commande #4105 : Trail X Noir 44 et Sweat Kairo Club.', 'Retour des Trail X seulement.', 'Livrée il y a 16 jours, dans le délai de retour.'],
      demande: 'Retourner les Trail X et être remboursé',
      corps: "Bonjour Rayan,\n\nC'est noté : voici l'étiquette de retour pour les Trail X. Déposez le colis dans un bureau de poste sous 14 jours.\n\nLe remboursement de la paire (149 €) partira sur votre moyen de paiement dès que nous l'aurons reçue et contrôlée." + SIGNATURE,
    },
  },
  {
    cle: 'retour-zoe', client: 'Zoé Laurent', commande: 4102, sujet: 'Couture qui se défait',
    intent: 'RETURN', confiance: 0.88, statut: 'NEEDS_REVIEW', match: 'CUSTOMER_EMAIL', photos: ['aero-rose', 'aero-rose'],
    messages: [{ sens: 'in', il: 260, corps: "Bonjour,\n\nAu bout de deux semaines, la couture sur le côté de mes Aero Knit commence à se défaire (photos jointes). Je ne les ai portées que trois fois. Que pouvez-vous faire ?\n\nZoé" }],
  },
  {
    cle: 'retour-nicolas', client: 'Nicolas Blanc', commande: 4098, sujet: 'Remboursement de mon retour',
    intent: 'REFUND', confiance: 0.9, statut: 'DRAFT_READY', match: 'CUSTOMER_EMAIL',
    messages: [{ sens: 'in', il: 340, corps: "Bonjour,\n\nJ'ai renvoyé les Street Mid lundi dernier avec l'étiquette que vous m'aviez envoyée. Quand serai-je remboursé ?\n\nNicolas Blanc" }],
    brouillon: {
      confiance: 0.85,
      raisonnement: 'Le retour est en transit vers l’agence (Colissimo, déposé il y a 2 jours). Remboursement à réception et contrôle.',
      resume: ['Retour de la commande #4098 déposé il y a 2 jours.', 'Colis en route vers notre agence.', 'Remboursement à réception et contrôle.'],
      demande: 'Savoir quand il sera remboursé',
      corps: "Bonjour Nicolas,\n\nVotre colis retour est bien en route vers notre entrepôt. Dès réception et contrôle — en général sous 3 à 5 jours — nous lançons le remboursement de 139 € ; il apparaît ensuite sur votre compte sous quelques jours selon votre banque." + SIGNATURE,
    },
  },
  {
    cle: 'retour-olivia', client: 'Olivia Brown', commande: 4111, sujet: 'Exchange for another colour',
    intent: 'RETURN', confiance: 0.9, statut: 'DRAFT_READY', langue: 'en', match: 'CUSTOMER_EMAIL',
    messages: [{ sens: 'in', il: 1440 + 120, corps: "Hello,\n\nThe Aero Knit in grey fits perfectly but I'd rather have it in the pink colour, same size (39). Is an exchange possible?\n\nMany thanks,\nOlivia" }],
    brouillon: {
      confiance: 0.87,
      raisonnement: 'Échange de coloris, même taille, même prix : pas de différence à régler. Rose poudré 39 en stock.',
      resume: ['Commande #4111 livrée en Suisse.', 'Échange Gris chiné → Rose poudré, taille 39.', 'Même prix, pas de différence à payer.'],
      demande: 'Échanger pour le coloris rose',
      corps: "Hello Olivia,\n\nOf course! Please find attached a prepaid return label. As soon as your parcel is on its way back, we'll ship the Aero Knit in Rose poudré, size 39 — there's no price difference.\n\nBest regards,\nInès — Kairo Customer Care",
    },
  },

  /* ---------------------------------------------------------- remboursements */
  {
    cle: 'remb-clara', client: 'Clara Henry', commande: 4114, sujet: 'Remboursement non reçu',
    intent: 'REFUND', confiance: 0.92, statut: 'DRAFT_READY', match: 'CUSTOMER_EMAIL', assigne: 'hugo',
    messages: [{ sens: 'in', il: 75, corps: "Bonjour,\n\nVous m'avez indiqué que le remboursement de mes Street Mid avait été fait, mais je ne vois toujours rien sur mon compte. Pouvez-vous vérifier ?\n\nClara Henry" }],
    brouillon: {
      confiance: 0.9,
      raisonnement: 'Remboursement de 139 € effectué il y a 3 jours dans Shopify. Délai bancaire habituel : 3 à 10 jours ouvrés.',
      resume: ['Commande #4114 remboursée intégralement il y a 3 jours (139 €).', 'Pas encore visible sur le compte de la cliente.'],
      demande: 'Confirmer que le remboursement a été fait',
      corps: "Bonjour Clara,\n\nJe confirme que le remboursement de 139 € a bien été émis il y a 3 jours sur la carte utilisée pour la commande #4114.\n\nSelon les banques, il faut compter 3 à 10 jours ouvrés avant qu'il apparaisse sur le compte. Si rien n'est visible d'ici la fin de la semaine prochaine, écrivez-nous : nous vous transmettrons la référence de l'opération pour votre banque." + SIGNATURE,
    },
  },
  {
    cle: 'remb-bilal', client: 'Bilal Kaci', commande: 4135, sujet: 'Annulation de commande',
    intent: 'REFUND', confiance: 0.9, statut: 'NEEDS_REVIEW', match: 'CUSTOMER_EMAIL',
    messages: [{ sens: 'in', il: 55, corps: "Bonjour,\n\nJe me suis trompé de modèle, je voulais les Trail X en kaki et pas en noir. Pouvez-vous annuler ma commande et me rembourser ? Elle n'est pas encore partie je crois.\n\nBilal" }],
  },
  {
    cle: 'remb-jade', client: 'Jade Morel', commande: 4108, sujet: 'Article abîmé à la réception',
    intent: 'REFUND', confiance: 0.86, statut: 'NEEDS_REVIEW', match: 'CUSTOMER_EMAIL', photos: ['runner-blanc-gris'],
    messages: [{ sens: 'in', il: 1440 + 300, corps: "Bonjour,\n\nLes Runner reçues ont une tache sur le côté qui ne part pas (photo jointe). Je souhaiterais un remboursement plutôt qu'un échange.\n\nJade Morel" }],
  },
  {
    cle: 'remb-maxime', client: 'Maxime Roux', commande: 4100, sujet: 'Code promo non appliqué',
    intent: 'REFUND', confiance: 0.84, statut: 'DRAFT_READY', match: 'CUSTOMER_EMAIL',
    messages: [{ sens: 'in', il: 2 * 1440 + 60, corps: "Bonjour,\n\nJ'avais un code de bienvenue de 10 % (BIENVENUE10) mais il ne s'est pas appliqué au paiement. Est-il possible de me rembourser la différence ?\n\nMaxime" }],
    brouillon: {
      confiance: 0.78,
      raisonnement: 'Code de bienvenue valide pour un premier achat ; c’est bien la première commande du client. Remboursement partiel de 12,90 € à valider.',
      resume: ['Commande #4100 de 129 €, première commande du client.', 'Code BIENVENUE10 non appliqué.', 'Différence : 12,90 €.'],
      demande: 'Être remboursé de la remise oubliée',
      corps: "Bonjour Maxime,\n\nVous avez raison, le code aurait dû s'appliquer à votre première commande. Nous venons de vous rembourser la différence, soit 12,90 €, sur votre moyen de paiement.\n\nMerci pour votre confiance et bonne route avec vos Runner !" + SIGNATURE,
    },
  },

  /* ----------------------------------------------------------------- litiges */
  {
    cle: 'litige-antoine', client: 'Antoine Faure', commande: 4116, sujet: 'Colis marqué livré mais pas reçu',
    intent: 'DISPUTE', confiance: 0.91, statut: 'NEEDS_REVIEW', match: 'CUSTOMER_EMAIL', assigne: 'maelle',
    messages: [{ sens: 'in', il: 150, corps: "Bonjour,\n\nLe suivi indique que mon colis a été livré dans ma boîte aux lettres il y a 5 jours, mais je n'ai rien reçu. J'ai demandé aux voisins et au gardien, rien. Que fait-on ?\n\nAntoine Faure" }],
  },
  {
    cle: 'litige-lina', client: 'Lina Chevalier', commande: 4104, sujet: 'Je vais faire opposition',
    intent: 'DISPUTE', confiance: 0.89, statut: 'NEEDS_REVIEW', match: 'CUSTOMER_EMAIL',
    messages: [{ sens: 'in', il: 2 * 1440 + 400, corps: "Bonjour,\n\nCela fait deux fois que j'écris sans réponse au sujet de mes Street Mid. Sans nouvelles de votre part d'ici demain, je fais opposition auprès de ma banque.\n\nLina Chevalier" }],
  },
  {
    cle: 'litige-theo', client: 'Théo Masson', commande: 4112, sujet: 'Mauvais modèle reçu',
    intent: 'DISPUTE', confiance: 0.88, statut: 'AWAITING_SUPPLIER', match: 'CUSTOMER_EMAIL', photos: ['court-blanc'],
    messages: [{ sens: 'in', il: 1440 + 500, corps: "Bonjour,\n\nJ'ai commandé des Runner 01 noires en 42 et j'ai reçu des Court Low blanches (photo). Pouvez-vous m'envoyer la bonne paire ?\n\nThéo" }],
  },

  /* ------------------------------------------------------- questions produit */
  {
    cle: 'question-alice', client: 'Alice Perrin', sujet: 'Taille des Runner 01',
    intent: 'PRODUCT_QUESTION', confiance: 0.94, statut: 'DRAFT_READY',
    messages: [{ sens: 'in', il: 33, corps: "Bonjour,\n\nJe fais du 39 d'habitude mais parfois du 40 en running. Les Runner 01 taillent-elles grand ou petit ?\n\nAlice" }],
    brouillon: {
      confiance: 0.9,
      raisonnement: 'Question de pointure : le guide des tailles indique que la Runner 01 taille normalement, avec un chaussant ajusté.',
      resume: ['Cliente habituelle, chausse du 39, parfois du 40 en running.', 'Hésite sur la pointure des Runner 01.'],
      demande: 'Choisir la bonne pointure',
      corps: "Bonjour Alice,\n\nLes Runner 01 taillent normalement, avec un chaussant plutôt ajusté à l'avant du pied. Si vous prenez du 40 dans vos chaussures de running, nous vous conseillons le 40 ; pour un usage de tous les jours, le 39 conviendra.\n\nEt si la taille ne va pas, l'échange est gratuit sous 30 jours." + SIGNATURE,
    },
  },
  {
    cle: 'question-diego', client: 'Diego Martín', sujet: '¿Envían a España?',
    intent: 'PRODUCT_QUESTION', confiance: 0.93, statut: 'DRAFT_READY', langue: 'es',
    messages: [{ sens: 'in', il: 115, corps: "Hola,\n\n¿Hacen envíos a Madrid? ¿Cuánto tarda y cuánto cuesta el envío?\n\nGracias,\nDiego" }],
    brouillon: {
      confiance: 0.9,
      raisonnement: 'L’Espagne fait partie des pays livrés. Livraison offerte dès 60 €, 6 à 9 jours ouvrés.',
      resume: ['Client en Espagne, pas encore de commande.', 'Demande les délais et les frais de livraison.'],
      demande: 'Savoir si la boutique livre en Espagne',
      corps: "Hola Diego,\n\n¡Sí, enviamos a toda España! El envío es gratuito a partir de 60 € y tarda entre 6 y 9 días laborables. Recibirás un número de seguimiento en cuanto salga tu pedido.\n\nUn saludo,\nInès — Atención al cliente Kairo",
    },
  },
  {
    cle: 'question-manon', client: 'Manon Lefèvre', sujet: 'Retour en stock Trail X kaki 41 ?',
    intent: 'PRODUCT_QUESTION', confiance: 0.92, statut: 'DRAFT_READY',
    messages: [{ sens: 'in', il: 410, corps: "Bonjour,\n\nLe Trail X kaki est-il prévu en réassort en 41 ? Je ne le vois plus sur le site.\n\nMerci, Manon" }],
    brouillon: {
      confiance: 0.8,
      raisonnement: 'Le 41 n’est pas épuisé dans le catalogue, mais une rupture est signalée par l’atelier sur le 43. À vérifier avant de promettre.',
      resume: ['Cliente fidèle (2 commandes).', 'Cherche le Trail X Kaki en 41.'],
      demande: 'Savoir si le modèle revient en stock',
      corps: "Bonjour Manon,\n\nBonne nouvelle : le Trail X kaki en 41 est de nouveau disponible sur le site depuis ce matin. Les stocks partent vite sur ce coloris, n'hésitez pas !" + SIGNATURE,
    },
  },
  {
    cle: 'question-yanis', client: 'Yanis Robert', sujet: 'Court Low ou Runner pour courir ?',
    intent: 'PRODUCT_QUESTION', confiance: 0.9, statut: 'DRAFT_READY', lu: true,
    messages: [{ sens: 'in', il: 1440 + 30, corps: "Salut,\n\nJe cours 2 fois par semaine, 5 à 8 km. Vous me conseillez plutôt les Runner 01 ou les Court Low ?\n\nYanis" }],
    brouillon: {
      confiance: 0.88,
      raisonnement: 'Conseil produit : la Court Low est une basket lifestyle, la Runner 01 a un amorti adapté à la course.',
      resume: ['Court 2 fois par semaine, 5 à 8 km.', 'Hésite entre Runner 01 et Court Low.'],
      demande: 'Choisir le bon modèle pour courir',
      corps: "Salut Yanis,\n\nPour courir, sans hésiter la Runner 01 : sa semelle amortie et son mesh respirant sont faits pour ça. La Court Low est une basket de ville, très confortable au quotidien mais pas pensée pour la course.\n\nBons kilomètres !" + SIGNATURE,
    },
  },

  /* -------------------------------------------------------------- modifications */
  {
    cle: 'modif-sophie', client: 'Sophie Nguyen', commande: 4138, sujet: "Changement d'adresse de livraison",
    intent: 'OTHER', confiance: 0.9, statut: 'NEEDS_REVIEW', match: 'CUSTOMER_EMAIL',
    messages: [{ sens: 'in', il: 18, corps: "Bonjour,\n\nJe me suis trompée d'adresse sur la commande #4138 : pouvez-vous l'envoyer au 12 rue Oberkampf, 75011 Paris, plutôt qu'à la rue Lafayette ?\n\nMerci beaucoup,\nSophie" }],
  },
  {
    cle: 'modif-lucas', client: 'Lucas Bernard', commande: 4137, sujet: 'Changer la taille avant expédition',
    intent: 'OTHER', confiance: 0.9, statut: 'DRAFT_READY', match: 'CUSTOMER_EMAIL',
    messages: [{ sens: 'in', il: 3 * 60 + 40, corps: "Bonjour,\n\nPour ma commande d'hier (Runner 01 noir/rouge), est-ce possible de passer du 42 au 43 avant l'expédition ?\n\nLucas" }],
    brouillon: {
      confiance: 0.86,
      raisonnement: 'Commande pas encore expédiée : la taille peut être changée chez l’atelier. Le 43 est en stock.',
      resume: ['Commande #4137 pas encore expédiée.', 'Passer la Runner 01 Noir / Rouge du 42 au 43.'],
      demande: 'Changer la pointure avant le départ du colis',
      corps: "Bonjour Lucas,\n\nC'est fait : votre commande #4137 partira en 43. Vous recevrez le numéro de suivi dès l'expédition." + SIGNATURE,
    },
  },
  {
    cle: 'modif-julien', client: 'Julien Meyer', commande: 4140, sujet: 'Ajouter des chaussettes à ma commande',
    intent: 'OTHER', confiance: 0.85, statut: 'DRAFT_READY', match: 'CUSTOMER_EMAIL',
    messages: [{ sens: 'in', il: 6 * 60, corps: "Bonjour,\n\nJ'ai commandé hier les Street Mid. Est-ce possible d'ajouter un lot de chaussettes noires 43-46 dans le même colis ?\n\nJulien" }],
    brouillon: {
      confiance: 0.74,
      raisonnement: 'Ajout d’un article à une commande non expédiée : nécessite une commande complémentaire et l’accord de l’atelier.',
      resume: ['Commande #4140 non expédiée.', 'Ajouter un lot de chaussettes noires 43-46.'],
      demande: 'Ajouter un article au colis',
      corps: "Bonjour Julien,\n\nAvec plaisir ! Je vous envoie un lien de paiement de 15 € pour le lot de chaussettes ; dès qu'il est réglé, nous les ajoutons au colis de votre commande #4140, qui n'est pas encore parti." + SIGNATURE,
    },
  },

  /* ---------------------------------------------------------------- positifs */
  {
    cle: 'merci-amelie', client: 'Amélie Rousseau', commande: 4099, sujet: 'Merci !',
    intent: 'POSITIVE', confiance: 0.97, statut: 'DRAFT_READY', match: 'CUSTOMER_EMAIL', lu: true,
    messages: [{ sens: 'in', il: 2 * 1440 + 200, corps: "Bonjour,\n\nJuste un mot pour vous dire que je suis ravie de mes Court Low, superbe qualité et très confortables. Je recommanderai !\n\nAmélie" }],
    brouillon: {
      confiance: 0.97,
      raisonnement: 'Message de satisfaction, aucune action attendue.',
      resume: ['Cliente fidèle, ravie de ses Court Low.'],
      demande: 'Aucune — remerciement',
      corps: "Bonjour Amélie,\n\nMerci beaucoup pour votre message, il fait plaisir à toute l'équipe ! Au plaisir de vous revoir bientôt chez Kairo." + SIGNATURE,
    },
  },
  {
    cle: 'merci-thomas', client: 'Thomas Girard', commande: 4103, sujet: 'Super service',
    intent: 'POSITIVE', confiance: 0.95, statut: 'DRAFT_READY', match: 'CUSTOMER_EMAIL', lu: true,
    messages: [{ sens: 'in', il: 3 * 1440 + 100, corps: "Hello,\n\nReçu les Trail X, elles sont parfaites. Et merci pour la réponse rapide la semaine dernière, c'est rare !\n\nThomas" }],
    brouillon: {
      confiance: 0.95,
      raisonnement: 'Message de satisfaction.',
      resume: ['Client satisfait de ses Trail X et du service.'],
      demande: 'Aucune — remerciement',
      corps: "Bonjour Thomas,\n\nMerci à vous ! Ravis que les Trail X vous plaisent. Bonnes sorties !" + SIGNATURE,
    },
  },

  /* ----------------------------------------------------------------- divers */
  {
    cle: 'divers-influence', client: 'Studio Lumière Créa', email: 'partenariats@studiolumiere-crea.test', sujet: 'Proposition de collaboration Instagram',
    intent: 'OTHER', confiance: 0.8, statut: 'NEEDS_REVIEW',
    messages: [{ sens: 'in', il: 5 * 60, corps: "Bonjour l'équipe Kairo,\n\nNous accompagnons des créateurs mode et sneakers (40 à 120 k abonnés). Seriez-vous intéressés par une campagne pour le lancement de la Street Mid ? Je peux vous envoyer notre kit média.\n\nBien à vous,\nJeanne — Studio Lumière Créa" }],
  },
];
