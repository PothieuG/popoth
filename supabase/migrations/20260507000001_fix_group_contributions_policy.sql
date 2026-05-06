-- Sprint DB / D2 — Replace the over-permissive group_contributions ALL policy
-- with one restricted to actual group members.
--
-- Context: the existing "Authenticated users can manage contributions" policy
-- used USING (auth.uid() IS NOT NULL), allowing any logged-in user to read,
-- insert, update, or delete any group's contributions. This shadows the
-- already-present "Users can view contributions for their own group" policy
-- because Postgres OR-merges permissive policies.
--
-- Order: CREATE the replacement BEFORE DROP. During the transaction window
-- both coexist (still OR-permissive, no row inadvertently exposed).
--
-- Manual revert:
--   DROP POLICY "Group members can manage their group contributions" ON group_contributions;
--   CREATE POLICY "Authenticated users can manage contributions"
--     ON group_contributions FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Group members can manage their group contributions"
  ON group_contributions
  FOR ALL
  USING (
    group_id IN (SELECT group_id FROM profiles WHERE id = auth.uid())
  );

DROP POLICY "Authenticated users can manage contributions" ON group_contributions;
