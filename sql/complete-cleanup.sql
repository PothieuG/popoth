-- Script de nettoyage complet des triggers et fonctions

-- 1. Supprimer TOUS les triggers sur toutes les tables financières
DROP TRIGGER IF EXISTS update_financial_snapshot_trigger ON estimated_budgets;
DROP TRIGGER IF EXISTS update_financial_snapshot_trigger ON estimated_incomes;
DROP TRIGGER IF EXISTS update_financial_snapshot_trigger ON real_expenses;
DROP TRIGGER IF EXISTS update_financial_snapshot_trigger ON real_income_entries;

-- Autres noms possibles de triggers
DROP TRIGGER IF EXISTS financial_snapshot_trigger ON estimated_budgets;
DROP TRIGGER IF EXISTS financial_snapshot_trigger ON estimated_incomes;
DROP TRIGGER IF EXISTS financial_snapshot_trigger ON real_expenses;
DROP TRIGGER IF EXISTS financial_snapshot_trigger ON real_income_entries;

DROP TRIGGER IF EXISTS update_snapshot_trigger ON estimated_budgets;
DROP TRIGGER IF EXISTS update_snapshot_trigger ON estimated_incomes;
DROP TRIGGER IF EXISTS update_snapshot_trigger ON real_expenses;
DROP TRIGGER IF EXISTS update_snapshot_trigger ON real_income_entries;

-- 2. Supprimer TOUTES les fonctions possibles
DROP FUNCTION IF EXISTS update_financial_snapshot();
DROP FUNCTION IF EXISTS update_financial_snapshot(UUID);
DROP FUNCTION IF EXISTS update_financial_snapshot(UUID, UUID);
DROP FUNCTION IF EXISTS trigger_update_financial_snapshot();
DROP FUNCTION IF EXISTS calculate_and_update_snapshot();
DROP FUNCTION IF EXISTS calculate_and_update_snapshot(UUID);
DROP FUNCTION IF EXISTS calculate_and_update_snapshot(UUID, UUID);
DROP FUNCTION IF EXISTS calculate_available_cash();
DROP FUNCTION IF EXISTS calculate_available_cash(UUID);
DROP FUNCTION IF EXISTS calculate_available_cash(UUID, UUID);
DROP FUNCTION IF EXISTS calculate_remaining_to_live();
DROP FUNCTION IF EXISTS calculate_remaining_to_live(UUID);
DROP FUNCTION IF EXISTS calculate_remaining_to_live(UUID, UUID);

-- 3. Vérifier s'il n'y a pas d'autres triggers cachés
-- Vous pouvez commenter cette section après la première exécution
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT schemaname, tablename, triggername
        FROM pg_triggers
        WHERE schemaname = 'public'
        AND (tablename IN ('estimated_budgets', 'estimated_incomes', 'real_expenses', 'real_income_entries'))
    LOOP
        RAISE NOTICE 'Trigger trouvé: %.% sur %', r.schemaname, r.triggername, r.tablename;
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I.%I', r.triggername, r.schemaname, r.tablename);
    END LOOP;
END
$$;

-- 4. Maintenant, créer les nouvelles fonctions proprement

-- Fonction simple de calcul du cash disponible
CREATE OR REPLACE FUNCTION calculate_available_cash_simple(
    user_profile_id UUID DEFAULT NULL,
    user_group_id UUID DEFAULT NULL
)
RETURNS NUMERIC AS $$
DECLARE
    total_income NUMERIC := 0;
    total_expenses NUMERIC := 0;
BEGIN
    -- Revenus réels
    SELECT COALESCE(SUM(amount), 0) INTO total_income
    FROM real_income_entries
    WHERE (user_profile_id IS NOT NULL AND profile_id = user_profile_id)
       OR (user_group_id IS NOT NULL AND group_id = user_group_id);

    -- Dépenses réelles
    SELECT COALESCE(SUM(amount), 0) INTO total_expenses
    FROM real_expenses
    WHERE (user_profile_id IS NOT NULL AND profile_id = user_profile_id)
       OR (user_group_id IS NOT NULL AND group_id = user_group_id);

    RETURN COALESCE(total_income - total_expenses, 0);
EXCEPTION
    WHEN OTHERS THEN
        RETURN 0;
END;
$$ LANGUAGE plpgsql;

-- Fonction simple de calcul du reste à vivre
CREATE OR REPLACE FUNCTION calculate_remaining_to_live_simple(
    user_profile_id UUID DEFAULT NULL,
    user_group_id UUID DEFAULT NULL
)
RETURNS NUMERIC AS $$
DECLARE
    estimated_income NUMERIC := 0;
    estimated_budgets NUMERIC := 0;
    exceptional_expenses NUMERIC := 0;
    savings NUMERIC := 0;
BEGIN
    -- Revenus estimés
    SELECT COALESCE(SUM(estimated_amount), 0) INTO estimated_income
    FROM estimated_incomes
    WHERE (user_profile_id IS NOT NULL AND profile_id = user_profile_id)
       OR (user_group_id IS NOT NULL AND group_id = user_group_id);

    -- Budgets estimés
    SELECT COALESCE(SUM(estimated_amount), 0) INTO estimated_budgets
    FROM estimated_budgets
    WHERE (user_profile_id IS NOT NULL AND profile_id = user_profile_id)
       OR (user_group_id IS NOT NULL AND group_id = user_group_id);

    -- Dépenses exceptionnelles
    SELECT COALESCE(SUM(amount), 0) INTO exceptional_expenses
    FROM real_expenses
    WHERE is_exceptional = true
      AND ((user_profile_id IS NOT NULL AND profile_id = user_profile_id)
           OR (user_group_id IS NOT NULL AND group_id = user_group_id));

    -- Économies
    SELECT COALESCE(SUM(current_savings), 0) INTO savings
    FROM estimated_budgets
    WHERE (user_profile_id IS NOT NULL AND profile_id = user_profile_id)
       OR (user_group_id IS NOT NULL AND group_id = user_group_id);

    RETURN COALESCE(estimated_income - estimated_budgets - exceptional_expenses + savings, 0);
EXCEPTION
    WHEN OTHERS THEN
        RETURN 0;
END;
$$ LANGUAGE plpgsql;

-- Fonction simple de mise à jour des snapshots
CREATE OR REPLACE FUNCTION update_snapshot_simple(
    user_profile_id UUID DEFAULT NULL,
    user_group_id UUID DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
    cash_available NUMERIC;
    remaining_live NUMERIC;
    total_savings NUMERIC;
BEGIN
    -- Calculer les valeurs
    cash_available := calculate_available_cash_simple(user_profile_id, user_group_id);
    remaining_live := calculate_remaining_to_live_simple(user_profile_id, user_group_id);

    SELECT COALESCE(SUM(current_savings), 0) INTO total_savings
    FROM estimated_budgets
    WHERE (user_profile_id IS NOT NULL AND profile_id = user_profile_id)
       OR (user_group_id IS NOT NULL AND group_id = user_group_id);

    -- Supprimer l'ancien snapshot
    DELETE FROM financial_snapshots
    WHERE is_current = true
      AND ((user_profile_id IS NOT NULL AND profile_id = user_profile_id)
           OR (user_group_id IS NOT NULL AND group_id = user_group_id));

    -- Insérer le nouveau
    INSERT INTO financial_snapshots (
        profile_id,
        group_id,
        available_cash,
        remaining_to_live,
        total_savings,
        is_current
    ) VALUES (
        user_profile_id,
        user_group_id,
        cash_available,
        remaining_live,
        total_savings,
        true
    );
EXCEPTION
    WHEN OTHERS THEN
        -- Ne rien faire en cas d'erreur, pour ne pas bloquer les opérations principales
        NULL;
END;
$$ LANGUAGE plpgsql;

-- Fonction trigger simple
CREATE OR REPLACE FUNCTION simple_financial_trigger()
RETURNS TRIGGER AS $$
DECLARE
    target_profile UUID;
    target_group UUID;
BEGIN
    -- Récupérer les IDs
    target_profile := COALESCE(NEW.profile_id, OLD.profile_id);
    target_group := COALESCE(NEW.group_id, OLD.group_id);

    -- Mettre à jour le snapshot
    IF target_profile IS NOT NULL THEN
        PERFORM update_snapshot_simple(target_profile, NULL);
    END IF;

    IF target_group IS NOT NULL THEN
        PERFORM update_snapshot_simple(NULL, target_group);
    END IF;

    RETURN COALESCE(NEW, OLD);
EXCEPTION
    WHEN OTHERS THEN
        -- En cas d'erreur, continuer sans bloquer l'opération principale
        RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 5. Créer les nouveaux triggers
CREATE TRIGGER simple_financial_trigger
    AFTER INSERT OR UPDATE OR DELETE ON estimated_budgets
    FOR EACH ROW
    EXECUTE FUNCTION simple_financial_trigger();

CREATE TRIGGER simple_financial_trigger
    AFTER INSERT OR UPDATE OR DELETE ON estimated_incomes
    FOR EACH ROW
    EXECUTE FUNCTION simple_financial_trigger();

CREATE TRIGGER simple_financial_trigger
    AFTER INSERT OR UPDATE OR DELETE ON real_expenses
    FOR EACH ROW
    EXECUTE FUNCTION simple_financial_trigger();

CREATE TRIGGER simple_financial_trigger
    AFTER INSERT OR UPDATE OR DELETE ON real_income_entries
    FOR EACH ROW
    EXECUTE FUNCTION simple_financial_trigger();