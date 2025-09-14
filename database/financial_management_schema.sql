-- Financial Management System Schema
-- Based on battleplan.txt requirements
-- Created: 2025-09-14

-- =====================================================
-- TABLE: estimated_incomes (Entrées d'argent estimées)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.estimated_incomes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid,
  group_id uuid,
  name text NOT NULL,
  estimated_amount numeric NOT NULL CHECK (estimated_amount >= 0),
  is_monthly_recurring boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  
  CONSTRAINT estimated_incomes_pkey PRIMARY KEY (id),
  CONSTRAINT estimated_incomes_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT estimated_incomes_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE,
  CONSTRAINT estimated_incomes_owner_check CHECK ((profile_id IS NOT NULL AND group_id IS NULL) OR (profile_id IS NULL AND group_id IS NOT NULL))
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_estimated_incomes_profile_id ON public.estimated_incomes(profile_id);
CREATE INDEX IF NOT EXISTS idx_estimated_incomes_group_id ON public.estimated_incomes(group_id);

-- =====================================================
-- TABLE: real_income_entries (Réelles entrées d'argent)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.real_income_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid,
  group_id uuid,
  estimated_income_id uuid,
  amount numeric NOT NULL CHECK (amount > 0),
  description text NOT NULL,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  is_exceptional boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  
  CONSTRAINT real_income_entries_pkey PRIMARY KEY (id),
  CONSTRAINT real_income_entries_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT real_income_entries_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE,
  CONSTRAINT real_income_entries_estimated_income_id_fkey FOREIGN KEY (estimated_income_id) REFERENCES public.estimated_incomes(id) ON DELETE SET NULL,
  CONSTRAINT real_income_entries_owner_check CHECK ((profile_id IS NOT NULL AND group_id IS NULL) OR (profile_id IS NULL AND group_id IS NOT NULL))
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_real_income_entries_profile_id ON public.real_income_entries(profile_id);
CREATE INDEX IF NOT EXISTS idx_real_income_entries_group_id ON public.real_income_entries(group_id);
CREATE INDEX IF NOT EXISTS idx_real_income_entries_entry_date ON public.real_income_entries(entry_date);

-- =====================================================
-- TABLE: estimated_budgets (Budgets estimés)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.estimated_budgets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid,
  group_id uuid,
  name text NOT NULL,
  estimated_amount numeric NOT NULL CHECK (estimated_amount >= 0),
  current_savings numeric NOT NULL DEFAULT 0 CHECK (current_savings >= 0),
  is_monthly_recurring boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  
  CONSTRAINT estimated_budgets_pkey PRIMARY KEY (id),
  CONSTRAINT estimated_budgets_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT estimated_budgets_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE,
  CONSTRAINT estimated_budgets_owner_check CHECK ((profile_id IS NOT NULL AND group_id IS NULL) OR (profile_id IS NULL AND group_id IS NOT NULL))
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_estimated_budgets_profile_id ON public.estimated_budgets(profile_id);
CREATE INDEX IF NOT EXISTS idx_estimated_budgets_group_id ON public.estimated_budgets(group_id);

-- =====================================================
-- TABLE: real_expenses (Réelles dépenses)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.real_expenses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid,
  group_id uuid,
  estimated_budget_id uuid,
  amount numeric NOT NULL CHECK (amount > 0),
  description text NOT NULL,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  is_exceptional boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  
  CONSTRAINT real_expenses_pkey PRIMARY KEY (id),
  CONSTRAINT real_expenses_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT real_expenses_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE,
  CONSTRAINT real_expenses_estimated_budget_id_fkey FOREIGN KEY (estimated_budget_id) REFERENCES public.estimated_budgets(id) ON DELETE SET NULL,
  CONSTRAINT real_expenses_owner_check CHECK ((profile_id IS NOT NULL AND group_id IS NULL) OR (profile_id IS NULL AND group_id IS NOT NULL))
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_real_expenses_profile_id ON public.real_expenses(profile_id);
CREATE INDEX IF NOT EXISTS idx_real_expenses_group_id ON public.real_expenses(group_id);
CREATE INDEX IF NOT EXISTS idx_real_expenses_expense_date ON public.real_expenses(expense_date);

-- =====================================================
-- TABLE: financial_snapshots (Cache des calculs financiers)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.financial_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid,
  group_id uuid,
  available_cash numeric NOT NULL DEFAULT 0,
  remaining_to_live numeric NOT NULL DEFAULT 0,
  total_estimated_income numeric NOT NULL DEFAULT 0,
  total_real_income numeric NOT NULL DEFAULT 0,
  total_estimated_budgets numeric NOT NULL DEFAULT 0,
  total_real_expenses numeric NOT NULL DEFAULT 0,
  total_budget_savings numeric NOT NULL DEFAULT 0,
  calculation_date timestamp with time zone DEFAULT now(),
  is_current boolean NOT NULL DEFAULT true,
  
  CONSTRAINT financial_snapshots_pkey PRIMARY KEY (id),
  CONSTRAINT financial_snapshots_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT financial_snapshots_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE,
  CONSTRAINT financial_snapshots_owner_check CHECK ((profile_id IS NOT NULL AND group_id IS NULL) OR (profile_id IS NULL AND group_id IS NOT NULL))
);

-- Index for performance and ensuring only one current snapshot per owner
CREATE INDEX IF NOT EXISTS idx_financial_snapshots_profile_id ON public.financial_snapshots(profile_id);
CREATE INDEX IF NOT EXISTS idx_financial_snapshots_group_id ON public.financial_snapshots(group_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_snapshots_current_profile ON public.financial_snapshots(profile_id) WHERE is_current = true AND profile_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_snapshots_current_group ON public.financial_snapshots(group_id) WHERE is_current = true AND group_id IS NOT NULL;

-- =====================================================
-- TRIGGER FUNCTIONS FOR AUTOMATIC CALCULATIONS
-- =====================================================

-- Function to calculate available cash (real income - real expenses)
CREATE OR REPLACE FUNCTION calculate_available_cash()
RETURNS TRIGGER AS $$
DECLARE
  target_profile_id uuid;
  target_group_id uuid;
  total_income numeric;
  total_expenses numeric;
  available_cash numeric;
BEGIN
  -- Determine if this is for a profile or group
  IF TG_TABLE_NAME = 'real_income_entries' THEN
    target_profile_id := COALESCE(NEW.profile_id, OLD.profile_id);
    target_group_id := COALESCE(NEW.group_id, OLD.group_id);
  ELSIF TG_TABLE_NAME = 'real_expenses' THEN
    target_profile_id := COALESCE(NEW.profile_id, OLD.profile_id);
    target_group_id := COALESCE(NEW.group_id, OLD.group_id);
  END IF;

  -- Calculate total real income
  IF target_profile_id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0) INTO total_income
    FROM real_income_entries 
    WHERE profile_id = target_profile_id;
    
    SELECT COALESCE(SUM(amount), 0) INTO total_expenses
    FROM real_expenses 
    WHERE profile_id = target_profile_id;
  ELSE
    SELECT COALESCE(SUM(amount), 0) INTO total_income
    FROM real_income_entries 
    WHERE group_id = target_group_id;
    
    SELECT COALESCE(SUM(amount), 0) INTO total_expenses
    FROM real_expenses 
    WHERE group_id = target_group_id;
  END IF;

  available_cash := total_income - total_expenses;

  -- Update or insert financial snapshot
  IF target_profile_id IS NOT NULL THEN
    INSERT INTO financial_snapshots (profile_id, available_cash, total_real_income, total_real_expenses)
    VALUES (target_profile_id, available_cash, total_income, total_expenses)
    ON CONFLICT ON CONSTRAINT idx_financial_snapshots_current_profile
    DO UPDATE SET 
      available_cash = EXCLUDED.available_cash,
      total_real_income = EXCLUDED.total_real_income,
      total_real_expenses = EXCLUDED.total_real_expenses,
      calculation_date = now();
  ELSE
    INSERT INTO financial_snapshots (group_id, available_cash, total_real_income, total_real_expenses)
    VALUES (target_group_id, available_cash, total_income, total_expenses)
    ON CONFLICT ON CONSTRAINT idx_financial_snapshots_current_group
    DO UPDATE SET 
      available_cash = EXCLUDED.available_cash,
      total_real_income = EXCLUDED.total_real_income,
      total_real_expenses = EXCLUDED.total_real_expenses,
      calculation_date = now();
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Function to update budget savings when expenses are added/removed
CREATE OR REPLACE FUNCTION update_budget_savings()
RETURNS TRIGGER AS $$
DECLARE
  budget_id uuid;
  total_spent numeric;
  estimated_amount numeric;
  new_savings numeric;
BEGIN
  -- Get the budget ID
  budget_id := COALESCE(NEW.estimated_budget_id, OLD.estimated_budget_id);
  
  -- Only proceed if there's a budget associated
  IF budget_id IS NOT NULL THEN
    -- Calculate total spent for this budget this month
    SELECT COALESCE(SUM(amount), 0) INTO total_spent
    FROM real_expenses 
    WHERE estimated_budget_id = budget_id 
      AND EXTRACT(YEAR FROM expense_date) = EXTRACT(YEAR FROM CURRENT_DATE)
      AND EXTRACT(MONTH FROM expense_date) = EXTRACT(MONTH FROM CURRENT_DATE);
    
    -- Get the estimated amount for this budget
    SELECT estimated_budgets.estimated_amount INTO estimated_amount
    FROM estimated_budgets 
    WHERE id = budget_id;
    
    -- Calculate savings (can be negative if overspent)
    new_savings := GREATEST(0, estimated_amount - total_spent);
    
    -- Update the budget with new savings
    UPDATE estimated_budgets 
    SET current_savings = new_savings, updated_at = now()
    WHERE id = budget_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Function to calculate remaining to live
CREATE OR REPLACE FUNCTION calculate_remaining_to_live()
RETURNS TRIGGER AS $$
DECLARE
  target_profile_id uuid;
  target_group_id uuid;
  total_income numeric := 0;
  total_budgeted numeric := 0;
  total_exceptional_expenses numeric := 0;
  total_savings numeric := 0;
  remaining_amount numeric;
BEGIN
  -- Determine target based on trigger context
  IF TG_TABLE_NAME IN ('real_income_entries', 'real_expenses') THEN
    target_profile_id := COALESCE(NEW.profile_id, OLD.profile_id);
    target_group_id := COALESCE(NEW.group_id, OLD.group_id);
  ELSIF TG_TABLE_NAME = 'estimated_budgets' THEN
    target_profile_id := COALESCE(NEW.profile_id, OLD.profile_id);
    target_group_id := COALESCE(NEW.group_id, OLD.group_id);
  END IF;

  IF target_profile_id IS NOT NULL THEN
    -- For profiles: income - budgeted - exceptional_expenses + budget_savings
    SELECT COALESCE(SUM(amount), 0) INTO total_income
    FROM real_income_entries WHERE profile_id = target_profile_id;
    
    SELECT COALESCE(SUM(estimated_amount), 0) INTO total_budgeted
    FROM estimated_budgets WHERE profile_id = target_profile_id;
    
    SELECT COALESCE(SUM(amount), 0) INTO total_exceptional_expenses
    FROM real_expenses WHERE profile_id = target_profile_id AND is_exceptional = true;
    
    SELECT COALESCE(SUM(current_savings), 0) INTO total_savings
    FROM estimated_budgets WHERE profile_id = target_profile_id;
    
  ELSE
    -- For groups: contributions + exceptional_income - budgeted - exceptional_expenses + budget_savings
    SELECT COALESCE(SUM(amount), 0) INTO total_income
    FROM real_income_entries WHERE group_id = target_group_id;
    
    SELECT COALESCE(SUM(estimated_amount), 0) INTO total_budgeted
    FROM estimated_budgets WHERE group_id = target_group_id;
    
    SELECT COALESCE(SUM(amount), 0) INTO total_exceptional_expenses
    FROM real_expenses WHERE group_id = target_group_id AND is_exceptional = true;
    
    SELECT COALESCE(SUM(current_savings), 0) INTO total_savings
    FROM estimated_budgets WHERE group_id = target_group_id;
  END IF;

  remaining_amount := total_income - total_budgeted - total_exceptional_expenses + total_savings;

  -- Update financial snapshot
  IF target_profile_id IS NOT NULL THEN
    INSERT INTO financial_snapshots (
      profile_id, remaining_to_live, total_estimated_budgets, total_budget_savings
    )
    VALUES (target_profile_id, remaining_amount, total_budgeted, total_savings)
    ON CONFLICT ON CONSTRAINT idx_financial_snapshots_current_profile
    DO UPDATE SET 
      remaining_to_live = EXCLUDED.remaining_to_live,
      total_estimated_budgets = EXCLUDED.total_estimated_budgets,
      total_budget_savings = EXCLUDED.total_budget_savings,
      calculation_date = now();
  ELSE
    INSERT INTO financial_snapshots (
      group_id, remaining_to_live, total_estimated_budgets, total_budget_savings
    )
    VALUES (target_group_id, remaining_amount, total_budgeted, total_savings)
    ON CONFLICT ON CONSTRAINT idx_financial_snapshots_current_group
    DO UPDATE SET 
      remaining_to_live = EXCLUDED.remaining_to_live,
      total_estimated_budgets = EXCLUDED.total_estimated_budgets,
      total_budget_savings = EXCLUDED.total_budget_savings,
      calculation_date = now();
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- TRIGGERS SETUP
-- =====================================================

-- Triggers for available cash calculation
DROP TRIGGER IF EXISTS trigger_calculate_available_cash_income ON real_income_entries;
DROP TRIGGER IF EXISTS trigger_calculate_available_cash_expenses ON real_expenses;

CREATE TRIGGER trigger_calculate_available_cash_income
  AFTER INSERT OR UPDATE OR DELETE ON real_income_entries
  FOR EACH ROW EXECUTE FUNCTION calculate_available_cash();

CREATE TRIGGER trigger_calculate_available_cash_expenses
  AFTER INSERT OR UPDATE OR DELETE ON real_expenses
  FOR EACH ROW EXECUTE FUNCTION calculate_available_cash();

-- Triggers for budget savings calculation
DROP TRIGGER IF EXISTS trigger_update_budget_savings ON real_expenses;

CREATE TRIGGER trigger_update_budget_savings
  AFTER INSERT OR UPDATE OR DELETE ON real_expenses
  FOR EACH ROW EXECUTE FUNCTION update_budget_savings();

-- Triggers for remaining to live calculation
DROP TRIGGER IF EXISTS trigger_calculate_remaining_income ON real_income_entries;
DROP TRIGGER IF EXISTS trigger_calculate_remaining_expenses ON real_expenses;
DROP TRIGGER IF EXISTS trigger_calculate_remaining_budgets ON estimated_budgets;

CREATE TRIGGER trigger_calculate_remaining_income
  AFTER INSERT OR UPDATE OR DELETE ON real_income_entries
  FOR EACH ROW EXECUTE FUNCTION calculate_remaining_to_live();

CREATE TRIGGER trigger_calculate_remaining_expenses
  AFTER INSERT OR UPDATE OR DELETE ON real_expenses
  FOR EACH ROW EXECUTE FUNCTION calculate_remaining_to_live();

CREATE TRIGGER trigger_calculate_remaining_budgets
  AFTER INSERT OR UPDATE OR DELETE ON estimated_budgets
  FOR EACH ROW EXECUTE FUNCTION calculate_remaining_to_live();

-- =====================================================
-- UPDATE TRIGGERS FOR TIMESTAMPS
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply update timestamp triggers
DROP TRIGGER IF EXISTS update_estimated_incomes_updated_at ON estimated_incomes;
DROP TRIGGER IF EXISTS update_estimated_budgets_updated_at ON estimated_budgets;

CREATE TRIGGER update_estimated_incomes_updated_at
  BEFORE UPDATE ON estimated_incomes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_estimated_budgets_updated_at
  BEFORE UPDATE ON estimated_budgets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE public.estimated_incomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.real_income_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimated_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.real_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_snapshots ENABLE ROW LEVEL SECURITY;

-- Policies for estimated_incomes
DROP POLICY IF EXISTS "Users can manage their own estimated incomes" ON estimated_incomes;
DROP POLICY IF EXISTS "Group members can manage group estimated incomes" ON estimated_incomes;

CREATE POLICY "Users can manage their own estimated incomes" ON estimated_incomes
  FOR ALL USING (profile_id = auth.uid());

CREATE POLICY "Group members can manage group estimated incomes" ON estimated_incomes
  FOR ALL USING (
    group_id IS NOT NULL AND 
    group_id IN (SELECT group_id FROM profiles WHERE id = auth.uid())
  );

-- Policies for real_income_entries
DROP POLICY IF EXISTS "Users can manage their own income entries" ON real_income_entries;
DROP POLICY IF EXISTS "Group members can manage group income entries" ON real_income_entries;

CREATE POLICY "Users can manage their own income entries" ON real_income_entries
  FOR ALL USING (profile_id = auth.uid());

CREATE POLICY "Group members can manage group income entries" ON real_income_entries
  FOR ALL USING (
    group_id IS NOT NULL AND 
    group_id IN (SELECT group_id FROM profiles WHERE id = auth.uid())
  );

-- Policies for estimated_budgets
DROP POLICY IF EXISTS "Users can manage their own budgets" ON estimated_budgets;
DROP POLICY IF EXISTS "Group members can manage group budgets" ON estimated_budgets;

CREATE POLICY "Users can manage their own budgets" ON estimated_budgets
  FOR ALL USING (profile_id = auth.uid());

CREATE POLICY "Group members can manage group budgets" ON estimated_budgets
  FOR ALL USING (
    group_id IS NOT NULL AND 
    group_id IN (SELECT group_id FROM profiles WHERE id = auth.uid())
  );

-- Policies for real_expenses
DROP POLICY IF EXISTS "Users can manage their own expenses" ON real_expenses;
DROP POLICY IF EXISTS "Group members can manage group expenses" ON real_expenses;

CREATE POLICY "Users can manage their own expenses" ON real_expenses
  FOR ALL USING (profile_id = auth.uid());

CREATE POLICY "Group members can manage group expenses" ON real_expenses
  FOR ALL USING (
    group_id IS NOT NULL AND 
    group_id IN (SELECT group_id FROM profiles WHERE id = auth.uid())
  );

-- Policies for financial_snapshots
DROP POLICY IF EXISTS "Users can view their own financial snapshots" ON financial_snapshots;
DROP POLICY IF EXISTS "Group members can view group financial snapshots" ON financial_snapshots;

CREATE POLICY "Users can view their own financial snapshots" ON financial_snapshots
  FOR SELECT USING (profile_id = auth.uid());

CREATE POLICY "Group members can view group financial snapshots" ON financial_snapshots
  FOR SELECT USING (
    group_id IS NOT NULL AND 
    group_id IN (SELECT group_id FROM profiles WHERE id = auth.uid())
  );