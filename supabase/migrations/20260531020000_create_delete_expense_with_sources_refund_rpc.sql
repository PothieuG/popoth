-- Sprint Auto-Cascade-Piggy / Traceability (2026-05-26)
--
-- RPC composite atomique pour supprimer une dépense ET rembourser ses
-- sources débitées (piggy + budgets cross) en une seule tx. Lit la trace
-- depuis `expense_savings_sources` et crédite chaque source via les RPCs
-- existantes `update_piggy_bank_amount` / `update_budget_cumulated_savings`.
--
-- Legacy fallback : si la dépense n'a aucune row dans expense_savings_sources
-- (= dépense créée avant le sprint 2026-05-26), on rembourse selon le
-- comportement historique :
--   - amount_from_piggy_bank au piggy_bank du owner
--   - amount_from_budget_savings au cumulated_savings du destination budget
-- L'attribution est imprécise pour les anciennes cascades cross-budget
-- (le total atterrissait sur le destination budget) mais reste cohérente
-- avec le pattern reverseAllocation pré-existant.
--
-- DELETE final → CASCADE auto-supprime les rows expense_savings_sources
-- via la FK CASCADE de la migration 20260531000000.

CREATE OR REPLACE FUNCTION delete_expense_with_sources_refund(
  p_expense_id uuid
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
  v_amount_from_piggy_bank numeric;
  v_amount_from_budget_savings numeric;
  v_sources_count integer := 0;
  v_source RECORD;
BEGIN
  SELECT profile_id, group_id, estimated_budget_id,
         amount_from_piggy_bank, amount_from_budget_savings
    INTO v_profile_id, v_group_id, v_estimated_budget_id,
         v_amount_from_piggy_bank, v_amount_from_budget_savings
    FROM real_expenses
    WHERE id = p_expense_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'real_expense % not found', p_expense_id;
  END IF;

  SELECT COUNT(*) INTO v_sources_count
    FROM expense_savings_sources
    WHERE real_expense_id = p_expense_id;

  IF v_sources_count > 0 THEN
    -- Refund précis via la trace
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
      -- source_budget_id NULL = budget supprimé entre temps : on ignore
      -- silencieusement (edge case rare, argent reste dans le pool global).
    END LOOP;
  ELSE
    -- Legacy fallback : pas de trace, refund selon les colonnes consolidées
    IF COALESCE(v_amount_from_piggy_bank, 0) > 0 THEN
      PERFORM update_piggy_bank_amount(v_amount_from_piggy_bank, v_profile_id, v_group_id);
    END IF;
    IF COALESCE(v_amount_from_budget_savings, 0) > 0 AND v_estimated_budget_id IS NOT NULL THEN
      PERFORM update_budget_cumulated_savings(v_estimated_budget_id, v_amount_from_budget_savings);
    END IF;
  END IF;

  -- DELETE final : FK CASCADE supprime les expense_savings_sources rows
  DELETE FROM real_expenses WHERE id = p_expense_id;

  RETURN json_build_object(
    'expense_id', p_expense_id,
    'sources_refunded', v_sources_count
  );
END;
$$;

REVOKE ALL ON FUNCTION delete_expense_with_sources_refund(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_expense_with_sources_refund(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
