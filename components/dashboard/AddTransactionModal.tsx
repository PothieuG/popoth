'use client'

import { useState } from 'react'
import { useForm, useWatch, Controller, type FieldErrors, type FieldPath } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DecimalFormInput } from '@/components/ui/DecimalFormInput'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/logger'
import { useBudgets } from '@/hooks/useBudgets'
import { useIncomes } from '@/hooks/useIncomes'
import { useRealExpenses } from '@/hooks/useRealExpenses'
import { useRealIncomes } from '@/hooks/useRealIncomes'
import RemainingToLivePreview from '@/components/dashboard/RemainingToLivePreview'
import ExpenseBreakdownPreview from '@/components/dashboard/ExpenseBreakdownPreview'
import { useProgressData } from '@/hooks/useProgressData'
import { useFinancialData } from '@/hooks/useFinancialData'
import { useRavValidation } from '@/hooks/useRavValidation'
import CustomDropdown, { type DropdownOption } from '@/components/ui/CustomDropdown'
import {
  addTransactionFormSchema,
  type AddTransactionFormInput,
  type AddTransactionFormOutput,
} from '@/lib/schemas/transactions'

interface AddTransactionModalProps {
  isOpen?: boolean
  onClose: () => void
  context?: 'profile' | 'group'
  onTransactionAdded?: () => void
}

type TransactionType = 'expense' | 'income'

const todayIso = (): string => {
  const today = new Date().toISOString().split('T')[0]
  return today as string
}

/**
 * Modal for adding new transactions (expenses or income).
 *
 * Migrated to Radix Dialog (Sprint Zod-Rollout v8) for focus trap + Esc-to-close +
 * return-focus + role=dialog + aria-modal. Custom close X preserved via
 * `hideCloseButton={true}` on DialogContent.
 *
 * Uses react-hook-form + zodResolver(addTransactionFormSchema)
 * (discriminated union). transactionType is mutable via radio buttons —
 * switching calls form.reset() with the right branch shape, preserving
 * description/amount/date/is_exceptional but dropping the obsolete FK.
 * Sprint Zod-Rollout v3.
 *
 * useRavValidation stays separate from the schema — it depends on
 * reactive data (financialData, expenseProgress) that may refetch
 * during typing. We consult it post-resolver in onValidSubmit (blocks
 * the submit) and disable the submit button when blocked.
 *
 * `isOpen` defaults to `true` to preserve the legacy parent pattern
 * `{isOpen && <Modal />}` (dashboard + group-dashboard pages).
 */
export default function AddTransactionModal({
  isOpen = true,
  onClose,
  context,
  onTransactionAdded,
}: AddTransactionModalProps) {
  const [serverError, setServerError] = useState<string | null>(null)

  // Hooks for managing data
  const { addExpense, expenses: realExpenses } = useRealExpenses(context)
  const { addIncome, incomes: realIncomes } = useRealIncomes(context)
  const { expenseProgress } = useProgressData(context)
  const { financialData } = useFinancialData(context)
  // Fallback pour éviter les dropdowns vides
  const { budgets } = useBudgets(context)
  const { incomes } = useIncomes(context)

  const form = useForm<AddTransactionFormInput, undefined, AddTransactionFormOutput>({
    resolver: zodResolver(addTransactionFormSchema),
    defaultValues: {
      transactionType: 'expense',
      description: '',
      amount: 0,
      expense_date: todayIso(),
      is_exceptional: false,
      estimated_budget_id: null,
    },
    mode: 'onSubmit',
  })

  // Watch reactive fields for previews + RAV validation
  const watchedType = useWatch({ control: form.control, name: 'transactionType' })
  const watchedExceptional = useWatch({ control: form.control, name: 'is_exceptional' })
  const watchedAmount = useWatch({ control: form.control, name: 'amount' })
  const watchedBudgetId = useWatch({ control: form.control, name: 'estimated_budget_id' })
  const watchedIncomeId = useWatch({ control: form.control, name: 'estimated_income_id' })

  const transactionType = (watchedType ?? 'expense') as TransactionType
  const isExceptional = Boolean(watchedExceptional)
  const previewAmount =
    typeof watchedAmount === 'number' ? watchedAmount : parseFloat(String(watchedAmount ?? ''))
  const previewSafe = isNaN(previewAmount) ? 0 : previewAmount
  const budgetId = (watchedBudgetId as string | null) ?? ''
  const incomeId = (watchedIncomeId as string | null) ?? ''

  // Validation : vérifier si la dépense ferait passer le reste à vivre en négatif.
  // Le hook reste séparé du schema parce qu'il dépend de données async
  // (financialData, expenseProgress) qui peuvent refetcher pendant la saisie.
  const ravValidation = useRavValidation({
    transactionType,
    isExceptional,
    amount: previewSafe,
    remainingToLive: financialData?.remainingToLive,
    budgetId,
    budgetProgress: expenseProgress[budgetId],
  })

  // Calculer les vrais montants dépensés pour chaque budget depuis les dépenses réelles
  // Ne compte QUE amount_from_budget (pas tirelire ni savings)
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

  /**
   * Switch transactionType via radio. Preserves description/amount/date
   * /is_exceptional and resets the FK to null in the new branch.
   */
  const handleSwitchType = (newType: TransactionType) => {
    const current = form.getValues()
    const currentDate =
      current.transactionType === 'expense'
        ? (current.expense_date ?? todayIso())
        : (current.entry_date ?? todayIso())

    if (newType === 'expense') {
      form.reset({
        transactionType: 'expense',
        description: current.description ?? '',
        amount: current.amount as never,
        expense_date: currentDate,
        is_exceptional: current.is_exceptional ?? false,
        estimated_budget_id: null,
      })
    } else {
      form.reset({
        transactionType: 'income',
        description: current.description ?? '',
        amount: current.amount as never,
        entry_date: currentDate,
        is_exceptional: current.is_exceptional ?? false,
        estimated_income_id: null,
      })
    }
  }

  /**
   * Handle form submission
   */
  const onValidSubmit = async (data: AddTransactionFormOutput) => {
    setServerError(null)

    if (ravValidation.blocked) {
      setServerError(
        "Impossible d'ajouter cette dépense : votre reste à vivre (sans économies) deviendrait négatif. Réduisez le montant de la dépense.",
      )
      return
    }

    try {
      let success = false

      if (data.transactionType === 'expense') {
        success = await addExpense({
          description: data.description,
          amount: data.amount,
          expense_date: data.expense_date,
          estimated_budget_id: data.is_exceptional
            ? undefined
            : (data.estimated_budget_id ?? undefined),
          is_for_group: context === 'group',
        })
      } else {
        success = await addIncome({
          description: data.description,
          amount: data.amount,
          entry_date: data.entry_date,
          estimated_income_id: data.is_exceptional
            ? undefined
            : (data.estimated_income_id ?? undefined),
          is_for_group: context === 'group',
        })
      }

      if (success) {
        onTransactionAdded?.()
        onClose()
      }
    } catch (err) {
      logger.error('Error adding transaction:', err)
      setServerError("Erreur lors de l'ajout de la transaction")
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

  // Discriminated union : the error keys differ between expense/income
  // branches. setFocus(firstErrorKey) handles this via permissive cast —
  // RHF resolves the ref at runtime from the active branch.
  const onInvalidSubmit = (errors: FieldErrors<AddTransactionFormInput>) => {
    const firstErrorKey = Object.keys(errors)[0]
    if (firstErrorKey) {
      form.setFocus(firstErrorKey as FieldPath<AddTransactionFormInput>)
    }
  }

  const fieldErrors = form.formState.errors
  const isSubmitting = form.formState.isSubmitting

  // Discriminated union narrowing : .expense_date and .entry_date live in
  // different branches. Index permissively based on the live transactionType.
  const dateError = (fieldErrors as Record<string, { message?: string } | undefined>)[
    transactionType === 'expense' ? 'expense_date' : 'entry_date'
  ]
  const fkError = (fieldErrors as Record<string, { message?: string } | undefined>)[
    transactionType === 'expense' ? 'estimated_budget_id' : 'estimated_income_id'
  ]

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        hideCloseButton
        className="flex max-h-[80vh] flex-col gap-0 overflow-hidden rounded-xl border-0 p-0 shadow-xl sm:max-w-md sm:rounded-xl"
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 p-6">
          <DialogTitle asChild>
            <h2 className="text-xl font-semibold text-gray-900">Ajouter une transaction</h2>
          </DialogTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            disabled={isSubmitting}
            aria-label="Fermer"
            className="p-2"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </Button>
        </div>

        {/* Form - Scrollable */}
        <form
          onSubmit={form.handleSubmit(onValidSubmit, onInvalidSubmit)}
          className="flex-1 space-y-6 overflow-y-auto p-6"
          noValidate
        >
          {/* Transaction Type Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium text-gray-900">Type de transaction</Label>
            <div className="flex space-x-3">
              <button
                type="button"
                onClick={() => handleSwitchType('expense')}
                className={cn(
                  'flex-1 rounded-lg border p-4 text-sm font-medium transition-all',
                  transactionType === 'expense'
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100',
                )}
              >
                <div className="flex items-center justify-center space-x-2">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6"
                    />
                  </svg>
                  <span className="font-medium">Dépense</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleSwitchType('income')}
                className={cn(
                  'flex-1 rounded-lg border p-4 text-sm font-medium transition-all',
                  transactionType === 'income'
                    ? 'border-green-200 bg-green-50 text-green-700'
                    : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100',
                )}
              >
                <div className="flex items-center justify-center space-x-2">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M7 11l5-5m0 0l5 5m-5-5v12"
                    />
                  </svg>
                  <span className="font-medium">Revenu</span>
                </div>
              </button>
            </div>
          </div>

          {/* Exceptional Checkbox */}
          <div className="flex flex-col items-center space-y-3">
            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="exceptional"
                {...form.register('is_exceptional')}
                className="h-4 w-4 rounded border-gray-300 bg-gray-100 text-blue-600 focus:ring-blue-500"
              />
              <Label
                htmlFor="exceptional"
                className="cursor-pointer text-sm font-medium text-gray-700"
              >
                {transactionType === 'expense' ? 'Dépense exceptionnelle' : 'Revenu exceptionnel'}
              </Label>
            </div>
            <p className="text-center text-xs text-gray-500">
              {transactionType === 'expense'
                ? 'Non associée à un budget estimé'
                : 'Non associé à un revenu estimé'}
            </p>
          </div>

          {/* Budget/Income Selection - Only shown if not exceptional */}
          {!isExceptional && (
            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-900">
                {transactionType === 'expense' ? 'Budget associé' : 'Revenu estimé associé'}
                <span className="ml-1 text-red-500">*</span>
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
                      required={!isExceptional}
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
                      required={!isExceptional}
                    />
                  )}
                />
              )}
              {fkError && (
                <p id="add-transaction-fk-error" className="text-sm text-red-600">
                  {fkError.message}
                </p>
              )}
            </div>
          )}

          {/* Description */}
          <div className="space-y-2">
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
                fieldErrors.description ? 'add-transaction-description-error' : undefined
              }
              className="w-full"
            />
            {fieldErrors.description && (
              <p id="add-transaction-description-error" className="text-sm text-red-600">
                {fieldErrors.description.message}
              </p>
            )}
          </div>

          {/* Amount */}
          <div className="space-y-2">
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
              ariaDescribedby={fieldErrors.amount ? 'add-transaction-amount-error' : undefined}
            />
            {fieldErrors.amount && (
              <p id="add-transaction-amount-error" className="text-sm text-red-600">
                {fieldErrors.amount.message}
              </p>
            )}
          </div>

          {/* Date */}
          <div className="space-y-2">
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
                  aria-describedby={dateError ? 'add-transaction-date-error' : undefined}
                  className="w-full pl-10"
                />
              ) : (
                <Input
                  id="date"
                  type="date"
                  {...form.register('entry_date')}
                  aria-invalid={dateError ? 'true' : 'false'}
                  aria-describedby={dateError ? 'add-transaction-date-error' : undefined}
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
              <p id="add-transaction-date-error" className="text-sm text-red-600">
                {dateError.message}
              </p>
            )}
          </div>

          {/* Preview for expenses - show breakdown */}
          {previewSafe > 0 && transactionType === 'expense' && !isExceptional && budgetId && (
            <ExpenseBreakdownPreview amount={previewSafe} budgetId={budgetId} context={context} />
          )}

          {/* Preview for incomes or exceptional expenses - show remaining to live */}
          {previewSafe > 0 && (transactionType === 'income' || isExceptional) && (
            <RemainingToLivePreview
              amount={previewSafe}
              type={transactionType}
              isExceptional={isExceptional}
              selectedId={transactionType === 'expense' ? budgetId : incomeId}
              context={context}
            />
          )}

          {/* RAV Negative Warning */}
          {ravValidation.blocked && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-sm font-medium text-red-700">
                Impossible d&apos;ajouter cette dépense : votre reste à vivre (sans économies)
                deviendrait négatif (
                {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(
                  ravValidation.newRav,
                )}
                ). Réduisez le montant de la dépense.
              </p>
            </div>
          )}

          {/* Server-side error */}
          {serverError && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-sm text-red-700">{serverError}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex space-x-3 pt-4">
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
              disabled={isSubmitting || ravValidation.blocked}
              className={cn(
                'flex-1',
                transactionType === 'expense'
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-green-600 hover:bg-green-700',
              )}
            >
              {isSubmitting ? (
                <div className="flex items-center space-x-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white"></div>
                  <span>Ajout...</span>
                </div>
              ) : (
                `Ajouter ${transactionType === 'expense' ? 'la dépense' : 'le revenu'}`
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
