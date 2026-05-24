'use client'

import { Button } from '@/components/ui/button'
import { useSaveBudgetSnapshot } from '@/hooks/useMonthlyRecap'
import { formatEuro } from '@/lib/format-currency'
import type { BudgetSummary, RecapContext } from '@/lib/recap'

interface RefloatBudgetSnapshotLineProps {
  context: RecapContext
  budgets: readonly BudgetSummary[]
  /** Snapshot déjà persisté côté serveur (si déjà cliqué). Mergé dans le
   *  numérateur X de "Nom → X/Y" pour donner un preview avant clic / la
   *  valeur finale après. */
  snapshotData: Record<string, number> | null
  onError: (code: string) => void
}

/**
 * Sprint 13 — BilanNegativeStep ligne 3 (cf. spec §4.B). Snapshot
 * proportionnel : combien retirer de chaque budget pour combler le déficit.
 *
 * - Toujours active (pas de variante "grisée" : on peut toujours puiser
 *   tant qu'il y a des budgets).
 * - Bouton *"Puiser proportionnellement dans tous les budgets pour
 *   renflouer"* — le clic POST `/save-budget-snapshot` (sans body other
 *   than context, server-computed allocation). Le serveur OVERWRITES
 *   `budget_snapshot_data` JSONB et auto-advance `current_step` vers
 *   `'salary_update'` quand le nouveau déficit ≤ 0.01. Le wizard re-render
 *   automatiquement après `invalidateQueries` (`useSaveBudgetSnapshot`).
 * - Liste budgets en format `Nom → X/Y` où :
 *     X = `carryoverSpentAmount` (existant) + `snapshotData[budgetId]`
 *         (snapshot déjà persisté pendant ce recap, si présent)
 *     Y = `estimatedAmount`
 *   Le snapshot est différé (appliqué à finalize sprint 08) — on l'affiche
 *   en preview ici pour que l'utilisateur voie où ira l'argent.
 */
export function RefloatBudgetSnapshotLine({
  context,
  budgets,
  snapshotData,
  onError,
}: RefloatBudgetSnapshotLineProps) {
  const mutation = useSaveBudgetSnapshot(context)

  const handleClick = async () => {
    try {
      await mutation.mutateAsync()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'unknown')
    }
  }

  return (
    <section className="rounded-2xl border border-red-200 bg-white p-4">
      <p className="mb-2 text-sm font-medium text-gray-900">Puiser dans les budgets existants</p>
      <Button
        type="button"
        className="w-full"
        onClick={handleClick}
        disabled={mutation.isPending || budgets.length === 0}
      >
        {mutation.isPending
          ? 'Chargement…'
          : 'Puiser proportionnellement dans tous les budgets pour renflouer'}
      </Button>
      {budgets.length > 0 && (
        <>
          <p className="mt-3 text-xs text-gray-600">Budgets actuels :</p>
          <ul className="mt-1 space-y-1 text-xs text-gray-600">
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
        </>
      )}
    </section>
  )
}
