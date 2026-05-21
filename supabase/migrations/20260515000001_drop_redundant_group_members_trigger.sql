-- Sprint 2-followup-v3 / Item 1 pivot
-- DROP the cleanup_group_members_on_delete trigger introduced just minutes ago
-- in 20260515000000_add_group_members_cleanup_trigger.sql.
--
-- Why the pivot: investigation found that profiles_group_id_fkey already has
-- ON DELETE SET NULL (line 235 of the baseline / verified directly via
-- pg_constraint). When DELETE /api/groups/[id] runs, the FK action automatically
-- nulls profiles.group_id for all members - the bug described in the original
-- Sprint v3 prompt does not exist as described. Our trigger was redundant
-- with the FK, doing the same UPDATE microseconds earlier.
--
-- Recovery path: if a future scenario requires the trigger (e.g. emit a
-- NOTIFY, audit log, or the FK gets dropped), re-apply the body verbatim
-- from 20260515000000_add_group_members_cleanup_trigger.sql via apply-sql.mjs
-- (CREATE OR REPLACE idempotent).

DROP TRIGGER IF EXISTS groups_aaa_cleanup_members ON public.groups;
DROP FUNCTION IF EXISTS public.cleanup_group_members_on_delete() RESTRICT;

NOTIFY pgrst, 'reload schema';
