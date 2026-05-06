-- Sprint DB / D8 — CHECK constraints on piggy_bank.
--
-- piggy_bank had no CHECK constraints at the schema level. The C3 RPCs
-- (update_piggy_bank_amount, transfer_from_piggy_to_budget) enforce
-- amount >= 0 at runtime, but a direct INSERT/UPDATE via service_role
-- (e.g. seed scripts, one-off migrations) could still create invalid
-- rows. These constraints close that gap.
--
-- The owner_exclusive XOR constraint matches the pattern used by
-- bank_balances, estimated_budgets, real_expenses, monthly_recaps and
-- the other hybrid profile-or-group tables (see baseline lines 252-287).
--
-- Manual revert:
--   ALTER TABLE piggy_bank DROP CONSTRAINT piggy_bank_amount_check;
--   ALTER TABLE piggy_bank DROP CONSTRAINT piggy_bank_owner_exclusive_check;

ALTER TABLE piggy_bank
  ADD CONSTRAINT piggy_bank_amount_check
  CHECK (amount >= 0);

ALTER TABLE piggy_bank
  ADD CONSTRAINT piggy_bank_owner_exclusive_check
  CHECK (
    (profile_id IS NOT NULL AND group_id IS NULL)
    OR (profile_id IS NULL AND group_id IS NOT NULL)
  );
