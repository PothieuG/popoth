-- Sprint 02 Monthly Recap V3 — table monthly_recaps fresh.
-- State machine 5 steps + completed, lock initiateur (groupe), refloats tracking,
-- snapshot JSONB pour puisage proportionnel différé.

CREATE TABLE IF NOT EXISTS "monthly_recaps" (
  "id"                      uuid NOT NULL DEFAULT gen_random_uuid(),
  "profile_id"              uuid,
  "group_id"                uuid,
  "recap_month"             smallint NOT NULL,
  "recap_year"              smallint NOT NULL,
  "current_step"            text NOT NULL DEFAULT 'welcome',
  "started_by_profile_id"   uuid,
  "started_at"              timestamp with time zone,
  "refloated_from_piggy"    numeric(14,2) NOT NULL DEFAULT 0,
  "refloated_from_savings"  numeric(14,2) NOT NULL DEFAULT 0,
  "budget_snapshot_data"    jsonb NOT NULL DEFAULT '{}'::jsonb,
  "completed_at"            timestamp with time zone,
  "created_at"              timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"              timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "monthly_recaps"
  ADD CONSTRAINT "monthly_recaps_pkey" PRIMARY KEY (id);

ALTER TABLE "monthly_recaps"
  ADD CONSTRAINT "monthly_recaps_profile_id_fkey"
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE "monthly_recaps"
  ADD CONSTRAINT "monthly_recaps_group_id_fkey"
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;

ALTER TABLE "monthly_recaps"
  ADD CONSTRAINT "monthly_recaps_started_by_profile_id_fkey"
  FOREIGN KEY (started_by_profile_id) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE "monthly_recaps"
  ADD CONSTRAINT "monthly_recaps_owner_exclusive_check"
  CHECK ((((profile_id IS NOT NULL) AND (group_id IS NULL))
       OR ((profile_id IS NULL) AND (group_id IS NOT NULL))));

ALTER TABLE "monthly_recaps"
  ADD CONSTRAINT "monthly_recaps_recap_month_check"
  CHECK (((recap_month >= 1) AND (recap_month <= 12)));

ALTER TABLE "monthly_recaps"
  ADD CONSTRAINT "monthly_recaps_recap_year_check"
  CHECK (((recap_year >= 2024) AND (recap_year <= 2100)));

ALTER TABLE "monthly_recaps"
  ADD CONSTRAINT "monthly_recaps_current_step_check"
  CHECK (current_step IN ('welcome','summary','manage_bilan','salary_update','final_recap','completed'));

-- UNIQUE partiels par contexte (un seul recap par mois par profile OU par groupe)
CREATE UNIQUE INDEX "monthly_recaps_profile_unique"
  ON "monthly_recaps" (profile_id, recap_month, recap_year)
  WHERE profile_id IS NOT NULL;

CREATE UNIQUE INDEX "monthly_recaps_group_unique"
  ON "monthly_recaps" (group_id, recap_month, recap_year)
  WHERE group_id IS NOT NULL;

-- Index lookup pour /api/monthly-recap/status (proxy gating sprint 05)
CREATE INDEX "monthly_recaps_completed_lookup"
  ON "monthly_recaps" (profile_id, group_id, recap_month, recap_year, completed_at);

CREATE TRIGGER "update_monthly_recaps_updated_at"
  BEFORE UPDATE ON "monthly_recaps"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

NOTIFY pgrst, 'reload schema';
