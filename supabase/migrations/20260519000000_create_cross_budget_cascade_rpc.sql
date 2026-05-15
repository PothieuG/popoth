-- Atomic composite RPC for the P4 Phase 2 cross-budget cascade expense path.
-- Combines:
--   - debit local destination budget's cumulated_savings (if any)
--   - debit each source budget's cumulated_savings (cross-budget array)
--   - INSERT real_expenses row with consolidated breakdown
-- in a single Postgres transaction. Any RAISE rolls back the WHOLE tx —
-- partial cross-budget debits cannot leak.
--
-- Pattern mirrors `add_expense_with_breakdown` in
-- 20260517000000_create_add_expense_with_breakdown_rpc.sql, extending it
-- with the cross-budget jsonb array. The composite tx is what closes the
-- gap between "100% atomic single-budget" (current state) and "100% atomic
-- multi-budget cascade" (Phase 2 goal).
--
-- Sum invariant: piggy + savings_local + budget + cross_budget_total = amount.
-- The `amount_from_budget_savings` column on the inserted row stores the
-- CONSOLIDATED savings consumed (local + cross-budget total) — semantic
-- shift from "savings from the same budget" to "any savings consumed by
-- this expense". Trade-off accepted for MVP simplicity (per-source
-- provenance is recoverable via the source budgets' cumulated_savings
-- delta + expense.created_at correlation).
--
-- P4 strict invariant: piggy NEVER auto-debited (Sprint P4-P5-P6 / Phase A1).
-- The `p_amount_from_piggy_bank` parameter is kept for symmetry with the
-- non-cross-budget RPC; the route handler passes 0.

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
  p_group_id uuid DEFAULT NULL
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
    amount_from_piggy_bank, amount_from_budget_savings, amount_from_budget
  ) VALUES (
    p_profile_id, p_group_id, p_estimated_budget_id,
    p_amount, p_description, p_expense_date, false,
    p_amount_from_piggy_bank,
    p_amount_from_local_savings + v_cross_total,
    p_amount_from_budget
  ) RETURNING id INTO v_expense_id;

  RETURN json_build_object(
    'expense_id', v_expense_id,
    'cross_budget_total', v_cross_total,
    'consolidated_savings', p_amount_from_local_savings + v_cross_total
  );
END;
$$;

REVOKE ALL ON FUNCTION add_expense_with_cross_budget_cascade(
  numeric, text, date, uuid, numeric, numeric, numeric, jsonb, uuid, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION add_expense_with_cross_budget_cascade(
  numeric, text, date, uuid, numeric, numeric, numeric, jsonb, uuid, uuid
) TO service_role;

NOTIFY pgrst, 'reload schema';
