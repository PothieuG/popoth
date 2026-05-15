# 08 — P3 : Recalcul RAV sur validation revenu (3 règles)

> ⚠️ **STALE — closed-by-pre-existing-fix 2026-05-15**
>
> Phase 1 audit a confirmé que les 3 règles P3 sont déjà toutes implémentées dans la formule RAV actuelle :
>
> - **Règle 1** (budget négatif → baisse RAV) : `lib/finance/calc-rtl.ts:97-105` `calculateBudgetDeficit` calculé on-the-fly + `lib/finance/financial-data.ts:131-164` somme `totalBudgetDeficits` + RAV formula `... - budgetDeficits`. **`monthly_surplus_deficit` n'est PAS consommé par la formule RAV** (0 hit applicatif via grep, c'est une colonne legacy).
> - **Règle 2** (dépense hors budget → baisse RAV) : `lib/finance/financial-data.ts:115-118` `exceptionalExpenses` filter + RAV `... - exceptionalExpenses`.
> - **Règle 3** (entrée hors budget → augmente RAV) : `lib/finance/financial-data.ts:119-120` `exceptionalIncomes` filter + RAV `incomeContribution + exceptionalIncomes + ...`.
> - **Trigger "recalcul sur validation revenu"** : `hooks/useRealIncomes.ts` (Sprint 1.5) `useMutation` invalide `['financial-summary']` via `invalidateFinancialRefreshes(qc)` (Sprint 2-followup) → recalcul temps réel.
> - **Couverture tests** : `lib/finance/__tests__/calc-rtl.test.ts:73-126` (9 cas pure-unit) + `lib/finance/__tests__/financial-data.test.ts` (gated, golden math seed avec exceptional rows).
>
> Voir CLAUDE.md §11 entrée Sprint P3-Closeout-Administrative. Recovery : pas applicable, 0 code touché.

## En-tête

| Champ | Valeur |
|-------|--------|
| **Source primaire** | [next-steps.md P3](../next-steps.md) (backlog produit) |
| **Type** | feature (extension règles RAV) |
| **Priorité** | Moyenne |
| **Effort estimé** | L (1-2 jours) |
| **Statut** | Non commencé |
| **Dépendances** | (Soft) chantier 07 (P2 RAV sans savings) — recommandé avant pour formule cohérente |
| **Bloque** | — |

## Contexte

next-steps.md P3 :

> ## P3 — Recalcul RAV sur validation revenu
>
> **Domaine** : finances / RAV calc
>
> Quand un revenu est validé, recalculer le RAV avec la nouvelle valeur. Règles :
>
> - Si un budget est négatif, le négatif s'ajoute au calcul du RAV.
> - Une dépense hors budget s'ajoute au calcul du RAV.
> - Une entrée d'argent hors budget s'ajoute au calcul du RAV.

**Compréhension métier** : trois règles d'extension de la formule RAV pour mieux refléter la réalité quand l'utilisateur valide un revenu (= passe de "estimé" à "réel"). Actuellement (à confirmer Phase 1 par audit code) :
- **Règle 1** : un budget négatif (déficit) doit faire baisser le RAV. Si `cumulated_savings d'un budget < 0` (théoriquement bloqué par CHECK constraints, mais peut surface via `monthly_surplus_deficit < 0`), reflèter ce déficit dans le RAV
- **Règle 2** : une dépense hors budget (`real_expenses.estimated_budget_id IS NULL`, dite "exceptionnelle") doit déjà baisser le RAV — vérifier que c'est bien le cas dans la formule actuelle
- **Règle 3** : une entrée d'argent hors budget (`real_incomes.estimated_income_id IS NULL`, dite "exceptionnelle") doit augmenter le RAV — vérifier idem

**Trigger** : quand un revenu est validé (UI : drawer/modal de validation revenu, qui crée ou met à jour `real_incomes`), recalculer le RAV pour refléter immédiatement les 3 règles.

**Architecture pertinente** :
- `lib/finance/calc-rtl.ts` (Sprint Refactor-I4) — formules
- `lib/finance/income-compensation.ts` (Sprint Refactor-I4) — `calculateIncomeCompensation(filter)` factorisée profile/group
- `lib/finance/financial-data.ts` (Sprint Refactor-I4) — orchestrateur
- `hooks/useRealIncomes.ts` (Sprint 1.5) — `useMutation` pour create/update real income, invalide `['financial-summary']` + `['progress-data']` + `['budgets']` via `invalidateFinancialRefreshes(qc)` (Sprint 2-followup)
- `app/api/finance/income/real/route.ts` — handler POST/PUT real income

**Impact UI** : le RAV affiché doit re-render après mutation (déjà géré par TanStack Query invalidation cache).

## Prompt prêt à l'emploi pour Claude Code

> Copier-coller dans une nouvelle session Claude Code à la racine du repo.

### 1. Objectif

Étendre la formule de calcul du RAV dans `lib/finance/calc-rtl.ts` pour intégrer les 3 règles P3 :
1. Budgets négatifs (`monthly_surplus_deficit < 0`) abaissent le RAV
2. Dépenses hors budget (`estimated_budget_id IS NULL`) abaissent le RAV (vérifier formule actuelle)
3. Entrées hors budget (`estimated_income_id IS NULL`) augmentent le RAV (vérifier formule actuelle)

Le recalcul est déjà déclenché par les mutations de revenus via TanStack Query invalidation (Sprint 1.5+2-followup) — pas de plumbing supplémentaire requis. Validation par 19 cas pure-unit ajustés + nouveaux cas dédiés P3 + 6 cas gated golden math + smoke browser.

### 2. Contexte technique

**Fichiers concernés** :
- `lib/finance/calc-rtl.ts` (formule à étendre)
- `lib/finance/types.ts` (vérifier shape `FinancialData` ; si on ajoute `totalNegativeBudgets` séparé)
- `lib/finance/income-compensation.ts` (vérifier que les exceptional incomes sont bien comptés)
- `lib/finance/financial-data.ts` (orchestrateur — vérifier que `monthly_surplus_deficit` est bien fetché des budgets)
- `lib/finance/__tests__/calc-rtl.test.ts` (19 cas, ajuster + ajouter ~5 cas P3)
- `lib/finance/__tests__/financial-data.test.ts` (6 cas gated, ajuster fixtures golden math)

**État actuel à confirmer Phase 1** :
- Formule actuelle (à confirmer par Read) : probablement déjà inclut les exceptional incomes/expenses car `_loadFinancialData` fetche `totalRealIncome`/`totalRealExpenses` (qui couvrent tous les rows incluant `estimated_budget_id IS NULL`)
- Question : est-ce que `monthly_surplus_deficit` négatif est actuellement compté dans le RAV ? Probablement pas (la colonne n'apparaît probablement pas dans la formule pure-helper)
- Trigger DB : `groups_budget_contribution_recalc` + `trigger_recalculate_contributions` (Sprint Audit-Triggers A2) gèrent les contributions, pas le `monthly_surplus_deficit`. Ce dernier est probablement set par `lib/recap/step1-persist.ts` ou monthly-recap workflow.

**Tests existants pertinents** :
- 19 cas `calc-rtl.test.ts` (Sprint Refactor-I4)
- 6 cas gated `financial-data.test.ts` (Sprint Refactor-I4 follow-up) — golden math `incomeContribution = 750 + 200 + 1500 = 2450`
- 28 cas `step1-algorithm.test.ts` (Sprint Refactor-I5) — vérifier dépendance

**Précédents codebase** :
- Sprint Refactor-I4 (CLAUDE.md §11) — extraction calc-rtl + income-compensation + financial-data
- Chantier 07 P2 (si fait avant) — formule RAV sans cumulated_savings
- Sprint 1.5 + 2-followup — TanStack Query invalidation cascade pour mutations cross-domain

### 3. Spécifications fonctionnelles attendues

**Cas nominal Règle 1 — Budget négatif** :
- L'utilisateur a un budget Loyer estimé 800€, mais ses real_expenses sur ce budget = 850€ (dépassement) → `monthly_surplus_deficit = -50`
- **Avant fix** : RAV ne reflète pas ce déficit (l'utilisateur croit avoir 50€ de marge qu'il n'a pas)
- **Après fix** : RAV diminue de 50€ (somme des `monthly_surplus_deficit < 0` sur tous les budgets du contexte)
- Trigger : tout fetch `_loadFinancialData` (incluant après mutation revenu)

**Cas nominal Règle 2 — Dépense hors budget** :
- L'utilisateur ajoute une dépense exceptionnelle 50€ (`estimated_budget_id IS NULL`)
- **Comportement attendu** : RAV diminue de 50€ immédiatement
- **À vérifier Phase 1** : est-ce déjà le cas ? Si `totalRealExpenses` couvre toutes les rows real_expenses (avec ou sans `estimated_budget_id`), oui. Si seulement les rows avec `estimated_budget_id`, non — il faut ajouter le total des exceptional.

**Cas nominal Règle 3 — Entrée hors budget** :
- L'utilisateur ajoute un revenu exceptionnel 200€ (`estimated_income_id IS NULL`)
- **Comportement attendu** : RAV augmente de 200€ immédiatement
- **À vérifier Phase 1** : idem règle 2

**Cas edge** :
- Budgets négatifs cumulés > revenus → RAV peut devenir négatif (overdraft mental). Comportement défensif (pas de fail, juste affiche valeur négative)
- Aucun budget négatif → comportement actuel inchangé (règles 2+3 peuvent déjà être actives)

**Cas erreur** :
- Aucun nouveau cas erreur introduit

### 4. Contraintes techniques

- **Style** : suivre conventions CLAUDE.md §6 (pure functions, immutable, no I/O dans calc-rtl.ts)
- **Cohérence avec P2** : si P2 (chantier 07) est fait avant, ne pas réintroduire les `cumulated_savings` par mégarde. La formule P2+P3 finale est :
  ```
  RAV = bank_balance + totalRealIncome + totalEstimatedIncomeNotConsumed
        - totalRealExpenses - totalEstimatedBudgetNotConsumed
        + sum(budgets.monthly_surplus_deficit where < 0)
  ```
  (Les règles 2+3 sont automatiques si `totalRealIncome`/`totalRealExpenses` couvrent les exceptional. Si pas, ajouter `+ totalExceptionalIncome - totalExceptionalExpense`.)
- **`FinancialData` shape extension** : si on ajoute des champs comme `totalNegativeBudgets`, mettre à jour interface
- **Phase 1 audit obligatoire** : confirmer que les exceptional sont déjà comptés (probable) avant d'ajouter une logique qui les compterait double
- **Counter `as unknown as SupabaseClient`** : reste à 0
- **Trigger DB** : pas de modif (les triggers actuels gèrent les contributions group, pas le RAV)

### 5. Critères d'acceptation vérifiables

- [ ] **Règle 1 implémentée** : `Grep "monthly_surplus_deficit" lib/finance/calc-rtl.ts` retourne ≥ 1 hit
- [ ] **Règles 2+3 vérifiées (audit Phase 1)** : si elles n'étaient pas déjà actives, modifications appliquées
- [ ] **typecheck** : `pnpm typecheck` exit 0
- [ ] **lint** : `pnpm lint:check` exit 0, baseline 183 stable
- [ ] **format** : `pnpm format:check` exit 0
- [ ] **tests pure-unit** : `pnpm test:run lib/finance/__tests__/calc-rtl.test.ts` 19 + ~5 nouveaux cas P3 passent
- [ ] **tests gated finance** : `SUPABASE_FINANCE_TESTS=1 pnpm test:run lib/finance/__tests__/financial-data.test.ts` 6 + ~1-2 nouveaux passants avec fixtures incluant budget négatif
- [ ] **tests gated recap** : `SUPABASE_RECAP_TESTS=1 pnpm test:run app/api/monthly-recap/process-step1/__tests__/` 6 byte-identique (step1 algo ne devrait pas changer si la formule RAV étendue est consume-side seulement)
- [ ] **build** : `pnpm build` exit 0
- [ ] **smoke browser** :
  - `/dashboard` ajouter une dépense exceptionnelle 50€ → RAV diminue de 50€ immédiatement (TanStack Query invalidation)
  - `/dashboard` ajouter un revenu exceptionnel 200€ → RAV augmente de 200€ immédiatement
  - Créer un budget Loyer 800€, ajouter dépenses 850€ → RAV reflète -50 quand le `monthly_surplus_deficit` est calculé (probablement au moment du recap mensuel — vérifier ou ajouter logic on-the-fly)

### 6. Tests à écrire ou à mettre à jour

#### Mise à jour `lib/finance/__tests__/calc-rtl.test.ts`

Ajustements + nouveaux cas dédiés P3 :

```typescript
// Nouveau bloc describe('P3 - Recalcul RAV règles')
describe('P3 - Règle 1: budget négatif', () => {
  it('RAV diminue du montant des budgets négatifs', () => {
    const input = {
      bankBalance: 1000, totalEstimatedIncome: 500, totalRealIncome: 0,
      totalEstimatedBudget: 300, totalRealExpenses: 0,
      budgets: [{ id: 'b1', monthly_surplus_deficit: -50 }, { id: 'b2', monthly_surplus_deficit: 100 }],
    }
    const result = calculateRemainingToLiveProfile(input)
    // Avant : 1000 + 500 - 300 = 1200
    // Après : 1200 + (-50) = 1150 (les 100 positifs ne comptent pas — déjà reflétés via cumulated_savings/savings handling)
    expect(result.remainingToLive).toBe(1150)
  })
  it('Plusieurs budgets négatifs → somme', () => {...})
  it('Aucun budget négatif → RAV inchangé vs formule de base', () => {...})
})
describe('P3 - Règle 2: dépense hors budget', () => {
  it('totalRealExpenses inclut les exceptional → RAV reflète', () => {...})
  // Si non-déjà actif, ajouter cas regression-guard
})
describe('P3 - Règle 3: entrée hors budget', () => {
  it('totalRealIncome inclut les exceptional → RAV reflète', () => {...})
})
```

#### Mise à jour `lib/finance/__tests__/financial-data.test.ts` (gated)

Ajouter 1-2 cas avec fixture budget négatif :

```typescript
it('Profile avec budget négatif: RAV reflète le deficit', async () => {
  // Seed: profile + budget Loyer 800€ + real_expense 850€ on this budget
  // Fixture force monthly_surplus_deficit = -50 sur le budget
  const data = await getProfileFinancialData(testProfileId)
  expect(data.remainingToLive).toBe(/* golden math attendu avec -50 */)
})
```

#### Test d'invalidation cache (optionnel)

Si on veut tester que la mutation revenu invalide bien le RAV cache :
- Pas un test pure-unit (nécessite TanStack Query mock setup)
- Couvrir via smoke browser à la place

### 7. Documentation à mettre à jour

- **CLAUDE.md** :
  - **§1 score** : ~99.999 stable (consolidation calc + ferme bug perçu)
  - **§5 Architecture critique** : section RAV — documenter les 3 règles P3 dans la formule
  - **§11 Roadmap** : nouvelle entrée `✅ **Sprint P3-RAV-Recalcul-Revenus** : ...`
- **next-steps.md** : retirer P3

### 8. Étapes de validation avant commit

```powershell
# 1. Pré-flight
pnpm verify
git status -s

# 2. Phase 1 audit (CRUCIAL — confirmer ce qui est déjà actif)
# Read lib/finance/calc-rtl.ts (formule actuelle)
# Read lib/finance/financial-data.ts (orchestration, est-ce que monthly_surplus_deficit est fetché ?)
# Read lib/finance/income-compensation.ts (gestion des exceptional)
# Read app/api/finance/income/real/route.ts (handler real income)
# Grep "estimated_budget_id" lib/finance/  # voir où l'exceptional path est traité
# Grep "estimated_income_id IS NULL" lib/finance/

# 3. Implementation
# Edit lib/finance/calc-rtl.ts : ajouter Règle 1 (sum monthly_surplus_deficit < 0)
# Vérifier Règles 2+3 (probable déjà actives si totalRealIncome/Expenses couvrent tout)
# Edit lib/finance/types.ts si shape change

# 4. Tests
# Edit lib/finance/__tests__/calc-rtl.test.ts (5 nouveaux cas P3)
# Edit lib/finance/__tests__/financial-data.test.ts (1-2 cas gated avec budget négatif)
pnpm test:run lib/finance/__tests__/calc-rtl.test.ts
SUPABASE_FINANCE_TESTS=1 pnpm test:run lib/finance/__tests__/financial-data.test.ts

# 5. Validation totale
pnpm typecheck
pnpm lint:check
pnpm format:check
pnpm test:run
SUPABASE_RECAP_TESTS=1 pnpm test:run app/api/monthly-recap/process-step1/__tests__/
pnpm build

# 6. Smoke browser EXHAUSTIF
pnpm dev
# Flow ajout revenu exceptionnel → vérifier RAV +200
# Flow ajout dépense exceptionnelle → vérifier RAV -50
# Créer budget négatif (dépasser estimé) → vérifier RAV reflète déficit
```

## Pièges connus / points d'attention

- **`monthly_surplus_deficit` set quand** ? Vérifier si cette colonne est calculée temps réel ou seulement au moment du monthly-recap. Si seulement au recap, la Règle 1 n'aura d'effet qu'après un recap (pas immédiatement après ajout dépense). **Décision Phase 1** : faut-il calculer on-the-fly aussi ? Si oui, ajouter un helper `calculateBudgetDeficit(budget, realExpenses)` et l'utiliser dans `_loadFinancialData`.
- **Double-comptage Règles 2+3** : si la formule actuelle compte déjà les exceptional via `totalRealIncome`/`totalRealExpenses`, ne PAS ajouter `+ totalExceptional...` qui ferait double. Audit Phase 1 obligatoire.
- **Coordination chantier 07 P2** : si P2 fait avant, formule de référence pour P3 = sans cumulated_savings. Les nouveaux cas tests doivent partir de cette baseline.
- **Step1 algorithm dependency** (CLAUDE.md §11 Sprint Refactor-I5) : si `decideStep1Allocation` consomme le RAV avec l'ancienne formule, le step1 va calculer différemment. Vérifier — si oui, c'est un changement métier (recap mensuel se comporte différemment), confirmer avec user.
- **Pre-existing dirty working tree** : si chantier 16 pas encore traité, exclure des commits P3.

## Découpage en sous-tâches (L → 4-5 commits)

1. **Sub-1 (Effort : XS)** — Phase 1 audit (confirmer ce qui est actif via Read + grep). Documenter dans le draft.
2. **Sub-2 (Effort : S)** — Implementation Règle 1 (somme deficit). Commit `feat(finance): include negative budgets in RAV (P3 règle 1)`.
3. **Sub-3 (Effort : S)** — Si nécessaire après audit : Implementation Règles 2 ou 3. Commit `feat(finance): include exceptional in RAV (P3 règles 2+3)`. Sinon skip.
4. **Sub-4 (Effort : S)** — Tests pure-unit + gated. Commit `test(finance): add P3 RAV recalc cases`.
5. **Sub-5 (Effort : XS)** — Closeout doc CLAUDE.md + retrait P3 next-steps. Commit `docs: closeout P3 RAV recalcul revenus`.

## Recovery path

- `git revert <sha>` chacun des commits. Pas de migration DB. Tests reverts.

## Précédents codebase (références)

- Chantier 07 P2 — formule sans cumulated_savings (à reprendre si fait avant)
- Sprint Refactor-I4 — pattern `_loadFinancialData` orchestrateur + 5 helpers pure
- Sprint 1.5 + 2-followup — TanStack Query invalidation cascade

---

**Estimation totale** : 1-2 jours. Ferme P3 du backlog produit. Bug perçu (RAV ne reflète pas budgets négatifs) éliminé. Score métier ~99.999 stable. Risque modéré — bien tester smoke browser exhaustivement (impact tous les flows financiers consommant le RAV).
