-- Feature "Contribution au groupe — dépense virtuelle perso" (2026-05-28)
--
-- Ajoute 2 colonnes à `real_expenses` pour supporter la dépense virtuelle
-- "Contribution au groupe XXX" auto-managée par trigger (cf. migration
-- 20260528010000) :
--
--   - contribution_id UUID NULL → FK vers group_contributions(id) ON DELETE
--     CASCADE. Quand non-null, identifie une ligne contribution auto-managée
--     (création/maintien par trigger sur group_contributions UPSERT). Quand
--     null (cas par défaut), c'est une dépense user-saisie classique.
--
--   - last_applied_amount NUMERIC(10,2) NULL → snapshot du montant au moment
--     de la dernière validation long-press (apply_to_balance). Utilisé pour
--     deux choses :
--       (1) calcul du delta affiché dans l'UI quand la contribution change
--           après validation (UI : "Attention, la valeur est passée à Y€,
--           soit +/-Z€...").
--       (2) montant à créditer back sur le solde lors d'une dé-validation OU
--           d'une suppression de la row (trigger BEFORE DELETE — cf.
--           migration 20260528010000).
--     Pour les dépenses normales (non-contribution), la colonne est aussi
--     écrite par la RPC `toggle_real_expense_applied_to_balance` (cf.
--     migration 20260528020000) mais le drift est impossible côté UI (les
--     PUT bloquent l'édition d'une row appliquée), donc le delta resterait
--     toujours 0 — pas d'effet visible.
--
-- Index :
--   - Index B-tree partial sur `contribution_id` quand non-null. Les rows
--     contribution sont rares (au plus 1 par user) mais le lookup
--     "trouve la real_expense liée à cette contribution" est sur le
--     chemin chaud du trigger (UPSERT côté group_contributions). Index
--     partial = empreinte minimale + writes des dépenses normales (la
--     vaste majorité) inchangés (pas de maintenance d'index).
--   - Pas d'UNIQUE constraint : techniquement on veut "au plus 1 row
--     non-null par contribution_id", mais la UNIQUE classique n'accepte
--     pas de partial directement en PostgreSQL en colonne. On utilise
--     UNIQUE INDEX WHERE pour la même garantie sémantique + permet à
--     `INSERT ... ON CONFLICT (contribution_id) WHERE ...` d'inférer
--     l'index dans la fonction trigger.

ALTER TABLE real_expenses
  ADD COLUMN IF NOT EXISTS contribution_id UUID NULL
    REFERENCES group_contributions(id) ON DELETE CASCADE;

ALTER TABLE real_expenses
  ADD COLUMN IF NOT EXISTS last_applied_amount NUMERIC(10, 2) NULL;

-- Partial unique : 1 row contribution au max par group_contributions row.
-- Les multiples NULL (= dépenses normales) restent autorisés.
CREATE UNIQUE INDEX IF NOT EXISTS real_expenses_contribution_id_uniq
  ON real_expenses(contribution_id) WHERE contribution_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
