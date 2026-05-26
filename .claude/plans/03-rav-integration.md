# Sprint 03 — Intégration RAV (projets dans la formule reste-à-vivre)

> ⚠️ **Avant toute chose, relire la spec originale : [`.claude/plans/00-Readme.md`](./00-Readme.md)** pour avoir le contexte produit complet.

## Objectif

Le `monthly_allocation` de chaque projet actif s'ajoute à la somme des budgets dans la formule RAV. Le RAV diminue d'autant. La validation "Ajouter un budget" doit tenir compte des projets existants ; idem pour "Ajouter un projet" (préparée au sprint 05).

## Pré-lecture obligatoire

- [lib/finance/financial-data.ts:37-285](../../lib/finance/financial-data.ts) — orchestrateur `_loadFinancialData`
- [lib/finance/calc-rtl.ts](../../lib/finance/calc-rtl.ts) — `calculateRemainingToLiveProfile/Group`
- [lib/schemas/budget.ts:77-99](../../lib/schemas/budget.ts) — `makeBudgetClientSchema` factory refine
- [CLAUDE.md §5 + §8](../../CLAUDE.md) — RAV formula canonique (⚠️ NE PAS ajouter `cumulated_savings`)

## Pré-requis

```powershell
git checkout feature/projets-epargne
$env:SUPABASE_PROJECT_REF = 'ddehmjucyfgyppfkbddr'
```

## Tâches

### 1. Modifier `lib/finance/financial-data.ts::_loadFinancialData`

Après l'étape 3 (budgets, lignes 81-88), ajouter étape 3.bis :

```ts
// 3.bis Projets d'épargne actifs (monthly_allocation traité comme un budget classique)
const { data: savingsProjects } = await supabaseServer
  .from('savings_projects')
  .select('id, name, monthly_allocation, amount_saved, target_amount, deadline_date')
  .eq(ownerColumn, ownerId)
const totalMonthlyProjects =
  savingsProjects?.reduce((sum, p) => sum + p.monthly_allocation, 0) ?? 0
```

Modifier ligne 87-88 :

```ts
const totalEstimatedBudgets =
  (estimatedBudgets?.reduce((sum, b) => sum + b.estimated_amount, 0) ?? 0)
  + totalMonthlyProjects
```

**Décision explicite** : `totalEstimatedBudgets` agrège budgets + projets (le user a confirmé "traité comme un budget classique"). Pas de nouveau terme dans la formule RAV → réutilise `calculateRemainingToLiveProfile/Group` tel quel.

**Exposer pour l'UI** : ajouter `meta.totalMonthlyProjects: number` et `meta.savingsProjects: SavingsProjectMeta[]` (subset light : id, name, monthlyAllocation, amountSaved, targetAmount, deadlineDate, monthsRemaining) au type `FinancialData.meta`. Ces champs alimenteront le drawer recap (sprint 07).

### 2. Update types — `lib/finance/types.ts`

- Ajouter `SavingsProjectMeta` (subset présentationnel)
- Étendre `FinancialDataMeta` avec `totalMonthlyProjects` + `savingsProjects`

### 3. Helper pure — `lib/finance/projects-meta.ts` (nouveau)

- `function monthsBetween(from: Date, to: string): number` — calcul mois entre 2 dates (helper réutilisable)
- `function buildSavingsProjectMeta(row): SavingsProjectMeta` — agrège les champs présentationnels
- `function computeDeadlineFromDuration(durationMonths: number, from?: Date): string` — utile au sprint 05 pour la modal create

### 4. Tests gated — `lib/finance/__tests__/financial-data-with-projects.test.ts` (`SUPABASE_FINANCE_TESTS=1`)

- Cas 1 : profile avec 2 projets de 100€/mois → totalEstimatedBudgets inclut 200
- Cas 2 : group avec 1 projet 50€ → idem groupe
- Cas 3 : projet supprimé → totalMonthlyProjects diminue
- Cas 4 : aucun projet → meta.savingsProjects = []

### 5. Tests non-gated — `lib/finance/__tests__/projects-meta.test.ts`

6 cas sur `monthsBetween` et `computeDeadlineFromDuration` (mois exact, mois fractionnaire, deadline passée, premier du mois, fin du mois, années croisées).

### 6. Vérifications

```powershell
pnpm typecheck                                         # exit 0
$env:SUPABASE_FINANCE_TESTS = '1'; pnpm test:run       # tous passent
pnpm verify                                            # exit 0
```

### 7. Commit

```
feat(projects): integrate monthly_allocation into RAV formula
```

## Acceptance criteria

- Créer un projet 100€/mois → RAV diminue de 100€ (vérifiable via GET `/api/finance/summary`).
- Supprimer le projet → RAV remonte de 100€ + tirelire `+amount_saved`.
- 0 régression sur les tests budgets existants.

## Hors scope

- Refine sur `AddBudgetDialog` (utilisera déjà le nouveau `totalEstimatedBudgets` via `useFinancialData`).
- UI nouvel onglet (sprint 04).
