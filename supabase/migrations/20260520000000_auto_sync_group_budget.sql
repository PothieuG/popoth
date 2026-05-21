-- Sprint Group-Budget-Auto-Sync (2026-05-19)
--
-- Avant ce sprint, `groups.monthly_budget_estimate` était un nombre saisi
-- manuellement à la création du groupe (CreateGroupForm + POST /api/groups),
-- éditable par le creator via PUT /api/groups/[id]. La contribution salariale
-- calculée par `calculate_group_contributions(group_id_param)` reposait sur
-- cette colonne. Conséquence : créer/modifier/supprimer un `estimated_budget`
-- pour un groupe n'avait AUCUN effet sur les contributions des membres
-- (`trigger_group_budget_change` ne fire que sur UPDATE de
-- `groups.monthly_budget_estimate`, pas sur `estimated_budgets`).
--
-- Décision métier : le "budget total du groupe" est désormais défini comme
-- `SUM(estimated_budgets.estimated_amount WHERE group_id = X)`. Le champ
-- `groups.monthly_budget_estimate` est conservé en DB (lu par
-- `calculate_group_contributions` + UI) mais devient un mirror auto-maintenu
-- via ce trigger. La saisie manuelle est retirée côté API + UI.
--
-- Cascade attendue à chaque INSERT/UPDATE/DELETE sur `estimated_budgets` avec
-- `group_id IS NOT NULL` :
--   1. estimated_budgets_sync_group_budget (NEW) → recompute SUM → UPDATE
--      groups.monthly_budget_estimate (only if IS DISTINCT FROM)
--   2. groups_budget_contribution_recalc (existing) → PERFORM
--      calculate_group_contributions(group_id)
--   3. calculate_group_contributions UPSERT toutes les rows de
--      group_contributions du groupe → contributions à jour
--
-- Pas de boucle (estimated_budgets ≠ groups ≠ group_contributions, 3 tables
-- distinctes ; la garde `IS DISTINCT FROM` évite le no-op récursif).
--
-- Note PostgreSQL : la clause `WHEN` d'un CREATE TRIGGER ne peut PAS référencer
-- `TG_OP` (limitation PG, cf. https://www.postgresql.org/docs/current/sql-createtrigger.html
-- — "The WHEN condition cannot contain subqueries or references to TG_OP").
-- La garde est donc déplacée dans le corps de la fonction (early return si
-- aucun group_id n'est concerné, c.-à-d. row purement profile-owned).

-- ============================================================================
-- sync_group_monthly_budget_estimate
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sync_group_monthly_budget_estimate()
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
          FROM estimated_budgets
         WHERE group_id = new_group;

        UPDATE groups
           SET monthly_budget_estimate = new_total
         WHERE id = new_group
           AND monthly_budget_estimate IS DISTINCT FROM new_total;
    END IF;

    -- Recompute SUM for the OLD group too if it differs (DELETE, or UPDATE
    -- that moved an item between groups — rare but defensive).
    IF old_group IS NOT NULL AND old_group IS DISTINCT FROM new_group THEN
        SELECT COALESCE(SUM(estimated_amount), 0)
          INTO new_total
          FROM estimated_budgets
         WHERE group_id = old_group;

        UPDATE groups
           SET monthly_budget_estimate = new_total
         WHERE id = old_group
           AND monthly_budget_estimate IS DISTINCT FROM new_total;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$function$;

-- ============================================================================
-- Trigger : AFTER INSERT/UPDATE/DELETE on estimated_budgets
-- No WHEN clause (TG_OP unavailable there) — the function's early-return
-- skips pure profile-owned rows.
-- ============================================================================
DROP TRIGGER IF EXISTS estimated_budgets_sync_group_budget ON public.estimated_budgets;

CREATE TRIGGER estimated_budgets_sync_group_budget
AFTER INSERT OR UPDATE OR DELETE ON public.estimated_budgets
FOR EACH ROW
EXECUTE FUNCTION sync_group_monthly_budget_estimate();

-- ============================================================================
-- Backfill : align every existing group with SUM(estimated_budgets) of its
-- items. Idempotent thanks to IS DISTINCT FROM (no-op for groups already in
-- sync). Will fire groups_budget_contribution_recalc for each updated group,
-- which will UPSERT the group_contributions rows. Expected behavior :
--   - groups with 0 estimated_budgets → monthly_budget_estimate = 0 →
--     contributions = 0 (split fallback with budget = 0 yields 0 amounts).
--   - groups with N estimated_budgets → mirror the SUM and recompute.
-- ============================================================================
UPDATE groups g
   SET monthly_budget_estimate = sub.total
  FROM (
    SELECT g.id,
           COALESCE(SUM(eb.estimated_amount), 0) AS total
      FROM groups g
      LEFT JOIN estimated_budgets eb ON eb.group_id = g.id
     GROUP BY g.id
  ) sub
 WHERE g.id = sub.id
   AND g.monthly_budget_estimate IS DISTINCT FROM sub.total;

-- Reload PostgREST schema cache (consistent with the C3 RPC + trigger-capture
-- migration pattern — defensive even though trigger functions aren't RPC-exposed).
NOTIFY pgrst, 'reload schema';
