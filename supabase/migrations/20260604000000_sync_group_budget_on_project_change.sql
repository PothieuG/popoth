-- Sprint PÉ-12 (2026-05-26)
--
-- Problème : `savings_projects.monthly_allocation` n'était pas inclus dans
-- `groups.monthly_budget_estimate`, donc la cascade de calcul des contributions
-- (trigger_group_budget_change → calculate_group_contributions) ignorait les
-- projets d'épargne groupe. Les membres étaient sous-contribuants dès qu'un
-- projet groupe existait.
--
-- Décision métier : un projet d'épargne groupe est traité comme un budget
-- virtuel (spec §4 client / RAV). Il doit donc être inclus dans
-- `groups.monthly_budget_estimate` — la colonne que `calculate_group_contributions`
-- lit pour répartir les contributions proportionnellement aux salaires.
--
-- Architecture retenue :
--   1. Fonction helper `recompute_group_monthly_budget_estimate(p_group_id)` :
--      calcule SUM(estimated_budgets) + SUM(savings_projects) avec deux
--      sous-requêtes indépendantes (évite le produit cartésien qu'un double
--      LEFT JOIN produirait quand N budgets × M projets) et met à jour
--      `groups.monthly_budget_estimate` (garde IS DISTINCT FROM).
--   2. `sync_group_monthly_budget_estimate()` (trigger estimated_budgets) est
--      mise à jour pour déléguer au helper.
--   3. Nouvelle fonction trigger `sync_group_budget_on_project_change()` +
--      trigger `savings_projects_sync_group_budget` — même pattern.
--   4. Backfill : aligne tous les groupes existants sur le nouveau total.
--
-- Cascade attendue après chaque mutation sur savings_projects (group_id IS NOT NULL) :
--   1. savings_projects_sync_group_budget → recompute_group_monthly_budget_estimate
--      → UPDATE groups.monthly_budget_estimate (uniquement si IS DISTINCT FROM)
--   2. groups_budget_contribution_recalc (existant) → calculate_group_contributions
--   3. calculate_group_contributions UPSERT group_contributions → contributions à jour

-- ============================================================================
-- Helper : recompute SUM(budgets) + SUM(project allocations) pour un groupe.
-- Deux sous-requêtes indépendantes pour éviter le produit cartésien d'un
-- double LEFT JOIN quand N budgets × M projets > 1.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.recompute_group_monthly_budget_estimate(p_group_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
    new_total numeric(10, 2);
BEGIN
    SELECT
        (SELECT COALESCE(SUM(estimated_amount), 0) FROM estimated_budgets WHERE group_id = p_group_id)
        + (SELECT COALESCE(SUM(monthly_allocation), 0) FROM savings_projects WHERE group_id = p_group_id)
      INTO new_total;

    UPDATE groups
       SET monthly_budget_estimate = new_total
     WHERE id = p_group_id
       AND monthly_budget_estimate IS DISTINCT FROM new_total;
END;
$function$;

REVOKE ALL ON FUNCTION public.recompute_group_monthly_budget_estimate(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.recompute_group_monthly_budget_estimate(uuid) TO service_role;

-- ============================================================================
-- Mise à jour de sync_group_monthly_budget_estimate (trigger estimated_budgets)
-- pour déléguer au helper.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sync_group_monthly_budget_estimate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
    new_group uuid := NEW.group_id;
    old_group uuid := OLD.group_id;
BEGIN
    -- Early-return pour les rows purement profile-owned (aucun groupe concerné).
    IF new_group IS NULL AND old_group IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    IF new_group IS NOT NULL THEN
        PERFORM recompute_group_monthly_budget_estimate(new_group);
    END IF;

    -- UPDATE qui déplace un item entre groupes (rare) ou DELETE.
    IF old_group IS NOT NULL AND old_group IS DISTINCT FROM new_group THEN
        PERFORM recompute_group_monthly_budget_estimate(old_group);
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$function$;

-- ============================================================================
-- Nouvelle trigger function pour savings_projects — même logique.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sync_group_budget_on_project_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
    new_group uuid := NEW.group_id;
    old_group uuid := OLD.group_id;
BEGIN
    -- Early-return pour les projets purement perso (pas de group_id).
    IF new_group IS NULL AND old_group IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    IF new_group IS NOT NULL THEN
        PERFORM recompute_group_monthly_budget_estimate(new_group);
    END IF;

    IF old_group IS NOT NULL AND old_group IS DISTINCT FROM new_group THEN
        PERFORM recompute_group_monthly_budget_estimate(old_group);
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$function$;

-- ============================================================================
-- Trigger sur savings_projects
-- ============================================================================
DROP TRIGGER IF EXISTS savings_projects_sync_group_budget ON public.savings_projects;

CREATE TRIGGER savings_projects_sync_group_budget
AFTER INSERT OR UPDATE OR DELETE ON public.savings_projects
FOR EACH ROW
EXECUTE FUNCTION sync_group_budget_on_project_change();

-- ============================================================================
-- Backfill : aligner tous les groupes existants sur le nouveau total.
-- Deux sous-requêtes dans le SELECT pour éviter le produit cartésien.
-- Idempotent grâce à IS DISTINCT FROM.
-- ============================================================================
UPDATE groups g
   SET monthly_budget_estimate = sub.total
  FROM (
    SELECT id,
           (SELECT COALESCE(SUM(estimated_amount), 0) FROM estimated_budgets WHERE group_id = g.id)
           + (SELECT COALESCE(SUM(monthly_allocation), 0) FROM savings_projects WHERE group_id = g.id)
           AS total
      FROM groups g
  ) sub
 WHERE g.id = sub.id
   AND g.monthly_budget_estimate IS DISTINCT FROM sub.total;

NOTIFY pgrst, 'reload schema';
