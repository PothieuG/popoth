# [13] — Screen 3B : Bilan négatif (renflouement piggy / savings / budget snapshot)

> 🛑 **AVANT DE COMMENCER** — Relire impérativement [00-README.md](./00-README.md) et [00-Detailed_feature.md](./00-Detailed_feature.md) pour recharger tout le contexte feature (architecture globale + spec §1-8). Ce prompt ne se suffit pas à lui-même.

## Contexte
- Feature globale : Monthly Recap V3 — écran 3B, quand bilan < 0, renflouement en cascade (tirelire → économies → puisage proportionnel dans budgets, snapshot différé).
- Position dans la séquence : étape 13/17
- Dépend de : 07 (negative endpoints), 10 (wizard shell), 11 (Summary step)
- Débloque : 14 (SalaryUpdateStep)

## Objectif
Implémenter `BilanNegativeStep.tsx` avec les 3 lignes de renflouement (piggy / savings / budget snapshot). Compteur "montant à renflouer" mis à jour en temps réel. Bascule sur BilanPositiveStep si piggy seule a généré un surplus residuel (cas spec §4.B ligne 1 "il reste X€ dans la tirelire").

## Fichiers concernés
- `components/monthly-recap/steps/BilanNegativeStep.tsx` — à créer
- `components/monthly-recap/RefloatPiggyLine.tsx` — à créer
- `components/monthly-recap/RefloatSavingsLine.tsx` — à créer
- `components/monthly-recap/RefloatBudgetSnapshotLine.tsx` — à créer
- `hooks/useMonthlyRecap.ts` — à étendre avec `useRefloatFromPiggy()`, `useRefloatFromSavings()`, `useSaveBudgetSnapshot()`
- `lib/recap/actions-negative.ts` — à LIRE/RÉUTILISER (computeDeficitRemaining côté client si besoin)

## Patterns et conventions à respecter
- **Compteur déficit temps-réel** : recalculé depuis summary + monthly_recaps state (`refloated_from_piggy`, `refloated_from_savings`, `budget_snapshot_data`). À chaque mutation success, fresh state replace l'ancien via setQueryData.
- **3 lignes verticales** : piggy en premier, savings en deuxième, budget snapshot en troisième. Affichage progressif (line 1 disabled si piggy=0, etc.).
- **Bascule flow positif** : si après refloat-from-piggy le déficit atteint 0 AND piggy.amount > 0 restant, l'UI route vers BilanPositiveStep (le wizard re-render avec bilanSign='positive' synthétique OR le step côté serveur reste manage_bilan + UI conditionne sur new bilan).
- **Bouton "Continuer"** apparaît seulement quand deficit_remaining === 0.

## Détail du composant principal

```tsx
'use client'
import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { RefloatPiggyLine } from '../RefloatPiggyLine'
import { RefloatSavingsLine } from '../RefloatSavingsLine'
import { RefloatBudgetSnapshotLine } from '../RefloatBudgetSnapshotLine'
import { BilanPositiveStep } from './BilanPositiveStep'
import { formatEuro } from '@/lib/format-currency'
import { computeDeficitRemaining } from '@/lib/recap/actions-negative'
import type { RecapSummary } from '@/lib/recap/types'

export function BilanNegativeStep({ context, summary, recapState }: {
  context: 'profile'|'group'
  summary: RecapSummary
  recapState: {
    id: string
    refloated_from_piggy: number
    refloated_from_savings: number
    budget_snapshot_data: Record<string, number>
  }
}) {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const deficitRemaining = useMemo(() => computeDeficitRemaining({
    initialBilan: summary.bilan,
    refloatedFromPiggy: recapState.refloated_from_piggy,
    refloatedFromSavings: recapState.refloated_from_savings,
    snapshotData: recapState.budget_snapshot_data,
  }), [summary.bilan, recapState])

  const piggySurplusAfterRefloat = summary.piggyAmount > Math.abs(summary.bilan) // cas bascule positif

  // Si après refloat piggy le bilan est positif, switch sur le composant positif
  if (deficitRemaining <= 0 && summary.piggyAmount > 0 && recapState.refloated_from_piggy > 0 && piggySurplusAfterRefloat) {
    return <BilanPositiveStep context={context} summary={{ ...summary, bilanSign: 'positive', bilan: summary.piggyAmount - Math.abs(summary.bilan) }} />
  }

  // Avancer vers salary_update si deficit = 0
  if (deficitRemaining <= 0) {
    return <ContinueToSalaryUpdate context={context} qc={qc} />
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-gray-900">Gestion du déficit</h1>
        <p className="mt-1 text-sm text-gray-600">Montant à renflouer :</p>
        <p className="text-3xl font-bold text-red-700">{formatEuro(deficitRemaining)}</p>
      </header>

      <RefloatPiggyLine context={context} piggyAmount={summary.piggyAmount} deficitRemaining={deficitRemaining} recapId={recapState.id} onSuccess={(fresh) => qc.setQueryData(['monthly-recap','status',context], (old: any) => ({ ...old, status: { ...old.status, ...fresh.status }, summary: fresh.summary }))} />

      <RefloatSavingsLine context={context} totalSavings={summary.totalSavings} savingsByBudget={summary.budgets.filter(b => b.cumulatedSavings > 0)} deficitRemaining={deficitRemaining} recapId={recapState.id} onSuccess={...} />

      <RefloatBudgetSnapshotLine context={context} budgets={summary.budgets} deficitRemaining={deficitRemaining} recapId={recapState.id} snapshotData={recapState.budget_snapshot_data} onSuccess={...} />

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
```

### `RefloatPiggyLine.tsx`

```tsx
'use client'
export function RefloatPiggyLine({ piggyAmount, deficitRemaining, ...props }) {
  const useFromPiggy = Math.min(piggyAmount, deficitRemaining)

  if (piggyAmount === 0) {
    return (
      <section className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm font-medium text-gray-700">Tirelire</p>
        <p className="mt-1 text-sm text-gray-500">Pas d'argent dans la tirelire.</p>
      </section>
    )
  }

  // Mutation refloat-from-piggy avec amount = useFromPiggy
  const mutation = useMutation({...})

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4">
      <p className="mb-2 text-sm font-medium text-gray-900">Tirelire</p>
      <p className="text-xs text-gray-600">Disponible : {formatEuro(piggyAmount)}</p>
      <p className="text-xs text-gray-600">À utiliser : {formatEuro(useFromPiggy)}</p>
      <Button className="mt-3 w-full" onClick={() => mutation.mutate(useFromPiggy)} disabled={mutation.isPending}>
        {mutation.isPending ? 'Renflouement…' : `Renflouer ${formatEuro(useFromPiggy)}`}
      </Button>
    </section>
  )
}
```

### `RefloatSavingsLine.tsx`

```tsx
'use client'
export function RefloatSavingsLine({ totalSavings, savingsByBudget, deficitRemaining, ...props }) {
  if (totalSavings === 0) {
    return (
      <section className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm font-medium text-gray-700">Économies des budgets</p>
        <p className="mt-1 text-sm text-gray-500">Pas d'économies disponibles.</p>
      </section>
    )
  }

  const mutation = useMutation({...})  // POST /refloat-from-savings (pas d'amount, server calcule)

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4">
      <p className="mb-2 text-sm font-medium text-gray-900">Économies des budgets</p>
      <p className="text-xs text-gray-600">Total : {formatEuro(totalSavings)}</p>
      <ul className="my-2 space-y-1 text-xs text-gray-600">
        {savingsByBudget.map(b => (
          <li key={b.budgetId} className="flex justify-between">
            <span>{b.budgetName}</span>
            <span>{formatEuro(b.cumulatedSavings)}</span>
          </li>
        ))}
      </ul>
      <Button className="mt-2 w-full" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        Transférer mes économies dans le déficit
      </Button>
    </section>
  )
}
```

### `RefloatBudgetSnapshotLine.tsx`

```tsx
'use client'
export function RefloatBudgetSnapshotLine({ budgets, deficitRemaining, snapshotData, ...props }) {
  const mutation = useMutation({
    mutationFn: async () => {
      // Calculer snapshot proportionnel via API ou en local via computeProportionalBudgetSnapshot
      // Recommandation : laisser le SERVER calculer via le endpoint (le UI envoie un snapshot computed côté client OR un endpoint /preview-snapshot retourne le snapshot calculé).
      // Pour V1 : calculer côté client via computeProportionalBudgetSnapshot puis POST.
      const allocation = computeProportionalBudgetSnapshot(deficitRemaining, budgets.map(b => ({ budgetId: b.budgetId, estimatedAmount: b.estimatedAmount, currentCarryoverSpent: 0 /* TODO: récupérer du fresh data */ })))
      const snapshotPayload: Record<string, number> = {}
      for (const item of allocation.perBudget) snapshotPayload[item.budgetId] = item.amount

      const res = await fetch('/api/monthly-recap/save-budget-snapshot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context, snapshot: snapshotPayload }),
      })
      if (!res.ok) throw new Error('save_snapshot_failed')
      return res.json()
    },
    onSuccess: ...,
  })

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4">
      <p className="mb-2 text-sm font-medium text-gray-900">Puiser dans les budgets existants</p>
      <Button className="mb-3 w-full" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        Puiser proportionnellement dans tous les budgets pour renflouer
      </Button>
      <p className="text-xs text-gray-600">Budgets actuels :</p>
      <ul className="space-y-1 text-xs text-gray-600">
        {budgets.map(b => (
          <li key={b.budgetId} className="flex justify-between">
            <span>{b.budgetName}</span>
            <span>{(b as any).carryover_spent_amount ?? 0}/{b.estimatedAmount}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

### `ContinueToSalaryUpdate` helper

```tsx
function ContinueToSalaryUpdate({ context, qc }: { context: 'profile'|'group', qc: QueryClient }) {
  // Avance step automatically via POST /advance-step (de la sous-tâche 11) OU mutation directe
  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/monthly-recap/advance-step', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context, targetStep: 'salary_update' }),
      })
      if (!res.ok) throw new Error('advance_failed')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monthly-recap','status',context] }),
  })
  return (
    <div className="text-center">
      <p className="mb-4 text-sm text-green-700">Le déficit est comblé.</p>
      <Button className="w-full" onClick={() => mutation.mutate()} disabled={mutation.isPending}>Continuer</Button>
    </div>
  )
}
```

## Étapes d'implémentation suggérées
1. **Étendre `useMonthlyRecap.ts`** : `useRefloatFromPiggy`, `useRefloatFromSavings`, `useSaveBudgetSnapshot` mutations factorisées.
2. **Créer les 3 line components** : RefloatPiggyLine, RefloatSavingsLine, RefloatBudgetSnapshotLine. Chacun gère son state interne (loading + error).
3. **Créer `BilanNegativeStep.tsx`** : header compteur déficit + 3 sections lignes + condition bascule positive + condition ContinueToSalaryUpdate.
4. **Passer le `recapState` en props** : le wizard (10) doit récupérer le `recap` object depuis le status response et le passer à BilanNegativeStep. Adapter le `useMonthlyRecap` hook pour exposer `recap` aussi.
5. **Calcul snapshot côté client** : utiliser `computeProportionalBudgetSnapshot` de [lib/recap/calculations.ts](../lib/recap/calculations.ts). Note : le `currentCarryoverSpent` doit être récupéré du summary (`budget.carryover_spent_amount` à ajouter dans `loadRecapSummary` de 05).
6. **Vérifier que summary expose `carryover_spent_amount`** : si non, étendre `loadRecapSummary` + types `BudgetSummary` pour l'inclure.
7. **Tests RTL** : ≥18 cas couvrant les 3 lignes + bascule + continue.
8. **Smoke manuel** : seed `deficit-cascade-full` → /monthly-recap → bilan négatif → refloat piggy partial → refloat savings full → snapshot last 300€ → deficit=0 → continue → step salary_update.
9. **Commit** : `feat(recap): screen 3B bilan negative with 3-line refloat cascade`.

## Critères d'acceptation
- [ ] `BilanNegativeStep.tsx` : header avec compteur déficit live + 3 sections lignes
- [ ] Ligne 1 piggy : disabled (just indicatif) si piggy=0, sinon affiche "Disponible / À utiliser" + bouton Renflouer
- [ ] Ligne 2 savings : disabled si total=0, sinon affiche total + liste par budget + bouton "Transférer économies"
- [ ] Ligne 3 snapshot : toujours actif, bouton "Puiser proportionnellement" + liste budgets format consommé/budgété
- [ ] Compteur déficit recalcule en temps réel après chaque mutation (fresh state via setQueryData)
- [ ] Bascule sur BilanPositiveStep si piggy seul > déficit (refloated_from_piggy > 0 AND deficitRemaining=0 AND surplus residuel piggy)
- [ ] "Continuer" affiché quand deficitRemaining=0 sans bascule
- [ ] Tests RTL ≥18 cas passants
- [ ] `pnpm typecheck` + `pnpm lint:check` exit 0
- [ ] Mobile viewport 430px clean (les 3 lignes scrollables verticalement OK)

## Tests à écrire

### `BilanNegativeStep.test.tsx`
- Render deficit=100, piggy=50, savings=200 → 3 lignes affichées, compteur 100€
- Render deficit=100, piggy=0 → ligne 1 disabled "Pas d'argent dans la tirelire"
- Render deficit=100, piggy=0, savings=0 → lignes 1+2 disabled, snapshot ligne active
- Mutation refloat piggy success → fresh state → compteur baisse → si=0 affiche "Continuer"
- Refloat piggy entirely covers deficit + surplus residuel → bascule sur BilanPositiveStep
- Error UX si mutation fail

### `RefloatPiggyLine.test.tsx`
- Render piggy=0 → ligne grisée "Pas d'argent"
- Render piggy=100, deficit=50 → "À utiliser : 50€"
- Render piggy=30, deficit=100 → "À utiliser : 30€" (clamp)
- Click → POST /refloat-from-piggy avec amount=30
- Loading state

### `RefloatSavingsLine.test.tsx`
- Render savings=0 → ligne grisée
- Render savings>0 → liste budgets affichée
- Click → POST /refloat-from-savings (no body other than context)
- Loading state

### `RefloatBudgetSnapshotLine.test.tsx`
- Render budgets list → format consommé/budgété
- Click → calcul snapshot client + POST /save-budget-snapshot
- Loading state
- Error → message

## Pièges et points d'attention
- **`recapState` doit venir du status endpoint** : étendre `loadRecapSummary` OU le status endpoint pour retourner aussi `recap` object (refloated_from_piggy, refloated_from_savings, budget_snapshot_data, id, current_step). Adapter `useMonthlyRecap` hook.
- **Compteur déficit live** : `computeDeficitRemaining` côté client (réutiliser depuis `lib/recap/actions-negative.ts` — ce module est pure, peut être importé côté client SI il n'importe pas supabaseServer. Vérifier en sous-tâche 07).
- **Bascule positive précise** : la condition est délicate. Si user refloate piggy partiellement (say 50€ sur 100€ piggy pour deficit 50€) → deficit=0 mais il reste 50€ en piggy. Spec dit "il reste X€ dans la tirelire" → afficher message + bascule positive avec piggy=50€ residual comme "surplus" pour le flow positif.
  - Mais le flow positif (4.A) opère sur **surplus budgets**, pas sur le residual piggy. Le residual piggy reste juste dans la piggy.
  - **Interprétation** : la bascule positive permet à l'utilisateur de transférer les surplus de budgets restants vers la piggy (qui contient déjà le residual). C'est une seconde phase optionnelle. **OK avec cette interprétation**, transmettre summary avec bilanSign='positive' calculé à partir des budget surpluses (pas du piggy residual).
- **Calcul snapshot côté client** : la `currentCarryoverSpent` du budget doit refléter l'état actuel POST-snapshot précédent (si user a déjà snapshot 50€ puis refait). Solution : `currentCarryoverSpent = budget.carryover_spent_amount ?? 0` (statique du summary) + `(snapshotData[budgetId] ?? 0)` (snapshot draft en cours).
- **Multiple snapshot calls** : la spec dit "snapshot calculé une fois et appliqué". Mais si user refait refloat-from-savings entre 2 snapshot calls, le déficit a changé. Idéalement : un seul snapshot call final. Ou laisser l'endpoint merge additivement (déjà géré en 07).
- **Format consommé/budgété** : "Machin → 33/400". Le 33 = `carryover_spent_amount` (déjà appliqué de mois précédent) + `0` (snapshot pas encore appliqué). Le 400 = `estimated_amount`. Pendant le recap, on affiche un PREVIEW : "Machin → 33 (existing) + 10 (snapshot) = 43/400". À simplifier ou détailler.
- **NOT mutation refresh deficit during action** : pendant que le user clique "Renflouer 50€", le compteur affiche encore 100€ jusqu'au success. Optionnellement optimistic update (set deficit -=50 immédiatement). KISS pour V1 : refresh post-success.

## Commandes utiles
```bash
pnpm test:run components/monthly-recap/__tests__/BilanNegativeStep components/monthly-recap/__tests__/RefloatPiggyLine components/monthly-recap/__tests__/RefloatSavingsLine components/monthly-recap/__tests__/RefloatBudgetSnapshotLine

# Smoke
pnpm dev → /dev/recap → seed deficit-cascade-full → /monthly-recap → flow négatif
```

## Definition of Done
- Tous les critères d'acceptation cochés
- 4 composants créés (BilanNegativeStep + 3 line components)
- Compteur déficit live OK
- Bascule positive testée + Continue testé
- ≥18 tests RTL passants
- Smoke : full cascade (piggy partial → savings full → snapshot last) → deficit=0
- Commit `feat(recap): screen 3B bilan negative with 3-line refloat cascade`
- `pnpm verify` exit 0
