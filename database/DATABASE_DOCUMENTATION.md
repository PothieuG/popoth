# 📊 Documentation de la Base de Données - Système de Gestion Financière

## 🗄️ Vue d'Ensemble

La base de données implémente un système de gestion financière pour utilisateurs individuels et groupes, avec calculs automatiques des indicateurs financiers selon le battleplan.txt.

### Architecture Générale
- **PostgreSQL** avec Supabase
- **UUID** comme identifiants primaires
- **Row Level Security (RLS)** pour la sécurité
- **Triggers automatiques** pour les calculs en temps réel
- **Relations complexes** entre profils, groupes et données financières

## 📋 Tables Principales

### 1. `profiles` (Profils Utilisateurs)
**But**: Extension des utilisateurs auth.users avec données personnelles et lien groupe

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, FK → auth.users(id) | Identifiant utilisateur unique |
| `first_name` | text | NOT NULL | Prénom utilisateur |
| `last_name` | text | NOT NULL | Nom utilisateur |
| `group_id` | uuid | FK → groups(id) | Groupe d'appartenance (nullable) |
| `salary` | numeric | DEFAULT 0 | Salaire mensuel en euros |
| `created_at` | timestamptz | DEFAULT now() | Date de création |
| `updated_at` | timestamptz | DEFAULT now() | Date de modification |

**Relations**:
- 1:1 avec `auth.users` (extension du profil)
- N:1 avec `groups` (un utilisateur = un groupe max)
- 1:N avec toutes les tables financières via `profile_id`

### 2. `groups` (Groupes)
**But**: Entités collectives pour gestion financière partagée

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK | Identifiant unique du groupe |
| `name` | text | NOT NULL, UNIQUE | Nom du groupe |
| `monthly_budget_estimate` | numeric | NOT NULL | Budget mensuel estimé |
| `creator_id` | uuid | NOT NULL, FK → auth.users(id) | Créateur du groupe |
| `created_at` | timestamptz | DEFAULT now() | Date de création |
| `updated_at` | timestamptz | DEFAULT now() | Date de modification |

**Relations**:
- 1:N avec `profiles` (un groupe = plusieurs membres)
- 1:N avec toutes les tables financières via `group_id`

### 3. `estimated_incomes` (Revenus Estimés)
**But**: Sources de revenus prévisionnels (salaire, freelance, etc.)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK | Identifiant unique |
| `profile_id` | uuid | FK → profiles(id) | Propriétaire individuel |
| `group_id` | uuid | FK → groups(id) | Propriétaire groupe |
| `name` | text | NOT NULL | Nom de la source (ex: "Salaire") |
| `estimated_amount` | numeric | NOT NULL, ≥ 0 | Montant estimé |
| `is_monthly_recurring` | boolean | NOT NULL, DEFAULT true | Récurrent mensuel ? |
| `created_at` | timestamptz | DEFAULT now() | Date de création |
| `updated_at` | timestamptz | DEFAULT now() | Date de modification |

**⚠️ Contrainte manquante**: Exclusion mutuelle `profile_id` XOR `group_id`

### 4. `real_income_entries` (Entrées Réelles d'Argent)
**But**: Revenus effectivement reçus, liés ou non aux estimations

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK | Identifiant unique |
| `profile_id` | uuid | FK → profiles(id) | Propriétaire individuel |
| `group_id` | uuid | FK → groups(id) | Propriétaire groupe |
| `estimated_income_id` | uuid | FK → estimated_incomes(id) | Lien vers source estimée |
| `amount` | numeric | NOT NULL, > 0 | Montant reçu |
| `description` | text | NOT NULL | Description de l'entrée |
| `entry_date` | date | NOT NULL, DEFAULT CURRENT_DATE | Date de réception |
| `is_exceptional` | boolean | NOT NULL, DEFAULT false | Entrée exceptionnelle ? |
| `created_at` | timestamptz | DEFAULT now() | Date de création |

**Logique Métier**:
- `is_exceptional = true` ⟺ `estimated_income_id IS NULL`
- Calcul automatique du "cash disponible"

### 5. `estimated_budgets` (Budgets Estimés)
**But**: Catégories de dépenses planifiées avec suivi des économies

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK | Identifiant unique |
| `profile_id` | uuid | FK → profiles(id) | Propriétaire individuel |
| `group_id` | uuid | FK → groups(id) | Propriétaire groupe |
| `name` | text | NOT NULL | Nom du budget (ex: "Courses") |
| `estimated_amount` | numeric | NOT NULL, ≥ 0 | Montant budgété |
| `current_savings` | numeric | NOT NULL, DEFAULT 0, ≥ 0 | Économies actuelles |
| `is_monthly_recurring` | boolean | NOT NULL, DEFAULT true | Récurrent mensuel ? |
| `created_at` | timestamptz | DEFAULT now() | Date de création |
| `updated_at` | timestamptz | DEFAULT now() | Date de modification |

**Calcul Économies**:
```sql
current_savings = MAX(0, estimated_amount - dépenses_du_mois)
```

### 6. `real_expenses` (Dépenses Réelles)
**But**: Dépenses effectuées, liées aux budgets ou exceptionnelles

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK | Identifiant unique |
| `profile_id` | uuid | FK → profiles(id) | Propriétaire individuel |
| `group_id` | uuid | FK → groups(id) | Propriétaire groupe |
| `estimated_budget_id` | uuid | FK → estimated_budgets(id) | Lien vers budget |
| `amount` | numeric | NOT NULL, > 0 | Montant dépensé |
| `description` | text | NOT NULL | Description de la dépense |
| `expense_date` | date | NOT NULL, DEFAULT CURRENT_DATE | Date de dépense |
| `is_exceptional` | boolean | NOT NULL, DEFAULT false | Dépense exceptionnelle ? |
| `created_at` | timestamptz | DEFAULT now() | Date de création |

**Logique Métier**:
- `is_exceptional = true` ⟺ `estimated_budget_id IS NULL`
- Déclenche recalcul des économies de budget
- Impact sur "cash disponible" et "reste à vivre"

### 7. `financial_snapshots` (Cache de Calculs)
**But**: Stockage des indicateurs financiers calculés pour optimiser les performances

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK | Identifiant unique |
| `profile_id` | uuid | FK → profiles(id) | Propriétaire individuel |
| `group_id` | uuid | FK → groups(id) | Propriétaire groupe |
| `available_cash` | numeric | NOT NULL, DEFAULT 0 | Cash disponible calculé |
| `remaining_to_live` | numeric | NOT NULL, DEFAULT 0 | Reste à vivre calculé |
| `total_estimated_income` | numeric | NOT NULL, DEFAULT 0 | Total revenus estimés |
| `total_real_income` | numeric | NOT NULL, DEFAULT 0 | Total revenus réels |
| `total_estimated_budgets` | numeric | NOT NULL, DEFAULT 0 | Total budgets estimés |
| `total_real_expenses` | numeric | NOT NULL, DEFAULT 0 | Total dépenses réelles |
| `total_budget_savings` | numeric | NOT NULL, DEFAULT 0 | Total économies |
| `calculation_date` | timestamptz | DEFAULT now() | Date du calcul |
| `is_current` | boolean | NOT NULL, DEFAULT true | Snapshot actuel ? |

**Contraintes manquantes**: 
- Un seul `is_current = true` par propriétaire
- Exclusion mutuelle `profile_id` XOR `group_id`

### 8. `group_contributions` (Contributions de Groupe)
**But**: Calculs de contributions proportionnelles aux salaires

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK | Identifiant unique |
| `profile_id` | uuid | NOT NULL, FK → profiles(id) | Membre du groupe |
| `group_id` | uuid | NOT NULL, FK → groups(id) | Groupe concerné |
| `salary` | numeric | NOT NULL, ≥ 0 | Salaire au moment du calcul |
| `contribution_amount` | numeric | NOT NULL, ≥ 0 | Montant de contribution |
| `contribution_percentage` | numeric | NOT NULL, ≥ 0 | Pourcentage du salaire |
| `calculated_at` | timestamptz | DEFAULT now() | Date du calcul |

## 🔗 Relations et Intégrité

### Hiérarchie des Données
```
auth.users (Supabase Auth)
    ↓ 1:1
profiles (Extension utilisateur)
    ↓ N:1
groups (Entités collectives)
    ↓ 1:N
[estimated_incomes, estimated_budgets, real_income_entries, real_expenses, financial_snapshots]
```

### Contraintes d'Intégrité Critiques
1. **Exclusion mutuelle**: Chaque enregistrement financier appartient SOIT à un profil SOIT à un groupe
2. **Cohérence temporelle**: Les dates de création doivent être cohérentes
3. **Montants positifs**: Tous les montants financiers ≥ 0 (sauf calculs qui peuvent être négatifs)
4. **Unicité**: Un seul snapshot `is_current = true` par propriétaire

## 📊 Calculs Métier (selon battleplan.txt)

### Cash Disponible
```sql
available_cash = SUM(real_income_entries.amount) - SUM(real_expenses.amount)
```

### Reste à Vivre

**Pour Profils**:
```sql
remaining_to_live = total_real_income 
                  - total_estimated_budgets 
                  - exceptional_expenses 
                  + total_budget_savings
```

**Pour Groupes**:
```sql
remaining_to_live = (contributions + exceptional_income) 
                  - total_estimated_budgets 
                  - exceptional_expenses 
                  + total_budget_savings
```

### Économies de Budget
```sql
-- Calculé mensuellement pour chaque budget
current_savings = MAX(0, estimated_amount - spent_this_month)

-- Avec spent_this_month = SUM(real_expenses) WHERE estimated_budget_id = budget.id 
--                         AND EXTRACT(YEAR FROM expense_date) = CURRENT_YEAR
--                         AND EXTRACT(MONTH FROM expense_date) = CURRENT_MONTH
```

## ⚡ Optimisations Nécessaires

### Index Manquants
```sql
-- Performance sur les requêtes fréquentes
CREATE INDEX idx_profiles_group_id ON profiles(group_id);
CREATE INDEX idx_real_income_entries_profile_id ON real_income_entries(profile_id);
CREATE INDEX idx_real_income_entries_group_id ON real_income_entries(group_id);
CREATE INDEX idx_real_expenses_profile_id ON real_expenses(profile_id);
CREATE INDEX idx_real_expenses_group_id ON real_expenses(group_id);
CREATE INDEX idx_estimated_budgets_profile_id ON estimated_budgets(profile_id);
CREATE INDEX idx_estimated_budgets_group_id ON estimated_budgets(group_id);

-- Performance sur les calculs mensuels
CREATE INDEX idx_real_expenses_date ON real_expenses(expense_date);
CREATE INDEX idx_real_income_entries_date ON real_income_entries(entry_date);

-- Contrainte d'unicité snapshot courant
CREATE UNIQUE INDEX idx_financial_snapshots_current_profile 
ON financial_snapshots(profile_id) WHERE is_current = true AND profile_id IS NOT NULL;

CREATE UNIQUE INDEX idx_financial_snapshots_current_group 
ON financial_snapshots(group_id) WHERE is_current = true AND group_id IS NOT NULL;
```

### Triggers Automatiques Requis
1. **calculate_available_cash()** - Sur INSERT/UPDATE/DELETE de real_income_entries, real_expenses
2. **update_budget_savings()** - Sur INSERT/UPDATE/DELETE de real_expenses liées à un budget
3. **calculate_remaining_to_live()** - Sur modification des données impactant le calcul
4. **update_financial_snapshots()** - Mise à jour du cache après calculs

## 🛡️ Sécurité (RLS - Row Level Security)

### Politiques Manquantes
Chaque table financière doit avoir des politiques RLS pour :
- **Accès personnel**: `profile_id = auth.uid()`
- **Accès groupe**: `group_id IN (SELECT group_id FROM profiles WHERE id = auth.uid())`

## 📈 Métriques et Monitoring

### Requêtes Critiques à Surveiller
1. Calcul des snapshots financiers (performance)
2. Requêtes de dashboard (fréquence élevée)
3. Calculs mensuels des économies (complexité)
4. Jointures multi-tables pour les rapports

### Points de Monitoring
- **Temps de réponse** des calculs automatiques
- **Taille des tables** (croissance des transactions)
- **Index usage** et optimisation des requêtes
- **Conflits de concurrence** sur les snapshots

---

## 🔧 Actions Prioritaires

1. **Ajouter contraintes d'exclusion mutuelle**
2. **Créer les index de performance** 
3. **Implémenter les triggers de calcul**
4. **Configurer les politiques RLS**
5. **Tester l'intégrité des calculs**