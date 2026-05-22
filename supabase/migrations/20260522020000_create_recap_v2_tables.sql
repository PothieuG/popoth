-- Sprint Recap-V2-Ossature (2026-05-22)
--
-- Création des tables monthly_recaps_v2 et recap_snapshots_v2 pour la
-- nouvelle ossature minimale du workflow récap mensuel. V2 démarre avec
-- les colonnes strictement nécessaires au gating (id, owner XOR, month,
-- year, completed_at, created_at) ; les colonnes d'état (current_step,
-- total_surplus/deficit, remaining_to_live_*) viendront sprint par sprint.
--
-- V1 préservée inerte sous app/api/monthly-recap-legacy/ et lib/recap-legacy/
-- pour référence. Les tables V1 (monthly_recaps, recap_snapshots) restent
-- intactes — lecture seule en pratique post-swap (étape 4 du plan ossature).
--
-- Le check-status V2 (lib/recap/check-status.ts, étape 4 du plan) lira
-- monthly_recaps_v2 ; le gating proxy.ts est preservé byte-identique.
--
-- Constraints/FK/RLS miroir V1 (suffix _v2 sur tous les noms d'objets).
-- Pas de RPC ajoutée → EXPECTED_RPCS reste 11.

-- ============================================================================
-- monthly_recaps_v2
-- ============================================================================
CREATE TABLE IF NOT EXISTS "monthly_recaps_v2" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "profile_id" uuid,
  "group_id" uuid,
  "recap_month" integer NOT NULL,
  "recap_year" integer NOT NULL,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "monthly_recaps_v2"
  ADD CONSTRAINT "monthly_recaps_v2_pkey" PRIMARY KEY (id);
ALTER TABLE "monthly_recaps_v2"
  ADD CONSTRAINT "monthly_recaps_v2_unique_month_profile"
  UNIQUE (profile_id, recap_month, recap_year);
ALTER TABLE "monthly_recaps_v2"
  ADD CONSTRAINT "monthly_recaps_v2_unique_month_group"
  UNIQUE (group_id, recap_month, recap_year);

ALTER TABLE "monthly_recaps_v2"
  ADD CONSTRAINT "monthly_recaps_v2_owner_exclusive_check"
  CHECK ((((profile_id IS NOT NULL) AND (group_id IS NULL))
       OR ((profile_id IS NULL) AND (group_id IS NOT NULL))));
ALTER TABLE "monthly_recaps_v2"
  ADD CONSTRAINT "monthly_recaps_v2_recap_month_check"
  CHECK (((recap_month >= 1) AND (recap_month <= 12)));
ALTER TABLE "monthly_recaps_v2"
  ADD CONSTRAINT "monthly_recaps_v2_recap_year_check"
  CHECK ((recap_year >= 2020));

ALTER TABLE "monthly_recaps_v2"
  ADD CONSTRAINT "monthly_recaps_v2_profile_id_fkey"
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE "monthly_recaps_v2"
  ADD CONSTRAINT "monthly_recaps_v2_group_id_fkey"
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;

CREATE INDEX idx_monthly_recaps_v2_profile_date
  ON public.monthly_recaps_v2 USING btree (profile_id, recap_year, recap_month);
CREATE INDEX idx_monthly_recaps_v2_group_date
  ON public.monthly_recaps_v2 USING btree (group_id, recap_year, recap_month);

ALTER TABLE "monthly_recaps_v2" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own monthly recaps v2"
  ON "monthly_recaps_v2"
  FOR ALL
  USING ((profile_id = auth.uid()));

CREATE POLICY "Group members can manage group monthly recaps v2"
  ON "monthly_recaps_v2"
  FOR ALL
  USING (((group_id IS NOT NULL) AND (group_id IN ( SELECT profiles.group_id
   FROM profiles
  WHERE (profiles.id = auth.uid())))));

-- ============================================================================
-- recap_snapshots_v2
-- ============================================================================
CREATE TABLE IF NOT EXISTS "recap_snapshots_v2" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "profile_id" uuid,
  "group_id" uuid,
  "snapshot_month" integer NOT NULL,
  "snapshot_year" integer NOT NULL,
  "snapshot_data" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "is_active" boolean NOT NULL DEFAULT true
);

ALTER TABLE "recap_snapshots_v2"
  ADD CONSTRAINT "recap_snapshots_v2_pkey" PRIMARY KEY (id);

ALTER TABLE "recap_snapshots_v2"
  ADD CONSTRAINT "recap_snapshots_v2_owner_exclusive_check"
  CHECK ((((profile_id IS NOT NULL) AND (group_id IS NULL))
       OR ((profile_id IS NULL) AND (group_id IS NOT NULL))));
ALTER TABLE "recap_snapshots_v2"
  ADD CONSTRAINT "recap_snapshots_v2_snapshot_month_check"
  CHECK (((snapshot_month >= 1) AND (snapshot_month <= 12)));
ALTER TABLE "recap_snapshots_v2"
  ADD CONSTRAINT "recap_snapshots_v2_snapshot_year_check"
  CHECK ((snapshot_year >= 2020));

ALTER TABLE "recap_snapshots_v2"
  ADD CONSTRAINT "recap_snapshots_v2_profile_id_fkey"
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE "recap_snapshots_v2"
  ADD CONSTRAINT "recap_snapshots_v2_group_id_fkey"
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;

CREATE INDEX idx_recap_snapshots_v2_profile_date
  ON public.recap_snapshots_v2 USING btree (profile_id, snapshot_year, snapshot_month);
CREATE INDEX idx_recap_snapshots_v2_group_date
  ON public.recap_snapshots_v2 USING btree (group_id, snapshot_year, snapshot_month);
CREATE INDEX idx_recap_snapshots_v2_active
  ON public.recap_snapshots_v2 USING btree (is_active);

ALTER TABLE "recap_snapshots_v2" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own recap snapshots v2"
  ON "recap_snapshots_v2"
  FOR ALL
  USING ((profile_id = auth.uid()));

CREATE POLICY "Group members can manage group recap snapshots v2"
  ON "recap_snapshots_v2"
  FOR ALL
  USING (((group_id IS NOT NULL) AND (group_id IN ( SELECT profiles.group_id
   FROM profiles
  WHERE (profiles.id = auth.uid())))));

-- ============================================================================
-- PostgREST schema reload
-- ============================================================================
NOTIFY pgrst, 'reload schema';
