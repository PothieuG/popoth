'use client'

import { Button } from '@/components/ui/button'
import { useSaveBudgetSnapshot } from '@/hooks/useMonthlyRecap'
import { formatEuro } from '@/lib/format-currency'
import { computeProportionalBudgetSnapshot } from '@/lib/recap/calculations'
import type { BudgetSummary, RecapContext } from '@/lib/recap'

/**
 * États possibles de la ligne dans la cascade séquentielle :
 *
 * - `locked` : la tirelire OU les économies des budgets ne sont pas encore
 *   épuisées. Carte greyed avec message d'attente.
 * - `active` : tout est épuisé en amont ET le déficit reste à combler.
 *   Carte cliquable avec preview du snapshot.
 * - `done`   : snapshot déjà persisté pendant ce recap (la map
 *   `snapshotData` est non vide). Carte greyed avec récap + liste des
 *   nouvelles valeurs par budget (carryover + snapshot / estimated).
 */
type SnapshotLineState = 'locked' | 'active' | 'done'

interface RefloatBudgetSnapshotLineProps {
  context: RecapContext
  state: SnapshotLineState
  budgets: readonly BudgetSummary[]
  deficitRemaining: number
  snapshotData: Record<string, number> | null
  onError: (code: string) => void
  onSuccess: (message: string) => void
}

/**
 * Sprint 13 — BilanNegativeStep ligne 3 (cf. spec §4.B). Équilibrage
 * proportionnel : combien retirer de chaque budget pour combler le déficit
 * (3e et dernière étape de la cascade, après tirelire + économies).
 *
 * Theme **orange** (convention UI Popoth : budgets = orange, distinct de
 * la famille violet tirelire/économies).
 *
 * État `active` :
 *   - Texte d'explication (effet différé à la finalisation).
 *   - Liste budgets : "Courses 33/400 → 53/400 (+20€)" — preview.
 *   - Bouton "Équilibrer".
 *
 * État `done` :
 *   - Phrase "X€ équilibrés depuis les budgets."
 *   - Liste de TOUS les budgets avec leurs nouvelles valeurs
 *     `consommé / estimé` (consommé = carryoverSpentAmount + snapshot).
 */
export function RefloatBudgetSnapshotLine({
  context,
  state,
  budgets,
  deficitRemaining,
  snapshotData,
  onError,
  onSuccess,
}: RefloatBudgetSnapshotLineProps) {
  const mutation = useSaveBudgetSnapshot(context)

  if (state === 'locked') {
    return (
      <section className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm font-medium text-gray-700">Équilibrer avec les budgets</p>
        <p className="mt-1 text-xs text-gray-500">
          Disponible après avoir épuisé la tirelire et les économies.
        </p>
      </section>
    )
  }

  if (state === 'done') {
    const totalEquilibre = snapshotData ? Object.values(snapshotData).reduce((s, v) => s + v, 0) : 0
    return (
      <section className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm font-medium text-gray-700">Équilibrer avec les budgets</p>
        <p className="mt-1 text-xs text-gray-600">
          {formatEuro(totalEquilibre)} équilibrés depuis les budgets (effectif à la finalisation du
          récap).
        </p>
        <p className="mt-3 text-xs text-gray-500">Nouvelles valeurs par budget :</p>
        <ul className="mt-1 space-y-1 text-xs text-gray-700">
          {budgets.map((b) => {
            const snapshotShare = snapshotData?.[b.budgetId] ?? 0
            const consumed = b.carryoverSpentAmount + snapshotShare
            return (
              <li key={b.budgetId} className="flex items-baseline justify-between gap-2">
                <span className="truncate">{b.budgetName}</span>
                <span className="shrink-0 tabular-nums">
                  {formatEuro(consumed)} / {formatEuro(b.estimatedAmount)}
                </span>
              </li>
            )
          })}
        </ul>
      </section>
    )
  }

  // active
  const previewAllocation = computeProportionalBudgetSnapshot(
    deficitRemaining,
    budgets.map((b) => ({ budgetId: b.budgetId, estimatedAmount: b.estimatedAmount })),
  )
  const previewByBudget = new Map(previewAllocation.perBudget.map((p) => [p.budgetId, p.amount]))

  const handleClick = async () => {
    try {
      const result = await mutation.mutateAsync()
      const totalEquilibre = Object.values(result.snapshot).reduce((s, v) => s + v, 0)
      onSuccess(`${formatEuro(totalEquilibre)} équilibrés depuis les budgets`)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'unknown')
    }
  }

  return (
    <section className="rounded-2xl border border-orange-200 bg-orange-50/40 p-4">
      <p className="text-sm font-medium text-orange-900">Équilibrer avec les budgets</p>
      <p className="mt-2 text-xs leading-relaxed text-gray-600">
        On retire le déficit restant proportionnellement à chaque budget (en fonction de leur
        taille). Les budgets ne seront effectivement débités qu&apos;à la finalisation du récap.
      </p>
      <ul className="mt-3 space-y-1 text-xs text-gray-700">
        {budgets.map((b) => {
          const previewDebit = previewByBudget.get(b.budgetId) ?? 0
          const consumedBefore = b.carryoverSpentAmount
          const consumedAfter = consumedBefore + previewDebit
          return (
            <li key={b.budgetId} className="flex items-baseline justify-between gap-2">
              <span className="truncate">{b.budgetName}</span>
              <span className="flex shrink-0 items-baseline gap-1.5 tabular-nums">
                <span className="text-gray-500">
                  {formatEuro(consumedBefore)} / {formatEuro(b.estimatedAmount)}
                </span>
                <span aria-hidden="true" className="text-gray-400">
                  →
                </span>
                <span className="font-semibold text-orange-800">
                  {formatEuro(consumedAfter)} / {formatEuro(b.estimatedAmount)}
                </span>
                <span className="text-[0.7rem] font-medium text-orange-700">
                  (+{formatEuro(previewDebit)})
                </span>
              </span>
            </li>
          )
        })}
      </ul>
      <Button
        type="button"
        variant="secondary"
        className="mt-3 w-full border border-orange-300 bg-orange-100 text-orange-900 hover:bg-orange-200"
        onClick={handleClick}
        disabled={mutation.isPending || budgets.length === 0}
      >
        {mutation.isPending ? 'Chargement…' : 'Équilibrer'}
      </Button>
    </section>
  )
}
