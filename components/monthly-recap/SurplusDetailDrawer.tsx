'use client'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DRAWER_CONTENT_CLASSES } from '@/components/ui/drawer-content-classes'
import { ModalCloseX } from '@/components/ui/modal-close-x'
import { formatEuro } from '@/lib/format-currency'
import type { BudgetSummary } from '@/lib/recap'

interface SurplusDetailDrawerProps {
  isOpen: boolean
  onClose: () => void
  budgets: readonly BudgetSummary[]
}

/**
 * Drawer indicatif (lecture seule) listant les budgets dont le surplus > 0.
 * Aucun bouton d'action — sert juste à expliquer la composition du
 * `summary.totalSurplus` affiché sur la card du SummaryStep.
 */
export function SurplusDetailDrawer({ isOpen, onClose, budgets }: SurplusDetailDrawerProps) {
  const handleOpenChange = (open: boolean) => {
    if (!open) onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent hideCloseButton className={DRAWER_CONTENT_CLASSES}>
        <div className="shrink-0 border-b border-gray-200 bg-green-50/30 px-4 py-4">
          <div className="flex items-center justify-between">
            <DialogTitle asChild>
              <h2 className="text-xl font-bold text-gray-900">Surplus par budget</h2>
            </DialogTitle>
            <ModalCloseX onClose={onClose} variant="circle" />
          </div>
          <p className="mt-1 text-sm text-gray-600">
            Détail des budgets qui ont moins dépensé que prévu.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {budgets.length === 0 ? (
            <p className="text-center text-sm text-gray-500">Aucun surplus ce mois-ci.</p>
          ) : (
            <ul className="space-y-2">
              {budgets.map((b) => (
                <li
                  key={b.budgetId}
                  className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2"
                >
                  <span className="text-sm text-gray-900">{b.budgetName}</span>
                  <span className="text-sm font-medium text-green-700">
                    +{formatEuro(b.surplus)}
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
