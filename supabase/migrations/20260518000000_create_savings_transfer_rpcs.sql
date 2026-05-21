-- Atomic composite RPCs for the savings transfer paths in
-- app/api/savings/transfer/route.ts — replace the manual rollback
-- sequences (2 RPCs + compensating call that may itself fail) by single
-- Postgres transactions. Closes the 3 cleanup-attempts CRITIQUES
-- pinned by Sprint Refactor-Test-Coverage in
-- app/api/savings/transfer/__tests__/route.test.ts (lines 226 / 330 / 369).
--
-- Pre-fix sequences:
--   POST budget→budget (L25-151):
--     1. updateBudgetCumulatedSavings(from, -amount)
--     2. updateBudgetCumulatedSavings(to, +amount)
--        ↳ if fails → manual rollback (may also fail, L123)
--   handleBudgetToPiggyBank UPDATE path:
--     1. updateBudgetCumulatedSavings(from, -amount)
--     2. updatePiggyBank(+amount) OR direct INSERT
--        ↳ if fails → manual rollback (may also fail, L322 / L338)
--
-- Pattern: mirrors `add_expense_with_breakdown` in
-- 20260517000000_create_add_expense_with_breakdown_rpc.sql and
-- `transfer_with_savings_debit` in 20260516000000_create_*.sql.

-- ============================================================================
-- transfer_savings_between_budgets(p_from_budget_id, p_to_budget_id, p_amount, p_profile_id?, p_group_id?)
-- Debit FROM + credit TO in a single tx. Insufficient savings or any
-- raise rolls back BOTH legs atomically.
-- ============================================================================
CREATE OR REPLACE FUNCTION transfer_savings_between_budgets(
  p_from_budget_id uuid,
  p_to_budget_id uuid,
  p_amount numeric,
  p_profile_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_savings numeric;
  v_to_savings numeric;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive (got %)', p_amount;
  END IF;
  IF (p_profile_id IS NULL AND p_group_id IS NULL)
     OR (p_profile_id IS NOT NULL AND p_group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Exactly one of p_profile_id or p_group_id must be provided';
  END IF;
  IF p_from_budget_id = p_to_budget_id THEN
    RAISE EXCEPTION 'p_from_budget_id and p_to_budget_id must differ';
  END IF;

  -- Step 1: debit FROM. update_budget_cumulated_savings raises if
  -- cumulated_savings would become negative — whole tx rolls back.
  v_from_savings := update_budget_cumulated_savings(p_from_budget_id, -p_amount);

  -- Step 2: credit TO. Any raise here (missing row, etc.) rolls back
  -- step 1 in the same tx.
  v_to_savings := update_budget_cumulated_savings(p_to_budget_id, p_amount);

  RETURN json_build_object(
    'from_savings', v_from_savings,
    'to_savings', v_to_savings
  );
END;
$$;

REVOKE ALL ON FUNCTION transfer_savings_between_budgets(uuid, uuid, numeric, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION transfer_savings_between_budgets(uuid, uuid, numeric, uuid, uuid) TO service_role;

-- ============================================================================
-- transfer_budget_to_piggy_bank(p_from_budget_id, p_amount, p_profile_id?, p_group_id?)
-- Debit budget + UPSERT piggy_bank in a single tx. Insufficient budget
-- savings or any raise rolls back BOTH legs atomically.
--
-- UPSERT uses partial unique index inference. The piggy_bank table has
-- two partial unique indexes (idx_piggy_bank_profile_id_unique and
-- idx_piggy_bank_group_id_unique, defined in 20260508000000_add_piggy_bank_indexes.sql).
-- We branch on which ownership is provided and use the matching
-- ON CONFLICT predicate.
-- ============================================================================
CREATE OR REPLACE FUNCTION transfer_budget_to_piggy_bank(
  p_from_budget_id uuid,
  p_amount numeric,
  p_profile_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_savings numeric;
  v_piggy_amount numeric;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive (got %)', p_amount;
  END IF;
  IF (p_profile_id IS NULL AND p_group_id IS NULL)
     OR (p_profile_id IS NOT NULL AND p_group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Exactly one of p_profile_id or p_group_id must be provided';
  END IF;

  -- Step 1: debit budget. update_budget_cumulated_savings raises if
  -- cumulated_savings would become negative — whole tx rolls back
  -- (including any step 2 UPSERT applied above, though step 2 happens
  -- after).
  v_from_savings := update_budget_cumulated_savings(p_from_budget_id, -p_amount);

  -- Step 2: UPSERT piggy_bank. Single-statement atomic INSERT or
  -- credit-existing-row depending on whether the partial unique index
  -- matches. NOT NULL / CHECK violations (e.g. XOR exclusive_check)
  -- raise and roll back the step 1 debit in the same tx.
  IF p_profile_id IS NOT NULL THEN
    INSERT INTO piggy_bank (profile_id, amount, last_updated)
    VALUES (p_profile_id, p_amount, NOW())
    ON CONFLICT (profile_id) WHERE (profile_id IS NOT NULL AND group_id IS NULL) DO UPDATE
      SET amount = piggy_bank.amount + EXCLUDED.amount,
          last_updated = NOW()
    RETURNING amount INTO v_piggy_amount;
  ELSE
    INSERT INTO piggy_bank (group_id, amount, last_updated)
    VALUES (p_group_id, p_amount, NOW())
    ON CONFLICT (group_id) WHERE (group_id IS NOT NULL AND profile_id IS NULL) DO UPDATE
      SET amount = piggy_bank.amount + EXCLUDED.amount,
          last_updated = NOW()
    RETURNING amount INTO v_piggy_amount;
  END IF;

  RETURN json_build_object(
    'from_savings', v_from_savings,
    'piggy_bank_amount', v_piggy_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION transfer_budget_to_piggy_bank(uuid, numeric, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION transfer_budget_to_piggy_bank(uuid, numeric, uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
