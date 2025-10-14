# Expense Allocation System

## Overview

The Expense Allocation System implements a priority-based allocation strategy for expenses, allowing them to be covered by multiple sources: piggy bank, budget savings, and the budget itself. This system ensures accurate budget tracking by distinguishing between money spent from savings versus money spent from the actual budget.

## Business Rules

### Allocation Priority

When an expense is created, the system allocates funds in the following priority order:

1. **Piggy Bank** (🪙) - First priority
2. **Budget Savings** (💰) - Second priority
3. **Budget Itself** - Last resort

### Core Principle

**Critical Rule**: Expenses covered by savings (piggy bank or budget savings) should **NOT** impact the budget's spent amount or percentage calculation.

### Examples

#### Example 1: Full Coverage by Piggy Bank
```
Budget: 0€ / 200€ (0%)
Piggy Bank: 1000€
New Expense: 100€

AFTER:
Piggy Bank: 1000€ → 900€
Budget: 0€ / 200€ (0%) ← UNCHANGED
```

#### Example 2: Partial Coverage by Piggy Bank
```
Budget: 0€ / 200€ (0%)
Piggy Bank: 100€
New Expense: 200€

AFTER:
Piggy Bank: 100€ → 0€
Budget: 0€ / 200€ → 100€ / 200€ (50%)
```

#### Example 3: Multi-Source Allocation
```
Budget: 100€ / 200€ (50%)
Piggy Bank: 50€
Budget Savings: 25€
New Expense: 100€

AFTER:
Piggy Bank: 50€ → 0€ (covers 50€)
Budget Savings: 25€ → 0€ (covers 25€)
Budget: 100€ / 200€ → 125€ / 200€ (62.5%) (covers remaining 25€)
```

## Database Schema

### New Fields in `real_expenses` Table

```sql
ALTER TABLE public.real_expenses
ADD COLUMN IF NOT EXISTS amount_from_piggy_bank numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS amount_from_budget_savings numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS amount_from_budget numeric DEFAULT 0;
```

### Field Descriptions

- **`amount`**: Total expense amount (for display purposes)
- **`amount_from_piggy_bank`**: Portion covered by piggy bank
- **`amount_from_budget_savings`**: Portion covered by budget savings
- **`amount_from_budget`**: Portion covered by the budget itself (this is what counts toward budget percentage)

### Backward Compatibility

For expenses created before this system:
- All breakdown fields default to `0`
- Calculations fall back to using `amount` field if `amount_from_budget` is `NULL`

## Implementation

### API Endpoint: `/api/finances/expenses/add-with-logic`

**Location**: [app/api/finances/expenses/add-with-logic/route.ts](../app/api/finances/expenses/add-with-logic/route.ts)

This endpoint implements the allocation logic:

1. **Fetch Current Balances**
   - Piggy bank balance
   - Budget savings balance
   - Budget estimated amount

2. **Calculate Allocation**
   ```typescript
   let remaining = amount
   let fromPiggyBank = 0
   let fromBudgetSavings = 0
   let fromBudget = 0

   // Priority 1: Piggy Bank
   if (piggyBalance > 0) {
     fromPiggyBank = Math.min(piggyBalance, remaining)
     remaining -= fromPiggyBank
   }

   // Priority 2: Budget Savings
   if (remaining > 0 && budgetSavings > 0) {
     fromBudgetSavings = Math.min(budgetSavings, remaining)
     remaining -= fromBudgetSavings
   }

   // Priority 3: Budget Itself
   if (remaining > 0) {
     fromBudget = remaining
   }
   ```

3. **Create Expense with Breakdown**
   ```typescript
   const insertData = {
     amount: amount, // Full amount
     amount_from_piggy_bank: fromPiggyBank,
     amount_from_budget_savings: fromBudgetSavings,
     amount_from_budget: fromBudget,
     // ... other fields
   }
   ```

4. **Update Balances**
   - Deduct from piggy bank if used
   - Deduct from budget savings if used
   - Budget itself is automatically reflected in calculations

### Calculation Pattern (All Endpoints)

**Critical**: All budget percentage calculations MUST use `amount_from_budget` instead of `amount`.

```typescript
// ✅ CORRECT
const { data: expenses } = await supabaseServer
  .from('real_expenses')
  .select('amount, amount_from_piggy_bank, amount_from_budget_savings, amount_from_budget')
  .eq('estimated_budget_id', budget.id)
  // ... date filters ...

const spentAmount = expenses?.reduce((sum, expense) => {
  const amountFromBudget = expense.amount_from_budget !== null && expense.amount_from_budget !== undefined
    ? parseFloat(expense.amount_from_budget.toString())
    : parseFloat(expense.amount.toString()) // Fallback for old expenses
  return sum + (isNaN(amountFromBudget) ? 0 : amountFromBudget)
}, 0) || 0

// ❌ INCORRECT (DO NOT USE)
const spentAmount = expenses?.reduce((sum, expense) => sum + expense.amount, 0)
```

### Updated Files

All files that calculate budget spent amounts were updated:

1. **[app/api/finances/budgets/estimated/route.ts](../app/api/finances/budgets/estimated/route.ts)** (Lines 92-105, 258-270, 306-318)
   - Main endpoint that provides `spent_this_month` to frontend
   - **Most critical** as it feeds the `useBudgetProgress` hook

2. **[app/api/finances/dashboard/route.ts](../app/api/finances/dashboard/route.ts)** (Lines 257-270)
   - Dashboard budget calculations

3. **[app/api/finances/expenses/progress/route.ts](../app/api/finances/expenses/progress/route.ts)** (Lines 39-44, 71-77, 83-91)
   - Progress tracking calculations

4. **[hooks/useBudgetProgress.ts](../hooks/useBudgetProgress.ts)** (Lines 100-108)
   - Frontend hook for budget progress
   - Prefers `budget.spent_this_month` from API when available

5. **[components/dashboard/AddTransactionModal.tsx](../components/dashboard/AddTransactionModal.tsx)** (Lines 61-70)
   - Real-time calculation in expense creation modal

6. **[lib/financial-calculations.ts](../lib/financial-calculations.ts)** (Lines 687-705)
   - Shared calculation utilities

## UI Components

### Expense Breakdown Preview

**Component**: [components/dashboard/ExpenseBreakdownPreview.tsx](../components/dashboard/ExpenseBreakdownPreview.tsx)

Shows users how their expense will be allocated BEFORE creation:

```
┌─────────────────────────────────────┐
│ Répartition de la dépense          │
├─────────────────────────────────────┤
│ 🪙 Tirelire        50,00 €         │
│ 💰 Économies       25,00 €         │
│ 📊 Budget          25,00 €         │
├─────────────────────────────────────┤
│ Total             100,00 €         │
└─────────────────────────────────────┘
```

### Transaction Display

**Component**: [components/dashboard/TransactionListItem.tsx](../components/dashboard/TransactionListItem.tsx) (Lines 184-198)

Visual badges show the breakdown in the transaction list:

- **Purple badge** 🪙: Amount from piggy bank
- **Green badge** 💰: Amount from savings
- **Default display**: Total amount with breakdown indicators

## Critical Bug Fix (December 2024)

### Issue Description

When adding an expense covered by savings, the budget percentage showed incorrect values:
- **Expected**: 0€ / 75€ (0%) - since expense was fully covered by piggy bank
- **Actual**: 400€ / 75€ (533%) - system was counting total expense amount

### Root Cause

The `/api/finances/budgets/estimated` endpoint was calculating `spent_this_month` using `expense.amount` (total) instead of `expense.amount_from_budget` (only the portion from budget).

Since the `useBudgetProgress` hook prefers `budget.spent_this_month` from the API over recalculation, this incorrect value propagated throughout the UI.

### Investigation Process

1. **Initial Fix Attempts**: Corrected multiple calculation endpoints
2. **Persistent Issue**: User reported problem continued ("TOUJOURS PAS")
3. **SQL Verification**: Confirmed database had correct values (`amount_from_budget = 0`)
4. **API Testing**: Console tests revealed `/api/finances/budgets/estimated` returned `spent_this_month: 400` instead of `0`
5. **Final Fix**: Corrected three calculation points in the estimated budgets endpoint

### Files Fixed in Priority Order

1. **Database Migration**: [database/migrations/add_expense_breakdown_fields.sql](../database/migrations/add_expense_breakdown_fields.sql)
2. **Complete Fix Script**: [database/migrations/COMPLETE_FIX_EXPENSES.sql](../database/migrations/COMPLETE_FIX_EXPENSES.sql)
3. **New Allocation API**: [app/api/finances/expenses/add-with-logic/route.ts](../app/api/finances/expenses/add-with-logic/route.ts)
4. **Critical Fix**: [app/api/finances/budgets/estimated/route.ts](../app/api/finances/budgets/estimated/route.ts)
5. **Supporting Endpoints**: Dashboard, progress, and other calculation files
6. **Frontend Components**: Modal, hooks, and transaction display

## Testing

### Verification Steps

1. **Create expense with full piggy bank coverage**
   - Budget percentage should remain unchanged
   - Piggy bank balance should decrease
   - Transaction should show purple badge

2. **Create expense with partial coverage**
   - Budget should increase only by uncovered amount
   - Multiple badges should appear on transaction

3. **Check budget percentage calculations**
   - All budget displays should use `amount_from_budget`
   - No regression to using `amount` field

### SQL Verification Query

```sql
SELECT
  id,
  amount,
  amount_from_piggy_bank,
  amount_from_budget_savings,
  amount_from_budget,
  estimated_budget_id,
  description
FROM real_expenses
WHERE estimated_budget_id = 'your-budget-id'
ORDER BY created_at DESC;
```

## Migration Guide

### For Existing Expenses

Run the migration script to add default values:

```sql
UPDATE public.real_expenses
SET
  amount_from_piggy_bank = COALESCE(amount_from_piggy_bank, 0),
  amount_from_budget_savings = COALESCE(amount_from_budget_savings, 0),
  amount_from_budget = COALESCE(amount_from_budget, amount)
WHERE amount_from_budget IS NULL;
```

### For New Features

When adding any new budget calculation:

1. **Always SELECT** breakdown fields: `amount_from_piggy_bank, amount_from_budget_savings, amount_from_budget`
2. **Use `amount_from_budget`** for calculations, not `amount`
3. **Add fallback** to `amount` for backward compatibility
4. **Test** with expenses that have savings coverage

## Best Practices

### ✅ DO

- Use `amount_from_budget` for all budget percentage calculations
- Provide fallback to `amount` for NULL values
- Display full `amount` for transaction display
- Show breakdown badges for transparency
- Test with various allocation scenarios

### ❌ DON'T

- Use `amount` field for budget calculations
- Assume all expenses have breakdown fields populated
- Skip SELECT of breakdown fields in queries
- Remove backward compatibility checks
- Auto-run migrations without backup

## Future Enhancements

Potential improvements to consider:

1. **Manual Allocation**: Allow users to manually choose allocation source
2. **Allocation History**: Show historical allocation patterns
3. **Budget Savings Replenishment**: Auto-add to savings when under budget
4. **Allocation Rules**: Custom rules per budget category
5. **Reporting**: Analytics on savings usage vs budget usage

---

**Last Updated**: 2025-10-14
**Related Documentation**:
- [Financial Rules](./FINANCIAL_RULES.md)
- [Financial Planning System](./FINANCIAL_PLANNING_SYSTEM.md)
- [Database Documentation](../database/DATABASE_DOCUMENTATION.md)
