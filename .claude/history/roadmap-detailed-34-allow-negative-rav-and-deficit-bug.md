# Part 34 — Allow-Negative-RAV + Bug Déficit Carryover (2026-05-27)

> Session "supprimer garde-fous RAV négatif" qui a dérivé sur une investigation déficit budget. 2 sprints + 1 état non-clos qui nécessitera une re-passe future.

## Sprint Allow-Negative-RAV (commit `69c951b`, 2026-05-27)

**Contexte** — Le user demande de retirer tous les verrous qui empêchaient d'ajouter un budget, projet d'épargne ou dépense quand le reste-à-vivre (RAV) deviendrait négatif. Désormais, être dans le négatif est autorisé sur toutes les surfaces.

**Surfaces touchées** :

- **Hook supprimé** : `hooks/useRavValidation.ts` (115 LOC, seul consumer `AddTransactionModal.tsx`).
- **Schémas Zod** :
  - `makeBudgetClientSchema` : retrait flag `strictRav` + refine RAV. Plus que `z.object({ name, estimatedAmount })`.
  - `makeProjectClientSchema` : retrait refine 1 RAV + flag `strictRav`. Refine 2 cohérence durée/cible **conservé** (math non-RAV).
- **AddTransactionModal** : retrait import hook, bloc `useRavValidation({...})`, check `if (ravValidation.blocked)` au submit, `|| ravValidation.blocked` du `disabled`, et bandeau rouge "Impossible…".
- **Dialogs** : `AddBudgetDialog`, `EditBudgetDialog`, `AddProjectDialog`, `EditProjectDialog` : retrait prop `strictRav` (type + default + arg `makeXxxClientSchema`).
- **PlanningDrawer** : retrait des 4 call sites `strictRav={!isGroupContext}`.

**Composants conservés (warnings visuels non-bloquants)** :

- `RemainingToLivePreview`, `ExpenseBreakdownPreview` : auto-calculent leur newRav. Inchangés.
- `GroupMembersRavRecap` : conserve son texte `<p role="alert">…deviendrait négatif</p>`. Docstring mis à jour : "RAV négatif autorisé depuis 2026-05-27".

**Tests** — 5 cas blocking → assertions submission OK (`AddBudgetDialog`, `EditBudgetDialog`, `AddProjectDialog`, `EditProjectDialog`, `AddTransactionModal`). Mocks `vi.mock('@/hooks/useRavValidation', …)` retirés de 2 fichiers (`AddTransactionModal.test.tsx`, `a11y-audit.test.tsx`). Tests 783 → 784 ; lint 0/0 ; typecheck OK.

**Vérification DB** — `bank_balances.current_remaining_to_live` est `numeric DEFAULT 0` sans CHECK (≥ 0) → accepte les valeurs négatives, pas de migration nécessaire.

**Docs** — `.claude/conventions/zod-patterns.md` Pattern E marqué RETIRÉ ; `.claude/conventions/operational-rules.md` synthèse Group-RAV-Recap §188 mise à jour ; `.claude/reference/structure-repo.md` entrée hook retirée.

---

## Bug Déficit Budget Compounding (investigation 2026-05-27, **non-clos**)

### Constat user

Reste-à-vivre = -8550€. Ajoute une dépense budgétée 100€ sur "Courses" (cap 400€), display "100/400" (sous le cap). RAV chute à -8650€. **L'utilisateur attend RAV inchangé** car la dépense rentre dans un budget déjà déduit du RAV.

### Investigation itérative

**Hypothèse 1 — Prior-month leftover** : `_loadFinancialData` deficit loop sommait `real_expenses` filtrées uniquement par `is_carried_over=false` (sans filtre date). Des dépenses des mois passés (recap M-1 non finalisé) restaient `is_carried_over=false` et gonflaient `spentOnBudget`. Fix : ajout filtre `expense_date` borné au mois calendaire courant sur 5 sites (`financial-data.ts` deficit loop + `expenses-add-with-logic.ts` budgetSpentBefore + `expenses-preview-breakdown.ts` + `expenses-real.ts` PUT + `budget-savings-detail.ts`). **Test :** repro avec dépense Avril 400€ + Mai 100€ → bug confirmé sans filtre, RAV inchangé avec filtre.

→ User retest après restart `pnpm dev` : **bug persiste**. Hypothèse 1 insuffisante.

**Diagnostic SQL** (via `node scripts/apply-sql.mjs`) : 2 budgets groupe avec `carryover_spent_amount` massif :

| Budget          | estimé | carryover | déficit pré-ajout |
| --------------- | ------ | --------- | ----------------- |
| Courses commune | 400    | 6100      | 5700              |
| Voiture         | 200    | 3050      | 2850              |
| **total**       |        |           | **8550** ✓        |

`carryover_applied_date = 2026-05-27` (aujourd'hui). Origine confirmée par user : "Oui, gros déficit" historique → recap finalisé avec déficit non refloutait (piggy/savings = 0).

**Hypothèse 2 — Carryover sature le plafond** : avec carryover ≥ estimated, la formule `MAX(0, spent + carryover - estimated)` est mécaniquement croissante en `spent`. Toute nouvelle dépense même sous le cap visuel compound directement le déficit. Fix proposé : **decouple** — `deficit = MAX(0, spent_current_month - estimated) + carryover` (2 termes indépendants). **Effet bordeline** : baseline RAV shift de -600€ (de -8550 à -9150) car les ~600€ que la formule absorbait dans le plafond deviennent visibles.

→ User retest : noticed inconsistance entre dashboard (qui affichait 6000/200 avec carryover) et le dropdown du modal d'ajout au wizard (qui affichait 100/200 sans carryover). Demande "wizard suit dashboard".

**Hypothèse 3 — Alignement dropdown modal sur dashboard** : `AddTransactionModal.tsx` + `EditTransactionModal.tsx` `budgetOptions` utilisaient `calculateRealSpentAmount` (sum local de `amount_from_budget` sans carryover) au lieu de `budget.spent_this_month` (API qui calcule `carryover + actualSpent_currentMonth`). Fix : `spentAmount: budget.spent_this_month ?? calculateRealSpentAmount(budget.id)` (fallback safe). Le helper `calculateRealSpentAmount` reste utilisé plus bas pour `editBudgetSpentPostReverse` (sémantique "spent without carryover" requise pour le breakdown P5).

→ User reconsidère : "si le budget est saturé (6100/200) et que j'ajoute 100€, il devient 6200/200 — RAV devrait baisser de 100€". L'ancienne formule était **sémantiquement correcte** ; la confusion initiale venait du dropdown qui cachait le carryover. Demande **revert du decouple**.

**Action finale (Hypothèse 4 — revert decouple)** : `_loadFinancialData` deficit loop reverted à `deficit = MAX(0, spent_current_month + carryover - estimated)` (formule canonique). KEPT : filtre date sur `spentOnBudget` (Hypothèse 1, valide indépendamment) + alignement dropdown (Hypothèse 3, valide indépendamment). Comment doc `useBudgetProgress.ts` reverted à la formule old.

### État final code (4 commits-équivalents bundled, non-shippés)

| Fichier                                            | Changement                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| `lib/finance/financial-data.ts`                    | Filtre date sur `spentOnBudget`, formule canonique conservée        |
| `lib/api/finance/expenses-add-with-logic.ts`       | Filtre date sur `budgetSpentBefore`                                 |
| `lib/api/finance/expenses-preview-breakdown.ts`    | Idem                                                                |
| `lib/api/finance/expenses-real.ts` (PUT)           | Idem                                                                |
| `lib/finance/budget-savings-detail.ts`             | Filtre date (dead code mais cohérent)                               |
| `lib/api/finance/__tests__/expenses-add-with-logic.test.ts` | Ajout `.gte/.lte` au mock chain                            |
| `components/dashboard/AddTransactionModal.tsx`     | Dropdown utilise `budget.spent_this_month` (matches dashboard)      |
| `components/dashboard/EditTransactionModal.tsx`    | Idem                                                                |
| `lib/finance/__tests__/financial-data-bug-repro.test.ts` | **NEW** 4 régression tests (fresh / saturated / small-carryover / prior-month) |

Tests 786 → 788 non-gated. Lint 0/0, typecheck OK.

### Sémantique métier confirmée

- Budget visiblement **sous le cap** (somme spent + carryover ≤ estimated) → ajout sous la marge ne change pas RAV (la marge libre absorbe).
- Budget visiblement **saturé** (somme ≥ estimated) → tout nouveau spending baisse RAV du plein montant.
- Affichage dashboard et wizard cohérents (carryover-included partout dans le `spent_this_month`).
- Past-month leftover (is_carried_over=false avec date hors mois calendaire courant) ignoré — sera capté via `carryover_spent_amount` au finalize du recap correspondant.

### ⚠️ Finalité non atteinte — à retravailler

**Le scénario user reste piégé** :

- Carryover total **9150€** sur 2 budgets totalisant 600€/mois de capacité → un budget visuellement saturé pour les ~15 mois à venir si aucune action (auto-healing avec sous-consommation max 600€/mois théorique).
- **Pas d'échappatoire facile** via le wizard `manage_bilan` : piggy = 0, savings = 0 → refloat ne peut pas dégager le carryover.
- Toute dépense réelle ce mois-ci (et les suivants) sur ces 2 budgets continuera à faire baisser le RAV du plein montant, ce qui rend le RAV difficilement actionable pour l'utilisateur.

**Pistes à explorer en future session** :

1. **Cap automatique** `carryover_spent_amount ≤ estimated_amount` au finalize (le surplus deviendrait une dette "long-terme" séparée, non-compoundée par le budget).
2. **Refloat depuis bank_balance** : option wizard `manage_bilan` qui débite directement le solde bancaire (vs piggy/savings) pour amortir le carryover. Risque overdraft accepté (le solde négatif est déjà autorisé sur Popoth depuis Sprint allow-bank-balance-negative).
3. **Repartir à zéro** : action UI "remettre la dette à zéro" (admin/dev only ou explicite user warning) qui zéroise `carryover_spent_amount` sur tous les budgets owner-scoped.
4. **Décompose visuel** : afficher le `spent_this_month` dashboard en deux parties séparées (e.g. "100€ ce mois + ↩ 6100€ dette passée / 400€ cap") au lieu de la compounder en un seul ratio "6200/200" qui suggère un over-cap actuel alors que la majeure partie est de la dette ancienne. Cela aiderait l'UX sans changer la formule.
5. **Re-évaluation du decouple** : la formule decouple (rejetée cette session) reste défendable conceptuellement. La rouvrir si l'option 4 conclut que la dette doit être "fixe" plutôt que "absorbable".

**Décision attendue user** avant prochaine implémentation : choisir entre amortissement DB-level (1/2/3) ou présentation UX (4) ou refonte formule (5). Le bug est patché pour le cas immédiat (filtre date + alignement display) mais la dette accumulée reste un état piège qui se reproduira pour tout utilisateur ayant un gros recap déficitaire sans tampon.

### Tests régression installés

[lib/finance/\_\_tests\_\_/financial-data-bug-repro.test.ts](../../lib/finance/__tests__/financial-data-bug-repro.test.ts) :

1. **Fresh setup** : RAV stable quand ajout sous le cap, pas de carryover (formule de référence).
2. **Saturated budget** (carryover ≥ estimated) : ajout 100€ baisse RAV de 100€ (comportement attendu après revert decouple).
3. **Small carryover absorbed** (spent + carryover < estimated) : ajout sous la marge libre ne change pas RAV (pin l'absorption).
4. **Prior-month leftover** (is_carried_over=false avec date avril alors qu'on est en mai+) : pas inclus dans `spentOnBudget` du mois courant (pin le filtre date).

### Patterns installés (sécurité future)

- **Filtre date sur tous les sites qui calculent un agrégat "spent this month"** — sans ce filtre, des dépenses des mois passés non recapés polluent le calcul mensuel. Pattern à généraliser pour tout nouveau site qui sum/reduce des `real_expenses`.
- **Dropdown du modal d'ajout DOIT matcher l'affichage dashboard** : `budget.spent_this_month` (API) est la source canonique. Si on diverge, l'utilisateur voit 2 chiffres incohérents pour le même budget et perd confiance dans le calcul.
- **Pour un changement de formule métier critique** : faire un test qui mock TOUTES les conditions (carryover faible/élevé, dépenses présentes/absentes, etc.) AVANT de toucher la formule. Le mock builder `makeBuilder(table)` dans le repro test est réutilisable pour tout test isolé de `_loadFinancialData`.
