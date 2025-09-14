# Système de Planification Financière

## Vue d'ensemble

Le système de planification financière permet aux utilisateurs de gérer leurs revenus estimés et budgets mensuels avec une interface drawer moderne et des calculs automatiques en temps réel.

## Architecture

### 🎨 Interface Utilisateur

**PlanningDrawer** - Drawer principal pleine page
- **Localisation**: `components/dashboard/PlanningDrawer.tsx`
- **Déclenchement**: Bouton dans `FinancialIndicators` 
- **Animation**: Slide du bas vers le haut (300ms ease-out)
- **Layout**: Deux tabs (Budgets orange / Revenus verts)

**Dialogs modaux**:
- `AddBudgetDialog` - Création de budgets avec validation de balance
- `AddIncomeDialog` - Création de revenus avec calcul de totaux

### 🔧 Hooks de Gestion des Données

**useBudgets** (`hooks/useBudgets.ts`)
```typescript
interface UseBudgetsReturn {
  budgets: EstimatedBudget[]
  loading: boolean
  error: string | null
  addBudget: (budgetData) => Promise<boolean>
  deleteBudget: (budgetId: string) => Promise<boolean>
  refreshBudgets: () => Promise<void>
  totalBudgets: number
}
```

**useIncomes** (`hooks/useIncomes.ts`)
```typescript
interface UseIncomesReturn {
  incomes: EstimatedIncome[]
  loading: boolean
  error: string | null
  addIncome: (incomeData) => Promise<boolean>
  deleteIncome: (incomeId: string) => Promise<boolean>
  refreshIncomes: () => Promise<void>
  totalIncomes: number
}
```

### 📡 API Routes

**POST /api/budgets**
- Validation des données (nom ≥ 2 chars, montant > 0)
- Support budgets personnels ET de groupe
- Vérification des balances (budget ≤ revenus totaux)

**GET /api/budgets**
- Récupération budgets personnels + groupe (si applicable)
- Requête Supabase OR avec conditions multiples
- Tri par date de création décroissante

**POST /api/incomes**
- Validation simplifiée (pas de contraintes de balance)
- Support revenus personnels ET de groupe

**GET /api/incomes**
- Récupération revenus personnels + groupe
- Même pattern que budgets

### 🗄️ Base de Données

**Table: estimated_budgets**
```sql
CREATE TABLE estimated_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID, -- XOR avec group_id
  group_id UUID,   -- XOR avec profile_id
  name TEXT NOT NULL,
  estimated_amount NUMERIC NOT NULL CHECK (estimated_amount >= 0),
  current_savings NUMERIC DEFAULT 0 CHECK (current_savings >= 0),
  is_monthly_recurring BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT estimated_budgets_owner_exclusive_check CHECK (
    (profile_id IS NOT NULL AND group_id IS NULL) OR 
    (profile_id IS NULL AND group_id IS NOT NULL)
  )
);
```

**Table: estimated_incomes**
```sql
CREATE TABLE estimated_incomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID, -- XOR avec group_id
  group_id UUID,   -- XOR avec profile_id
  name TEXT NOT NULL,
  estimated_amount NUMERIC NOT NULL CHECK (estimated_amount >= 0),
  is_monthly_recurring BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT estimated_incomes_owner_exclusive_check CHECK (
    (profile_id IS NOT NULL AND group_id IS NULL) OR 
    (profile_id IS NULL AND group_id IS NOT NULL)
  )
);
```

## Fonctionnalités

### 💰 Gestion des Revenus

**Création de revenus**:
1. Clic sur "Ajouter un revenu" (header ou empty state)
2. Modal avec formulaire: nom + montant
3. Calcul automatique: revenus actuels + nouveau = total
4. Sauvegarde en BDD avec refresh automatique

**Affichage**:
- Total discret en haut de l'onglet
- Liste des revenus avec boutons suppression
- Balance finale dans footer du drawer

### 📊 Gestion des Budgets

**Création de budgets avec validation**:
1. Clic sur "Ajouter un budget"
2. Modal avec validation de balance en temps réel
3. Calcul: revenus totaux - (budgets actuels + nouveau budget)
4. Blocage si balance négative avec message explicatif

**Validation intelligente**:
- Empêche les budgets > revenus totaux
- Messages d'erreur contextuels
- Suggestions d'action (augmenter revenus, réduire budget)

### 🎯 Calculs Automatiques

**Balance Résultante**: `revenus_totaux - budgets_totaux`
- **Vert**: Balance positive
- **Rouge**: Balance négative  
- **Gris**: Balance nulle

**Mise à jour temps réel**:
- Totaux recalculés à chaque ajout/suppression
- Couleurs dynamiques selon la balance
- Refresh automatique à l'ouverture du drawer

## États et Gestion d'Erreurs

### Loading States
- Spinners pendant les requêtes API
- États conditionnels pour éviter les empty states pendant le chargement

### Error Handling
- Messages d'erreur spécifiques par context
- Logs détaillés côté client ET serveur
- Gestion des erreurs réseau et de validation

### Data Flow
```
User Action → Dialog → PlanningDrawer → Hook → API → Database → Hook → PlanningDrawer → UI Update
```

## Configuration

### Variables d'environnement requises
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
JWT_SECRET_KEY=your_jwt_secret
```

### Dépendances
- `@supabase/supabase-js` - Client Supabase
- `jose` - Validation JWT
- `react` + hooks personnalisés
- `tailwindcss` - Styling

## Sécurité

### Authentification
- Validation JWT sur toutes les routes API
- Sessions utilisateur avec cookies HTTP-Only
- Validation côté serveur ET client

### Autorisation
- Contrainte XOR: données personnelles OU de groupe
- RLS Supabase pour l'accès aux données
- Validation du propriétaire avant modification/suppression

### Validation des Données
- Contrôles serveur obligatoires
- Types TypeScript stricts
- Contraintes PostgreSQL au niveau base

## Performance

### Optimisations
- `useCallback` pour éviter les re-renders
- Requêtes optimisées avec index PostgreSQL
- Mise à jour d'état locale immédiate (optimistic UI)

### Monitoring
- Logs détaillés pour debug
- Mesure des performances avec console.time
- Tracking des erreurs avec context

## Tests et Debug

### Logs de Debug
Activés en développement avec préfixes:
- 🔄 Actions utilisateur
- 📤📥 Requêtes API  
- ✅❌ Succès/Erreurs
- 🔐 Authentification
- 💾 Base de données

### Points de Debug Courants
1. Session expirée → logs d'authentification
2. Données non affichées → logs de requête Supabase
3. Validation échouée → logs de validation côté serveur
4. Balance incorrecte → logs de calcul dans les hooks