-- Sprint Group-Income-Cascade (2026-05-28) — M1/4
--
-- Ajoute la colonne mirror `groups.monthly_income_estimate` qui sera
-- maintenue auto par le trigger `estimated_incomes_sync_group_income`
-- (migration M3) et lue par la RPC `calculate_group_contributions`
-- (migration M2) pour réduire les contributions des membres.
--
-- Sémantique : `monthly_income_estimate = SUM(estimated_incomes WHERE group_id = X)`.
-- Pattern miroir strict de `monthly_budget_estimate` introduit pré-baseline
-- et auto-syncé via `20260520000000_auto_sync_group_budget.sql`.

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS monthly_income_estimate numeric(10, 2) NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
