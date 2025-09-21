-- Migration script to update budget_transfers table for the new transfer system
-- This adds the missing columns required for the transfer mechanism

-- Add missing columns to budget_transfers table
ALTER TABLE public.budget_transfers
ADD COLUMN IF NOT EXISTS profile_id uuid,
ADD COLUMN IF NOT EXISTS group_id uuid,
ADD COLUMN IF NOT EXISTS transfer_date date NOT NULL DEFAULT CURRENT_DATE;

-- Update existing constraint to make monthly_recap_id optional
ALTER TABLE public.budget_transfers
ALTER COLUMN monthly_recap_id DROP NOT NULL;

-- Add XOR ownership constraint (profile_id XOR group_id) - handle if already exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_transfers_owner_exclusive_check') THEN
        ALTER TABLE public.budget_transfers
        ADD CONSTRAINT budget_transfers_owner_exclusive_check CHECK (
          (profile_id IS NOT NULL AND group_id IS NULL) OR
          (profile_id IS NULL AND group_id IS NOT NULL)
        );
    END IF;
END $$;

-- Add constraint to ensure different budgets - handle if already exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_transfers_different_budgets_check') THEN
        ALTER TABLE public.budget_transfers
        ADD CONSTRAINT budget_transfers_different_budgets_check CHECK (from_budget_id != to_budget_id);
    END IF;
END $$;

-- Add foreign key constraints for the new columns - handle if already exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_transfers_profile_id_fkey') THEN
        ALTER TABLE public.budget_transfers
        ADD CONSTRAINT budget_transfers_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_transfers_group_id_fkey') THEN
        ALTER TABLE public.budget_transfers
        ADD CONSTRAINT budget_transfers_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS budget_transfers_profile_id_idx ON public.budget_transfers(profile_id);
CREATE INDEX IF NOT EXISTS budget_transfers_group_id_idx ON public.budget_transfers(group_id);
CREATE INDEX IF NOT EXISTS budget_transfers_from_budget_id_idx ON public.budget_transfers(from_budget_id);
CREATE INDEX IF NOT EXISTS budget_transfers_to_budget_id_idx ON public.budget_transfers(to_budget_id);
CREATE INDEX IF NOT EXISTS budget_transfers_transfer_date_idx ON public.budget_transfers(transfer_date);

-- Enable Row Level Security if not already enabled
ALTER TABLE public.budget_transfers ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist and recreate them
DROP POLICY IF EXISTS "Users can view their own budget transfers" ON public.budget_transfers;
DROP POLICY IF EXISTS "Users can insert their own budget transfers" ON public.budget_transfers;
DROP POLICY IF EXISTS "Users can update their own budget transfers" ON public.budget_transfers;
DROP POLICY IF EXISTS "Users can delete their own budget transfers" ON public.budget_transfers;

-- Create RLS policies
CREATE POLICY "Users can view their own budget transfers" ON public.budget_transfers
    FOR SELECT USING (
        profile_id = auth.uid() OR
        group_id IN (SELECT group_id FROM public.profiles WHERE id = auth.uid())
    );

CREATE POLICY "Users can insert their own budget transfers" ON public.budget_transfers
    FOR INSERT WITH CHECK (
        (profile_id = auth.uid() AND group_id IS NULL) OR
        (group_id IN (SELECT group_id FROM public.profiles WHERE id = auth.uid()) AND profile_id IS NULL)
    );

CREATE POLICY "Users can update their own budget transfers" ON public.budget_transfers
    FOR UPDATE USING (
        profile_id = auth.uid() OR
        group_id IN (SELECT group_id FROM public.profiles WHERE id = auth.uid())
    );

CREATE POLICY "Users can delete their own budget transfers" ON public.budget_transfers
    FOR DELETE USING (
        profile_id = auth.uid() OR
        group_id IN (SELECT group_id FROM public.profiles WHERE id = auth.uid())
    );

-- Update comment for documentation
COMMENT ON TABLE public.budget_transfers IS 'Tracks transfers between budgets during monthly recap process. Uses XOR ownership pattern (profile_id XOR group_id). Updated for new transfer system.';
COMMENT ON COLUMN public.budget_transfers.transfer_amount IS 'Amount transferred from source budget to destination budget (always positive)';
COMMENT ON COLUMN public.budget_transfers.transfer_reason IS 'Reason for the transfer (e.g., "Manual transfer via monthly recap")';
COMMENT ON COLUMN public.budget_transfers.monthly_recap_id IS 'Optional link to monthly recap session if applicable';
COMMENT ON COLUMN public.budget_transfers.profile_id IS 'Profile owner of the transfer (XOR with group_id)';
COMMENT ON COLUMN public.budget_transfers.group_id IS 'Group owner of the transfer (XOR with profile_id)';
COMMENT ON COLUMN public.budget_transfers.transfer_date IS 'Date when the transfer was made';