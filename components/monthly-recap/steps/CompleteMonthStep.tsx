'use client'

import { useMemo, useState } from 'react'

import AddTransactionModal from '@/components/dashboard/AddTransactionModal'
import TransactionTabsComponent from '@/components/dashboard/TransactionTabsComponent'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useFinancialData } from '@/hooks/useFinancialData'
import { useAdvanceStep } from '@/hooks/useMonthlyRecap'
import type { DateRange } from '@/lib/finance/period'
import { formatEuro } from '@/lib/format-currency'
import type { RecapContext } from '@/lib/recap'
import { cn } from '@/lib/utils'

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

function amountColor(amount: number): string {
  if (amount > 0) return 'text-green-600'
  if (amount < 0) return 'text-red-600'
  return 'text-gray-500'
}

function amountBg(amount: number): string {
  if (amount > 0) return 'bg-green-50/50 border-green-200'
  if (amount < 0) return 'bg-red-50/50 border-red-200'
  return 'bg-gray-50/50 border-gray-200'
}

function amountIconBg(amount: number): string {
  if (amount > 0) return 'bg-green-600'
  if (amount < 0) return 'bg-red-600'
  return 'bg-gray-500'
}

interface BalanceRavCardsProps {
  availableBalance: number
  remainingToLive: number
  isFetching: boolean
}

// Mini-version des 2 premières cards de `FinancialIndicators` (Dashboard) —
// `FinancialIndicators` entier traîne Économies + Planification + drawers
// non pertinents pour le wizard.
function BalanceRavCards({ availableBalance, remainingToLive, isFetching }: BalanceRavCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div
        className={cn(
          'rounded-xl border p-2 shadow-xs transition-all duration-200',
          amountBg(availableBalance),
        )}
      >
        <div className="flex flex-col items-center space-y-1 text-center">
          <div
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
              amountIconBg(availableBalance),
            )}
          >
            <svg
              className="h-4 w-4 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
              />
            </svg>
          </div>
          <div className="w-full min-w-0">
            <p className="mb-1 text-xs font-medium text-gray-600">Solde Disponible</p>
            {isFetching ? (
              <Skeleton className="mx-auto h-6 w-20" />
            ) : (
              <p className={cn('truncate text-lg font-bold', amountColor(availableBalance))}>
                {formatEuro(availableBalance)}
              </p>
            )}
          </div>
        </div>
      </div>

      <div
        className={cn(
          'rounded-xl border p-2 shadow-xs transition-all duration-200',
          amountBg(remainingToLive),
        )}
      >
        <div className="flex flex-col items-center space-y-1 text-center">
          <div
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
              amountIconBg(remainingToLive),
            )}
          >
            <svg
              className="h-4 w-4 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
              />
            </svg>
          </div>
          <div className="w-full min-w-0">
            <p className="mb-1 text-xs font-medium text-gray-600">Reste à Vivre</p>
            {isFetching ? (
              <Skeleton className="mx-auto h-6 w-20" />
            ) : (
              <p className={cn('truncate text-lg font-bold', amountColor(remainingToLive))}>
                {formatEuro(remainingToLive)}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Étape 2/6 — corriger les transactions oubliées avant que SummaryStep ne
// calcule le bilan : sans ce gate, le RAV effectif et les ré-équilibrages
// `manage_bilan` seraient faussés.
export function CompleteMonthStep({ context, recapYear, recapMonth }: CompleteMonthStepProps) {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const advanceMutation = useAdvanceStep(context)
  const { financialData, isFetching } = useFinancialData(context)

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

      <BalanceRavCards
        availableBalance={financialData?.availableBalance ?? 0}
        remainingToLive={financialData?.remainingToLive ?? 0}
        isFetching={isFetching || !financialData}
      />

      <TransactionTabsComponent context={context} dateRange={dateRange} className="min-h-[280px]" />

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
