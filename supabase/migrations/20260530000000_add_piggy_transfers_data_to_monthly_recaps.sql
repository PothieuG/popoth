-- Sprint Recap-Positive-Consume-Surplus (2026-05-25).
--
-- Adds piggy_transfers_data JSONB tracker to monthly_recaps. Mirrors the
-- existing budget_snapshot_data + refloated_from_* trackers used by the
-- negative-flow BilanNegativeStep, but for the positive flow.
--
-- Why: BilanPositiveStep transfers each budget's monthly surplus toward the
-- piggy bank via transfer_budget_to_piggy_bank (decrements cumulated_savings,
-- UPSERTs piggy_bank.amount). Surplus is derived `max(0, estimated -
-- spent_this_month)` and the transfer touches NEITHER spent_this_month NOR a
-- recap tracker — so loadRecapSummary recomputes the SAME surplus after the
-- transfer, leaving the UI list stuck (lines don't disappear, button stays
-- active, drawer re-lists already-transferred budgets).
--
-- This column lets loadRecapSummary subtract `piggy_transfers_data[budgetId]`
-- from `spent_this_month` when computing surplus → the per-budget surplus
-- reaches 0 once the transfer is recorded → BilanPositiveStep's existing
-- `filter(surplus > 0)` + `!hasSurplus` UI gates fire mechanically.
--
-- DEFAULT '{}' so recaps that pre-date this migration carry no transferred
-- amounts and continue to compute exactly the same surplus values they did
-- before — no backfill required.

ALTER TABLE monthly_recaps
  ADD COLUMN piggy_transfers_data jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN monthly_recaps.piggy_transfers_data IS
  'Sprint Recap-Positive-Consume-Surplus (2026-05-25). JSONB { [budgetId]: amount } '
  'of surpluses already transferred to the piggy bank during this active recap. '
  'Subtracted from the computed surplus in loadRecapSummary so BilanPositiveStep '
  'mechanically hides budgets already handled. Mirrors budget_snapshot_data + '
  'refloated_from_* used by the negative flow (sprint 13).';

NOTIFY pgrst, 'reload schema';
