'use client'

import { useState } from 'react'
import { useForm, useWatch, Controller, type FieldErrors, type FieldPath } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { MODAL_CONTENT_CLASSES } from '@/components/ui/modal-content-classes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DecimalFormInput } from '@/components/ui/DecimalFormInput'
import { ModalCloseX } from '@/components/ui/modal-close-x'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/logger'
import { useBudgets } from '@/hooks/useBudgets'
import { useIncomes } from '@/hooks/useIncomes'
import { useRealExpenses } from '@/hooks/useRealExpenses'
import { useRealIncomes } from '@/hooks/useRealIncomes'
import type { RealExpense } from '@/hooks/useRealExpenses'
import type { RealIncome } from '@/hooks/useRealIncomes'
import ExpenseBreakdownPreview from '@/components/dashboard/ExpenseBreakdownPreview'
import CustomDropdown, { type DropdownOption } from '@/components/ui/CustomDropdown'
import {
  editTransactionFormSchema,
  type EditTransactionFormInput,
  type EditTransactionFormOutput,
} from '@/lib/schemas/transactions'

interface EditTransactionModalProps {
  isOpen?: boolean
  onClose: () => void
  transaction: RealExpense | RealIncome | null
  transactionType: 'expense' | 'income'
  context?: 'profile' | 'group'
  onTransactionUpdated?: () => void
}

/**
 * Modal for editing existing transactions (expenses or income).
 *
 * Migrated to Radix Dialog (Sprint Zod-Rollout v8) for focus trap + Esc-to-close
 * + return-focus + role=dialog + aria-modal. Custom close X preserved via
 * `hideCloseButton={true}` on DialogContent. Sprint v8 also drops the parent's
 * `key={transaction.id}` pattern — Radix unmount-on-close (when isOpen flips
 * false AND editingTransaction nulls in the parent's onClose handler) replaces
 * the force-reset.
 *
 * Uses react-hook-form + zodResolver(editTransactionFormSchema)
 * (discriminated union on transactionType). transactionType is fixed at
 * mount via prop — the form's defaultValues lock the branch ; the budget/
 * income dropdown is read-only by design (post-creation FK changes are
 * disallowed). Sprint Zod-Rollout v3.
 *
 * `isOpen` defaults to `true` to preserve the legacy parent pattern
 * `{isOpen && editing && <Modal />}` (dashboard/page.tsx).
 */
export default function EditTransactionModal({
  isOpen = true,
  onClose,
  transaction,
  transactionType,
  context,
  onTransactionUpdated,
}: EditTransactionModalProps) {
  const [serverError, setServerError] = useState<string | null>(null)

  // Hooks for managing data
  const { updateExpense, expenses: realExpenses } = useRealExpenses(context)
  const { updateIncome, incomes: realIncomes } = useRealIncomes(context)
  // Fallback pour éviter les dropdowns vides
  const { budgets } = useBudgets(context)
  const { incomes } = useIncomes(context)

  const isOriginallyExceptional = transaction?.is_exceptional ?? false

  // defaultValues built from the existing transaction. The discriminated
  // union picks the right branch based on `transactionType`.
  const form = useForm<EditTransactionFormInput, undefined, EditTransactionFormOutput>({
    resolver: zodResolver(editTransactionFormSchema),
    defaultValues:
      transactionType === 'expense'
        ? {
            transactionType: 'expense',
            description: transaction?.description ?? '',
            amount: transaction?.amount ?? 0,
            expense_date: (transaction as RealExpense | null)?.expense_date ?? '',
            is_exceptional: isOriginallyExceptional,
            estimated_budget_id: (transaction as RealExpense | null)?.estimated_budget_id ?? null,
          }
        : {
            transactionType: 'income',
            description: transaction?.description ?? '',
            amount: transaction?.amount ?? 0,
            entry_date: (transaction as RealIncome | null)?.entry_date ?? '',
            is_exceptional: isOriginallyExceptional,
            estimated_income_id: (transaction as RealIncome | null)?.estimated_income_id ?? null,
          },
    mode: 'onSubmit',
  })

  // Calculer les vrais montants dépensés pour chaque budget depuis les dépenses réelles.
  // Ne compte QUE amount_from_budget (pas tirelire ni savings) — mirror AddTransactionModal.
  // Sans ce fix, le dropdown affichait `sum(amount)` = 398€/200€ pour 2 dépenses dont
  // les économies absorbaient la majorité (bug remonté 2026-05-21).
  const calculateRealSpentAmount = (budgetId: string): number => {
    return realExpenses
      .filter((expense) => expense.estimated_budget_id === budgetId)
      .reduce((sum, expense) => {
        const amountFromBudget =
          expense.amount_from_budget !== null && expense.amount_from_budget !== undefined
            ? expense.amount_from_budget
            : expense.amount
        return sum + amountFromBudget
      }, 0)
  }

  // Calculer les vrais montants reçus pour chaque revenu depuis les revenus réels
  const calculateRealReceivedAmount = (incomeId: string): number => {
    return realIncomes
      .filter((income) => income.estimated_income_id === incomeId)
      .reduce((sum, income) => sum + income.amount, 0)
  }

  // Préparer les options pour les dropdowns - TOUJOURS utiliser les calculs en temps réel
  const budgetOptions: DropdownOption[] = budgets.map((budget) => {
    const realSpentAmount = calculateRealSpentAmount(budget.id)
    return {
      id: budget.id,
      name: budget.name,
      type: 'expense' as const,
      spentAmount: realSpentAmount,
      estimatedAmount: budget.estimated_amount,
      economyAmount: budget.cumulated_savings || 0,
    }
  })

  const incomeOptions: DropdownOption[] = incomes.map((income) => {
    const realReceivedAmount = calculateRealReceivedAmount(income.id)
    const bonusAmount = realReceivedAmount - income.estimated_amount
    return {
      id: income.id,
      name: income.name,
      type: 'income' as const,
      receivedAmount: realReceivedAmount,
      estimatedAmount: income.estimated_amount,
      bonusAmount: bonusAmount,
    }
  })

  // Read the FK dropdown value for the ExpenseBreakdownPreview (expense only)
  const watchedBudgetId = useWatch({
    control: form.control,
    name: 'estimated_budget_id' as const,
  })
  const watchedAmount = useWatch({ control: form.control, name: 'amount' })
  const previewAmount =
    typeof watchedAmount === 'number' ? watchedAmount : parseFloat(String(watchedAmount ?? ''))
  const previewSafe = isNaN(previewAmount) ? 0 : previewAmount

  /**
   * Handle form submission
   */
  const onValidSubmit = async (data: EditTransactionFormOutput) => {
    if (!transaction) return
    setServerError(null)

    try {
      let success = false

      if (data.transactionType === 'expense') {
        success = await updateExpense({
          id: transaction.id,
          description: data.description,
          amount: data.amount,
          expense_date: data.expense_date,
          estimated_budget_id: data.is_exceptional
            ? undefined
            : (data.estimated_budget_id ?? undefined),
        })
      } else {
        success = await updateIncome({
          id: transaction.id,
          description: data.description,
          amount: data.amount,
          entry_date: data.entry_date,
          estimated_income_id: data.is_exceptional
            ? undefined
            : (data.estimated_income_id ?? undefined),
        })
      }

      if (success) {
        onTransactionUpdated?.()
        onClose()
      }
    } catch (err) {
      logger.error('Error updating transaction:', err)
      setServerError('Erreur lors de la mise à jour de la transaction')
    }
  }

  /**
   * Handle modal close
   */
  const handleClose = () => {
    if (!form.formState.isSubmitting) {
      onClose()
    }
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      handleClose()
    }
  }

  // transactionType is fixed at mount via prop — only one branch is active.
  // setFocus uses permissive FieldPath cast since the keys differ between
  // branches at the type level.
  const onInvalidSubmit = (errors: FieldErrors<EditTransactionFormInput>) => {
    const firstErrorKey = Object.keys(errors)[0]
    if (firstErrorKey) {
      form.setFocus(firstErrorKey as FieldPath<EditTransactionFormInput>)
    }
  }

  if (!transaction) return null

  const fieldErrors = form.formState.errors
  const isSubmitting = form.formState.isSubmitting

  // Discriminated union narrowing : fieldErrors.expense_date and
  // .entry_date are only present in one branch each. We know which branch
  // is active via the transactionType prop — index permissively so TS
  // stops complaining about the absent key.
  const dateError = (fieldErrors as Record<string, { message?: string } | undefined>)[
    transactionType === 'expense' ? 'expense_date' : 'entry_date'
  ]

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent hideCloseButton className={MODAL_CONTENT_CLASSES}>
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4">
          <DialogTitle asChild>
            <h2 className="text-lg font-semibold text-gray-900">
              Modifier {transactionType === 'expense' ? 'la dépense' : 'le revenu'}
            </h2>
          </DialogTitle>
          <ModalCloseX onClose={handleClose} disabled={isSubmitting} variant="ghost" />
        </div>

        {/* Form */}
        <form
          onSubmit={form.handleSubmit(onValidSubmit, onInvalidSubmit)}
          className="flex min-h-0 flex-auto flex-col overflow-hidden"
          noValidate
        >
          <div className="min-h-0 flex-auto space-y-4 overflow-y-auto px-6 py-4">
            {/* Exceptional Checkbox - Only show for originally exceptional transactions */}
            {isOriginallyExceptional && (
              <div className="flex flex-col items-center space-y-2">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="exceptional"
                    checked={true}
                    disabled={true}
                    className="h-4 w-4 cursor-not-allowed rounded border-gray-300 bg-gray-100 text-blue-600 opacity-50"
                  />
                  <Label
                    htmlFor="exceptional"
                    className="cursor-not-allowed text-sm font-medium text-gray-700 opacity-50"
                  >
                    {transactionType === 'expense'
                      ? 'Dépense exceptionnelle'
                      : 'Revenu exceptionnel'}
                  </Label>
                </div>
                <p className="text-center text-xs text-gray-500">
                  Transaction originalement exceptionnelle (non modifiable)
                </p>
              </div>
            )}

            {/* Budget/Income Selection - Only shown if not exceptional */}
            {!isOriginallyExceptional && (
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-gray-900">
                  {transactionType === 'expense' ? 'Budget associé' : 'Revenu estimé associé'}
                  <span className="ml-1.5 text-xs text-gray-500">(non modifiable)</span>
                </Label>
                {transactionType === 'expense' ? (
                  <Controller
                    control={form.control}
                    name="estimated_budget_id"
                    render={({ field }) => (
                      <CustomDropdown
                        options={budgetOptions}
                        value={field.value ?? ''}
                        onChange={(value) => field.onChange(value || null)}
                        placeholder="Sélectionner un budget"
                        required={true}
                        disabled={true}
                      />
                    )}
                  />
                ) : (
                  <Controller
                    control={form.control}
                    name="estimated_income_id"
                    render={({ field }) => (
                      <CustomDropdown
                        options={incomeOptions}
                        value={field.value ?? ''}
                        onChange={(value) => field.onChange(value || null)}
                        placeholder="Sélectionner un revenu estimé"
                        required={true}
                        disabled={true}
                      />
                    )}
                  />
                )}
              </div>
            )}

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="description" className="text-sm font-medium text-gray-900">
                Description <span className="text-red-500">*</span>
              </Label>
              <Input
                id="description"
                type="text"
                {...form.register('description')}
                placeholder={
                  transactionType === 'expense' ? 'Ex: Achat de chaussures' : 'Ex: Salaire mensuel'
                }
                aria-invalid={fieldErrors.description ? 'true' : 'false'}
                aria-describedby={
                  fieldErrors.description ? 'edit-transaction-description-error' : undefined
                }
                className="w-full"
              />
              {fieldErrors.description && (
                <p id="edit-transaction-description-error" className="text-sm text-red-600">
                  {fieldErrors.description.message}
                </p>
              )}
            </div>

            {/* Amount */}
            <div className="space-y-1.5">
              <Label htmlFor="amount" className="text-sm font-medium text-gray-900">
                Montant (€) <span className="text-red-500">*</span>
              </Label>
              <DecimalFormInput
                control={form.control}
                name="amount"
                id="amount"
                placeholder="0.00"
                className="w-full"
                ariaInvalid={!!fieldErrors.amount}
                ariaDescribedby={fieldErrors.amount ? 'edit-transaction-amount-error' : undefined}
              />
              {fieldErrors.amount && (
                <p id="edit-transaction-amount-error" className="text-sm text-red-600">
                  {fieldErrors.amount.message}
                </p>
              )}
            </div>

            {/* Date */}
            <div className="space-y-1.5">
              <Label htmlFor="date" className="text-sm font-medium text-gray-900">
                Date <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                {transactionType === 'expense' ? (
                  <Input
                    id="date"
                    type="date"
                    {...form.register('expense_date')}
                    aria-invalid={dateError ? 'true' : 'false'}
                    aria-describedby={dateError ? 'edit-transaction-date-error' : undefined}
                    className="w-full pl-10"
                  />
                ) : (
                  <Input
                    id="date"
                    type="date"
                    {...form.register('entry_date')}
                    aria-invalid={dateError ? 'true' : 'false'}
                    aria-describedby={dateError ? 'edit-transaction-date-error' : undefined}
                    className="w-full pl-10"
                  />
                )}
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <svg
                    className="h-4 w-4 text-gray-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                </div>
              </div>
              {dateError && (
                <p id="edit-transaction-date-error" className="text-sm text-red-600">
                  {dateError.message}
                </p>
              )}
            </div>

            {/* Expense Breakdown Preview - only for budgeted expenses.
                Gated sur `previewSafe !== transaction.amount` (comparé en
                cents pour éviter les floats) — Sprint 2026-05-21 : on ne
                charge/affiche le recap QUE quand le montant change. À
                l'ouverture (montant inchangé), l'utilisateur n'a pas besoin
                de voir une re-allocation qui ne fait que reproduire l'état
                actuel — le planificateur affiche déjà ces valeurs. */}
            {transactionType === 'expense' &&
              previewSafe > 0 &&
              !isOriginallyExceptional &&
              watchedBudgetId &&
              transaction &&
              Math.round(previewSafe * 100) !== Math.round(transaction.amount * 100) && (
                <ExpenseBreakdownPreview
                  amount={previewSafe}
                  budgetId={String(watchedBudgetId)}
                  context={context}
                  expenseId={transaction.id}
                />
              )}

            {/* Server-side error */}
            {serverError && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-sm text-red-700">{serverError}</p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex shrink-0 space-x-2 border-t border-gray-200 px-6 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isSubmitting}
              className="flex-1"
            >
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className={cn(
                'flex-1',
                transactionType === 'expense'
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-green-600 hover:bg-green-700',
              )}
            >
              {isSubmitting ? (
                <div className="flex items-center space-x-1.5">
                  <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white"></div>
                  <span>Modification...</span>
                </div>
              ) : (
                `Modifier ${transactionType === 'expense' ? 'la dépense' : 'le revenu'}`
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
