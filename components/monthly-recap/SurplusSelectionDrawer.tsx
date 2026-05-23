'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DRAWER_CONTENT_CLASSES } from '@/components/ui/drawer-content-classes'
import { ModalCloseX } from '@/components/ui/modal-close-x'
import { formatEuro } from '@/lib/format-currency'
import type { BudgetSummary } from '@/lib/recap'
import { cn } from '@/lib/utils'

interface SurplusSelectionDrawerProps {
  isOpen: boolean
  onClose: () => void
  budgets: readonly BudgetSummary[]
  isSubmitting: boolean
  onSubmit: (budgetIds: string[]) => void
}

/**
 * Sprint 12 — interactive drawer used by `BilanPositiveStep` to let the user
 * pick which budget surpluses go into the piggy bank (cf. spec §4.A "Si Oui").
 *
 * Tap-row pattern (no checkbox dep) : each budget row is a full-width
 * `<button>` with `aria-pressed`. Selected rows get an orange-tinted bg + a
 * check icon on the right — easier to tap on mobile than a 20px checkbox.
 *
 * Selection state is local and reset on every open (effect on `isOpen`). The
 * footer button is disabled when nothing is selected or while the parent's
 * mutation is in-flight.
 */
export function SurplusSelectionDrawer({
  isOpen,
  onClose,
  budgets,
  isSubmitting,
  onSubmit,
}: SurplusSelectionDrawerProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  // Reset the selection whenever the drawer is (re)opened. We use the
  // adjust-state-on-prop-change pattern (https://react.dev/reference/react/useState#storing-information-from-previous-renders)
  // rather than a useEffect — the latter trips react-hooks/set-state-in-effect.
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen)
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen)
    if (isOpen) setSelected(new Set())
  }

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const totalSelected = budgets
    .filter((b) => selected.has(b.budgetId))
    .reduce((sum, b) => sum + b.surplus, 0)

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
                  <h2 className="text-xl font-bold text-orange-900">
                    Sélectionner les surplus à transférer
                  </h2>
                </DialogTitle>
                <p className="text-sm text-orange-800/80">
                  Tape sur une ligne pour la sélectionner.
                </p>
              </div>
            </div>
            <ModalCloseX onClose={onClose} variant="circle" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {budgets.length === 0 ? (
            <p className="text-center text-sm text-gray-500">Aucun surplus disponible.</p>
          ) : (
            <ul className="space-y-2">
              {budgets.map((b) => {
                const isSelected = selected.has(b.budgetId)
                return (
                  <li key={b.budgetId}>
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => toggle(b.budgetId)}
                      className={cn(
                        'flex w-full items-center justify-between rounded-lg border px-3 py-3 transition-colors',
                        isSelected
                          ? 'border-orange-300 bg-orange-50'
                          : 'border-gray-200 bg-white hover:border-orange-200',
                      )}
                    >
                      <span className="text-sm text-gray-900">{b.budgetName}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-medium text-orange-700">
                          +{formatEuro(b.surplus)}
                        </span>
                        {isSelected && (
                          <svg
                            className="h-5 w-5 text-orange-600"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="shrink-0 border-t border-gray-200 bg-gray-50 px-4 py-4">
          <Button
            className="w-full"
            disabled={selected.size === 0 || isSubmitting}
            onClick={() => onSubmit(Array.from(selected))}
          >
            {isSubmitting
              ? 'Transfert…'
              : `Transférer ${formatEuro(totalSelected)} vers la tirelire`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
