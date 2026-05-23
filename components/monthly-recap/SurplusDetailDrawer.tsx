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
 *
 * Code couleur : orange (thème "budget" du récap, cohérent avec la card
 * "Surplus total des budgets" du SummaryStep).
 */
export function SurplusDetailDrawer({ isOpen, onClose, budgets }: SurplusDetailDrawerProps) {
  const handleOpenChange = (open: boolean) => {
    if (!open) onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent hideCloseButton className={DRAWER_CONTENT_CLASSES}>
        <div className="shrink-0 border-b border-orange-200 bg-orange-50 px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                aria-hidden="true"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-500 text-white"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M3 10h2l1 9h12l1-9h2M5 10V6a2 2 0 012-2h10a2 2 0 012 2v4M9 14h6"
                  />
                </svg>
              </div>
              <div>
                <DialogTitle asChild>
                  <h2 className="text-xl font-bold text-orange-900">Surplus par budget</h2>
                </DialogTitle>
                <p className="text-sm text-orange-800/80">Budgets ayant moins dépensé que prévu.</p>
              </div>
            </div>
            <ModalCloseX onClose={onClose} variant="circle" />
          </div>
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
                  <span className="text-sm font-medium text-orange-700">
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
