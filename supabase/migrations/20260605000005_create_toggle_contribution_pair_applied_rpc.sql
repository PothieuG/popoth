-- Feature "Contribution au groupe — validation atomique pair" (2026-06-05)
--
-- RPC orchestratrice `toggle_contribution_pair_applied` — appelée par les
-- handlers toggle-applied (expense + income) quand la row touchée a
-- `contribution_id != null`. Toggle apply/un-apply ATOMIQUE des 2 rows :
--   - real_expenses (côté user perso) → débit/crédit bank_balance(profile)
--   - real_income_entries (côté groupe miroir) → crédit/débit bank_balance(group)
--
-- Le couplage est exigé par la spec produit : "Si maintenant on valide la
-- dépense côté utilisateur, le revenu côté groupe devrait automatiquement
-- être validé, et vice-versa." Une seule RPC orchestre les 2 toggles pour
-- éviter une éventuelle récursion entre les 2 single-side RPCs existantes.
--
-- Comportement :
--   - Pour CHAQUE côté indépendamment, applique la logique drift-aware
--     du Sprint 16 V3 (cf. 20260528020000) :
--       * Si NOT applied → apply standard (delta = amount).
--       * Si applied ET last_applied != amount → re-apply au delta (drift).
--       * Si applied ET last_applied = amount → skip (déjà sync ce côté).
--   - À l'un-apply, restitue `last_applied_amount` (pas amount — important
--     si le montant a changé entre apply et un-apply).
--   - Au moins UN des 2 côtés DOIT avoir changé pour considérer le toggle
--     comme une action (sinon raise P0002 mappé en 409 no-op côté UI).
--
-- Sémantique signe :
--   - EXPENSE apply : DÉBITE bank_balance(profile) (-amount)
--   - INCOME apply :  CRÉDITE bank_balance(group) (+amount)
--   - EXPENSE un-apply : CRÉDITE bank_balance(profile) (+last_applied)
--   - INCOME un-apply :  DÉBITE bank_balance(group) (-last_applied)
--
-- Pré-requis : les 2 bank_balances rows (profile + group) doivent exister.
-- L'appelant (handler route) doit ensureBankBalanceRow pour les 2 contextes
-- avant d'appeler cette RPC.

CREATE OR REPLACE FUNCTION public.toggle_contribution_pair_applied(
  p_contribution_id uuid,
  p_apply boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_expense_id uuid;
  v_expense_amount numeric;
  v_expense_profile_id uuid;
  v_expense_applied_at timestamptz;
  v_expense_last_applied numeric;
  v_income_id uuid;
  v_income_amount numeric;
  v_income_group_id uuid;
  v_income_applied_at timestamptz;
  v_income_last_applied numeric;
  v_expense_changed boolean := false;
  v_income_changed boolean := false;
  v_expense_balance numeric := NULL;
  v_income_balance numeric := NULL;
BEGIN
  -- FOR UPDATE serializes concurrent toggles on the pair.
  SELECT id, amount, profile_id, applied_to_balance_at, last_applied_amount
    INTO v_expense_id, v_expense_amount, v_expense_profile_id,
         v_expense_applied_at, v_expense_last_applied
    FROM real_expenses
   WHERE contribution_id = p_contribution_id
     FOR UPDATE;

  SELECT id, amount, group_id, applied_to_balance_at, last_applied_amount
    INTO v_income_id, v_income_amount, v_income_group_id,
         v_income_applied_at, v_income_last_applied
    FROM real_income_entries
   WHERE contribution_id = p_contribution_id
     FOR UPDATE;

  IF v_expense_id IS NULL THEN
    RAISE EXCEPTION 'contribution expense not found for contribution_id=%', p_contribution_id;
  END IF;
  IF v_income_id IS NULL THEN
    RAISE EXCEPTION 'contribution income not found for contribution_id=%', p_contribution_id;
  END IF;

  IF p_apply THEN
    -- ============================================================
    -- APPLY EXPENSE side (débit bank_balance(profile))
    -- ============================================================
    IF v_expense_applied_at IS NULL THEN
      v_expense_balance := update_bank_balance(-v_expense_amount, v_expense_profile_id, NULL);
      UPDATE real_expenses
         SET applied_to_balance_at = NOW(),
             last_applied_amount = v_expense_amount
       WHERE id = v_expense_id;
      v_expense_changed := true;
    ELSIF v_expense_last_applied IS DISTINCT FROM v_expense_amount THEN
      -- Drift re-apply : compense le delta entre new amount et last_applied.
      v_expense_balance := update_bank_balance(
        -(v_expense_amount - COALESCE(v_expense_last_applied, 0)),
        v_expense_profile_id, NULL
      );
      UPDATE real_expenses
         SET applied_to_balance_at = NOW(),
             last_applied_amount = v_expense_amount
       WHERE id = v_expense_id;
      v_expense_changed := true;
    END IF;

    -- ============================================================
    -- APPLY INCOME side (crédit bank_balance(group))
    -- ============================================================
    IF v_income_applied_at IS NULL THEN
      v_income_balance := update_bank_balance(v_income_amount, NULL, v_income_group_id);
      UPDATE real_income_entries
         SET applied_to_balance_at = NOW(),
             last_applied_amount = v_income_amount
       WHERE id = v_income_id;
      v_income_changed := true;
    ELSIF v_income_last_applied IS DISTINCT FROM v_income_amount THEN
      v_income_balance := update_bank_balance(
        v_income_amount - COALESCE(v_income_last_applied, 0),
        NULL, v_income_group_id
      );
      UPDATE real_income_entries
         SET applied_to_balance_at = NOW(),
             last_applied_amount = v_income_amount
       WHERE id = v_income_id;
      v_income_changed := true;
    END IF;

  ELSE
    -- ============================================================
    -- UN-APPLY EXPENSE side (crédit bank_balance(profile) = restitution)
    -- ============================================================
    IF v_expense_applied_at IS NOT NULL THEN
      v_expense_balance := update_bank_balance(
        COALESCE(v_expense_last_applied, v_expense_amount),
        v_expense_profile_id, NULL
      );
      UPDATE real_expenses
         SET applied_to_balance_at = NULL,
             last_applied_amount = NULL
       WHERE id = v_expense_id;
      v_expense_changed := true;
    END IF;

    -- ============================================================
    -- UN-APPLY INCOME side (débit bank_balance(group) = restitution)
    -- ============================================================
    IF v_income_applied_at IS NOT NULL THEN
      v_income_balance := update_bank_balance(
        -COALESCE(v_income_last_applied, v_income_amount),
        NULL, v_income_group_id
      );
      UPDATE real_income_entries
         SET applied_to_balance_at = NULL,
             last_applied_amount = NULL
       WHERE id = v_income_id;
      v_income_changed := true;
    END IF;
  END IF;

  -- Aucun côté changé = pair déjà en état cible → P0002 no-op (mappé 409 UI).
  IF NOT v_expense_changed AND NOT v_income_changed THEN
    RAISE EXCEPTION 'contribution pair % already in target state', p_contribution_id
      USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'expense_id', v_expense_id,
    'income_id', v_income_id,
    'expense_changed', v_expense_changed,
    'income_changed', v_income_changed,
    'expense_balance', v_expense_balance,
    'income_balance', v_income_balance,
    'applied', p_apply
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.toggle_contribution_pair_applied(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_contribution_pair_applied(uuid, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
