-- Script pour désactiver temporairement tous les triggers financiers

-- Supprimer TOUS les triggers existants
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
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I.%I', r.triggername, r.schemaname, r.tablename);
        RAISE NOTICE 'Trigger supprimé: % sur %', r.triggername, r.tablename;
    END LOOP;
END
$$;

-- Supprimer toutes les fonctions trigger
DROP FUNCTION IF EXISTS update_financial_snapshot() CASCADE;
DROP FUNCTION IF EXISTS trigger_update_financial_snapshot() CASCADE;
DROP FUNCTION IF EXISTS simple_financial_trigger() CASCADE;
DROP FUNCTION IF EXISTS calculate_and_update_snapshot(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS update_snapshot_simple(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS calculate_available_cash_simple(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS calculate_remaining_to_live_simple(UUID, UUID) CASCADE;