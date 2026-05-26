-- Sprint Projets-Épargne 08 (2026-05-26).
--
-- Adds project_snapshot_data JSONB tracker to monthly_recaps. Sibling of
-- budget_snapshot_data (sprint 07 V3) — records the per-project virtual
-- refund computed by POST /api/monthly-recap/refloat-from-projects. The
-- snapshot is deferred and applied at finalize (sprint 10) via the existing
-- apply_recap_projects_snapshot RPC (sprint 01).
--
-- Why a separate column from budget_snapshot_data:
--   - Snapshots target different tables at apply-time. budget_snapshot_data
--     feeds carryover_spent_amount on estimated_budgets; project_snapshot_data
--     feeds amount_saved + pending_delay_fraction on savings_projects.
--   - Keeping them split keeps the finalize RPC unambiguous and lets the
--     deficit-math helper sum them independently.
--
-- Subtracted from deficitRemaining in computeDeficitRemaining alongside the
-- existing tracker so BilanNegativeStep advances mechanically as projects
-- absorb part of the deficit (between refloat-from-savings and the budget
-- snapshot step — cf. plans/09 cascade UI).
--
-- DEFAULT '{}' so recaps that pre-date this migration carry no project
-- snapshot and continue to compute exactly the same deficit they did before
-- — no backfill required.

ALTER TABLE monthly_recaps
  ADD COLUMN project_snapshot_data jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN monthly_recaps.project_snapshot_data IS
  'Sprint Projets-Épargne 08 (2026-05-26). JSONB { [project_id]: refund_amount } '
  'computed by /api/monthly-recap/refloat-from-projects. Deferred — applied at '
  'finalize (sprint 10) via apply_recap_projects_snapshot. Subtracted from '
  'deficitRemaining alongside refloated_from_piggy + refloated_from_savings + '
  'sum(budget_snapshot_data) in computeDeficitRemaining.';

NOTIFY pgrst, 'reload schema';
