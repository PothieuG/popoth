-- Sprint 08 Monthly Recap V3 — RPCs atomiques de finalisation (écran 5).
--
-- 2 RPCs livrées en 1 migration :
--
-- 1. finalize_recap_apply_snapshot(p_recap_id uuid, p_snapshot jsonb) RETURNS json
--    Applique le snapshot JSONB (écrit sprint 07 par save-budget-snapshot) sur
--    estimated_budgets.carryover_spent_amount + carryover_applied_date. Retourne
--    `{ applied: [{ budget_id, amount }] }` pour traçabilité.
--    - Snapshot vide → applied = [].
--    - Budget id inexistant → UPDATE no-op (FOUND=false), pas ajouté à applied.
--
-- 2. process_recap_transactions(p_recap_id uuid, p_profile_id uuid, p_group_id uuid)
--    RETURNS json
--    Pour le contexte (profile XOR group), en 1 statement-block :
--      - DELETE real_expenses + real_income_entries WHERE applied_to_balance_at
--        IS NOT NULL AND is_carried_over = false (transactions validées).
--      - UPDATE real_expenses + real_income_entries SET is_carried_over=true,
--        carried_from_recap_id=p_recap_id WHERE applied_to_balance_at IS NULL
--        AND is_carried_over = false (non-validées → reportées au mois suivant).
--    Retourne `{ deleted_expenses, deleted_incomes, carried_expenses, carried_incomes }`.
--
--    Le filtre `is_carried_over = false` est critique : il évite de re-flagger ou
--    DELETE les rows déjà carried-over depuis un recap antérieur (l'utilisateur a
--    explicitement choisi de les ignorer / différer durant le mois N, on ne doit
--    pas écraser carried_from_recap_id ni les supprimer si un validate tardif
--    venait à se produire).
--
-- Naming pattern : mirror des autres RPC composites (p_ prefix paramètres,
-- SECURITY DEFINER, SET search_path = public, REVOKE PUBLIC / GRANT service_role).
-- NOTIFY pgrst à la fin pour exposer immédiatement les fonctions au schema cache
-- (sinon `.rpc()` lève "Could not find the function").

-- ============================================================================
-- 1) finalize_recap_apply_snapshot
-- ============================================================================

DROP FUNCTION IF EXISTS finalize_recap_apply_snapshot(uuid, jsonb);

CREATE OR REPLACE FUNCTION finalize_recap_apply_snapshot(
  p_recap_id uuid,
  p_snapshot jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_budget_id text;
  v_amount_text text;
  v_amount numeric;
  v_applied jsonb := '[]'::jsonb;
BEGIN
  IF p_recap_id IS NULL THEN
    RAISE EXCEPTION 'finalize_recap_apply_snapshot: p_recap_id is required';
  END IF;

  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object' THEN
    -- Snapshot null ou non-objet → rien à appliquer (return applied=[]).
    RETURN json_build_object('applied', v_applied);
  END IF;

  FOR v_budget_id, v_amount_text IN
    SELECT key, value::text FROM jsonb_each_text(p_snapshot)
  LOOP
    -- jsonb_each_text retourne déjà value comme text (sans quotes JSON).
    v_amount := v_amount_text::numeric;

    UPDATE estimated_budgets
       SET carryover_spent_amount = COALESCE(carryover_spent_amount, 0) + v_amount,
           carryover_applied_date = now()
     WHERE id = v_budget_id::uuid;

    IF FOUND THEN
      v_applied := v_applied || jsonb_build_array(
        jsonb_build_object('budget_id', v_budget_id, 'amount', v_amount)
      );
    END IF;
  END LOOP;

  RETURN json_build_object('applied', v_applied);
END;
$$;

REVOKE ALL ON FUNCTION finalize_recap_apply_snapshot(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finalize_recap_apply_snapshot(uuid, jsonb) TO service_role;

-- ============================================================================
-- 2) process_recap_transactions
-- ============================================================================

DROP FUNCTION IF EXISTS process_recap_transactions(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION process_recap_transactions(
  p_recap_id uuid,
  p_profile_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_expenses int := 0;
  v_deleted_incomes int := 0;
  v_carried_expenses int := 0;
  v_carried_incomes int := 0;
BEGIN
  IF p_recap_id IS NULL THEN
    RAISE EXCEPTION 'process_recap_transactions: p_recap_id is required';
  END IF;

  -- Mutual-exclusivity guard : exactement 1 des 2 owner-ids doit être set
  -- (mirror de la CHECK constraint monthly_recaps_owner_exclusive_check).
  IF (p_profile_id IS NULL AND p_group_id IS NULL)
     OR (p_profile_id IS NOT NULL AND p_group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'process_recap_transactions: exactly one of p_profile_id / p_group_id must be non-null';
  END IF;

  -- 1. DELETE real_expenses validées (applied_to_balance_at IS NOT NULL)
  WITH deleted AS (
    DELETE FROM real_expenses
     WHERE applied_to_balance_at IS NOT NULL
       AND is_carried_over = false
       AND (p_profile_id IS NULL OR profile_id = p_profile_id)
       AND (p_group_id   IS NULL OR group_id   = p_group_id)
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted_expenses FROM deleted;

  -- 2. DELETE real_income_entries validées
  WITH deleted AS (
    DELETE FROM real_income_entries
     WHERE applied_to_balance_at IS NOT NULL
       AND is_carried_over = false
       AND (p_profile_id IS NULL OR profile_id = p_profile_id)
       AND (p_group_id   IS NULL OR group_id   = p_group_id)
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted_incomes FROM deleted;

  -- 3. Flag non-validées (real_expenses) comme carried_over
  WITH updated AS (
    UPDATE real_expenses
       SET is_carried_over = true,
           carried_from_recap_id = p_recap_id
     WHERE applied_to_balance_at IS NULL
       AND is_carried_over = false
       AND (p_profile_id IS NULL OR profile_id = p_profile_id)
       AND (p_group_id   IS NULL OR group_id   = p_group_id)
    RETURNING 1
  )
  SELECT count(*) INTO v_carried_expenses FROM updated;

  -- 4. Flag non-validées (real_income_entries) comme carried_over
  WITH updated AS (
    UPDATE real_income_entries
       SET is_carried_over = true,
           carried_from_recap_id = p_recap_id
     WHERE applied_to_balance_at IS NULL
       AND is_carried_over = false
       AND (p_profile_id IS NULL OR profile_id = p_profile_id)
       AND (p_group_id   IS NULL OR group_id   = p_group_id)
    RETURNING 1
  )
  SELECT count(*) INTO v_carried_incomes FROM updated;

  RETURN json_build_object(
    'deleted_expenses', v_deleted_expenses,
    'deleted_incomes',  v_deleted_incomes,
    'carried_expenses', v_carried_expenses,
    'carried_incomes',  v_carried_incomes
  );
END;
$$;

REVOKE ALL ON FUNCTION process_recap_transactions(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION process_recap_transactions(uuid, uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
