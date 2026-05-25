-- Feature "Contribution au groupe" — auto-devalidate (2026-05-28)
--
-- Évolution du trigger `sync_contribution_real_expense` : quand la
-- contribution change ALORS QUE la row real_expenses miroir était validée
-- (applied_to_balance_at IS NOT NULL), on auto-devalide la row :
--   - crédite le solde de `last_applied_amount` (restitution du débit
--     d'origine).
--   - set `applied_to_balance_at = NULL`.
--   - PRÉSERVE `last_applied_amount` (au lieu de le nullifier comme dans
--     un un-apply manuel) → permet à l'UI d'afficher le delta dans le
--     warning ("vous devez ajouter|retirer X€ avant de re-valider").
--
-- Conséquence côté UX :
--   - Le user voit la row passer en état "non-validée" automatiquement
--     dès qu'un budget groupe / salaire d'un membre change.
--   - Le warning lui rappelle quel mouvement effectuer physiquement
--     (ajouter ou retirer la différence).
--   - Quand il long-press pour valider, le solde est débité au nouveau
--     montant et la row repasse en état "in-sync" (warning disparaît).
--
-- Différence avec l'ancien comportement :
--   - AVANT : la row restait `applied_to_balance_at != NULL` après le
--     change, mais avec un drift (amount != last_applied_amount). Le
--     solde n'était PAS auto-restitué — le user devait soit re-valider
--     (RPC drift branche) soit attendre un un-apply manuel.
--   - APRÈS : restitution automatique au moment où le drift apparaît →
--     le solde reflète toujours la réalité (soit le montant validé
--     courant, soit zéro impact si en attente de validation).
--
-- La branche "drift re-validate" de `toggle_real_expense_applied_to_balance`
-- (migration 20260528020000) devient dead code en pratique — préservée
-- comme filet de sécurité défensif (no-op fonctionnel si la situation
-- ne se présente plus).
--
-- La fonction `credit_balance_on_contribution_delete` (BEFORE DELETE)
-- reste inchangée : elle gère le cas "user quitte le groupe" (CASCADE
-- vers real_expenses) ; pas concernée par le change-amount.

CREATE OR REPLACE FUNCTION public.sync_contribution_real_expense()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_group_name text;
  v_description text;
  v_re_id uuid;
  v_re_applied_at timestamptz;
  v_re_last_applied numeric;
BEGIN
  -- Cas amount=0 : supprime la row miroir si elle existe. Le BEFORE DELETE
  -- trigger restituera le solde si la row était applied (last_applied_amount).
  IF NEW.contribution_amount = 0 THEN
    DELETE FROM real_expenses WHERE contribution_id = NEW.id;
    RETURN NEW;
  END IF;

  -- Résolution du nom du groupe pour la description user-facing.
  SELECT name INTO v_group_name FROM groups WHERE id = NEW.group_id;
  v_description := 'Contribution au groupe ' || COALESCE(v_group_name, '');

  -- Lookup row existante via le partial unique index.
  SELECT id, applied_to_balance_at, last_applied_amount
    INTO v_re_id, v_re_applied_at, v_re_last_applied
    FROM real_expenses
   WHERE contribution_id = NEW.id;

  -- Cas INSERT initial : pas de row miroir → la créer en état "never
  -- validated" (state A). expense_date = CURRENT_DATE figé à l'INSERT.
  IF v_re_id IS NULL THEN
    INSERT INTO real_expenses (
      profile_id,
      group_id,
      contribution_id,
      amount,
      description,
      expense_date,
      is_exceptional,
      is_carried_over
    ) VALUES (
      NEW.profile_id,
      NULL,
      NEW.id,
      NEW.contribution_amount,
      v_description,
      CURRENT_DATE,
      true,
      false
    );
    RETURN NEW;
  END IF;

  -- Row existante : décision sur l'auto-devalidate.
  -- Condition : était applied ET le nouveau montant diffère du dernier
  -- montant validé → restitue le solde + nullify applied_to_balance_at +
  -- PRÉSERVE last_applied_amount (pour le delta du warning).
  IF v_re_applied_at IS NOT NULL
     AND v_re_last_applied IS NOT NULL
     AND v_re_last_applied IS DISTINCT FROM NEW.contribution_amount THEN

    UPDATE bank_balances
       SET balance = balance + v_re_last_applied
     WHERE profile_id = NEW.profile_id
       AND group_id IS NULL;

    UPDATE real_expenses
       SET amount = NEW.contribution_amount,
           description = v_description,
           applied_to_balance_at = NULL
           -- last_applied_amount intentionnellement NON modifié
     WHERE id = v_re_id;

  ELSE
    -- Sinon : simple refresh de amount + description (la row n'était pas
    -- applied OU le montant n'a pas changé — pas d'impact solde).
    UPDATE real_expenses
       SET amount = NEW.contribution_amount,
           description = v_description
     WHERE id = v_re_id;
  END IF;

  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';
