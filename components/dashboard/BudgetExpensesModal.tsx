'use client'

import { useMemo } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { MODAL_CONTENT_CLASSES } from '@/components/ui/modal-content-classes'
import { ModalCloseX } from '@/components/ui/modal-close-x'
import { formatEuro } from '@/lib/format-currency'
import { useRealExpenses } from '@/hooks/useRealExpenses'

interface BudgetExpensesModalProps {
  isOpen: boolean
  onClose: () => void
  context?: 'profile' | 'group'
  budget: { id: string; name: string; spentAmount: number; estimatedAmount: number } | null
}

const DATE_FORMATTER = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' })

/**
 * `expense_date` est une colonne `date` ("YYYY-MM-DD"). On la parse en date
 * locale (et non `new Date(iso)` qui interprète en UTC et peut décaler d'un
 * jour selon le fuseau) pour afficher "3 juin".
 */
function formatExpenseDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso
  return DATE_FORMATTER.format(new Date(y, m - 1, d))
}

/**
 * Modal informative (lecture seule) listant les dépenses réelles associées à un
 * budget estimé, ouverte depuis le planificateur quand on tape un budget. Une
 * ligne par dépense : montant total payé + sous-ligne de répartition (économies
 * / tirelire) quand elle diffère du simple prélèvement budget, + tag "Mois
 * précédent" pour les dépenses reportées. Footer "Total payé". Aucun bouton
 * d'action.
 *
 * Données : réutilise la query TanStack `['real-expenses', context]` déjà en
 * cache (même source que `useBudgetProgress`), filtrée par `estimated_budget_id`
 * — aucune nouvelle route ni requête réseau. Les dépenses arrivent déjà triées
 * par date décroissante (ordre de l'API).
 *
 * Thème orange : couleur réservée aux budgets dans la charte Popoth.
 */
export default function BudgetExpensesModal({
  isOpen,
  onClose,
  context,
  budget,
}: BudgetExpensesModalProps) {
  const { expenses } = useRealExpenses(context)

  const items = useMemo(
    () => (budget ? expenses.filter((e) => e.estimated_budget_id === budget.id) : []),
    [expenses, budget],
  )

  const totalPaid = useMemo(
    () => items.reduce((sum, e) => sum + (Number.isFinite(e.amount) ? e.amount : 0), 0),
    [items],
  )

  const handleOpenChange = (open: boolean) => {
    if (!open) onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent hideCloseButton className={MODAL_CONTENT_CLASSES}>
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-orange-200 bg-orange-50 px-5 py-4">
          <div className="min-w-0">
            <DialogTitle asChild>
              <h2 className="truncate text-lg font-bold text-orange-900">
                Dépenses — {budget?.name}
              </h2>
            </DialogTitle>
            {budget && (
              <p className="text-sm text-orange-800/80">
                <span className="font-semibold tabular-nums">{formatEuro(budget.spentAmount)}</span>{' '}
                / <span className="tabular-nums">{formatEuro(budget.estimatedAmount)}</span>
              </p>
            )}
          </div>
          <ModalCloseX onClose={onClose} variant="circle" />
        </div>

        {/* Body */}
        <div className="min-h-0 flex-auto overflow-y-auto px-5 py-4">
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">Aucune dépense pour ce budget.</p>
          ) : (
            <ul className="space-y-2">
              {items.map((expense) => {
                const fromSavings = expense.amount_from_budget_savings ?? 0
                const fromPiggy = expense.amount_from_piggy_bank ?? 0
                const breakdownParts: string[] = []
                if (fromSavings > 0.005) breakdownParts.push(`dont ${formatEuro(fromSavings)} éco.`)
                if (fromPiggy > 0.005) breakdownParts.push(`${formatEuro(fromPiggy)} tirelire`)

                return (
                  <li
                    key={expense.id}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-medium text-gray-900">
                        {expense.description}
                      </span>
                      <span className="shrink-0 text-sm font-bold text-gray-900 tabular-nums">
                        {formatEuro(expense.amount)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-gray-500">
                      <span>{formatExpenseDate(expense.expense_date)}</span>
                      {breakdownParts.length > 0 && (
                        <span className="text-purple-600">· {breakdownParts.join(' · ')}</span>
                      )}
                      {expense.is_carried_over && (
                        <span className="rounded-full border border-gray-200 bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                          Mois précédent
                        </span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-gray-200 px-5 py-3">
          <span className="text-sm font-medium text-gray-600">
            Total payé{items.length > 0 ? ` (${items.length})` : ''}
          </span>
          <span className="text-base font-bold text-gray-900 tabular-nums">
            {formatEuro(totalPaid)}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
