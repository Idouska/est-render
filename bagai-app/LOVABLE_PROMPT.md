# Prompt Lovable - BagAI

Copie-colle ce prompt dans Lovable pour generer l'app. Tu peux l'envoyer en une seule fois ou le decouper en iterations.

---

## Prompt Initial (a coller dans Lovable)

```
Cree une application SaaS appelee "BagAI" - une plateforme de tracking et retrouvage de bagages par intelligence artificielle pour les aeroports et compagnies aeriennes.

Design : theme sombre (#0A1628 fond principal), accents cyan (#00D4FF) et bleu (#0066FF), coins arrondis, style glassmorphism avec des cartes semi-transparentes. Le logo "BagAI" a "Bag" en blanc et "AI" en cyan.

L'app a 3 interfaces principales accessibles via un systeme de roles (passager, agent, admin) :

## 1. PAGE D'ACCUEIL / LANDING PAGE
- Hero section avec titre "Retrouvez vos bagages en 30 secondes" et sous-titre "L'IA qui identifie et localise vos bagages instantanement"
- Bouton CTA "Enregistrer mon bagage" (cyan) et "Espace Agent" (outline)
- Section "Comment ca marche" avec 3 etapes en cards numerotees :
  1. "Le passager photographie" - icone camera
  2. "L'IA analyse et enregistre" - icone brain/AI
  3. "L'agent retrouve" - icone check-circle
- Section fonctionnalites : Identification instantanee, Analyse temporelle, Recommandations IA, Alerte perte
- Footer avec liens

## 2. INTERFACE PASSAGER (/passenger)
- Formulaire d'enregistrement de bagage :
  - Champs : Nom, Prenom, Numero de vol (format XX000), Compagnie aerienne (dropdown), Destination, Date de vol, Telephone (+212...)
  - Zone d'upload photo avec drag & drop + apercu de l'image
  - Bouton "Enregistrer mon bagage"
- Apres enregistrement : ecran de confirmation avec un ID de suivi unique (format BAG-XXXXXX)
- Page "Signaler une perte" (/report-loss) : formulaire avec numero de vol, description du bagage, zone de re-upload photo
- Page "Suivi" (/tracking) : entrer l'ID BAG-XXXXXX pour voir le statut (Enregistre, En recherche, Retrouve, Transfere)

## 3. INTERFACE AGENT (/agent)
- Dashboard avec stats en haut : Bagages enregistres aujourd'hui, Bagages perdus, Bagages retrouves, Taux de matching
- Zone de recherche principale : quand l'agent recoit un bagage perdu, il upload une photo
- Resultats de matching affiches en cards avec :
  - Photo du bagage enregistre vs photo du bagage trouve
  - Score de correspondance (pourcentage avec barre de progression coloree)
  - Infos passager : Nom, Vol, Destination, Date, Heure depart
  - Analyse temporelle : "Le vol a decolle il y a X heures"
  - Recommandation IA : "Transferer au comptoir [Compagnie] pour reacheminement"
  - Boutons d'action : "Confirmer le match", "Rejeter", "Contacter le passager"
- Sidebar avec :
  - Liste des alertes pertes recentes
  - Historique des matchings
  - Filtre par compagnie, par vol, par date

## 4. INTERFACE ADMIN (/admin)
- Dashboard avec graphiques :
  - Bagages enregistres par jour (line chart)
  - Taux de matching par semaine (bar chart)
  - Repartition par compagnie (pie chart)
  - Temps moyen de retrouvage
- Gestion des agents (CRUD)
- Parametres de l'app

## TECHNIQUE
- Utilise Supabase pour le backend :
  - Table `passengers` : id, first_name, last_name, phone, created_at
  - Table `flights` : id, flight_number, airline, destination, departure_date, departure_time
  - Table `luggage` : id, passenger_id, flight_id, tracking_code, photo_url, status (registered/lost/found/transferred), ai_fingerprint, created_at
  - Table `match_results` : id, lost_luggage_id, found_luggage_id, confidence_score, agent_id, status (pending/confirmed/rejected), created_at
  - Table `agents` : id, name, email, role, airport_code
  - Table `loss_reports` : id, luggage_id, reporter_type, description, created_at
- Authentification Supabase avec roles (passenger, agent, admin)
- Upload des photos dans Supabase Storage bucket "luggage-photos"
- Utilise shadcn/ui pour tous les composants
- Responsive mobile-first (les agents utilisent des smartphones)
- Toutes les pages en francais
```

---

## Prompts de suivi (iterations)

### Iteration 2 - Agent IA conversationnel
```
Ajoute un chatbot IA dans l'interface agent. Il apparait comme un widget en bas a droite, style chat bubble.

Quand l'agent trouve un bagage, il peut demander au chatbot :
- "A qui appartient ce bagage ?" -> le bot repond avec les infos du passager matche
- "Quel est le statut du vol AT560 ?" -> infos du vol
- "Recommandation pour ce bagage ?" -> recommandation contextuelle

Le chatbot a un avatar rond bleu avec "IA" ecrit dedans, un badge "En ligne" vert.
Les messages du bot sont dans des bulles sombres, ceux de l'agent dans des bulles cyan.
Affiche les infos structurees (vol, passager, recommandation) dans des cards dans le chat.
```

### Iteration 3 - Notifications et alertes
```
Ajoute un systeme de notifications :
- Icone cloche dans la navbar avec badge compteur rouge
- Panel de notifications qui slide depuis la droite
- Types de notifications :
  - "Nouveau bagage perdu signale" (rouge)
  - "Match trouve - Score 94%" (vert)
  - "Bagage transfere avec succes" (bleu)
- Toast notifications en temps reel quand un nouveau signalement arrive
- Les agents recoivent les alertes instantanement
```

### Iteration 4 - Dashboard admin avance
```
Ameliore le dashboard admin :
- Ajoute des graphiques avec recharts :
  - Line chart "Bagages enregistres" sur 30 jours
  - Bar chart "Taux de matching" par semaine
  - Pie chart "Repartition par compagnie aerienne"
  - KPI card "Temps moyen de retrouvage" avec tendance
- Table des derniers matchings avec pagination, tri, et filtres
- Export CSV des donnees
- Carte (map) montrant les aeroports actifs
```

---

## Conseils d'utilisation Lovable

1. **Commence par le prompt initial** - il genere la structure complete
2. **Connecte Supabase** via l'integration Lovable (bouton "Connect Supabase")
3. **Itere** avec les prompts de suivi un par un
4. **Teste sur mobile** - l'app doit etre 100% utilisable sur smartphone
5. **Deploie** via Lovable (1 clic) ou exporte le code vers GitHub
