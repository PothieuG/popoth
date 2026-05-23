'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  useTransferSurplusesToPiggy,
  useTransformRemainingSurplusesToSavings,
} from '@/hooks/useMonthlyRecap'
import { formatEuro } from '@/lib/format-currency'
import type { RecapContext, RecapSummary } from '@/lib/recap'

import { SurplusSelectionDrawer } from '../SurplusSelectionDrawer'

const ERROR_COPY: Record<string, string> = {
  invalid_step: "Cette étape n'est plus accessible. Recharge la page.",
  not_initiator: "Tu n'es pas l'initiateur du récap.",
  no_active_recap: 'Aucun récap actif. Recharge la page.',
  stale_step: "L'étape a évolué côté serveur. Rafraîchis.",
}

function pickErrorCopy(code: string): string {
  return ERROR_COPY[code] ?? 'Une erreur est survenue. Réessaie dans un instant.'
}

interface BilanPositiveStepProps {
  context: RecapContext
  summary: RecapSummary
}

/**
 * Sprint 12 — Écran 3A du wizard Monthly Recap V3 quand `bilanSign ∈
 * {'positive', 'zero'}`. UI sans state machine "Oui/Non" : le bouton
 * "Répartir un surplus vers la tirelire ?" est toujours présent tant qu'il
 * reste des surplus à distribuer, et un bouton "Continuer" en bas finalise
 * l'étape en transformant le reste en économies. Fermer le drawer (volontaire
 * ou par mégarde) ne perd plus l'accès au split — le bouton "Répartir" reste
 * visible pour rouvrir le drawer autant de fois que voulu (Sprint 12 follow-up
 * UX, 2026-05-24).
 *
 * - Tant que `hasSurplus` : section indicative (récap transformation) +
 *   bouton "Répartir" (ouvre `<SurplusSelectionDrawer>`) + bouton "Continuer"
 *   (appelle `/transform-remaining-surpluses-to-savings`, transforme tous les
 *   surplus restants en économies, le serveur fait avancer
 *   `current_step → 'salary_update'`).
 * - Quand tous les surplus ont été transférés (ou bilan = 0 sans surplus) :
 *   message "Aucun surplus à transformer." + bouton "Continuer" seul (l'appel
 *   transform est no-op safe côté serveur, sert juste à avancer le step).
 */
export function BilanPositiveStep({ context, summary }: BilanPositiveStepProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const transferMutation = useTransferSurplusesToPiggy(context)
  const transformMutation = useTransformRemainingSurplusesToSavings(context)

  const surplusBudgets = summary.budgets.filter((b) => b.surplus > 0)
  const hasSurplus = surplusBudgets.length > 0
  const isBusy = transferMutation.isPending || transformMutation.isPending

  const handleContinue = async () => {
    setError(null)
    try {
      await transformMutation.mutateAsync()
    } catch (e) {
      const code = e instanceof Error ? e.message : 'unknown'
      setError(pickErrorCopy(code))
    }
  }

  const handleTransferSelected = async (budgetIds: string[]) => {
    setError(null)
    try {
      await transferMutation.mutateAsync({ budgetIds })
    } catch (e) {
      const code = e instanceof Error ? e.message : 'unknown'
      setError(pickErrorCopy(code))
    } finally {
      // Always close the drawer — either the transfer succeeded (the user
      // picks the next action via the persistent "Répartir" / "Continuer"
      // buttons below) or it failed (the Radix dialog otherwise aria-hides
      // the error alert behind it).
      setDrawerOpen(false)
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Gestion du bilan positif</h1>

      {hasSurplus ? (
        <section className="rounded-2xl border border-green-200 bg-green-50 p-4">
          <p className="mb-3 text-xs font-medium tracking-wide text-green-700 uppercase">
            Économies après transformation
          </p>
          <ul className="space-y-2 text-sm text-gray-800">
            {surplusBudgets.map((b) => (
              <li key={b.budgetId} className="flex items-baseline justify-between gap-2">
                <span className="truncate">{b.budgetName}</span>
                <span className="flex shrink-0 items-baseline gap-1.5 tabular-nums">
                  <span className="text-gray-500">{formatEuro(b.cumulatedSavings)}</span>
                  <span aria-hidden="true" className="text-gray-400">
                    →
                  </span>
                  <span className="font-semibold text-green-700">
                    {formatEuro(b.cumulatedSavings + b.surplus)}
                  </span>
                  <span className="text-xs font-medium text-green-600">
                    (+{formatEuro(b.surplus)})
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-700">Aucun surplus à transformer.</p>
        </section>
      )}

      {hasSurplus && (
        <Button
          type="button"
          variant="secondary"
          className="w-full border border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100"
          onClick={() => setDrawerOpen(true)}
          disabled={isBusy}
        >
          Répartir un surplus vers la tirelire ?
        </Button>
      )}

      <Button type="button" className="w-full" onClick={handleContinue} disabled={isBusy}>
        {transformMutation.isPending ? 'Chargement…' : 'Continuer'}
      </Button>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      <SurplusSelectionDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        budgets={surplusBudgets}
        isSubmitting={transferMutation.isPending}
        onSubmit={handleTransferSelected}
      />
    </div>
  )
}
