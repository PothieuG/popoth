-- Atomic composite RPC for the smart-allocation expense path — combines
-- the piggy_bank debit, the cumulated_savings debit and the
-- real_expenses INSERT in one Postgres transaction. Closes the
-- atomicity gap pinned by the Sprint Refactor-Test-Coverage Cas 4
-- REGRESSION-GUARD test in
-- lib/api/finance/__tests__/expenses-add-with-logic.test.ts.
--
-- Pre-fix sequence in lib/api/finance/expenses-add-with-logic.ts:
--   1. updatePiggyBank(-fromPiggyBank)   — atomic RPC
--   2. updateBudgetCumulatedSavings(-fromBudgetSavings) — atomic RPC
--   3. INSERT real_expenses                — non-RPC, non-atomic
-- If step 3 failed after 1 + 2 succeeded, both debits stayed committed
-- but no expense row was created → user perceived a money loss.
--
-- Pattern: mirrors `transfer_with_savings_debit` in
-- 20260516000000_create_transfer_with_savings_debit_rpc.sql — composes
-- the two existing finance RPCs with a direct INSERT inside the same
-- plpgsql block (one tx, atomic rollback on RAISE).
--
-- Order: debit piggy first, then debit savings, then INSERT audit row.
-- The CHECK constraints (`piggy_bank.amount >= 0`,
-- `estimated_budgets.cumulated_savings >= 0`) cause the underlying RPCs
-- to RAISE EXCEPTION on overdraft, rolling back the whole tx — no
-- partial state.

CREATE OR REPLACE FUNCTION add_expense_with_breakdown(
  p_amount numeric,
  p_description text,
  p_expense_date date,
  p_estimated_budget_id uuid,
  p_amount_from_piggy_bank numeric,
  p_amount_from_budget_savings numeric,
  p_amount_from_budget numeric,
  p_profile_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expense_id uuid;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive (got %)', p_amount;
  END IF;
  IF (p_profile_id IS NULL AND p_group_id IS NULL)
     OR (p_profile_id IS NOT NULL AND p_group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Exactly one of p_profile_id or p_group_id must be provided';
  END IF;
  IF p_amount_from_piggy_bank < 0
     OR p_amount_from_budget_savings < 0
     OR p_amount_from_budget < 0 THEN
    RAISE EXCEPTION 'Breakdown amounts must be non-negative';
  END IF;
  IF abs((p_amount_from_piggy_bank + p_amount_from_budget_savings + p_amount_from_budget) - p_amount) > 0.01 THEN
    RAISE EXCEPTION 'Breakdown sum (%) does not match total amount (%)',
      p_amount_from_piggy_bank + p_amount_from_budget_savings + p_amount_from_budget,
      p_amount;
  END IF;

  -- Step 1: debit piggy_bank if needed. update_piggy_bank_amount raises
  -- if the row is missing OR if amount would become negative — whole tx
  -- rolls back.
  IF p_amount_from_piggy_bank > 0 THEN
    PERFORM update_piggy_bank_amount(-p_amount_from_piggy_bank, p_profile_id, p_group_id);
  END IF;

  -- Step 2: debit cumulated_savings if needed. update_budget_cumulated_savings
  -- raises if cumulated_savings would become negative — whole tx rolls back
  -- (including any step 1 debit applied above).
  IF p_amount_from_budget_savings > 0 THEN
    PERFORM update_budget_cumulated_savings(p_estimated_budget_id, -p_amount_from_budget_savings);
  END IF;

  -- Step 3: INSERT the expense row. NOT NULL / CHECK violations raise
  -- and roll back the previous debits in the same tx.
  INSERT INTO real_expenses (
    profile_id,
    group_id,
    estimated_budget_id,
    amount,
    description,
    expense_date,
    is_exceptional,
    amount_from_piggy_bank,
    amount_from_budget_savings,
    amount_from_budget
  ) VALUES (
    p_profile_id,
    p_group_id,
    p_estimated_budget_id,
    p_amount,
    p_description,
    p_expense_date,
    false,
    p_amount_from_piggy_bank,
    p_amount_from_budget_savings,
    p_amount_from_budget
  ) RETURNING id INTO v_expense_id;

  RETURN json_build_object('expense_id', v_expense_id);
END;
$$;

REVOKE ALL ON FUNCTION add_expense_with_breakdown(numeric, text, date, uuid, numeric, numeric, numeric, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION add_expense_with_breakdown(numeric, text, date, uuid, numeric, numeric, numeric, uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
