# Roadmap

## Phase 1 — WISMO en brouillon

**Objectif** : un marchand pilote branche sa boutique et sa boîte, reçoit des
brouillons pertinents, mesure combien il en envoie sans modification.

Livré dans ce dépôt :

- [x] OAuth Shopify (state + HMAC vérifiés), OAuth Google (refresh token forcé)
- [x] Ingestion Pub/Sub avec JWT vérifié, repli polling, idempotence
- [x] Classification en 7 intentions, sortie structurée
- [x] Rattachement mail ↔ commande, 3 stratégies + chemins de secours
- [x] Génération de réponse ancrée sur les données Shopify
- [x] Création de brouillon Gmail, jamais d'envoi automatique
- [x] Schéma multi-tenant, tokens chiffrés, journal d'audit

- [x] `src/cron.ts` : renouvellement des watch Gmail + purge RGPD
- [x] Migration Prisma initiale
- [x] Déploiement : Dockerfile, `render.yaml`, guide pas à pas
      ([08-mise-en-ligne.md](08-mise-en-ligne.md))
- [x] Fournisseur d'IA interchangeable (Anthropic ou DeepSeek) derrière une
      abstraction commune, bascule par variable d'environnement
      ([09-fournisseur-ia.md](09-fournisseur-ia.md))
- [x] Modèles de politique de confidentialité et CGU (`/privacy`, `/terms`),
      exigés tels quels par l'écran de consentement Google et la fiche
      Shopify Partners — **à faire relire par un juriste avant usage réel**

Reste à faire avant de brancher un vrai marchand :

- [ ] Supervision : alerte si un watch expire, si le cron échoue, ou si une
      file s'accumule. Le cron corrige, mais rien ne prévient quand il tombe.
- [ ] Lancer la vérification OAuth Google (6 à 10 semaines de délai)

## Phase 2 — Dashboard et remboursement

- [x] API de la file de tickets, du détail, des indicateurs
- [x] API de remboursement en deux temps (aperçu + confirmation signée)
- [x] Dashboard : file, détail ticket, sidebar client/commande/livraison,
      édition et envoi de brouillon, journal d'audit
- [x] Modale de confirmation de remboursement
- [x] Rattachement manuel d'une commande depuis le détail
- [x] Mode démonstration (`SHOPIFY_MOCK` / `GMAIL_MOCK`) pour développer
      l'interface sans boutique ni boîte connectée
- [ ] Régénérer un brouillon après rattachement manuel d'une commande — sans
      ça, la réponse continue de demander une précision déjà obtenue
- [ ] Remboursement ligne par ligne, restockage
- [ ] Plafonds de remboursement par utilisateur et par jour
- [ ] Pagination de la file au-delà de 25 tickets (le curseur existe côté API,
      le dashboard ne l'utilise pas encore)

## Phase 3 — Multi-tenant réel

- [ ] Onboarding self-serve depuis l'App Store Shopify
- [ ] Facturation via Shopify Billing API
- [ ] Vérification OAuth Google obtenue → sortie du mode test
- [ ] Webhooks `shop/redact` / `customers/redact` (obligation Shopify)
- [ ] Activation progressive de l'auto-send, seuil réglable par marchand
- [ ] Multi-utilisateurs par marchand (rôles déjà en base)

## Post-MVP

- [ ] RAG sur les réponses passées du marchand (embeddings + base vectorielle),
      injecté dans `GenerationContext` — le pipeline est déjà prêt à le recevoir
- [ ] Priorisation de la file par urgence (`urgency` déjà collecté)
- [ ] Métriques de qualité : taux d'envoi sans modification, distance
      d'édition entre le brouillon et l'envoi réel

## Décisions à trancher avec les pilotes

1. **Seuil d'auto-send.** À fixer sur données réelles, pas a priori. Le signal
   à mesurer : part des brouillons envoyés sans aucune modification.
2. **Ton par défaut.** Le prompt actuel vouvoie et reste bref. Certains
   marchands voudront tutoyer. Prévoir un champ de personnalisation avant que
   le RAG ne rende le point secondaire.
3. **Restockage automatique** sur remboursement de retour : dépend de la
   logistique de chacun, pas de bon défaut universel.
