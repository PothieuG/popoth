'use client'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DRAWER_CONTENT_CLASSES } from '@/components/ui/drawer-content-classes'
import { ModalCloseX } from '@/components/ui/modal-close-x'
import { formatEuro } from '@/lib/format-currency'
import type { BudgetSummary } from '@/lib/recap'

interface SavingsDetailDrawerProps {
  isOpen: boolean
  onClose: () => void
  piggyAmount: number
  budgets: readonly BudgetSummary[]
}

/**
 * Drawer indicatif (lecture seule) listant la tirelire + les budgets dont
 * `cumulatedSavings > 0`. Aucun bouton d'action — sert juste à expliquer la
 * composition du `summary.totalSavings + piggyAmount` affiché sur la card
 * "Total économies" du SummaryStep.
 *
 * Code couleur : violet (thème "économies" du récap, cohérent avec la card
 * "Total économies" du SummaryStep).
 */
export function SavingsDetailDrawer({
  isOpen,
  onClose,
  piggyAmount,
  budgets,
}: SavingsDetailDrawerProps) {
  const handleOpenChange = (open: boolean) => {
    if (!open) onClose()
  }

  const hasPiggy = piggyAmount > 0
  const isEmpty = !hasPiggy && budgets.length === 0

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent hideCloseButton className={DRAWER_CONTENT_CLASSES}>
        <div className="shrink-0 border-b border-violet-200 bg-violet-50 px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                aria-hidden="true"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-500 text-white"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 8v8m4-4H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <div>
                <DialogTitle asChild>
                  <h2 className="text-xl font-bold text-violet-900">Détail des économies</h2>
                </DialogTitle>
                <p className="text-sm text-violet-800/80">Tirelire + économies par budget.</p>
              </div>
            </div>
            <ModalCloseX onClose={onClose} variant="circle" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {isEmpty ? (
            <p className="text-center text-sm text-gray-500">Aucune économie pour le moment.</p>
          ) : (
            <ul className="space-y-2">
              {hasPiggy && (
                <li className="flex items-center justify-between rounded-lg border border-violet-200 bg-violet-50 px-3 py-2">
                  <span className="text-sm font-medium text-gray-900">Tirelire</span>
                  <span className="text-sm font-medium text-violet-700">
                    {formatEuro(piggyAmount)}
                  </span>
                </li>
              )}
              {budgets.map((b) => (
                <li
                  key={b.budgetId}
                  className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2"
                >
                  <span className="text-sm text-gray-900">{b.budgetName}</span>
                  <span className="text-sm font-medium text-violet-700">
                    {formatEuro(b.cumulatedSavings)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
