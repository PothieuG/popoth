'use client'

import { useMemo, useState } from 'react'

import AddTransactionModal from '@/components/dashboard/AddTransactionModal'
import TransactionTabsComponent from '@/components/dashboard/TransactionTabsComponent'
import { Button } from '@/components/ui/button'
import { useAdvanceStep } from '@/hooks/useMonthlyRecap'
import type { DateRange } from '@/lib/finance/period'
import type { RecapContext } from '@/lib/recap'

const ADVANCE_ERROR_COPY: Record<string, string> = {
  not_initiator: "Tu n'es pas l'initiateur du récap. Recharge la page.",
  invalid_transition: "Cette transition n'est pas autorisée. Recharge.",
  stale_step: "L'étape a évolué côté serveur. Rafraîchis.",
  no_active_recap: 'Aucun récap actif. Recharge la page.',
}

interface CompleteMonthStepProps {
  context: RecapContext
  /** Année du mois recapé (server-side `currentYear` de `checkRecapStatus`). */
  recapYear: number
  /** Mois recapé 1-12 (server-side `currentMonth` de `checkRecapStatus`). */
  recapMonth: number
}

/**
 * Sprint Complete-Month-Step (2026-05-29). Étape 2/6 du wizard récap mensuel.
 *
 * Insérée entre `WelcomeStep` (étape 1) et `SummaryStep` (étape 3). Permet à
 * l'utilisateur d'ajouter des dépenses ou revenus oubliés du mois recapé
 * avant que le bilan général soit affiché — sans cela, le calcul de RAV
 * effectif et de bilan serait basé sur des chiffres incomplets et les
 * ré-équilibrages tirelire/économies de l'étape `manage_bilan` seraient
 * faussés.
 *
 * Layout (mobile-first, ≤ 430 px) :
 *   1. Titre "Compléter le mois" (cohérent avec frieze).
 *   2. Phrase d'explication.
 *   3. Bouton "Ajouter une transaction" → ouvre `AddTransactionModal` avec
 *      `defaultDate` au dernier jour du mois recapé + bornes `dateMin/dateMax`
 *      qui contraignent le date picker natif.
 *   4. `TransactionTabsComponent` en mode `readOnly` (pas de kebab, pas de
 *      long-press, pas de tap) filtré par `recapMonthRange`. Réutilisation
 *      1:1 du composant Dashboard (sprint user explicite : "ne réutiliser
 *      que cette partie").
 *   5. Bouton "Continuer" → advance `complete_month → summary`. Géré 'stale_step'
 *      silencieusement (l'invalidation du cache fait re-router le wizard).
 *
 * Toujours possible de continuer même avec une liste vide (cas nominal :
 * l'utilisateur n'a rien à corriger).
 */
export function CompleteMonthStep({ context, recapYear, recapMonth }: CompleteMonthStepProps) {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const advanceMutation = useAdvanceStep(context)

  // Bornes ISO YYYY-MM-DD inclusives du mois recapé. `Date(year, month, 0)` =
  // dernier jour du mois précédent (paramètre `month` 0-indexed) — comme
  // `recapMonth` est 1-indexé, passer `recapMonth` directement donne le
  // dernier jour de `recapMonth`. Helper pur (inputs primitifs → output ISO).
  const { startDate, endDate, dateRange } = useMemo(() => {
    const mm = String(recapMonth).padStart(2, '0')
    const lastDay = new Date(recapYear, recapMonth, 0).getDate()
    const dd = String(lastDay).padStart(2, '0')
    const start = `${recapYear}-${mm}-01`
    const end = `${recapYear}-${mm}-${dd}`
    const range: DateRange = { startDate: start, endDate: end }
    return { startDate: start, endDate: end, dateRange: range }
  }, [recapYear, recapMonth])

  const handleNext = async () => {
    setError(null)
    try {
      await advanceMutation.mutateAsync({ fromStep: 'complete_month', toStep: 'summary' })
    } catch (e) {
      const code = e instanceof Error ? e.message : 'unknown'
      // stale_step / invalid_step → invalidation déjà déclenchée par le hook,
      // le wizard se re-route au refetch suivant ; on n'affiche pas l'erreur.
      if (code === 'stale_step' || code === 'invalid_step') return
      setError(ADVANCE_ERROR_COPY[code] ?? "Impossible de passer à l'étape suivante.")
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Compléter le mois</h1>

      <p className="text-sm text-gray-700">
        Avant de continuer, vérifie qu&apos;il ne te manque pas une dépense ou un revenu du mois
        écoulé. Tout ajout sera enregistré dans le mois recapé et inclus dans le bilan général.
      </p>

      <Button
        type="button"
        onClick={() => setIsAddModalOpen(true)}
        className="w-full"
        variant="default"
      >
        <svg
          className="mr-2 h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
        </svg>
        Ajouter une transaction
      </Button>

      <TransactionTabsComponent
        context={context}
        dateRange={dateRange}
        readOnly
        className="min-h-[280px]"
      />

      <Button
        onClick={handleNext}
        disabled={advanceMutation.isPending}
        className="w-full"
        variant="default"
      >
        {advanceMutation.isPending ? 'Chargement…' : 'Continuer'}
      </Button>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      {isAddModalOpen && (
        <AddTransactionModal
          isOpen
          onClose={() => setIsAddModalOpen(false)}
          context={context}
          defaultDate={endDate}
          dateMin={startDate}
          dateMax={endDate}
          onTransactionAdded={() => setIsAddModalOpen(false)}
        />
      )}
    </div>
  )
}
