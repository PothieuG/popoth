-- Sprint Long-Press-Toggle-Apply-To-Balance (2026-05-23)
--
-- Adds an `applied_to_balance_at` audit-trail column on the two real
-- transaction tables. The column is NULL when the transaction has not been
-- applied to `bank_balances.balance`, or a TIMESTAMPTZ when it has — set
-- by the user via a long-press toggle on `<TransactionListItem>` (cf.
-- composite RPCs `toggle_real_*_applied_to_balance` in the sibling
-- 20260523010000 migration).
--
-- Before this feature, no `/api/finance/*` route mutated
-- `bank_balances.balance` (it was edited solely via `POST /api/bank-balance`
-- from the settings drawer). The toggle becomes the second path that mutates
-- the bank balance — gated per-transaction by the user's explicit gesture.
--
-- Column is NULLABLE and historical rows stay NULL (= not applied). No
-- backfill: existing transactions retain the prior implicit semantics
-- ("never auto-applied"). The user can long-press-toggle them retroactively
-- if desired.
--
-- Partial indexes WHERE applied_to_balance_at IS NOT NULL: the majority of
-- rows are NULL, and the only queries that filter on this column are looking
-- for the "applied" subset (e.g. audit dashboards, future reconciliation
-- views). The partial index keeps the b-tree tiny and avoids paying index
-- maintenance cost on the common-case NULL writes.

ALTER TABLE real_expenses
  ADD COLUMN applied_to_balance_at TIMESTAMPTZ NULL;

ALTER TABLE real_income_entries
  ADD COLUMN applied_to_balance_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_real_expenses_applied_to_balance
  ON real_expenses(applied_to_balance_at) WHERE applied_to_balance_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_real_income_entries_applied_to_balance
  ON real_income_entries(applied_to_balance_at) WHERE applied_to_balance_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
