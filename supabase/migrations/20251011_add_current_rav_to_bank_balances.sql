-- Migration to add current remaining to live (RAV) to bank_balances table
-- Created on 2025-10-11 to persist the current RAV value for profiles and groups

-- Add current_remaining_to_live column to bank_balances
ALTER TABLE public.bank_balances
ADD COLUMN IF NOT EXISTS current_remaining_to_live numeric DEFAULT 0;

-- Add updated_at timestamp to track when RAV was last calculated
-- (Note: updated_at already exists, but we'll ensure it's used properly)

-- Add comment for documentation
COMMENT ON COLUMN public.bank_balances.current_remaining_to_live IS
'Current remaining to live amount (RAV) for this profile or group.
Updated every time financial data changes (income, expense, budget, etc.).
This is the single source of truth for displaying RAV in the UI.';

-- Create index for faster retrieval
CREATE INDEX IF NOT EXISTS idx_bank_balances_profile_rav
ON public.bank_balances(profile_id, current_remaining_to_live)
WHERE profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bank_balances_group_rav
ON public.bank_balances(group_id, current_remaining_to_live)
WHERE group_id IS NOT NULL;

-- Migration notes:
-- 1. Existing bank_balances records will have current_remaining_to_live = 0 initially
-- 2. The application will recalculate and update these values on first access
-- 3. The remaining_to_live_snapshots table continues to serve as historical audit trail
-- 4. This field should be updated every time a financial operation occurs:
--    - Income created/updated/deleted
--    - Expense created/updated/deleted
--    - Budget created/updated/deleted
--    - Estimated income created/updated/deleted
--    - Bank balance updated
--    - Group contribution changed
