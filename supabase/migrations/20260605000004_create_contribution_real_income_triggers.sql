-- Feature "Contribution au groupe — revenu virtuel groupe miroir" (2026-06-05)
--
-- 2 triggers SYMÉTRIQUES aux triggers Sprint 16 V3 expense (migrations
-- 20260528010000 + 030000) :
--
--   1. sync_contribution_real_income (AFTER INSERT/UPDATE on group_contributions)
--      — UPSERT la row real_income_entries miroir côté GROUPE avec :
--        * group_id = NEW.group_id, profile_id = NULL (revenu de groupe)
--        * description = 'Contribution de <first_name>'
--        * amount = NEW.contribution_amount
--        * is_exceptional = false (pas de double-count avec sum(contributions)
--          virtuel qui aggrège déjà côté group RAV)
--        * created_by_profile_id = NEW.profile_id (avatar = la personne concernée)
--        * applied_to_balance_at = NULL initially
--      Auto-devalidate v2 : si la row était applied ET contribution_amount
--      change, débite le solde GROUPE de last_applied_amount (restitution),
--      set applied_at = NULL, PRÉSERVE last_applied_amount pour le warning UI.
--      À amount=0 : DELETE la row.
--
--   2. credit_balance_on_contribution_income_delete (BEFORE DELETE on
--      real_income_entries) — quand une row contribution_id non-null est
--      supprimée (CASCADE depuis group_contributions DELETE, ou via le
--      trigger sync ci-dessus à amount=0), si elle était applied au solde,
--      DÉBITE le solde du groupe de last_applied_amount (restitution
--      automatique de la même somme qui avait été créditée à l'apply).
--
-- Note signe : pour les EXPENSES, l'apply DÉBITE le solde → le BEFORE DELETE
-- CRÉDITE pour restituer. Pour les INCOMES, l'apply CRÉDITE → le BEFORE DELETE
-- DÉBITE. Symétrique inversé.
--
-- Pas de boucle : sync_contribution_real_income écrit dans real_income_entries
-- (pas dans group_contributions). credit_balance_on_contribution_income_delete
-- est BEFORE DELETE sur real_income_entries.

-- ============================================================================
-- sync_contribution_real_income (v2 — auto-devalidate inclus)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sync_contribution_real_income()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_first_name text;
  v_description text;
  v_ri_id uuid;
  v_ri_applied_at timestamptz;
  v_ri_last_applied numeric;
BEGIN
  -- Cas amount=0 : DELETE la row miroir. Le BEFORE DELETE restituera le
  -- solde si applied.
  IF NEW.contribution_amount = 0 THEN
    DELETE FROM real_income_entries WHERE contribution_id = NEW.id;
    RETURN NEW;
  END IF;

  -- Résolution du prénom du contributeur pour la description user-facing.
  SELECT first_name INTO v_first_name FROM profiles WHERE id = NEW.profile_id;
  v_description := 'Contribution de ' || COALESCE(v_first_name, 'membre');

  -- Lookup row existante via le partial unique index.
  SELECT id, applied_to_balance_at, last_applied_amount
    INTO v_ri_id, v_ri_applied_at, v_ri_last_applied
    FROM real_income_entries
   WHERE contribution_id = NEW.id;

  -- Cas INSERT initial : pas de row miroir → la créer en état "never validated".
  IF v_ri_id IS NULL THEN
    INSERT INTO real_income_entries (
      profile_id,
      group_id,
      contribution_id,
      amount,
      description,
      entry_date,
      is_exceptional,
      is_carried_over,
      created_by_profile_id
    ) VALUES (
      NULL,
      NEW.group_id,
      NEW.id,
      NEW.contribution_amount,
      v_description,
      CURRENT_DATE,
      false,
      false,
      NEW.profile_id
    );
    RETURN NEW;
  END IF;

  -- Row existante : décision sur l'auto-devalidate.
  -- Condition : était applied ET le nouveau montant diffère du dernier
  -- montant validé → DÉBITE le solde GROUPE (restitution du crédit
  -- d'origine) + nullify applied_to_balance_at + PRÉSERVE last_applied_amount.
  IF v_ri_applied_at IS NOT NULL
     AND v_ri_last_applied IS NOT NULL
     AND v_ri_last_applied IS DISTINCT FROM NEW.contribution_amount THEN

    UPDATE bank_balances
       SET balance = balance - v_ri_last_applied
     WHERE group_id = NEW.group_id
       AND profile_id IS NULL;

    UPDATE real_income_entries
       SET amount = NEW.contribution_amount,
           description = v_description,
           applied_to_balance_at = NULL
           -- last_applied_amount intentionnellement NON modifié
     WHERE id = v_ri_id;

  ELSE
    -- Sinon : simple refresh de amount + description.
    UPDATE real_income_entries
       SET amount = NEW.contribution_amount,
           description = v_description
     WHERE id = v_ri_id;
  END IF;

  RETURN NEW;
END;
$function$;

-- ============================================================================
-- credit_balance_on_contribution_income_delete (BEFORE DELETE)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.credit_balance_on_contribution_income_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  -- Si la row supprimée est une contribution-income ET était applied,
  -- DÉBITE le solde groupe du montant dernier validé (restitution du crédit).
  IF OLD.contribution_id IS NOT NULL
     AND OLD.applied_to_balance_at IS NOT NULL
     AND OLD.last_applied_amount IS NOT NULL
     AND OLD.group_id IS NOT NULL THEN
    UPDATE bank_balances
       SET balance = balance - OLD.last_applied_amount
     WHERE group_id = OLD.group_id
       AND profile_id IS NULL;
  END IF;

  RETURN OLD;
END;
$function$;

-- ============================================================================
-- Triggers
-- ============================================================================
DROP TRIGGER IF EXISTS group_contributions_sync_real_income
  ON public.group_contributions;

CREATE TRIGGER group_contributions_sync_real_income
AFTER INSERT OR UPDATE ON public.group_contributions
FOR EACH ROW
EXECUTE FUNCTION sync_contribution_real_income();

DROP TRIGGER IF EXISTS real_income_entries_credit_balance_on_contribution_delete
  ON public.real_income_entries;

CREATE TRIGGER real_income_entries_credit_balance_on_contribution_delete
BEFORE DELETE ON public.real_income_entries
FOR EACH ROW
EXECUTE FUNCTION credit_balance_on_contribution_income_delete();

NOTIFY pgrst, 'reload schema';
