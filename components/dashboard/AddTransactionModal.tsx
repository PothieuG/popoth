'use client'

import { useMemo, useState } from 'react'
import { useForm, useWatch, Controller, type FieldErrors, type FieldPath } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
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
import RemainingToLivePreview from '@/components/dashboard/RemainingToLivePreview'
import ExpenseBreakdownPreview from '@/components/dashboard/ExpenseBreakdownPreview'
import { useProgressData } from '@/hooks/useProgressData'
import { useFinancialData } from '@/hooks/useFinancialData'
import { useRavValidation } from '@/hooks/useRavValidation'
import { calculateBreakdown } from '@/lib/expense-breakdown'
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

/**
 * Wizard step state (Sprint P4-P5-P6 / Phase B1).
 * - `'select-type'`: choose expense vs income (always first step)
 * - `'select-expense-kind'`: choose budgeted vs exceptional (expense flow only)
 * - `'fields'`: form fields (description, amount, date, FK, savings toggle, etc.)
 *
 * Income flow skips `select-expense-kind`. Form state is preserved via the
 * single `useForm` at the top — step transitions only swap the render.
 */
type WizardStep = 'select-type' | 'select-expense-kind' | 'fields'

const todayIso = (): string => {
  const today = new Date().toISOString().split('T')[0]
  return today as string
}

/**
 * Modal for adding new transactions (expenses or income).
 *
 * **Sprint P4-P5-P6 wizard (Phase B1)** : 2-step flow for expenses, 1-step for income.
 *   Step 1 (always): choose expense vs income
 *   Step 2 (expense only): choose budgeted vs exceptional
 *   Step 3: form fields + (for budgeted expense) "Utiliser les économies" toggle (P5)
 *
 * Form state preserved via single `useForm` — step transitions only swap render.
 * Back navigation preserves values (description/amount/date typed earlier).
 *
 * Migrated to Radix Dialog (Sprint Zod-Rollout v8) for focus trap + Esc-to-close
 * + return-focus + role=dialog + aria-modal. Custom close X via ModalCloseX (v10).
 *
 * useRavValidation reads the savings toggle + savingsAvailable (Phase A5)
 * to correctly predict RAV impact — savings cascade absorbs overflow,
 * RAV not impacted as much as the pre-P4 cascade-aggressive logic predicted.
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
  const [wizardStep, setWizardStep] = useState<WizardStep>('select-type')
  const [useSavings, setUseSavings] = useState(false)
  // P4 Phase 2 — ordered list of budget IDs the user selected to source
  // cross-budget savings from. Drained first-fit in selection order to
  // cover the overflow (each entry takes min(remaining, its savings)).
  const [crossBudgetSelected, setCrossBudgetSelected] = useState<string[]>([])

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

  // P5 — local savings of selected budget (for cascade absorption preview + RAV calc)
  const selectedBudget = budgets.find((b) => b.id === budgetId)
  const savingsAvailable = selectedBudget?.cumulated_savings ?? 0

  const ravValidation = useRavValidation({
    transactionType,
    isExceptional,
    amount: previewSafe,
    remainingToLive: financialData?.remainingToLive,
    budgetId,
    budgetProgress: expenseProgress[budgetId],
    savingsAvailable,
    useSavingsToggle: useSavings,
  })

  // P4 Phase 2 — compute the overflow (amount not covered by destination
  // budget + its local savings). When > 0, the user is offered to draw
  // from OTHER budgets' savings (cross-budget cascade). The list of
  // currently-selected sources is allocated first-fit in selection order.
  const budgetProgress = expenseProgress[budgetId]
  const budgetRemainingLocal = budgetProgress
    ? budgetProgress.estimatedAmount - budgetProgress.spentAmount
    : 0
  const localBreakdown =
    transactionType === 'expense' && !isExceptional && budgetId
      ? calculateBreakdown(previewSafe, budgetRemainingLocal, savingsAvailable, {
          useSavingsToggle: useSavings,
        })
      : null
  const overflow = localBreakdown?.overflow ?? 0

  /* eslint-disable react-hooks/preserve-manual-memoization -- React Compiler ne peut pas prouver la stabilité référentielle de `overflow` (downstream d'un calculateBreakdown sans memo). Memoization manuelle préservée pour éviter re-allocations dans la boucle. Drop si un futur sprint refactor `localBreakdown` en useMemo (Sprint P4-P5-P6 Phase 2 deferred). */
  const { crossBudgetAllocations, crossBudgetTotal, remainingOvershoot } = useMemo(() => {
    if (overflow <= 0) {
      return { crossBudgetAllocations: [], crossBudgetTotal: 0, remainingOvershoot: 0 }
    }
    const allocations: Array<{ budget_id: string; amount: number }> = []
    let remaining = overflow
    for (const id of crossBudgetSelected) {
      if (remaining <= 0) break
      const b = budgets.find((x) => x.id === id)
      const available = b?.cumulated_savings ?? 0
      const take = Math.min(remaining, available)
      if (take > 0) {
        allocations.push({ budget_id: id, amount: take })
        remaining -= take
      }
    }
    const total = allocations.reduce((s, a) => s + a.amount, 0)
    return {
      crossBudgetAllocations: allocations,
      crossBudgetTotal: total,
      remainingOvershoot: Math.max(0, overflow - total),
    }
  }, [overflow, crossBudgetSelected, budgets])
  /* eslint-enable react-hooks/preserve-manual-memoization */

  const availableCrossBudgets = budgets.filter(
    (b) => b.id !== budgetId && (b.cumulated_savings ?? 0) > 0,
  )

  const toggleCrossBudget = (id: string) => {
    setCrossBudgetSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  // Reset cross-budget selection when key fields change (avoid stale state)
  // when user changes the destination budget or the amount.
  const resetCrossBudget = () => setCrossBudgetSelected([])

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

  const calculateRealReceivedAmount = (incomeId: string): number => {
    return realIncomes
      .filter((income) => income.estimated_income_id === incomeId)
      .reduce((sum, income) => sum + income.amount, 0)
  }

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
   * Step 1: handle expense/income type selection.
   * Resets the form to the new branch and navigates to the next step.
   */
  const handleSelectType = (newType: TransactionType) => {
    const current = form.getValues()
    if (newType === 'expense') {
      form.reset({
        transactionType: 'expense',
        description: current.description ?? '',
        amount: current.amount as never,
        expense_date: todayIso(),
        is_exceptional: false,
        estimated_budget_id: null,
      })
      setUseSavings(false)
      setWizardStep('select-expense-kind')
    } else {
      form.reset({
        transactionType: 'income',
        description: current.description ?? '',
        amount: current.amount as never,
        entry_date: todayIso(),
        is_exceptional: false,
        estimated_income_id: null,
      })
      setUseSavings(false)
      setWizardStep('fields')
    }
  }

  /**
   * Step 2: handle budgeted/exceptional selection for expenses.
   * Sets is_exceptional and navigates to fields step.
   */
  const handleSelectExpenseKind = (exceptional: boolean) => {
    form.setValue('is_exceptional', exceptional)
    if (exceptional) {
      // Clear FK when switching to exceptional
      form.setValue('estimated_budget_id', null)
      setUseSavings(false)
    }
    setWizardStep('fields')
  }

  /**
   * Back navigation: returns to previous step preserving form values.
   */
  const handleBack = () => {
    if (wizardStep === 'fields') {
      // Income flow goes back to select-type ; expense flow goes back to select-expense-kind
      setWizardStep(transactionType === 'expense' ? 'select-expense-kind' : 'select-type')
    } else if (wizardStep === 'select-expense-kind') {
      setWizardStep('select-type')
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
          use_savings: useSavings,
          cross_budget_cascade:
            crossBudgetAllocations.length > 0 ? crossBudgetAllocations : undefined,
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

  // Step title for the dialog header (a11y + i18n future-proof)
  const stepTitle =
    wizardStep === 'select-type'
      ? 'Type de transaction'
      : wizardStep === 'select-expense-kind'
        ? 'Type de dépense'
        : transactionType === 'expense'
          ? 'Ajouter une dépense'
          : 'Ajouter un revenu'

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        hideCloseButton
        className="flex max-h-[80vh] flex-col gap-0 overflow-hidden rounded-xl border-0 p-0 shadow-xl sm:max-w-md sm:rounded-xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 p-6">
          <DialogTitle asChild>
            <h2 className="text-xl font-semibold text-gray-900">{stepTitle}</h2>
          </DialogTitle>
          <ModalCloseX onClose={handleClose} disabled={isSubmitting} variant="ghost" />
        </div>

        {/* Step 1: select transaction type */}
        {wizardStep === 'select-type' && (
          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            <p className="text-sm text-gray-600">Choisissez le type de transaction à ajouter.</p>
            <div className="flex flex-col space-y-3">
              <button
                type="button"
                onClick={() => handleSelectType('expense')}
                className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-4 text-left transition-all hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-red-500"
              >
                <div className="flex items-center space-x-3">
                  <svg
                    className="h-6 w-6 text-red-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6"
                    />
                  </svg>
                  <div>
                    <p className="font-medium text-red-700">Dépense</p>
                    <p className="text-xs text-red-600">Sortie d&apos;argent</p>
                  </div>
                </div>
                <svg
                  className="h-5 w-5 text-red-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>

              <button
                type="button"
                onClick={() => handleSelectType('income')}
                className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-4 text-left transition-all hover:bg-green-100 focus-visible:outline-2 focus-visible:outline-green-500"
              >
                <div className="flex items-center space-x-3">
                  <svg
                    className="h-6 w-6 text-green-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M7 11l5-5m0 0l5 5m-5-5v12"
                    />
                  </svg>
                  <div>
                    <p className="font-medium text-green-700">Revenu</p>
                    <p className="text-xs text-green-600">Entrée d&apos;argent</p>
                  </div>
                </div>
                <svg
                  className="h-5 w-5 text-green-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Step 2: select expense kind (budgeted vs exceptional) */}
        {wizardStep === 'select-expense-kind' && (
          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            <button
              type="button"
              onClick={handleBack}
              className="flex items-center space-x-1 text-sm text-gray-600 hover:text-gray-900"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M15 19l-7-7 7-7"
                />
              </svg>
              <span>Retour</span>
            </button>

            <p className="text-sm text-gray-600">
              La dépense est-elle rattachée à un budget existant ?
            </p>
            <div className="flex flex-col space-y-3">
              <button
                type="button"
                onClick={() => handleSelectExpenseKind(false)}
                className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 p-4 text-left transition-all hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-blue-500"
              >
                <div className="flex items-center space-x-3">
                  <svg
                    className="h-6 w-6 text-blue-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <div>
                    <p className="font-medium text-blue-700">Budgétée</p>
                    <p className="text-xs text-blue-600">Rattachée à un budget existant</p>
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleSelectExpenseKind(true)}
                className="flex items-center justify-between rounded-lg border border-orange-200 bg-orange-50 p-4 text-left transition-all hover:bg-orange-100 focus-visible:outline-2 focus-visible:outline-orange-500"
              >
                <div className="flex items-center space-x-3">
                  <svg
                    className="h-6 w-6 text-orange-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <div>
                    <p className="font-medium text-orange-700">Exceptionnelle</p>
                    <p className="text-xs text-orange-600">
                      Hors budget (impacte directement le RAV)
                    </p>
                  </div>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Step 3: fields */}
        {wizardStep === 'fields' && (
          <form
            onSubmit={form.handleSubmit(onValidSubmit, onInvalidSubmit)}
            className="flex-1 space-y-6 overflow-y-auto p-6"
            noValidate
          >
            <button
              type="button"
              onClick={handleBack}
              disabled={isSubmitting}
              className="flex items-center space-x-1 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M15 19l-7-7 7-7"
                />
              </svg>
              <span>Retour</span>
            </button>

            {/* Summary chip: type + kind (for context) */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 p-3 text-xs">
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 font-medium',
                  transactionType === 'expense'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-green-100 text-green-700',
                )}
              >
                {transactionType === 'expense' ? 'Dépense' : 'Revenu'}
              </span>
              {transactionType === 'expense' && (
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 font-medium',
                    isExceptional ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700',
                  )}
                >
                  {isExceptional ? 'Exceptionnelle' : 'Budgétée'}
                </span>
              )}
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
                    aria-hidden="true"
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

            {/* P5: "Utiliser les économies" toggle — only for budgeted expense
                with a selected budget that has savings */}
            {transactionType === 'expense' &&
              !isExceptional &&
              budgetId &&
              savingsAvailable > 0 && (
                <div className="space-y-2 rounded-lg border border-purple-200 bg-purple-50 p-3">
                  <div className="flex items-start space-x-3">
                    <input
                      type="checkbox"
                      id="use-savings"
                      checked={useSavings}
                      onChange={(e) => setUseSavings(e.target.checked)}
                      disabled={isSubmitting}
                      className="mt-1 h-4 w-4 rounded border-purple-300 bg-white text-purple-600 focus:ring-purple-500"
                    />
                    <div className="flex-1">
                      <Label
                        htmlFor="use-savings"
                        className="cursor-pointer text-sm font-medium text-purple-900"
                      >
                        Utiliser les économies de ce budget
                      </Label>
                      <p className="mt-0.5 text-xs text-purple-700">
                        {savingsAvailable.toLocaleString('fr-FR', {
                          style: 'currency',
                          currency: 'EUR',
                        })}{' '}
                        disponibles. Activer pour puiser dans les économies avant le budget.
                      </p>
                    </div>
                  </div>
                </div>
              )}

            {/* P4 Phase 2: cross-budget cascade section — only when overflow > 0 */}
            {overflow > 0 && availableCrossBudgets.length > 0 && (
              <div className="space-y-3 rounded-lg border border-orange-200 bg-orange-50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-orange-900">
                    Dépassement de{' '}
                    {overflow.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                  </p>
                  <button
                    type="button"
                    onClick={resetCrossBudget}
                    disabled={isSubmitting || crossBudgetSelected.length === 0}
                    className="text-xs text-orange-700 underline disabled:opacity-50"
                  >
                    Réinitialiser
                  </button>
                </div>
                <p className="text-xs text-orange-800">
                  Vous pouvez puiser dans les économies d&apos;autres budgets pour couvrir ce
                  dépassement.
                </p>
                <ul className="space-y-2">
                  {availableCrossBudgets.map((b) => {
                    const isSelected = crossBudgetSelected.includes(b.id)
                    const savings = b.cumulated_savings ?? 0
                    return (
                      <li key={b.id}>
                        <button
                          type="button"
                          onClick={() => toggleCrossBudget(b.id)}
                          disabled={isSubmitting}
                          className={cn(
                            'flex w-full items-center justify-between rounded-md border p-2 text-left text-sm transition-all disabled:opacity-50',
                            isSelected
                              ? 'border-orange-400 bg-orange-100 text-orange-900'
                              : 'border-orange-200 bg-white hover:bg-orange-50',
                          )}
                          aria-pressed={isSelected}
                        >
                          <span>
                            <span className="font-medium">{b.name}</span>
                            <span className="ml-2 text-xs text-orange-700">
                              ({savings.toLocaleString('fr-FR', {
                                style: 'currency',
                                currency: 'EUR',
                              })}{' '}
                              dispo)
                            </span>
                          </span>
                          {isSelected && (
                            <span className="text-xs font-medium text-orange-700">✓</span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
                <div className="flex items-center justify-between rounded bg-white/60 p-2 text-xs">
                  <span className="text-orange-900">
                    Couvert :{' '}
                    {crossBudgetTotal.toLocaleString('fr-FR', {
                      style: 'currency',
                      currency: 'EUR',
                    })}
                  </span>
                  {remainingOvershoot > 0 && (
                    <span className="font-medium text-red-700">
                      Reste à découvert :{' '}
                      {remainingOvershoot.toLocaleString('fr-FR', {
                        style: 'currency',
                        currency: 'EUR',
                      })}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Preview for expenses - show breakdown */}
            {previewSafe > 0 && transactionType === 'expense' && !isExceptional && budgetId && (
              <ExpenseBreakdownPreview
                amount={previewSafe}
                budgetId={budgetId}
                context={context}
                useSavings={useSavings}
              />
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
        )}
      </DialogContent>
    </Dialog>
  )
}
