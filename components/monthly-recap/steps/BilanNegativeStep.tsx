'use client'

import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useAdvanceStep, type RecapProgress } from '@/hooks/useMonthlyRecap'
import { formatEuro } from '@/lib/format-currency'
import { computeDeficitRemaining } from '@/lib/recap/deficit-math'
import type { RecapContext, RecapSummary } from '@/lib/recap'

import { RefloatBudgetSnapshotLine } from '../RefloatBudgetSnapshotLine'
import { RefloatPiggyLine } from '../RefloatPiggyLine'
import { RefloatSavingsLine } from '../RefloatSavingsLine'

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
 * Spec verbatim §4.B + UX overhaul 2026-05-24 (rounds 1-4).
 *
 *   1. **Cascade séquentielle** : 1 seule ligne active à la fois (la suivante
 *      est `locked` tant que la précédente n'est pas "done" — soit utilisée
 *      soit vide depuis le départ).
 *
 *   2. **Pas de page change** post-mutation : chaque hook (`useRefloatFromPiggy`
 *      / `useRefloatFromSavings` / `useSaveBudgetSnapshot`) update le cache
 *      via `setQueryData`. Les lignes rerend avec les valeurs fraîches
 *      (preview, totaux, deficit counter). Une snackbar de succès apparaît
 *      en bas pour confirmer l'action.
 *
 *   3. **Bouton "Continuer" en bas** quand le déficit est comblé. Le clic
 *      appelle `/advance-step` `manage_bilan → salary_update`. Si le snapshot
 *      a déjà auto-advance côté serveur, l'erreur `invalid_step` est swallow
 *      gracieusement (le wizard se réaligne via le refetch).
 *
 *   4. **Pas de bascule** vers `BilanPositiveStep` : tout est traité dans
 *      cet écran, y compris quand la tirelire seule couvre le déficit avec
 *      du residual. Le residual reste dans la tirelire et le user clique
 *      Continuer pour passer à salary_update.
 *
 *   5. **État `unneeded`** : quand le déficit est comblé par une étape
 *      antérieure de la cascade, les lignes suivantes (et même la tirelire
 *      si jamais elle est vide d'argent) passent en `unneeded` (greyed,
 *      "Pas nécessaire — déficit comblé") au lieu de `active` ou `locked`.
 *
 * Theme couleurs (cf. convention UI Popoth) :
 *   - tirelire = violet
 *   - économies = violet (même famille que la tirelire)
 *   - budgets   = orange (distinct)
 *   - deficit   = red (le compteur en haut)
 */
export function BilanNegativeStep({ context, summary, recap }: BilanNegativeStepProps) {
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const advanceMutation = useAdvanceStep(context)

  useEffect(() => {
    if (!successMessage) return
    const timer = setTimeout(() => setSuccessMessage(null), 3000)
    return () => clearTimeout(timer)
  }, [successMessage])

  const deficitRemaining = computeDeficitRemaining({
    initialBilan: summary.bilan,
    refloatedFromPiggy: recap.refloatedFromPiggy,
    refloatedFromSavings: recap.refloatedFromSavings,
    snapshotData: recap.snapshotData,
  })

  const handleError = (code: string) => {
    setError(pickErrorCopy(code))
    setSuccessMessage(null)
  }
  const handleSuccess = (message: string) => {
    setError(null)
    setSuccessMessage(message)
  }

  // --- Cascade gating ---------------------------------------------------
  // Une ligne est "done" soit parce qu'elle a été utilisée pendant ce
  // recap (refloated_* > 0 ou snapshot non vide), soit parce que la
  // ressource était vide depuis le départ. Une ligne est "active" si
  // la précédente est done ET la ressource a du carburant ET le déficit
  // n'est pas encore comblé. Sinon, `locked` (en attente) ou `unneeded`
  // (déficit déjà comblé, pas besoin).

  const deficitCovered = deficitRemaining <= 0.01
  const piggyEmpty = summary.piggyAmount <= 0.01
  const savingsEmpty = summary.totalSavings <= 0.01
  const snapshotData = recap.snapshotData
  const snapshotTotal = snapshotData ? Object.values(snapshotData).reduce((s, v) => s + v, 0) : 0

  // Ordre des conditions : done > empty > deficitCovered (unneeded) >
  // locked > active. Ainsi un déficit comblé en amont fait passer les lignes
  // suivantes directement en `unneeded` au lieu de `locked`.

  const piggyDone = recap.refloatedFromPiggy > 0
  const piggyState: 'active' | 'done' | 'empty' | 'unneeded' = piggyDone
    ? 'done'
    : piggyEmpty
      ? 'empty'
      : deficitCovered
        ? 'unneeded'
        : 'active'

  const piggyOutOfTheWay = piggyDone || piggyEmpty
  const savingsActuallyUsed = recap.refloatedFromSavings > 0
  const savingsState: 'locked' | 'active' | 'done' | 'empty' | 'unneeded' = savingsActuallyUsed
    ? 'done'
    : savingsEmpty
      ? 'empty'
      : deficitCovered
        ? 'unneeded'
        : !piggyOutOfTheWay
          ? 'locked'
          : 'active'

  const savingsOutOfTheWay = piggyOutOfTheWay && (savingsActuallyUsed || savingsEmpty)
  const snapshotState: 'locked' | 'active' | 'done' | 'unneeded' =
    snapshotTotal > 0
      ? 'done'
      : deficitCovered
        ? 'unneeded'
        : !savingsOutOfTheWay
          ? 'locked'
          : 'active'

  const showContinuer = deficitCovered

  const handleContinue = async () => {
    setError(null)
    try {
      await advanceMutation.mutateAsync({ fromStep: 'manage_bilan', toStep: 'salary_update' })
    } catch (e) {
      const code = e instanceof Error ? e.message : 'unknown'
      // Snapshot auto-advance côté serveur peut avoir déjà bougé le step
      // → le refetch de useAdvanceStep onError ramène l'état correct ;
      // on swallow gracieusement invalid_step / stale_step.
      if (code !== 'invalid_step' && code !== 'stale_step') {
        setError(pickErrorCopy(code))
      }
    }
  }

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
        state={piggyState}
        piggyAmount={summary.piggyAmount}
        deficitRemaining={deficitRemaining}
        refloatedFromPiggy={recap.refloatedFromPiggy}
        onError={handleError}
        onSuccess={handleSuccess}
      />

      <RefloatSavingsLine
        context={context}
        state={savingsState}
        totalSavings={summary.totalSavings}
        budgets={summary.budgets}
        deficitRemaining={deficitRemaining}
        refloatedFromSavings={recap.refloatedFromSavings}
        onError={handleError}
        onSuccess={handleSuccess}
      />

      <RefloatBudgetSnapshotLine
        context={context}
        state={snapshotState}
        budgets={summary.budgets}
        deficitRemaining={deficitRemaining}
        snapshotData={recap.snapshotData}
        onError={handleError}
        onSuccess={handleSuccess}
      />

      {showContinuer && (
        <Button
          type="button"
          className="w-full"
          onClick={handleContinue}
          disabled={advanceMutation.isPending}
        >
          {advanceMutation.isPending ? 'Chargement…' : 'Continuer'}
        </Button>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Snackbar succès — fixed bottom, slide-in, auto-dismiss 3s.
          z-[60] au-dessus du drawer (z-50). Pattern miroir
          `ProfileSettingsCard` (cf. CLAUDE.md operational-rules-ui-modals). */}
      {successMessage && (
        <div
          role="status"
          aria-live="polite"
          className="animate-in slide-in-from-bottom-4 fade-in fixed bottom-4 left-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-lg bg-green-600 px-4 py-3 text-sm font-medium text-white shadow-lg duration-300"
        >
          {successMessage}
        </div>
      )}
    </div>
  )
}
