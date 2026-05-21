-- Sprint DB / D7 — partial unique indexes on piggy_bank.
--
-- piggy_bank has no indexes besides PK. Queries always filter by either
-- (profile_id, group_id IS NULL) or (group_id, profile_id IS NULL); these
-- two indexes serve those access patterns AND enforce the implicit
-- "at most one piggy_bank per context" invariant that callers already
-- assume (and that the C3 RPCs rely on via single-row UPDATEs).
--
-- The two indexes mirror the bank_balances pattern (lines 295-296 of the
-- 20260101000000_remote_schema.sql baseline).
--
-- Manual revert:
--   DROP INDEX IF EXISTS idx_piggy_bank_profile_id_unique;
--   DROP INDEX IF EXISTS idx_piggy_bank_group_id_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_piggy_bank_profile_id_unique
  ON piggy_bank (profile_id)
  WHERE profile_id IS NOT NULL AND group_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_piggy_bank_group_id_unique
  ON piggy_bank (group_id)
  WHERE group_id IS NOT NULL AND profile_id IS NULL;
