-- Sprint Auto-Cascade-Piggy / Traceability (2026-05-26)
--
-- Étend les 2 RPCs composite ADD pour INSERT les rows de traçabilité
-- dans `expense_savings_sources` (cf. migration 20260531000000) :
--
--   - `add_expense_with_breakdown` : INSERT 1 row 'piggy' si
--     p_amount_from_piggy_bank > 0, 1 row 'budget_savings' (source =
--     destination budget) si p_amount_from_budget_savings > 0.
--
--   - `add_expense_with_cross_budget_cascade` : INSERT 1 row 'piggy' si
--     p_amount_from_piggy_bank > 0, 1 row 'budget_savings' (source =
--     destination budget) si p_amount_from_local_savings > 0, 1 row
--     'budget_savings' par entrée du jsonb cross-budget cascade.
--
-- Signatures inchangées → CREATE OR REPLACE (pas de DROP nécessaire).
-- Atomicité préservée : les INSERT sources sont dans la même tx que la
-- mutation piggy/savings/real_expenses ; un RAISE sur n'importe quel
-- step roll back l'ensemble.

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

  IF p_amount_from_piggy_bank > 0 THEN
    PERFORM update_piggy_bank_amount(-p_amount_from_piggy_bank, p_profile_id, p_group_id);
  END IF;

  IF p_amount_from_budget_savings > 0 THEN
    PERFORM update_budget_cumulated_savings(p_estimated_budget_id, -p_amount_from_budget_savings);
  END IF;

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

  -- Step 4: trace les sources débitées pour permettre le refund précis
  -- lors d'un DELETE ou d'un UPDATE (Sprint Auto-Cascade-Piggy / Traceability).
  IF p_amount_from_piggy_bank > 0 THEN
    INSERT INTO expense_savings_sources (real_expense_id, source_type, source_budget_id, amount)
      VALUES (v_expense_id, 'piggy', NULL, p_amount_from_piggy_bank);
  END IF;
  IF p_amount_from_budget_savings > 0 THEN
    INSERT INTO expense_savings_sources (real_expense_id, source_type, source_budget_id, amount)
      VALUES (v_expense_id, 'budget_savings', p_estimated_budget_id, p_amount_from_budget_savings);
  END IF;

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

  IF abs((p_amount_from_piggy_bank + p_amount_from_local_savings + p_amount_from_budget + v_cross_total) - p_amount) > 0.01 THEN
    RAISE EXCEPTION 'Breakdown sum (%) does not match total amount (%)',
      p_amount_from_piggy_bank + p_amount_from_local_savings + p_amount_from_budget + v_cross_total,
      p_amount;
  END IF;

  IF p_amount_from_piggy_bank > 0 THEN
    PERFORM update_piggy_bank_amount(-p_amount_from_piggy_bank, p_profile_id, p_group_id);
  END IF;

  IF p_amount_from_local_savings > 0 THEN
    PERFORM update_budget_cumulated_savings(p_estimated_budget_id, -p_amount_from_local_savings);
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_cross_budget_debits)
  LOOP
    v_source_id := (v_entry->>'budget_id')::uuid;
    v_source_amount := (v_entry->>'amount')::numeric;
    PERFORM update_budget_cumulated_savings(v_source_id, -v_source_amount);
  END LOOP;

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

  -- Step 5: trace les sources débitées (piggy + savings locale + chaque cross)
  IF p_amount_from_piggy_bank > 0 THEN
    INSERT INTO expense_savings_sources (real_expense_id, source_type, source_budget_id, amount)
      VALUES (v_expense_id, 'piggy', NULL, p_amount_from_piggy_bank);
  END IF;
  IF p_amount_from_local_savings > 0 THEN
    INSERT INTO expense_savings_sources (real_expense_id, source_type, source_budget_id, amount)
      VALUES (v_expense_id, 'budget_savings', p_estimated_budget_id, p_amount_from_local_savings);
  END IF;
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_cross_budget_debits)
  LOOP
    v_source_id := (v_entry->>'budget_id')::uuid;
    v_source_amount := (v_entry->>'amount')::numeric;
    INSERT INTO expense_savings_sources (real_expense_id, source_type, source_budget_id, amount)
      VALUES (v_expense_id, 'budget_savings', v_source_id, v_source_amount);
  END LOOP;

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
