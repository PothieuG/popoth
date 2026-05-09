-- Sprint 2-followup-v3 / Item 1
-- Trigger BEFORE DELETE on groups: nulls profiles.group_id for all members.
--
-- Why: DELETE /api/groups/[id] previously left orphan group_id references on
-- profiles. The existing groups_cleanup_contributions trigger handled the
-- group_contributions cascade, but profiles.group_id was untouched. Tous les
-- members (incluant le deleter) gardaient un group_id pointant vers un group
-- non-existant - state DB techniquement incohérent.
--
-- Naming: `groups_aaa_cleanup_members` is intentional. Postgres fires BEFORE
-- DELETE triggers in alphabetical order. The `_aaa_` infix forces this trigger
-- to fire BEFORE `groups_cleanup_contributions`, so:
--   1. profiles.group_id is nulled first (fires profiles_contribution_recalc
--      AFTER UPDATE, but with NEW.group_id = NULL nothing gets recomputed for
--      the dying group).
--   2. groups_cleanup_contributions then DELETEs group_contributions for OLD.id
--      with no risk of churn re-insertion.
--   3. The groups row is finally deleted.
-- Reverse ordering would let the recalc trigger try to repopulate
-- group_contributions for the still-existing-but-being-deleted group; FK
-- CASCADE would clean that up but the work is wasted and the audit output
-- becomes confusing.

CREATE OR REPLACE FUNCTION public.cleanup_group_members_on_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'DELETE' THEN
        UPDATE profiles SET group_id = NULL WHERE group_id = OLD.id;
        RAISE NOTICE 'Cleared group_id for members of deleted group %', OLD.id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$function$;

CREATE TRIGGER groups_aaa_cleanup_members
BEFORE DELETE ON public.groups
FOR EACH ROW EXECUTE FUNCTION cleanup_group_members_on_delete();
