-- Script de diagnostic pour identifier le problème de carryover

-- 1. Vérifier si la fonction check_column_exists existe
SELECT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'check_column_exists'
) AS function_exists;

-- 2. Vérifier les colonnes de estimated_budgets
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'estimated_budgets'
  AND table_schema = 'public'
  AND column_name IN ('monthly_surplus', 'monthly_deficit', 'carryover_spent_amount', 'carryover_applied_date')
ORDER BY column_name;

-- 3. Vérifier s'il y a des budgets avec des données de carryover
SELECT
  id,
  name,
  estimated_amount,
  monthly_surplus,
  monthly_deficit,
  carryover_spent_amount,
  carryover_applied_date,
  created_at
FROM estimated_budgets
WHERE carryover_spent_amount > 0 OR monthly_surplus < 0 OR monthly_deficit > 0
LIMIT 10;

-- 4. Vérifier un budget spécifique (remplacez par l'ID de votre budget de test)
-- SELECT
--   id,
--   name,
--   estimated_amount,
--   monthly_surplus,
--   monthly_deficit,
--   carryover_spent_amount,
--   carryover_applied_date
-- FROM estimated_budgets
-- WHERE name LIKE '%courses%' OR name LIKE '%test%';

-- 5. Vérifier les récaps mensuels récents
SELECT
  id,
  recap_month,
  recap_year,
  total_surplus,
  total_deficit,
  completed_at
FROM monthly_recaps
ORDER BY completed_at DESC
LIMIT 5;