'use client'

import { Button } from '@/components/ui/button'
import { useRefloatFromSavings } from '@/hooks/useMonthlyRecap'
import { formatEuro } from '@/lib/format-currency'
import type { BudgetSummary, RecapContext } from '@/lib/recap'

interface RefloatSavingsLineProps {
  context: RecapContext
  totalSavings: number
  /** Budgets ayant `cumulatedSavings > 0`, déjà filtrés par l'orchestrateur. */
  savingsByBudget: readonly BudgetSummary[]
  onError: (code: string) => void
}

/**
 * Sprint 13 — BilanNegativeStep ligne 2 (cf. spec §4.B). Transfert
 * proportionnel des `cumulated_savings` de chaque budget vers le déficit.
 *
 * - Si `totalSavings === 0` : section grise indicative *"Pas d'économies
 *   disponibles."* Aucun bouton.
 * - Sinon : carte rouge avec total + liste des budgets ayant des économies
 *   + bouton *"Transférer mes économies dans le déficit"*. Le clic POST
 *   `/refloat-from-savings` (sans body other than context, server-computed
 *   allocation). Le cache se met à jour via `setQueryData`.
 *
 * Note : si une debit per-budget échoue côté serveur, le payload contient
 * `failed[]` (cf. `RefloatFromSavingsResult`). V1 = ignore failed list,
 * affiche juste l'erreur si la mutation entière throw. Future enrichissement
 * possible : afficher "X€ transferred (Y€ failed)" snackbar.
 */
export function RefloatSavingsLine({
  context,
  totalSavings,
  savingsByBudget,
  onError,
}: RefloatSavingsLineProps) {
  const mutation = useRefloatFromSavings(context)

  if (totalSavings <= 0) {
    return (
      <section className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm font-medium text-gray-700">Économies des budgets</p>
        <p className="mt-1 text-sm text-gray-500">Pas d&apos;économies disponibles.</p>
      </section>
    )
  }

  const handleClick = async () => {
    try {
      await mutation.mutateAsync()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'unknown')
    }
  }

  return (
    <section className="rounded-2xl border border-red-200 bg-white p-4">
      <p className="mb-2 text-sm font-medium text-gray-900">Économies des budgets</p>
      <p className="text-xs text-gray-600">
        Total disponible :{' '}
        <span className="font-semibold text-gray-900 tabular-nums">{formatEuro(totalSavings)}</span>
      </p>
      <ul className="mt-2 space-y-1 text-xs text-gray-600">
        {savingsByBudget.map((b) => (
          <li key={b.budgetId} className="flex items-baseline justify-between gap-2">
            <span className="truncate">{b.budgetName}</span>
            <span className="shrink-0 tabular-nums">{formatEuro(b.cumulatedSavings)}</span>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        className="mt-3 w-full"
        onClick={handleClick}
        disabled={mutation.isPending}
      >
        {mutation.isPending ? 'Chargement…' : 'Transférer mes économies dans le déficit'}
      </Button>
    </section>
  )
}
