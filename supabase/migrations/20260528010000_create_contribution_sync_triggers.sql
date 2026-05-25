-- Feature "Contribution au groupe — dépense virtuelle perso" (2026-05-28)
--
-- 2 triggers pour maintenir automatiquement une row `real_expenses`
-- représentant la contribution mensuelle d'un user à son groupe :
--
--   1. sync_contribution_real_expense (AFTER INSERT/UPDATE on
--      group_contributions) — UPSERT la row real_expenses miroir avec
--      `amount = NEW.contribution_amount`, `description = 'Contribution au
--      groupe <nom>'`, `is_exceptional = true` (impact RAV via
--      exceptionalExpenses), `contribution_id = NEW.id`. Préserve
--      `applied_to_balance_at` + `last_applied_amount` à l'UPDATE pour ne
--      pas reset la validation user. Si contribution_amount tombe à 0, DELETE
--      la row (cas où le budget groupe est ramené à zéro — la dépense
--      contribution n'a plus de sens).
--
--   2. credit_balance_on_contribution_delete (BEFORE DELETE on
--      real_expenses) — quand une row contribution_id non-null est
--      supprimée (via CASCADE depuis group_contributions DELETE, ou par
--      le trigger sync ci-dessus à amount=0), si elle était appliquée au
--      solde (`applied_to_balance_at IS NOT NULL`), crédite le solde du
--      profile concerné de `last_applied_amount` (restitution automatique
--      cf. décision produit "solde restitué quand le user quitte le
--      groupe").
--
-- Pas de boucle : sync_contribution_real_expense écrit dans real_expenses
-- (pas dans group_contributions). credit_balance_on_contribution_delete
-- est BEFORE DELETE sur real_expenses, pas un INSERT.
--
-- Concurrence : les triggers s'exécutent dans la même transaction que
-- l'INSERT/UPDATE/DELETE source. Pas de race condition vis-à-vis du
-- toggle_real_expense_applied_to_balance (qui prend FOR UPDATE sur la
-- row real_expenses) — l'UPDATE par le trigger sync attendra le FOR
-- UPDATE.

-- ============================================================================
-- sync_contribution_real_expense
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sync_contribution_real_expense()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_group_name text;
  v_description text;
BEGIN
  -- Cas amount=0 : aucune contribution active → supprimer la row miroir si
  -- elle existe (idempotent). Le trigger BEFORE DELETE
  -- credit_balance_on_contribution_delete restituera le solde si nécessaire.
  IF NEW.contribution_amount = 0 THEN
    DELETE FROM real_expenses WHERE contribution_id = NEW.id;
    RETURN NEW;
  END IF;

  -- Résolution du nom du groupe pour la description user-facing.
  SELECT name INTO v_group_name FROM groups WHERE id = NEW.group_id;
  v_description := 'Contribution au groupe ' || COALESCE(v_group_name, '');

  -- UPSERT : INSERT à la première création, UPDATE de `amount` + `description`
  -- aux UPSERT suivants (changement de contribution_amount via le trigger
  -- calculate_group_contributions). On NE TOUCHE PAS `applied_to_balance_at`
  -- ni `last_applied_amount` à l'UPDATE pour préserver l'état de validation
  -- du user (le drift entre `amount` et `last_applied_amount` est ce qui
  -- déclenche le warning "needs revalidation" côté UI).
  --
  -- expense_date à l'INSERT initial uniquement (CURRENT_DATE). À l'UPDATE,
  -- on garde la date initiale — la contribution est une dépense récurrente,
  -- pas une dépense ponctuelle datée.
  INSERT INTO real_expenses (
    profile_id,
    group_id,
    contribution_id,
    amount,
    description,
    expense_date,
    is_exceptional,
    is_carried_over
  )
  VALUES (
    NEW.profile_id,
    NULL,
    NEW.id,
    NEW.contribution_amount,
    v_description,
    CURRENT_DATE,
    true,
    false
  )
  ON CONFLICT (contribution_id) WHERE contribution_id IS NOT NULL
  DO UPDATE SET
    amount = EXCLUDED.amount,
    description = EXCLUDED.description;

  RETURN NEW;
END;
$function$;

-- ============================================================================
-- credit_balance_on_contribution_delete
-- ============================================================================
CREATE OR REPLACE FUNCTION public.credit_balance_on_contribution_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  -- Si la row supprimée est une contribution row ET était appliquée au
  -- solde, restituer le montant dernier validé. Cas de figure :
  --   - User quitte le groupe → group_contributions row DELETE → CASCADE
  --     vers real_expenses → ce trigger fire avant la suppression effective.
  --   - sync_contribution_real_expense fait DELETE quand contribution=0
  --     → même chemin.
  IF OLD.contribution_id IS NOT NULL
     AND OLD.applied_to_balance_at IS NOT NULL
     AND OLD.last_applied_amount IS NOT NULL
     AND OLD.profile_id IS NOT NULL THEN
    UPDATE bank_balances
       SET balance = balance + OLD.last_applied_amount
     WHERE profile_id = OLD.profile_id
       AND group_id IS NULL;
  END IF;

  RETURN OLD;
END;
$function$;

-- ============================================================================
-- Triggers
-- ============================================================================
DROP TRIGGER IF EXISTS group_contributions_sync_real_expense
  ON public.group_contributions;

CREATE TRIGGER group_contributions_sync_real_expense
AFTER INSERT OR UPDATE ON public.group_contributions
FOR EACH ROW
EXECUTE FUNCTION sync_contribution_real_expense();

DROP TRIGGER IF EXISTS real_expenses_credit_balance_on_contribution_delete
  ON public.real_expenses;

CREATE TRIGGER real_expenses_credit_balance_on_contribution_delete
BEFORE DELETE ON public.real_expenses
FOR EACH ROW
EXECUTE FUNCTION credit_balance_on_contribution_delete();

-- ============================================================================
-- Backfill : crée les rows real_expenses pour les contributions existantes.
-- Idempotent grâce à l'ON CONFLICT du trigger qu'on simule manuellement ici.
-- Pour chaque group_contribution existante avec contribution_amount > 0 :
-- INSERT si pas déjà présente (NOT EXISTS).
-- ============================================================================
INSERT INTO real_expenses (
  profile_id,
  group_id,
  contribution_id,
  amount,
  description,
  expense_date,
  is_exceptional,
  is_carried_over
)
SELECT
  gc.profile_id,
  NULL,
  gc.id,
  gc.contribution_amount,
  'Contribution au groupe ' || COALESCE(g.name, ''),
  CURRENT_DATE,
  true,
  false
FROM group_contributions gc
LEFT JOIN groups g ON g.id = gc.group_id
WHERE gc.contribution_amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM real_expenses re WHERE re.contribution_id = gc.id
  );

NOTIFY pgrst, 'reload schema';
