-- Sprint DB / D3 — Restrict remaining_to_live_snapshots INSERT to service_role.
--
-- Context: the "Service role can insert snapshots" policy was named correctly
-- but mis-assigned to roles={public} with WITH CHECK true, letting any
-- authenticated user insert a snapshot for any profile_id or group_id.
--
-- Confirmed Option A: all INSERT callers in the codebase live in app/api/
-- routes that use lib/supabase-server.ts (service_role). No browser client
-- inserts into this table.
--
-- Order: CREATE the replacement BEFORE DROP. service_role bypasses RLS anyway,
-- so there is no functional gap during the transaction.
--
-- Manual revert:
--   DROP POLICY "Only service role can insert snapshots" ON remaining_to_live_snapshots;
--   CREATE POLICY "Service role can insert snapshots"
--     ON remaining_to_live_snapshots FOR INSERT WITH CHECK (true);

CREATE POLICY "Only service role can insert snapshots"
  ON remaining_to_live_snapshots
  FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY "Service role can insert snapshots" ON remaining_to_live_snapshots;
