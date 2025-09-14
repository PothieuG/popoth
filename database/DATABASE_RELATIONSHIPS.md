# 🏗️ Diagramme des Relations - Base de Données Financière

## 📊 Schema Visuel des Relations

```
                                    auth.users (Supabase Auth)
                                         |
                                         | 1:1 (id)
                                         ▼
                    ┌─────────────────────────────────────┐
                    │            PROFILES                 │
                    │  • id (PK) ← auth.users(id)        │
                    │  • first_name, last_name            │
                    │  • group_id → groups(id)            │
                    │  • salary                           │
                    └─────────────────────────────────────┘
                                         |
                                         | N:1 (group_id)
                                         ▼
                    ┌─────────────────────────────────────┐
                    │             GROUPS                  │
                    │  • id (PK)                         │
                    │  • name (UNIQUE)                   │
                    │  • monthly_budget_estimate         │
                    │  • creator_id → auth.users(id)     │
                    └─────────────────────────────────────┘
                                         |
                          ┌──────────────┼──────────────┐
                          ▼              ▼              ▼
        ┌─────────────────────┐ ┌──────────────────┐ ┌──────────────────┐
        │ ESTIMATED_INCOMES   │ │ ESTIMATED_BUDGETS│ │ FINANCIAL_       │
        │ • profile_id XOR    │ │ • profile_id XOR │ │ SNAPSHOTS        │
        │ • group_id          │ │ • group_id       │ │ • profile_id XOR │
        │ • name              │ │ • name           │ │ • group_id       │
        │ • estimated_amount  │ │ • estimated_amt  │ │ • [all_totals]   │
        │ • is_monthly_recurr │ │ • current_savings│ │ • is_current     │
        └─────────────────────┘ └──────────────────┘ └──────────────────┘
                  |                       |
                  | 1:N (estimated_income_id)  | 1:N (estimated_budget_id)
                  ▼                       ▼
        ┌─────────────────────┐ ┌──────────────────┐
        │ REAL_INCOME_        │ │ REAL_EXPENSES    │
        │ ENTRIES             │ │ • profile_id XOR │
        │ • profile_id XOR    │ │ • group_id       │
        │ • group_id          │ │ • estimated_     │
        │ • estimated_income_ │ │   budget_id      │
        │   id (nullable)     │ │ • amount         │
        │ • amount            │ │ • description    │
        │ • description       │ │ • expense_date   │
        │ • entry_date        │ │ • is_exceptional │
        │ • is_exceptional    │ └──────────────────┘
        └─────────────────────┘
                  |
                  | Contribution calculation
                  ▼
        ┌─────────────────────┐
        │ GROUP_CONTRIBUTIONS │
        │ • profile_id (FK)   │
        │ • group_id (FK)     │
        │ • salary            │
        │ • contribution_amt  │
        │ • contribution_%    │
        └─────────────────────┘
```

## 🔗 Types de Relations

### Relations Principales

#### 1. **auth.users → profiles** (1:1)
- **Type**: Extension obligatoire
- **Clé**: `profiles.id = auth.users.id`
- **Contrainte**: `ON DELETE CASCADE` (si user supprimé, profil supprimé)
- **Usage**: Données personnelles étendues

#### 2. **profiles → groups** (N:1)
- **Type**: Appartenance optionnelle
- **Clé**: `profiles.group_id → groups.id`
- **Contrainte**: `nullable` (un utilisateur peut ne pas avoir de groupe)
- **Règle Métier**: Un utilisateur = maximum 1 groupe

#### 3. **groups → auth.users** (N:1)
- **Type**: Création/propriété
- **Clé**: `groups.creator_id → auth.users.id`
- **Contrainte**: `NOT NULL` (tout groupe a un créateur)
- **Privilège**: Le créateur peut supprimer le groupe

### Relations Financières

#### 4. **Propriété Exclusive (XOR Pattern)**
Toutes les entités financières suivent le pattern :
```sql
-- Soit appartient à un profil, soit à un groupe, jamais les deux
profile_id IS NOT NULL XOR group_id IS NOT NULL
```

Tables concernées :
- `estimated_incomes`
- `real_income_entries`  
- `estimated_budgets`
- `real_expenses`
- `financial_snapshots`

#### 5. **Liaisons Optionnelles**
- **`real_income_entries.estimated_income_id`** (nullable)
  - `NULL` = entrée exceptionnelle
  - `NOT NULL` = lié à un revenu estimé

- **`real_expenses.estimated_budget_id`** (nullable)
  - `NULL` = dépense exceptionnelle  
  - `NOT NULL` = lié à un budget

## 📊 Contraintes d'Intégrité

### Contraintes de Domaine
```sql
-- Montants toujours positifs pour les transactions réelles
amount > 0 (real_income_entries, real_expenses)

-- Montants estimés et économies ≥ 0
estimated_amount ≥ 0 (estimated_incomes, estimated_budgets)
current_savings ≥ 0 (estimated_budgets)

-- Noms obligatoires
name NOT NULL (estimated_incomes, estimated_budgets, groups)
```

### Contraintes Référentielles
```sql
-- Suppression en cascade pour données personnelles
profiles.id → ON DELETE CASCADE (toutes tables financières)
groups.id → ON DELETE CASCADE (toutes tables financières)

-- Nullification pour liaisons optionnelles
estimated_income_id → ON DELETE SET NULL
estimated_budget_id → ON DELETE SET NULL
```

### Contraintes Métier
```sql
-- Un seul snapshot "current" par propriétaire
UNIQUE(profile_id) WHERE is_current = true AND profile_id IS NOT NULL
UNIQUE(group_id) WHERE is_current = true AND group_id IS NOT NULL

-- Cohérence des flags exceptionnels
is_exceptional = true ⟺ foreign_key IS NULL
```

## 🔄 Flux de Données

### Calcul du Cash Disponible
```
real_income_entries ──┐
                     ├─→ SUM() ─→ available_cash
real_expenses ────────┘
```

### Calcul du Reste à Vivre

#### Pour Profils
```
real_income_entries ────────┐
                           ├─→ CALCUL ─→ remaining_to_live
estimated_budgets ──────────┤
                           │
real_expenses (exceptional) ─┤
                           │
current_savings ────────────┘
```

#### Pour Groupes
```
real_income_entries (group) ─┐
                            ├─→ CALCUL ─→ remaining_to_live  
group_contributions ─────────┤
                            │
estimated_budgets (group) ───┤
                            │
real_expenses (exceptional) ─┤
                            │
current_savings (group) ─────┘
```

### Calcul des Économies de Budget
```
estimated_budgets.estimated_amount ──┐
                                    ├─→ MAX(0, diff) ─→ current_savings
real_expenses[current_month] ────────┘
```

## 🎯 Index de Performance

### Index Principaux
```sql
-- Recherche par propriétaire (le plus fréquent)
idx_*_profile_id ON (profile_id)
idx_*_group_id ON (group_id)

-- Calculs temporels
idx_real_expenses_date ON (expense_date)
idx_real_income_entries_date ON (entry_date)

-- Jointures fréquentes
idx_real_income_entries_estimated_id ON (estimated_income_id)
idx_real_expenses_budget_id ON (estimated_budget_id)

-- Contraintes d'unicité
idx_financial_snapshots_current_profile ON (profile_id) WHERE is_current = true
idx_financial_snapshots_current_group ON (group_id) WHERE is_current = true
```

### Requêtes Optimisées
```sql
-- Dashboard personnel (utilise idx_*_profile_id)
SELECT * FROM financial_snapshots WHERE profile_id = $1 AND is_current = true

-- Calculs mensuels (utilise idx_real_expenses_date + idx_real_expenses_budget_id)
SELECT SUM(amount) FROM real_expenses 
WHERE estimated_budget_id = $1 
  AND expense_date >= '2025-09-01' 
  AND expense_date < '2025-10-01'

-- Données de groupe (utilise idx_*_group_id)
SELECT * FROM estimated_budgets WHERE group_id = $1
```

## 🛡️ Sécurité (RLS)

### Politiques par Table
```sql
-- Accès personnel : utilisateur voit ses propres données
profile_id = auth.uid()

-- Accès groupe : utilisateur voit les données de son groupe
group_id IN (SELECT group_id FROM profiles WHERE id = auth.uid())
```

### Matrice d'Accès
| Table | Personnel | Groupe | Admin |
|-------|-----------|--------|-------|
| `profiles` | ✅ Own | ❌ | ✅ |
| `groups` | ✅ Member | ✅ Member | ✅ |
| `estimated_*` | ✅ Own | ✅ Group | ✅ |
| `real_*` | ✅ Own | ✅ Group | ✅ |
| `financial_snapshots` | 👁️ Own | 👁️ Group | ✅ |

**Légende**: ✅ = CRUD complet, 👁️ = Lecture seule, ❌ = Pas d'accès

## ⚡ Triggers et Automatisations

### Triggers de Calcul
```
INSERT/UPDATE/DELETE real_income_entries → calculate_available_cash()
INSERT/UPDATE/DELETE real_expenses → calculate_available_cash()
                                  └→ update_budget_savings()

INSERT/UPDATE/DELETE estimated_budgets → calculate_remaining_to_live()
INSERT/UPDATE/DELETE real_income_entries → calculate_remaining_to_live()  
INSERT/UPDATE/DELETE real_expenses → calculate_remaining_to_live()
```

### Triggers de Maintenance
```
UPDATE estimated_incomes → update_updated_at_column()
UPDATE estimated_budgets → update_updated_at_column()
UPDATE profiles → update_updated_at_column()
UPDATE groups → update_updated_at_column()
```

## 📈 Évolutivité

### Ajouts Futurs Possibles
1. **Objectifs financiers** (table `financial_goals`)
2. **Catégories personnalisées** (table `budget_categories`)
3. **Historique des modifications** (table `audit_log`)
4. **Alertes et notifications** (table `financial_alerts`)
5. **Synchronisation bancaire** (table `bank_accounts`, `bank_transactions`)

### Points d'Extension
- **Propriétaire flexible** : Le pattern XOR permet d'ajouter d'autres types de propriétaires
- **Métadonnées** : Colonnes `jsonb` pour données variables
- **Périodes comptables** : Ajout de `period_start/end` pour comptabilité multi-périodes
- **Multi-devises** : Ajout de `currency` et tables de change

---

## 🔧 Commandes Utiles

### Vérification de l'Intégrité
```sql
-- Lancer la vérification
SELECT * FROM verify_financial_integrity();

-- Vérifier les contraintes manuellement
SELECT 'Exclusion mutuelle violations' as check_type, count(*) as violations
FROM estimated_incomes 
WHERE (profile_id IS NULL AND group_id IS NULL) 
   OR (profile_id IS NOT NULL AND group_id IS NOT NULL);
```

### Monitoring des Performances
```sql
-- Index usage
SELECT schemaname, tablename, indexname, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes 
WHERE schemaname = 'public' 
ORDER BY idx_tup_read DESC;

-- Tables les plus utilisées
SELECT schemaname, relname, seq_tup_read, idx_tup_fetch, n_tup_ins, n_tup_upd, n_tup_del
FROM pg_stat_user_tables 
WHERE schemaname = 'public'
ORDER BY seq_tup_read + idx_tup_fetch DESC;
```