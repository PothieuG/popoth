# Roadmap détaillée — Part 24 : Sprint 16 V3 read-only rows + Contribution dépense virtuelle

> Append-only chronologique. Voir [CLAUDE.md §11](../../CLAUDE.md) pour l'index global. Part précédente : [Part 23](roadmap-detailed-23-carry-over.md) (sprint 15 V3 carry-over UI).

---

- ✅ **Sprint 16 V3 — Virtual read-only rows pour salaire + contribution** (livré 2026-05-28, 1 commit `78ad552`). Section 6 de la spec Monthly Recap V3 : après recap, le salaire (perso) et la contribution (groupe) apparaissent en read-only dans la liste des revenus estimés du drawer Planification — informatifs + immuables + cadenas. **Décision lockée 00-README.md** : virtual UI-only via `FinancialData.meta.readOnlyIncomes`, **zéro migration DB**.

  - **Backend** : `FinancialData` étendu avec `meta.readOnlyIncomes: ReadOnlyIncome[]` (`{ kind: 'salary'|'contribution', label, amount }`). `_loadFinancialData` populate selon contexte (perso = salaire si > 0, groupe = via `userId` optionnel). Signature `getGroupFinancialData(groupId, userId?)` — paramètre optionnel pour préserver compat des 4 importeurs internes (load-summary, snapshots, budget-savings-detail, gated test). `lib/api/finance/summary.ts` thread `userId` (déjà dispo via `withAuthAndProfile`). EMPTY_FINANCIAL_DATA + catch fallback incluent `meta: { readOnlyIncomes: [] }`.
  - **UI** : `PlanningDrawer` refactoré — drop `useProfile()` + ligne salaire hardcodée (157 LOC supprimées), remplacé par boucle générique sur `readOnlyIncomes` avec cadre vert clair + badge "Profil"/"Groupe" piloté par `kind` + cadenas SVG inline. `FinancialIndicators` forward `readOnlyIncomes`. Les 2 pages dashboards passent `financialData?.meta?.readOnlyIncomes ?? []`.
  - **Pas de modification de `totalEstimatedIncome`** : ce champ est consommé par `lib/recap/load-summary.ts` (`ravEstime`) → toucher la sémantique ferait dériver les calculs du recap mensuel (hors scope). Le total affiché dans le drawer reste local (`totalIncomes + sum(readOnlyIncomes)`).
  - **Drive-by fix** : `case 2 group golden math` de `financial-data.test.ts` cassé pré-existant (trigger Group-Budget-Auto-Sync 2026-05-19 auto-syncait `monthly_budget_estimate` à SUM(estimated_budgets) → contribution = 600 et non 750 attendu). Correction : `GROUP_EXPECTED_CONTRIBUTION = 600`, `GOLDEN_GROUP.remainingToLive = 1000`, comments mis à jour.
  - **Tests** : +4 gated SUPABASE_FINANCE_TESTS (profile sans salaire, groupe avec userId membre, groupe sans userId backward-compat, groupe avec userId outsider) + +7 RTL `PlanningDrawer.test.tsx` (rendu salary/contribution avec badge + cadenas, ordre virtual avant real, pas de boutons Modifier/Supprimer sur virtual, total = sum(real) + sum(readOnly), empty-state, a11y axe). GOLDEN_PROFILE/GOLDEN_GROUP étendus avec `meta: { readOnlyIncomes: [...] }`.

- ✅ **Itération all-members contributions** (livré 2026-05-28, commit `6d14b4f`). Suite à feedback user : le dashboard groupe doit afficher la contribution de **chaque membre** du groupe, pas seulement celle du user courant. Refactor sémantique :
  - `getGroupFinancialData(groupId)` — drop le param `userId?` (aucun marqueur visuel demandé pour distinguer la contribution du user courant).
  - `_loadFinancialData` group branch : SELECT enrichi `group_contributions.contribution_amount` + `profiles:profile_id (first_name)` (join FK existante), résultat réutilisé pour `totalProfileContributions` (RAV) ET `meta.readOnlyIncomes` (1 ligne par membre). Tri stable par `first_name.localeCompare('fr')`, filtre `> 0`.
  - **Label format** : `Contribution de <prénom>` (choix user — vs "Alice", "Contribution Alice" ou autres). Fallback `Contribution groupe` si first_name manquant.
  - `PlanningDrawer` : `key={readonly-${kind}-${idx}}` pour gérer plusieurs lignes contribution sans warning React duplicate-key.
  - **Tests gated finance** : `GOLDEN_GROUP.meta.readOnlyIncomes = [{ kind: 'contribution', label: 'Contribution de Finance', amount: 600 }]`. Multi-member fixture nouveau (Alice 2000€ + Bob 1000€ + budget 1500€ → Alice 1000€ + Bob 500€) validant tri par prénom. Cas empty (monthly_budget=0, no member linked) → vide.
  - **RTL** : test multi-membres `findAllByTestId('readonly-income-contribution')` valide 2 lignes ordonnées.

- ✅ **Fix bootstrap groupe vide via salary-pool ceiling** (livré 2026-05-28, commit `5f8bfa8`). Cycle vicieux identifié par user : un groupe vide ne pouvait pas créer son premier budget. La formule trigger contribution = `(user_salary / total_salaries) × monthly_budget` donnait 0 quand budget=0, donc `totalEstimatedIncome` groupe = 0, donc la refine Zod `newBudget ≤ totalEstimatedIncome` bloquait tout ajout. Mathématiquement le check est circulaire : la somme des contributions ÉGALE le budget par construction du trigger — le check ne protège donc rien et bloque juste le bootstrap.
  - **Fix** : en contexte groupe, le plafond de validation budget devient `sum(member salaries)` (capacité contributive max) au lieu de `sum(contributions)`. Le check reste pertinent en perso (`budget ≤ revenus + salaire`).
  - **Backend** : `FinancialData.meta.groupSalaryTotal?: number` (groupe only) = somme `group_contributions.salary` (snapshot auto-maintenu par triggers). SELECT contributions étendu pour inclure `salary` en une seule requête.
  - **UI** : `PlanningDrawer` calcule `budgetCeiling = (groupSalaryTotal ?? 0) + totalIncomes` en groupe, sinon `totalIncomesWithReadOnly` en perso. Passé aux 2 dialogs budget (Add/Edit). Income dialogs et "Différence estimée" bottom summary inchangés.
  - **Forward chain** : `FinancialIndicators` forward `groupSalaryTotal?` ; `group-dashboard/page.tsx` thread `financialData?.meta?.groupSalaryTotal`. Page perso n'envoie rien (champ inutilisé en perso).
  - **Tests gated** : +3 cas (GOLDEN_GROUP.meta.groupSalaryTotal=1500, multi-membres 3000, empty group 0). `case 5 fail-soft` splitté en `PROFILE_EMPTY_SHAPE` (sans groupSalaryTotal) + `GROUP_EMPTY_SHAPE` (groupSalaryTotal=0).

- ✅ **Feature "Contribution au groupe — dépense virtuelle perso"** (livré 2026-05-28, commit `bea6548`). Pendant côté **dépenses** du sprint 16 (qui couvrait les revenus). Pour chaque membre d'un groupe, une dépense virtuelle "Contribution au groupe XXX" apparaît automatiquement dans la liste des dépenses réelles du dashboard perso, auto-managée par triggers DB. **Approche persistée** (real_expenses row + triggers) plutôt que virtuelle pure : permet la réutilisation du mécanisme long-press apply + impact RAV via `exceptionalExpenses` sans dupliquer la logique.

  **Architecture installée** :

  **(1) Migration `20260528000000_add_contribution_id_to_real_expenses.sql`** : ajoute `real_expenses.contribution_id UUID NULL` (FK `group_contributions(id) ON DELETE CASCADE`) + `real_expenses.last_applied_amount NUMERIC(10,2) NULL` + partial unique index `WHERE contribution_id IS NOT NULL` (1 row contribution max par group_contribution, multiples NULL = dépenses normales autorisés).

  **(2) Migration `20260528010000_create_contribution_sync_triggers.sql`** : 2 fonctions trigger SECURITY DEFINER.
  - `sync_contribution_real_expense` (AFTER INSERT/UPDATE on group_contributions) : UPSERT row real_expenses miroir avec `amount = NEW.contribution_amount`, `description = 'Contribution au groupe <nom>'`, `is_exceptional = true`, `expense_date = CURRENT_DATE`. ON CONFLICT (contribution_id) DO UPDATE met à jour `amount` + `description` uniquement (préserve `applied_to_balance_at` + `last_applied_amount`). Si `contribution_amount = 0`, DELETE la row (le BEFORE DELETE trigger restitue le solde si applied).
  - `credit_balance_on_contribution_delete` (BEFORE DELETE on real_expenses) : si la row supprimée a `contribution_id != null` ET était applied (`applied_to_balance_at != null` + `last_applied_amount != null`), crédite `bank_balances.balance += OLD.last_applied_amount` pour le profile concerné. Garantit la restitution automatique quand le user quitte le groupe (CASCADE depuis group_contributions DELETE).
  - **Backfill** au moment de la migration : INSERT real_expenses pour les contributions existantes avec `contribution_amount > 0 AND NOT EXISTS` (idempotent).

  **(3) Migration `20260528020000_update_toggle_applied_for_contribution_drift.sql`** : `CREATE OR REPLACE` de `toggle_real_expense_applied_to_balance` et `toggle_real_income_applied_to_balance` (symétrique pour cohérence). Nouvelle sémantique 3-branches :
  - `p_apply=true` ET pas appliqué → apply standard (debit `amount`, set `applied_to_balance_at = NOW`, `last_applied_amount = amount`).
  - `p_apply=true` ET déjà appliqué ET `last_applied_amount IS DISTINCT FROM amount` → "re-apply drift" (delta = amount - last_applied_amount, balance ajustée de `-delta`, `last_applied_amount = amount`).
  - `p_apply=true` ET déjà appliqué ET in-sync → no-op `P0002`.
  - `p_apply=false` ET appliqué → un-apply (balance += `last_applied_amount`, fields reset).
  - `p_apply=false` ET pas appliqué → no-op `P0002`.
  - **Note** : `last_applied_amount` remplace `amount` comme source de vérité pour la restitution (important si amount a changé entre apply et un-apply via trigger). `real_income_entries` reçoit aussi le tracking pour cohérence (drift impossible côté revenus mais pattern uniforme).

  **(4) Migration `20260528030000_auto_devalidate_contribution_on_amount_change.sql` (v2 trigger)** : `CREATE OR REPLACE` de `sync_contribution_real_expense` avec logique d'**auto-devalidate**. Quand la contribution change ALORS QUE la row était applied (state B), le trigger :
  - Crédite le solde de `last_applied_amount` (restitution).
  - Set `applied_to_balance_at = NULL`.
  - **PRÉSERVE** `last_applied_amount` (pour permettre l'affichage du delta dans le warning UI).
  - Update `amount` au nouveau montant.
  - Conséquence : le user voit immédiatement le warning + solde restitué, n'a qu'à long-press pour re-valider au nouveau montant.
  - Branche "drift re-validate" du toggle RPC (migration 020000) devient dead code en pratique — préservée en filet défensif.

  **(5) Backend** : `lib/api/finance/expenses-real.ts` GET utilise `SELECT *` (les nouvelles colonnes remontent automatiquement). PUT + DELETE guards 409 `cannot-edit-contribution-row` / `cannot-delete-contribution-row` quand `contribution_id IS NOT NULL` (interdit toute manipulation manuelle — cycle de vie 100% piloté par triggers).

  **(6) Hook + types** : `RealExpense` et `RealIncome` interfaces étendues avec `contribution_id?: string | null` + `last_applied_amount?: number | null`. `lib/database.types.ts` régénéré depuis dev DB (`pnpm exec supabase gen types typescript --project-id ddehmjucyfgyppfkbddr` — pattern UTF-8 explicit via `[System.IO.File]::WriteAllText` pour éviter le BOM UTF-16 LE par défaut PowerShell `>`).

  **(7) UI `TransactionListItem`** — mode "contribution row" :
  - Détection : `transaction.contribution_id != null` (uniquement type='expense').
  - State machine 4 cas :
    - A : `!applied && last_applied=null` → "doit être validée".
    - B : `applied && last_applied=amount` → aucun warning.
    - C : `!applied && last_applied!=amount` (auto-devalidated) → "vous devez ajouter|retirer X€ au groupe avant de valider cette dépense" (verbe sign-aware, montant = valeur absolue du delta).
    - D : `!applied && last_applied=amount` (came-back) → "doit être validée".
  - Variables : `needsValidation = !applied`, `hasDelta = last_applied != null && last_applied != amount`, `driftDelta = amount - last_applied`.
  - Catégorie texte en **gris** (`text-gray-600`) — distinct du jaune (`text-yellow-700` exceptionnel) et du bleu (`text-blue-700` budget-linked).
  - Description = `transaction.description` (rendue par le trigger : "Contribution au groupe XXX").
  - Dropdown kebab **masqué entièrement** (`{!isContributionRow && <div>...kebab...</div>}`) → seule action = long-press validate/un-validate.
  - Bloc warning in-card (border + bg orange légers) avec icône warning + texte conditionné par `hasDelta`. `role="status"` pour a11y.
  - Long-press handler inchangé (utilise `onToggleApplied` existant) — la branche drift du RPC gère la sync delta.

  **(8) UI `TransactionTabsComponent`** : `useMemo` de tri qui float les rows contribution avec warning state (`needsAttention = !contribution_id ? false : !applied || last_applied != null && last_applied != amount`) en tête de la liste expenses. Préserve l'ordre serveur chronologique pour le reste.

  **(9) Tests** :
  - **Gated SUPABASE_TRIGGER_TESTS (5 cas, `lib/__tests__/contribution-real-expense.test.ts`)** : (1) création trigger au join + budget initial, (2) UPDATE budget pendant applied → AUTO-DEVALIDATE (solde restitué + applied_at NULL + last_applied préservé), (3) re-validate via simple apply post auto-devalidate → solde -= nouveau montant + last_applied = amount, (4) un-apply manuel → solde += last_applied + fields reset, (5) DELETE group_contributions CASCADE → row supprimée + balance restituée si applied.
  - **RTL non-gated (7 cas, `components/dashboard/__tests__/TransactionListItem.contribution.test.tsx`)** : 4 états (A/B/C/D), kebab absent, couleur gray, drift delta sign-aware (ajouter/retirer).
  - Suite complète : **625 non-gated + 187 gated skipped**.

- ✅ **Refactor warning copy** (commit `73ce8ad`). Suite feedback user : messages plus directs.
  - Drift : `"La contribution au groupe a changé, vous devez ajouter|retirer X€ au groupe avant de valider cette dépense."` (verbe sign-aware, valeur absolue du delta).
  - Never-validated : `"La valeur de la contribution doit être validée."` (drop la mention long-press).

- ✅ **Auto-devalidate v2** (commit `31a8ed5`). Le user a demandé que la row se dévalide automatiquement dès que la contribution change (au lieu de rester en état drift). Le trigger DB `sync_contribution_real_expense` est étendu pour faire cette opération atomiquement, ce qui élimine le besoin du user de faire un un-apply manuel avant de re-valider. UI simplifiée : `needsValidation = !applied` + `hasDelta = last_applied != amount` → 4 états couverts par 2 messages. RTL fixtures drift mises à jour (`applied_to_balance_at: null` au lieu de `'ISO'`).

- ✅ **Fix invalidateFinancialRefreshes cross-domain** (commit `1aabbd8`). Le user a noté qu'après modification d'un budget groupe via le planificateur, il devait refresh manuellement la vue perso pour voir l'update de sa dépense contribution. Cause : `invalidateFinancialRefreshes` invalidait 5 queryKeys mais pas `['real-expenses']` ni `['bank-balance']` — les 2 keys que le nouveau trigger DB impacte côté perso. Extension à 7 keys (les 5 existantes + 2 nouvelles). Tous les hooks groupe qui mutent un budget/revenu (qui appellent déjà la helper dans `onSuccess`) propagent désormais automatiquement aux 2 nouvelles. Test query-client mis à jour (1 cas, 7 invalidate ordonnés).

---

**Synthèse Part 24** : 8 sprints livrés, 6 commits, 4 nouvelles migrations DB, 2 nouvelles fonctions trigger (sync_contribution_real_expense + credit_balance_on_contribution_delete → functions versionnées 26 → 28), 2 RPCs modifiées (toggle_real_expense/income_applied_to_balance — `last_applied_amount` tracking). Tests **611 → 626 non-gated** (+15 : 7 RTL contribution + 6 RTL revenu virtuel + 1 query-client refresh) ; **177 → 187 gated** (+10 : 4 sprint 16 + 5 contribution trigger + 1 misc). Routes API **40 inchangées**.

**Pattern réutilisable installé** : "auto-managed row via trigger + last_applied snapshot for drift display + auto-devalidate on change". Applicable à tout futur cas où une valeur dérivée DB doit apparaître côté UI comme une transaction read-only avec impact balance optionnel + warning sur drift.
