-- Script pour supprimer COMPLETEMENT tous les triggers
-- Approche directe pour éliminer toute source de problème

-- 1. Supprimer tous les triggers possibles sur estimated_budgets
DROP TRIGGER IF EXISTS update_financial_snapshot_trigger ON estimated_budgets CASCADE;
DROP TRIGGER IF EXISTS minimal_budget_trigger ON estimated_budgets CASCADE;
DROP TRIGGER IF EXISTS simple_budget_trigger ON estimated_budgets CASCADE;
DROP TRIGGER IF EXISTS financial_snapshot_trigger ON estimated_budgets CASCADE;
DROP TRIGGER IF EXISTS budget_trigger ON estimated_budgets CASCADE;
DROP TRIGGER IF EXISTS trigger_update_financial_snapshot ON estimated_budgets CASCADE;

-- 2. Supprimer tous les triggers possibles sur estimated_incomes
DROP TRIGGER IF EXISTS update_financial_snapshot_trigger ON estimated_incomes CASCADE;
DROP TRIGGER IF EXISTS minimal_income_trigger ON estimated_incomes CASCADE;
DROP TRIGGER IF EXISTS simple_income_trigger ON estimated_incomes CASCADE;
DROP TRIGGER IF EXISTS financial_snapshot_trigger ON estimated_incomes CASCADE;
DROP TRIGGER IF EXISTS income_trigger ON estimated_incomes CASCADE;
DROP TRIGGER IF EXISTS trigger_update_financial_snapshot ON estimated_incomes CASCADE;

-- 3. Supprimer toutes les fonctions trigger possibles
DROP FUNCTION IF EXISTS update_financial_snapshot() CASCADE;
DROP FUNCTION IF EXISTS update_financial_snapshot(UUID) CASCADE;
DROP FUNCTION IF EXISTS update_financial_snapshot(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS trigger_update_financial_snapshot() CASCADE;
DROP FUNCTION IF EXISTS minimal_trigger_function() CASCADE;
DROP FUNCTION IF EXISTS simple_budget_income_trigger() CASCADE;
DROP FUNCTION IF EXISTS calculate_and_update_snapshot(UUID, UUID) CASCADE;

-- 4. Message de confirmation
SELECT 'Tous les triggers sur estimated_budgets et estimated_incomes ont été supprimés' as status;