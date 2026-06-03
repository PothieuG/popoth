-- Sprint Security-RLS-Monthly-Recaps (a) — restore the `ensure_rls` event trigger on prod.
--
-- Context: rls_auto_enable() (captured in 20260524000002_capture_rls_auto_enable.sql)
-- auto-enables RLS on every new public table at CREATE TABLE time. The dev project
-- (ddehmjucyfgyppfkbddr) has it bound via the `ensure_rls` event trigger, but PROD
-- (jzmppreybwabaeycvasz) was MISSING that binding — the root cause that let
-- monthly_recaps ship without RLS (see 20260609000000_enable_rls_monthly_recaps.sql).
--
-- This recreates the binding on prod so any future public table auto-gets RLS at
-- creation and the linter finding 0013_rls_disabled_in_public cannot recur. The
-- WHEN TAG filter mirrors dev exactly (CREATE TABLE / CREATE TABLE AS / SELECT INTO).
--
-- NOTE: event triggers live in pg_event_trigger, not pg_trigger, so they are NOT
-- captured by scripts/export-schema.mjs — this migration does not affect the
-- schema baseline (no drift). The end-state safety net is `pnpm db:check-rls`.
--
-- Idempotent via DROP IF EXISTS (no-op on dev where it already exists).
--
-- Manual revert:
--   DROP EVENT TRIGGER IF EXISTS ensure_rls;

DROP EVENT TRIGGER IF EXISTS ensure_rls;

CREATE EVENT TRIGGER ensure_rls
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION rls_auto_enable();

NOTIFY pgrst, 'reload schema';
