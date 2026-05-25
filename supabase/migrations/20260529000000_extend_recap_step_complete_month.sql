-- Sprint Monthly-Recap-V3 / Complete-Month-Step (2026-05-29).
-- Étend la CHECK constraint `monthly_recaps_current_step_check` pour autoriser
-- la nouvelle valeur 'complete_month' (étape 2 du wizard, intercalée entre
-- 'welcome' et 'summary'). L'étape permet à l'utilisateur d'ajouter des
-- transactions oubliées du mois recapé avant de voir le bilan général.
--
-- Pattern : DROP + ADD CONSTRAINT (pas d'ALTER CHECK direct en Postgres).
-- Le DEFAULT 'welcome' et la column type 'text' sont préservés.

ALTER TABLE "monthly_recaps"
  DROP CONSTRAINT "monthly_recaps_current_step_check";

ALTER TABLE "monthly_recaps"
  ADD CONSTRAINT "monthly_recaps_current_step_check"
  CHECK (current_step IN (
    'welcome',
    'complete_month',
    'summary',
    'manage_bilan',
    'salary_update',
    'final_recap',
    'completed'
  ));

NOTIFY pgrst, 'reload schema';
