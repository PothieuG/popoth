-- Fix existing expenses by setting breakdown fields
-- For existing expenses without breakdown info, assume everything came from budget

-- Update all existing expenses that don't have breakdown info
UPDATE public.real_expenses
SET
  amount_from_piggy_bank = 0,
  amount_from_budget_savings = 0,
  amount_from_budget = amount
WHERE
  amount_from_budget IS NULL
  OR amount_from_budget_savings IS NULL
  OR amount_from_piggy_bank IS NULL;

-- Verify the update
SELECT
  COUNT(*) as total_expenses,
  COUNT(*) FILTER (WHERE amount_from_budget IS NOT NULL) as with_breakdown,
  COUNT(*) FILTER (WHERE amount_from_budget IS NULL) as without_breakdown
FROM public.real_expenses;
