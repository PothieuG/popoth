# Part 34 — Allow-Negative-RAV + Bug Déficit Carryover (2026-05-27)

> Session "supprimer garde-fous RAV négatif" qui a dérivé sur une investigation déficit budget, puis un fix preview du wizard récap, puis fermeture du deadlock wizard manage_bilan sans ressources. 8 sprints livrés.

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

| Fichier                                                     | Changement                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `lib/finance/financial-data.ts`                             | Filtre date sur `spentOnBudget`, formule canonique conservée                   |
| `lib/api/finance/expenses-add-with-logic.ts`                | Filtre date sur `budgetSpentBefore`                                            |
| `lib/api/finance/expenses-preview-breakdown.ts`             | Idem                                                                           |
| `lib/api/finance/expenses-real.ts` (PUT)                    | Idem                                                                           |
| `lib/finance/budget-savings-detail.ts`                      | Filtre date (dead code mais cohérent)                                          |
| `lib/api/finance/__tests__/expenses-add-with-logic.test.ts` | Ajout `.gte/.lte` au mock chain                                                |
| `components/dashboard/AddTransactionModal.tsx`              | Dropdown utilise `budget.spent_this_month` (matches dashboard)                 |
| `components/dashboard/EditTransactionModal.tsx`             | Idem                                                                           |
| `lib/finance/__tests__/financial-data-bug-repro.test.ts`    | **NEW** 4 régression tests (fresh / saturated / small-carryover / prior-month) |

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

---

## Sprint Fix-Recap-Preview-Month (2026-05-27)

**Contexte** — Suite à l'investigation du bug carryover (section précédente) qui a aligné le dropdown wizard sur le dashboard, l'utilisateur a constaté que l'encart "Après opération" de l'`AddTransactionModal` à l'étape 2/6 "Compléter le mois" affichait encore un budget faussement remis à zéro (e.g. `100/400` au lieu de `6200/400` quand le carryover était à 6100). La ligne d'impact RAV `-100€` était également absente de la section "Impact de la dépense", alors que la mutation finale ampute bien le RAV à la validation.

**Cause racine** — La route `GET /api/finance/expenses/preview-breakdown` ([lib/api/finance/expenses-preview-breakdown.ts](../../lib/api/finance/expenses-preview-breakdown.ts)) filtre les `real_expenses` par `today.month` (filtre ajouté par le sprint précédent pour la régression prior-month). Mais le wizard récap peut clore un mois passé (ou un mois seedé via `scripts/seed-recap/*.mjs` dont les dates sont calées avant `today`), auquel cas `today.month ≠ recap.month` et la requête retourne 0 dépense → `budgetSpentBefore = 0` → la preview retombe à `0 + fromBudget`. Le client `ExpenseBreakdownPreview` calcule alors `currentOverflow = max(0, 0-cap) = 0` et `newOverflow = max(0, fromBudget-cap) = 0` (si l'ajout reste sous le cap fantôme), masquant la ligne RAV. Le dashboard ne souffre pas du bug car il n'affiche que le mois courant par construction.

**Fix appliqué** — Pattern "optional explicit month override avec fallback today" sur la chaîne `CompleteMonthStep` → `AddTransactionModal` → `ExpenseBreakdownPreview` → route API :

- `previewBreakdownQuerySchema` ([lib/schemas/expense.ts](../../lib/schemas/expense.ts)) accepte 2 nouveaux champs optionnels `month` (1-12) + `year` (2000-3000) via `z.coerce.number().int().min/max`. Pas de `.refine` croisé — un seul des deux est traité comme "absent" côté route.
- La route ([expenses-preview-breakdown.ts](../../lib/api/finance/expenses-preview-breakdown.ts) lignes 149-160) utilise `month`/`year` quand les deux sont fournis, sinon retombe sur `new Date()` (Dashboard inchangé).
- `ExpenseBreakdownPreview` ([components/dashboard/ExpenseBreakdownPreview.tsx](../../components/dashboard/ExpenseBreakdownPreview.tsx)) ajoute des props `month`/`year` qu'il forward dans queryKey (sinon cache du mois courant ré-utilisé) + URL params.
- `AddTransactionModalProps` ajoute `recapMonth`/`recapYear` (symétriques à `dateMin`/`dateMax` Sprint Complete-Month-Step), transmis à la preview budgétée uniquement (la branche income/exceptionnelle utilise `RemainingToLivePreview` qui n'a pas le bug).
- `CompleteMonthStep.tsx` ([components/monthly-recap/steps/CompleteMonthStep.tsx](../../components/monthly-recap/steps/CompleteMonthStep.tsx)) passe `recapMonth={recapMonth}` + `recapYear={recapYear}` au mount du modal (les valeurs existent déjà dans le scope pour calculer `dateMin`/`dateMax`).

**Tests** — 3 cas ajoutés à `previewBreakdownQuerySchema` ([lib/schemas/**tests**/expense-real.test.ts](../../lib/schemas/__tests__/expense-real.test.ts)) : coerce strings, reject `month=0`/`month=13`, accept `month` seul sans `year` (fallback today côté route). Tests existants `AddTransactionModal.test.tsx` + `CompleteMonthStep.test.tsx` passent inchangés. Total non-gated 788 → 791.

**Vérification manuelle** — Avec `node scripts/seed-recap/deficit-cascade-extreme.mjs` (mai 2026) puis ouverture du wizard étape 2 :

- Budget 6100/400 + ajout 100€ : preview affiche `6200/400` + ligne RAV `-100€` dans la section "Impact de la dépense".
- Budget 100/400 + ajout 50€ : preview affiche `150/400` sans ligne RAV (overflow=0, confirmant la cohérence avec l'algorithme P4-strict `calculateBreakdownWithAutoCascade` — `budgetRemaining=300`, `amount=50` → `fromBudget=50`, `overflow=0`, savings/piggy intouchés).

**Pattern installé (sécurité future)** — Pour toute route preview filtrant un agrégat "spent this month", prévoir un override `month`/`year` optionnel dès que la route peut être invoquée depuis un contexte non-today (wizard récap, modal d'édition cross-period, futur navigateur historique). La queryKey TanStack côté client DOIT inclure ces params, sinon le cache du mois courant est ré-utilisé à tort. Le fallback `new Date()` reste le comportement "Dashboard" par défaut.

**Hors scope** — `EditTransactionModal` utilise aussi `ExpenseBreakdownPreview` et aurait le même bug en mode wizard. Vérifié : `TransactionTabsComponent` à l'intérieur de `CompleteMonthStep` n'a pas de `onEditTransaction` câblé (seul `/dashboard` et `/group-dashboard` le wirent — cf. `app/(dashboards)/{dashboard,group-dashboard}/page.tsx` qui montent `<EditTransactionModal>` page-scoped). L'édition est donc inaccessible depuis le wizard et le bug n'est pas atteignable. À étendre si l'édition est réactivée dans le wizard plus tard (ajouter `recapMonth`/`recapYear` à `EditTransactionModalProps` + forward à `ExpenseBreakdownPreview` ligne 495).

---

## Sprint Fix-Preview-Allocation-Carryover (2026-05-27)

**Contexte** — Bug détecté après les 3 sprints précédents. Scénario user : budget cap=1000 avec `carryover_spent_amount=500` (renflouage post-recap) → dashboard affiche correctement `500/1000`. User ajoute 800€ via `AddTransactionModal` sur le dashboard :

- **Attendu** : preview `1300/1000` + ligne Impact RAV `−300€` (overflow 800 − marge libre 500 = 300, absorbé en déficit destination si pas de piggy/savings dispo).
- **Observé (bug)** : preview `800/1000` + ligne Impact "Budget Courses `−800€`" + pas de ligne RAV. Le carryover était totalement ignoré par la route preview et la route POST add.

**Cause racine** — 3 routes API qui calculent `budgetRemaining = estimated_amount − sum(real_expenses du mois)` oubliaient `carryover_spent_amount` (alors que `lib/finance/financial-data.ts:206-216` deficit loop et `lib/finance/budget-savings-detail.ts:66-76` l'incluent correctement) :

1. [lib/api/finance/expenses-preview-breakdown.ts](../../lib/api/finance/expenses-preview-breakdown.ts) ligne 188 — `budgetSpentBefore` recalculé sans carryover → UI faussement remise à zéro (encart `ExpenseBreakdownPreview`).
2. [lib/api/finance/expenses-add-with-logic.ts](../../lib/api/finance/expenses-add-with-logic.ts) ligne 193 — impact silencieux mais réel : `budgetRemaining` surestimé, donc la cascade auto-piggy/savings/cross-budget n'était PAS déclenchée alors qu'elle devrait l'être quand l'overflow réel l'exigeait. Le RAV final restait correct (deficit loop inclut déjà le carryover), MAIS la trace `expense_savings_sources` divergeait de l'état métier attendu — la piggy/savings n'étaient pas débitées alors qu'elles auraient dû l'être.
3. [lib/api/finance/expenses-real.ts](../../lib/api/finance/expenses-real.ts) ligne 422 — même bug latent sur la branche PUT edit `reverse-then-reapply`.

**Fix** — Pattern canonique reproduit. Sur chacune des 3 routes : étendre `.select(...)` avec `carryover_spent_amount`, ajouter `const carryoverSpent = budgetData.carryover_spent_amount ?? 0`, inclure dans `budgetSpentBefore` (mode ADD comme EDIT — le carryover est constant sur le mois courant, indépendant du reverse virtuel d'une dépense existante).

**Tests régression** — 2 nouveaux cas dans [expenses-add-with-logic.test.ts](../../lib/api/finance/__tests__/expenses-add-with-logic.test.ts) :

1. `carryover saturates budget` : cap=1000, carryover=500, piggy=0, savings=0, no cross → overflow=300 absorbé en `fromBudget=800` (déficit destination). `addExpenseWithBreakdown` choisi. Pin l'invariant `budget_spent_before=500`, `budget_spent_after=1300`.
2. `carryover saturates budget with piggy` : même setup + piggy=200 → cascade auto débite piggy 200€ + budget 600€ (les 100€ restants = déficit destination). `addExpenseWithCrossBudgetCascade` choisi. Pin l'invariant `amountFromPiggyBank=200, amountFromBudget=600`.

**Tests 791 → 793 non-gated**. Lint 0/0, typecheck OK, Prettier OK.

**Comportement post-fix** (scénario user, sans piggy ni savings) :

- Preview affiche `Courses 1300€ / 1000€` au lieu de `800€ / 1000€`.
- Ligne Impact « Budget Courses **−500€** » (delta de pool usage = `min(1300, 1000) − min(500, 1000) = 500`) + ligne Impact « RAV **−300€** » (overflow réel, ce qui ampute le reste-à-vivre).
- Validation → cascade auto-débitée si piggy/savings/cross dispos, sinon déficit destination. RAV effectivement baissé de 300€ post-mutation.

**Pattern installé** — Tout nouveau site qui calcule un agrégat "dépensé sur ce budget ce mois" et l'utilise pour dériver `budgetRemaining` (notamment pour piloter une cascade d'allocation) DOIT inclure `carryover_spent_amount`. Documenté dans [.claude/conventions/operational-rules.md](../conventions/operational-rules.md) §5 "RAV formula" sous forme de règle ❌ explicite.

**Hors scope (à signaler si user le demande plus tard)** :

- [lib/expense-allocation.ts::applyAllocation](../../lib/expense-allocation.ts) (branche legacy du PUT edit ligne 472 d'expenses-real.ts) — même bug latent, déclenché uniquement sur changement de budget destination (path rarement utilisé en pratique).
- **État ouvert (carry-over) dette `carryover_spent_amount ≥ estimated`** : ce fix résout le bug "preview oublie carryover", PAS le bug "carryover compound indéfiniment" du sprint précédent. Les 5 pistes ouvertes (cap auto / refloat bank-balance / repartir à zéro / décompose visuel / re-évaluation decouple) restent à arbitrer.

### Follow-up — Sprint Fix-Progress-Route-Carryover (2026-05-27)

**Bug user remonté immédiatement après le sprint** : (1) l'encart violet "dépassement" dans `AddTransactionModal` ne s'affiche pas en mode ADD malgré une preview budget correcte (1300/1000) ; (2) la modal de confirmation de suppression d'une dépense affiche un preview faux ("Budget 0/1000 et RAV −500" au lieu de "Budget 500/1000 et RAV 0").

**Cause** — La route `/api/finance/expenses/progress` ([lib/api/finance/expenses-progress.ts](../../lib/api/finance/expenses-progress.ts)) — initialement classée "hors scope" car catégorisée affichage UI — était en réalité la **source de données partagée** entre :

1. `AddTransactionModal.tsx` lignes 167-182 qui calcule l'overflow local via `budgetRemainingLocal = budgetProgress.estimatedAmount − budgetProgress.spentAmount`. Sans le carryover dans `spentAmount`, `budgetRemainingLocal` est surestimé, `calculateBreakdown(...)` renvoie `overflow = 0`, et l'encart violet (condition `overflow > 0`) ne s'affiche pas.
2. `TransactionListItem.buildExpenseDeleteDetails()` lignes 414-421 qui calcule le post-delete via `newSpent = spentAmount − fromBudgetTotal` puis `deficitBefore = max(0, spentAmount − estimated)` puis `ravRecovered = deficitBefore − deficitAfter`. Sans le carryover, tous ces termes divergent du réel.

**Fix** — Même pattern canonique : étendre `.select(...)` avec `carryover_spent_amount` sur les 2 sites de la route (branches profile + group), introduire `carryoverSpent = Number(budget.carryover_spent_amount ?? 0)` et `spentAmount = actualSpent + carryoverSpent`. Le type interne `BudgetForProgress` étendu avec `carryover_spent_amount: number | null`.

**Leçon** — Tout site dérivant `remainingAmount` ou `spentAmount` est consommé en cascade par des composants UI qui peuvent baser des conditions d'affichage (encart, badge, lien) ou des previews delta. Categoriser "display only" pour un agrégat budget est risqué : même un nombre faux d'affichage devient une logique métier fausse dès qu'un autre composant s'en sert. La règle ❌ "ne pas calculer `budgetRemaining` sans `carryover_spent_amount`" couvre désormais 4 routes (preview + add + edit + progress), pas 3.

Tests 793 inchangés (le fix ne modifie pas le comportement quand `carryover_spent_amount = 0`, valeur par défaut DB pour tous les budgets fresh).

### Follow-up — Sprint Fix-Edit-Encart-Carryover (2026-05-27)

**Bug user remonté** : en mode EDIT, l'encart violet "Dépassement" peut s'afficher à tort quand l'utilisateur baisse le montant d'une dépense sous le cap effectif. Repro : budget cap=1000 + carryover=500 + dépense=600 → budget displayed 1100/1000. User édite la dépense à 400€ → preview attendue 900/1000 (sous cap, pas de dépassement) MAIS l'encart violet affichait "Dépassement de 400€".

**Cause** — [components/dashboard/EditTransactionModal.tsx](../../components/dashboard/EditTransactionModal.tsx) ligne 179-184 calculait `editBudgetSpentPostReverse = calculateRealSpentAmount(budgetId) − editExpense.amount_from_budget` côté client, sans inclure `carryover_spent_amount`. Le `editBudgetRemainingPostReverse` était surestimé (1000 au lieu de 500) côté formule, MAIS selon le contexte (carry-over rows présentes dans `realExpenses`, multiples dépenses sur le budget, etc.), le `calculateRealSpentAmount` pouvait gonfler artificiellement le spent post-reverse jusqu'à dépasser le cap, déclenchant un overflow faux.

**Fix** — Aligner sur la source canonique `editSelectedBudget.spent_this_month` (déjà calculé par la route `/api/finance/budgets/estimated` qui inclut `carryover_spent_amount + actualSpent_currentMonth` filtré sur `is_carried_over=false`). Formule miroir du PUT serveur dans `lib/api/finance/expenses-real.ts` :

```ts
const editCurrentSpent =
  editSelectedBudget?.spent_this_month ??
  calculateRealSpentAmount(editBudgetId) + (editSelectedBudget?.carryover_spent_amount ?? 0)
const editBudgetSpentPostReverse = editExpense
  ? editCurrentSpent − (editExpense.amount_from_budget ?? 0)
  : 0
```

Fallback local pour edge case "budget tout neuf sans `spent_this_month`". Pour la repro user : `spent_this_month=1100`, `editExpense.amount_from_budget=600`, `editBudgetSpentPostReverse=500`, `editBudgetRemainingPostReverse=500`, previewSafe=400 → `calculateBreakdown(400, 500, ...) → fromBudget=400, overflow=0` → encart violet NON affiché ✓.

**Bonus** — commentaire trompeur dans [hooks/useBudgets.ts:18](../../hooks/useBudgets.ts) ("Champ legacy, plus utilisé") corrigé : `carryover_spent_amount` EST utilisé partout (financial-data.ts deficit loop, budgets-estimated.ts spent_this_month, et désormais les 4 routes expenses + 1 modal client).

Tests 793 inchangés. Lint 0/0, typecheck OK.

---

## Sprint Fix-Recap-Surplus-Inconsistency (2026-05-27)

**Contexte** — Bug critique remonté par l'user : récap mensuel d'un groupe, étape "Compléter le mois" (step 2 du wizard), user ajoute volontairement une dépense qui explose son unique budget → display dashboard `11000/1000`, RAV `-9700€`. Il avance à l'étape suivante (`SummaryStep`, step 3) et le champ "Surplus total des budgets" affiche `+1000€` au lieu de `0€` — comme si le budget de 1000€ n'avait rien dépensé. Sémantiquement absurde : un budget overspent ne peut pas avoir de surplus à transformer en économie.

**Cause racine** — Inconsistance unique et bien localisée dans [lib/recap/load-summary.ts](../../lib/recap/load-summary.ts) ligne 95 : l'agrégation `spentThisMonth` par budget filtrait `.not('applied_to_balance_at', 'is', null)` — seules les dépenses "validées via appui long" étaient comptées. Or les RPCs `add_expense_with_breakdown` / `add_expense_with_cross_budget_cascade` (migrations `20260517000000`, `20260519000000`, `20260531010000`) n'écrivent JAMAIS la colonne `applied_to_balance_at` → toute nouvelle dépense est créée `applied_to_balance_at = NULL` → ignorée par `loadRecapSummary`. Résultat : pour le budget cap=1000 avec 11000€ ajoutés non-validés, `spentThisMonth = 0`, `surplus = max(0, 1000 - 0) = 1000€`.

Aucun autre site ne filtrait `applied_to_balance_at` : la RAV ([financial-data.ts:137](../../lib/finance/financial-data.ts)), le widget dashboard ([expenses-progress.ts:60](../../lib/api/finance/expenses-progress.ts), source du display `11000/1000`), la cascade preview/add ([expenses-add-with-logic.ts:173](../../lib/api/finance/expenses-add-with-logic.ts), [expenses-preview-breakdown.ts](../../lib/api/finance/expenses-preview-breakdown.ts)) comptaient toutes les dépenses non-carry-over. Seul `lib/recap/load-summary.ts` filtrait → bug isolé.

**Choix design (user 2026-05-27)** — 3 options proposées via `AskUserQuestion` en business language :

- (A) Aligner le calcul récap sur le reste de l'app (1 ligne retirée + bonus carryover inclus). **Choisi.**
- (B) Auto-valider les dépenses ajoutées pendant le wizard `CompleteMonthStep` (plus invasif, RPC + modal).
- (C) Les deux (defense in depth).

L'option A garde la sémantique long-press appui pour le solde bancaire intacte côté flow d'ajout (le wizard ne change pas), mais aligne le calcul interne.

**Fix appliqué (2 changements)** :

1. [lib/recap/load-summary.ts](../../lib/recap/load-summary.ts) ligne 95 — retrait du filtre `.not('applied_to_balance_at', 'is', null)` + maj docstring lignes 9-14 pour documenter le nouveau filtre (seulement `is_carried_over=false` + `expense_date` mois courant). Le filtre `applied_to_balance_at` ne pilote QUE le solde bancaire, pas le RAV ni le surplus — miroir explicite de `_loadFinancialData` ligne 137.
2. [lib/recap/calculations.ts](../../lib/recap/calculations.ts) ligne 73 — inclusion de `carryoverSpentAmount` dans `effectiveSpent` :

   ```ts
   const transferredToPiggy = input.piggyTransfersData?.[b.budgetId] ?? 0
   const carryoverSpent = b.carryoverSpentAmount ?? 0
   const effectiveSpent = b.spentThisMonth + carryoverSpent + transferredToPiggy
   ```

   Le `carryoverSpentAmount` était déjà passé par `loadRecapSummary` (ligne 132 actuelle) mais ignoré par `computeRecapSummary`. Sémantique alignée avec `_loadFinancialData` deficit loop : `deficit = MAX(0, spent_current_month + carryover - estimated)`. Le pattern miroir s'applique au surplus (l'inverse mathématique). Sans cette inclusion, un budget avec dette reportée non-soldée affichait à tort un surplus = `estimated` tant que le mois courant n'a pas re-saturé le cap.

**Tests régression-guards** (2 nouveaux cas dans [lib/recap/\_\_tests\_\_/calculations.test.ts](../../lib/recap/__tests__/calculations.test.ts)) :

1. `'includes carryoverSpentAmount in effectiveSpent for surplus/deficit calc'` : cap=1000, carryover=500, spent=200 → effectiveSpent=700, surplus=300 (et non 800 si carryover oublié).
2. `'overspent budget shows zero surplus + positive deficit (regression: surplus=1000 bug)'` : cap=1000, spent=11000 (le scénario user repro) → surplus=0, deficit=10000, totalSurplus=0.

Tests 793 → 795 non-gated. Tests gated `SUPABASE_RECAP_TESTS=1` non touchés (les seeds existants utilisaient des dépenses applied — devient un no-op après fix). Lint 0/0, typecheck OK.

**Vérification manuelle attendue** (sur dev `ddehmjucyfgyppfkbddr`) :

- `node scripts/seed-recap/_init-recap.mjs --group` → reset row monthly_recaps du mois courant.
- `/group-dashboard` → wizard `Bienvenue` → `Démarrer` → étape `Compléter le mois`.
- Ajouter une dépense 11000€ sur le seul budget (cap 1000€) **sans long-press**.
- `Continuer` → `SummaryStep` doit afficher : RAV effectif ≈ -9700€, **"Surplus total des budgets" = 0€** ✓ (était 1000€ avant fix), bilanSign négatif → étape suivante route vers `BilanNegativeStep`.

**Pattern installé** — Tout calcul d'agrégat "spent this month" dans le récap (`lib/recap/*`) DOIT inclure `carryover_spent_amount` ET ne PAS filtrer `applied_to_balance_at`. Le filtre `applied_to_balance_at` est exclusivement pertinent pour les ops mutant `bank_balances.balance` (toggle apply, finalize delete vs carry). Documenté comme règle ❌ unique dans [.claude/conventions/operational-rules.md](../conventions/operational-rules.md) §5 RAV formula (fusionnée avec la règle carryover existante).

**Hors scope (à signaler si user le demande plus tard)** :

- **Double-comptage potentiel post-finalize** : avec le fix, une dépense non-validée compte dans le bilan-négatif actuel. Si le user passe par la cascade et capture un snapshot déficit, puis valide la dépense le mois suivant (la dépense est carry-over post-finalize via le filet `process_recap_transactions`), elle s'ajoute aux spent du mois suivant — double-impact potentiel sur la budget remaining. Cas pré-existant aujourd'hui (le bilan-négatif déjà couvrait les dépenses applied) mais devient plus accessible. À discuter en sprint suivant si le user en fait l'expérience.
- **État ouvert "carryover_spent_amount ≥ estimated"** : les 5 pistes listées au sprint précédent (cap auto, refloat bank, repartir à zéro, décompose visuel, decouple formula) restent à arbitrer indépendamment.

---

## Sprint Fix-Manage-Bilan-Deadlock (2026-05-27)

**Contexte** — Sprint final de Part 34 qui ferme **l'échappatoire wizard** mentionnée en État ouvert du sprint Bug-Déficit-Compounding (« Pas d'échappatoire facile via le wizard `manage_bilan` : piggy = 0, savings = 0 → refloat ne peut pas dégager le carryover »). Question initiale user : « peux tu me confirmer que lors du monthly recap, si à l'étape 4 sur 6, en négatif, si on n'a pas de tirelire, pas d'économie, pas de projet et pas de budget, on n'a pas de bouton continuer qui s'affiche ? » → confirmé puis fixé.

**Cause** — Dans [components/monthly-recap/steps/BilanNegativeStep.tsx](../../components/monthly-recap/steps/BilanNegativeStep.tsx) ligne 186, `showContinuer = deficitCovered` masque le bouton « Continuer » tant que le déficit reste > 0. Les 4 lignes refloat passent toutes en état `empty` (piggy/savings/projects) ou `active` mais disabled (snapshot avec `budgets.length === 0` désactivait son bouton « Équilibrer » ligne 183 de [RefloatBudgetSnapshotLine.tsx](../../components/monthly-recap/RefloatBudgetSnapshotLine.tsx)). L'utilisateur restait mécaniquement bloqué sur l'étape 4 sans voie de sortie visible.

**Vérification serveur** — Aucun gating côté `app/api/monthly-recap/advance-step/route.ts` ni `complete/route.ts` sur `deficitRemaining > 0`. L'endpoint valide seulement la transition forward-only ([state.ts:38-42](../../lib/recap/state.ts)) + race guard `current_step === fromStep`. `finalize_recap_apply_snapshot` est no-op quand `budget_snapshot_data IS NULL`. → Le déficit non-couvert reste mécaniquement persisté en RAV négatif (cohérent avec la décision 2026-05-27 « RAV négatif autorisé partout », sprint Group-RAV-Recap → [Part 32](roadmap-detailed-32-group-rav-recap.md)). **Changement frontend uniquement**.

**Fix** — 4 fichiers, ~50 LOC ajoutées :

1. [BilanNegativeStep.tsx](../../components/monthly-recap/steps/BilanNegativeStep.tsx) — drapeau `budgetsEmpty = summary.budgets.length === 0` + extension du union `snapshotState` avec `'empty'` (cas `!projectsOutOfTheWay ? 'locked' : budgetsEmpty ? 'empty' : 'active'`) + nouveaux drapeaux `allResourcesEmpty = piggyEmpty && savingsEmpty && projectsEmpty && budgetsEmpty` et `showSkipDeficit = !deficitCovered && allResourcesEmpty`. JSX : nouvelle `<section>` sous le bouton « Continuer » classique, avec copie explicative (« Tu n'as aucune ressource… Tu peux continuer — le déficit sera reporté sur ton solde du mois prochain. ») + bouton « Continuer sans renflouer » qui réutilise `handleContinue` existant (advance `manage_bilan → salary_update`).

2. [RefloatBudgetSnapshotLine.tsx](../../components/monthly-recap/RefloatBudgetSnapshotLine.tsx) — ajout de l'état `'empty'` au type `SnapshotLineState` + early return rendant une carte greyée « Aucun budget à équilibrer. ». Évite l'UX dégradée carte orange + liste vide + bouton disabled quand `budgets=[]`.

3. [BilanNegativeStep.test.tsx](../../components/monthly-recap/__tests__/BilanNegativeStep.test.tsx) — nouveau describe block « no resources at all → skip-deficit escape hatch » avec 3 cas : (a) skip visible quand piggy/savings/projects/budgets tous vides, copy explicative + état snapshot 'empty' visibles ; (b) clic sur « Continuer sans renflouer » appelle `advanceMock` avec `{ fromStep: 'manage_bilan', toStep: 'salary_update' }` ; (c) skip ABSENT quand ≥ 1 budget existe (le snapshot reste actionnable via overshoot).

4. [RefloatBudgetSnapshotLine.test.tsx](../../components/monthly-recap/__tests__/RefloatBudgetSnapshotLine.test.tsx) — 1 cas régression-guard pour l'état `'empty'`.

**Sémantique métier** — La voie « Continuer sans renflouer » est strictement réservée au cas « rien à faire matériellement » (aucune ressource existante). Si l'utilisateur a au moins 1 budget mais saturé (carryover ≥ estimated), le bouton « Équilibrer » reste cliquable et provoque un overshoot accepté (avec hint `OvershootHint` du sprint Carryover-Self-Healing UI 2026-05-26). Décision user 2026-05-27 (option « Uniquement tout vide » via `AskUserQuestion`) : ne pas généraliser la voie skip à tout déficit non couvert pour ne pas inciter l'utilisateur à zapper la cascade quand il a des ressources.

**Persistance du déficit résiduel** — Décision user 2026-05-27 (option « Persisté en RAV négatif ») : le `budget_snapshot_data` reste `NULL` après le clic skip, donc `finalize_recap_apply_snapshot` est no-op à la finalisation. Le calcul de RAV au mois suivant inclura naturellement le déficit comme un solde initial négatif (la formule canonique `totalIncomeContribution + exceptionalIncomes - estimatedBudgets - exceptionalExpenses - budgetDeficits` ne dépend pas du snapshot — seul le `carryover_spent_amount` matérialise les retards budget-par-budget). Le déficit est donc « porté » par le RAV global, pas par les budgets individuels.

**Tests** — 796 → 800 non-gated (+4 nouveaux : 3 BilanNegativeStep + 1 RefloatBudgetSnapshotLine). Lint 0/0, typecheck OK, prettier propre sur les 4 fichiers modifiés. `pnpm db:check-drift` + `db:check-rpcs` + `db:check-types-fresh` OK (UI-only).

**Pattern installé** — Toute machine d'état cascade UI (gating séquentiel avec états `locked`/`active`/`done`/`unneeded`) doit prévoir un **état `empty` distinct** pour les ressources structurellement absentes (vs `unneeded` qui signifie « couverture déjà atteinte en amont »). Sans ça, le rendu `active` + bouton `disabled` créé un piège silencieux où l'utilisateur ne sait pas si le bouton est cassé ou si la ressource manque. Le pattern miroir s'applique à toute future ligne de cascade (e.g. si on ajoutait une 5e source de refloat « bank balance », elle devrait avoir un état `empty` quand le solde est ≤ 0).

**Pattern installé bis (escape hatch)** — Quand un wizard multi-step a une étape qui peut être bloquante par construction (toutes les actions cliquables désactivées), prévoir un bouton d'avance explicite « Continuer sans X » avec copie sémantique qui explique la conséquence (« sera reporté »). Le bouton ne doit apparaître QUE dans le cas non-actionnable (sinon il créerait une voie de fuite trop facile pour l'utilisateur qui n'a pas fait l'effort de la cascade).

**Règle ❌ ajoutée** ([operational-rules.md](../conventions/operational-rules.md) §5 RAV formula) : ne PAS gater l'`advance-step` côté serveur sur `deficitRemaining > 0` — la persistance en RAV négatif est désormais le contrat. Toute future tentative d'ajouter un gate « refuser si déficit > 0 » casserait l'escape hatch et re-créerait le deadlock.

**Hors scope** — Le bug carryover compounding (sprint Bug-Déficit-Budget-Compounding plus haut) reste ouvert avec ses 5 pistes (cap auto / refloat bank / repartir à zéro / décompose visuel / decouple formula). Cette fix d'escape hatch ne réduit PAS la dette accumulée — elle rend juste actionable la voie « tirer un trait, accepter le RAV négatif » pour l'utilisateur piégé en début de session.
