-- Sprint Group-Income-Cascade (2026-05-28) — M4/4
--
-- Trigger qui re-calcule les contributions des membres quand
-- `groups.monthly_income_estimate` change (typiquement après que le trigger
-- M3 ait actualisé le mirror suite à un INSERT/UPDATE/DELETE sur
-- `estimated_incomes` groupe).
--
-- Pattern miroir verbatim du trigger existant `trigger_group_budget_change`
-- (cf. `20260512000000_capture_trigger_functions.sql:124-136`) qui fait la
-- même chose mais sur `monthly_budget_estimate`. Les deux triggers
-- coexistent et chacun fire indépendamment sur sa colonne respective.
--
-- Pas de cycle : `calculate_group_contributions` UPSERT `group_contributions`
-- (table distincte) sans jamais re-toucher `groups.monthly_income_estimate`.
-- Garde `IS DISTINCT FROM` évite les no-ops récursifs.

-- ============================================================================
-- trigger_group_income_change — fonction trigger dédiée au mirror income.
-- Séparée de trigger_group_budget_change pour rester explicite sur la
-- colonne déclenchante (lisibilité des audits via pg_trigger).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trigger_group_income_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Recalculate contributions when the group income mirror changes.
    -- IS DISTINCT FROM is null-safe vs `!=` (defensive even though the
    -- column is NOT NULL DEFAULT 0).
    IF TG_OP = 'UPDATE'
       AND OLD.monthly_income_estimate IS DISTINCT FROM NEW.monthly_income_estimate THEN
        PERFORM calculate_group_contributions(NEW.id);
    END IF;

    RETURN NEW;
END;
$function$;

-- ============================================================================
-- Trigger : AFTER UPDATE OF monthly_income_estimate ON groups
-- ============================================================================
DROP TRIGGER IF EXISTS groups_income_contribution_recalc ON public.groups;

CREATE TRIGGER groups_income_contribution_recalc
AFTER UPDATE OF monthly_income_estimate ON public.groups
FOR EACH ROW
EXECUTE FUNCTION trigger_group_income_change();

NOTIFY pgrst, 'reload schema';
