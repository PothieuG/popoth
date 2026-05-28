-- Feature "Contribution au groupe — revenu virtuel groupe miroir" (2026-06-05)
--
-- Backfill : crée les rows real_income_entries miroir pour les
-- group_contributions existants au déploiement. Idempotent grâce à
-- l'ON CONFLICT du partial unique index sur contribution_id.
--
-- Toutes les rows backfillées sont créées en état non-validé
-- (applied_to_balance_at = NULL) — l'utilisateur les validera manuellement
-- via long-press → orchestratrice toggle_contribution_pair_applied (qui
-- gère le pair-locked avec la dépense user déjà existante).
--
-- Run-once : le trigger sync_contribution_real_income prend le relais pour
-- toutes les UPSERT futures sur group_contributions.

INSERT INTO real_income_entries (
  profile_id,
  group_id,
  contribution_id,
  amount,
  description,
  entry_date,
  is_exceptional,
  is_carried_over,
  created_by_profile_id
)
SELECT
  NULL,
  gc.group_id,
  gc.id,
  gc.contribution_amount,
  'Contribution de ' || COALESCE(p.first_name, 'membre'),
  CURRENT_DATE,
  false,
  false,
  gc.profile_id
FROM group_contributions gc
LEFT JOIN profiles p ON p.id = gc.profile_id
WHERE gc.contribution_amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM real_income_entries ri WHERE ri.contribution_id = gc.id
  );

NOTIFY pgrst, 'reload schema';
