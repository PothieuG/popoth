-- Sprint 02 Monthly Recap V3 — carry-over flags sur les transactions réelles.
-- Une transaction "reportée" depuis le recap M-1 a is_carried_over=true et
-- pointe vers le recap source (ON DELETE SET NULL pour préserver la donnée user).

ALTER TABLE "real_expenses"
  ADD COLUMN "is_carried_over" boolean NOT NULL DEFAULT false,
  ADD COLUMN "carried_from_recap_id" uuid;

ALTER TABLE "real_expenses"
  ADD CONSTRAINT "real_expenses_carried_from_recap_id_fkey"
  FOREIGN KEY (carried_from_recap_id) REFERENCES monthly_recaps(id) ON DELETE SET NULL;

CREATE INDEX "real_expenses_carried_over_idx"
  ON "real_expenses" (profile_id, group_id, is_carried_over)
  WHERE is_carried_over = true;

ALTER TABLE "real_income_entries"
  ADD COLUMN "is_carried_over" boolean NOT NULL DEFAULT false,
  ADD COLUMN "carried_from_recap_id" uuid;

ALTER TABLE "real_income_entries"
  ADD CONSTRAINT "real_income_entries_carried_from_recap_id_fkey"
  FOREIGN KEY (carried_from_recap_id) REFERENCES monthly_recaps(id) ON DELETE SET NULL;

CREATE INDEX "real_income_entries_carried_over_idx"
  ON "real_income_entries" (profile_id, group_id, is_carried_over)
  WHERE is_carried_over = true;

NOTIFY pgrst, 'reload schema';
