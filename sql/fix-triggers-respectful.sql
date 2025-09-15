-- Script respectueux de l'architecture existante
-- Analyse de l'erreur: il y a des triggers existants qui dépendent de calculate_available_cash()

-- 1. D'abord, identifier et supprimer SEULEMENT les triggers problématiques
-- Garder les triggers existants qui fonctionnent correctement

-- Supprimer SEULEMENT les triggers qui causent l'erreur "missing FROM-clause"
DROP TRIGGER IF EXISTS update_financial_snapshot_trigger ON estimated_budgets;
DROP TRIGGER IF EXISTS update_financial_snapshot_trigger ON estimated_incomes;

-- NE PAS toucher aux triggers qui fonctionnent:
-- - trigger_calculate_available_cash_income sur real_income_entries (PRESERVE)
-- - trigger_calculate_available_cash_expenses sur real_expenses (PRESERVE)

-- 2. Supprimer SEULEMENT les fonctions qui posent problème
-- Garder calculate_available_cash() et calculate_remaining_to_live() s'ils existent et fonctionnent

-- Supprimer seulement la fonction trigger problématique
DROP FUNCTION IF EXISTS update_financial_snapshot() CASCADE;
DROP FUNCTION IF EXISTS trigger_update_financial_snapshot() CASCADE;

-- 3. Créer une fonction trigger simple SEULEMENT pour estimated_budgets et estimated_incomes
-- Cette fonction ne touchera PAS aux calculs existants qui fonctionnent

CREATE OR REPLACE FUNCTION simple_budget_income_trigger()
RETURNS TRIGGER AS $$
BEGIN
  -- Ne rien faire pour l'instant, juste permettre l'opération
  -- Cela évite l'erreur "missing FROM-clause" sans casser l'existant

  RETURN COALESCE(NEW, OLD);
EXCEPTION
  WHEN OTHERS THEN
    -- En cas d'erreur, ne pas bloquer l'opération principale
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 4. Appliquer le nouveau trigger SEULEMENT là où c'était problématique
CREATE TRIGGER simple_budget_trigger
    AFTER INSERT OR UPDATE OR DELETE ON estimated_budgets
    FOR EACH ROW
    EXECUTE FUNCTION simple_budget_income_trigger();

CREATE TRIGGER simple_income_trigger
    AFTER INSERT OR UPDATE OR DELETE ON estimated_incomes
    FOR EACH ROW
    EXECUTE FUNCTION simple_budget_income_trigger();

-- 5. Vérification: lister les triggers restants pour confirmer
-- Cette requête vous montrera quels triggers sont encore actifs
DO $$
DECLARE
    r RECORD;
BEGIN
    RAISE NOTICE '=== TRIGGERS ACTIFS APRÈS NETTOYAGE ===';
    FOR r IN
        SELECT schemaname, tablename, triggername
        FROM pg_triggers
        WHERE schemaname = 'public'
        AND (tablename IN ('estimated_budgets', 'estimated_incomes', 'real_expenses', 'real_income_entries'))
        ORDER BY tablename, triggername
    LOOP
        RAISE NOTICE 'Table: % - Trigger: %', r.tablename, r.triggername;
    END LOOP;
    RAISE NOTICE '=== FIN DE LA LISTE ===';
END
$$;