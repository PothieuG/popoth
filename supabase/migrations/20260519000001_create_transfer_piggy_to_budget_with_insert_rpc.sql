-- Atomic composite RPC for monthly recap auto-balance PHASE 0 — combines
-- the piggy_bank debit with the budget_transfers INSERT (from_budget_id=NULL)
-- in one Postgres transaction. Closes the Sprint Auto-Balance-Atomic
-- (Phase A) hors-scope: pattern B reversed RPC→INSERT for piggy → budget
-- transfers.
--
-- Pre-refactor (auto-balance/route.ts L436-480) the route did:
--   1. updatePiggyBank(aggregate)   <- single RPC, debits the total
--   2. INSERT INTO budget_transfers <- batched rows, from_budget_id=NULL
-- If step 2 failed after step 1 succeeded, piggy_bank was debited with no
-- audit-trail row to reconcile — same audit-trail orphan risk as the
-- savings pattern fixed by transfer_with_savings_debit (Sprint
-- Refactor-I5-followup-v2).
--
-- Pattern: mirrors `transfer_with_savings_debit` in
-- 20260516000000_create_transfer_with_savings_debit_rpc.sql — composes the
-- existing `update_piggy_bank_amount` RPC with a direct INSERT into
-- budget_transfers, both inside the same plpgsql block (one tx, atomic
-- rollback on RAISE).
--
-- Order matters for clean error UX: debit the piggy first (RAISE EXCEPTION
-- on overdraft via CHECK piggy_bank.amount >= 0), then INSERT the audit
-- row. If the INSERT fails (FK violation, CHECK violation), the prior
-- piggy_bank debit rolls back automatically (same tx).

CREATE OR REPLACE FUNCTION transfer_piggy_to_budget_with_insert(
  p_to_budget_id uuid,
  p_amount numeric,
  p_profile_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL,
  p_reason text DEFAULT 'Auto-balance via monthly recap (tirelire)',
  p_recap_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_piggy numeric;
  v_transfer_id uuid;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive (got %)', p_amount;
  END IF;
  IF (p_profile_id IS NULL AND p_group_id IS NULL)
     OR (p_profile_id IS NOT NULL AND p_group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Exactly one of p_profile_id or p_group_id must be provided';
  END IF;

  -- Step 1: debit piggy_bank.amount via the existing atomic RPC. Throws
  -- if amount would go negative (CHECK piggy_bank_amount_check) — the
  -- whole tx rolls back.
  v_new_piggy := update_piggy_bank_amount(-p_amount, p_profile_id, p_group_id);

  -- Step 2: INSERT the audit-trail row with from_budget_id=NULL representing
  -- the piggy_bank as source. Same tx → atomic rollback on error.
  -- transfer_date is left to the column DEFAULT (CURRENT_DATE); created_at
  -- to its DEFAULT (now()).
  INSERT INTO budget_transfers (
    from_budget_id,
    to_budget_id,
    transfer_amount,
    profile_id,
    group_id,
    transfer_reason,
    monthly_recap_id
  ) VALUES (
    NULL,
    p_to_budget_id,
    p_amount,
    p_profile_id,
    p_group_id,
    p_reason,
    p_recap_id
  ) RETURNING id INTO v_transfer_id;

  RETURN json_build_object(
    'transfer_id', v_transfer_id,
    'piggy_bank_amount', v_new_piggy
  );
END;
$$;

REVOKE ALL ON FUNCTION transfer_piggy_to_budget_with_insert(uuid, numeric, uuid, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION transfer_piggy_to_budget_with_insert(uuid, numeric, uuid, uuid, text, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
