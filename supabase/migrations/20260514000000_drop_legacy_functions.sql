-- Sprint Cleanup-Legacy / C1 — DROP des 4 fonctions legacy capturées en
-- 20260513000000_capture_legacy_functions.sql.
--
-- Pré-requis (vérifiés Phase 1 du sprint) :
--   - 0 callsite `.rpc('<func>')` dans le code applicatif (Grep .ts/.tsx/.js/.sql/.mjs).
--   - 0 référence dans `.github/`.
--   - Présence uniquement dans `lib/database.types.ts` lignes 717/721/725/733
--     (auto-générées depuis `pg_proc` — disparaissent au prochain `pnpm db:types`).
--
-- Recovery path : si une de ces fonctions doit être recréée, son body est
-- préservé verbatim dans 20260513000000_capture_legacy_functions.sql
-- (CREATE OR REPLACE idempotent). Re-appliquer via :
--   node scripts/apply-sql.mjs supabase/migrations/20260513000000_capture_legacy_functions.sql
--
-- ⚠️ APPLICATION SPÉCIALE : ces fonctions existent en prod, le DROP s'applique
-- en prod. NE PAS lancer `supabase db push` (provoquerait drift C3 redux si la
-- migration n'est pas marquée applied). Workflow obligatoire :
--   1. node scripts/apply-sql.mjs supabase/migrations/20260514000000_drop_legacy_functions.sql
--   2. pnpm supabase migration repair --status applied 20260514000000
--   3. node scripts/export-schema.mjs supabase/migrations/20260101000000_remote_schema.sql
--   4. pnpm db:check-drift && pnpm db:audit-functions  (les 2 doivent exit 0)

-- IF EXISTS : idempotent (safe à rejouer après partial failure).
-- Pas de CASCADE volontaire : default RESTRICT fait échouer le DROP si une
-- dépendance inattendue (vue, trigger, autre fonction) existe — c'est le
-- signal qu'il faut investiguer plutôt que d'écraser silencieusement.

DROP FUNCTION IF EXISTS public.check_column_exists(text, text);
DROP FUNCTION IF EXISTS public.create_recap_snapshot(uuid, text);
DROP FUNCTION IF EXISTS public.final_verification();
DROP FUNCTION IF EXISTS public.is_monthly_recap_required(uuid, text);

-- Force le rafraîchissement du cache PostgREST (cf. CLAUDE.md §8 RPC convention).
NOTIFY pgrst, 'reload schema';
