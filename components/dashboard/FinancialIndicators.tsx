'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import SavingsDrawer from './SavingsDrawer'
import { useNotes } from '@/hooks/useNotes'
import type { ReadOnlyIncome } from '@/lib/finance'

const PlanningDrawer = dynamic(() => import('./PlanningDrawer'), { ssr: false })
const NotesDrawer = dynamic(() => import('./NotesDrawer'), { ssr: false })

interface FinancialIndicatorsProps {
  availableBalance: number
  remainingToLive: number
  totalSavings: number
  className?: string
  onPlanningChange?: () => Promise<void>
  context?: 'profile' | 'group'
  /**
   * True dès qu'un fetch (initial ou refetch background post-mutation/switch
   * de contexte) est en cours. Quand true, les 3 montants sont remplacés par
   * des `<Skeleton>` aux mêmes dimensions. Les icônes/labels restent visibles
   * pour préserver le squelette structurel.
   */
  isFetching?: boolean
  /**
   * Sprint 16 V3 — lignes virtuelles read-only à afficher en tête du drawer
   * Planification (salaire perso, contribution groupe). Forward direct ;
   * source backend `FinancialData.meta.readOnlyIncomes`.
   */
  readOnlyIncomes?: ReadOnlyIncome[]
}

/**
 * Component displaying two main financial indicators on the dashboard:
 * - Available Balance (visible money in bank account)
 * - Remaining to Live (money left after budget and exceptional expenses)
 */
export default function FinancialIndicators({
  availableBalance,
  remainingToLive,
  totalSavings,
  className,
  onPlanningChange,
  context,
  isFetching = false,
  readOnlyIncomes,
}: FinancialIndicatorsProps) {
  const [isPlanningOpen, setIsPlanningOpen] = useState(false)
  const [isSavingsOpen, setIsSavingsOpen] = useState(false)
  const [isNotesOpen, setIsNotesOpen] = useState(false)
  const notesContext = context ?? 'profile'
  // Compteur de la demi-ligne Notes — même query que le drawer (dédoublonnée).
  // Courses cochées exclues : le chiffre baisse au fil des courses.
  const { pendingCount: notesCount } = useNotes(notesContext)

  /**
   * Get color class based on amount value
   * Positive: green, Negative: red, Zero: gray
   */
  const getAmountColorClass = (amount: number): string => {
    if (amount > 0) return 'text-green-600'
    if (amount < 0) return 'text-red-600'
    return 'text-gray-500'
  }

  /**
   * Get background color class based on amount value
   * Positive: subtle green, Negative: subtle red, Zero: subtle gray with subtle borders
   */
  const getBackgroundColorClass = (amount: number): string => {
    if (amount > 0) return 'bg-green-50/50 border-green-200'
    if (amount < 0) return 'bg-red-50/50 border-red-200'
    return 'bg-gray-50/50 border-gray-200'
  }

  /**
   * Format amount to display with euro symbol and proper decimals
   */
  const formatAmount = (amount: number): string => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
    }).format(amount)
  }

  return (
    <div className={cn('space-y-2', className)}>
      {/* Main Financial Indicators */}
      <div className="grid grid-cols-2 gap-2">
        {/* Available Balance Card */}
        <div
          className={cn(
            'rounded-xl border p-2 shadow-xs transition-all duration-200',
            getBackgroundColorClass(availableBalance),
          )}
        >
          <div className="flex flex-col items-center space-y-1 text-center">
            {/* Bank Account Icon */}
            <div className="shrink-0">
              <div
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full',
                  availableBalance > 0
                    ? 'bg-green-600'
                    : availableBalance < 0
                      ? 'bg-red-600'
                      : 'bg-gray-500',
                )}
              >
                <svg
                  className="h-4 w-4 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                  />
                </svg>
              </div>
            </div>

            {/* Content */}
            <div className="w-full min-w-0">
              <p className="mb-1 text-xs font-medium text-gray-600">Solde Disponible</p>
              {isFetching ? (
                <Skeleton className="mx-auto h-6 w-20" />
              ) : (
                <p
                  className={cn(
                    'truncate text-lg font-bold',
                    getAmountColorClass(availableBalance),
                  )}
                >
                  {formatAmount(availableBalance)}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Remaining to Live Card */}
        <div
          className={cn(
            'rounded-xl border p-2 shadow-xs transition-all duration-200',
            getBackgroundColorClass(remainingToLive),
          )}
        >
          <div className="flex flex-col items-center space-y-1 text-center">
            {/* Calculator/Budget Icon */}
            <div className="shrink-0">
              <div
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full',
                  remainingToLive > 0
                    ? 'bg-green-600'
                    : remainingToLive < 0
                      ? 'bg-red-600'
                      : 'bg-gray-500',
                )}
              >
                <svg
                  className="h-4 w-4 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                  />
                </svg>
              </div>
            </div>

            {/* Content */}
            <div className="w-full min-w-0">
              <p className="mb-1 text-xs font-medium text-gray-600">Reste à Vivre</p>
              {isFetching ? (
                <Skeleton className="mx-auto h-6 w-20" />
              ) : (
                <p
                  className={cn('truncate text-lg font-bold', getAmountColorClass(remainingToLive))}
                >
                  {formatAmount(remainingToLive)}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Économies | Notes — une ligne partagée en deux (Sprint Notes-Pense-Betes
          2026-09-23) : l'entrée Notes n'ajoute aucune hauteur au-dessus de la
          liste des transactions. Notes prend la largeur de son contenu et
          Économies le reste : en deux moitiés égales, le montant était tronqué
          dès 375 px (« Économies (1 234,… »). Au-delà de ~100 000 €, le libellé
          tronque (+ `title`) plutôt que de pousser la grille. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <button
          type="button"
          onClick={() => setIsSavingsOpen(true)}
          title={isFetching ? undefined : `Économies (${formatAmount(totalSavings)})`}
          className="hover:to-purple-150 min-w-0 cursor-pointer rounded-xl border border-purple-200 bg-linear-to-r from-purple-50 to-purple-100 p-2 shadow-xs transition-all duration-200 hover:from-purple-100"
        >
          <div className="flex min-w-0 items-center space-x-1.5">
            {/* Piggy/Information Icon */}
            <div className="shrink-0">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-600">
                <svg
                  className="h-3 w-3 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
            </div>

            {isFetching ? (
              <div className="flex min-w-0 items-center gap-1">
                <p className="text-sm font-medium text-purple-800">Économies</p>
                <Skeleton className="h-4 w-14 bg-purple-200/70" />
              </div>
            ) : (
              <p className="min-w-0 truncate text-sm font-medium text-purple-800">
                Économies ({formatAmount(totalSavings)})
              </p>
            )}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setIsNotesOpen(true)}
          aria-label={notesCount > 0 ? `Notes (${notesCount})` : 'Notes'}
          className="cursor-pointer rounded-xl border border-slate-200 bg-linear-to-r from-slate-50 to-slate-100 py-2 pr-3 pl-2 shadow-xs transition-all duration-200 hover:from-slate-100"
        >
          <div className="flex items-center space-x-1.5">
            {/* Notepad Icon */}
            <div className="shrink-0">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-600">
                <svg
                  className="h-3 w-3 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
            </div>

            <p className="text-sm font-medium text-slate-800">Notes</p>
            {notesCount > 0 && (
              <span
                aria-hidden="true"
                className="shrink-0 rounded-full bg-slate-600 px-1.5 text-xs leading-5 font-medium text-white"
              >
                {notesCount}
              </span>
            )}
          </div>
        </button>
      </div>

      {/* Planning Button Card */}
      <button
        onClick={() => setIsPlanningOpen(true)}
        className="hover:to-blue-150 w-full cursor-pointer rounded-xl border border-blue-200 bg-linear-to-r from-blue-50 to-blue-100 p-2 shadow-xs transition-all duration-200 hover:from-blue-100"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {/* Planning Icon */}
            <div className="shrink-0">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600">
                <svg
                  className="h-3 w-3 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
                  />
                </svg>
              </div>
            </div>

            {/* Content */}
            <div>
              <p className="text-sm font-medium text-blue-800">
                Planification des revenus et budgets
              </p>
            </div>
          </div>
        </div>
      </button>

      {/* Planning Drawer */}
      <PlanningDrawer
        isOpen={isPlanningOpen}
        onClose={() => setIsPlanningOpen(false)}
        onPlanningChange={onPlanningChange}
        context={context}
        currentRav={remainingToLive}
        readOnlyIncomes={readOnlyIncomes}
      />

      {/* Savings Drawer */}
      <SavingsDrawer
        isOpen={isSavingsOpen}
        onClose={() => setIsSavingsOpen(false)}
        context={context}
        onSavingsChange={onPlanningChange}
      />

      {/* Notes Drawer */}
      <NotesDrawer
        isOpen={isNotesOpen}
        onClose={() => setIsNotesOpen(false)}
        context={notesContext}
      />
    </div>
  )
}
