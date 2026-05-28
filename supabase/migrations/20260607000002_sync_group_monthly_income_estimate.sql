-- Sprint Group-Income-Cascade (2026-05-28) — M3/4
--
-- Trigger qui maintient `groups.monthly_income_estimate` à jour comme
-- mirror de SUM(estimated_incomes WHERE group_id = X). Pattern miroir
-- verbatim de `sync_group_monthly_budget_estimate` introduit dans
-- `20260520000000_auto_sync_group_budget.sql`.
--
-- Cascade attendue à chaque INSERT/UPDATE/DELETE sur `estimated_incomes`
-- avec `group_id IS NOT NULL` :
--   1. estimated_incomes_sync_group_income (NEW) → recompute SUM → UPDATE
--      groups.monthly_income_estimate (only if IS DISTINCT FROM)
--   2. groups_income_contribution_recalc (M4) → PERFORM
--      calculate_group_contributions(group_id)
--   3. calculate_group_contributions (M2) UPSERT toutes les rows de
--      group_contributions du groupe → contributions à jour
--   4. Cascade naturelle Sprint 16+36 : triggers sync_contribution_*
--      mettent à jour les real_expenses + real_income_entries miroirs.
--
-- Pas de boucle (estimated_incomes ≠ groups ≠ group_contributions, 3 tables
-- distinctes ; la garde IS DISTINCT FROM évite le no-op récursif).
--
-- Note PostgreSQL : la clause WHEN d'un CREATE TRIGGER ne peut PAS référencer
-- TG_OP — la garde "row purement profile-owned" est donc déplacée dans le
-- corps de la fonction (early return).

-- ============================================================================
-- sync_group_monthly_income_estimate
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sync_group_monthly_income_estimate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
    -- NEW is NULL on DELETE, OLD is NULL on INSERT. Referencing NEW.group_id
    -- in a DELETE context yields NULL (PL/pgSQL allows it gracefully).
    new_group uuid := NEW.group_id;
    old_group uuid := OLD.group_id;
    new_total numeric(10, 2);
BEGIN
    -- Early-return for pure profile-owned rows (no group affected).
    IF new_group IS NULL AND old_group IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    -- Recompute SUM for the NEW group (INSERT, UPDATE keeping/setting group_id).
    IF new_group IS NOT NULL THEN
        SELECT COALESCE(SUM(estimated_amount), 0)
          INTO new_total
          FROM estimated_incomes
         WHERE group_id = new_group;

        UPDATE groups
           SET monthly_income_estimate = new_total
         WHERE id = new_group
           AND monthly_income_estimate IS DISTINCT FROM new_total;
    END IF;

    -- Recompute SUM for the OLD group too if it differs (DELETE, or UPDATE
    -- that moved an item between groups — rare but defensive).
    IF old_group IS NOT NULL AND old_group IS DISTINCT FROM new_group THEN
        SELECT COALESCE(SUM(estimated_amount), 0)
          INTO new_total
          FROM estimated_incomes
         WHERE group_id = old_group;

        UPDATE groups
           SET monthly_income_estimate = new_total
         WHERE id = old_group
           AND monthly_income_estimate IS DISTINCT FROM new_total;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$function$;

-- ============================================================================
-- Trigger : AFTER INSERT/UPDATE/DELETE on estimated_incomes
-- No WHEN clause (TG_OP unavailable there) — the function's early-return
-- skips pure profile-owned rows.
-- ============================================================================
DROP TRIGGER IF EXISTS estimated_incomes_sync_group_income ON public.estimated_incomes;

CREATE TRIGGER estimated_incomes_sync_group_income
AFTER INSERT OR UPDATE OR DELETE ON public.estimated_incomes
FOR EACH ROW
EXECUTE FUNCTION sync_group_monthly_income_estimate();

-- ============================================================================
-- Backfill : align every existing group with SUM(estimated_incomes) of its
-- items. Idempotent thanks to IS DISTINCT FROM (no-op for groups already in
-- sync). Will fire groups_income_contribution_recalc (M4) for each updated
-- group, which will UPSERT the group_contributions rows.
-- Expected behavior :
--   - groups with 0 estimated_incomes → monthly_income_estimate = 0 →
--     contribution_base = monthly_budget_estimate (no change vs pre-feature).
--   - groups with N estimated_incomes → mirror the SUM and recompute
--     contributions à la baisse.
-- ============================================================================
UPDATE groups g
   SET monthly_income_estimate = sub.total
  FROM (
    SELECT g.id,
           COALESCE(SUM(ei.estimated_amount), 0) AS total
      FROM groups g
      LEFT JOIN estimated_incomes ei ON ei.group_id = g.id
     GROUP BY g.id
  ) sub
 WHERE g.id = sub.id
   AND g.monthly_income_estimate IS DISTINCT FROM sub.total;

-- Reload PostgREST schema cache (defensive, consistent with companion budget
-- migration even though trigger functions aren't RPC-exposed).
NOTIFY pgrst, 'reload schema';
