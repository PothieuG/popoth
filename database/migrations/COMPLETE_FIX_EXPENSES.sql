-- ===================================================================
-- COMPLETE FIX FOR EXPENSE BREAKDOWN TRACKING
-- ===================================================================
-- This script does THREE things:
-- 1. Adds the breakdown columns if they don't exist
-- 2. Sets default values for existing expenses
-- 3. Verifies the changes
-- ===================================================================

-- STEP 1: Add columns if they don't exist (idempotent)
-- ===================================================================
ALTER TABLE public.real_expenses
ADD COLUMN IF NOT EXISTS amount_from_piggy_bank numeric DEFAULT 0 CHECK (amount_from_piggy_bank >= 0),
ADD COLUMN IF NOT EXISTS amount_from_budget_savings numeric DEFAULT 0 CHECK (amount_from_budget_savings >= 0),
ADD COLUMN IF NOT EXISTS amount_from_budget numeric DEFAULT 0 CHECK (amount_from_budget >= 0);

-- Add comments
COMMENT ON COLUMN public.real_expenses.amount_from_piggy_bank IS 'Amount covered by piggy bank';
COMMENT ON COLUMN public.real_expenses.amount_from_budget_savings IS 'Amount covered by budget cumulated savings';
COMMENT ON COLUMN public.real_expenses.amount_from_budget IS 'Amount covered by the budget itself';

-- STEP 2: Fix existing expenses without breakdown info
-- ===================================================================
-- For all existing expenses that don't have breakdown info,
-- assume everything came from the budget (safest assumption)
UPDATE public.real_expenses
SET
  amount_from_piggy_bank = COALESCE(amount_from_piggy_bank, 0),
  amount_from_budget_savings = COALESCE(amount_from_budget_savings, 0),
  amount_from_budget = COALESCE(amount_from_budget, amount)
WHERE
  amount_from_budget IS NULL
  OR amount_from_budget_savings IS NULL
  OR amount_from_piggy_bank IS NULL;

-- STEP 3: Verification queries
-- ===================================================================
-- Check that all expenses now have breakdown info
SELECT
  COUNT(*) as total_expenses,
  COUNT(*) FILTER (WHERE amount_from_budget IS NOT NULL) as with_breakdown,
  COUNT(*) FILTER (WHERE amount_from_budget IS NULL) as without_breakdown,
  SUM(amount) as total_amount,
  SUM(amount_from_piggy_bank) as total_from_piggy,
  SUM(amount_from_budget_savings) as total_from_savings,
  SUM(amount_from_budget) as total_from_budget
FROM public.real_expenses;

-- Show sample of expenses with breakdown
SELECT
  id,
  description,
  amount as total_amount,
  amount_from_piggy_bank,
  amount_from_budget_savings,
  amount_from_budget,
  (amount_from_piggy_bank + amount_from_budget_savings + amount_from_budget) as calculated_total,
  created_at
FROM public.real_expenses
ORDER BY created_at DESC
LIMIT 10;

-- ===================================================================
-- NOTES:
-- - After running this script, refresh your application
-- - Old expenses will show as 100% from budget (correct for pre-tracking data)
-- - New expenses created after this will have proper breakdown
-- ===================================================================
