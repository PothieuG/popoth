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
        <div className="shrink-0 border-b border-gray-200 bg-purple-50/30 px-4 py-4">
          <div className="flex items-center justify-between">
            <DialogTitle asChild>
              <h2 className="text-xl font-bold text-gray-900">Détail des économies</h2>
            </DialogTitle>
            <ModalCloseX onClose={onClose} variant="circle" />
          </div>
          <p className="mt-1 text-sm text-gray-600">Tirelire + économies par budget.</p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {isEmpty ? (
            <p className="text-center text-sm text-gray-500">Aucune économie pour le moment.</p>
          ) : (
            <ul className="space-y-2">
              {hasPiggy && (
                <li className="flex items-center justify-between rounded-lg border border-purple-200 bg-purple-50 px-3 py-2">
                  <span className="text-sm font-medium text-gray-900">Tirelire</span>
                  <span className="text-sm font-medium text-purple-700">
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
                  <span className="text-sm font-medium text-gray-700">
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
