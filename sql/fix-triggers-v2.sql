-- Script pour corriger les erreurs de triggers - Version 2

-- 1. Supprimer tous les triggers existants pour éviter les conflits
DROP TRIGGER IF EXISTS update_financial_snapshot_trigger ON estimated_budgets;
DROP TRIGGER IF EXISTS update_financial_snapshot_trigger ON estimated_incomes;
DROP TRIGGER IF EXISTS update_financial_snapshot_trigger ON real_expenses;
DROP TRIGGER IF EXISTS update_financial_snapshot_trigger ON real_income_entries;

-- 2. Supprimer TOUTES les anciennes fonctions avec leurs signatures spécifiques
DROP FUNCTION IF EXISTS update_financial_snapshot();
DROP FUNCTION IF EXISTS trigger_update_financial_snapshot();
DROP FUNCTION IF EXISTS calculate_and_update_snapshot(UUID, UUID);
DROP FUNCTION IF EXISTS calculate_available_cash(UUID, UUID);
DROP FUNCTION IF EXISTS calculate_remaining_to_live(UUID, UUID);

-- 3. Créer la fonction de calcul du cash disponible
CREATE OR REPLACE FUNCTION calculate_available_cash(
  p_profile_id UUID DEFAULT NULL,
  p_group_id UUID DEFAULT NULL
)
RETURNS NUMERIC AS $$
DECLARE
  total_income NUMERIC := 0;
  total_expenses NUMERIC := 0;
BEGIN
  -- Calculer les revenus réels
  SELECT COALESCE(SUM(amount), 0)
  FROM real_income_entries
  WHERE (p_profile_id IS NOT NULL AND profile_id = p_profile_id)
     OR (p_group_id IS NOT NULL AND group_id = p_group_id)
  INTO total_income;

  -- Calculer les dépenses réelles
  SELECT COALESCE(SUM(amount), 0)
  FROM real_expenses
  WHERE (p_profile_id IS NOT NULL AND profile_id = p_profile_id)
     OR (p_group_id IS NOT NULL AND group_id = p_group_id)
  INTO total_expenses;

  RETURN total_income - total_expenses;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Erreur dans calculate_available_cash: %', SQLERRM;
    RETURN 0;
END;
$$ LANGUAGE plpgsql;

-- 4. Créer la fonction de calcul du reste à vivre
CREATE OR REPLACE FUNCTION calculate_remaining_to_live(
  p_profile_id UUID DEFAULT NULL,
  p_group_id UUID DEFAULT NULL
)
RETURNS NUMERIC AS $$
DECLARE
  total_estimated_income NUMERIC := 0;
  total_estimated_budgets NUMERIC := 0;
  total_exceptional_expenses NUMERIC := 0;
  total_savings NUMERIC := 0;
BEGIN
  -- Revenus estimés
  SELECT COALESCE(SUM(estimated_amount), 0)
  FROM estimated_incomes
  WHERE (p_profile_id IS NOT NULL AND profile_id = p_profile_id)
     OR (p_group_id IS NOT NULL AND group_id = p_group_id)
  INTO total_estimated_income;

  -- Budgets estimés
  SELECT COALESCE(SUM(estimated_amount), 0)
  FROM estimated_budgets
  WHERE (p_profile_id IS NOT NULL AND profile_id = p_profile_id)
     OR (p_group_id IS NOT NULL AND group_id = p_group_id)
  INTO total_estimated_budgets;

  -- Dépenses exceptionnelles
  SELECT COALESCE(SUM(amount), 0)
  FROM real_expenses
  WHERE is_exceptional = true
    AND ((p_profile_id IS NOT NULL AND profile_id = p_profile_id)
         OR (p_group_id IS NOT NULL AND group_id = p_group_id))
  INTO total_exceptional_expenses;

  -- Total des économies
  SELECT COALESCE(SUM(current_savings), 0)
  FROM estimated_budgets
  WHERE (p_profile_id IS NOT NULL AND profile_id = p_profile_id)
     OR (p_group_id IS NOT NULL AND group_id = p_group_id)
  INTO total_savings;

  RETURN total_estimated_income - total_estimated_budgets - total_exceptional_expenses + total_savings;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Erreur dans calculate_remaining_to_live: %', SQLERRM;
    RETURN 0;
END;
$$ LANGUAGE plpgsql;

-- 5. Créer la fonction de calcul et mise à jour des snapshots
CREATE OR REPLACE FUNCTION calculate_and_update_snapshot(
  p_profile_id UUID DEFAULT NULL,
  p_group_id UUID DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_available_cash NUMERIC := 0;
  v_remaining_to_live NUMERIC := 0;
  v_total_savings NUMERIC := 0;
BEGIN
  -- Calculer le cash disponible
  SELECT calculate_available_cash(p_profile_id, p_group_id) INTO v_available_cash;

  -- Calculer le reste à vivre
  SELECT calculate_remaining_to_live(p_profile_id, p_group_id) INTO v_remaining_to_live;

  -- Calculer le total des économies (somme des current_savings des budgets)
  SELECT COALESCE(SUM(current_savings), 0)
  FROM estimated_budgets
  WHERE (p_profile_id IS NOT NULL AND profile_id = p_profile_id)
     OR (p_group_id IS NOT NULL AND group_id = p_group_id)
  INTO v_total_savings;

  -- Supprimer l'ancien snapshot s'il existe
  DELETE FROM financial_snapshots
  WHERE is_current = true
    AND ((p_profile_id IS NOT NULL AND profile_id = p_profile_id)
         OR (p_group_id IS NOT NULL AND group_id = p_group_id));

  -- Insérer le nouveau snapshot
  INSERT INTO financial_snapshots (
    profile_id,
    group_id,
    available_cash,
    remaining_to_live,
    total_savings,
    is_current,
    created_at,
    updated_at
  ) VALUES (
    p_profile_id,
    p_group_id,
    v_available_cash,
    v_remaining_to_live,
    v_total_savings,
    true,
    NOW(),
    NOW()
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Logger l'erreur sans faire échouer la transaction principale
    RAISE WARNING 'Erreur lors de la mise à jour du snapshot financier: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- 6. Créer la fonction trigger
CREATE OR REPLACE FUNCTION trigger_update_financial_snapshot()
RETURNS TRIGGER AS $$
DECLARE
  target_profile_id UUID;
  target_group_id UUID;
BEGIN
  -- Déterminer le profile_id et group_id depuis l'enregistrement modifié
  IF TG_TABLE_NAME = 'estimated_budgets' OR TG_TABLE_NAME = 'estimated_incomes' THEN
    target_profile_id := COALESCE(NEW.profile_id, OLD.profile_id);
    target_group_id := COALESCE(NEW.group_id, OLD.group_id);
  ELSIF TG_TABLE_NAME = 'real_expenses' OR TG_TABLE_NAME = 'real_income_entries' THEN
    target_profile_id := COALESCE(NEW.profile_id, OLD.profile_id);
    target_group_id := COALESCE(NEW.group_id, OLD.group_id);
  END IF;

  -- Recalculer pour le profil si applicable
  IF target_profile_id IS NOT NULL THEN
    PERFORM calculate_and_update_snapshot(target_profile_id, NULL);
  END IF;

  -- Recalculer pour le groupe si applicable
  IF target_group_id IS NOT NULL THEN
    PERFORM calculate_and_update_snapshot(NULL, target_group_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
EXCEPTION
  WHEN OTHERS THEN
    -- Logger l'erreur et continuer
    RAISE WARNING 'Erreur dans trigger_update_financial_snapshot: %', SQLERRM;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 7. Recréer les triggers avec la bonne fonction
CREATE TRIGGER update_financial_snapshot_trigger
  AFTER INSERT OR UPDATE OR DELETE ON estimated_budgets
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_financial_snapshot();

CREATE TRIGGER update_financial_snapshot_trigger
  AFTER INSERT OR UPDATE OR DELETE ON estimated_incomes
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_financial_snapshot();

CREATE TRIGGER update_financial_snapshot_trigger
  AFTER INSERT OR UPDATE OR DELETE ON real_expenses
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_financial_snapshot();

CREATE TRIGGER update_financial_snapshot_trigger
  AFTER INSERT OR UPDATE OR DELETE ON real_income_entries
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_financial_snapshot();