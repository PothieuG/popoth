-- Feature "Contribution au groupe — dépense virtuelle perso" (2026-05-28)
--
-- Étend `toggle_real_expense_applied_to_balance` pour gérer la
-- re-validation au new montant quand la contribution change après une
-- validation initiale (cas drift sur les rows `contribution_id IS NOT NULL`).
--
-- Nouvelle sémantique (3 branches au lieu de 2) :
--   1. p_apply=true ET pas appliquée → apply standard :
--        balance -= amount ; applied_to_balance_at = NOW ;
--        last_applied_amount = amount.
--   2. p_apply=true ET déjà appliquée ET amount != last_applied_amount
--      → re-apply au new montant (drift sync) :
--        delta = amount - last_applied_amount ; balance -= delta ;
--        applied_to_balance_at reste set (NOW pour refresh) ;
--        last_applied_amount = amount.
--   3. p_apply=true ET déjà appliquée ET amount = last_applied_amount
--      → no-op (déjà sync) : raise P0002 (mappé HTTP 409 / silent UI).
--   4. p_apply=false ET appliquée → un-apply standard :
--        balance += last_applied_amount ;
--        applied_to_balance_at = NULL ; last_applied_amount = NULL.
--   5. p_apply=false ET pas appliquée → no-op : raise P0002.
--
-- Pour les rows NORMALES (contribution_id NULL) : le drift est techniquement
-- impossible car l'UI bloque l'édition d'une dépense appliquée (cf. PUT
-- guard `cannot-edit-applied-transaction`). La nouvelle sémantique est donc
-- transparente — last_applied_amount = amount toujours, branche 3 (no-op).
--
-- Le mécanisme `last_applied_amount` remplace le pattern précédent qui
-- créditait `v_amount` à l'un-apply (incorrect si amount avait changé entre
-- apply et un-apply — cas qui n'arrivait pas avec le PUT-guard mais devient
-- pertinent pour les contribution rows).
--
-- `toggle_real_income_applied_to_balance` (sibling RPC) — pas de drift
-- possible côté revenus (pas de feature contribution-revenu auto-managée),
-- on aligne quand même le pattern pour cohérence : write
-- `last_applied_amount` à chaque apply/un-apply. Symétrique, lisible.

-- ============================================================================
-- toggle_real_expense_applied_to_balance(p_expense_id, p_apply) — V2
-- ============================================================================
CREATE OR REPLACE FUNCTION toggle_real_expense_applied_to_balance(
  p_expense_id uuid,
  p_apply boolean
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount numeric;
  v_profile_id uuid;
  v_group_id uuid;
  v_currently_applied boolean;
  v_last_applied_amount numeric;
  v_delta numeric;
  v_new_balance numeric;
  v_new_applied_at timestamptz;
  v_new_last_applied_amount numeric;
BEGIN
  -- FOR UPDATE serializes concurrent toggle attempts on the same row.
  SELECT
      amount,
      profile_id,
      group_id,
      (applied_to_balance_at IS NOT NULL),
      last_applied_amount
    INTO
      v_amount,
      v_profile_id,
      v_group_id,
      v_currently_applied,
      v_last_applied_amount
    FROM real_expenses
   WHERE id = p_expense_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'real_expenses row not found: id=%', p_expense_id;
  END IF;

  -- Branche apply=true
  IF p_apply THEN
    -- Sous-cas drift : déjà appliquée mais montant a changé (contribution
    -- auto-managée par trigger qui a réécrit `amount` sans toucher
    -- `last_applied_amount`).
    IF v_currently_applied AND v_last_applied_amount IS DISTINCT FROM v_amount THEN
      -- Re-apply au new montant : delta = amount - last_applied_amount.
      -- Si nouveau plus grand → débit supplémentaire ; si plus petit → crédit.
      v_delta := -(v_amount - COALESCE(v_last_applied_amount, 0));
      v_new_balance := update_bank_balance(v_delta, v_profile_id, v_group_id);
      v_new_applied_at := NOW();
      v_new_last_applied_amount := v_amount;
    -- Sous-cas no-op : déjà appliquée ET montant in sync.
    ELSIF v_currently_applied THEN
      RAISE EXCEPTION 'real_expense % is already applied to balance', p_expense_id
        USING ERRCODE = 'P0002';
    -- Sous-cas apply initial : pas encore appliquée.
    ELSE
      v_delta := -v_amount;
      v_new_balance := update_bank_balance(v_delta, v_profile_id, v_group_id);
      v_new_applied_at := NOW();
      v_new_last_applied_amount := v_amount;
    END IF;
  -- Branche apply=false (un-apply)
  ELSE
    IF NOT v_currently_applied THEN
      RAISE EXCEPTION 'real_expense % is not applied to balance', p_expense_id
        USING ERRCODE = 'P0002';
    END IF;
    -- Restitution du montant exactement débité à l'apply (last_applied_amount,
    -- pas amount — important si amount a changé entre temps).
    v_delta := COALESCE(v_last_applied_amount, v_amount);
    v_new_balance := update_bank_balance(v_delta, v_profile_id, v_group_id);
    v_new_applied_at := NULL;
    v_new_last_applied_amount := NULL;
  END IF;

  UPDATE real_expenses
     SET applied_to_balance_at = v_new_applied_at,
         last_applied_amount = v_new_last_applied_amount
   WHERE id = p_expense_id;

  RETURN json_build_object(
    'balance', v_new_balance,
    'applied_to_balance_at', v_new_applied_at
  );
END;
$$;

REVOKE ALL ON FUNCTION toggle_real_expense_applied_to_balance(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION toggle_real_expense_applied_to_balance(uuid, boolean) TO service_role;

-- ============================================================================
-- toggle_real_income_applied_to_balance(p_income_id, p_apply) — V2 (aligned)
-- ============================================================================
-- Symétrique pour cohérence : tracke last_applied_amount à chaque apply/un-apply.
-- Pas de feature drift active côté revenus mais pattern uniforme.

CREATE OR REPLACE FUNCTION toggle_real_income_applied_to_balance(
  p_income_id uuid,
  p_apply boolean
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount numeric;
  v_profile_id uuid;
  v_group_id uuid;
  v_currently_applied boolean;
  v_last_applied_amount numeric;
  v_delta numeric;
  v_new_balance numeric;
  v_new_applied_at timestamptz;
  v_new_last_applied_amount numeric;
BEGIN
  SELECT
      amount,
      profile_id,
      group_id,
      (applied_to_balance_at IS NOT NULL),
      last_applied_amount
    INTO
      v_amount,
      v_profile_id,
      v_group_id,
      v_currently_applied,
      v_last_applied_amount
    FROM real_income_entries
   WHERE id = p_income_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'real_income_entries row not found: id=%', p_income_id;
  END IF;

  IF p_apply THEN
    IF v_currently_applied AND v_last_applied_amount IS DISTINCT FROM v_amount THEN
      v_delta := v_amount - COALESCE(v_last_applied_amount, 0);
      v_new_balance := update_bank_balance(v_delta, v_profile_id, v_group_id);
      v_new_applied_at := NOW();
      v_new_last_applied_amount := v_amount;
    ELSIF v_currently_applied THEN
      RAISE EXCEPTION 'real_income_entry % is already applied to balance', p_income_id
        USING ERRCODE = 'P0002';
    ELSE
      v_delta := v_amount;
      v_new_balance := update_bank_balance(v_delta, v_profile_id, v_group_id);
      v_new_applied_at := NOW();
      v_new_last_applied_amount := v_amount;
    END IF;
  ELSE
    IF NOT v_currently_applied THEN
      RAISE EXCEPTION 'real_income_entry % is not applied to balance', p_income_id
        USING ERRCODE = 'P0002';
    END IF;
    v_delta := -COALESCE(v_last_applied_amount, v_amount);
    v_new_balance := update_bank_balance(v_delta, v_profile_id, v_group_id);
    v_new_applied_at := NULL;
    v_new_last_applied_amount := NULL;
  END IF;

  UPDATE real_income_entries
     SET applied_to_balance_at = v_new_applied_at,
         last_applied_amount = v_new_last_applied_amount
   WHERE id = p_income_id;

  RETURN json_build_object(
    'balance', v_new_balance,
    'applied_to_balance_at', v_new_applied_at
  );
END;
$$;

REVOKE ALL ON FUNCTION toggle_real_income_applied_to_balance(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION toggle_real_income_applied_to_balance(uuid, boolean) TO service_role;

-- Ajouter aussi `last_applied_amount` sur real_income_entries pour symétrie
-- (la RPC ci-dessus y écrit). NULLABLE, NULL par défaut.
ALTER TABLE real_income_entries
  ADD COLUMN IF NOT EXISTS last_applied_amount NUMERIC(10, 2) NULL;

NOTIFY pgrst, 'reload schema';
