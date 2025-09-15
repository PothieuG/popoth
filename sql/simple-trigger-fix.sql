-- Script simple pour corriger les triggers problématiques
-- Basé sur la structure de base de données fournie

-- 1. Supprimer tous les triggers problématiques sur les tables budgets/incomes
DROP TRIGGER IF EXISTS update_financial_snapshot_trigger ON estimated_budgets;
DROP TRIGGER IF EXISTS update_financial_snapshot_trigger ON estimated_incomes;
DROP TRIGGER IF EXISTS simple_budget_trigger ON estimated_budgets;
DROP TRIGGER IF EXISTS simple_income_trigger ON estimated_incomes;

-- 2. Supprimer les fonctions trigger problématiques
DROP FUNCTION IF EXISTS update_financial_snapshot() CASCADE;
DROP FUNCTION IF EXISTS trigger_update_financial_snapshot() CASCADE;
DROP FUNCTION IF EXISTS simple_budget_income_trigger() CASCADE;

-- 3. Créer une fonction trigger minimale qui ne fait rien
-- Cela permet les opérations CRUD sans calculs complexes
CREATE OR REPLACE FUNCTION minimal_trigger_function()
RETURNS TRIGGER AS $$
BEGIN
  -- Ne faire aucun calcul, juste permettre l'opération
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 4. Appliquer le trigger minimal seulement sur estimated_budgets et estimated_incomes
CREATE TRIGGER minimal_budget_trigger
    AFTER INSERT OR UPDATE OR DELETE ON estimated_budgets
    FOR EACH ROW
    EXECUTE FUNCTION minimal_trigger_function();

CREATE TRIGGER minimal_income_trigger
    AFTER INSERT OR UPDATE OR DELETE ON estimated_incomes
    FOR EACH ROW
    EXECUTE FUNCTION minimal_trigger_function();

-- Note: Nous ne touchons PAS aux triggers sur real_expenses et real_income_entries
-- car ils semblent fonctionner correctement