# Database Structure

## 📝 Supabase Tables

### **`public.profiles`**
```sql
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  group_id uuid,
  salary numeric DEFAULT 0,
  avatar_url text DEFAULT NULL,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
```

**Table Purpose**: Extended user profile information with single group membership, salary management, and personal avatar
- **Primary Key**: `id` (UUID) - Links directly to `auth.users(id)`
- **Required Fields**: `first_name`, `last_name` - User's full name
- **Salary Field**: `salary` (NUMERIC) - Monthly salary in euros, defaults to 0
- **Avatar Field**: `avatar_url` (TEXT) - Personal avatar image as data URL or external URL, nullable
- **Group Relationship**: `group_id` - Links to single group (nullable)
- **Timestamps**: Automatic `created_at` and `updated_at` tracking
- **Constraint**: One user can belong to maximum one group

### **`public.groups`**
```sql
CREATE TABLE public.groups (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  monthly_budget_estimate numeric NOT NULL,
  creator_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT groups_pkey PRIMARY KEY (id),
  CONSTRAINT groups_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES auth.users(id)
);
```

**Table Purpose**: Groups for budget management and collaboration
- **Primary Key**: `id` (UUID) - Unique group identifier
- **Required Fields**: `name` (unique), `monthly_budget_estimate`, `creator_id`
- **Foreign Key**: `creator_id` links to `auth.users(id)`
- **Auto-update**: `updated_at` trigger for modifications
- **RLS**: Row-level security enabled with creator-based permissions

### **`public.group_contributions`**
```sql
CREATE TABLE public.group_contributions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  group_id uuid NOT NULL,
  salary numeric NOT NULL CHECK (salary >= 0::numeric),
  contribution_amount numeric NOT NULL CHECK (contribution_amount >= 0::numeric),
  contribution_percentage numeric NOT NULL CHECK (contribution_percentage >= 0::numeric),
  calculated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT group_contributions_pkey PRIMARY KEY (id),
  CONSTRAINT group_contributions_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id),
  CONSTRAINT group_contributions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id)
);
```

**Table Purpose**: Stores calculated proportional contributions for each user in a group
- **Primary Key**: `id` (UUID) - Unique contribution record identifier
- **Required Fields**: `profile_id`, `group_id`, `salary`, `contribution_amount`, `contribution_percentage`
- **Foreign Keys**: Links to both `profiles(id)` and `groups(id)` tables
- **Salary Snapshot**: `salary` field captures user's salary when contribution was calculated
- **Calculated Values**: `contribution_amount` (euros), `contribution_percentage` (% of personal salary)
- **Constraints**: All numeric values must be >= 0, unique constraint per (profile_id, group_id)
- **Auto-calculation**: Updated automatically via PostgreSQL triggers when salaries or group budgets change
- **Cleanup**: Records automatically deleted when profile leaves group or group is deleted

**Note**: The `group_members` table has been removed in favor of direct relationship via `profiles.group_id`.

## Financial Tables (XOR Ownership Pattern)

All financial tables implement the XOR ownership pattern where each record belongs to either a profile OR a group (never both, never neither).

### **`public.estimated_incomes`**
```sql
CREATE TABLE public.estimated_incomes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid,
  group_id uuid,
  name text NOT NULL,
  estimated_amount numeric NOT NULL CHECK (estimated_amount >= 0),
  is_monthly_recurring boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT estimated_incomes_pkey PRIMARY KEY (id),
  CONSTRAINT estimated_incomes_owner_exclusive_check CHECK (
    (profile_id IS NOT NULL AND group_id IS NULL) OR
    (profile_id IS NULL AND group_id IS NOT NULL)
  )
);
```

**Table Purpose**: Estimated income sources for financial planning
- **XOR Ownership**: Each record belongs to either a profile OR a group (never both)
- **Required Fields**: `name`, `estimated_amount` (≥ 0), `is_monthly_recurring`
- **Automatic Timestamps**: `created_at`, `updated_at` with triggers
- **Business Logic**: Name cannot be empty, amounts must be non-negative

### **`public.real_income_entries`**
```sql
CREATE TABLE public.real_income_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid,
  group_id uuid,
  estimated_income_id uuid,
  amount numeric NOT NULL CHECK (amount > 0),
  description text,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  is_exceptional boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT real_income_entries_pkey PRIMARY KEY (id),
  CONSTRAINT real_income_entries_owner_exclusive_check CHECK (
    (profile_id IS NOT NULL AND group_id IS NULL) OR
    (profile_id IS NULL AND group_id IS NOT NULL)
  )
);
```

**Table Purpose**: Actual income entries for cash calculations
- **Required**: Positive `amount`, `entry_date`
- **Optional Link**: `estimated_income_id` (NULL for exceptional income)
- **Automatic Triggers**: Updates financial snapshots on changes

### **`public.bank_balances` (Extended for Groups)**
```sql
CREATE TABLE public.bank_balances (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid,
  group_id uuid,
  balance numeric NOT NULL DEFAULT 0 CHECK (balance >= 0::numeric),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT bank_balances_pkey PRIMARY KEY (id),
  CONSTRAINT bank_balances_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES auth.users(id),
  CONSTRAINT bank_balances_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id),
  CONSTRAINT bank_balances_owner_exclusive_check CHECK (
    (profile_id IS NOT NULL AND group_id IS NULL) OR
    (profile_id IS NULL AND group_id IS NOT NULL)
  )
);

-- Partial unique indexes for XOR pattern
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_balances_profile_id_unique
ON public.bank_balances(profile_id) WHERE profile_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_balances_group_id_unique
ON public.bank_balances(group_id) WHERE group_id IS NOT NULL;
```

**Table Purpose**: Stores editable bank balances for both profiles and groups
- **XOR Ownership**: Each balance belongs to either a profile OR a group (never both)
- **Partial Indexes**: Ensure one balance per profile and one per group
- **Independent Balances**: Profiles and groups have completely separate bank balances
- **RLS Policies**: Users can only access their own profile balance or their group's balance
- **Context Support**: APIs use `?context=profile|group` to determine which balance to access

### **`public.estimated_budgets`**
```sql
CREATE TABLE public.estimated_budgets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid,
  group_id uuid,
  name text NOT NULL CHECK (TRIM(BOTH FROM name) <> ''::text),
  estimated_amount numeric NOT NULL CHECK (estimated_amount >= 0::numeric),
  is_monthly_recurring boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  monthly_surplus numeric DEFAULT 0 CHECK (monthly_surplus >= 0::numeric),
  monthly_deficit numeric DEFAULT 0 CHECK (monthly_deficit >= 0::numeric),
  last_monthly_update date,
  carryover_spent_amount numeric DEFAULT 0 CHECK (carryover_spent_amount >= 0::numeric),
  carryover_applied_date date,
  cumulated_savings numeric DEFAULT 0 CHECK (cumulated_savings >= 0::numeric),
  last_savings_update date,
  CONSTRAINT estimated_budgets_pkey PRIMARY KEY (id),
  CONSTRAINT estimated_budgets_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id),
  CONSTRAINT estimated_budgets_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id)
);
```

**Table Purpose**: Budget categories with savings tracking and monthly carryover functionality
- **XOR Ownership**: Each budget belongs to either a profile OR a group (never both)
- **Required Fields**: `name` (non-empty), `estimated_amount` (≥ 0)
- **Savings System**: `cumulated_savings` tracks accumulated budget savings over time
- **Monthly Recap Integration**: Used by Monthly Recap V2 system for proportional rebalancing
- **Carryover Support**: `carryover_spent_amount` for monthly budget rollovers
- **Monthly Tracking**: `monthly_surplus`/`monthly_deficit` for period-based analysis

### **`public.real_expenses`**
```sql
CREATE TABLE public.real_expenses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid,
  group_id uuid,
  estimated_budget_id uuid,
  amount numeric NOT NULL CHECK (amount > 0),
  description text,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  is_exceptional boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT real_expenses_pkey PRIMARY KEY (id),
  CONSTRAINT real_expenses_owner_exclusive_check CHECK (
    (profile_id IS NOT NULL AND group_id IS NULL) OR
    (profile_id IS NULL AND group_id IS NOT NULL)
  )
);
```

**Table Purpose**: Actual expenses with budget tracking
- **Optional Link**: `estimated_budget_id` (NULL for exceptional expenses)
- **Automatic Triggers**: Updates budget savings and financial snapshots

## Removed Tables

### **`public.financial_snapshots`** ❌ REMOVED
```sql
-- This table has been removed in favor of application-side calculations
```

**❌ Table Removed**: This table has been removed in favor of application-side calculations
- **Reason**: Moved to efficient caching system in Next.js API routes
- **Replacement**: `/api/financial/dashboard` with 5-minute in-memory cache
- **Benefits**: Better performance, easier debugging, more maintainable code
- **Migration**: Successfully completed on 2025-09-15 with comprehensive testing

## Database Relationships

### Primary Relationships
1. **Users ↔ Profiles**: One-to-one via `profiles.id` → `auth.users.id`
2. **Profiles ↔ Groups**: Many-to-one via `profiles.group_id` → `groups.id`
3. **Groups ↔ Creator**: Many-to-one via `groups.creator_id` → `auth.users.id`
4. **Profiles ↔ Contributions**: One-to-many via `group_contributions.profile_id` → `profiles.id`

### Financial Data Relationships
- **Profile Financial Data**: All financial tables linked via `profile_id`
- **Group Financial Data**: All financial tables linked via `group_id`
- **Budget Tracking**: `real_expenses.estimated_budget_id` → `estimated_budgets.id`
- **Income Tracking**: `real_income_entries.estimated_income_id` → `estimated_incomes.id`

### Security Model
- **Row Level Security (RLS)**: Enabled on all tables
- **User Isolation**: Users can only access their own data and their group's data
- **Creator Privileges**: Group creators have additional permissions for group management
- **Context-Based Access**: APIs enforce profile vs group context separation