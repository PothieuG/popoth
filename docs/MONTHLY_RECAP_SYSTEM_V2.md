# Monthly Recap System V2 - Live Data Architecture

## 🎯 Core Philosophy

**ZERO CACHE POLICY**: The Monthly Recap system operates with a strict no-cache, no-storage, no-snapshot policy. Every data point is fetched live from the database on every interaction. This ensures absolute data consistency and eliminates stale data issues.

## ⚠️ Critical Distinction: Bank Balance vs Remaining to Live

**🚨 DO NOT CONFUSE THESE TWO CONCEPTS:**

### Bank Balance (`bank_balances.balance`)
- **Purpose**: Reflects the actual money in your bank account
- **Updated when**: Real transactions occur (real income received, real expenses made)
- **Formula**: `Real Income - Real Expenses`
- **Used for**: Tracking actual cash flow
- **Can be**: Negative (overdraft)

### Remaining to Live (`remainingToLive`)
- **Purpose**: Budget available for the current month after planning
- **Calculated by**: `getProfileFinancialData()` / `getGroupFinancialData()` using complex business rules
- **Formula**: `Estimated Income (unused) + Real Income (received) - Estimated Budgets - Exceptional Expenses + Budget Savings`
- **Used for**: Monthly budget planning and Monthly Recap rebalancing
- **Can be**: Negative (over-budget situation)

**🎯 Monthly Recap V2 Rule**: We use **ONLY** the Remaining to Live, calculated by existing financial functions. We DO NOT touch or recalculate it - we take it AS-IS and work with it.

## 📋 System Overview

The Monthly Recap is a 3-step financial rebalancing process that helps users manage their monthly budget by:
1. **Step 1**: Analyzing current financial situation and auto-rebalancing if needed
2. **Step 2**: Manual budget transfers and adjustments
3. **Step 3**: Final confirmation and monthly completion

## 🏗️ Architecture Principles

### 1. Live Data Architecture
- **No caching at any level** (React state, localStorage, cookies, snapshots)
- **Database-first approach**: Every component fetches its own data via dedicated APIs
- **Stateless components**: Components receive only context and fetch their own data
- **Real-time consistency**: Every action immediately reflects in database

### 2. Component Data Flow
```
User Action → API Call → Database Update → Component Refetch → UI Update
```

### 3. Proportional Rebalancing Logic
When remaining to live is negative, the system uses available funds in this order:
1. **Phase 1**: All savings (`cumulated_savings`) proportionally across budgets
2. **Phase 2**: All surpluses (`estimated_amount - spent_amount`) proportionally across budgets

## 📝 Step 1 Detailed Specification

### Initial Data Loading
When user arrives on Step 1:
1. **Fetch current `remaining_to_live`** via `getProfileFinancialData()` or `getGroupFinancialData()`
   - ⚠️ **CRITICAL**: Use the reste à vivre AS-IS from financial calculations
   - ⚠️ **DO NOT** recalculate or modify - it follows complex business rules
   - ⚠️ **NOT** the bank balance (`bank_balances.balance`) - completely different concept
2. Calculate budget surpluses: `estimated_amount - sum(real_expenses.amount)`
3. Retrieve budget savings: `cumulated_savings` from each budget
4. NO data persistence - fresh calculation every time

### Positive Remaining to Live (≥ 0€)
**Display**: Automatic carryover message
```
"✅ Votre reste à vivre est positif: +[amount]€
Ces fonds seront automatiquement reportés au mois prochain."
```
**Action**: Show "Continuer vers l'étape 2" button

### Negative Remaining to Live (< 0€)
**Display**: Deficit analysis with rebalancing options

**Show two lists**:
1. **Budgets with Savings** (`cumulated_savings > 0`)
   - Budget name
   - Available savings amount
   - Total available from all savings

2. **Budgets with Surpluses** (`estimated_amount - spent_amount > 0`)
   - Budget name
   - Surplus amount (`estimated_amount - real spent`)
   - Total available from all surpluses

**Auto-Rebalancing Button**: "Équilibrer automatiquement (-[deficit]€)"

### Auto-Rebalancing Algorithm (Proportional)

#### Phase 1: Savings Utilization
```typescript
// Use all available savings proportionally
for (const budget of budgetsWithSavings) {
  const proportion = budget.cumulated_savings / totalSavingsAvailable
  const amountToUse = proportion * Math.min(deficit, totalSavingsAvailable)

  // Update database:
  // - Reduce budget.cumulated_savings by amountToUse
  // - Increase bank_balances.balance by amountToUse
}
```

#### Phase 2: Surplus Utilization (if deficit remains)
```typescript
// Use all available surpluses proportionally
for (const budget of budgetsWithSurplus) {
  const proportion = budget.surplus / totalSurplusAvailable
  const amountToUse = proportion * Math.min(remainingDeficit, totalSurplusAvailable)

  // Update database:
  // - Create new real_expenses entry consuming the surplus
  // - Increase bank_balances.balance by amountToUse
}
```

#### Goal
Bring `remaining_to_live` as close to 0€ as possible using available funds.

### Post-Rebalancing Display
After successful auto-rebalancing:
1. **Recap Card** showing:
   - Original remaining to live: `[negative_amount]€`
   - Final remaining to live: `[new_amount]€` (ideally 0€)
   - Total recovered: `[total_used]€`
   - Breakdown: `[savings_used]€ from savings + [surplus_used]€ from surpluses`

2. **Updated Budget Status**:
   - Remaining savings per budget
   - Remaining surpluses per budget

3. **Continue Button**: "Continuer vers l'étape 2"

## 🔧 Technical Implementation

### API Endpoints

#### GET `/api/monthly-recap/step1-data`
**Purpose**: Fetch live data for Step 1 display
**Parameters**: `?context=profile|group`

**Data Sources**:
- **Remaining to Live**: From `getProfileFinancialData()` / `getGroupFinancialData()` - applies complex business rules
- **Budget Surpluses**: Calculated as `estimated_amount - sum(real_expenses.amount)`
- **Budget Savings**: From `estimated_budgets.cumulated_savings` column

**Returns**:
```typescript
{
  current_remaining_to_live: number        // From financial calculation functions - DO NOT modify
  budgets_with_savings: Array<{
    id: string
    name: string
    cumulated_savings: number              // From database column
  }>
  budgets_with_surplus: Array<{
    id: string
    name: string
    estimated_amount: number
    spent_amount: number                   // sum(real_expenses) for this budget
    surplus: number                        // calculated: estimated_amount - spent_amount
  }>
  total_savings_available: number
  total_surplus_available: number
  can_rebalance: boolean
}
```

#### POST `/api/monthly-recap/balance`
**Purpose**: Execute proportional auto-rebalancing
**Parameters**: `{ context: 'profile' | 'group' }`

**Logic**:
1. Validate remaining to live is negative (from `getProfileFinancialData()`)
2. Execute Phase 1 (savings proportional redistribution)
3. Execute Phase 2 (surplus proportional redistribution)
4. **Update bank balance** (`bank_balances.balance`) to reflect recovered funds

**⚠️ Important**: This process modifies budget savings and creates expense entries, which indirectly affects the remaining to live calculation through the existing financial rules. We do NOT directly modify the remaining to live - it gets recalculated automatically by the financial functions.
**Returns**:
```typescript
{
  success: boolean
  original_remaining_to_live: number
  final_remaining_to_live: number
  deficit_covered: number
  savings_used: number
  surplus_used: number
  proportional_changes: Array<{
    budget_id: string
    budget_name: string
    type: 'savings' | 'surplus'
    amount_used: number
  }>
}
```

### Component Architecture

#### MonthlyRecapStep1
- **Stateless component**
- Fetches own data via `fetchStep1Data()`
- Automatically refetches after rebalancing
- No props for data - only `context` and callbacks

#### MonthlyRecapFlow
- **Navigation controller only**
- Passes `context` to child components
- No data management or caching
- Simple step progression

#### useMonthlyRecap Hook
- **Simplified to navigation + actions only**
- Removed all data caching
- Only manages: `currentStep`, `error`, and action functions
- No `recapData`, `isLoading`, or data state

## 🚨 Critical Rules

### Financial Data Handling
1. **NEVER confuse Bank Balance with Remaining to Live** - they are completely different concepts
2. **NEVER recalculate Remaining to Live** - always use `getProfileFinancialData()` / `getGroupFinancialData()`
3. **NEVER modify Remaining to Live directly** - it's calculated by complex business rules in financial functions
4. **Rebalancing updates Bank Balance** (`bank_balances.balance`) and budget data, which indirectly affects Remaining to Live

### Data Consistency
1. **NEVER cache financial data** in React state, localStorage, or any client storage
2. **ALWAYS fetch fresh** from database on every component mount/action
3. **Every action = database write** - no optimistic updates or client-side calculations

### Component Behavior
1. **Components are stateless** regarding financial data
2. **Props contain only context and callbacks** - never financial data
3. **Automatic refetch** after any financial action

### Database Operations
1. **Atomic transactions** for rebalancing operations
2. **Immediate consistency** - no eventual consistency patterns
3. **Audit trail** via real_expenses entries for surplus consumption

## 🔄 Data Flow Example

```
1. User navigates to Monthly Recap
   ↓
2. MonthlyRecapStep1 mounts
   ↓
3. fetchStep1Data() → GET /api/monthly-recap/step1-data
   ↓
4. API calculates live remaining_to_live + budget analysis
   ↓
5. Component displays current financial state
   ↓
6. User clicks "Auto-rebalance"
   ↓
7. handleAutoBalance() → POST /api/monthly-recap/balance
   ↓
8. API executes proportional rebalancing in database
   ↓
9. Component refetches → fetchStep1Data() again
   ↓
10. UI shows updated state with new remaining_to_live
```

## 📊 Database Tables Used

### Primary Tables
- **estimated_budgets**: Source of budget data and `cumulated_savings`
- **real_expenses**: Source of actual spending for surplus calculations
- **bank_balances**: Updated to reflect recovered funds
- **profiles/groups**: Context determination

### Calculation Sources
- **Remaining to Live**: `getProfileFinancialData()` / `getGroupFinancialData()`
- **Budget Surpluses**: `estimated_amount - sum(real_expenses)`
- **Budget Savings**: `cumulated_savings` column

## ⚠️ Migration Notes

This V2 system **completely replaces** any previous caching-based monthly recap implementations. All snapshot tables (`recap_snapshots`, `remaining_to_live_snapshots`) are now **unused** by this system and serve only for historical reference.

The new system prioritizes **real-time accuracy** over performance, ensuring users always see the most current financial state without any cache-related inconsistencies.