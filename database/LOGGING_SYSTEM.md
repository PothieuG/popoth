# 📝 Système de Logs - Gestion Financière

## 🎯 Vue d'Ensemble

Le système de logs est conçu pour tracer toutes les opérations critiques, débogage et monitoring de performance du système de gestion financière.

## 📊 Structure des Logs

### Niveaux de Log
```typescript
enum LogLevel {
  DEBUG = 'debug',     // Informations détaillées pour développement
  INFO = 'info',       // Opérations normales
  WARN = 'warn',       // Situations anormales mais non critiques
  ERROR = 'error',     // Erreurs nécessitant attention
  CRITICAL = 'critical' // Erreurs critiques système
}
```

### Format Standard
```typescript
interface LogEntry {
  timestamp: string          // ISO 8601 format
  level: LogLevel           // Niveau de criticité
  component: string         // API route, hook, component
  operation: string         // Action en cours
  userId?: string          // UUID utilisateur (si applicable)
  groupId?: string         // UUID groupe (si applicable)
  duration?: number        // Temps d'exécution (ms)
  data?: any              // Données contextuelles
  error?: {
    message: string
    stack?: string
    code?: string
  }
}
```

## 🔄 Logs API Routes

### Structure par Route

#### `/api/finances/dashboard`
```typescript
// Début d'opération
console.log('🔍 GET /api/finances/dashboard - Début', {
  timestamp: new Date().toISOString(),
  level: 'info',
  component: '/api/finances/dashboard',
  operation: 'fetch_dashboard',
  userId: session.userId,
  forGroup: showGroupData
})

// Validation session
console.log('📋 Session validation', {
  timestamp: new Date().toISOString(),
  level: 'debug',
  component: '/api/finances/dashboard',
  operation: 'validate_session',
  userId: session?.userId,
  isValid: !!session?.userId
})

// Calculs financiers
console.log('🧮 Calculs financiers en cours', {
  timestamp: new Date().toISOString(),
  level: 'info',
  component: '/api/finances/dashboard',
  operation: 'financial_calculations',
  userId: session.userId,
  snapshot: !!snapshot,
  estimatedIncomes: estimatedIncomes?.length || 0,
  estimatedBudgets: estimatedBudgets?.length || 0
})

// Réponse Supabase
console.log('📊 Réponse Supabase', {
  timestamp: new Date().toISOString(),
  level: 'debug',
  component: '/api/finances/dashboard',
  operation: 'supabase_query',
  table: 'financial_snapshots',
  data: !!data,
  error: error?.message,
  duration: Date.now() - startTime
})

// Succès
console.log('✅ Dashboard chargé avec succès', {
  timestamp: new Date().toISOString(),
  level: 'info',
  component: '/api/finances/dashboard',
  operation: 'fetch_dashboard_success',
  userId: session.userId,
  availableCash: dashboardData.available_cash,
  remainingToLive: dashboardData.remaining_to_live,
  totalSavings: dashboardData.total_savings,
  duration: Date.now() - startTime
})

// Erreur
console.error('❌ Erreur lors du chargement dashboard', {
  timestamp: new Date().toISOString(),
  level: 'error',
  component: '/api/finances/dashboard',
  operation: 'fetch_dashboard_error',
  userId: session?.userId,
  error: {
    message: error.message,
    stack: error.stack,
    code: error.code
  },
  duration: Date.now() - startTime
})
```

#### `/api/finances/income/estimated`
```typescript
// CRUD Operations Logging
const logContext = {
  component: '/api/finances/income/estimated',
  userId: session.userId,
  forGroup: is_for_group
}

// CREATE
console.log('➕ Création revenu estimé', {
  ...logContext,
  operation: 'create_estimated_income',
  data: { name, estimated_amount, is_monthly_recurring }
})

// READ
console.log('📖 Récupération revenus estimés', {
  ...logContext,
  operation: 'fetch_estimated_incomes',
  count: data?.length || 0
})

// UPDATE  
console.log('✏️ Modification revenu estimé', {
  ...logContext,
  operation: 'update_estimated_income',
  incomeId: id,
  changes: Object.keys(updates)
})

// DELETE
console.log('🗑️ Suppression revenu estimé', {
  ...logContext,
  operation: 'delete_estimated_income',
  incomeId: id
})
```

#### `/api/finances/income/real`
```typescript
// Real Income Entries Logging
console.log('💰 Ajout entrée réelle d\'argent', {
  component: '/api/finances/income/real',
  operation: 'create_real_income',
  userId: session.userId,
  amount: amount,
  isExceptional: !estimated_income_id,
  estimatedIncomeId: estimated_income_id,
  entryDate: entry_date
})

console.log('🔍 Validation revenu estimé lié', {
  component: '/api/finances/income/real',
  operation: 'validate_estimated_income',
  estimatedIncomeId: estimated_income_id,
  isValid: !!estimatedIncome,
  ownership: estimatedIncome?.profile_id === session.userId || 
             estimatedIncome?.group_id === profile?.group_id
})
```

#### `/api/finances/budgets/estimated`
```typescript
// Budget Management Logging
console.log('🎯 Gestion budget estimé', {
  component: '/api/finances/budgets/estimated',
  operation: 'budget_operation',
  userId: session.userId,
  budgetId: id,
  budgetName: name,
  estimatedAmount: estimated_amount,
  currentSavings: current_savings
})

console.log('💡 Calcul économies budget', {
  component: '/api/finances/budgets/estimated',
  operation: 'calculate_budget_savings',
  budgetId: id,
  estimatedAmount: estimated_amount,
  spentThisMonth: spentThisMonth,
  newSavings: Math.max(0, estimated_amount - spentThisMonth)
})
```

#### `/api/finances/expenses/real`
```typescript
// Expense Tracking Logging
console.log('💳 Enregistrement dépense réelle', {
  component: '/api/finances/expenses/real',
  operation: 'create_real_expense',
  userId: session.userId,
  amount: amount,
  isExceptional: !estimated_budget_id,
  budgetId: estimated_budget_id,
  expenseDate: expense_date
})

console.log('🎯 Impact sur budget', {
  component: '/api/finances/expenses/real',
  operation: 'budget_impact',
  budgetId: estimated_budget_id,
  budgetName: estimatedBudget?.name,
  previousSavings: estimatedBudget?.current_savings,
  expenseAmount: amount
})
```

## 🗄️ Logs Base de Données

### Triggers et Fonctions
```sql
-- Log des calculs automatiques
CREATE OR REPLACE FUNCTION log_financial_calculation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE NOTICE '🧮 Calcul financier déclenché: table=%, operation=%, user_id=%', 
    TG_TABLE_NAME, TG_OP, COALESCE(NEW.profile_id, OLD.profile_id, NEW.group_id, OLD.group_id);
  
  -- Log détaillé pour debugging
  IF TG_TABLE_NAME = 'real_income_entries' THEN
    RAISE NOTICE '💰 Entrée revenu: montant=%, date=%, exceptional=%', 
      COALESCE(NEW.amount, OLD.amount), 
      COALESCE(NEW.entry_date, OLD.entry_date),
      COALESCE(NEW.is_exceptional, OLD.is_exceptional);
  END IF;

  IF TG_TABLE_NAME = 'real_expenses' THEN
    RAISE NOTICE '💳 Dépense: montant=%, date=%, budget_id=%, exceptional=%', 
      COALESCE(NEW.amount, OLD.amount),
      COALESCE(NEW.expense_date, OLD.expense_date),
      COALESCE(NEW.estimated_budget_id, OLD.estimated_budget_id),
      COALESCE(NEW.is_exceptional, OLD.is_exceptional);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
```

### Performance Monitoring
```sql
-- Log des requêtes lentes
CREATE OR REPLACE FUNCTION log_slow_query()
RETURNS TRIGGER AS $$
DECLARE
  duration_ms INTEGER;
BEGIN
  duration_ms := extract(epoch from (clock_timestamp() - statement_timestamp())) * 1000;
  
  IF duration_ms > 1000 THEN -- Plus de 1 seconde
    RAISE WARNING '🐌 Requête lente détectée: durée=%ms, table=%, operation=%',
      duration_ms, TG_TABLE_NAME, TG_OP;
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
```

## 🔧 Logs Hooks React

### useFinancial Hook
```typescript
const useFinancial = () => {
  const handleError = useCallback((error: any, operation: string) => {
    console.error(`❌ Erreur ${operation}`, {
      timestamp: new Date().toISOString(),
      level: 'error',
      component: 'useFinancial',
      operation: operation,
      userId: session?.userId,
      error: {
        message: error?.message || 'Erreur inconnue',
        stack: error?.stack,
        details: error
      }
    })
  }, [])

  const fetchDashboard = useCallback(async () => {
    const startTime = Date.now()
    
    console.log('🔍 Chargement dashboard financier', {
      timestamp: new Date().toISOString(),
      level: 'info',
      component: 'useFinancial',
      operation: 'fetch_dashboard',
      showGroupData
    })

    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch(`/api/finances/dashboard?group=${showGroupData}`)
      
      console.log('📡 Réponse API dashboard', {
        timestamp: new Date().toISOString(),
        level: 'debug',
        component: 'useFinancial', 
        operation: 'api_response',
        status: response.status,
        ok: response.ok,
        duration: Date.now() - startTime
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Erreur API')
      }

      const data = await response.json()
      setDashboard(data.dashboard)

      console.log('✅ Dashboard chargé avec succès', {
        timestamp: new Date().toISOString(),
        level: 'info',
        component: 'useFinancial',
        operation: 'fetch_dashboard_success',
        availableCash: data.dashboard.available_cash,
        remainingToLive: data.dashboard.remaining_to_live,
        duration: Date.now() - startTime
      })

    } catch (error) {
      handleError(error, 'fetch_dashboard')
    } finally {
      setIsLoading(false)
    }
  }, [showGroupData, handleError])
}
```

## 🚨 Gestion d'Erreurs Critiques

### Catégories d'Erreurs
```typescript
// Erreurs de validation
console.error('🚫 Validation échouée', {
  level: 'error',
  component: 'api_route',
  operation: 'validation_error',
  field: 'estimated_amount',
  value: estimated_amount,
  constraint: 'must_be_positive',
  userId: session.userId
})

// Erreurs Supabase
console.error('🗄️ Erreur base de données', {
  level: 'error',
  component: 'supabase',
  operation: 'database_error',
  table: 'estimated_incomes',
  query: 'INSERT',
  error: {
    message: error.message,
    code: error.code,
    details: error.details
  }
})

// Erreurs d'autorisation
console.error('🔒 Accès non autorisé', {
  level: 'error',
  component: 'auth',
  operation: 'unauthorized_access',
  userId: session?.userId,
  resource: 'estimated_budget',
  resourceId: budget_id,
  reason: 'not_group_member'
})

// Erreurs de calcul
console.error('🧮 Erreur de calcul financier', {
  level: 'error',
  component: 'financial_calculation',
  operation: 'calculation_error',
  calculation: 'remaining_to_live',
  input_data: {
    totalIncome: total_income,
    totalBudgets: total_budgets,
    exceptionalExpenses: exceptional_expenses,
    totalSavings: total_savings
  },
  error: error.message
})
```

## 📈 Métriques de Performance

### Monitoring Dashboard
```typescript
// Temps de réponse API
console.log('⏱️ Performance API', {
  level: 'info',
  component: 'performance',
  operation: 'api_timing',
  endpoint: '/api/finances/dashboard',
  method: 'GET',
  duration: responseTime,
  status: 'slow' | 'normal' | 'fast'
})

// Utilisation mémoire
console.log('💾 Utilisation ressources', {
  level: 'debug',
  component: 'performance',
  operation: 'resource_usage',
  memoryUsage: process.memoryUsage(),
  activeConnections: connectionCount
})

// Requêtes base de données
console.log('🗄️ Statistiques requêtes', {
  level: 'info',
  component: 'database',
  operation: 'query_stats',
  slowQueries: slowQueryCount,
  totalQueries: totalQueryCount,
  avgResponseTime: averageResponseTime
})
```

## 🔍 Debugging Avancé

### Trace Complète Transaction
```typescript
// Début transaction financière
const transactionId = uuid()
console.log('🔄 Début transaction financière', {
  level: 'debug',
  component: 'transaction',
  operation: 'start_financial_transaction',
  transactionId: transactionId,
  type: 'expense_creation',
  userId: session.userId
})

// Étapes de la transaction
console.log('📝 Validation données', {
  transactionId,
  step: 1,
  validation: 'amount_positive',
  result: 'success'
})

console.log('🔍 Vérification budget', {
  transactionId,
  step: 2,
  budgetId: estimated_budget_id,
  budgetExists: !!budget,
  userHasAccess: hasAccess
})

console.log('💾 Insertion base de données', {
  transactionId,
  step: 3,
  table: 'real_expenses',
  insertId: newExpense.id
})

console.log('🧮 Recalcul économies', {
  transactionId,
  step: 4,
  budgetId: budget.id,
  previousSavings: previousSavings,
  newSavings: newSavings
})

console.log('✅ Transaction terminée', {
  transactionId,
  step: 5,
  status: 'success',
  duration: Date.now() - startTime
})
```

## 📊 Logs d'Audit

### Traçabilité des Modifications
```typescript
// Modification de données sensibles
console.log('📝 Audit trail', {
  level: 'info',
  component: 'audit',
  operation: 'data_modification',
  userId: session.userId,
  resource: 'estimated_budget',
  resourceId: budget.id,
  changes: {
    estimated_amount: {
      from: oldValue,
      to: newValue
    }
  },
  ipAddress: request.ip,
  userAgent: request.headers['user-agent']
})

// Accès aux données
console.log('👁️ Accès données', {
  level: 'info',
  component: 'audit',
  operation: 'data_access',
  userId: session.userId,
  resource: 'financial_dashboard',
  dataScope: showGroupData ? 'group' : 'personal',
  timestamp: new Date().toISOString()
})
```

---

## 🎯 Recommandations

### Production
1. **Niveau de log**: INFO et plus en production
2. **Rotation**: Logs quotidiens avec rétention 30 jours
3. **Monitoring**: Alertes sur erreurs critiques
4. **Performance**: Logs asynchrones pour éviter impact

### Développement  
1. **Niveau de log**: DEBUG pour traçage complet
2. **Format**: Lisible avec couleurs et emojis
3. **Détail**: Stack traces complètes
4. **Temps réel**: Affichage console pour debugging immédiat