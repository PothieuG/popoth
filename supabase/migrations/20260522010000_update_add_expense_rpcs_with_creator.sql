-- Sprint Group-Transaction-Creator-Avatar (2026-05-22)
--
-- Extends the two composite expense RPCs to capture the creator's profile id
-- so the new `real_expenses.created_by_profile_id` column (added in
-- 20260522000000_add_created_by_to_real_transactions.sql) is populated on
-- INSERT. Without this, the smart-allocation paths (budgeted expenses going
-- through `addExpenseWithBreakdown` / `addExpenseWithCrossBudgetCascade`)
-- would leave the column NULL even for newly-created group transactions —
-- defeating the avatar attribution.
--
-- Pattern: the param is `DEFAULT NULL` so old call sites (if any survived)
-- don't immediately break, but every active call site IS updated in this
-- same sprint to pass `p_created_by_profile_id` explicitly.
--
-- DROP the old signature first — PG can't `CREATE OR REPLACE` a function
-- whose argument list changed (default params don't widen the signature
-- match; the function ID is `(<arg types>)` so adding any new arg is a
-- different function). Without the explicit DROP, PostgREST resolves
-- ambiguity by erroring or by picking the wrong overload.

DROP FUNCTION IF EXISTS add_expense_with_breakdown(
  numeric, text, date, uuid, numeric, numeric, numeric, uuid, uuid
);

CREATE OR REPLACE FUNCTION add_expense_with_breakdown(
  p_amount numeric,
  p_description text,
  p_expense_date date,
  p_estimated_budget_id uuid,
  p_amount_from_piggy_bank numeric,
  p_amount_from_budget_savings numeric,
  p_amount_from_budget numeric,
  p_profile_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL,
  p_created_by_profile_id uuid DEFAULT NULL
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
    amount_from_budget,
    created_by_profile_id
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
    p_amount_from_budget,
    p_created_by_profile_id
  ) RETURNING id INTO v_expense_id;

  RETURN json_build_object('expense_id', v_expense_id);
END;
$$;

REVOKE ALL ON FUNCTION add_expense_with_breakdown(
  numeric, text, date, uuid, numeric, numeric, numeric, uuid, uuid, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION add_expense_with_breakdown(
  numeric, text, date, uuid, numeric, numeric, numeric, uuid, uuid, uuid
) TO service_role;

-- ─── Cross-budget cascade variant ──────────────────────────────────────────

DROP FUNCTION IF EXISTS add_expense_with_cross_budget_cascade(
  numeric, text, date, uuid, numeric, numeric, numeric, jsonb, uuid, uuid
);

CREATE OR REPLACE FUNCTION add_expense_with_cross_budget_cascade(
  p_amount numeric,
  p_description text,
  p_expense_date date,
  p_estimated_budget_id uuid,
  p_amount_from_piggy_bank numeric,
  p_amount_from_local_savings numeric,
  p_amount_from_budget numeric,
  p_cross_budget_debits jsonb,
  p_profile_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL,
  p_created_by_profile_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expense_id uuid;
  v_cross_total numeric := 0;
  v_entry jsonb;
  v_source_id uuid;
  v_source_amount numeric;
BEGIN
  -- ─── Validation ─────────────────────────────────────────────
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive (got %)', p_amount;
  END IF;
  IF (p_profile_id IS NULL AND p_group_id IS NULL)
     OR (p_profile_id IS NOT NULL AND p_group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Exactly one of p_profile_id or p_group_id must be provided';
  END IF;
  IF p_amount_from_piggy_bank < 0
     OR p_amount_from_local_savings < 0
     OR p_amount_from_budget < 0 THEN
    RAISE EXCEPTION 'Local breakdown amounts must be non-negative';
  END IF;
  IF jsonb_typeof(p_cross_budget_debits) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_cross_budget_debits must be a jsonb array';
  END IF;

  -- Compute cross-budget total + validate per-entry positivity + no self-debit
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_cross_budget_debits)
  LOOP
    v_source_id := (v_entry->>'budget_id')::uuid;
    v_source_amount := (v_entry->>'amount')::numeric;
    IF v_source_amount IS NULL OR v_source_amount <= 0 THEN
      RAISE EXCEPTION 'Cross-budget cascade amount must be positive (got %)', v_source_amount;
    END IF;
    IF v_source_id = p_estimated_budget_id THEN
      RAISE EXCEPTION 'Cross-budget source % cannot be the destination budget %',
        v_source_id, p_estimated_budget_id;
    END IF;
    v_cross_total := v_cross_total + v_source_amount;
  END LOOP;

  -- Validate sum invariant
  IF abs((p_amount_from_piggy_bank + p_amount_from_local_savings + p_amount_from_budget + v_cross_total) - p_amount) > 0.01 THEN
    RAISE EXCEPTION 'Breakdown sum (%) does not match total amount (%)',
      p_amount_from_piggy_bank + p_amount_from_local_savings + p_amount_from_budget + v_cross_total,
      p_amount;
  END IF;

  -- ─── Atomic mutations ───────────────────────────────────────
  -- Step 1: debit piggy_bank (always 0 in P4 strict, kept for symmetry)
  IF p_amount_from_piggy_bank > 0 THEN
    PERFORM update_piggy_bank_amount(-p_amount_from_piggy_bank, p_profile_id, p_group_id);
  END IF;

  -- Step 2: debit local destination budget's savings (if any)
  IF p_amount_from_local_savings > 0 THEN
    PERFORM update_budget_cumulated_savings(p_estimated_budget_id, -p_amount_from_local_savings);
  END IF;

  -- Step 3: debit each cross-budget source. RAISE on insufficient savings
  -- rolls back the WHOLE tx (steps 1 + 2 + any prior step 3 iterations).
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_cross_budget_debits)
  LOOP
    v_source_id := (v_entry->>'budget_id')::uuid;
    v_source_amount := (v_entry->>'amount')::numeric;
    PERFORM update_budget_cumulated_savings(v_source_id, -v_source_amount);
  END LOOP;

  -- Step 4: INSERT real_expenses. amount_from_budget_savings stores the
  -- CONSOLIDATED total (local + cross). Sum invariant on the row level:
  -- piggy + (local_savings + cross_total) + budget = amount.
  INSERT INTO real_expenses (
    profile_id, group_id, estimated_budget_id,
    amount, description, expense_date, is_exceptional,
    amount_from_piggy_bank, amount_from_budget_savings, amount_from_budget,
    created_by_profile_id
  ) VALUES (
    p_profile_id, p_group_id, p_estimated_budget_id,
    p_amount, p_description, p_expense_date, false,
    p_amount_from_piggy_bank,
    p_amount_from_local_savings + v_cross_total,
    p_amount_from_budget,
    p_created_by_profile_id
  ) RETURNING id INTO v_expense_id;

  RETURN json_build_object(
    'expense_id', v_expense_id,
    'cross_budget_total', v_cross_total,
    'consolidated_savings', p_amount_from_local_savings + v_cross_total
  );
END;
$$;

REVOKE ALL ON FUNCTION add_expense_with_cross_budget_cascade(
  numeric, text, date, uuid, numeric, numeric, numeric, jsonb, uuid, uuid, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION add_expense_with_cross_budget_cascade(
  numeric, text, date, uuid, numeric, numeric, numeric, jsonb, uuid, uuid, uuid
) TO service_role;

NOTIFY pgrst, 'reload schema';
