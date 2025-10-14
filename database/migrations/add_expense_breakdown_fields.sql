-- Migration: Add breakdown tracking fields to real_expenses
-- This allows tracking where the money came from for each expense

-- Add columns to track expense breakdown
ALTER TABLE public.real_expenses
ADD COLUMN IF NOT EXISTS amount_from_piggy_bank numeric DEFAULT 0 CHECK (amount_from_piggy_bank >= 0),
ADD COLUMN IF NOT EXISTS amount_from_budget_savings numeric DEFAULT 0 CHECK (amount_from_budget_savings >= 0),
ADD COLUMN IF NOT EXISTS amount_from_budget numeric DEFAULT 0 CHECK (amount_from_budget >= 0);

-- Add comment for documentation
COMMENT ON COLUMN public.real_expenses.amount_from_piggy_bank IS 'Amount covered by piggy bank';
COMMENT ON COLUMN public.real_expenses.amount_from_budget_savings IS 'Amount covered by budget cumulated savings';
COMMENT ON COLUMN public.real_expenses.amount_from_budget IS 'Amount covered by the budget itself';

-- Validate that breakdown matches total amount
-- Note: We don't add this as a constraint because it could cause issues with existing data
-- Instead, we'll enforce this in the application layer
