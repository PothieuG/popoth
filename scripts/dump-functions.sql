-- Function definition dump (Sprint Audit-Triggers / A2).
-- Run via: node scripts/apply-sql.mjs scripts/dump-functions.sql
-- Read-only: SELECT only, no schema mutation.
--
-- Output is JSON; copy each "def" into a versioned migration. Used to
-- capture the 4 trigger functions surfaced by Sprint Polish T5 as
-- non-versioned in prod (cf. docs/db/SCHEMA.md "Inventory"). Reusable
-- helper for any future audit of unversioned PL/pgSQL functions.

SELECT n.nspname AS schema,
       p.proname AS name,
       pg_get_functiondef(p.oid) AS def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN (
     'trigger_group_budget_change',
     'cleanup_group_contributions',
     'trigger_recalculate_contributions',
     'calculate_group_contributions',
     'update_updated_at_column',
     'rls_auto_enable'
   )
 ORDER BY p.proname;
