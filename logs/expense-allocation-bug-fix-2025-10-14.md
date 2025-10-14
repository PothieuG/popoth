# Session Log: Expense Allocation Bug Fix

**Date**: 2025-10-14
**Type**: Critical Bug Fix
**Focus**: Budget percentage calculation with savings allocation

## Issue Summary

### Problem Reported

When adding an expense covered by savings (piggy bank or budget savings), the budget percentage showed incorrect values:
- **Expected**: 0€ / 75€ (0%) when expense fully covered by piggy bank
- **Actual**: 400€ / 75€ (533%)

The system was counting the total expense amount toward the budget instead of only the portion actually taken from the budget.

### User's Business Rule

**Priority-based allocation**:
1. Deplete piggy bank first
2. Deplete budget savings second
3. Use budget itself last

**Critical requirement**: Expenses covered by savings should NOT impact the budget's spent amount or percentage.

## Root Cause Analysis

### Initial Investigation

Multiple calculation endpoints were corrected initially:
- [components/dashboard/AddTransactionModal.tsx](../components/dashboard/AddTransactionModal.tsx)
- [app/api/finances/expenses/progress/route.ts](../app/api/finances/expenses/progress/route.ts)
- [lib/financial-calculations.ts](../lib/financial-calculations.ts)
- [hooks/useBudgetProgress.ts](../hooks/useBudgetProgress.ts)

**Result**: Issue persisted despite these fixes.

### Deep Dive

1. **SQL Verification**: Database confirmed correct values
   ```sql
   SELECT amount, amount_from_budget FROM real_expenses WHERE id = 'xxx'
   -- Result: amount = 200, amount_from_budget = 0 ✅
   ```

2. **API Testing**: Console tests revealed the source
   ```javascript
   fetch('/api/finances/budgets/estimated').then(r => r.json())
   // Transport Public: spent_this_month: 400 ❌ (should be 0)
   ```

3. **Data Flow Analysis**:
   - `/api/finances/budgets/estimated` returns `spent_this_month`
   - `useBudgetProgress` hook prefers this value over recalculation
   - All UI components use this pre-calculated value

### The Smoking Gun

**File**: [app/api/finances/budgets/estimated/route.ts](../app/api/finances/budgets/estimated/route.ts)

Three locations calculating `spent_this_month` incorrectly:
- **Lines 92-105**: GET endpoint main calculation
- **Lines 258-270**: PUT endpoint (updating estimated_amount)
- **Lines 306-318**: PUT endpoint response

All were using `expense.amount` instead of `expense.amount_from_budget`.

## Solution Implementation

### Database Schema Enhancement

Added breakdown tracking to `real_expenses` table:

```sql
ALTER TABLE public.real_expenses
ADD COLUMN IF NOT EXISTS amount_from_piggy_bank numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS amount_from_budget_savings numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS amount_from_budget numeric DEFAULT 0;
```

**Backward compatibility**: Existing expenses updated with migration script.

### New API Endpoint

**Created**: `/api/finances/expenses/add-with-logic`

Implements priority-based allocation:
1. Calculate available balances (piggy bank, budget savings)
2. Allocate expense using priority order
3. Create expense with full breakdown
4. Update balances accordingly

### Calculation Pattern (Standard)

**All budget calculation endpoints now use**:

```typescript
const { data: expenses } = await supabaseServer
  .from('real_expenses')
  .select('amount, amount_from_piggy_bank, amount_from_budget_savings, amount_from_budget')
  .eq('estimated_budget_id', budget.id)
  .gte('expense_date', firstDayOfMonth)
  .lte('expense_date', lastDayOfMonth)

const spentThisMonth = expenses?.reduce((sum, expense) => {
  // Use amount_from_budget for calculation, fallback to amount for old expenses
  const amountFromBudget = expense.amount_from_budget !== null && expense.amount_from_budget !== undefined
    ? parseFloat(expense.amount_from_budget.toString())
    : parseFloat(expense.amount.toString())
  return sum + (isNaN(amountFromBudget) ? 0 : amountFromBudget)
}, 0) || 0
```

### Files Modified

#### Critical Fix (Main Issue)
- **[app/api/finances/budgets/estimated/route.ts](../app/api/finances/budgets/estimated/route.ts)**
  - Lines 92-105, 258-270, 306-318
  - Fixed `spent_this_month` calculation in all three locations

#### Supporting Fixes
- **[app/api/finances/dashboard/route.ts](../app/api/finances/dashboard/route.ts)** (Lines 257-270)
- **[app/api/finances/expenses/progress/route.ts](../app/api/finances/expenses/progress/route.ts)** (Lines 39-44, 71-77, 83-91)
- **[hooks/useBudgetProgress.ts](../hooks/useBudgetProgress.ts)** (Lines 100-108)
- **[components/dashboard/AddTransactionModal.tsx](../components/dashboard/AddTransactionModal.tsx)** (Lines 61-70)
- **[lib/financial-calculations.ts](../lib/financial-calculations.ts)** (Lines 687-705)

#### New Components
- **[components/dashboard/ExpenseBreakdownPreview.tsx](../components/dashboard/ExpenseBreakdownPreview.tsx)** - Preview allocation before creation
- **[components/dashboard/TransactionListItem.tsx](../components/dashboard/TransactionListItem.tsx)** (Lines 184-198) - Visual badges for breakdown

#### New Files
- **[app/api/finances/expenses/add-with-logic/route.ts](../app/api/finances/expenses/add-with-logic/route.ts)** - Allocation logic implementation
- **[database/migrations/add_expense_breakdown_fields.sql](../database/migrations/add_expense_breakdown_fields.sql)** - Schema changes
- **[database/migrations/COMPLETE_FIX_EXPENSES.sql](../database/migrations/COMPLETE_FIX_EXPENSES.sql)** - Data migration

## User Interaction Timeline

1. **Initial Report**: "Budget shows 533% when expense covered by piggy bank"
2. **First Fix Attempt**: Updated several calculation files
3. **User**: "TOUJOURS PAS" (Still not working)
4. **Second Fix Attempt**: Updated more endpoints
5. **User**: "Nope, toujours pas !" (Still no)
6. **User Clarification**: Provided detailed business rule with examples
7. **SQL Investigation**: Confirmed database values correct
8. **User**: Console logs not appearing
9. **API Testing**: Found `/api/finances/budgets/estimated` returning wrong values
10. **Final Fix**: Corrected the three calculation points in estimated budgets API
11. **User**: "Parfait, documente cette sessions." (Perfect, document this session)

## Testing Verification

### Test Scenario 1: Full Piggy Bank Coverage
```
Initial State:
- Budget: 0€ / 75€ (0%)
- Piggy Bank: 1000€
- New Expense: 200€ on Transport Public

Expected Result:
- Piggy Bank: 800€
- Budget: 0€ / 75€ (0%) ← UNCHANGED
- Database: amount_from_piggy_bank = 200, amount_from_budget = 0

Verification:
✅ SQL query shows correct breakdown
✅ API returns spent_this_month = 0
✅ UI shows 0%
```

### Test Scenario 2: Multi-Source Allocation
```
Initial State:
- Budget: 100€ / 200€ (50%)
- Piggy Bank: 50€
- Budget Savings: 25€
- New Expense: 100€

Expected Result:
- Piggy Bank: 0€ (covers 50€)
- Budget Savings: 0€ (covers 25€)
- Budget: 125€ / 200€ (62.5%) (covers remaining 25€)

Verification:
✅ Breakdown correctly distributed
✅ Budget increased by only 25€
✅ Visual badges show all three sources
```

## Key Learnings

### 1. Data Flow Understanding Critical
The `useBudgetProgress` hook prefers API-provided `spent_this_month` over recalculation. Fixing the calculation logic in the hook was insufficient—the source API had to be corrected.

### 2. Pre-calculated Values Hide Issues
When APIs return pre-calculated aggregates, frontend fixes may not take effect. Always verify the entire data pipeline.

### 3. Systematic Debugging Approach
- Start with database verification (SQL queries)
- Test API responses (console fetch)
- Trace data flow (API → Hook → Component)
- Identify the authoritative source

### 4. Backward Compatibility Essential
Never assume all data has new fields populated. Always provide fallbacks:
```typescript
const value = newField !== null && newField !== undefined ? newField : oldField
```

### 5. User Persistence Pays Off
The user repeatedly reported "still not working" which forced deeper investigation beyond initial obvious fixes. This led to finding the true root cause.

## Documentation Created

- **[docs/EXPENSE_ALLOCATION_SYSTEM.md](../docs/EXPENSE_ALLOCATION_SYSTEM.md)** - Comprehensive system documentation
  - Business rules and examples
  - Database schema
  - Implementation details
  - Bug fix documentation
  - Testing guide
  - Migration instructions
  - Best practices

## Related Documentation

- [Financial Rules](../docs/FINANCIAL_RULES.md) - Business logic
- [Financial Planning System](../docs/FINANCIAL_PLANNING_SYSTEM.md) - Overall architecture
- [Database Documentation](../database/DATABASE_DOCUMENTATION.md) - Schema details

## Post-Fix Checklist

- [x] Database migration created and tested
- [x] All calculation endpoints updated
- [x] Frontend hooks corrected
- [x] UI components show breakdown
- [x] Preview component implemented
- [x] Backward compatibility maintained
- [x] Documentation created
- [x] Test scenarios verified

## Next Steps (For User)

1. **Refresh the page** completely
2. **Verify** Transport Public budget shows 0% instead of 533%
3. **Test** creating new expenses with various allocation scenarios
4. **Check** transaction list shows breakdown badges correctly

---

**Status**: ✅ RESOLVED
**Session Duration**: Extended debugging session
**Complexity**: High (required deep system understanding)
**Impact**: Critical (affects all budget calculations)
