'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { useAdvanceStep, type RecapProgress } from '@/hooks/useMonthlyRecap'
import { formatEuro } from '@/lib/format-currency'
import { computeDeficitRemaining, type RecapContext, type RecapSummary } from '@/lib/recap'

import { RefloatBudgetSnapshotLine } from '../RefloatBudgetSnapshotLine'
import { RefloatPiggyLine } from '../RefloatPiggyLine'
import { RefloatSavingsLine } from '../RefloatSavingsLine'

import { BilanPositiveStep } from './BilanPositiveStep'

const ERROR_COPY: Record<string, string> = {
  invalid_step: "Cette étape n'est plus accessible. Recharge la page.",
  not_initiator: "Tu n'es pas l'initiateur du récap.",
  no_active_recap: 'Aucun récap actif. Recharge la page.',
  no_deficit: "Plus de déficit à combler. L'écran va s'actualiser.",
  overflow: 'Le montant dépasse le déficit restant.',
  piggy_insufficient: "La tirelire n'a pas ce montant disponible.",
  stale_step: "L'étape a évolué côté serveur. Rafraîchis.",
}

function pickErrorCopy(code: string): string {
  return ERROR_COPY[code] ?? 'Une erreur est survenue. Réessaie dans un instant.'
}

interface BilanNegativeStepProps {
  context: RecapContext
  summary: RecapSummary
  recap: RecapProgress
}

/**
 * Sprint 13 — Écran 3B du wizard Monthly Recap V3 quand `bilanSign === 'negative'`.
 * Spec verbatim §4.B : compteur "Montant à renflouer" + 3 lignes de cascade
 * (tirelire → économies des budgets → puisage proportionnel snapshot).
 *
 * Le compteur déficit est recalculé live à chaque render à partir des
 * trackers persistés `recap.refloatedFromPiggy/Savings/snapshotData` —
 * garantit la cohérence à chaque re-entrée (cf. memory `feedback_recap_exact_reentry`).
 *
 * Cas spéciaux :
 *
 * - **Bascule positive** : si la tirelire seule a couvert tout le déficit
 *   ET qu'il reste de la tirelire ET les économies n'ont pas été touchées,
 *   on rend dynamiquement `<BilanPositiveStep>` (spec §4.B ligne 1 "il
 *   reste X€ dans la tirelire → bascule sur le flow positif"). Le step
 *   serveur reste `manage_bilan` ; c'est `BilanPositiveStep` qui appelle
 *   `transformMutation` au "Continuer" pour avancer vers `salary_update`
 *   (no-op safe quand il n'y a pas de surplus à transformer).
 *
 * - **Deficit comblé sans bascule** (déficit = 0 mais piggy résidual = 0
 *   ou refloated_from_savings > 0) : on affiche un message succès + bouton
 *   "Continuer" qui appelle `/advance-step` `manage_bilan → salary_update`.
 *   Le `save-budget-snapshot` endpoint auto-avance déjà server-side quand
 *   le snapshot couvre le reliquat, donc ce bouton sert au cas piggy +
 *   savings = deficit (sans snapshot).
 *
 * - **Cas nominal** : header + 3 sections (piggy, savings, snapshot), chacune
 *   gérant son état actif/grisé en fonction des montants disponibles.
 */
export function BilanNegativeStep({ context, summary, recap }: BilanNegativeStepProps) {
  const [error, setError] = useState<string | null>(null)
  const advanceMutation = useAdvanceStep(context)

  const deficitRemaining = computeDeficitRemaining({
    initialBilan: summary.bilan,
    refloatedFromPiggy: recap.refloatedFromPiggy,
    refloatedFromSavings: recap.refloatedFromSavings,
    snapshotData: recap.snapshotData,
  })

  const handleError = (code: string) => setError(pickErrorCopy(code))

  // Bascule positive : la tirelire seule a couvert tout le déficit ET il
  // reste de la tirelire à distribuer ET on n'a pas déjà puisé dans les
  // économies (sinon ce n'est plus "piggy seule"). Le rendu synthétique
  // de `<BilanPositiveStep>` donne accès à la sous-UI positive (transferts
  // surplus → tirelire) puis advance vers salary_update via son propre
  // bouton "Continuer".
  const piggyOnlyCoveredDeficit =
    deficitRemaining <= 0.01 && recap.refloatedFromSavings === 0 && summary.piggyAmount > 0.01
  if (piggyOnlyCoveredDeficit) {
    return <BilanPositiveStep context={context} summary={{ ...summary, bilanSign: 'positive' }} />
  }

  if (deficitRemaining <= 0.01) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-gray-900">Gestion du déficit</h1>
        <section className="rounded-2xl border border-green-200 bg-green-50 p-4">
          <p className="text-sm text-green-800">Le déficit est comblé.</p>
        </section>
        <Button
          type="button"
          className="w-full"
          onClick={async () => {
            setError(null)
            try {
              await advanceMutation.mutateAsync({
                fromStep: 'manage_bilan',
                toStep: 'salary_update',
              })
            } catch (e) {
              handleError(e instanceof Error ? e.message : 'unknown')
            }
          }}
          disabled={advanceMutation.isPending}
        >
          {advanceMutation.isPending ? 'Chargement…' : 'Continuer'}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    )
  }

  const savingsByBudget = summary.budgets.filter((b) => b.cumulatedSavings > 0)

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-gray-900">Gestion du déficit</h1>
        <p className="mt-1 text-sm text-gray-600">Montant à renflouer :</p>
        <p className="text-3xl font-bold text-red-700 tabular-nums">
          {formatEuro(deficitRemaining)}
        </p>
      </header>

      <RefloatPiggyLine
        context={context}
        piggyAmount={summary.piggyAmount}
        deficitRemaining={deficitRemaining}
        onError={handleError}
      />

      <RefloatSavingsLine
        context={context}
        totalSavings={summary.totalSavings}
        savingsByBudget={savingsByBudget}
        onError={handleError}
      />

      <RefloatBudgetSnapshotLine
        context={context}
        budgets={summary.budgets}
        snapshotData={recap.snapshotData}
        onError={handleError}
      />

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
