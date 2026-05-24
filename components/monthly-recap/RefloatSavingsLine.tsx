'use client'

import { Button } from '@/components/ui/button'
import { useRefloatFromSavings } from '@/hooks/useMonthlyRecap'
import { formatEuro } from '@/lib/format-currency'
import { computeProportionalSavingsRefloat } from '@/lib/recap/calculations'
import type { BudgetSummary, RecapContext } from '@/lib/recap'

/**
 * État de la ligne dans la cascade séquentielle :
 *
 * - `locked`   : la tirelire n'est pas encore vide. En attente.
 * - `active`   : tirelire vide + économies à drainer + déficit non comblé.
 * - `done`     : économies drainées pendant ce recap. Récap + liste des
 *   nouvelles valeurs par budget.
 * - `empty`    : pas d'économies dès le départ.
 * - `unneeded` : économies disponibles mais déficit déjà comblé par la
 *   tirelire.
 */
type SavingsLineState = 'locked' | 'active' | 'done' | 'empty' | 'unneeded'

interface RefloatSavingsLineProps {
  context: RecapContext
  state: SavingsLineState
  totalSavings: number
  /** Tous les budgets du contexte (l'orchestrateur ne filtre pas, la ligne
   *  filtre en interne selon l'état). */
  budgets: readonly BudgetSummary[]
  deficitRemaining: number
  refloatedFromSavings: number
  onError: (code: string) => void
  onSuccess: (message: string) => void
}

/**
 * Sprint 13 — BilanNegativeStep ligne 2. Transfert proportionnel des
 * économies cumulées de chaque budget vers le déficit.
 *
 * Theme **violet** (convention UI Popoth : économies = violet, même
 * famille que la tirelire).
 *
 * Layout active : liste 2-lignes par budget (nom + delta sur ligne 1,
 * before → after sur ligne 2) — évite la troncature sur mobile.
 */
export function RefloatSavingsLine({
  context,
  state,
  totalSavings,
  budgets,
  deficitRemaining,
  refloatedFromSavings,
  onError,
  onSuccess,
}: RefloatSavingsLineProps) {
  const mutation = useRefloatFromSavings(context)

  if (state === 'locked') {
    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-sm font-medium text-gray-700">Économies des budgets</p>
        <p className="mt-1 text-xs text-gray-500">Disponible après avoir transféré la tirelire.</p>
      </section>
    )
  }

  if (state === 'empty') {
    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-sm font-medium text-gray-700">Économies des budgets</p>
        <p className="mt-1 text-xs text-gray-500">Pas d&apos;économies disponibles.</p>
      </section>
    )
  }

  if (state === 'unneeded') {
    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-sm font-medium text-gray-700">Économies des budgets</p>
        <p className="mt-1 text-xs text-gray-500">Pas nécessaire — le déficit est déjà comblé.</p>
      </section>
    )
  }

  if (state === 'done') {
    return (
      <section className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
        <p className="text-sm font-medium text-violet-900">Économies des budgets</p>
        <p className="mt-2 text-xs text-gray-700">
          <span className="font-semibold tabular-nums">{formatEuro(refloatedFromSavings)}</span>{' '}
          d&apos;économies transférés vers le déficit.
        </p>
        <p className="mt-3 text-xs text-gray-500">Nouvelles valeurs par budget :</p>
        <ul className="mt-1 space-y-1 text-xs text-gray-700">
          {budgets.map((b) => (
            <li key={b.budgetId} className="flex items-baseline justify-between gap-2">
              <span className="truncate">{b.budgetName}</span>
              <span className="shrink-0 font-medium text-violet-800 tabular-nums">
                {formatEuro(b.cumulatedSavings)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    )
  }

  // active — filter to budgets that have savings to drain
  const savingsByBudget = budgets.filter((b) => b.cumulatedSavings > 0)
  const allocation = computeProportionalSavingsRefloat(
    deficitRemaining,
    savingsByBudget.map((b) => ({ budgetId: b.budgetId, cumulatedSavings: b.cumulatedSavings })),
  )
  const perBudgetDebit = new Map(allocation.perBudget.map((p) => [p.budgetId, p.amount]))

  const handleClick = async () => {
    try {
      const result = await mutation.mutateAsync()
      onSuccess(
        `${formatEuro(result.refloatedFromSavings - refloatedFromSavings)} d'économies transférées`,
      )
    } catch (e) {
      onError(e instanceof Error ? e.message : 'unknown')
    }
  }

  return (
    <section className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
      <p className="text-sm font-medium text-violet-900">Économies des budgets</p>
      <p className="mt-2 text-xs leading-relaxed text-gray-700">
        Les économies de chaque budget sont transférées proportionnellement à leur taille pour
        combler le déficit. Effet immédiat sur les budgets.
      </p>
      <p className="mt-3 text-xs text-gray-700">
        Total disponible :{' '}
        <span className="font-semibold text-gray-900 tabular-nums">{formatEuro(totalSavings)}</span>
      </p>
      <ul className="mt-2 space-y-2 text-xs text-gray-700">
        {savingsByBudget.map((b) => {
          const debit = perBudgetDebit.get(b.budgetId) ?? 0
          const after = Math.max(0, b.cumulatedSavings - debit)
          return (
            <li key={b.budgetId} className="space-y-0.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate">{b.budgetName}</span>
                <span className="shrink-0 font-medium text-violet-700 tabular-nums">
                  −{formatEuro(debit)}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5 text-gray-500 tabular-nums">
                <span>{formatEuro(b.cumulatedSavings)}</span>
                <span aria-hidden="true" className="text-gray-400">
                  →
                </span>
                <span className="font-semibold text-violet-800">{formatEuro(after)}</span>
              </div>
            </li>
          )
        })}
      </ul>
      <Button
        type="button"
        variant="secondary"
        className="mt-3 w-full border border-violet-300 bg-violet-100 text-violet-900 hover:bg-violet-200"
        onClick={handleClick}
        disabled={mutation.isPending}
      >
        {mutation.isPending ? 'Chargement…' : 'Transférer les économies'}
      </Button>
    </section>
  )
}
