-- Capture rétroactive de la fonction event-trigger `rls_auto_enable` (pattern A2).
-- Présente en prod sans CREATE FUNCTION versionné — surfacée par
-- `pnpm db:audit-functions` post sprint 02 Monthly Recap V3 (2026-05-24).
--
-- Cette fonction est liée à un event trigger DDL qui auto-enable RLS sur
-- toute nouvelle table créée dans le schema `public`. Le binding event
-- trigger lui-même n'est PAS dans cette migration (l'audit ne couvre que
-- les fonctions ; les event triggers sont gérés à part par Supabase).
--
-- Idempotent via CREATE OR REPLACE — safe à ré-appliquer.

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

NOTIFY pgrst, 'reload schema';
