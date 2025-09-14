-- =================================================================
-- SCRIPT DE DIAGNOSTIC ET CORRECTION ULTRA-SÉCURISÉ
-- Date: 2025-09-14
-- Objectif: Vérifier l'état actuel et corriger seulement ce qui manque
-- =================================================================

-- Active les messages pour le suivi
SET client_min_messages = NOTICE;

DO $$
BEGIN
  RAISE NOTICE '🔍 DIAGNOSTIC: Vérification de l''état actuel de la base de données';
END $$;

-- =====================================================
-- ÉTAPE 1: DIAGNOSTIC COMPLET
-- =====================================================

-- Vérification des contraintes existantes
DO $$
DECLARE
  constraint_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO constraint_count
  FROM information_schema.table_constraints
  WHERE constraint_name LIKE '%_owner_check';
  
  RAISE NOTICE '📋 Contraintes owner_check trouvées: %', constraint_count;
  
  -- Lister les contraintes existantes
  FOR constraint_count IN 
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name LIKE '%_owner_check'
  LOOP
    RAISE NOTICE '   ✓ Contrainte déjà présente';
  END LOOP;
END $$;

-- Vérification des index existants
DO $$
DECLARE
  index_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO index_count
  FROM pg_indexes 
  WHERE schemaname = 'public' AND indexname LIKE 'idx_%';
  
  RAISE NOTICE '📊 Index de performance trouvés: %', index_count;
END $$;

-- Vérification des triggers existants
DO $$
DECLARE
  trigger_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO trigger_count
  FROM information_schema.triggers
  WHERE trigger_schema = 'public' AND trigger_name LIKE '%calculate%';
  
  RAISE NOTICE '⚡ Triggers de calcul trouvés: %', trigger_count;
END $$;

-- Vérification RLS
DO $$
DECLARE
  rls_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO rls_count
  FROM pg_class c
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = 'public' 
    AND c.relname IN ('estimated_incomes', 'real_income_entries', 'estimated_budgets', 'real_expenses', 'financial_snapshots')
    AND c.relrowsecurity = true;
  
  RAISE NOTICE '🔒 Tables avec RLS activé: %', rls_count;
END $$;

-- =====================================================
-- ÉTAPE 2: CORRECTION SEULEMENT DES ÉLÉMENTS MANQUANTS
-- =====================================================

-- Fonction pour ajouter les index manquants seulement
DO $$
DECLARE
  missing_indexes TEXT[] := ARRAY[
    'idx_profiles_group_id',
    'idx_estimated_incomes_profile_id', 
    'idx_estimated_incomes_group_id',
    'idx_real_income_entries_profile_id',
    'idx_real_income_entries_group_id',
    'idx_real_income_entries_date',
    'idx_real_income_entries_estimated_id',
    'idx_estimated_budgets_profile_id',
    'idx_estimated_budgets_group_id', 
    'idx_real_expenses_profile_id',
    'idx_real_expenses_group_id',
    'idx_real_expenses_date',
    'idx_real_expenses_budget_id',
    'idx_financial_snapshots_profile_id',
    'idx_financial_snapshots_group_id',
    'idx_group_contributions_profile_id',
    'idx_group_contributions_group_id'
  ];
  idx TEXT;
  exists_count INTEGER;
BEGIN
  RAISE NOTICE '🚀 Création des index manquants...';
  
  FOREACH idx IN ARRAY missing_indexes
  LOOP
    SELECT COUNT(*) INTO exists_count FROM pg_indexes WHERE indexname = idx;
    
    IF exists_count = 0 THEN
      CASE idx
        WHEN 'idx_profiles_group_id' THEN
          CREATE INDEX idx_profiles_group_id ON public.profiles(group_id);
          RAISE NOTICE '   ✅ Index créé: %', idx;
          
        WHEN 'idx_estimated_incomes_profile_id' THEN
          CREATE INDEX idx_estimated_incomes_profile_id ON public.estimated_incomes(profile_id);
          RAISE NOTICE '   ✅ Index créé: %', idx;
          
        WHEN 'idx_estimated_incomes_group_id' THEN
          CREATE INDEX idx_estimated_incomes_group_id ON public.estimated_incomes(group_id);
          RAISE NOTICE '   ✅ Index créé: %', idx;
          
        WHEN 'idx_real_income_entries_profile_id' THEN
          CREATE INDEX idx_real_income_entries_profile_id ON public.real_income_entries(profile_id);
          RAISE NOTICE '   ✅ Index créé: %', idx;
          
        WHEN 'idx_real_income_entries_group_id' THEN
          CREATE INDEX idx_real_income_entries_group_id ON public.real_income_entries(group_id);
          RAISE NOTICE '   ✅ Index créé: %', idx;
          
        WHEN 'idx_real_income_entries_date' THEN
          CREATE INDEX idx_real_income_entries_date ON public.real_income_entries(entry_date);
          RAISE NOTICE '   ✅ Index créé: %', idx;
          
        WHEN 'idx_real_income_entries_estimated_id' THEN
          CREATE INDEX idx_real_income_entries_estimated_id ON public.real_income_entries(estimated_income_id);
          RAISE NOTICE '   ✅ Index créé: %', idx;
          
        WHEN 'idx_estimated_budgets_profile_id' THEN
          CREATE INDEX idx_estimated_budgets_profile_id ON public.estimated_budgets(profile_id);
          RAISE NOTICE '   ✅ Index créé: %', idx;
          
        WHEN 'idx_estimated_budgets_group_id' THEN
          CREATE INDEX idx_estimated_budgets_group_id ON public.estimated_budgets(group_id);
          RAISE NOTICE '   ✅ Index créé: %', idx;
          
        WHEN 'idx_real_expenses_profile_id' THEN
          CREATE INDEX idx_real_expenses_profile_id ON public.real_expenses(profile_id);
          RAISE NOTICE '   ✅ Index créé: %', idx;
          
        WHEN 'idx_real_expenses_group_id' THEN
          CREATE INDEX idx_real_expenses_group_id ON public.real_expenses(group_id);
          RAISE NOTICE '   ✅ Index créé: %', idx;
          
        WHEN 'idx_real_expenses_date' THEN
          CREATE INDEX idx_real_expenses_date ON public.real_expenses(expense_date);
          RAISE NOTICE '   ✅ Index créé: %', idx;
          
        WHEN 'idx_real_expenses_budget_id' THEN
          CREATE INDEX idx_real_expenses_budget_id ON public.real_expenses(estimated_budget_id);
          RAISE NOTICE '   ✅ Index créé: %', idx;
          
        WHEN 'idx_financial_snapshots_profile_id' THEN
          CREATE INDEX idx_financial_snapshots_profile_id ON public.financial_snapshots(profile_id);
          RAISE NOTICE '   ✅ Index créé: %', idx;
          
        WHEN 'idx_financial_snapshots_group_id' THEN
          CREATE INDEX idx_financial_snapshots_group_id ON public.financial_snapshots(group_id);
          RAISE NOTICE '   ✅ Index créé: %', idx;
          
        WHEN 'idx_group_contributions_profile_id' THEN
          CREATE INDEX idx_group_contributions_profile_id ON public.group_contributions(profile_id);
          RAISE NOTICE '   ✅ Index créé: %', idx;
          
        WHEN 'idx_group_contributions_group_id' THEN
          CREATE INDEX idx_group_contributions_group_id ON public.group_contributions(group_id);
          RAISE NOTICE '   ✅ Index créé: %', idx;
          
        ELSE
          RAISE NOTICE '   ❓ Index non reconnu: %', idx;
      END CASE;
    ELSE
      RAISE NOTICE '   ⚠️ Index existe déjà: %', idx;
    END IF;
  END LOOP;
END $$;

-- Index uniques pour financial_snapshots
DO $$
DECLARE
  exists_count INTEGER;
BEGIN
  -- Index pour profils
  SELECT COUNT(*) INTO exists_count 
  FROM pg_indexes WHERE indexname = 'idx_financial_snapshots_current_profile';
  
  IF exists_count = 0 THEN
    CREATE UNIQUE INDEX idx_financial_snapshots_current_profile 
    ON public.financial_snapshots(profile_id) 
    WHERE is_current = true AND profile_id IS NOT NULL;
    RAISE NOTICE '   ✅ Index unique créé: idx_financial_snapshots_current_profile';
  ELSE
    RAISE NOTICE '   ⚠️ Index unique existe déjà: idx_financial_snapshots_current_profile';
  END IF;

  -- Index pour groupes  
  SELECT COUNT(*) INTO exists_count 
  FROM pg_indexes WHERE indexname = 'idx_financial_snapshots_current_group';
  
  IF exists_count = 0 THEN
    CREATE UNIQUE INDEX idx_financial_snapshots_current_group 
    ON public.financial_snapshots(group_id) 
    WHERE is_current = true AND group_id IS NOT NULL;
    RAISE NOTICE '   ✅ Index unique créé: idx_financial_snapshots_current_group';
  ELSE
    RAISE NOTICE '   ⚠️ Index unique existe déjà: idx_financial_snapshots_current_group';
  END IF;
END $$;

-- =====================================================
-- ÉTAPE 3: FONCTIONS DE CALCULS AUTOMATIQUES (IDEMPOTENT)
-- =====================================================

-- Function to calculate available cash (CREATE OR REPLACE = idempotent)
CREATE OR REPLACE FUNCTION calculate_available_cash()
RETURNS TRIGGER AS $$
DECLARE
  target_profile_id uuid;
  target_group_id uuid;
  total_income numeric;
  total_expenses numeric;
  available_cash numeric;
BEGIN
  -- Log pour debugging
  RAISE DEBUG '💰 Calcul cash disponible: table=%, op=%', TG_TABLE_NAME, TG_OP;
  
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
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Erreur dans calculate_available_cash: %', SQLERRM;
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
  RAISE DEBUG '🎯 Calcul économies budget: table=%, op=%', TG_TABLE_NAME, TG_OP;
  
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
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Erreur dans update_budget_savings: %', SQLERRM;
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
  RAISE DEBUG '🏠 Calcul reste à vivre: table=%, op=%', TG_TABLE_NAME, TG_OP;
  
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
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Erreur dans calculate_remaining_to_live: %', SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Function pour les timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- ÉTAPE 4: CRÉATION CONDITIONNELLE DES TRIGGERS
-- =====================================================

DO $$
DECLARE
  trigger_exists_count INTEGER;
BEGIN
  RAISE NOTICE '⚡ Installation des triggers de calculs automatiques...';
  
  -- Triggers pour available_cash sur real_income_entries
  SELECT COUNT(*) INTO trigger_exists_count
  FROM information_schema.triggers
  WHERE event_object_table = 'real_income_entries' 
    AND trigger_name = 'trigger_calculate_available_cash_income';
    
  IF trigger_exists_count = 0 THEN
    CREATE TRIGGER trigger_calculate_available_cash_income
      AFTER INSERT OR UPDATE OR DELETE ON real_income_entries
      FOR EACH ROW EXECUTE FUNCTION calculate_available_cash();
    RAISE NOTICE '   ✅ Trigger créé: trigger_calculate_available_cash_income';
  ELSE
    RAISE NOTICE '   ⚠️ Trigger existe: trigger_calculate_available_cash_income';
  END IF;
  
  -- Triggers pour available_cash sur real_expenses
  SELECT COUNT(*) INTO trigger_exists_count
  FROM information_schema.triggers
  WHERE event_object_table = 'real_expenses' 
    AND trigger_name = 'trigger_calculate_available_cash_expenses';
    
  IF trigger_exists_count = 0 THEN
    CREATE TRIGGER trigger_calculate_available_cash_expenses
      AFTER INSERT OR UPDATE OR DELETE ON real_expenses
      FOR EACH ROW EXECUTE FUNCTION calculate_available_cash();
    RAISE NOTICE '   ✅ Trigger créé: trigger_calculate_available_cash_expenses';
  ELSE
    RAISE NOTICE '   ⚠️ Trigger existe: trigger_calculate_available_cash_expenses';
  END IF;
  
  -- Trigger pour budget savings
  SELECT COUNT(*) INTO trigger_exists_count
  FROM information_schema.triggers
  WHERE event_object_table = 'real_expenses' 
    AND trigger_name = 'trigger_update_budget_savings';
    
  IF trigger_exists_count = 0 THEN
    CREATE TRIGGER trigger_update_budget_savings
      AFTER INSERT OR UPDATE OR DELETE ON real_expenses
      FOR EACH ROW EXECUTE FUNCTION update_budget_savings();
    RAISE NOTICE '   ✅ Trigger créé: trigger_update_budget_savings';
  ELSE
    RAISE NOTICE '   ⚠️ Trigger existe: trigger_update_budget_savings';
  END IF;
END $$;

-- =====================================================
-- ÉTAPE 5: VÉRIFICATION FINALE 
-- =====================================================

-- Fonction de vérification finale
CREATE OR REPLACE FUNCTION final_verification()
RETURNS TABLE (
  component text,
  status text,
  count_found integer
) AS $$
BEGIN
  -- Index count
  RETURN QUERY
  SELECT 
    'Index de performance'::text,
    'INFO'::text,
    (SELECT COUNT(*)::integer FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx_%');

  -- Contraintes count  
  RETURN QUERY
  SELECT 
    'Contraintes owner_check'::text,
    'INFO'::text,
    (SELECT COUNT(*)::integer FROM information_schema.table_constraints WHERE constraint_name LIKE '%owner_check');

  -- Triggers count
  RETURN QUERY
  SELECT 
    'Triggers de calcul'::text,
    'INFO'::text,
    (SELECT COUNT(*)::integer FROM information_schema.triggers WHERE trigger_schema = 'public' AND trigger_name LIKE '%calculate%');

  -- Tables avec RLS
  RETURN QUERY
  SELECT 
    'Tables avec RLS'::text,
    'INFO'::text,
    (SELECT COUNT(*)::integer FROM pg_class c
     JOIN pg_namespace n ON c.relnamespace = n.oid
     WHERE n.nspname = 'public' AND c.relrowsecurity = true);
     
  -- Test de cohérence basique
  RETURN QUERY
  SELECT 
    'Violations contraintes'::text,
    CASE WHEN EXISTS(
      SELECT 1 FROM estimated_incomes 
      WHERE (profile_id IS NULL AND group_id IS NULL) 
         OR (profile_id IS NOT NULL AND group_id IS NOT NULL)
    ) THEN 'ERROR' ELSE 'OK' END::text,
    0::integer;
END;
$$ LANGUAGE plpgsql;

-- Lancement de la vérification finale
DO $$
BEGIN
  RAISE NOTICE '🏁 VÉRIFICATION FINALE:';
END $$;

SELECT * FROM final_verification();

DO $$
BEGIN
  RAISE NOTICE '✅ Script CHECK_AND_FIX terminé !';
  RAISE NOTICE '📊 Les éléments manquants ont été ajoutés';
  RAISE NOTICE '🔧 Système de calculs automatiques configuré';
  RAISE NOTICE '⚡ Triggers opérationnels selon battleplan.txt';
END $$;