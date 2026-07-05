-- Fix: process_recap_transactions() must never touch contribution-mirror
-- rows (real_expenses/real_income_entries where contribution_id IS NOT
-- NULL). These rows are a perpetually-synced structural link maintained by
-- the AFTER INSERT/UPDATE triggers on group_contributions
-- (20260528010000_create_contribution_sync_triggers.sql,
-- 20260605000004_create_contribution_real_income_triggers.sql) — NOT a
-- one-off dated transaction belonging to "the month that just ended".
--
-- Bug: none of the 4 sub-statements excluded contribution_id IS NOT NULL
-- rows. If a user had validated (long-pressed) their contribution mirror
-- before their recap finalized, step 1 DELETEd it outright — which also
-- fires the BEFORE DELETE trigger credit_balance_on_contribution_delete
-- (built exclusively for the "user leaves group" CASCADE scenario), wrongly
-- crediting bank_balances by last_applied_amount. An unvalidated mirror
-- hitting steps 3/4 got silently and permanently flagged
-- is_carried_over=true, excluding it forever from financial-data.ts's
-- `.is('carried_from_recap_id', null)` RAV queries (nothing ever resets
-- these columns for contribution rows). Confirmed live on a real account
-- 2026-07-05 (see .claude/conventions/operational-rules.md § Contribution
-- dépense virtuelle perso — this RPC previously violated the documented
-- "cycle 100% trigger-piloté" invariant).
--
-- Fix: exempt contribution_id IS NOT NULL rows from all 4 statements. Same
-- name+signature as 20260526000000 — CREATE OR REPLACE only, mirroring the
-- 20260603000000_finalize_overwrite_carryover.sql precedent (never edit an
-- existing migration file in place).

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

  -- 1. DELETE real_expenses validées (applied_to_balance_at IS NOT NULL) —
  --    exempte les mirrors contribution (perpétuels, jamais supprimés ici).
  WITH deleted AS (
    DELETE FROM real_expenses
     WHERE applied_to_balance_at IS NOT NULL
       AND is_carried_over = false
       AND contribution_id IS NULL
       AND (p_profile_id IS NULL OR profile_id = p_profile_id)
       AND (p_group_id   IS NULL OR group_id   = p_group_id)
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted_expenses FROM deleted;

  -- 2. DELETE real_income_entries validées — idem.
  WITH deleted AS (
    DELETE FROM real_income_entries
     WHERE applied_to_balance_at IS NOT NULL
       AND is_carried_over = false
       AND contribution_id IS NULL
       AND (p_profile_id IS NULL OR profile_id = p_profile_id)
       AND (p_group_id   IS NULL OR group_id   = p_group_id)
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted_incomes FROM deleted;

  -- 3. Flag non-validées (real_expenses) comme carried_over — idem (sinon
  --    un mirror non-validé se ferait exclure du RAV pour toujours, rien ne
  --    réinitialise carried_from_recap_id/is_carried_over pour ces rows).
  WITH updated AS (
    UPDATE real_expenses
       SET is_carried_over = true,
           carried_from_recap_id = p_recap_id
     WHERE applied_to_balance_at IS NULL
       AND is_carried_over = false
       AND contribution_id IS NULL
       AND (p_profile_id IS NULL OR profile_id = p_profile_id)
       AND (p_group_id   IS NULL OR group_id   = p_group_id)
    RETURNING 1
  )
  SELECT count(*) INTO v_carried_expenses FROM updated;

  -- 4. Flag non-validées (real_income_entries) comme carried_over — idem.
  WITH updated AS (
    UPDATE real_income_entries
       SET is_carried_over = true,
           carried_from_recap_id = p_recap_id
     WHERE applied_to_balance_at IS NULL
       AND is_carried_over = false
       AND contribution_id IS NULL
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
