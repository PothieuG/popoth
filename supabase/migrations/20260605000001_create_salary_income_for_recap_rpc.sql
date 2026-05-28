-- Feature "Salaire auto à la finalisation du recap" (2026-06-05)
--
-- RPC `create_salary_income_for_recap` — invoquée par
-- `executeCompleteRecap` (Sprint 08 V3 step 3.5) UNIQUEMENT en mode solo
-- (context='profile'), juste après `process_recap_transactions` et avant
-- l'UPDATE `monthly_recaps.completed_at`.
--
-- Crée 1 ligne `real_income_entries` avec :
--   - `description = 'Salaire'`
--   - `amount = profile.salary`
--   - `is_exceptional = false` (impact bank_balance only — pas de double-count
--     avec `totalIncomeContribution` virtuel qui aggrège déjà profile.salary)
--   - `applied_to_balance_at = NULL` (non-validée initialement — user doit
--     long-press + modal pour confirmer)
--   - `recap_origin_id = p_recap_id` (trace + idempotence via partial unique
--     index — un autre appel sur le même recap ne crée pas de doublon)
--   - `created_by_profile_id = p_profile_id` (avatar = l'user du recap solo)
--
-- Skip si `profile.salary IS NULL OR profile.salary <= 0` (cas étudiant /
-- chômeur / congé sans solde) — décision utilisateur explicite.
--
-- Idempotence : ON CONFLICT (recap_origin_id) WHERE recap_origin_id IS NOT NULL
-- DO NOTHING — safe à rejouer si executeCompleteRecap retry (cas rare car
-- la route short-circuit via completed_at, mais filet défense).
--
-- Convention RPC (CLAUDE.md §3) : SECURITY DEFINER, search_path, NOTIFY.

CREATE OR REPLACE FUNCTION public.create_salary_income_for_recap(
  p_recap_id uuid,
  p_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_salary numeric(10, 2);
  v_inserted_id uuid;
BEGIN
  -- Lit le salaire (peut être NULL si profile incomplet ; le default
  -- applicatif est 0 mais la colonne est nullable côté schema).
  SELECT salary INTO v_salary
    FROM profiles
   WHERE id = p_profile_id;

  -- Skip silencieux si pas de salaire à matérialiser.
  IF v_salary IS NULL OR v_salary <= 0 THEN
    RETURN jsonb_build_object('created', false, 'reason', 'no_salary');
  END IF;

  -- INSERT idempotent. La partial unique index sur recap_origin_id garantit
  -- qu'un seul INSERT réussit par recap ; les rejouent sont des no-ops.
  INSERT INTO real_income_entries (
    profile_id,
    group_id,
    amount,
    description,
    entry_date,
    is_exceptional,
    is_carried_over,
    applied_to_balance_at,
    last_applied_amount,
    recap_origin_id,
    created_by_profile_id
  ) VALUES (
    p_profile_id,
    NULL,
    v_salary,
    'Salaire',
    CURRENT_DATE,
    false,
    false,
    NULL,
    NULL,
    p_recap_id,
    p_profile_id
  )
  ON CONFLICT (recap_origin_id) WHERE recap_origin_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NULL THEN
    -- Conflit déjà résolu (rejoue idempotent).
    RETURN jsonb_build_object('created', false, 'reason', 'already_exists');
  END IF;

  RETURN jsonb_build_object('created', true, 'income_id', v_inserted_id, 'amount', v_salary);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_salary_income_for_recap(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_salary_income_for_recap(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
