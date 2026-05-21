-- Sprint Audit-Functions-v2 / B1 — capture des 4 fonctions PL/pgSQL legacy non-versionnées.
--
-- Trouvaille du nouveau script `pnpm db:audit-functions` (B1) au premier run :
-- 4 fonctions `public.*` existaient en prod sans aucune trace dans
-- supabase/migrations/. Toutes vérifiées comme **dead code** (zéro callsite
-- `.rpc()` dans le code applicatif — seul `lib/database.types.ts` les
-- mentionne en tant que types auto-générés depuis `pg_proc`).
--
-- Stratégie : capturer verbatim sous forme idempotente (`CREATE OR REPLACE`)
-- pour figer l'état actuel et que `db:audit-functions` exit 0. Un futur sprint
-- pourra alors `DROP FUNCTION` ces 4 fonctions sans perdre l'historique des
-- bodies (qui restent ici en git). Ces 4 fonctions ne sont PAS ajoutées à
-- `EXPECTED_FUNCTIONS` dans scripts/check-trigger-functions.mjs car elles
-- sont pinnables comme dead — `db:audit-functions` (générique) suffit.
--
-- Bodies extraits via `node scripts/apply-sql.mjs tmp/dump-unknown-functions.sql`
-- (sortie pg_get_functiondef). Préservés VERBATIM — toute modification doit
-- passer par une nouvelle migration CREATE OR REPLACE, pas par un edit ici.
--
-- ⚠️ APPLICATION SPÉCIALE : ces fonctions existent DÉJÀ en prod. NE PAS lancer
-- `supabase db push` (collision). Workflow obligatoire :
--   1. node scripts/apply-sql.mjs supabase/migrations/20260513000000_capture_legacy_functions.sql
--   2. pnpm supabase migration repair --status applied 20260513000000
--   3. node scripts/export-schema.mjs supabase/migrations/20260101000000_remote_schema.sql
-- Voir docs/audit/POST-MORTEM-C3-DRIFT.md pour le piège analogue C3.

-- ============================================================================
-- check_column_exists — utilitaire de migration legacy (zéro callsite)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.check_column_exists(table_name text, column_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = $1
    AND column_name = $2
  );
END $function$;

-- ============================================================================
-- create_recap_snapshot — snapshot legacy (remplacé par lib/database-snapshot.ts en T4)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_recap_snapshot(user_id uuid, context_type text DEFAULT 'profile'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  snapshot_id uuid;
  current_month integer := EXTRACT(MONTH FROM CURRENT_DATE);
  current_year integer := EXTRACT(YEAR FROM CURRENT_DATE);
  user_profile_id uuid;
  user_group_id uuid;
  financial_data jsonb;
BEGIN
  -- Récupérer les IDs selon le contexte
  SELECT id, group_id INTO user_profile_id, user_group_id
  FROM profiles WHERE id = user_id;

  -- Créer les données du snapshot (on récupère toutes les données financières actuelles)
  IF context_type = 'profile' THEN
    SELECT jsonb_build_object(
      'context', 'profile',
      'profile_id', user_profile_id,
      'estimated_incomes', (
        SELECT jsonb_agg(row_to_json(ei.*))
        FROM estimated_incomes ei
        WHERE ei.profile_id = user_profile_id
      ),
      'estimated_budgets', (
        SELECT jsonb_agg(row_to_json(eb.*))
        FROM estimated_budgets eb
        WHERE eb.profile_id = user_profile_id
      ),
      'real_incomes', (
        SELECT jsonb_agg(row_to_json(ri.*))
        FROM real_income_entries ri
        WHERE ri.profile_id = user_profile_id
      ),
      'real_expenses', (
        SELECT jsonb_agg(row_to_json(re.*))
        FROM real_expenses re
        WHERE re.profile_id = user_profile_id
      ),
      'bank_balance', (
        SELECT balance FROM bank_balances
        WHERE profile_id = user_profile_id
      )
    ) INTO financial_data;

    -- Insérer le snapshot
    INSERT INTO recap_snapshots (profile_id, snapshot_month, snapshot_year, snapshot_data)
    VALUES (user_profile_id, current_month, current_year, financial_data)
    RETURNING id INTO snapshot_id;

  ELSIF context_type = 'group' AND user_group_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'context', 'group',
      'group_id', user_group_id,
      'estimated_incomes', (
        SELECT jsonb_agg(row_to_json(ei.*))
        FROM estimated_incomes ei
        WHERE ei.group_id = user_group_id
      ),
      'estimated_budgets', (
        SELECT jsonb_agg(row_to_json(eb.*))
        FROM estimated_budgets eb
        WHERE eb.group_id = user_group_id
      ),
      'real_incomes', (
        SELECT jsonb_agg(row_to_json(ri.*))
        FROM real_income_entries ri
        WHERE ri.group_id = user_group_id
      ),
      'real_expenses', (
        SELECT jsonb_agg(row_to_json(re.*))
        FROM real_expenses re
        WHERE re.group_id = user_group_id
      ),
      'bank_balance', (
        SELECT balance FROM bank_balances
        WHERE group_id = user_group_id
      )
    ) INTO financial_data;

    -- Insérer le snapshot
    INSERT INTO recap_snapshots (group_id, snapshot_month, snapshot_year, snapshot_data)
    VALUES (user_group_id, current_month, current_year, financial_data)
    RETURNING id INTO snapshot_id;
  END IF;

  RETURN snapshot_id;
END;
$function$;

-- ============================================================================
-- final_verification — diagnostic post-migration legacy (zéro callsite)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.final_verification()
 RETURNS TABLE(component text, status text, count_found integer)
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Index count
  RETURN QUERY
  SELECT
    'Index de performance'::text,
    'INFO'::text,
    (SELECT COUNT(*)::integer FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx_%');

  -- Contraintes count
  RETURN QUERY
  SELECT
    'Contraintes owner_check'::text,
    'INFO'::text,
    (SELECT COUNT(*)::integer FROM information_schema.table_constraints WHERE constraint_name LIKE '%owner_check');

  -- Triggers count
  RETURN QUERY
  SELECT
    'Triggers de calcul'::text,
    'INFO'::text,
    (SELECT COUNT(*)::integer FROM information_schema.triggers WHERE trigger_schema = 'public' AND trigger_name LIKE '%calculate%');

  -- Tables avec RLS
  RETURN QUERY
  SELECT
    'Tables avec RLS'::text,
    'INFO'::text,
    (SELECT COUNT(*)::integer FROM pg_class c
     JOIN pg_namespace n ON c.relnamespace = n.oid
     WHERE n.nspname = 'public' AND c.relrowsecurity = true);

  -- Test de cohérence basique
  RETURN QUERY
  SELECT
    'Violations contraintes'::text,
    CASE WHEN EXISTS(
      SELECT 1 FROM estimated_incomes
      WHERE (profile_id IS NULL AND group_id IS NULL)
         OR (profile_id IS NOT NULL AND group_id IS NOT NULL)
    ) THEN 'ERROR' ELSE 'OK' END::text,
    0::integer;
END;
$function$;

-- ============================================================================
-- is_monthly_recap_required — vérification recap legacy (zéro callsite)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_monthly_recap_required(user_id uuid, context_type text DEFAULT 'profile'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  current_month integer := EXTRACT(MONTH FROM CURRENT_DATE);
  current_year integer := EXTRACT(YEAR FROM CURRENT_DATE);
  user_profile_id uuid;
  user_group_id uuid;
  recap_exists boolean := false;
BEGIN
  -- Récupérer les IDs selon le contexte
  SELECT id, group_id INTO user_profile_id, user_group_id
  FROM profiles WHERE id = user_id;

  IF context_type = 'profile' THEN
    -- Vérifier si un récap profile existe pour ce mois
    SELECT EXISTS(
      SELECT 1 FROM monthly_recaps
      WHERE profile_id = user_profile_id
        AND recap_month = current_month
        AND recap_year = current_year
    ) INTO recap_exists;
  ELSIF context_type = 'group' AND user_group_id IS NOT NULL THEN
    -- Vérifier si un récap groupe existe pour ce mois
    SELECT EXISTS(
      SELECT 1 FROM monthly_recaps
      WHERE group_id = user_group_id
        AND recap_month = current_month
        AND recap_year = current_year
    ) INTO recap_exists;
  END IF;

  -- Récap requis si on est le 1er du mois ET qu'aucun récap n'existe
  RETURN (EXTRACT(DAY FROM CURRENT_DATE) = 1) AND NOT recap_exists;
END;
$function$;

-- Force PostgREST schema cache reload (pattern Sprint DB).
NOTIFY pgrst, 'reload schema';
