-- Feature "Salaire auto à la finalisation du recap" (2026-06-05)
--
-- Ajoute la colonne `recap_origin_id` à `real_income_entries` pour tracer les
-- revenus salaire auto-créés à la fin du Monthly Recap V3 (sprint 14 V3
-- FinalRecapStep — bouton "Valider"). Cette colonne sert deux objectifs :
--
--   1. **Idempotence** : le partial unique index garantit qu'on ne crée jamais
--      2 revenus salaire pour le même recap (si executeCompleteRecap est
--      rejoué — cas rare car la route short-circuit via completed_at, mais
--      filet défense).
--   2. **Read-only à vie + UX modal** : la présence d'un `recap_origin_id`
--      non-null est le signal pour :
--      - L'UI : masquer le kebab + router le long-press vers le modal
--        SalaryValidationModal (au lieu du toggle classique).
--      - Les routes PUT/DELETE : 409 cannot-edit-recap-salary /
--        cannot-delete-recap-salary (cf. handler income-real.ts).
--      - Le toggle-applied : 409 salary-validation-requires-modal pour
--        forcer le passage par la modal (filet défense API direct).
--
-- ON DELETE SET NULL : si un monthly_recap est supprimé (rare, manuel via
-- admin), la ligne salaire reste mais perd sa trace recap. Elle reste
-- toujours read-only à vie via les guards SI elle était déjà validée
-- (applied_to_balance_at IS NOT NULL) — sinon elle devient une row classique.
-- Pour l'instant on n'a aucun cas où monthly_recaps est DELETE applicatif.

ALTER TABLE real_income_entries
  ADD COLUMN IF NOT EXISTS recap_origin_id UUID NULL
    REFERENCES monthly_recaps(id) ON DELETE SET NULL;

-- Partial unique : 1 row salaire au max par recap. Les multiples NULL (= revenus
-- normaux) restent autorisés.
CREATE UNIQUE INDEX IF NOT EXISTS real_income_entries_recap_origin_id_uniq
  ON real_income_entries(recap_origin_id) WHERE recap_origin_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
