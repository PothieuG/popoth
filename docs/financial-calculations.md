# Financial Calculations System Documentation

## Overview
The application implements a complete financial management system with separation between personal profiles and groups. Each entity (profile or group) has its own independent financial data including bank balances, budgets, incomes, and calculations.

## Core Financial Concepts

### 1. Data Independence
- **Profiles**: Personal financial data for individual users
- **Groups**: Shared financial data completely independent from members' personal finances
- **XOR Ownership**: Each financial record belongs to either a profile OR a group, never both

### 2. Key Financial Metrics
1. **Available Balance (Solde Disponible)**: Current bank balance
2. **Remaining to Live (Reste à Vivre)**: Money available after covering budgets
3. **Total Savings (Épargne Totale)**: Accumulated savings from budget management

## Financial Calculation Logic

### Profile Calculations
Located in `lib/financial-calculations.ts` - `getProfileFinancialData()`

#### Available Balance
```typescript
// Direct bank balance from bank_balances table
const availableBalance = bankBalance || 0
```

#### Remaining to Live
```typescript
const remainingToLive = totalEstimatedIncome - totalEstimatedBudgets
```
- **Formula**: Total Estimated Income - Total Estimated Budgets
- **Purpose**: Shows how much money remains after covering all planned expenses
- **Example**: 1000€ income - 400€ budgets = 600€ remaining to live

#### Total Savings
```typescript
const totalSavings = budgets.reduce((sum, budget) => sum + (budget.current_savings || 0), 0)
```
- **Source**: Sum of `current_savings` from all estimated_budgets
- **Calculation**: `MAX(0, estimated_amount - spent_this_month)` per budget
- **Updates**: Automatically recalculated when expenses are added

### Group Calculations
Located in `lib/financial-calculations.ts` - `getGroupFinancialData()`

#### Available Balance
```typescript
// Group's own bank balance (independent from members)
const { data: groupBankBalance } = await supabaseServer
  .from('bank_balances')
  .select('balance')
  .eq('group_id', groupId)
  .single()

const availableBalance = groupBankBalance?.balance || 0
```

#### Remaining to Live
```typescript
const remainingToLive = totalEstimatedIncome - totalEstimatedBudgets
```
- **Same Formula**: Total Group Income - Total Group Budgets
- **Independence**: Uses only group's estimated incomes and budgets
- **No Member Data**: Does not consider member salaries or personal finances

#### Total Savings
```typescript
const totalSavings = budgets.reduce((sum, budget) => sum + (budget.current_savings || 0), 0)
```
- **Group-specific**: Sum of savings from group budgets only
- **Separate Tracking**: Independent from member savings

## Database Schema Integration

### Financial Tables Structure

#### `bank_balances` (Modified for Groups)
```sql
CREATE TABLE public.bank_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid,
  group_id uuid,
  balance numeric NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),

  -- XOR constraint: belongs to profile OR group
  CONSTRAINT bank_balances_owner_exclusive_check CHECK (
    (profile_id IS NOT NULL AND group_id IS NULL) OR
    (profile_id IS NULL AND group_id IS NOT NULL)
  ),

  -- Unique constraints
  CONSTRAINT bank_balances_profile_id_unique UNIQUE (profile_id),
  CONSTRAINT bank_balances_group_id_unique UNIQUE (group_id)
);
```

#### `estimated_budgets` (Budget Categories)
```sql
CREATE TABLE public.estimated_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid,
  group_id uuid,
  name text NOT NULL,
  estimated_amount numeric NOT NULL CHECK (estimated_amount >= 0),
  current_savings numeric NOT NULL DEFAULT 0 CHECK (current_savings >= 0),
  is_monthly_recurring boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),

  -- XOR ownership constraint
  CONSTRAINT estimated_budgets_owner_exclusive_check CHECK (
    (profile_id IS NOT NULL AND group_id IS NULL) OR
    (profile_id IS NULL AND group_id IS NOT NULL)
  )
);
```

#### `estimated_incomes` (Income Sources)
```sql
CREATE TABLE public.estimated_incomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid,
  group_id uuid,
  name text NOT NULL,
  estimated_amount numeric NOT NULL CHECK (estimated_amount >= 0),
  is_monthly_recurring boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),

  -- XOR ownership constraint
  CONSTRAINT estimated_incomes_owner_exclusive_check CHECK (
    (profile_id IS NOT NULL AND group_id IS NULL) OR
    (profile_id IS NULL AND group_id IS NOT NULL)
  )
);
```

#### `real_expenses` (Actual Spending)
```sql
CREATE TABLE public.real_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid,
  group_id uuid,
  estimated_budget_id uuid, -- Links to budget category (optional)
  amount numeric NOT NULL CHECK (amount > 0),
  description text,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  is_exceptional boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),

  -- XOR ownership constraint
  CONSTRAINT real_expenses_owner_exclusive_check CHECK (
    (profile_id IS NOT NULL AND group_id IS NULL) OR
    (profile_id IS NULL AND group_id IS NOT NULL)
  )
);
```

#### `real_income_entries` (Actual Income)
```sql
CREATE TABLE public.real_income_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid,
  group_id uuid,
  estimated_income_id uuid, -- Links to income source (optional)
  amount numeric NOT NULL CHECK (amount > 0),
  description text,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  is_exceptional boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),

  -- XOR ownership constraint
  CONSTRAINT real_income_entries_owner_exclusive_check CHECK (
    (profile_id IS NOT NULL AND group_id IS NULL) OR
    (profile_id IS NULL AND group_id IS NOT NULL)
  )
);
```

## API Architecture

### Context-Based Routing
All financial APIs support context parameter to separate profile and group data:

#### Budget API (`/api/budgets`)
```typescript
// GET with context
GET /api/budgets?context=profile  // Returns user's personal budgets
GET /api/budgets?context=group    // Returns group budgets

// POST with context
POST /api/budgets
Body: { name: "Groceries", estimated_amount: 300, context: "group" }
```

#### Income API (`/api/incomes`)
```typescript
// GET with context
GET /api/incomes?context=profile  // Returns user's personal incomes
GET /api/incomes?context=group    // Returns group incomes

// POST with context
POST /api/incomes
Body: { name: "Salary", estimated_amount: 2000, context: "profile" }
```

#### Bank Balance API (`/api/bank-balance`)
```typescript
// GET with context
GET /api/bank-balance?context=profile  // Returns user's bank balance
GET /api/bank-balance?context=group    // Returns group bank balance

// POST with context
POST /api/bank-balance
Body: { balance: 1500, context: "group" }
```

### Financial Dashboard API (`/api/financial/dashboard`)
```typescript
// GET with context
GET /api/financial/dashboard?context=profile  // Returns personal financial summary
GET /api/financial/dashboard?context=group    // Returns group financial summary

// Response format
{
  availableBalance: number,
  remainingToLive: number,
  totalSavings: number,
  cached: boolean,
  context: 'profile' | 'group'
}
```

## Caching System

### Smart Caching Strategy
- **Cache Duration**: 5 minutes in-memory cache
- **Cache Key**: `financial-data-${context}-${identifier}`
- **Invalidation**: Automatic on budget/income modifications

```typescript
// Cache implementation in /api/financial/dashboard
const cacheKey = `financial-data-${context}-${context === 'group' ? profile.group_id : sessionData.userId}`
const cached = cache.get(cacheKey)

if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
  return cached.data
}
```

### Cache Invalidation Triggers
- Budget creation/update/deletion
- Income creation/update/deletion
- Bank balance updates
- Real expense entries
- Real income entries

## Frontend Integration

### React Hooks
All financial hooks support context parameter:

```typescript
// Profile context (default)
const { financialData } = useFinancialData()
const { budgets } = useBudgets()
const { balance } = useBankBalance('profile')

// Group context
const { financialData } = useFinancialData('group')
const { budgets } = useBudgets('group')
const { balance } = useBankBalance('group')
```

### Dashboard Components
- **Personal Dashboard**: `/dashboard` uses profile context
- **Group Dashboard**: `/group-dashboard` uses group context
- **Financial Indicators**: Same component, different data based on context
- **Editable Balance Line**: Context-aware bank balance editing

## Security Implementation

### Row Level Security (RLS)
All financial tables implement RLS policies:

```sql
-- Profiles can only access their own data
CREATE POLICY "Users can view own profile financial data" ON estimated_budgets
FOR SELECT USING (profile_id = auth.uid());

-- Group members can access group data
CREATE POLICY "Group members can view group financial data" ON estimated_budgets
FOR SELECT USING (
  group_id IN (
    SELECT group_id FROM profiles WHERE id = auth.uid() AND group_id IS NOT NULL
  )
);
```

### API Security
- **JWT Authentication**: Required for all financial endpoints
- **Context Validation**: Ensures users can only access appropriate data
- **Group Membership**: Verified before allowing group data access
- **Input Validation**: All amounts and data validated before database operations

## Performance Optimizations

### Database Optimizations
- **Partial Indexes**: Created for profile_id and group_id on financial tables
- **Foreign Key Constraints**: Ensure data integrity and enable query optimization
- **Check Constraints**: Prevent invalid data at database level

### Application Optimizations
- **Smart Caching**: Reduces database load with intelligent invalidation
- **Context Separation**: Prevents unnecessary data fetching
- **Batch Operations**: Efficient data aggregation in single queries
- **Error Resilience**: Graceful handling of missing data or connection issues

## Troubleshooting Guide

### Common Issues

1. **Missing Financial Data**
   - Check context parameter in API calls
   - Verify user has appropriate permissions
   - Check cache invalidation timing

2. **Incorrect Calculations**
   - Verify XOR ownership constraints
   - Check data separation between profile/group
   - Validate estimated amounts vs actual entries

3. **Cache Problems**
   - Clear cache manually if needed
   - Check cache key generation
   - Verify invalidation triggers

### Debug APIs
- `/api/debug/financial`: Comprehensive financial data debugging
- Logs all calculation steps and data sources
- Helps identify context or calculation issues