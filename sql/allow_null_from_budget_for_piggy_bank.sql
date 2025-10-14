-- Migration: Allow from_budget_id to be NULL to represent piggy bank transfers
-- This enables auto-balance to transfer money from piggy bank (exceptional income) to deficient budgets

-- 1. Drop the NOT NULL constraint on from_budget_id
ALTER TABLE public.budget_transfers
  ALTER COLUMN from_budget_id DROP NOT NULL;

-- 2. Drop the existing foreign key constraint
ALTER TABLE public.budget_transfers
  DROP CONSTRAINT IF EXISTS budget_transfers_from_budget_id_fkey;

-- 3. Re-add the foreign key constraint with NULL support
ALTER TABLE public.budget_transfers
  ADD CONSTRAINT budget_transfers_from_budget_id_fkey
  FOREIGN KEY (from_budget_id)
  REFERENCES public.estimated_budgets(id)
  ON DELETE CASCADE;

-- 4. Update the different budgets check to handle NULL
ALTER TABLE public.budget_transfers
  DROP CONSTRAINT IF EXISTS budget_transfers_different_budgets_check;

ALTER TABLE public.budget_transfers
  ADD CONSTRAINT budget_transfers_different_budgets_check
  CHECK (from_budget_id IS NULL OR from_budget_id != to_budget_id);

-- Add comment to document this behavior
COMMENT ON COLUMN public.budget_transfers.from_budget_id IS
  'Source budget ID. NULL represents piggy bank (exceptional income) transfers during auto-balance.';
