-- Atomic finance RPCs to eliminate SELECT-then-UPDATE race conditions on
-- piggy_bank.amount, bank_balances.balance and estimated_budgets.cumulated_savings.
--
-- Each RPC performs a single UPDATE with `column = column + p_delta` so concurrent
-- callers always converge to the correct value (Postgres serialises row writes).

-- ============================================================================
-- update_piggy_bank_amount(p_delta, p_profile_id?, p_group_id?)
-- ============================================================================
CREATE OR REPLACE FUNCTION update_piggy_bank_amount(
  p_delta numeric,
  p_profile_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_amount numeric;
BEGIN
  IF (p_profile_id IS NULL AND p_group_id IS NULL)
     OR (p_profile_id IS NOT NULL AND p_group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Exactly one of p_profile_id or p_group_id must be provided';
  END IF;

  IF p_profile_id IS NOT NULL THEN
    UPDATE piggy_bank
       SET amount = amount + p_delta
     WHERE profile_id = p_profile_id
       AND group_id IS NULL
    RETURNING amount INTO v_new_amount;
  ELSE
    UPDATE piggy_bank
       SET amount = amount + p_delta
     WHERE group_id = p_group_id
       AND profile_id IS NULL
    RETURNING amount INTO v_new_amount;
  END IF;

  IF v_new_amount IS NULL THEN
    RAISE EXCEPTION 'piggy_bank row not found for the given context';
  END IF;

  IF v_new_amount < 0 THEN
    RAISE EXCEPTION 'piggy_bank amount cannot become negative (current: %)', v_new_amount;
  END IF;

  RETURN v_new_amount;
END;
$$;

REVOKE ALL ON FUNCTION update_piggy_bank_amount(numeric, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_piggy_bank_amount(numeric, uuid, uuid) TO service_role;

-- ============================================================================
-- update_bank_balance(p_delta, p_profile_id?, p_group_id?)
-- ============================================================================
CREATE OR REPLACE FUNCTION update_bank_balance(
  p_delta numeric,
  p_profile_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance numeric;
BEGIN
  IF (p_profile_id IS NULL AND p_group_id IS NULL)
     OR (p_profile_id IS NOT NULL AND p_group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Exactly one of p_profile_id or p_group_id must be provided';
  END IF;

  IF p_profile_id IS NOT NULL THEN
    UPDATE bank_balances
       SET balance = balance + p_delta
     WHERE profile_id = p_profile_id
       AND group_id IS NULL
    RETURNING balance INTO v_new_balance;
  ELSE
    UPDATE bank_balances
       SET balance = balance + p_delta
     WHERE group_id = p_group_id
       AND profile_id IS NULL
    RETURNING balance INTO v_new_balance;
  END IF;

  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'bank_balances row not found for the given context';
  END IF;

  RETURN v_new_balance;
END;
$$;

REVOKE ALL ON FUNCTION update_bank_balance(numeric, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_bank_balance(numeric, uuid, uuid) TO service_role;

-- ============================================================================
-- update_budget_cumulated_savings(p_budget_id, p_delta)
-- ============================================================================
CREATE OR REPLACE FUNCTION update_budget_cumulated_savings(
  p_budget_id uuid,
  p_delta numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_amount numeric;
BEGIN
  UPDATE estimated_budgets
     SET cumulated_savings = cumulated_savings + p_delta,
         last_savings_update = NOW()
   WHERE id = p_budget_id
  RETURNING cumulated_savings INTO v_new_amount;

  IF v_new_amount IS NULL THEN
    RAISE EXCEPTION 'estimated_budgets row not found: id=%', p_budget_id;
  END IF;

  IF v_new_amount < 0 THEN
    RAISE EXCEPTION 'cumulated_savings cannot become negative (current: %)', v_new_amount;
  END IF;

  RETURN v_new_amount;
END;
$$;

REVOKE ALL ON FUNCTION update_budget_cumulated_savings(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_budget_cumulated_savings(uuid, numeric) TO service_role;

-- ============================================================================
-- transfer_from_piggy_to_budget(p_amount, p_budget_id, p_profile_id?, p_group_id?)
-- Composes the two RPCs above in a single transaction.
-- ============================================================================
CREATE OR REPLACE FUNCTION transfer_from_piggy_to_budget(
  p_amount numeric,
  p_budget_id uuid,
  p_profile_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_piggy numeric;
  v_new_savings numeric;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive (got %)', p_amount;
  END IF;

  v_new_piggy := update_piggy_bank_amount(-p_amount, p_profile_id, p_group_id);
  v_new_savings := update_budget_cumulated_savings(p_budget_id, p_amount);

  RETURN json_build_object(
    'piggy_bank', v_new_piggy,
    'cumulated_savings', v_new_savings
  );
END;
$$;

REVOKE ALL ON FUNCTION transfer_from_piggy_to_budget(numeric, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION transfer_from_piggy_to_budget(numeric, uuid, uuid, uuid) TO service_role;
