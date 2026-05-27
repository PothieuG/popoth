-- Feature "Salaire auto à la finalisation du recap" (2026-06-05)
--
-- RPC `validate_salary_with_delta` — atomique. Appelée par
-- `POST /api/finance/income/real/validate-salary` (long-press sur le salaire
-- non-validé → SalaryValidationModal → Confirmer).
--
-- Logique :
--   1. SELECT FOR UPDATE la ligne salaire (assert recap_origin_id IS NOT NULL
--      ET applied_to_balance_at IS NULL — sinon RAISE).
--   2. Calcul `delta = ROUND(p_real_amount - row.amount, 2)` (cents-precise,
--      absorbe le drift float de DecimalFormInput).
--   3. Toujours valide la ligne salaire à son montant ORIGINAL :
--        UPDATE real_income_entries SET applied_to_balance_at = NOW(),
--               last_applied_amount = amount WHERE id = p_income_id
--        + crédit bank_balances += amount
--   4. Si delta > 0 → crée + applique un revenu exceptionnel "Équilibrage salaire"
--      à hauteur de delta. Bank balance += delta.
--   5. Si delta < 0 → crée + applique une dépense exceptionnelle "Équilibrage salaire"
--      à hauteur de |delta|. Bank balance -= |delta|.
--   6. Si delta = 0 → rien de plus.
--
-- Tout en 1 transaction (RPC = atomic).
--
-- Retour JSONB : { delta, exceptional_kind?, exceptional_id? }
--   - delta : la différence calculée (positif/negatif/zéro)
--   - exceptional_kind : 'income' | 'expense' | null (si delta=0)
--   - exceptional_id : id de la transaction exceptionnelle créée (si delta!=0)
--
-- Conventions RPC (CLAUDE.md §3) : SECURITY DEFINER, search_path, NOTIFY.

CREATE OR REPLACE FUNCTION public.validate_salary_with_delta(
  p_income_id uuid,
  p_real_amount numeric(10, 2),
  p_created_by_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_amount numeric(10, 2);
  v_profile_id uuid;
  v_recap_origin_id uuid;
  v_applied_to_balance_at timestamptz;
  v_delta numeric(10, 2);
  v_new_balance numeric;
  v_exceptional_income_id uuid;
  v_exceptional_expense_id uuid;
  v_result jsonb;
BEGIN
  -- 1. SELECT FOR UPDATE + assertions
  SELECT amount, profile_id, recap_origin_id, applied_to_balance_at
    INTO v_amount, v_profile_id, v_recap_origin_id, v_applied_to_balance_at
    FROM real_income_entries
   WHERE id = p_income_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'salary income row not found: id=%', p_income_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_recap_origin_id IS NULL THEN
    RAISE EXCEPTION 'row % is not a recap-origin salary income', p_income_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_applied_to_balance_at IS NOT NULL THEN
    RAISE EXCEPTION 'salary income % is already validated', p_income_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'salary income % has NULL profile_id (group salary not supported)', p_income_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 2. Compute delta (cents-precise)
  v_delta := ROUND(p_real_amount - v_amount, 2);

  -- 3. Valide la ligne salaire à son montant ORIGINAL. Si la ligne était
  --    carry-over (cas user qui n'a pas validé le mois précédent → process_recap
  --    transactions a flagué is_carried_over=true), on la dé-flag aussi pour
  --    que le badge "Mois précédent" disparaisse — pattern miroir Part 35
  --    (carryover-validated-exclude-from-rav). `carried_from_recap_id` reste
  --    set (mémoire bidirectionnelle, permet le retour arrière).
  UPDATE real_income_entries
     SET applied_to_balance_at = NOW(),
         last_applied_amount = v_amount,
         is_carried_over = false
   WHERE id = p_income_id;

  v_new_balance := update_bank_balance(v_amount, v_profile_id, NULL);

  -- 4-5-6. Branche delta
  IF v_delta > 0 THEN
    -- Revenu exceptionnel +delta
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
      created_by_profile_id
    ) VALUES (
      v_profile_id,
      NULL,
      v_delta,
      'Équilibrage salaire',
      CURRENT_DATE,
      true,
      false,
      NOW(),
      v_delta,
      p_created_by_profile_id
    )
    RETURNING id INTO v_exceptional_income_id;

    v_new_balance := update_bank_balance(v_delta, v_profile_id, NULL);

    v_result := jsonb_build_object(
      'delta', v_delta,
      'exceptional_kind', 'income',
      'exceptional_id', v_exceptional_income_id,
      'balance', v_new_balance
    );

  ELSIF v_delta < 0 THEN
    -- Dépense exceptionnelle |delta|
    INSERT INTO real_expenses (
      profile_id,
      group_id,
      amount,
      description,
      expense_date,
      is_exceptional,
      is_carried_over,
      applied_to_balance_at,
      last_applied_amount,
      created_by_profile_id
    ) VALUES (
      v_profile_id,
      NULL,
      ABS(v_delta),
      'Équilibrage salaire',
      CURRENT_DATE,
      true,
      false,
      NOW(),
      ABS(v_delta),
      p_created_by_profile_id
    )
    RETURNING id INTO v_exceptional_expense_id;

    v_new_balance := update_bank_balance(v_delta, v_profile_id, NULL);

    v_result := jsonb_build_object(
      'delta', v_delta,
      'exceptional_kind', 'expense',
      'exceptional_id', v_exceptional_expense_id,
      'balance', v_new_balance
    );

  ELSE
    -- delta = 0 : rien de plus
    v_result := jsonb_build_object(
      'delta', 0,
      'exceptional_kind', NULL,
      'exceptional_id', NULL,
      'balance', v_new_balance
    );
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_salary_with_delta(uuid, numeric, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_salary_with_delta(uuid, numeric, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
