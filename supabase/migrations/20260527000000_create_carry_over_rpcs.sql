-- Sprint 15 V3 — Carry-Over UI (2026-05-27)
--
-- Three atomic composite RPCs powering the post-recap dashboard UX for
-- transactions reported from the prior month (is_carried_over=true).
--
-- Semantics summary:
--
--   toggle_carry_over_and_apply(p_expense_id, p_validate)
--     p_validate=true  : carried+unapplied → validated+applied
--                        is_carried_over=false, applied_to_balance_at=NOW()
--                        bank_balance -= amount  (expense debit)
--                        carried_from_recap_id PRESERVED (memory for reverse)
--     p_validate=false : validated+applied (was-carried) → carried+unapplied
--                        is_carried_over=true,  applied_to_balance_at=NULL
--                        bank_balance += amount  (expense credit-back)
--                        carried_from_recap_id PRESERVED
--
--   toggle_carry_over_and_apply_income(p_income_id, p_validate)
--     Mirror with reversed sign on bank_balance (income credit/debit-back).
--
--   delete_carried_expense_to_piggy(p_expense_id)
--     DELETE the row + credit `piggy_bank.amount += amount` atomically.
--     Inlined `INSERT ... EXCEPTION WHEN unique_violation` to ensure the
--     piggy_bank row exists before `update_piggy_bank_amount` (which raises
--     if the row is missing — fresh account edge case).
--
-- Concurrency: `SELECT ... FOR UPDATE` on the source row. Idempotent no-op
-- raises P0002 (HTTP 409 / silent UI no-op).
-- Atomicity: composes `update_bank_balance` (or `update_piggy_bank_amount`)
-- with the row UPDATE/DELETE in a single tx. Failure rolls back the whole
-- thing — no half-applied state.
--
-- Pattern mirror: 20260523010000_create_toggle_applied_to_balance_rpcs.sql
-- (toggle_real_expense_applied_to_balance) for the toggle shape, plus
-- 20260506000000_create_finance_rpcs.sql (update_piggy_bank_amount) for the
-- piggy crediting primitive.

-- ============================================================================
-- toggle_carry_over_and_apply(p_expense_id, p_validate)
-- ============================================================================
CREATE OR REPLACE FUNCTION toggle_carry_over_and_apply(
  p_expense_id uuid,
  p_validate boolean
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
  v_carried boolean;
  v_applied_at timestamptz;
  v_carried_from_recap_id uuid;
  v_delta numeric;
  v_new_balance numeric;
  v_new_applied_at timestamptz;
BEGIN
  SELECT amount, profile_id, group_id, is_carried_over, applied_to_balance_at, carried_from_recap_id
    INTO v_amount, v_profile_id, v_group_id, v_carried, v_applied_at, v_carried_from_recap_id
    FROM real_expenses
   WHERE id = p_expense_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'real_expenses row not found: id=%', p_expense_id;
  END IF;

  IF p_validate THEN
    -- Direction: carried+unapplied → validated+applied
    IF NOT v_carried OR v_applied_at IS NOT NULL THEN
      RAISE EXCEPTION 'real_expense % is already validated (or never carried)', p_expense_id
        USING ERRCODE = 'P0002';
    END IF;
    v_delta := -v_amount; -- expense debit on validation
    v_new_applied_at := NOW();
    UPDATE real_expenses
       SET is_carried_over = false,
           applied_to_balance_at = v_new_applied_at
     WHERE id = p_expense_id;
  ELSE
    -- Direction: validated+applied (was-carried) → carried+unapplied
    IF v_carried OR v_applied_at IS NULL OR v_carried_from_recap_id IS NULL THEN
      RAISE EXCEPTION 'real_expense % is already carried (or was never carried)', p_expense_id
        USING ERRCODE = 'P0002';
    END IF;
    v_delta := v_amount; -- expense credit-back on de-validation
    v_new_applied_at := NULL;
    UPDATE real_expenses
       SET is_carried_over = true,
           applied_to_balance_at = NULL
     WHERE id = p_expense_id;
  END IF;

  v_new_balance := update_bank_balance(v_delta, v_profile_id, v_group_id);

  RETURN json_build_object(
    'balance', v_new_balance,
    'applied_to_balance_at', v_new_applied_at,
    'is_carried_over', NOT p_validate
  );
END;
$$;

REVOKE ALL ON FUNCTION toggle_carry_over_and_apply(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION toggle_carry_over_and_apply(uuid, boolean) TO service_role;

-- ============================================================================
-- toggle_carry_over_and_apply_income(p_income_id, p_validate)
-- ============================================================================
CREATE OR REPLACE FUNCTION toggle_carry_over_and_apply_income(
  p_income_id uuid,
  p_validate boolean
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
  v_carried boolean;
  v_applied_at timestamptz;
  v_carried_from_recap_id uuid;
  v_delta numeric;
  v_new_balance numeric;
  v_new_applied_at timestamptz;
BEGIN
  SELECT amount, profile_id, group_id, is_carried_over, applied_to_balance_at, carried_from_recap_id
    INTO v_amount, v_profile_id, v_group_id, v_carried, v_applied_at, v_carried_from_recap_id
    FROM real_income_entries
   WHERE id = p_income_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'real_income_entries row not found: id=%', p_income_id;
  END IF;

  IF p_validate THEN
    IF NOT v_carried OR v_applied_at IS NOT NULL THEN
      RAISE EXCEPTION 'real_income_entry % is already validated (or never carried)', p_income_id
        USING ERRCODE = 'P0002';
    END IF;
    v_delta := v_amount; -- income credit on validation
    v_new_applied_at := NOW();
    UPDATE real_income_entries
       SET is_carried_over = false,
           applied_to_balance_at = v_new_applied_at
     WHERE id = p_income_id;
  ELSE
    IF v_carried OR v_applied_at IS NULL OR v_carried_from_recap_id IS NULL THEN
      RAISE EXCEPTION 'real_income_entry % is already carried (or was never carried)', p_income_id
        USING ERRCODE = 'P0002';
    END IF;
    v_delta := -v_amount; -- income debit-back on de-validation
    v_new_applied_at := NULL;
    UPDATE real_income_entries
       SET is_carried_over = true,
           applied_to_balance_at = NULL
     WHERE id = p_income_id;
  END IF;

  v_new_balance := update_bank_balance(v_delta, v_profile_id, v_group_id);

  RETURN json_build_object(
    'balance', v_new_balance,
    'applied_to_balance_at', v_new_applied_at,
    'is_carried_over', NOT p_validate
  );
END;
$$;

REVOKE ALL ON FUNCTION toggle_carry_over_and_apply_income(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION toggle_carry_over_and_apply_income(uuid, boolean) TO service_role;

-- ============================================================================
-- delete_carried_expense_to_piggy(p_expense_id)
-- ============================================================================
-- DELETEs a carry-over expense row and credits the matching piggy_bank row
-- by the same amount, atomically. Requires `is_carried_over = true` on the
-- source row (else raises P0002). Inlined piggy-row ensure handles the
-- fresh-account edge case where the piggy row doesn't exist yet.
CREATE OR REPLACE FUNCTION delete_carried_expense_to_piggy(
  p_expense_id uuid
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
  v_carried boolean;
  v_new_piggy_amount numeric;
BEGIN
  SELECT amount, profile_id, group_id, is_carried_over
    INTO v_amount, v_profile_id, v_group_id, v_carried
    FROM real_expenses
   WHERE id = p_expense_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'real_expenses row not found: id=%', p_expense_id
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_carried THEN
    RAISE EXCEPTION 'real_expense % is not a carry-over (is_carried_over=false)', p_expense_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Ensure piggy_bank row exists for the owner before crediting. The partial
  -- unique indexes (profile_id WHERE group_id IS NULL / group_id WHERE
  -- profile_id IS NULL) make this idempotent: a concurrent INSERT from
  -- another tx surfaces as unique_violation which we swallow.
  BEGIN
    IF v_profile_id IS NOT NULL THEN
      INSERT INTO piggy_bank (profile_id, group_id, amount)
        VALUES (v_profile_id, NULL, 0);
    ELSE
      INSERT INTO piggy_bank (profile_id, group_id, amount)
        VALUES (NULL, v_group_id, 0);
    END IF;
  EXCEPTION WHEN unique_violation THEN
    NULL; -- row already exists, nothing to do
  END;

  -- Delete the carry-over row first (avoids FK / trigger side effects
  -- racing with the piggy update).
  DELETE FROM real_expenses WHERE id = p_expense_id;

  -- Credit the piggy with the freed amount (positive delta).
  v_new_piggy_amount := update_piggy_bank_amount(v_amount, v_profile_id, v_group_id);

  RETURN json_build_object(
    'expense_id', p_expense_id,
    'piggy_credited', v_amount,
    'piggy_new_amount', v_new_piggy_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION delete_carried_expense_to_piggy(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_carried_expense_to_piggy(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
