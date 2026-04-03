# BagAI - Architecture Technique

## Stack Technique (Lovable)

```
Frontend : React 18 + TypeScript + Vite
UI       : shadcn/ui + Tailwind CSS
Backend  : Supabase (PostgreSQL + Auth + Storage + Realtime)
Deploy   : Lovable hosting (1 clic) ou Netlify/Vercel
```

## Structure des pages

```
/                     Landing page publique
/auth                 Login / Register (Supabase Auth)
/passenger            Dashboard passager
/passenger/register   Enregistrer un bagage (photo + infos vol)
/passenger/track      Suivi d'un bagage (par tracking code)
/passenger/report     Signaler une perte
/agent                Dashboard agent
/agent/search         Recherche / matching de bagage
/agent/alerts         Alertes pertes en cours
/agent/history        Historique des matchings
/admin                Dashboard admin (stats + graphiques)
/admin/agents         Gestion des agents
/admin/settings       Parametres
```

## Flow Principal

```
PASSAGER                          SYSTEME                         AGENT
   |                                 |                              |
   |-- Upload photo bagage --------->|                              |
   |                                 |-- Stocke photo (Storage)     |
   |                                 |-- Genere fingerprint IA      |
   |                                 |-- Cree entry luggage         |
   |<-- Tracking code BAG-XXXXXX ---|                              |
   |                                 |                              |
   |-- Signale perte --------------->|                              |
   |                                 |-- Cree loss_report           |
   |                                 |-- Notifie agents ----------->|
   |                                 |                              |
   |                                 |              Upload photo ---|
   |                                 |<-- bagage trouve ------------|
   |                                 |                              |
   |                                 |-- Compare fingerprints       |
   |                                 |-- Calcule score matching     |
   |                                 |-- Genere recommandation      |
   |                                 |                              |
   |                                 |-- Resultats matching ------->|
   |                                 |                              |
   |                                 |           Confirme match ----|
   |<-- Notification "retrouve" -----|                              |
   |                                 |-- Met a jour statut          |
```

## Design System

### Couleurs
```
--bg-primary:    #0A1628    (fond principal)
--bg-card:       #0F2035    (fond cards)
--bg-card-hover: #152A45    (hover cards)
--accent-cyan:   #00D4FF    (CTA, highlights)
--accent-blue:   #0066FF    (liens, secondaire)
--accent-green:  #00E676    (succes, en ligne)
--accent-red:    #FF4444    (erreurs, alertes)
--accent-orange: #FFA726    (warnings)
--accent-yellow: #FFD600    (badges)
--text-primary:  #FFFFFF    (texte principal)
--text-secondary:#8899AA    (texte secondaire)
--border:        #1A3550    (bordures)
```

### Composants cles
- **Cards** : fond semi-transparent, border 1px subtle, border-radius 12px
- **Boutons CTA** : gradient cyan->bleu, hover glow
- **Badges de statut** : pill-shaped, couleur selon statut
- **Score matching** : barre de progression + pourcentage colore
  - 90-100% : vert
  - 70-89% : cyan
  - 50-69% : orange
  - <50% : rouge

## Integration IA (Phase 2)

Pour le matching visuel, 2 options :

### Option A - API Vision externe
```
Passager upload photo
  -> Supabase Storage
  -> Edge Function appelle OpenAI Vision / Claude Vision
  -> Genere un embedding/description structuree
  -> Stocke dans ai_fingerprint (JSONB)

Agent upload photo bagage trouve
  -> Meme process
  -> Compare embeddings avec cosine similarity
  -> Retourne top matches avec scores
```

### Option B - Matching simplifie (MVP)
```
Matching base sur :
- Couleur dominante (extraction via canvas)
- Type de bagage (valise rigide, souple, sac)
- Taille approximative
- Marque (si visible)
- Vol + date (correlation temporelle)

Score = weighted sum de ces criteres
```

## Supabase Realtime

Utilise les subscriptions Supabase pour les notifications temps reel :

```typescript
// Dans l'interface agent
supabase
  .channel('loss-reports')
  .on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'loss_reports' },
    (payload) => {
      showToast('Nouveau bagage perdu signale !', 'alert');
    }
  )
  .subscribe();
```

## Securite

- **Auth** : Supabase Auth avec magic link ou email/password
- **RLS** : Row Level Security sur toutes les tables
- **Storage** : Policies sur le bucket luggage-photos
- **RGPD** : 
  - Consentement explicite a l'enregistrement
  - Droit de suppression des donnees
  - Retention limitee (90 jours par defaut)
  - Pas de partage avec des tiers
