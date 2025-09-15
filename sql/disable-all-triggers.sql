-- Script pour désactiver TOUS les triggers sur les tables financières
-- Cela permettra de tester les fonctionnalités d'édition sans erreurs

-- Désactiver tous les triggers sur estimated_budgets
ALTER TABLE estimated_budgets DISABLE TRIGGER ALL;

-- Désactiver tous les triggers sur estimated_incomes
ALTER TABLE estimated_incomes DISABLE TRIGGER ALL;

-- Optionnel: Désactiver aussi sur les autres tables si nécessaire
-- ALTER TABLE real_expenses DISABLE TRIGGER ALL;
-- ALTER TABLE real_income_entries DISABLE TRIGGER ALL;
-- ALTER TABLE financial_snapshots DISABLE TRIGGER ALL;

-- Vérification: cette commande vous dira si les triggers sont désactivés
SELECT
    schemaname,
    tablename,
    triggername,
    CASE
        WHEN tgenabled = 'O' THEN 'ENABLED'
        WHEN tgenabled = 'D' THEN 'DISABLED'
        ELSE 'UNKNOWN'
    END as status
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'public'
  AND c.relname IN ('estimated_budgets', 'estimated_incomes')
  AND NOT t.tgisinternal;