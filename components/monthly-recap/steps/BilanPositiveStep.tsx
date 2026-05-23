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
 * {'positive', 'zero'}`. Trois états logiques :
 *
 * - `decided === null` : le user n'a pas encore tranché.
 *   - Si `hasSurplus` → section indicative + question Oui/Non.
 *   - Sinon → "Aucun surplus" + bouton Continuer direct (cas bilan = 0).
 *
 * - `decided === 'no'` : un seul bouton "Transformer tous les surplus en
 *   économies" qui appelle `/transform-remaining-surpluses-to-savings`. Le
 *   serveur fait avancer `current_step → salary_update` lui-même.
 *
 * - `decided === 'yes'` : ouvre `<SurplusSelectionDrawer>` pour choisir
 *   manuellement quels surplus passent dans la tirelire. Après le transfert :
 *   - S'il reste des surplus → bouton "Transformer les surplus restants en
 *     économies" + petit lien "Sélectionner d'autres surplus" pour rouvrir le
 *     drawer.
 *   - Sinon → "Plus de surplus disponible" + bouton "Continuer" (idem appel
 *     `/transform`, no-op safe + advance step).
 */
export function BilanPositiveStep({ context, summary }: BilanPositiveStepProps) {
  const [decided, setDecided] = useState<'yes' | 'no' | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const transferMutation = useTransferSurplusesToPiggy(context)
  const transformMutation = useTransformRemainingSurplusesToSavings(context)

  const surplusBudgets = summary.budgets.filter((b) => b.surplus > 0)
  const hasSurplus = surplusBudgets.length > 0

  const handleTransformAll = async () => {
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
      // Always close the drawer — either the transfer succeeded (caller picks
      // the next action) or it failed (the user must see the alert, which the
      // Radix dialog hides behind aria-hidden on siblings). The selection is
      // lost on retry but the user can re-open via "Oui" or "Sélectionner
      // d'autres surplus".
      setDrawerOpen(false)
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Gestion du bilan positif</h1>

      {hasSurplus && (
        <section className="rounded-2xl border border-green-200 bg-green-50 p-4">
          <p className="mb-2 text-xs font-medium tracking-wide text-green-700 uppercase">
            Transformation surplus → économies
          </p>
          <ul className="space-y-1.5 text-sm text-gray-800">
            {surplusBudgets.map((b) => (
              <li key={b.budgetId} className="flex items-baseline justify-between gap-3">
                <span className="truncate">{b.budgetName}</span>
                <span className="shrink-0 font-medium text-green-700">
                  {formatEuro(b.cumulatedSavings + b.surplus)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-green-800/80">
            Total des économies de chaque budget après transformation.
          </p>
        </section>
      )}

      {!hasSurplus && (
        <section className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-700">Aucun surplus à transformer ce mois-ci.</p>
        </section>
      )}

      {hasSurplus && decided === null && (
        <section className="space-y-3">
          <p className="text-sm font-medium text-gray-900">
            Voulez-vous ajouter un ou plusieurs surplus à la tirelire ?
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={() => setDecided('no')}
            >
              Non
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={() => {
                setDecided('yes')
                setDrawerOpen(true)
              }}
            >
              Oui
            </Button>
          </div>
        </section>
      )}

      {hasSurplus && decided === 'no' && (
        <Button
          type="button"
          className="w-full"
          onClick={handleTransformAll}
          disabled={transformMutation.isPending}
        >
          {transformMutation.isPending
            ? 'Transformation…'
            : 'Transformer tous les surplus en économies'}
        </Button>
      )}

      {hasSurplus && decided === 'yes' && !drawerOpen && (
        <div className="space-y-2">
          <Button
            type="button"
            className="w-full"
            onClick={handleTransformAll}
            disabled={transformMutation.isPending}
          >
            {transformMutation.isPending
              ? 'Transformation…'
              : 'Transformer les surplus restants en économies'}
          </Button>
          <Button
            type="button"
            variant="link"
            className="h-auto w-full justify-center px-1 py-0 text-sm text-orange-700"
            onClick={() => setDrawerOpen(true)}
          >
            Sélectionner d&apos;autres surplus
          </Button>
        </div>
      )}

      {!hasSurplus && decided === 'yes' && (
        <div className="space-y-2">
          <p className="text-sm text-gray-700">Plus de surplus disponible.</p>
          <Button
            type="button"
            className="w-full"
            onClick={handleTransformAll}
            disabled={transformMutation.isPending}
          >
            {transformMutation.isPending ? 'Chargement…' : 'Continuer'}
          </Button>
        </div>
      )}

      {!hasSurplus && decided === null && (
        <Button
          type="button"
          className="w-full"
          onClick={handleTransformAll}
          disabled={transformMutation.isPending}
        >
          {transformMutation.isPending ? 'Chargement…' : 'Continuer'}
        </Button>
      )}

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
