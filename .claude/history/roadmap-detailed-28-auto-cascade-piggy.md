# Roadmap détaillée — Part 28 : Auto-Cascade-Piggy + Traceability

> Append-only chronologique. Voir [CLAUDE.md §11](../../CLAUDE.md) pour l'index global. Part précédente : [Part 27](roadmap-detailed-27-recap-positive-consume-surplus.md) (Recap-Positive-Consume-Surplus).

---

- ✅ **Sprint Auto-Cascade-Piggy + Traceability** (livré 2026-05-26, 2 itérations bundled). Deux problèmes adressés ensemble dans le mini-recap d'ajout/édition de dépense :

  ### Itération 1 — Cascade automatique tirelire + cross-budget proportionnel

  **Bug visuel #1 (mode ADD)** : la ligne `Budget « X » -40 €` apparaissait à tort dans la section « Impact de la dépense » quand la dépense était couverte intégralement par les économies du budget. Cause : `currentBudgetSpent = expenseProgress[budgetId]?.spentAmount ?? breakdown.budget_spent_before` lisait un cache `useProgressData` stale entre 2 ouvertures rapides du modal — `?? fallback` ne tire pas sur `0` (nullish coalescing strict), donc un cache à 0 produisait `budgetPoolDelta = newBudgetPoolUsage - 0 > 0` artificiellement. Fix : drop la dépendance à `useProgressData` dans `ExpenseBreakdownPreview`, utiliser exclusivement `breakdown.budget_spent_before` (fresh DB read garanti par le `isLoading` gate de TanStack Query).

  **Cascade auto** : remplacement de la sélection manuelle des budgets sources (encart orange avec chips sélectionnables) par un encart violet informatif. Quand `overflow > 0` après allocation locale (savings destination + budget destination), la nouvelle fonction `calculateBreakdownWithAutoCascade` ([lib/expense-breakdown.ts](../../lib/expense-breakdown.ts)) puise **tirelire en priorité** (rupture avec la règle ❌ historique "piggy JAMAIS auto-débitée" — désormais amendée : piggy auto-débit UNIQUEMENT pour combler un overflow, jamais en allocation locale), **puis cross-budget proportionnellement** aux savings dispos (drift cents géré via réajustement du dernier élément). Résidu (total dispo < overflow) absorbé par `fromBudget` (déficit destination, impact RAV). Decision validées user : (1) cascade dès `overflow > 0` ; (2) couvrir au max + reste sur budget si insuffisant ; (3) dosage proportionnel aux économies absolues. Server autoritatif : le client envoie juste `{amount, description, ...}`, le serveur recalcule entièrement via `calculateBreakdownWithAutoCascade` et dispatche vers la RPC `add_expense_with_cross_budget_cascade` si `fromPiggyBank > 0 || crossBudgetDebits.length > 0`, sinon `add_expense_with_breakdown`.

  ### Itération 2 — Traçabilité des sources pour modification/suppression précise

  **Bug surfacé** : sans trace, modifier ou supprimer une dépense cascade-auto perdait l'info "qui a contribué et combien". `reverseAllocation` crédite uniquement `amount_from_budget_savings` au destination budget — or cette colonne consolide local + cross-budget. Refund incorrect ⇒ argent déplacé silencieusement entre budgets.

  **Nouvelle table de traçabilité** [supabase/migrations/20260531000000_create_expense_savings_sources.sql](../../supabase/migrations/20260531000000_create_expense_savings_sources.sql) : `expense_savings_sources` avec 1 row par source débitée (FK CASCADE sur `real_expenses`, FK SET NULL sur `estimated_budgets`, CHECK source_type cohérence `'piggy' | 'budget_savings'`, index sur `real_expense_id`). RLS ENABLED sans policies = accès service_role uniquement.

  **RPCs ADD étendues** ([20260531010000_update_add_expense_rpcs_with_sources.sql](../../supabase/migrations/20260531010000_update_add_expense_rpcs_with_sources.sql)) : `add_expense_with_breakdown` + `add_expense_with_cross_budget_cascade` INSERT désormais les rows trace post-INSERT real_expenses dans la même tx (1 row piggy si > 0, 1 row destination savings si > 0, 1 row par cross-budget). Signatures inchangées → CREATE OR REPLACE.

  **Nouvelle RPC DELETE atomique** ([20260531020000_create_delete_expense_with_sources_refund_rpc.sql](../../supabase/migrations/20260531020000_create_delete_expense_with_sources_refund_rpc.sql)) : `delete_expense_with_sources_refund(p_expense_id)` lit les sources, crédite chacune (piggy via `update_piggy_bank_amount`, budget via `update_budget_cumulated_savings`), puis DELETE la real_expense (FK CASCADE supprime les rows trace). Legacy fallback : si aucune trace (dépense pré-sprint), refund via colonnes consolidées comme avant.

  **Nouvelle RPC UPDATE atomique** ([20260531030000_create_update_expense_with_sources_reapply_rpc.sql](../../supabase/migrations/20260531030000_create_update_expense_with_sources_reapply_rpc.sql)) : `update_expense_with_sources_reapply(...)` applique le pattern reverse-then-reapply complet (crédite anciennes sources, débite nouvelles passées en jsonb, UPDATE colonnes consolidées, DELETE/INSERT rows trace). Destination budget immutable via cette RPC (pour changer de budget, le call site doit faire delete + add fresh — cas rare, EditTransactionModal disable le dropdown).

  **Route DELETE** [expenses-real.ts:484](../../lib/api/finance/expenses-real.ts) : bascule sur `deleteExpenseWithSourcesRefund` pour les dépenses budgetées non-exceptionnelles non-carry-over non-contribution. Sequence pré-sprint (`supabase.from().delete()` + `reverseAllocation` hors-tx) supprimée — risque de leak fermé.

  **Route PUT** [expenses-real.ts:329](../../lib/api/finance/expenses-real.ts) : nouveau path "cascade-aware" quand `amount` change ET `estimated_budget_id` ne change pas → calcule `calculateBreakdownWithAutoCascade` sur l'état post-reverse virtuel (sources d'origine restituées dans pools courants) + call `updateExpenseWithSourcesReapply`. Legacy path (`reverseAllocation` + `applyAllocation`) conservé pour le cas budget destination change (perte de trace acceptée — EditTransactionModal verrouille le dropdown). Skip de l'UPDATE final via sentinel `skipFinalUpdate` (RPC fait déjà UPDATE complet).

  **Route preview-breakdown** [expenses-preview-breakdown.ts](../../lib/api/finance/expenses-preview-breakdown.ts) refactorée : les 2 modes ADD/EDIT utilisent désormais `calculateBreakdownWithAutoCascade`. En EDIT, lecture des sources via `expense_savings_sources` puis calcul post-reverse virtuel (`piggyPostReverse`, `savingsPostReverse[destBudget]`, `otherBudgetsPostReverse[]`). Drop du delta-based legacy de Sprint 2026-05-21 (la cascade auto le remplace entièrement). Retour étendu : `cross_budget_debits: Array<{ budget_id, budget_name, amount, available_before, available_after }>`.

  ### UI

  **AddTransactionModal** ([components/dashboard/AddTransactionModal.tsx](../../components/dashboard/AddTransactionModal.tsx)) : suppression de tout le state `crossBudgetSelected` + helpers (`toggleCrossBudget`, `resetCrossBudget`, `availableCrossBudgets`, `crossBudgetAllocations`, etc., -144 LOC). Remplacement par un encart violet informatif quand `overflow > 0` : `border-violet-200 bg-violet-50 p-3`, titre `text-violet-900 font-medium` "Dépassement de X €", sous-texte `text-violet-800 text-xs` "La tirelire sera utilisée en priorité, puis les économies des autres budgets proportionnellement. Le détail apparaît ci-dessous." Payload `cross_budget_cascade` retiré du `addExpense({ ... })` — le serveur recalcule.

  **EditTransactionModal** ([components/dashboard/EditTransactionModal.tsx](../../components/dashboard/EditTransactionModal.tsx)) : encart violet symétrique avec ADD, affiché quand `editAmountChanged && editOverflow > 0`. Calcul overflow côté client via `calculateBreakdown(previewSafe, budgetRemainingPostReverse, savingsPostReverse, { useSavingsToggle: true })` avec post-reverse calculé depuis les colonnes consolidées de `existingExpense` (imprécis pour cascade pré-sprint, OK comme indicateur — le détail exact vient de la route preview-breakdown).

  **ExpenseBreakdownPreview** ([components/dashboard/ExpenseBreakdownPreview.tsx](../../components/dashboard/ExpenseBreakdownPreview.tsx)) étendu : section « Impact » itère sur `cross_budget_debits` pour 1 `ImpactRow` par budget cross (label violet "Économies « Nom »", amount `-d.amount`). Section « Après opération » itère pour 1 `BalanceRow` par budget cross (label violet, amount `d.available_after`). Ordre des lignes : Tirelire (si > 0) → Économies destination (si > 0) → Économies cross (1 ligne par budget) → Budget destination (si delta) → RAV (si delta).

  ### Tests
  - **Nouveau** [lib/**tests**/expense-breakdown.test.ts](../../lib/__tests__/expense-breakdown.test.ts) : 9 cas pure-sync pour `calculateBreakdownWithAutoCascade` (pas overflow, piggy intégral, piggy partiel + 1 cross, proportionnel 2 budgets ratio 2:1, drift arrondi cents 3 budgets égaux, total < overflow déficit résiduel, piggy=0 et autres=0, filtre savings=0, invariant somme sur 5 scénarios).
  - **Réécriture** [lib/api/finance/**tests**/expenses-add-with-logic.test.ts](../../lib/api/finance/__tests__/expenses-add-with-logic.test.ts) : 7 tests adaptés au dispatch auto-cascade (no overflow → `addExpenseWithBreakdown` ; piggy>0 ou cross>0 → `addExpenseWithCrossBudgetCascade`). PIN ATOMIC CONTRACT préservé. Mock chain étendu avec `.neq()` + `.gt()` et 2nd `matchAwait` pour la lecture des autres budgets.
  - **Tests gated DB** des 2 nouvelles RPCs (delete_expense_with_sources_refund + update_expense_with_sources_reapply) NON ajoutés cette itération (setup gated complexe, à traiter dans un sprint follow-up). Couverture algo via tests pure-sync.

  ### Documentation
  - [CLAUDE.md §5](../../CLAUDE.md) : règle d'allocation amendée (cascade auto tirelire + cross-budget proportionnel sur overflow ; piggy auto-débit scoped overflow uniquement).
  - [CLAUDE.md §5.5](../../CLAUDE.md) invariants : EXPECTED_RPCS 19 → 21 (+`delete_expense_with_sources_refund`, +`update_expense_with_sources_reapply`), Functions versionnées 28 → 30, Tests non-gated 661 → 672.
  - [scripts/check-rpcs.mjs](../../scripts/check-rpcs.mjs) : EXPECTED_RPCS étendu avec les 2 nouvelles RPCs.
  - Pas d'ajout à `operational-rules.md` (fichier à la limite 39.5k, règle suffisamment capturée en CLAUDE.md §5).

  ### Pattern installé

  **Traçabilité par row pour mutations multi-sources** : quand une opération atomique débite N sources, stocker 1 row par source dans une table dédiée avec FK CASCADE → permet refund précis lors du reverse (delete/edit). Pattern réutilisable pour toute mutation similaire (ex: futures cascades cross-budget pour les transferts).

  **Server autoritatif pour cascade auto** : le client envoie le payload minimal `{amount, ...}`, le serveur recalcule la cascade depuis l'état DB courant. Évite les drifts client/serveur (cache stale, état désynchronisé) et simplifie l'UI (plus de calcul + state à maintenir côté client). Le `cross_budget_cascade` du body reste accepté par le schéma (rétrocompat) mais est ignoré.

  ### Trade-offs documentés
  - **Dépenses pré-sprint (sans trace)** : refund/update via colonnes consolidées comme avant. `amount_from_budget_savings` consolidé revient entièrement au destination budget (peut différer de la provenance d'origine si cross-budget). Décision user "Comme aujourd'hui" — pragmatique.
  - **Changement de `estimated_budget_id`** en EDIT : retombe sur l'ancien flow `reverseAllocation` + `applyAllocation` (perd la trace cross-budget). Cas rare en UX (EditTransactionModal verrouille le dropdown destination).
  - **Mode EDIT préview encart violet** : calcul overflow côté client utilise les colonnes consolidées de l'existing expense (pas la trace) → imprécis pour cascade pré-sprint, OK comme indicateur. Le détail exact vient de la route preview-breakdown.

  ### Migrations DB appliquées

  4 migrations sur le projet dev (`ddehmjucyfgyppfkbddr`) :
  - `20260531000000_create_expense_savings_sources.sql`
  - `20260531010000_update_add_expense_rpcs_with_sources.sql`
  - `20260531020000_create_delete_expense_with_sources_refund_rpc.sql`
  - `20260531030000_create_update_expense_with_sources_reapply_rpc.sql`

  Application prod via `node scripts/apply-sql.mjs ...` (default = prod) pour le déploiement final.

  ### Stats

  EXPECTED_RPCS 19 → 21. Functions versionnées 28 → 30. Routes API 41 (inchangé, 3 routes existantes modifiées). Tests 661 → 672 non-gated + 203 gated stables. 19 fichiers modifiés + 1 créé (tests + 4 migrations). Pas de nouveau composant React.
