-- Sprint Auto-Cascade-Piggy / Traceability (2026-05-26)
--
-- RPC composite atomique pour MODIFIER le montant d'une dépense en
-- appliquant le pattern reverse-then-reapply complet :
--
--   1. Crédite chaque source d'origine (via `expense_savings_sources`).
--   2. Débite chaque nouvelle source (passée en paramètres + JSONB).
--   3. UPDATE la row `real_expenses` avec les nouveaux totaux consolidés.
--   4. DELETE les anciennes rows `expense_savings_sources` (FK CASCADE
--      ne suffit pas : on garde la row real_expense, on remplace juste
--      les sources). INSERT les nouvelles rows.
--
-- Le destination budget (`estimated_budget_id`) est immutable via cette
-- RPC. Pour changer de budget destination, la route doit faire un cycle
-- delete_expense_with_sources_refund + ADD fresh (cas rare).
--
-- Atomique : un RAISE sur n'importe quel step roll back l'ensemble.
-- Si reverse-then-reapply échoue (overdraft impossible, sum mismatch),
-- la dépense reste dans son état d'origine.

CREATE OR REPLACE FUNCTION update_expense_with_sources_reapply(
  p_expense_id uuid,
  p_new_amount numeric,
  p_new_description text,
  p_new_expense_date date,
  p_new_amount_from_piggy_bank numeric,
  p_new_amount_from_local_savings numeric,
  p_new_amount_from_budget numeric,
  p_new_cross_budget_debits jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_group_id uuid;
  v_estimated_budget_id uuid;
  v_old_amount_from_piggy_bank numeric;
  v_old_amount_from_budget_savings numeric;
  v_cross_total numeric := 0;
  v_entry jsonb;
  v_source_id uuid;
  v_source_amount numeric;
  v_source RECORD;
  v_old_sources_count integer := 0;
BEGIN
  IF p_new_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive (got %)', p_new_amount;
  END IF;
  IF p_new_amount_from_piggy_bank < 0
     OR p_new_amount_from_local_savings < 0
     OR p_new_amount_from_budget < 0 THEN
    RAISE EXCEPTION 'New breakdown amounts must be non-negative';
  END IF;
  IF jsonb_typeof(p_new_cross_budget_debits) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_new_cross_budget_debits must be a jsonb array';
  END IF;

  SELECT profile_id, group_id, estimated_budget_id,
         amount_from_piggy_bank, amount_from_budget_savings
    INTO v_profile_id, v_group_id, v_estimated_budget_id,
         v_old_amount_from_piggy_bank, v_old_amount_from_budget_savings
    FROM real_expenses
    WHERE id = p_expense_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'real_expense % not found', p_expense_id;
  END IF;
  IF v_estimated_budget_id IS NULL THEN
    RAISE EXCEPTION 'real_expense % has no destination budget — use exceptional path', p_expense_id;
  END IF;

  -- Valider invariant somme pour les nouvelles sources
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_new_cross_budget_debits)
  LOOP
    v_source_id := (v_entry->>'budget_id')::uuid;
    v_source_amount := (v_entry->>'amount')::numeric;
    IF v_source_amount IS NULL OR v_source_amount <= 0 THEN
      RAISE EXCEPTION 'Cross-budget cascade amount must be positive (got %)', v_source_amount;
    END IF;
    IF v_source_id = v_estimated_budget_id THEN
      RAISE EXCEPTION 'Cross-budget source % cannot be the destination budget %',
        v_source_id, v_estimated_budget_id;
    END IF;
    v_cross_total := v_cross_total + v_source_amount;
  END LOOP;

  IF abs((p_new_amount_from_piggy_bank + p_new_amount_from_local_savings + p_new_amount_from_budget + v_cross_total) - p_new_amount) > 0.01 THEN
    RAISE EXCEPTION 'New breakdown sum (%) does not match new amount (%)',
      p_new_amount_from_piggy_bank + p_new_amount_from_local_savings + p_new_amount_from_budget + v_cross_total,
      p_new_amount;
  END IF;

  -- Step 1: REVERSE — crédite chaque ancienne source.
  SELECT COUNT(*) INTO v_old_sources_count
    FROM expense_savings_sources
    WHERE real_expense_id = p_expense_id;

  IF v_old_sources_count > 0 THEN
    FOR v_source IN
      SELECT source_type, source_budget_id, amount
        FROM expense_savings_sources
        WHERE real_expense_id = p_expense_id
    LOOP
      IF v_source.source_type = 'piggy' THEN
        PERFORM update_piggy_bank_amount(v_source.amount, v_profile_id, v_group_id);
      ELSIF v_source.source_type = 'budget_savings' AND v_source.source_budget_id IS NOT NULL THEN
        PERFORM update_budget_cumulated_savings(v_source.source_budget_id, v_source.amount);
      END IF;
    END LOOP;
  ELSE
    -- Legacy fallback : pas de trace, reverse via colonnes consolidées (au destination budget pour savings).
    IF COALESCE(v_old_amount_from_piggy_bank, 0) > 0 THEN
      PERFORM update_piggy_bank_amount(v_old_amount_from_piggy_bank, v_profile_id, v_group_id);
    END IF;
    IF COALESCE(v_old_amount_from_budget_savings, 0) > 0 THEN
      PERFORM update_budget_cumulated_savings(v_estimated_budget_id, v_old_amount_from_budget_savings);
    END IF;
  END IF;

  -- Step 2: APPLY — débite les nouvelles sources.
  IF p_new_amount_from_piggy_bank > 0 THEN
    PERFORM update_piggy_bank_amount(-p_new_amount_from_piggy_bank, v_profile_id, v_group_id);
  END IF;
  IF p_new_amount_from_local_savings > 0 THEN
    PERFORM update_budget_cumulated_savings(v_estimated_budget_id, -p_new_amount_from_local_savings);
  END IF;
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_new_cross_budget_debits)
  LOOP
    v_source_id := (v_entry->>'budget_id')::uuid;
    v_source_amount := (v_entry->>'amount')::numeric;
    PERFORM update_budget_cumulated_savings(v_source_id, -v_source_amount);
  END LOOP;

  -- Step 3: UPDATE real_expenses avec nouveaux totaux consolidés
  UPDATE real_expenses
    SET amount = p_new_amount,
        description = p_new_description,
        expense_date = p_new_expense_date,
        amount_from_piggy_bank = p_new_amount_from_piggy_bank,
        amount_from_budget_savings = p_new_amount_from_local_savings + v_cross_total,
        amount_from_budget = p_new_amount_from_budget
    WHERE id = p_expense_id;

  -- Step 4: remplacer les rows expense_savings_sources
  DELETE FROM expense_savings_sources WHERE real_expense_id = p_expense_id;

  IF p_new_amount_from_piggy_bank > 0 THEN
    INSERT INTO expense_savings_sources (real_expense_id, source_type, source_budget_id, amount)
      VALUES (p_expense_id, 'piggy', NULL, p_new_amount_from_piggy_bank);
  END IF;
  IF p_new_amount_from_local_savings > 0 THEN
    INSERT INTO expense_savings_sources (real_expense_id, source_type, source_budget_id, amount)
      VALUES (p_expense_id, 'budget_savings', v_estimated_budget_id, p_new_amount_from_local_savings);
  END IF;
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_new_cross_budget_debits)
  LOOP
    v_source_id := (v_entry->>'budget_id')::uuid;
    v_source_amount := (v_entry->>'amount')::numeric;
    INSERT INTO expense_savings_sources (real_expense_id, source_type, source_budget_id, amount)
      VALUES (p_expense_id, 'budget_savings', v_source_id, v_source_amount);
  END LOOP;

  RETURN json_build_object(
    'expense_id', p_expense_id,
    'cross_budget_total', v_cross_total,
    'consolidated_savings', p_new_amount_from_local_savings + v_cross_total
  );
END;
$$;

REVOKE ALL ON FUNCTION update_expense_with_sources_reapply(
  uuid, numeric, text, date, numeric, numeric, numeric, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_expense_with_sources_reapply(
  uuid, numeric, text, date, numeric, numeric, numeric, jsonb
) TO service_role;

NOTIFY pgrst, 'reload schema';
