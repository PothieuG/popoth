-- Atomic composite RPC for deleting a budget while transferring its
-- cumulated_savings to the piggy_bank. Used by DELETE /api/finance/budgets
-- (lib/api/finance/budgets.ts DELETE handler) when the user removes a
-- budget that still carries accumulated savings — instead of dropping the
-- savings, we forward them to the user's (or group's) piggy_bank in the
-- same Postgres transaction as the DELETE.
--
-- Pre-fix behavior: DELETE FROM estimated_budgets WHERE id = ... discards
-- cumulated_savings silently. UX-side users had no way to recover the
-- money other than re-creating the budget and adjusting via the monthly
-- recap workflow.
--
-- Pattern: mirrors `transfer_budget_to_piggy_bank` in
-- 20260518000000_create_savings_transfer_rpcs.sql (same UPSERT branches
-- on partial unique indexes) but performs the FROM debit by reading the
-- locked row directly (no need to call update_budget_cumulated_savings)
-- since the budget is about to be deleted — the savings value goes to
-- zero by destruction, not by update.
--
-- FK behavior already configured in the baseline:
--   - real_expenses.estimated_budget_id ON DELETE SET NULL
--   - budget_transfers.from_budget_id   ON DELETE CASCADE
--   - budget_transfers.to_budget_id     ON DELETE CASCADE

CREATE OR REPLACE FUNCTION delete_budget_with_savings_transfer(
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
  v_savings numeric;
  v_piggy_amount numeric;
BEGIN
  IF (p_profile_id IS NULL AND p_group_id IS NULL)
     OR (p_profile_id IS NOT NULL AND p_group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Exactly one of p_profile_id or p_group_id must be provided';
  END IF;

  -- Step 1: lock + read cumulated_savings. The FOR UPDATE prevents
  -- concurrent DELETE / UPDATE on the same budget row during the
  -- transaction. Ownership check is enforced through the WHERE clause
  -- so a budget owned by a different profile/group raises 'not found'.
  SELECT COALESCE(cumulated_savings, 0) INTO v_savings
  FROM estimated_budgets
  WHERE id = p_budget_id
    AND (
      (p_profile_id IS NOT NULL AND profile_id = p_profile_id)
      OR (p_group_id IS NOT NULL AND group_id = p_group_id)
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget not found or not owned by the given context';
  END IF;

  -- Step 2: transfer savings → piggy_bank only when positive. UPSERT
  -- uses partial unique index inference (idx_piggy_bank_profile_id_unique
  -- or idx_piggy_bank_group_id_unique, defined in
  -- 20260508000000_add_piggy_bank_indexes.sql). Either branch performs a
  -- single atomic INSERT-or-credit-existing-row. NOT NULL / CHECK
  -- violations raise and roll back the entire tx (including the
  -- subsequent DELETE).
  IF v_savings > 0 THEN
    IF p_profile_id IS NOT NULL THEN
      INSERT INTO piggy_bank (profile_id, amount, last_updated)
      VALUES (p_profile_id, v_savings, NOW())
      ON CONFLICT (profile_id) WHERE (profile_id IS NOT NULL AND group_id IS NULL) DO UPDATE
        SET amount = piggy_bank.amount + EXCLUDED.amount,
            last_updated = NOW()
      RETURNING amount INTO v_piggy_amount;
    ELSE
      INSERT INTO piggy_bank (group_id, amount, last_updated)
      VALUES (p_group_id, v_savings, NOW())
      ON CONFLICT (group_id) WHERE (group_id IS NOT NULL AND profile_id IS NULL) DO UPDATE
        SET amount = piggy_bank.amount + EXCLUDED.amount,
            last_updated = NOW()
      RETURNING amount INTO v_piggy_amount;
    END IF;
  END IF;

  -- Step 3: DELETE the budget. FK cascades fire:
  --   - real_expenses.estimated_budget_id → SET NULL (orphan, not deleted)
  --   - budget_transfers.from/to_budget_id → CASCADE (audit rows deleted)
  DELETE FROM estimated_budgets WHERE id = p_budget_id;

  RETURN json_build_object(
    'transferred_amount', v_savings,
    'piggy_amount', v_piggy_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION delete_budget_with_savings_transfer(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_budget_with_savings_transfer(uuid, uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
