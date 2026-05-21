-- Sprint Refactor R3: dedupe indexes, FKs, CHECK constraints in public schema.
--
-- The baseline export 20260101000000_remote_schema.sql captured several
-- harmless-but-confusing duplicates and one buggy CHECK that rejects
-- legitimate piggy -> budget transfers (`from_budget_id <> to_budget_id`
-- evaluates to NULL when from_budget_id IS NULL, which postgres treats as
-- false inside a CHECK).
--
-- Every DROP is guarded by IF EXISTS so the migration is idempotent. For each
-- pair the surviving constraint is equivalent or strictly better than the
-- dropped one (e.g. partial WHERE keeps the more selective index).

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Identical pairs: keep the idx_* convention version.
DROP INDEX IF EXISTS public.budget_transfers_from_budget_id_idx;     -- keep idx_budget_transfers_from_budget
DROP INDEX IF EXISTS public.budget_transfers_to_budget_id_idx;       -- keep idx_budget_transfers_to_budget
DROP INDEX IF EXISTS public.profiles_group_id_idx;                   -- keep idx_profiles_group_id
DROP INDEX IF EXISTS public.idx_real_income_entries_date;            -- keep idx_real_income_entries_entry_date
DROP INDEX IF EXISTS public.idx_real_expenses_date;                  -- keep idx_real_expenses_expense_date

-- Partial vs non-partial: keep the partial WHERE clause version (more selective).
DROP INDEX IF EXISTS public.idx_real_expenses_budget_id;             -- keep idx_real_expenses_estimated_budget_id (partial)

-- ============================================================================
-- FOREIGN KEYS
-- ============================================================================

-- budget_transfers had two FKs on from_budget_id; keep the explicit-named one.
ALTER TABLE public.budget_transfers
  DROP CONSTRAINT IF EXISTS budget_transfers_from_budget_id_fkey;

-- ============================================================================
-- CHECK CONSTRAINTS - duplicate predicates
-- ============================================================================

ALTER TABLE public.estimated_budgets
  DROP CONSTRAINT IF EXISTS estimated_budgets_nonnegative_amount_check;   -- same as _estimated_amount_check (estimated_amount >= 0)

ALTER TABLE public.real_expenses
  DROP CONSTRAINT IF EXISTS real_expenses_positive_amount_check;          -- same as _amount_check (amount > 0)

ALTER TABLE public.real_income_entries
  DROP CONSTRAINT IF EXISTS real_income_entries_positive_amount_check;    -- same as _amount_check (amount > 0)

-- ============================================================================
-- CHECK CONSTRAINTS - fix NULL hole on budget_transfers
-- ============================================================================
-- `budget_transfers_different_budgets CHECK (from_budget_id <> to_budget_id)`
-- rejects rows where from_budget_id IS NULL because NULL <> X evaluates to
-- NULL, which postgres treats as false in a CHECK. The sibling
-- `budget_transfers_different_budgets_check`
--   CHECK ((from_budget_id IS NULL) OR (from_budget_id <> to_budget_id))
-- handles NULL correctly (e.g. piggy -> budget transfers, which set
-- from_budget_id to NULL).
ALTER TABLE public.budget_transfers
  DROP CONSTRAINT IF EXISTS budget_transfers_different_budgets;
