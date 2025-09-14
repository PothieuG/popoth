-- =================================================================
-- MIGRATION SÉCURISÉE: Corrections Schema Financier
-- Date: 2025-09-14
-- Objectif: Ajouter éléments manquants sans erreurs de doublon
-- =================================================================

-- Active les messages informatifs
SET client_min_messages = NOTICE;

DO $$
BEGIN
  RAISE NOTICE '🚀 Début de la migration sécurisée du schema financier';
END $$;

-- =====================================================
-- FONCTION UTILITAIRE POUR VÉRIFICATIONS
-- =====================================================

CREATE OR REPLACE FUNCTION constraint_exists(table_name text, constraint_name text)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = $2 AND table_name = $1
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION index_exists(index_name text)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = $1
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trigger_exists(table_name text, trigger_name text)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE event_object_table = $1 AND trigger_name = $2
  );
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- CONTRAINTES D'EXCLUSION MUTUELLE (CONDITIONNELLES)
-- =====================================================

-- estimated_incomes
DO $$
BEGIN
  IF NOT constraint_exists('estimated_incomes', 'estimated_incomes_owner_check') THEN
    ALTER TABLE public.estimated_incomes 
    ADD CONSTRAINT estimated_incomes_owner_check 
    CHECK ((profile_id IS NOT NULL AND group_id IS NULL) OR (profile_id IS NULL AND group_id IS NOT NULL));
    RAISE NOTICE '✅ Contrainte estimated_incomes_owner_check ajoutée';
  ELSE
    RAISE NOTICE '⚠️ Contrainte estimated_incomes_owner_check existe déjà';
  END IF;
END $$;

-- estimated_budgets
DO $$
BEGIN
  IF NOT constraint_exists('estimated_budgets', 'estimated_budgets_owner_check') THEN
    ALTER TABLE public.estimated_budgets
    ADD CONSTRAINT estimated_budgets_owner_check
    CHECK ((profile_id IS NOT NULL AND group_id IS NULL) OR (profile_id IS NULL AND group_id IS NOT NULL));
    RAISE NOTICE '✅ Contrainte estimated_budgets_owner_check ajoutée';
  ELSE
    RAISE NOTICE '⚠️ Contrainte estimated_budgets_owner_check existe déjà';
  END IF;
END $$;

-- real_income_entries
DO $$
BEGIN
  IF NOT constraint_exists('real_income_entries', 'real_income_entries_owner_check') THEN
    ALTER TABLE public.real_income_entries
    ADD CONSTRAINT real_income_entries_owner_check
    CHECK ((profile_id IS NOT NULL AND group_id IS NULL) OR (profile_id IS NULL AND group_id IS NOT NULL));
    RAISE NOTICE '✅ Contrainte real_income_entries_owner_check ajoutée';
  ELSE
    RAISE NOTICE '⚠️ Contrainte real_income_entries_owner_check existe déjà';
  END IF;
END $$;

-- real_expenses
DO $$
BEGIN
  IF NOT constraint_exists('real_expenses', 'real_expenses_owner_check') THEN
    ALTER TABLE public.real_expenses
    ADD CONSTRAINT real_expenses_owner_check
    CHECK ((profile_id IS NOT NULL AND group_id IS NULL) OR (profile_id IS NULL AND group_id IS NOT NULL));
    RAISE NOTICE '✅ Contrainte real_expenses_owner_check ajoutée';
  ELSE
    RAISE NOTICE '⚠️ Contrainte real_expenses_owner_check existe déjà';
  END IF;
END $$;

-- financial_snapshots
DO $$
BEGIN
  IF NOT constraint_exists('financial_snapshots', 'financial_snapshots_owner_check') THEN
    ALTER TABLE public.financial_snapshots
    ADD CONSTRAINT financial_snapshots_owner_check
    CHECK ((profile_id IS NOT NULL AND group_id IS NULL) OR (profile_id IS NULL AND group_id IS NOT NULL));
    RAISE NOTICE '✅ Contrainte financial_snapshots_owner_check ajoutée';
  ELSE
    RAISE NOTICE '⚠️ Contrainte financial_snapshots_owner_check existe déjà';
  END IF;
END $$;

-- =====================================================
-- INDEX DE PERFORMANCE (CONDITIONNELS)
-- =====================================================

-- Fonction pour créer un index seulement s'il n'existe pas
CREATE OR REPLACE FUNCTION create_index_if_not_exists(index_name text, table_name text, columns text)
RETURNS void AS $$
BEGIN
  IF NOT index_exists(index_name) THEN
    EXECUTE format('CREATE INDEX %I ON %s(%s)', index_name, table_name, columns);
    RAISE NOTICE '✅ Index % créé', index_name;
  ELSE
    RAISE NOTICE '⚠️ Index % existe déjà', index_name;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Création des index
SELECT create_index_if_not_exists('idx_profiles_group_id', 'public.profiles', 'group_id');
SELECT create_index_if_not_exists('idx_estimated_incomes_profile_id', 'public.estimated_incomes', 'profile_id');
SELECT create_index_if_not_exists('idx_estimated_incomes_group_id', 'public.estimated_incomes', 'group_id');
SELECT create_index_if_not_exists('idx_real_income_entries_profile_id', 'public.real_income_entries', 'profile_id');
SELECT create_index_if_not_exists('idx_real_income_entries_group_id', 'public.real_income_entries', 'group_id');
SELECT create_index_if_not_exists('idx_real_income_entries_date', 'public.real_income_entries', 'entry_date');
SELECT create_index_if_not_exists('idx_real_income_entries_estimated_id', 'public.real_income_entries', 'estimated_income_id');
SELECT create_index_if_not_exists('idx_estimated_budgets_profile_id', 'public.estimated_budgets', 'profile_id');
SELECT create_index_if_not_exists('idx_estimated_budgets_group_id', 'public.estimated_budgets', 'group_id');
SELECT create_index_if_not_exists('idx_real_expenses_profile_id', 'public.real_expenses', 'profile_id');
SELECT create_index_if_not_exists('idx_real_expenses_group_id', 'public.real_expenses', 'group_id');
SELECT create_index_if_not_exists('idx_real_expenses_date', 'public.real_expenses', 'expense_date');
SELECT create_index_if_not_exists('idx_real_expenses_budget_id', 'public.real_expenses', 'estimated_budget_id');
SELECT create_index_if_not_exists('idx_financial_snapshots_profile_id', 'public.financial_snapshots', 'profile_id');
SELECT create_index_if_not_exists('idx_financial_snapshots_group_id', 'public.financial_snapshots', 'group_id');
SELECT create_index_if_not_exists('idx_group_contributions_profile_id', 'public.group_contributions', 'profile_id');
SELECT create_index_if_not_exists('idx_group_contributions_group_id', 'public.group_contributions', 'group_id');

-- Index uniques pour snapshots (plus complexe)
DO $$
BEGIN
  IF NOT index_exists('idx_financial_snapshots_current_profile') THEN
    CREATE UNIQUE INDEX idx_financial_snapshots_current_profile 
    ON public.financial_snapshots(profile_id) 
    WHERE is_current = true AND profile_id IS NOT NULL;
    RAISE NOTICE '✅ Index unique idx_financial_snapshots_current_profile créé';
  ELSE
    RAISE NOTICE '⚠️ Index idx_financial_snapshots_current_profile existe déjà';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT index_exists('idx_financial_snapshots_current_group') THEN
    CREATE UNIQUE INDEX idx_financial_snapshots_current_group 
    ON public.financial_snapshots(group_id) 
    WHERE is_current = true AND group_id IS NOT NULL;
    RAISE NOTICE '✅ Index unique idx_financial_snapshots_current_group créé';
  ELSE
    RAISE NOTICE '⚠️ Index idx_financial_snapshots_current_group existe déjà';
  END IF;
END $$;

-- =====================================================
-- TRIGGERS DE CALCULS AUTOMATIQUES
-- =====================================================

-- Function to calculate available cash
CREATE OR REPLACE FUNCTION calculate_available_cash()
RETURNS TRIGGER AS $$
DECLARE
  target_profile_id uuid;
  target_group_id uuid;
  total_income numeric;
  total_expenses numeric;
  available_cash numeric;
BEGIN
  -- Determine target owner
  target_profile_id := COALESCE(NEW.profile_id, OLD.profile_id);
  target_group_id := COALESCE(NEW.group_id, OLD.group_id);

  -- Calculate totals based on owner type
  IF target_profile_id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0) INTO total_income
    FROM real_income_entries WHERE profile_id = target_profile_id;
    
    SELECT COALESCE(SUM(amount), 0) INTO total_expenses
    FROM real_expenses WHERE profile_id = target_profile_id;
  ELSE
    SELECT COALESCE(SUM(amount), 0) INTO total_income
    FROM real_income_entries WHERE group_id = target_group_id;
    
    SELECT COALESCE(SUM(amount), 0) INTO total_expenses
    FROM real_expenses WHERE group_id = target_group_id;
  END IF;

  available_cash := total_income - total_expenses;

  -- Update or insert financial snapshot
  IF target_profile_id IS NOT NULL THEN
    INSERT INTO financial_snapshots (profile_id, available_cash, total_real_income, total_real_expenses, is_current)
    VALUES (target_profile_id, available_cash, total_income, total_expenses, true)
    ON CONFLICT (profile_id) WHERE (is_current = true AND profile_id IS NOT NULL)
    DO UPDATE SET 
      available_cash = EXCLUDED.available_cash,
      total_real_income = EXCLUDED.total_real_income,
      total_real_expenses = EXCLUDED.total_real_expenses,
      calculation_date = now();
  ELSE
    INSERT INTO financial_snapshots (group_id, available_cash, total_real_income, total_real_expenses, is_current)
    VALUES (target_group_id, available_cash, total_income, total_expenses, true)
    ON CONFLICT (group_id) WHERE (is_current = true AND group_id IS NOT NULL)
    DO UPDATE SET 
      available_cash = EXCLUDED.available_cash,
      total_real_income = EXCLUDED.total_real_income,
      total_real_expenses = EXCLUDED.total_real_expenses,
      calculation_date = now();
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Function to update budget savings
CREATE OR REPLACE FUNCTION update_budget_savings()
RETURNS TRIGGER AS $$
DECLARE
  budget_id uuid;
  total_spent numeric;
  estimated_amount numeric;
  new_savings numeric;
BEGIN
  budget_id := COALESCE(NEW.estimated_budget_id, OLD.estimated_budget_id);
  
  IF budget_id IS NOT NULL THEN
    -- Calculate total spent for this budget this month
    SELECT COALESCE(SUM(amount), 0) INTO total_spent
    FROM real_expenses 
    WHERE estimated_budget_id = budget_id 
      AND EXTRACT(YEAR FROM expense_date) = EXTRACT(YEAR FROM CURRENT_DATE)
      AND EXTRACT(MONTH FROM expense_date) = EXTRACT(MONTH FROM CURRENT_DATE);
    
    -- Get the estimated amount
    SELECT estimated_budgets.estimated_amount INTO estimated_amount
    FROM estimated_budgets WHERE id = budget_id;
    
    -- Calculate savings
    new_savings := GREATEST(0, estimated_amount - total_spent);
    
    -- Update the budget
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
  -- Determine target
  IF TG_TABLE_NAME IN ('real_income_entries', 'real_expenses') THEN
    target_profile_id := COALESCE(NEW.profile_id, OLD.profile_id);
    target_group_id := COALESCE(NEW.group_id, OLD.group_id);
  ELSIF TG_TABLE_NAME = 'estimated_budgets' THEN
    target_profile_id := COALESCE(NEW.profile_id, OLD.profile_id);
    target_group_id := COALESCE(NEW.group_id, OLD.group_id);
  END IF;

  IF target_profile_id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0) INTO total_income
    FROM real_income_entries WHERE profile_id = target_profile_id;
    
    SELECT COALESCE(SUM(estimated_amount), 0) INTO total_budgeted
    FROM estimated_budgets WHERE profile_id = target_profile_id;
    
    SELECT COALESCE(SUM(amount), 0) INTO total_exceptional_expenses
    FROM real_expenses WHERE profile_id = target_profile_id AND is_exceptional = true;
    
    SELECT COALESCE(SUM(current_savings), 0) INTO total_savings
    FROM estimated_budgets WHERE profile_id = target_profile_id;
  ELSE
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
    INSERT INTO financial_snapshots (profile_id, remaining_to_live, total_estimated_budgets, total_budget_savings, is_current)
    VALUES (target_profile_id, remaining_amount, total_budgeted, total_savings, true)
    ON CONFLICT (profile_id) WHERE (is_current = true AND profile_id IS NOT NULL)
    DO UPDATE SET 
      remaining_to_live = EXCLUDED.remaining_to_live,
      total_estimated_budgets = EXCLUDED.total_estimated_budgets,
      total_budget_savings = EXCLUDED.total_budget_savings,
      calculation_date = now();
  ELSE
    INSERT INTO financial_snapshots (group_id, remaining_to_live, total_estimated_budgets, total_budget_savings, is_current)
    VALUES (target_group_id, remaining_amount, total_budgeted, total_savings, true)
    ON CONFLICT (group_id) WHERE (is_current = true AND group_id IS NOT NULL)
    DO UPDATE SET 
      remaining_to_live = EXCLUDED.remaining_to_live,
      total_estimated_budgets = EXCLUDED.total_estimated_budgets,
      total_budget_savings = EXCLUDED.total_budget_savings,
      calculation_date = now();
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Function for timestamp updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- CRÉATION DES TRIGGERS (CONDITIONNELLE)
-- =====================================================

-- Triggers pour available_cash
DO $$
BEGIN
  IF NOT trigger_exists('real_income_entries', 'trigger_calculate_available_cash_income') THEN
    CREATE TRIGGER trigger_calculate_available_cash_income
      AFTER INSERT OR UPDATE OR DELETE ON real_income_entries
      FOR EACH ROW EXECUTE FUNCTION calculate_available_cash();
    RAISE NOTICE '✅ Trigger calculate_available_cash_income créé';
  ELSE
    RAISE NOTICE '⚠️ Trigger calculate_available_cash_income existe déjà';
  END IF;

  IF NOT trigger_exists('real_expenses', 'trigger_calculate_available_cash_expenses') THEN
    CREATE TRIGGER trigger_calculate_available_cash_expenses
      AFTER INSERT OR UPDATE OR DELETE ON real_expenses
      FOR EACH ROW EXECUTE FUNCTION calculate_available_cash();
    RAISE NOTICE '✅ Trigger calculate_available_cash_expenses créé';
  ELSE
    RAISE NOTICE '⚠️ Trigger calculate_available_cash_expenses existe déjà';
  END IF;
END $$;

-- Trigger pour budget savings
DO $$
BEGIN
  IF NOT trigger_exists('real_expenses', 'trigger_update_budget_savings') THEN
    CREATE TRIGGER trigger_update_budget_savings
      AFTER INSERT OR UPDATE OR DELETE ON real_expenses
      FOR EACH ROW EXECUTE FUNCTION update_budget_savings();
    RAISE NOTICE '✅ Trigger update_budget_savings créé';
  ELSE
    RAISE NOTICE '⚠️ Trigger update_budget_savings existe déjà';
  END IF;
END $$;

-- Triggers pour remaining_to_live
DO $$
BEGIN
  IF NOT trigger_exists('real_income_entries', 'trigger_calculate_remaining_income') THEN
    CREATE TRIGGER trigger_calculate_remaining_income
      AFTER INSERT OR UPDATE OR DELETE ON real_income_entries
      FOR EACH ROW EXECUTE FUNCTION calculate_remaining_to_live();
    RAISE NOTICE '✅ Trigger calculate_remaining_income créé';
  ELSE
    RAISE NOTICE '⚠️ Trigger calculate_remaining_income existe déjà';
  END IF;

  IF NOT trigger_exists('real_expenses', 'trigger_calculate_remaining_expenses') THEN
    CREATE TRIGGER trigger_calculate_remaining_expenses
      AFTER INSERT OR UPDATE OR DELETE ON real_expenses
      FOR EACH ROW EXECUTE FUNCTION calculate_remaining_to_live();
    RAISE NOTICE '✅ Trigger calculate_remaining_expenses créé';
  ELSE
    RAISE NOTICE '⚠️ Trigger calculate_remaining_expenses existe déjà';
  END IF;

  IF NOT trigger_exists('estimated_budgets', 'trigger_calculate_remaining_budgets') THEN
    CREATE TRIGGER trigger_calculate_remaining_budgets
      AFTER INSERT OR UPDATE OR DELETE ON estimated_budgets
      FOR EACH ROW EXECUTE FUNCTION calculate_remaining_to_live();
    RAISE NOTICE '✅ Trigger calculate_remaining_budgets créé';
  ELSE
    RAISE NOTICE '⚠️ Trigger calculate_remaining_budgets existe déjà';
  END IF;
END $$;

-- Triggers pour timestamps
DO $$
BEGIN
  IF NOT trigger_exists('estimated_incomes', 'update_estimated_incomes_updated_at') THEN
    CREATE TRIGGER update_estimated_incomes_updated_at
      BEFORE UPDATE ON estimated_incomes
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    RAISE NOTICE '✅ Trigger update_estimated_incomes_updated_at créé';
  ELSE
    RAISE NOTICE '⚠️ Trigger update_estimated_incomes_updated_at existe déjà';
  END IF;

  IF NOT trigger_exists('estimated_budgets', 'update_estimated_budgets_updated_at') THEN
    CREATE TRIGGER update_estimated_budgets_updated_at
      BEFORE UPDATE ON estimated_budgets
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    RAISE NOTICE '✅ Trigger update_estimated_budgets_updated_at créé';
  ELSE
    RAISE NOTICE '⚠️ Trigger update_estimated_budgets_updated_at existe déjà';
  END IF;

  IF NOT trigger_exists('profiles', 'update_profiles_updated_at') THEN
    CREATE TRIGGER update_profiles_updated_at
      BEFORE UPDATE ON profiles
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    RAISE NOTICE '✅ Trigger update_profiles_updated_at créé';
  ELSE
    RAISE NOTICE '⚠️ Trigger update_profiles_updated_at existe déjà';
  END IF;

  IF NOT trigger_exists('groups', 'update_groups_updated_at') THEN
    CREATE TRIGGER update_groups_updated_at
      BEFORE UPDATE ON groups
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    RAISE NOTICE '✅ Trigger update_groups_updated_at créé';
  ELSE
    RAISE NOTICE '⚠️ Trigger update_groups_updated_at existe déjà';
  END IF;
END $$;

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

-- Fonction pour activer RLS conditionnellement
CREATE OR REPLACE FUNCTION enable_rls_if_not_enabled(table_name text)
RETURNS void AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE c.relname = table_name AND n.nspname = 'public' AND c.relrowsecurity = true
  ) THEN
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    RAISE NOTICE '✅ RLS activé sur table %', table_name;
  ELSE
    RAISE NOTICE '⚠️ RLS déjà activé sur table %', table_name;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Activer RLS sur toutes les tables financières
SELECT enable_rls_if_not_enabled('estimated_incomes');
SELECT enable_rls_if_not_enabled('real_income_entries');
SELECT enable_rls_if_not_enabled('estimated_budgets');
SELECT enable_rls_if_not_enabled('real_expenses');
SELECT enable_rls_if_not_enabled('financial_snapshots');

-- Fonction pour créer une politique si elle n'existe pas
CREATE OR REPLACE FUNCTION create_policy_if_not_exists(
  table_name text, 
  policy_name text, 
  policy_definition text
)
RETURNS void AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = table_name AND policyname = policy_name
  ) THEN
    EXECUTE format('CREATE POLICY %I ON public.%I %s', policy_name, table_name, policy_definition);
    RAISE NOTICE '✅ Politique % créée sur %', policy_name, table_name;
  ELSE
    RAISE NOTICE '⚠️ Politique % existe déjà sur %', policy_name, table_name;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Créer les politiques RLS
SELECT create_policy_if_not_exists(
  'estimated_incomes',
  'Users can manage their own estimated incomes',
  'FOR ALL USING (profile_id = auth.uid())'
);

SELECT create_policy_if_not_exists(
  'estimated_incomes',
  'Group members can manage group estimated incomes',
  'FOR ALL USING (group_id IS NOT NULL AND group_id IN (SELECT group_id FROM profiles WHERE id = auth.uid()))'
);

SELECT create_policy_if_not_exists(
  'real_income_entries',
  'Users can manage their own income entries',
  'FOR ALL USING (profile_id = auth.uid())'
);

SELECT create_policy_if_not_exists(
  'real_income_entries',
  'Group members can manage group income entries',
  'FOR ALL USING (group_id IS NOT NULL AND group_id IN (SELECT group_id FROM profiles WHERE id = auth.uid()))'
);

SELECT create_policy_if_not_exists(
  'estimated_budgets',
  'Users can manage their own budgets',
  'FOR ALL USING (profile_id = auth.uid())'
);

SELECT create_policy_if_not_exists(
  'estimated_budgets',
  'Group members can manage group budgets',
  'FOR ALL USING (group_id IS NOT NULL AND group_id IN (SELECT group_id FROM profiles WHERE id = auth.uid()))'
);

SELECT create_policy_if_not_exists(
  'real_expenses',
  'Users can manage their own expenses',
  'FOR ALL USING (profile_id = auth.uid())'
);

SELECT create_policy_if_not_exists(
  'real_expenses',
  'Group members can manage group expenses',
  'FOR ALL USING (group_id IS NOT NULL AND group_id IN (SELECT group_id FROM profiles WHERE id = auth.uid()))'
);

SELECT create_policy_if_not_exists(
  'financial_snapshots',
  'Users can view their own financial snapshots',
  'FOR SELECT USING (profile_id = auth.uid())'
);

SELECT create_policy_if_not_exists(
  'financial_snapshots',
  'Group members can view group financial snapshots',
  'FOR SELECT USING (group_id IS NOT NULL AND group_id IN (SELECT group_id FROM profiles WHERE id = auth.uid()))'
);

-- =====================================================
-- FONCTION DE VÉRIFICATION D'INTÉGRITÉ
-- =====================================================

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

  RETURN QUERY
  SELECT 
    'Exclusion mutuelle estimated_budgets'::text,
    CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'ERROR' END::text,
    CASE WHEN COUNT(*) = 0 THEN 'Toutes les contraintes respectées' 
         ELSE COUNT(*)::text || ' violations détectées' END::text
  FROM estimated_budgets 
  WHERE (profile_id IS NULL AND group_id IS NULL) 
     OR (profile_id IS NOT NULL AND group_id IS NOT NULL);

  RETURN QUERY
  SELECT 
    'Exclusion mutuelle real_income_entries'::text,
    CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'ERROR' END::text,
    CASE WHEN COUNT(*) = 0 THEN 'Toutes les contraintes respectées' 
         ELSE COUNT(*)::text || ' violations détectées' END::text
  FROM real_income_entries 
  WHERE (profile_id IS NULL AND group_id IS NULL) 
     OR (profile_id IS NOT NULL AND group_id IS NOT NULL);

  RETURN QUERY
  SELECT 
    'Exclusion mutuelle real_expenses'::text,
    CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'ERROR' END::text,
    CASE WHEN COUNT(*) = 0 THEN 'Toutes les contraintes respectées' 
         ELSE COUNT(*)::text || ' violations détectées' END::text
  FROM real_expenses 
  WHERE (profile_id IS NULL AND group_id IS NULL) 
     OR (profile_id IS NOT NULL AND group_id IS NOT NULL);

  RETURN QUERY
  SELECT 
    'Exclusion mutuelle financial_snapshots'::text,
    CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'ERROR' END::text,
    CASE WHEN COUNT(*) = 0 THEN 'Toutes les contraintes respectées' 
         ELSE COUNT(*)::text || ' violations détectées' END::text
  FROM financial_snapshots 
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

  RETURN QUERY
  SELECT 
    'Index performance'::text,
    'INFO'::text,
    (SELECT COUNT(*)::text || ' index créés' FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx_%')::text;

  RETURN QUERY
  SELECT 
    'Triggers calculs'::text,
    'INFO'::text,
    (SELECT COUNT(*)::text || ' triggers actifs' FROM information_schema.triggers WHERE trigger_schema = 'public')::text;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- NETTOYAGE ET VÉRIFICATION FINALE
-- =====================================================

-- Nettoyer les fonctions utilitaires
DROP FUNCTION IF EXISTS constraint_exists(text, text);
DROP FUNCTION IF EXISTS index_exists(text);
DROP FUNCTION IF EXISTS trigger_exists(text, text);
DROP FUNCTION IF EXISTS create_index_if_not_exists(text, text, text);
DROP FUNCTION IF EXISTS enable_rls_if_not_enabled(text);
DROP FUNCTION IF EXISTS create_policy_if_not_exists(text, text, text);

-- Vérification finale
DO $$
BEGIN
  RAISE NOTICE '🏁 Migration terminée ! Lancement de la vérification d''intégrité...';
END $$;

SELECT * FROM verify_financial_integrity();

DO $$
BEGIN
  RAISE NOTICE '✅ Migration sécurisée terminée avec succès !';
  RAISE NOTICE '📊 Toutes les contraintes, index, triggers et politiques RLS ont été configurés';
  RAISE NOTICE '🔧 Système de calculs automatiques opérationnel selon battleplan.txt';
END $$;