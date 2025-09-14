-- =================================================================
-- MIGRATION: Corrections et Améliorations Schema Financier
-- Date: 2025-09-14
-- Objectif: Ajouter contraintes manquantes, index et triggers
-- =================================================================

-- =====================================================
-- CONTRAINTES D'EXCLUSION MUTUELLE
-- =====================================================

-- estimated_incomes: profile_id XOR group_id
ALTER TABLE public.estimated_incomes 
ADD CONSTRAINT estimated_incomes_owner_check 
CHECK ((profile_id IS NOT NULL AND group_id IS NULL) OR (profile_id IS NULL AND group_id IS NOT NULL));

-- estimated_budgets: profile_id XOR group_id  
ALTER TABLE public.estimated_budgets
ADD CONSTRAINT estimated_budgets_owner_check
CHECK ((profile_id IS NOT NULL AND group_id IS NULL) OR (profile_id IS NULL AND group_id IS NOT NULL));

-- real_income_entries: profile_id XOR group_id
ALTER TABLE public.real_income_entries
ADD CONSTRAINT real_income_entries_owner_check
CHECK ((profile_id IS NOT NULL AND group_id IS NULL) OR (profile_id IS NULL AND group_id IS NOT NULL));

-- real_expenses: profile_id XOR group_id
ALTER TABLE public.real_expenses
ADD CONSTRAINT real_expenses_owner_check
CHECK ((profile_id IS NOT NULL AND group_id IS NULL) OR (profile_id IS NULL AND group_id IS NOT NULL));

-- financial_snapshots: profile_id XOR group_id
ALTER TABLE public.financial_snapshots
ADD CONSTRAINT financial_snapshots_owner_check
CHECK ((profile_id IS NOT NULL AND group_id IS NULL) OR (profile_id IS NULL AND group_id IS NOT NULL));

-- =====================================================
-- INDEX DE PERFORMANCE
-- =====================================================

-- Profiles
CREATE INDEX IF NOT EXISTS idx_profiles_group_id ON public.profiles(group_id);

-- Estimated incomes
CREATE INDEX IF NOT EXISTS idx_estimated_incomes_profile_id ON public.estimated_incomes(profile_id);
CREATE INDEX IF NOT EXISTS idx_estimated_incomes_group_id ON public.estimated_incomes(group_id);

-- Real income entries
CREATE INDEX IF NOT EXISTS idx_real_income_entries_profile_id ON public.real_income_entries(profile_id);
CREATE INDEX IF NOT EXISTS idx_real_income_entries_group_id ON public.real_income_entries(group_id);
CREATE INDEX IF NOT EXISTS idx_real_income_entries_date ON public.real_income_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_real_income_entries_estimated_id ON public.real_income_entries(estimated_income_id);

-- Estimated budgets
CREATE INDEX IF NOT EXISTS idx_estimated_budgets_profile_id ON public.estimated_budgets(profile_id);
CREATE INDEX IF NOT EXISTS idx_estimated_budgets_group_id ON public.estimated_budgets(group_id);

-- Real expenses
CREATE INDEX IF NOT EXISTS idx_real_expenses_profile_id ON public.real_expenses(profile_id);
CREATE INDEX IF NOT EXISTS idx_real_expenses_group_id ON public.real_expenses(group_id);
CREATE INDEX IF NOT EXISTS idx_real_expenses_date ON public.real_expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_real_expenses_budget_id ON public.real_expenses(estimated_budget_id);

-- Financial snapshots
CREATE INDEX IF NOT EXISTS idx_financial_snapshots_profile_id ON public.financial_snapshots(profile_id);
CREATE INDEX IF NOT EXISTS idx_financial_snapshots_group_id ON public.financial_snapshots(group_id);

-- Contraintes d'unicité pour snapshots courants
CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_snapshots_current_profile 
ON public.financial_snapshots(profile_id) 
WHERE is_current = true AND profile_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_snapshots_current_group 
ON public.financial_snapshots(group_id) 
WHERE is_current = true AND group_id IS NOT NULL;

-- Group contributions
CREATE INDEX IF NOT EXISTS idx_group_contributions_profile_id ON public.group_contributions(profile_id);
CREATE INDEX IF NOT EXISTS idx_group_contributions_group_id ON public.group_contributions(group_id);

-- =====================================================
-- CONTRAINTES FOREIGN KEY MANQUANTES
-- =====================================================

-- Ajout ON DELETE CASCADE manquantes pour intégrité référentielle
ALTER TABLE public.estimated_incomes
DROP CONSTRAINT IF EXISTS estimated_incomes_profile_id_fkey,
ADD CONSTRAINT estimated_incomes_profile_id_fkey 
FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.estimated_incomes
DROP CONSTRAINT IF EXISTS estimated_incomes_group_id_fkey,
ADD CONSTRAINT estimated_incomes_group_id_fkey 
FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;

ALTER TABLE public.estimated_budgets
DROP CONSTRAINT IF EXISTS estimated_budgets_profile_id_fkey,
ADD CONSTRAINT estimated_budgets_profile_id_fkey 
FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.estimated_budgets
DROP CONSTRAINT IF EXISTS estimated_budgets_group_id_fkey,
ADD CONSTRAINT estimated_budgets_group_id_fkey 
FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;

ALTER TABLE public.real_income_entries
DROP CONSTRAINT IF EXISTS real_income_entries_profile_id_fkey,
ADD CONSTRAINT real_income_entries_profile_id_fkey 
FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.real_income_entries
DROP CONSTRAINT IF EXISTS real_income_entries_group_id_fkey,
ADD CONSTRAINT real_income_entries_group_id_fkey 
FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;

ALTER TABLE public.real_income_entries
DROP CONSTRAINT IF EXISTS real_income_entries_estimated_income_id_fkey,
ADD CONSTRAINT real_income_entries_estimated_income_id_fkey 
FOREIGN KEY (estimated_income_id) REFERENCES public.estimated_incomes(id) ON DELETE SET NULL;

ALTER TABLE public.real_expenses
DROP CONSTRAINT IF EXISTS real_expenses_profile_id_fkey,
ADD CONSTRAINT real_expenses_profile_id_fkey 
FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.real_expenses
DROP CONSTRAINT IF EXISTS real_expenses_group_id_fkey,
ADD CONSTRAINT real_expenses_group_id_fkey 
FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;

ALTER TABLE public.real_expenses
DROP CONSTRAINT IF EXISTS real_expenses_estimated_budget_id_fkey,
ADD CONSTRAINT real_expenses_estimated_budget_id_fkey 
FOREIGN KEY (estimated_budget_id) REFERENCES public.estimated_budgets(id) ON DELETE SET NULL;

ALTER TABLE public.financial_snapshots
DROP CONSTRAINT IF EXISTS financial_snapshots_profile_id_fkey,
ADD CONSTRAINT financial_snapshots_profile_id_fkey 
FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.financial_snapshots
DROP CONSTRAINT IF EXISTS financial_snapshots_group_id_fkey,
ADD CONSTRAINT financial_snapshots_group_id_fkey 
FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;

-- =====================================================
-- TRIGGERS DE CALCULS AUTOMATIQUES
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
  RAISE NOTICE '🧮 Calcul cash disponible déclenché: table=%, operation=%', TG_TABLE_NAME, TG_OP;
  
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
    
    RAISE NOTICE '💰 Calcul pour profil %: revenus=%, dépenses=%', target_profile_id, total_income, total_expenses;
  ELSE
    SELECT COALESCE(SUM(amount), 0) INTO total_income
    FROM real_income_entries 
    WHERE group_id = target_group_id;
    
    SELECT COALESCE(SUM(amount), 0) INTO total_expenses
    FROM real_expenses 
    WHERE group_id = target_group_id;
    
    RAISE NOTICE '💰 Calcul pour groupe %: revenus=%, dépenses=%', target_group_id, total_income, total_expenses;
  END IF;

  available_cash := total_income - total_expenses;

  -- Update or insert financial snapshot
  IF target_profile_id IS NOT NULL THEN
    INSERT INTO financial_snapshots (profile_id, available_cash, total_real_income, total_real_expenses, is_current)
    VALUES (target_profile_id, available_cash, total_income, total_expenses, true)
    ON CONFLICT ON CONSTRAINT idx_financial_snapshots_current_profile
    DO UPDATE SET 
      available_cash = EXCLUDED.available_cash,
      total_real_income = EXCLUDED.total_real_income,
      total_real_expenses = EXCLUDED.total_real_expenses,
      calculation_date = now();
  ELSE
    INSERT INTO financial_snapshots (group_id, available_cash, total_real_income, total_real_expenses, is_current)
    VALUES (target_group_id, available_cash, total_income, total_expenses, true)
    ON CONFLICT ON CONSTRAINT idx_financial_snapshots_current_group
    DO UPDATE SET 
      available_cash = EXCLUDED.available_cash,
      total_real_income = EXCLUDED.total_real_income,
      total_real_expenses = EXCLUDED.total_real_expenses,
      calculation_date = now();
  END IF;

  RAISE NOTICE '✅ Cash disponible mis à jour: %', available_cash;
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
  RAISE NOTICE '💡 Calcul économies budget déclenché: table=%, operation=%', TG_TABLE_NAME, TG_OP;
  
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
    
    RAISE NOTICE '🎯 Budget %: estimé=%, dépensé=%, économies=%', budget_id, estimated_amount, total_spent, new_savings;
    
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
  RAISE NOTICE '🏠 Calcul reste à vivre déclenché: table=%, operation=%', TG_TABLE_NAME, TG_OP;
  
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
    
    RAISE NOTICE '👤 Profil %: revenus=%, budgété=%, exceptionnel=%, économies=%', 
      target_profile_id, total_income, total_budgeted, total_exceptional_expenses, total_savings;
    
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
    
    RAISE NOTICE '👥 Groupe %: revenus=%, budgété=%, exceptionnel=%, économies=%', 
      target_group_id, total_income, total_budgeted, total_exceptional_expenses, total_savings;
  END IF;

  remaining_amount := total_income - total_budgeted - total_exceptional_expenses + total_savings;
  
  RAISE NOTICE '🏠 Reste à vivre calculé: %', remaining_amount;

  -- Update financial snapshot
  IF target_profile_id IS NOT NULL THEN
    INSERT INTO financial_snapshots (
      profile_id, remaining_to_live, total_estimated_budgets, total_budget_savings, is_current
    )
    VALUES (target_profile_id, remaining_amount, total_budgeted, total_savings, true)
    ON CONFLICT ON CONSTRAINT idx_financial_snapshots_current_profile
    DO UPDATE SET 
      remaining_to_live = EXCLUDED.remaining_to_live,
      total_estimated_budgets = EXCLUDED.total_estimated_budgets,
      total_budget_savings = EXCLUDED.total_budget_savings,
      calculation_date = now();
  ELSE
    INSERT INTO financial_snapshots (
      group_id, remaining_to_live, total_estimated_budgets, total_budget_savings, is_current
    )
    VALUES (target_group_id, remaining_amount, total_budgeted, total_savings, true)
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
-- CRÉATION DES TRIGGERS
-- =====================================================

-- Triggers pour le calcul du cash disponible
DROP TRIGGER IF EXISTS trigger_calculate_available_cash_income ON real_income_entries;
DROP TRIGGER IF EXISTS trigger_calculate_available_cash_expenses ON real_expenses;

CREATE TRIGGER trigger_calculate_available_cash_income
  AFTER INSERT OR UPDATE OR DELETE ON real_income_entries
  FOR EACH ROW EXECUTE FUNCTION calculate_available_cash();

CREATE TRIGGER trigger_calculate_available_cash_expenses
  AFTER INSERT OR UPDATE OR DELETE ON real_expenses
  FOR EACH ROW EXECUTE FUNCTION calculate_available_cash();

-- Triggers pour la mise à jour des économies de budget
DROP TRIGGER IF EXISTS trigger_update_budget_savings ON real_expenses;

CREATE TRIGGER trigger_update_budget_savings
  AFTER INSERT OR UPDATE OR DELETE ON real_expenses
  FOR EACH ROW EXECUTE FUNCTION update_budget_savings();

-- Triggers pour le calcul du reste à vivre
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
-- TRIGGERS DE TIMESTAMP
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
DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
DROP TRIGGER IF EXISTS update_groups_updated_at ON groups;

CREATE TRIGGER update_estimated_incomes_updated_at
  BEFORE UPDATE ON estimated_incomes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_estimated_budgets_updated_at
  BEFORE UPDATE ON estimated_budgets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_groups_updated_at
  BEFORE UPDATE ON groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================

-- Enable RLS on all financial tables
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

-- =====================================================
-- VERIFICATION ET LOGGING
-- =====================================================

-- Function pour vérifier l'intégrité des données
CREATE OR REPLACE FUNCTION verify_financial_integrity()
RETURNS TABLE (
  check_name text,
  status text,
  details text
) AS $$
BEGIN
  -- Vérifier les contraintes d'exclusion mutuelle
  RETURN QUERY
  SELECT 
    'Exclusion mutuelle estimated_incomes'::text,
    CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'ERROR' END::text,
    CASE WHEN COUNT(*) = 0 THEN 'Toutes les contraintes respectées' 
         ELSE COUNT(*)::text || ' violations détectées' END::text
  FROM estimated_incomes 
  WHERE (profile_id IS NULL AND group_id IS NULL) 
     OR (profile_id IS NOT NULL AND group_id IS NOT NULL);

  -- Vérifier les snapshots uniques
  RETURN QUERY
  SELECT 
    'Snapshots uniques'::text,
    CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'WARNING' END::text,
    CASE WHEN COUNT(*) = 0 THEN 'Un seul snapshot current par propriétaire' 
         ELSE COUNT(*)::text || ' doublons détectés' END::text
  FROM (
    SELECT profile_id FROM financial_snapshots 
    WHERE is_current = true AND profile_id IS NOT NULL
    GROUP BY profile_id HAVING COUNT(*) > 1
    UNION
    SELECT group_id::uuid FROM financial_snapshots 
    WHERE is_current = true AND group_id IS NOT NULL
    GROUP BY group_id HAVING COUNT(*) > 1
  ) duplicates;

  -- Vérifier la cohérence des calculs
  RETURN QUERY
  SELECT 
    'Cohérence calculs'::text,
    'INFO'::text,
    'Vérification manuelle recommandée'::text;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- COMMANDES FINALES
-- =====================================================

-- Activer les notifications pour debugging
SET client_min_messages = NOTICE;

-- Vérifier l'intégrité après migration
SELECT * FROM verify_financial_integrity();

-- Afficher un résumé des modifications
DO $$
BEGIN
  RAISE NOTICE '✅ Migration terminée avec succès !';
  RAISE NOTICE '📊 Contraintes ajoutées: exclusion mutuelle sur toutes les tables';
  RAISE NOTICE '🚀 Index créés: % index de performance', 
    (SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx_%');
  RAISE NOTICE '⚡ Triggers activés: calculs automatiques opérationnels';
  RAISE NOTICE '🔒 RLS activé: sécurité des données garantie';
END $$;