-- Sprint Auto-Cascade-Piggy / Traceability (2026-05-26)
--
-- Création de la table `expense_savings_sources` qui trace la provenance
-- détaillée de chaque débit savings + piggy par dépense. Sans cette trace,
-- modifier ou supprimer une dépense ayant utilisé la cascade auto
-- (tirelire + cross-budget proportionnel) perd l'information « qui a
-- contribué et combien », rendant impossible le refund correct vers les
-- bonnes sources.
--
-- Architecture :
--   - 1 row par source débitée pour chaque real_expense :
--     * source_type = 'piggy' → source_budget_id NULL (= tirelire owner)
--     * source_type = 'budget_savings' → source_budget_id NOT NULL
--       (= savings du budget destination OU d'un budget cross)
--   - FK CASCADE sur real_expense_id : suppression d'une dépense supprime
--     ses sources (rebalancing au refund passe par la RPC dédiée AVANT
--     le DELETE pour rendre les fonds).
--   - FK SET NULL sur source_budget_id : si un budget source est supprimé
--     (rare), la trace persiste mais l'info budget est perdue ; refund
--     fallback dans la logique route (= argent reste dans le pool global
--     non rendu, edge case rare).
--
-- Le pattern d'usage est :
--   - INSERT à l'add_expense_with_*_cascade RPC (1 ou N rows selon cascade).
--   - SELECT au reverse (delete ou edit) pour crediter chaque source.
--   - DELETE explicite à l'edit (puis re-INSERT du nouveau breakdown).
--
-- Sécurité : RLS ENABLED sans policies = accès service_role uniquement
-- (cf. lib/supabase-server.ts). Les routes API sont seules à lire/écrire
-- cette table ; l'utilisateur ne la voit jamais directement.

CREATE TABLE IF NOT EXISTS "expense_savings_sources" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "real_expense_id" uuid NOT NULL,
  "source_type" text NOT NULL,
  "source_budget_id" uuid,
  "amount" numeric(10, 2) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "expense_savings_sources"
  ADD CONSTRAINT "expense_savings_sources_pkey" PRIMARY KEY (id);

ALTER TABLE "expense_savings_sources"
  ADD CONSTRAINT "expense_savings_sources_real_expense_id_fkey"
  FOREIGN KEY (real_expense_id) REFERENCES real_expenses(id) ON DELETE CASCADE;

ALTER TABLE "expense_savings_sources"
  ADD CONSTRAINT "expense_savings_sources_source_budget_id_fkey"
  FOREIGN KEY (source_budget_id) REFERENCES estimated_budgets(id) ON DELETE SET NULL;

ALTER TABLE "expense_savings_sources"
  ADD CONSTRAINT "expense_savings_sources_source_type_check"
  CHECK (source_type IN ('piggy', 'budget_savings'));

ALTER TABLE "expense_savings_sources"
  ADD CONSTRAINT "expense_savings_sources_coherence_check"
  CHECK (
    (source_type = 'piggy' AND source_budget_id IS NULL)
    OR
    (source_type = 'budget_savings' AND source_budget_id IS NOT NULL)
  );

ALTER TABLE "expense_savings_sources"
  ADD CONSTRAINT "expense_savings_sources_amount_check"
  CHECK (amount > 0);

CREATE INDEX idx_expense_savings_sources_real_expense
  ON public.expense_savings_sources USING btree (real_expense_id);

CREATE INDEX idx_expense_savings_sources_source_budget
  ON public.expense_savings_sources USING btree (source_budget_id)
  WHERE source_budget_id IS NOT NULL;

ALTER TABLE "expense_savings_sources" ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
