-- Vérification immédiate des dépenses sur le budget "course"

-- 1. État actuel du budget "course"
SELECT
  'BUDGET ACTUEL' as type,
  id,
  name,
  estimated_amount,
  carryover_spent_amount,
  monthly_surplus,
  monthly_deficit
FROM estimated_budgets
WHERE name = 'course';

-- 2. Toutes les dépenses sur ce budget
SELECT
  'DÉPENSES' as type,
  id,
  amount,
  description,
  expense_date,
  estimated_budget_id
FROM real_expenses
WHERE estimated_budget_id = '7177e3a6-14b8-46f4-adf7-6a8ca833bc94';

-- 3. Calcul du déficit attendu
SELECT
  'CALCUL DÉFICIT' as type,
  b.name,
  b.estimated_amount as budget,
  COALESCE(SUM(e.amount), 0) as total_depense,
  COALESCE(SUM(e.amount), 0) - b.estimated_amount as difference,
  CASE
    WHEN COALESCE(SUM(e.amount), 0) > b.estimated_amount
    THEN COALESCE(SUM(e.amount), 0) - b.estimated_amount
    ELSE 0
  END as deficit_calcule
FROM estimated_budgets b
LEFT JOIN real_expenses e ON b.id = e.estimated_budget_id
WHERE b.name = 'course'
GROUP BY b.id, b.name, b.estimated_amount;

-- 4. Si pas de dépenses, en créer une de test
-- (décommentez si besoin)
/*
INSERT INTO real_expenses (
  profile_id,
  estimated_budget_id,
  amount,
  description,
  expense_date
) VALUES (
  '0679b0f9-830a-44e5-aecf-f8452c8dd101',
  '7177e3a6-14b8-46f4-adf7-6a8ca833bc94',
  250,
  'Test déficit carryover',
  CURRENT_DATE
);
*/