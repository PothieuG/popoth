-- Sprint Long-Press-Toggle-Apply-To-Balance (2026-05-23)
--
-- Two atomic composite RPCs to flip the `applied_to_balance_at` flag on a
-- `real_expenses` / `real_income_entries` row AND adjust the matching
-- `bank_balances.balance` in a single Postgres transaction.
--
-- Semantics:
--   - Expense + apply  → balance -= amount  ; applied_to_balance_at = NOW()
--   - Expense + unapply→ balance += amount  ; applied_to_balance_at = NULL
--   - Income  + apply  → balance += amount  ; applied_to_balance_at = NOW()
--   - Income  + unapply→ balance -= amount  ; applied_to_balance_at = NULL
--
-- Concurrency: `SELECT ... FOR UPDATE` on the source row serializes
-- concurrent long-press attempts on the same transaction. The second caller
-- observes the post-first-tx state and the optimistic guard below raises
-- P0002 (mapped to HTTP 409 by the API handler — silently no-op for UI
-- since the optimistic update already reflects the target state).
--
-- Atomicity: composes the existing `update_bank_balance` RPC + the UPDATE
-- on the row itself in a single tx. A failure in either step (e.g. missing
-- bank_balances row, or row deleted between SELECT and UPDATE) rolls back
-- the whole transaction — no half-applied state.
--
-- Naming pattern: mirrors the existing `add_expense_with_*` and
-- `transfer_*_to_*` composites in 20260506000000_create_finance_rpcs.sql.
-- Two separate RPCs (one per table) rather than a single `p_table TEXT`
-- variant: avoids EXECUTE format(...) dynamic SQL (which breaks the
-- planner cache + complicates `pnpm db:audit-functions`).

-- ============================================================================
-- toggle_real_expense_applied_to_balance(p_expense_id, p_apply)
-- ============================================================================
CREATE OR REPLACE FUNCTION toggle_real_expense_applied_to_balance(
  p_expense_id uuid,
  p_apply boolean
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount numeric;
  v_profile_id uuid;
  v_group_id uuid;
  v_currently_applied boolean;
  v_delta numeric;
  v_new_balance numeric;
  v_new_applied_at timestamptz;
BEGIN
  -- FOR UPDATE serializes concurrent toggle attempts on the same row.
  SELECT amount, profile_id, group_id, (applied_to_balance_at IS NOT NULL)
    INTO v_amount, v_profile_id, v_group_id, v_currently_applied
    FROM real_expenses
   WHERE id = p_expense_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'real_expenses row not found: id=%', p_expense_id;
  END IF;

  -- Optimistic guard : reject no-op (already in target state). Raises P0002
  -- which the API handler maps to HTTP 409 / silent UI no-op.
  IF p_apply AND v_currently_applied THEN
    RAISE EXCEPTION 'real_expense % is already applied to balance', p_expense_id
      USING ERRCODE = 'P0002';
  END IF;
  IF NOT p_apply AND NOT v_currently_applied THEN
    RAISE EXCEPTION 'real_expense % is not applied to balance', p_expense_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Expense: apply -> debit balance ; unapply -> credit balance back
  v_delta := CASE WHEN p_apply THEN -v_amount ELSE v_amount END;
  v_new_balance := update_bank_balance(v_delta, v_profile_id, v_group_id);

  v_new_applied_at := CASE WHEN p_apply THEN NOW() ELSE NULL END;
  UPDATE real_expenses
     SET applied_to_balance_at = v_new_applied_at
   WHERE id = p_expense_id;

  RETURN json_build_object(
    'balance', v_new_balance,
    'applied_to_balance_at', v_new_applied_at
  );
END;
$$;

REVOKE ALL ON FUNCTION toggle_real_expense_applied_to_balance(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION toggle_real_expense_applied_to_balance(uuid, boolean) TO service_role;

-- ============================================================================
-- toggle_real_income_applied_to_balance(p_income_id, p_apply)
-- ============================================================================
CREATE OR REPLACE FUNCTION toggle_real_income_applied_to_balance(
  p_income_id uuid,
  p_apply boolean
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount numeric;
  v_profile_id uuid;
  v_group_id uuid;
  v_currently_applied boolean;
  v_delta numeric;
  v_new_balance numeric;
  v_new_applied_at timestamptz;
BEGIN
  SELECT amount, profile_id, group_id, (applied_to_balance_at IS NOT NULL)
    INTO v_amount, v_profile_id, v_group_id, v_currently_applied
    FROM real_income_entries
   WHERE id = p_income_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'real_income_entries row not found: id=%', p_income_id;
  END IF;

  IF p_apply AND v_currently_applied THEN
    RAISE EXCEPTION 'real_income_entry % is already applied to balance', p_income_id
      USING ERRCODE = 'P0002';
  END IF;
  IF NOT p_apply AND NOT v_currently_applied THEN
    RAISE EXCEPTION 'real_income_entry % is not applied to balance', p_income_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Income: apply -> credit balance ; unapply -> debit balance back
  v_delta := CASE WHEN p_apply THEN v_amount ELSE -v_amount END;
  v_new_balance := update_bank_balance(v_delta, v_profile_id, v_group_id);

  v_new_applied_at := CASE WHEN p_apply THEN NOW() ELSE NULL END;
  UPDATE real_income_entries
     SET applied_to_balance_at = v_new_applied_at
   WHERE id = p_income_id;

  RETURN json_build_object(
    'balance', v_new_balance,
    'applied_to_balance_at', v_new_applied_at
  );
END;
$$;

REVOKE ALL ON FUNCTION toggle_real_income_applied_to_balance(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION toggle_real_income_applied_to_balance(uuid, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
