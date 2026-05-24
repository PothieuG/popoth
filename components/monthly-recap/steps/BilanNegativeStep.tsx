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
 * Spec verbatim §4.B + UX overhaul 2026-05-24 :
 *
 *   1. **Cascade séquentielle** : 1 seule ligne active à la fois. La
 *      tirelire est la 1re ; les économies sont locked tant que la tirelire
 *      n'est pas vide ; le snapshot budgets est locked tant que les
 *      économies ne sont pas vidées.
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
 *      + on invalidate la query (le wizard rerend sur le step à jour).
 *
 *   4. **Bascule positive** : cas spécial où la tirelire seule a couvert le
 *      déficit ET il en reste dans la tirelire ET les économies n'ont pas
 *      été touchées. On rend `<BilanPositiveStep>` synthétiquement — le user
 *      peut alors enrichir la tirelire avec les surplus de budgets. Le
 *      `transformMutation` interne de BilanPositiveStep avance vers
 *      `salary_update` côté serveur.
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

  // Auto-dismiss the success snackbar 3s after it appears (cf. CLAUDE.md
  // operational-rules-ui-modals "feedback transient post-mutation").
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

  // --- Cascade gating ---------------------------------------------------
  // Piggy is always the 1st step ; savings unlocks when piggy is empty ;
  // snapshot unlocks when both piggy and savings are empty. Each line also
  // has a `done` state when its resource was used during this recap, and
  // an `empty` state when the resource was 0 from the start.

  const piggyEmpty = summary.piggyAmount <= 0
  const savingsEmpty = summary.totalSavings <= 0

  const piggyState: 'active' | 'done' | 'empty' =
    !piggyEmpty && deficitRemaining > 0.01
      ? 'active'
      : recap.refloatedFromPiggy > 0
        ? 'done'
        : 'empty'

  const savingsState: 'locked' | 'active' | 'done' | 'empty' = !piggyEmpty
    ? 'locked'
    : !savingsEmpty && deficitRemaining > 0.01
      ? 'active'
      : recap.refloatedFromSavings > 0
        ? 'done'
        : 'empty'

  const snapshotData = recap.snapshotData
  const snapshotTotal = snapshotData ? Object.values(snapshotData).reduce((s, v) => s + v, 0) : 0
  const snapshotState: 'locked' | 'active' | 'done' =
    !piggyEmpty || !savingsEmpty ? 'locked' : snapshotTotal > 0 ? 'done' : 'active'

  const showContinuer = deficitRemaining <= 0.01

  const handleContinue = async () => {
    setError(null)
    try {
      await advanceMutation.mutateAsync({ fromStep: 'manage_bilan', toStep: 'salary_update' })
    } catch (e) {
      const code = e instanceof Error ? e.message : 'unknown'
      // Snapshot auto-advance côté serveur a déjà bougé le step → le client
      // déclenche un refetch via invalidate (déjà fait dans useAdvanceStep
      // onError n'est pas un retry, mais la réception du fresh state aligne
      // le client). On surface quand même l'erreur si autre chose a foiré.
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
