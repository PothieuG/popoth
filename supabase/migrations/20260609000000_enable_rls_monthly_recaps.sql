-- Sprint Security-RLS-Monthly-Recaps — enable RLS on monthly_recaps.
--
-- Context: the Supabase database linter (0013_rls_disabled_in_public) flagged
-- public.monthly_recaps as the ONLY public table without RLS. The anon and
-- authenticated roles hold full DML grants (SELECT/INSERT/UPDATE/DELETE), so
-- with RLS disabled anyone holding the public anon key (shipped in the browser
-- bundle as NEXT_PUBLIC_SUPABASE_ANON_KEY) could read AND tamper with every
-- user's recap rows directly through the PostgREST REST API, bypassing the app.
--
-- Root cause: the `rls_auto_enable` event-trigger function exists in prod
-- (captured in 20260524000002_capture_rls_auto_enable.sql) but is NOT bound to
-- any DDL event trigger, so the table created in
-- 20260524000000_create_monthly_recaps_v3.sql never had RLS auto-enabled.
--
-- Fix: enable RLS with NO policies. monthly_recaps is a server-only table —
-- all access goes through lib/recap/* via supabaseServer (service_role), which
-- bypasses RLS by design. The browser/anon client never touches it (unlike
-- piggy_bank, which needed owner-scoped policies in
-- 20260507000000_enable_rls_piggy_bank.sql). With zero policies, RLS denies the
-- anon/authenticated roles all rows (default-deny) while service_role keeps
-- full access. This is exactly what the `rls_auto_enable` trigger would have
-- done on table creation.
--
-- Idempotent: ENABLE ROW LEVEL SECURITY is a no-op when already enabled.
--
-- Manual revert:
--   ALTER TABLE monthly_recaps DISABLE ROW LEVEL SECURITY;

ALTER TABLE "monthly_recaps" ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
