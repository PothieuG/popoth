-- Sprint Gated-Tests-Repair (2026-09-01) — DROP d'une RPC morte ET cassée.
--
-- `transfer_piggy_to_budget_with_insert` (creee le 2026-05-19, sprint
-- Auto-Balance-Atomic-Phase-B) INSERT dans `budget_transfers.monthly_recap_id`.
-- Or cette colonne a ete supprimee 4 jours plus tard par
-- `20260523000001_drop_legacy_recap_tables.sql` (table rase Monthly Recap
-- V1+V2). La RPC leve donc `column "monthly_recap_id" of relation
-- "budget_transfers" does not exist` a CHAQUE appel depuis le 2026-05-23.
--
-- Personne ne s'en est apercu parce qu'elle n'a plus aucun consommateur
-- applicatif : le flux Phase-B qui l'appelait a disparu avec le meme sprint.
-- Seul son test gated `SUPABASE_RPC_CONCURRENCY_TESTS=1` la touchait encore,
-- et cette suite n'est pas jouee par `pnpm verify`.
--
-- Decision utilisateur 2026-09-01 : SUPPRIMER plutot que reparer. Pattern
-- "Path B closed-by-deletion" du repo (8+ precedents, cf. operational-rules
-- §1) — garder une RPC cassee entretient l'illusion qu'elle fonctionne.
-- Si le besoin de tracer ces transferts revient un jour, la reecrire contre
-- le schema du moment sera plus sain que de ressusciter celle-ci.
--
-- DROP RESTRICT (pas CASCADE) : Postgres refuse explicitement s'il reste une
-- dependance cachee, ce qui vaut controle. Recovery : re-appliquer
-- `20260519000001_create_transfer_piggy_to_budget_with_insert_rpc.sql`
-- (qui restera cassee tant que la colonne manque).

-- Signature verifiee dans pg_proc :
--   (p_to_budget_id uuid, p_amount numeric, p_profile_id uuid,
--    p_group_id uuid, p_reason text, p_recap_id uuid)
DROP FUNCTION IF EXISTS transfer_piggy_to_budget_with_insert(
  uuid, numeric, uuid, uuid, text, uuid
) RESTRICT;

NOTIFY pgrst, 'reload schema';
