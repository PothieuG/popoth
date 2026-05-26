-- Sprint Clean-Slate-Recap (2026-05-23) — table rase Monthly Recap V1 + V2
-- pour repartir d'une base saine avant l'implémentation V3.
--
-- Drop ordre :
--   1. FK column `budget_transfers.monthly_recap_id` avec CASCADE — 2 RLS
--      policies (`Users can create/view transfers for their recaps`) dépendent
--      de la colonne et sont retirées par CASCADE.
--   2. Tables V2 (depend sur les contraintes baseline).
--   3. Tables V1.
--
-- `remaining_to_live_snapshots` est PRÉSERVÉE — utilisée par 6 modules finance
-- (budgets / expenses-real / income-real / incomes / expenses-add-with-logic)
-- pour l'audit trail RAV indépendamment du workflow recap.
--
-- Les RLS policies sur les 4 tables drop sont retirées par CASCADE.

ALTER TABLE budget_transfers DROP COLUMN IF EXISTS monthly_recap_id CASCADE;

DROP TABLE IF EXISTS recap_snapshots_v2 CASCADE;
DROP TABLE IF EXISTS monthly_recaps_v2 CASCADE;

DROP TABLE IF EXISTS recap_snapshots CASCADE;
DROP TABLE IF EXISTS monthly_recaps CASCADE;

NOTIFY pgrst, 'reload schema';
