-- Sprint Group-Transaction-Creator-Avatar (2026-05-22)
--
-- Bug: in group view (`/group-dashboard`), every transaction row displays the
-- currently-connected user's avatar instead of the avatar of the member who
-- actually created the transaction. Root cause: `real_expenses` and
-- `real_income_entries` only track an `owner_exclusive_check` (`profile_id`
-- XOR `group_id`); for group transactions `profile_id` is NULL so the creator
-- identity is lost.
--
-- Fix: add a `created_by_profile_id` column on both tables, FK → profiles(id)
-- ON DELETE SET NULL (preserves the row if the creator's profile is deleted —
-- mirrors `profiles.group_id` semantics in the baseline). Column is NULLABLE
-- by design: legacy rows stay NULL and the UI falls back to the `??` avatar
-- placeholder from `<UserAvatar profile={null} />`.
--
-- FK is named explicitly to keep the PostgREST embed hint stable
-- (`created_by:profiles!real_expenses_created_by_profile_id_fkey(...)`) — with
-- both `profile_id` AND `created_by_profile_id` pointing at `profiles`,
-- PostgREST refuses the shorthand `created_by:profiles(...)` (ambiguity).
--
-- Index on each (`idx_<table>_created_by_profile_id`) covers the
-- creator-filtered queries the JOIN issues.

ALTER TABLE real_expenses
  ADD COLUMN created_by_profile_id uuid,
  ADD CONSTRAINT real_expenses_created_by_profile_id_fkey
    FOREIGN KEY (created_by_profile_id) REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_real_expenses_created_by_profile_id
  ON real_expenses(created_by_profile_id);

ALTER TABLE real_income_entries
  ADD COLUMN created_by_profile_id uuid,
  ADD CONSTRAINT real_income_entries_created_by_profile_id_fkey
    FOREIGN KEY (created_by_profile_id) REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_real_income_entries_created_by_profile_id
  ON real_income_entries(created_by_profile_id);

NOTIFY pgrst, 'reload schema';
