# Test de l'affichage du carryover dans le dashboard

## 🎯 Problème résolu

Le problème était que l'API `/api/finances/dashboard` ne prenait pas en compte le carryover lors du calcul de `spent_this_month`.

## 📋 Modifications apportées

### 1. Ajout des colonnes carryover dans la requête SELECT

**Avant :**
```typescript
.select('id, name, estimated_amount, is_monthly_recurring')
```

**Après :**
```typescript
.select('id, name, estimated_amount, is_monthly_recurring, monthly_surplus, carryover_spent_amount, carryover_applied_date')
```

### 2. Calcul du carryover dans spent_this_month

**Avant :**
```typescript
const spentThisMonth = expenses?.reduce((sum, expense) => sum + expense.amount, 0) || 0
```

**Après :**
```typescript
const realExpensesThisMonth = expenses?.reduce((sum, expense) => sum + expense.amount, 0) || 0

// Utiliser carryover_spent_amount si disponible, sinon fallback sur monthly_surplus négatif
let carryoverSpent = 0
if (budget.carryover_spent_amount !== undefined) {
  // Nouveau système de carryover
  carryoverSpent = budget.carryover_spent_amount || 0
} else if (budget.monthly_surplus && budget.monthly_surplus < 0) {
  // Ancien système de fallback
  carryoverSpent = Math.abs(budget.monthly_surplus)
}

// Total dépensé = dépenses réelles + carryover du mois précédent
const spentThisMonth = realExpensesThisMonth + carryoverSpent
```

### 3. Interface TypeScript mise à jour

```typescript
estimated_budgets: Array<{
  id: string
  name: string
  estimated_amount: number
  spent_this_month: number // Maintenant inclut le carryover
  is_monthly_recurring: boolean
  monthly_surplus?: number
  carryover_spent_amount?: number
  carryover_applied_date?: string
}>
```

## ✅ Résultat attendu

Après avoir exécuté le script SQL et redémarré l'application :

1. **Budget avec déficit reporté** : Un budget de 200€ avec un déficit de 50€ reporté
2. **Affichage dans le dashboard** : "50€/200€" même sans nouvelles dépenses ce mois
3. **Calcul progressif** : Nouvelles dépenses s'ajoutent aux 50€ de carryover

## 🧪 Test manuel

1. Créer un budget "Test Carryover" à 200€
2. Ajouter une dépense de 250€ sur ce budget
3. Faire un monthly recap complet
4. Le mois suivant, vérifier que le dashboard affiche "50€/200€"

## 📊 APIs mises à jour pour le carryover

- ✅ `/api/monthly-recap/complete` - Logique de report
- ✅ `/api/finances/budgets/estimated` - Calcul avec carryover
- ✅ `/api/finances/dashboard` - **Corrigé maintenant**
- ✅ `/api/monthly-recap/initialize` - Support carryover
- ✅ `lib/financial-calculations.ts` - Calculs intégrés

Toutes les APIs sont maintenant cohérentes et utilisent la même logique de carryover.