-- Debug du budget "course" pour comprendre pourquoi le carryover n'a pas été appliqué

-- 1. Vérifier l'état actuel du budget "course"
SELECT
  id,
  name,
  estimated_amount,
  monthly_surplus,
  monthly_deficit,
  carryover_spent_amount,
  carryover_applied_date,
  last_monthly_update
FROM estimated_budgets
WHERE name ILIKE '%course%';

-- 2. Vérifier les dépenses réelles sur ce budget
SELECT
  id,
  amount,
  description,
  expense_date,
  estimated_budget_id
FROM real_expenses
WHERE estimated_budget_id = '7177e3a6-14b8-46f4-adf7-6a8ca833bc94' -- ID de votre budget course
ORDER BY expense_date DESC;

-- 3. Calculer le déficit réel
WITH budget_analysis AS (
  SELECT
    b.id,
    b.name,
    b.estimated_amount,
    COALESCE(SUM(e.amount), 0) as total_spent,
    b.estimated_amount - COALESCE(SUM(e.amount), 0) as difference,
    CASE
      WHEN b.estimated_amount - COALESCE(SUM(e.amount), 0) < 0
      THEN ABS(b.estimated_amount - COALESCE(SUM(e.amount), 0))
      ELSE 0
    END as calculated_deficit
  FROM estimated_budgets b
  LEFT JOIN real_expenses e ON b.id = e.estimated_budget_id
  WHERE b.name ILIKE '%course%'
  GROUP BY b.id, b.name, b.estimated_amount
)
SELECT
  name,
  estimated_amount,
  total_spent,
  difference,
  calculated_deficit,
  CASE WHEN calculated_deficit > 0 THEN 'DÉFICIT DÉTECTÉ' ELSE 'PAS DE DÉFICIT' END as status
FROM budget_analysis;

-- 4. Vérifier les monthly_recaps récents pour ce profil
SELECT
  id,
  recap_month,
  recap_year,
  total_surplus,
  total_deficit,
  completed_at
FROM monthly_recaps
WHERE profile_id = '0679b0f9-830a-44e5-aecf-f8452c8dd101'
ORDER BY completed_at DESC
LIMIT 3;

-- 5. SIMULATION: Si il y a un déficit, l'appliquer manuellement
-- (décommentez si vous voulez forcer le carryover)
/*
UPDATE estimated_budgets
SET
  carryover_spent_amount = 50, -- Remplacez par le déficit calculé
  carryover_applied_date = CURRENT_DATE,
  monthly_deficit = 0,
  updated_at = NOW()
WHERE name ILIKE '%course%';
*/