-- Sprint DB / D1 — Enable RLS on piggy_bank and add owner-or-group-member policies.
--
-- Context: piggy_bank had NO RLS and NO policies, so any anon caller could read
-- and write any user's piggy bank via the public REST API. The C3 RPCs already
-- protect server-side writes, but the browser client (anon key) was bypassed.
--
-- The predicate matches the bank_balances pattern: owner OR group member via
-- profiles.group_id. The four C3 RPCs are SECURITY DEFINER and continue to
-- bypass RLS by design (service_role grants only).
--
-- Manual revert:
--   DROP POLICY "Users can manage their own piggy_bank" ON piggy_bank;
--   DROP POLICY "Users can view their own piggy_bank" ON piggy_bank;
--   ALTER TABLE piggy_bank DISABLE ROW LEVEL SECURITY;

ALTER TABLE piggy_bank ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own piggy_bank"
  ON piggy_bank
  FOR SELECT
  USING (
    profile_id = auth.uid()
    OR (group_id IS NOT NULL AND group_id IN (
      SELECT group_id FROM profiles WHERE id = auth.uid()
    ))
  );

CREATE POLICY "Users can manage their own piggy_bank"
  ON piggy_bank
  FOR ALL
  USING (
    profile_id = auth.uid()
    OR (group_id IS NOT NULL AND group_id IN (
      SELECT group_id FROM profiles WHERE id = auth.uid()
    ))
  );
