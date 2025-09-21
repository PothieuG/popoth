-- Create budget_transfers table for tracking transfers between budgets during monthly recap
CREATE TABLE public.budget_transfers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid,
  group_id uuid,
  from_budget_id uuid NOT NULL,
  to_budget_id uuid NOT NULL,
  transfer_amount numeric NOT NULL CHECK (transfer_amount > 0),
  transfer_reason text,
  transfer_date date NOT NULL DEFAULT CURRENT_DATE,
  monthly_recap_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT budget_transfers_pkey PRIMARY KEY (id),
  CONSTRAINT budget_transfers_owner_exclusive_check CHECK (
    (profile_id IS NOT NULL AND group_id IS NULL) OR
    (profile_id IS NULL AND group_id IS NOT NULL)
  ),
  CONSTRAINT budget_transfers_from_budget_id_fkey FOREIGN KEY (from_budget_id) REFERENCES public.estimated_budgets(id) ON DELETE CASCADE,
  CONSTRAINT budget_transfers_to_budget_id_fkey FOREIGN KEY (to_budget_id) REFERENCES public.estimated_budgets(id) ON DELETE CASCADE,
  CONSTRAINT budget_transfers_different_budgets_check CHECK (from_budget_id != to_budget_id)
);

-- Add indexes for better performance
CREATE INDEX budget_transfers_profile_id_idx ON public.budget_transfers(profile_id);
CREATE INDEX budget_transfers_group_id_idx ON public.budget_transfers(group_id);
CREATE INDEX budget_transfers_from_budget_id_idx ON public.budget_transfers(from_budget_id);
CREATE INDEX budget_transfers_to_budget_id_idx ON public.budget_transfers(to_budget_id);
CREATE INDEX budget_transfers_transfer_date_idx ON public.budget_transfers(transfer_date);

-- Enable Row Level Security
ALTER TABLE public.budget_transfers ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for profile context
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

-- Add comment for documentation
COMMENT ON TABLE public.budget_transfers IS 'Tracks transfers between budgets during monthly recap process. Uses XOR ownership pattern (profile_id XOR group_id).';
COMMENT ON COLUMN public.budget_transfers.transfer_amount IS 'Amount transferred from source budget to destination budget (always positive)';
COMMENT ON COLUMN public.budget_transfers.transfer_reason IS 'Reason for the transfer (e.g., "Manual transfer via monthly recap")';
COMMENT ON COLUMN public.budget_transfers.monthly_recap_id IS 'Optional link to monthly recap session if applicable';