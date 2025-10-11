# RAV Persistence Implementation

## 📋 Overview

This document describes the implementation of the Remaining to Live (RAV) persistence system, which stores the calculated RAV value in the database for improved performance and consistency.

**Implementation Date**: 2025-10-11
**Status**: ✅ Complete

---

## 🎯 Goals

1. **Persist RAV**: Store the current RAV value in the database instead of calculating it on every page load
2. **Single Source of Truth**: The database becomes the authoritative source for RAV values
3. **Performance**: Reduce calculation overhead by storing the value
4. **Consistency**: Ensure all parts of the application display the same RAV value

---

## 🗄️ Database Changes

### New Column: `current_remaining_to_live`

Added to the existing `bank_balances` table:

```sql
ALTER TABLE public.bank_balances
ADD COLUMN IF NOT EXISTS current_remaining_to_live numeric DEFAULT 0;
```

**Rationale for using `bank_balances` table:**
- ✅ Already follows XOR pattern (profile OR group)
- ✅ One record per profile/group (perfect for storing a single "current" value)
- ✅ Co-located with related financial data (bank balance)
- ✅ Avoids creating a new table

### Indexes for Performance

```sql
CREATE INDEX IF NOT EXISTS idx_bank_balances_profile_rav
ON public.bank_balances(profile_id, current_remaining_to_live)
WHERE profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bank_balances_group_rav
ON public.bank_balances(group_id, current_remaining_to_live)
WHERE group_id IS NOT NULL;
```

### Migration File

**Location**: [supabase/migrations/20251011_add_current_rav_to_bank_balances.sql](../supabase/migrations/20251011_add_current_rav_to_bank_balances.sql)

---

## 💻 Code Changes

### 1. Financial Calculations Library

**File**: [lib/financial-calculations.ts](../lib/financial-calculations.ts)

#### New Functions

##### `saveRavToDatabase()`
```typescript
async function saveRavToDatabase(
  profileId: string | null,
  groupId: string | null,
  remainingToLive: number
): Promise<void>
```
- **Purpose**: Saves the calculated RAV to the database
- **Called by**: `getProfileFinancialData()` and `getGroupFinancialData()`
- **Updates**: `bank_balances.current_remaining_to_live` and `updated_at`

##### `getRavFromDatabase()`
```typescript
export async function getRavFromDatabase(
  profileId: string | null,
  groupId: string | null
): Promise<number>
```
- **Purpose**: Retrieves the persisted RAV value from the database
- **Returns**: Current RAV value or 0 if not found
- **Used by**: New `/api/financial/rav` endpoint

#### Modified Functions

- **`getProfileFinancialData()`**: Now calls `saveRavToDatabase()` after calculation
- **`getGroupFinancialData()`**: Now calls `saveRavToDatabase()` after calculation

### 2. API Routes

#### New Route: `/api/financial/rav`

**File**: [app/api/financial/rav/route.ts](../app/api/financial/rav/route.ts)

**Purpose**: Lightweight endpoint to retrieve only the RAV value from database

**Query Parameters**:
- `context`: `'profile'` | `'group'` (optional, defaults to profile)

**Response**:
```json
{
  "remainingToLive": 1250.50,
  "context": "profile",
  "timestamp": 1728648000000
}
```

#### Updated Route: `/api/financial/dashboard`

**File**: [app/api/financial/dashboard/route.ts](../app/api/financial/dashboard/route.ts)

**Changes**:
1. Import `getRavFromDatabase` function
2. Updated documentation to reflect RAV persistence
3. Added `recalculate=true` query parameter support (forces full recalculation)
4. RAV is now automatically saved to DB on every calculation

**Query Parameters**:
- `context`: `'profile'` | `'group'` (optional)
- `recalculate`: `'true'` | `'false'` (optional, forces recalculation when true)

---

## 🔄 Data Flow

### Before (Old System)
```
User Request → API → Calculate RAV → Return to UI
                     (every time)
```

### After (New System)
```
User Request → API → Retrieve RAV from DB → Return to UI
                     (fast)

Financial Change → Recalculate RAV → Save to DB → Return to UI
(income/expense)   (automatic)       (persist)
```

---

## 🔍 When is RAV Recalculated and Saved?

The RAV is automatically recalculated and saved to the database whenever:

1. **Dashboard loads**: `/api/financial/dashboard` is called
   - Calculates all financial metrics including RAV
   - Saves RAV to database automatically

2. **Financial data changes**: Any modification to:
   - Real income entries (create/update/delete)
   - Real expenses (create/update/delete)
   - Estimated budgets (create/update/delete)
   - Estimated incomes (create/update/delete)
   - Bank balance updates

3. **Forced recalculation**: When `?recalculate=true` is passed to the dashboard API

---

## 📊 Benefits

### Performance
- ✅ Faster page loads (no recalculation needed)
- ✅ Reduced database queries
- ✅ Indexed for fast retrieval

### Consistency
- ✅ Single source of truth for RAV
- ✅ All components display the same value
- ✅ No discrepancies between different parts of the UI

### Maintainability
- ✅ Clear separation: calculation logic vs. storage
- ✅ Easy to debug (can inspect DB directly)
- ✅ Audit trail still maintained via `remaining_to_live_snapshots`

---

## 🔗 Relationship with `remaining_to_live_snapshots` Table

The two tables serve **different purposes**:

| Table | Purpose | When Updated |
|-------|---------|--------------|
| `bank_balances.current_remaining_to_live` | **Current value** - Single source of truth for displaying RAV | Every time RAV is calculated |
| `remaining_to_live_snapshots` | **Historical audit trail** - Track RAV changes over time | On specific financial events (budget created, income added, etc.) |

**Analogy**:
- `current_remaining_to_live` = **Current bank account balance**
- `remaining_to_live_snapshots` = **Bank statement history**

---

## 🧪 Testing Recommendations

### 1. Database Migration
```bash
# Apply the migration in Supabase
# Verify the new column exists
SELECT current_remaining_to_live FROM bank_balances LIMIT 1;
```

### 2. API Testing
```bash
# Test RAV retrieval
curl http://localhost:3000/api/financial/rav

# Test dashboard with recalculation
curl http://localhost:3000/api/financial/dashboard?recalculate=true

# Test group context
curl http://localhost:3000/api/financial/rav?context=group
```

### 3. Functional Testing
1. Load the dashboard → RAV should display
2. Add an income entry → RAV should update
3. Add an expense → RAV should update
4. Refresh the page → RAV should remain consistent
5. Check database → `current_remaining_to_live` should match displayed value

---

## 🚀 Deployment Steps

1. **Apply Migration**: Run `20251011_add_current_rav_to_bank_balances.sql` in Supabase
2. **Deploy Code**: Push updated code to production
3. **Initial Sync**: Users' RAV will be calculated and saved on first dashboard load
4. **Monitor**: Check logs for successful RAV saves (`✅ RAV saved to database`)

---

## 📝 Future Improvements

### Potential Enhancements
1. **Background Job**: Periodic recalculation of RAV for all users
2. **Cache Invalidation**: More granular control over when RAV is recalculated
3. **Real-time Updates**: WebSocket-based RAV updates across multiple devices
4. **RAV History Chart**: Visualize RAV changes over time using snapshots

### Performance Optimization
1. **Lazy Loading**: Only calculate RAV when actually needed
2. **Batch Updates**: Update multiple users' RAV in a single transaction
3. **Read Replica**: Use read replicas for RAV retrieval in high-traffic scenarios

---

## 🐛 Troubleshooting

### Issue: RAV shows 0 after migration
**Solution**: The initial value is 0. It will be calculated and saved on first dashboard load.

### Issue: RAV not updating after adding expense
**Solution**: Check that `saveRavToDatabase()` is being called. Look for log: `✅ RAV saved to database`

### Issue: Different RAV values in different parts of UI
**Solution**: Ensure all components are using the same data source. Check for cached values.

---

## 📚 Related Documentation

- [DATABASE.md](../DATABASE.md) - Updated with `current_remaining_to_live` column
- [FINANCIAL_RULES.md](./FINANCIAL_RULES.md) - Business logic for RAV calculation
- [financial-calculations.ts](../lib/financial-calculations.ts) - Implementation details

---

## ✅ Summary

**What Changed**:
- ✅ Added `current_remaining_to_live` column to `bank_balances` table
- ✅ RAV is now saved to database after every calculation
- ✅ New API endpoint `/api/financial/rav` for lightweight RAV retrieval
- ✅ Updated dashboard API to use persisted RAV
- ✅ Documentation updated

**Result**: The RAV is now persisted in the database and serves as the single source of truth for all UI components. This improves performance and ensures consistency across the application.
