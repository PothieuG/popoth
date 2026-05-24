'use client'

import { Button } from '@/components/ui/button'
import { useRefloatFromSavings } from '@/hooks/useMonthlyRecap'
import { formatEuro } from '@/lib/format-currency'
import { computeProportionalSavingsRefloat } from '@/lib/recap/calculations'
import type { BudgetSummary, RecapContext } from '@/lib/recap'

/**
 * États possibles de la ligne dans la cascade séquentielle :
 *
 * - `locked` : la tirelire n'est pas encore vide. Carte greyed avec
 *   message d'attente.
 * - `active` : la tirelire est vide ET il reste des économies à drainer
 *   ET le déficit n'est pas comblé. Carte cliquable.
 * - `done`   : économies drainées pendant ce recap (refloatedFromSavings > 0
 *   ET totalSavings = 0). Carte greyed avec récap.
 * - `empty`  : aucune économie disponible depuis le départ. Carte greyed
 *   "Pas d'économies disponibles."
 */
type SavingsLineState = 'locked' | 'active' | 'done' | 'empty'

interface RefloatSavingsLineProps {
  context: RecapContext
  state: SavingsLineState
  /** Toujours passé même en état non-active — sert au rendu du récap "done". */
  totalSavings: number
  /** Filtré par l'orchestrateur sur `cumulatedSavings > 0`. Affiché en
   *  preview (état active) ou vide (autres états). */
  savingsByBudget: readonly BudgetSummary[]
  /** Compteur déficit live recalculé par l'orchestrateur. Utilisé pour la
   *  preview du transfert proportionnel. */
  deficitRemaining: number
  /** Cumulative debit du `monthly_recaps.refloated_from_savings` — utilisé
   *  pour labelliser `done` state. */
  refloatedFromSavings: number
  onError: (code: string) => void
  onSuccess: (message: string) => void
}

/**
 * Sprint 13 — BilanNegativeStep ligne 2 (cf. spec §4.B). Transfert
 * proportionnel des `cumulated_savings` de chaque budget vers le déficit
 * (2e étape de la cascade, après la tirelire).
 *
 * Theme **violet** (convention UI Popoth : économies + tirelire = même
 * famille violet, contrairement aux budgets = orange).
 *
 * État `active` :
 *   - Texte d'explication : "Les économies sont transférées proportionnellement…"
 *   - Liste budgets : "Courses : 75€ → 30€ (transfert 45€)" — preview de
 *     ce qui va se passer pour chaque budget si l'utilisateur clique.
 *   - Bouton "Transférer les économies"
 *
 * Sur succès, l'orchestrateur affiche la snackbar via `onSuccess(...)` puis
 * la carte rerend en `done` (carte greyed avec récap "XX€ transférés").
 */
export function RefloatSavingsLine({
  context,
  state,
  totalSavings,
  savingsByBudget,
  deficitRemaining,
  refloatedFromSavings,
  onError,
  onSuccess,
}: RefloatSavingsLineProps) {
  const mutation = useRefloatFromSavings(context)

  if (state === 'locked') {
    return (
      <section className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm font-medium text-gray-700">Économies des budgets</p>
        <p className="mt-1 text-xs text-gray-500">Disponible après avoir transféré la tirelire.</p>
      </section>
    )
  }

  if (state === 'empty') {
    return (
      <section className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm font-medium text-gray-700">Économies des budgets</p>
        <p className="mt-1 text-xs text-gray-500">Pas d&apos;économies disponibles.</p>
      </section>
    )
  }

  if (state === 'done') {
    return (
      <section className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm font-medium text-gray-700">Économies des budgets</p>
        <p className="mt-1 text-xs text-gray-600">
          {formatEuro(refloatedFromSavings)} d&apos;économies transférés vers le déficit.
        </p>
      </section>
    )
  }

  // active
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
    <section className="rounded-2xl border border-violet-200 bg-violet-50/40 p-4">
      <p className="text-sm font-medium text-violet-900">Économies des budgets</p>
      <p className="mt-2 text-xs leading-relaxed text-gray-600">
        Les économies de chaque budget sont transférées proportionnellement à leur taille pour
        combler le déficit. Effet immédiat sur les budgets.
      </p>
      <p className="mt-3 text-xs text-gray-700">
        Total disponible :{' '}
        <span className="font-semibold text-gray-900 tabular-nums">{formatEuro(totalSavings)}</span>
      </p>
      <ul className="mt-2 space-y-1 text-xs text-gray-700">
        {savingsByBudget.map((b) => {
          const debit = perBudgetDebit.get(b.budgetId) ?? 0
          const after = Math.max(0, b.cumulatedSavings - debit)
          return (
            <li key={b.budgetId} className="flex items-baseline justify-between gap-2">
              <span className="truncate">{b.budgetName}</span>
              <span className="flex shrink-0 items-baseline gap-1.5 tabular-nums">
                <span className="text-gray-500">{formatEuro(b.cumulatedSavings)}</span>
                <span aria-hidden="true" className="text-gray-400">
                  →
                </span>
                <span className="font-semibold text-violet-800">{formatEuro(after)}</span>
                <span className="text-[0.7rem] font-medium text-violet-700">
                  (−{formatEuro(debit)})
                </span>
              </span>
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
