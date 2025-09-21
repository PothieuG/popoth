# Système de Récapitulatif Mensuel - Guide d'Utilisation

## 📋 Vue d'ensemble

Le système de récapitulatif mensuel permet de gérer automatiquement les économies et bonus financiers à chaque début de mois. Il force l'utilisateur à passer par un processus en 3 étapes obligatoires le 1er de chaque mois.

## 🎯 Fonctionnalités principales

### 1. Détection automatique
- Vérification automatique au 1er du mois
- Redirection obligatoire vers `/monthly-recap`
- Impossible de contourner ou ignorer le processus

### 2. Système de snapshot
- Sauvegarde automatique de toutes les données avant le début
- Récupération possible en cas de bug ou d'interruption
- Protection contre la perte de données

### 3. Flux en 3 étapes

#### Étape 1: Gestion du reste à vivre
- **Si positif**: Option de report au mois suivant
- **Si négatif**: Choix d'un budget estimé à amputer pour remettre à 0€

#### Étape 2: Répartition des économies
- Affichage du ratio général (excédent/déficit)
- Liste détaillée de tous les budgets avec leurs surplus/déficits
- Transferts manuels entre budgets via modal intuitive
- Répartition automatique équilibrée des excédents

#### Étape 3: Validation finale
- Récapitulatif complet de toutes les actions
- Reset automatique des revenus estimés à 0€
- Finalisation irréversible du récapitulatif mensuel

## 🔧 Installation et Configuration

### 1. Base de données
```sql
-- Exécuter le script de création des tables
\i database/monthly_recap_structure.sql
```

### 2. Structure des fichiers créés
```
├── app/
│   ├── api/monthly-recap/
│   │   ├── status/route.ts          # Vérification si récap requis
│   │   ├── initialize/route.ts      # Initialisation avec snapshot
│   │   ├── transfer/route.ts        # Transferts entre budgets
│   │   ├── auto-balance/route.ts    # Répartition automatique
│   │   ├── complete/route.ts        # Finalisation du récap
│   │   └── recover/route.ts         # Récupération depuis snapshot
│   └── monthly-recap/page.tsx       # Page principale du récap
├── components/monthly-recap/
│   ├── MonthlyRecapFlow.tsx         # Composant orchestrateur
│   ├── MonthlyRecapStep1.tsx        # Étape 1: Reste à vivre
│   ├── MonthlyRecapStep2.tsx        # Étape 2: Répartition économies
│   └── MonthlyRecapStep3.tsx        # Étape 3: Validation finale
├── hooks/
│   └── useMonthlyRecap.ts           # Hook de gestion des données
├── lib/
│   └── monthly-recap-calculations.ts # Fonctions de calcul
└── components/ui/
    └── icons.tsx                    # Icônes cohérentes
```

### 3. Middleware
Le middleware a été modifié pour vérifier automatiquement si un récap est requis sur les routes protégées.

## 📊 Tables de base de données

### `monthly_recaps`
Stocke les récapitulatifs mensuels validés
- `id`, `profile_id/group_id` (XOR)
- `recap_month`, `recap_year`
- `initial_remaining_to_live`, `final_remaining_to_live`
- `remaining_to_live_source`, `remaining_to_live_amount`
- `total_surplus`, `total_deficit`

### `recap_snapshots`
Sauvegardes de sécurité pour recovery
- `id`, `profile_id/group_id` (XOR)
- `snapshot_month`, `snapshot_year`
- `snapshot_data` (JSONB) - Toutes les données financières
- `is_active` - Statut du snapshot

### `budget_transfers`
Historique des transferts entre budgets
- `id`, `monthly_recap_id`
- `from_budget_id`, `to_budget_id`
- `transfer_amount`, `transfer_reason`

### Extensions à `estimated_budgets`
Nouvelles colonnes ajoutées:
- `monthly_surplus` - Économies du mois
- `monthly_deficit` - Déficit du mois
- `last_monthly_update` - Date du dernier récap

## 🧪 Tests et Validation

### Test 1: Vérification de détection
```javascript
// Tester l'API de statut
fetch('/api/monthly-recap/status?context=profile')
.then(res => res.json())
.then(data => console.log('Required:', data.required))
```

### Test 2: Simulation date du 1er
Pour tester, modifiez temporairement la condition dans le middleware ou l'API status:
```typescript
// Dans /api/monthly-recap/status/route.ts
const isFirstOfMonth = true // Force pour test
```

### Test 3: Test complet du flux
1. Créer des budgets estimés avec dépenses
2. Ajouter des revenus estimés
3. Simuler le 1er du mois
4. Vérifier la redirection automatique
5. Tester chaque étape du processus

### Test 4: Récupération en cas d'erreur
```javascript
// Lister les snapshots disponibles
fetch('/api/monthly-recap/recover?context=profile')
.then(res => res.json())
.then(data => console.log('Snapshots:', data.snapshots))

// Récupérer depuis un snapshot
fetch('/api/monthly-recap/recover', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    context: 'profile',
    confirm: true,
    snapshot_id: 'uuid-here' // optionnel
  })
})
```

## 🔒 Sécurité

### RLS (Row Level Security)
- Toutes les tables ont RLS activé
- Politiques strictes: utilisateurs peuvent seulement accéder à leurs données
- Séparation profile/groupe respectée

### Protection contre contournement
- Middleware force la redirection
- Impossible d'accéder aux routes protégées si récap requis
- Système de snapshot obligatoire avant modification

### Validation des données
- Contrôles stricts sur les transferts (montants, propriétaires)
- Vérification des permissions à chaque API call
- Validation côté client ET serveur

## 🎨 Design et UX

### Cohérence visuelle
- Utilise les mêmes couleurs que l'application (bleu/violet/orange)
- Composants shadcn/ui réutilisés
- Icônes cohérentes avec le système existant

### Navigation bloquée
- Impossibilité de revenir en arrière (history API)
- Avertissement en cas de fermeture de page
- Process must be completed entirely

### Feedback utilisateur
- Messages clairs à chaque étape
- Couleurs contextuelles (vert = surplus, rouge = déficit)
- Indicateurs de progression

## 🚀 Workflow d'utilisation

1. **1er du mois**: L'utilisateur se connecte normalement
2. **Redirection automatique**: Middleware détecte et redirige vers `/monthly-recap`
3. **Initialisation**: Snapshot créé automatiquement
4. **Étape 1**: L'utilisateur gère son reste à vivre
5. **Étape 2**: Répartition des économies entre budgets
6. **Étape 3**: Validation finale avec récapitulatif
7. **Finalisation**: Reset des revenus estimés, retour au dashboard

## 🔧 Maintenance

### Nettoyage des snapshots
Les snapshots peuvent s'accumuler. Prévoir un nettoyage périodique:
```sql
-- Supprimer les snapshots de plus de 6 mois
DELETE FROM recap_snapshots
WHERE created_at < NOW() - INTERVAL '6 months'
AND is_active = false;
```

### Monitoring
- Vérifier que les récaps sont bien créés chaque mois
- Surveiller les erreurs dans les logs
- S'assurer que les snapshots sont créés correctement

## 📈 Évolutions futures

### Améliorations possibles
- Notifications par email de rappel si récap non fait
- Graphiques de progression des économies
- Export des données de récapitulatif
- Récaps trimestriels ou annuels
- Suggestions d'optimisation automatique

### Intégrations
- Système de notifications push
- Dashboard analytics des tendances
- API publique pour applications tierces