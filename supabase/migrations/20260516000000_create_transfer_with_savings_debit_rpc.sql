-- Atomic composite RPC for monthly recap step 2.4.2 — combines the
-- budget_transfers INSERT with the cumulated_savings debit in one
-- Postgres transaction. Closes the pre-Sprint Refactor-I5-followup-v2
-- atomicity gap where a successful INSERT followed by a thrown RPC
-- left orphaned audit-trail rows claiming a transfer that never debited
-- the source budget.
--
-- Pattern: mirrors `transfer_from_piggy_to_budget` in
-- 20260506000000_create_finance_rpcs.sql — composes the existing
-- `update_budget_cumulated_savings` RPC with a direct INSERT, both
-- inside the same plpgsql block (one tx, atomic rollback on RAISE).
--
-- Order matters for clean error UX: debit the savings first (RAISE
-- EXCEPTION on insufficient funds), then INSERT the audit row. If the
-- INSERT fails (CHECK violation, FK violation), the prior UPDATE on
-- estimated_budgets rolls back automatically (same tx).

CREATE OR REPLACE FUNCTION transfer_with_savings_debit(
  p_from_budget_id uuid,
  p_to_budget_id uuid,
  p_amount numeric,
  p_profile_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL,
  p_reason text DEFAULT 'Renflouage déficit depuis économies cumulées (récap)'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_savings numeric;
  v_transfer_id uuid;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive (got %)', p_amount;
  END IF;
  IF p_from_budget_id = p_to_budget_id THEN
    RAISE EXCEPTION 'from_budget_id and to_budget_id must differ';
  END IF;
  IF (p_profile_id IS NULL AND p_group_id IS NULL)
     OR (p_profile_id IS NOT NULL AND p_group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Exactly one of p_profile_id or p_group_id must be provided';
  END IF;

  -- Step 1: debit cumulated_savings via the existing atomic RPC. Throws
  -- if cumulated_savings would go negative — the whole tx rolls back.
  v_new_savings := update_budget_cumulated_savings(p_from_budget_id, -p_amount);

  -- Step 2: INSERT the audit-trail row. Same tx → atomic rollback on
  -- error. transfer_date is left to the column DEFAULT (CURRENT_DATE);
  -- created_at to its DEFAULT (now()).
  INSERT INTO budget_transfers (
    from_budget_id,
    to_budget_id,
    transfer_amount,
    profile_id,
    group_id,
    transfer_reason
  ) VALUES (
    p_from_budget_id,
    p_to_budget_id,
    p_amount,
    p_profile_id,
    p_group_id,
    p_reason
  ) RETURNING id INTO v_transfer_id;

  RETURN json_build_object(
    'transfer_id', v_transfer_id,
    'cumulated_savings', v_new_savings
  );
END;
$$;

REVOKE ALL ON FUNCTION transfer_with_savings_debit(uuid, uuid, numeric, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION transfer_with_savings_debit(uuid, uuid, numeric, uuid, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
