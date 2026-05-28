-- Feature "Contribution au groupe — revenu virtuel groupe miroir" (2026-06-05)
--
-- Extension du Sprint 16 V3 (Contribution dépense virtuelle perso, migrations
-- 20260528000000-030000) : on ajoute un revenu miroir côté groupe pour
-- chaque `group_contributions` row. Symétrique à `real_expenses.contribution_id`.
--
-- Sémantique :
--   - Pour chaque ligne `group_contributions` (1 par membre du groupe), un
--     trigger maintient AUSSI 1 ligne `real_income_entries` dans la vue
--     groupe (group_id = NEW.group_id) avec :
--       * description = 'Contribution de <prénom>'
--       * amount = NEW.contribution_amount
--       * is_exceptional = false (pas de double-count avec totalIncomeContribution
--         virtuel qui aggrège déjà sum(contributions) pour le groupe)
--       * created_by_profile_id = NEW.profile_id (avatar = la personne concernée,
--         pas le finaliseur)
--       * applied_to_balance_at = NULL (non-validé initialement)
--       * contribution_id = NEW.id (lien fort vers la contribution source)
--
-- Synchronisation :
--   - Validation du revenu miroir ↔ validation de la dépense user perso :
--     pair-locked atomique via RPC orchestratrice (à venir migration suivante).
--   - Auto-devalidate symétrique quand contribution_amount change.
--   - CASCADE DELETE si la group_contributions est DELETE.
--
-- Index :
--   - Partial unique : 1 row miroir au max par contribution_id (idempotence
--     trigger UPSERT). Les multiples NULL restent autorisés (= revenus normaux).

ALTER TABLE real_income_entries
  ADD COLUMN IF NOT EXISTS contribution_id UUID NULL
    REFERENCES group_contributions(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS real_income_entries_contribution_id_uniq
  ON real_income_entries(contribution_id) WHERE contribution_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
