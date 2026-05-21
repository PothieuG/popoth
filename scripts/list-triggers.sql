-- Trigger inventory query (Sprint Polish T5).
-- Run via: node scripts/apply-sql.mjs scripts/list-triggers.sql
-- Output goes into docs/db/SCHEMA.md "Triggers — what's tracked vs what isn't".
-- Read-only: SELECT only, no schema mutation.

SELECT
  n.nspname              AS schema,
  c.relname              AS table_name,
  t.tgname               AS trigger_name,
  np.nspname             AS function_schema,
  p.proname              AS function_name,
  CASE
    WHEN t.tgtype & 2  <> 0 THEN 'BEFORE'
    WHEN t.tgtype & 64 <> 0 THEN 'INSTEAD OF'
    ELSE 'AFTER'
  END AS timing,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN t.tgtype &  4 <> 0 THEN 'INSERT'   END,
    CASE WHEN t.tgtype &  8 <> 0 THEN 'DELETE'   END,
    CASE WHEN t.tgtype & 16 <> 0 THEN 'UPDATE'   END,
    CASE WHEN t.tgtype & 32 <> 0 THEN 'TRUNCATE' END
  ], NULL) AS events
FROM pg_trigger t
JOIN pg_class      c  ON c.oid  = t.tgrelid
JOIN pg_namespace  n  ON n.oid  = c.relnamespace
JOIN pg_proc       p  ON p.oid  = t.tgfoid
JOIN pg_namespace  np ON np.oid = p.pronamespace
WHERE NOT t.tgisinternal
ORDER BY n.nspname, c.relname, t.tgname;
