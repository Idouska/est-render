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

Reste à faire avant de brancher un vrai marchand :

- [ ] `src/cron.ts` : renouvellement des watch Gmail + purge RGPD
- [ ] Migration Prisma initiale (`prisma migrate dev --name init`)
- [ ] Supervision : alerte si un watch expire ou si une file s'accumule
- [ ] Lancer la vérification OAuth Google (6 à 10 semaines de délai)

## Phase 2 — Dashboard et remboursement

- [x] API de la file de tickets, du détail, des indicateurs
- [x] API de remboursement en deux temps (aperçu + confirmation signée)
- [ ] Interface React : file, détail ticket, sidebar client/commande/livraison
- [ ] Modale de confirmation de remboursement
- [ ] Rattachement manuel d'une commande depuis le détail
- [ ] Remboursement ligne par ligne, restockage
- [ ] Plafonds de remboursement par utilisateur et par jour

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
