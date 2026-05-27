# [04] — Calculs purs : bilan, surplus, refloat proportionnel, snapshot

> 🛑 **AVANT DE COMMENCER** — Relire impérativement [00-README.md](./00-README.md) et [00-Detailed_feature.md](./00-Detailed_feature.md) pour recharger tout le contexte feature (architecture globale + spec §1-8). Ce prompt ne se suffit pas à lui-même.

## Contexte
- Feature globale : Monthly Recap V3, processus mensuel obligatoire avec wizard 5 écrans.
- Position dans la séquence : étape 04/17
- Dépend de : 03 (state + schemas)
- Débloque : 05 (start/status endpoint utilise computeRecapSummary), 06 (positive endpoints), 07 (negative endpoints), 08 (salary+finalize)

## Objectif
Créer un module pur `lib/recap/calculations.ts` contenant TOUTES les formules métier du recap : bilan, surplus par budget, refloat proportionnel via savings, snapshot proportionnel via budgets. Zéro I/O Supabase — les fonctions reçoivent les inputs en paramètre et retournent les résultats. Couverture Vitest non-gated 100% (≥30 cas).

## Fichiers concernés
- `lib/recap/calculations.ts` — à créer
- `lib/recap/__tests__/calculations.test.ts` — à créer
- `lib/recap/types.ts` — à créer (interfaces partagées : RecapSummary, SurplusByBudget, etc.)
- `lib/recap/index.ts` — à étendre (re-export depuis calculations + types)
- `lib/finance/calc-rtl.ts` — à LIRE pour réutiliser les formules RAV existantes (NE PAS dupliquer)

## Patterns et conventions à respecter
- **Pure functions** : 0 I/O, 0 import Supabase, 0 import lib/logger. Déterministes, idempotentes.
- **Immutable inputs** : `readonly` sur les arrays/records reçus, ne jamais muter.
- **Precision décimale** : utiliser `Math.round(x * 100) / 100` pour les agrégats final (éviter le float drift). Pattern documenté dans CLAUDE.md `❌ Edit-mode allocation`.
- **Reuse `calc-rtl.ts`** : `calculateRemainingToLiveProfile`, `calculateRemainingToLiveGroup`, `calculateBudgetSavings`, `calculateBudgetDeficit` existent déjà dans [lib/finance/calc-rtl.ts](../lib/finance/calc-rtl.ts).
- **Sort déterministe** : si une fonction retourne un array ordonné, trier explicitement par UUID croissant pour stabilité tests.
- **Tests co-localisés** : `lib/recap/__tests__/calculations.test.ts` (Vitest non-gated env=node).

## Détail du module

### `lib/recap/types.ts` — interfaces partagées

```ts
export interface BudgetSummary {
  budgetId: string
  budgetName: string
  estimatedAmount: number
  spentThisMonth: number  // somme real_expenses non-carried-over
  cumulatedSavings: number
  surplus: number   // max(0, estimatedAmount - spentThisMonth)
  deficit: number   // max(0, spentThisMonth - estimatedAmount)
}

export interface RecapSummary {
  // Inputs résumés
  currentBalance: number
  ravEstime: number      // profile : sum(estimatedIncomes) − sum(estimatedBudgets)
                         // group   : sum(estimatedIncomes) + totalGroupContributions − sum(estimatedBudgets)
                         // Le terme group DOIT être inclus pour rester symétrique
                         // à ravEffectif (cf. lib/finance/calc-rtl.ts::calculateRemainingToLiveGroup).
  ravEffectif: number    // RAV calculé par calc-rtl (existing)
  totalSurplus: number   // sum(budgets.surplus)
  totalSavings: number   // sum(budgets.cumulatedSavings) — par budget, hors piggy
  piggyAmount: number
  budgets: readonly BudgetSummary[]

  // Bilan
  bilan: number          // ravEffectif - ravEstime (SOUSTRACTION : positif si mois mieux que prévu)
  bilanSign: 'positive' | 'negative' | 'zero'
}

export interface RefloatProportionalAllocation {
  // Sortie de computeProportionalSavingsRefloat / computeProportionalBudgetSnapshot
  perBudget: ReadonlyArray<{
    budgetId: string
    amount: number  // montant à débiter de ce budget
  }>
  totalAllocated: number  // somme(perBudget.amount), garanti ≤ targetAmount
  shortfall: number       // targetAmount - totalAllocated (>0 si pool insuffisant)
}
```

### `lib/recap/calculations.ts` — pure functions

```ts
import type { BudgetSummary, RecapSummary, RefloatProportionalAllocation } from './types'

/**
 * Calcule le surplus / déficit d'un seul budget.
 * surplus = max(0, estimé - dépensé), nul si dépassement.
 * deficit = max(0, dépensé - estimé), nul si sous-consommation.
 * @param spentThisMonth somme real_expenses NON carried-over de ce mois pour ce budget
 */
export function computeBudgetSurplus(estimatedAmount: number, spentThisMonth: number): { surplus: number, deficit: number } {
  const diff = round2(estimatedAmount - spentThisMonth)
  return diff >= 0 ? { surplus: diff, deficit: 0 } : { surplus: 0, deficit: round2(-diff) }
}

/**
 * Construit le résumé complet du recap depuis les données financières.
 * Le bilan = ravEffectif - ravEstime (SOUSTRACTION). Positif si ravEffectif > ravEstime
 * (mois meilleur que prévu : j'ai dépensé moins → on peut épargner la diff).
 * Négatif si ravEffectif < ravEstime (mois pire : j'ai dépensé plus → à renflouer).
 */
export function computeRecapSummary(input: {
  currentBalance: number
  ravEstime: number
  ravEffectif: number
  piggyAmount: number
  budgets: ReadonlyArray<{
    budgetId: string
    budgetName: string
    estimatedAmount: number
    spentThisMonth: number
    cumulatedSavings: number
  }>
}): RecapSummary {
  const enriched: BudgetSummary[] = input.budgets.map((b) => {
    const { surplus, deficit } = computeBudgetSurplus(b.estimatedAmount, b.spentThisMonth)
    return { ...b, surplus, deficit }
  })
  const totalSurplus = round2(enriched.reduce((s, b) => s + b.surplus, 0))
  const totalSavings = round2(enriched.reduce((s, b) => s + b.cumulatedSavings, 0))
  const bilan = round2(input.ravEffectif - input.ravEstime)
  const bilanSign: 'positive' | 'negative' | 'zero' = bilan > 0 ? 'positive' : bilan < 0 ? 'negative' : 'zero'
  return { ...input, budgets: enriched.sort((a, b) => a.budgetId.localeCompare(b.budgetId)), totalSurplus, totalSavings, bilan, bilanSign }
}

/**
 * Calcule combien puiser proportionnellement dans les cumulated_savings des budgets pour combler un montant.
 * - Distribute targetAmount across budgets weighted by their cumulated_savings
 * - perBudget[i].amount = min(budget.cumulatedSavings, round2(targetAmount * budget.cumulatedSavings / totalSavings))
 * - Last budget absorbs the rounding remainder so sum(perBudget.amount) == min(targetAmount, totalSavings) exactly
 * - Si totalSavings === 0 : retourner perBudget=[], totalAllocated=0, shortfall=targetAmount
 */
export function computeProportionalSavingsRefloat(targetAmount: number, budgets: ReadonlyArray<{ budgetId: string, cumulatedSavings: number }>): RefloatProportionalAllocation {
  // Implémentation cents-precise + remainder allocation sur le dernier budget
}

/**
 * Calcule combien puiser proportionnellement dans les BUDGETS RESTANTS (estimated - spent_remaining).
 * - On puise proportionnellement à `budget.estimatedAmount - budget.carryover_spent_amount` (le "budget disponible")
 * - Pas dans `cumulated_savings` ici (séparé)
 * - Last budget absorbs rounding
 */
export function computeProportionalBudgetSnapshot(targetAmount: number, budgets: ReadonlyArray<{ budgetId: string, estimatedAmount: number, currentCarryoverSpent: number }>): RefloatProportionalAllocation {
  // Pool = sum(budget.estimatedAmount - budget.currentCarryoverSpent)
  // Distribute proportionnellement, idem savings refloat
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
```

## Étapes d'implémentation suggérées
1. **Lire les références** : [lib/finance/calc-rtl.ts](../lib/finance/calc-rtl.ts), [lib/expense-breakdown.ts](../lib/expense-breakdown.ts) pour le pattern "pure function + cents precision".
2. **Créer `lib/recap/types.ts`** : interfaces `BudgetSummary`, `RecapSummary`, `RefloatProportionalAllocation`.
3. **Créer `lib/recap/calculations.ts`** : `computeBudgetSurplus`, `computeRecapSummary`, `computeProportionalSavingsRefloat`, `computeProportionalBudgetSnapshot`. Helper privé `round2`.
4. **Implémenter l'allocation proportionnelle avec rounding** : algorithme greedy float-precise — calcul des shares, cap au max disponible, somme exacte via remainder sur le dernier budget. Détail : `share[i] = min(budget[i].pool, round2(targetAmount * budget[i].pool / totalPool))`, puis `lastShare += targetAmount - sum(shares[0..n-1])`. Clamper si lastShare > budget[n-1].pool.
5. **Étendre `lib/recap/index.ts`** : re-exports calculations + types.
6. **Tests `__tests__/calculations.test.ts`** : ≥30 cas, voir liste ci-dessous.
7. **Vérifs** : `pnpm test:run lib/recap/__tests__/calculations.test.ts` + `pnpm typecheck`.
8. **Commit** : `feat(recap): pure calculations module (bilan, refloat, snapshot)`.

## Critères d'acceptation
- [ ] `lib/recap/calculations.ts` : 4 fonctions exportées (computeBudgetSurplus, computeRecapSummary, computeProportionalSavingsRefloat, computeProportionalBudgetSnapshot)
- [ ] `lib/recap/types.ts` : 3 interfaces exportées
- [ ] `lib/recap/index.ts` : re-exporte tout
- [ ] **0 import Supabase** dans calculations.ts (vérifier `Grep "supabase" lib/recap/calculations.ts`)
- [ ] **0 import logger** (pure module)
- [ ] Tests ≥30 cas, tous passants
- [ ] Coverage 100% sur calculations.ts (optionnel : `pnpm test:coverage lib/recap/calculations.ts`)
- [ ] `pnpm typecheck` exit 0
- [ ] `pnpm lint:check` exit 0
- [ ] Aucun `any` ni cast inutile

## Tests à écrire

### `computeBudgetSurplus` (6+ cas)
- estimé > dépensé → surplus positif, deficit=0
- estimé < dépensé → deficit positif, surplus=0
- estimé == dépensé → surplus=0, deficit=0
- estimé 100.33 dépensé 100.32 → surplus 0.01 (cents precise)
- estimé 0 dépensé 10 → deficit=10
- estimé 10 dépensé 0 → surplus=10

### `computeRecapSummary` (8+ cas)
- 3 budgets surplus, 0 dépensé tout → totalSurplus = sum(estimés), bilanSign='positive' si ravEffectif − ravEstime > 0
- 3 budgets en surplus, ravEffectif == ravEstime → bilanSign='zero'
- 1 budget en déficit, ravEffectif < ravEstime → bilanSign='negative'
- budgets vides → totalSurplus=0, totalSavings=0
- Tri déterministe : budgets sortis par budgetId croissant
- Cumulated savings se somment correctement
- piggyAmount transmis verbatim
- ravEffectif - ravEstime calcule bilan exact (cents-precise) — SOUSTRACTION, pas addition

### `computeProportionalSavingsRefloat` (10+ cas)
- Cas standard : target=100, 2 budgets {savings=200, savings=100} → perBudget=[{a:66.67}, {b:33.33}] (proportional) — vérifier sum=100
- Pool exact = target : target=100, 2 budgets {savings=70, savings=30} → perBudget=[{a:70}, {b:30}], shortfall=0
- Pool < target : target=200, 2 budgets {savings=70, savings=30} → perBudget=[{a:70}, {b:30}], totalAllocated=100, shortfall=100
- Pool == 0 : target=100, budgets vides ou tous savings=0 → perBudget=[], totalAllocated=0, shortfall=100
- Single budget : target=50, 1 budget {savings=200} → perBudget=[{a:50}], totalAllocated=50
- Target=0 → perBudget=[], totalAllocated=0, shortfall=0
- Cents precision : target=100, 3 budgets {savings=100,100,100} → perBudget=[{a:33.33},{b:33.33},{c:33.34}] (last absorbs remainder)
- Sort budgetId croissant
- Sum garanti exact : assert perBudget.reduce(+amount) === Math.min(target, pool) à la précision cents
- Single budget poolBigger > target : target=50, budget {savings=1000} → cap à 50, perBudget=[{a:50}]
- Negative target → throw ou return shortfall=target (decide & document)

### `computeProportionalBudgetSnapshot` (6+ cas)
- Cas standard : target=30, 3 budgets {estimated=100,50,25} → perBudget=[{a:17.14},{b:8.57},{c:4.29}] (proportional sur estimated_amount * 175 / 175 / target=30)
   Note: spec exemple `déficit 30€ + 3 budgets (100, 50, 25) → 10€ chacun`. Donc ATTENTION : le spec dit que la répartition n'est PAS proportionnelle à l'estimated_amount, c'est "10€ à chacun" (égalisée ? proportionnelle ? unclear).
   **À CLARIFIER** : relire spec §4.B Ligne 3 — l'exemple dit "on retire 10€ à chacun" pour déficit 30€ + 3 budgets. C'est 10€ flat par budget (égalisée) OU "proportional to total budget pool"? Avec 100+50+25=175 et target=30, propre proportional donnerait {a:17.14, b:8.57, c:4.29}. Le "10€ chacun" est suspect — peut-être c'est juste un EXEMPLE simplifié (3 budgets, 30€ → 10/10/10) où la proportionnalité naturelle donne ≈ ces valeurs si les 3 budgets sont équilibrés. **Soit l'algorithme est égalisé (chaque budget contribue target/N), soit il est proportional au pool restant.** Si égalisé, calculer differently (et alors le param "estimatedAmount" du budget n'est pas utilisé).

   **Decision suggérée** : proportional sur (estimated_amount - carryover_spent_amount) car c'est ce qui reste réellement "disponible" dans le budget. L'exemple spec marche aussi par hasard si les 3 budgets ont le même montant disponible. Documenter la décision dans le commentaire de la fonction et la tester explicitement.
- Pool < target : target=100, 1 budget {estimated=30} → perBudget=[{a:30}], shortfall=70
- Pool == 0 : tous budgets avec estimated == carryover_spent → perBudget=[], shortfall=target
- Cents precision rounding sur dernier budget

## Pièges et points d'attention
- **`computeProportionalBudgetSnapshot` : algorithme de distribution ambigu dans la spec.** L'exemple "10€ chacun pour 30€/3 budgets" est cohérent avec proportional uniquement si les 3 budgets ont le même pool disponible. Choisir et documenter — recommandation : **proportional sur `estimatedAmount - currentCarryoverSpent`**, cohérent avec le mode opératoire "puiser dans le budget restant".
- **Float drift** : Σ shares peut diverger de target de 0.01-0.03€ sans remainder allocation. Toujours allouer le reste au dernier budget. Vérifier `assert sum(perBudget.amount) === Math.min(target, pool)` à 0.01€ près dans les tests.
- **Pool insuffisant** : si totalPool < targetAmount, allouer 100% du pool puis retourner `shortfall = target - totalAllocated`. NE PAS clamp silencieusement à 0 sans signaler.
- **Single budget edge case** : 1 budget avec pool=X, target=Y → perBudget=[{a: min(X,Y)}]. Pas de "remainder" à propager.
- **Empty array** : `budgets=[]` → perBudget=[], totalAllocated=0, shortfall=target. Tester explicitement.
- **Negative inputs** : assert via runtime check ou throw — discutable. Recommandation : trust internal callers (les schémas Zod garantissent positivité), pas de validation runtime.
- **Order stability** : trier les budgets par budgetId AVANT la distribution pour que le "last budget remainder" soit déterministe. Crucial pour les snapshots tests byte-identique.
- **Ne PAS réintroduire `cumulated_savings` dans la formule RAV** (cf. CLAUDE.md ❌ "Sémantique RAV / breakdown"). Le bilan reste `ravEffectif - ravEstime` (SOUSTRACTION), sans terme savings.

## Commandes utiles
```bash
# Tests focused
pnpm test:run lib/recap/__tests__/calculations.test.ts

# Coverage
pnpm test:coverage lib/recap/calculations.ts

# Full sweep
pnpm typecheck && pnpm lint:check
```

## Definition of Done
- Tous les critères d'acceptation cochés
- `lib/recap/calculations.ts` 100% pure (grep "from '@/lib/supabase" retourne 0)
- ≥30 cas de tests passants
- Documentation inline minimale (1 ligne par fonction sur le contrat — pas de docstring multi-lignes)
- Décision sur `computeProportionalBudgetSnapshot` (proportional vs égalisé) documentée dans le commit message
- Commit `feat(recap): pure calculations module (bilan, refloat, snapshot)`
- `pnpm verify` exit 0
