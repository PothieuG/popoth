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
import { useFinancialData } from '@/hooks/useFinancialData'
import RemainingToLivePreview from '@/components/dashboard/RemainingToLivePreview'
import ExpenseBreakdownPreview from '@/components/dashboard/ExpenseBreakdownPreview'
import { useProgressData } from '@/hooks/useProgressData'
import { calculateBreakdown } from '@/lib/expense-breakdown'
import CustomDropdown, { type DropdownOption } from '@/components/ui/CustomDropdown'
import { preventEnterSubmit } from '@/lib/forms/prevent-enter-submit'
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
  /**
   * Sprint Complete-Month-Step (2026-05-29) — date par défaut au mount + au
   * switch expense/income. Format ISO YYYY-MM-DD. Si absent, fallback sur
   * `todayIso()` (comportement Dashboard standard). Utilisé par le wizard
   * récap "Compléter le mois" pour défaulter au dernier jour du mois recapé.
   */
  defaultDate?: string
  /**
   * Sprint Complete-Month-Step (2026-05-29) — bornes ISO YYYY-MM-DD passées
   * en `min` / `max` natif au `<input type="date">`. Le mobile date picker
   * iOS/Android contraint visuellement la sélection ; aucune validation
   * Zod côté schema (l'API accepte toute date — c'est de l'UX-guard
   * uniquement, pas de défense en profondeur).
   */
  dateMin?: string
  dateMax?: string
  /**
   * Sprint Fix-Recap-Preview-Month (2026-05-27) — mois recapé 1-12 + année.
   * Quand fourni, l'`ExpenseBreakdownPreview` filtre les dépenses existantes
   * par ce mois plutôt que par `today.month`. Sinon (Dashboard), fallback
   * sur le mois courant côté route. Utilisé par le wizard "Compléter le
   * mois" pour que le récap "Après opération" reflète l'état DB du mois en
   * cours de clôture.
   */
  recapMonth?: number
  recapYear?: number
}

type TransactionType = 'expense' | 'income'

/**
 * Wizard step state (Sprint P4-P5-P6 / Phase B1, extended to income kind).
 * - `'select-type'`: choose expense vs income (always first step)
 * - `'select-kind'`: choose budgeted/regular vs exceptional. Polymorphic on
 *   the active `transactionType` — labels and FK target differ.
 * - `'fields'`: form fields (description, amount, date, FK, savings toggle, etc.)
 *
 * Form state is preserved via the single `useForm` at the top — step
 * transitions only swap the render.
 */
type WizardStep = 'select-type' | 'select-kind' | 'fields'

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
 * `isOpen` defaults to `true` to preserve the legacy parent pattern
 * `{isOpen && <Modal />}` (dashboard + group-dashboard pages).
 */
export default function AddTransactionModal({
  isOpen = true,
  onClose,
  context,
  onTransactionAdded,
  defaultDate,
  dateMin,
  dateMax,
  recapMonth,
  recapYear,
}: AddTransactionModalProps) {
  // Sprint Complete-Month-Step (2026-05-29) — pré-calcule la date d'initialisation
  // du form. Si `defaultDate` est fourni (wizard récap), on l'utilise ; sinon
  // fallback historique sur `todayIso()` (comportement Dashboard standard).
  const initialDate = defaultDate ?? todayIso()
  const [serverError, setServerError] = useState<string | null>(null)
  const [wizardStep, setWizardStep] = useState<WizardStep>('select-type')
  // Sprint Exceptional-Expense-Piggy-Funding (2026-05-29) — toggle "Utiliser ma
  // tirelire" pour les dépenses exceptionnelles. Off → amount_from_piggy_bank
  // forcé à 0 + input masqué ; on → input révélé. Reset à chaque changement de
  // type/kind pour ne pas trainer un état piggy sur une dépense budgétée.
  const [usePiggy, setUsePiggy] = useState(false)
  // Animation direction for the step transition (Sprint Modal-Polish 2026-05-21).
  // `forward` = slide-in-from-right, `backward` = slide-in-from-left. Set before
  // `setWizardStep` so the new step renders with the matching animate-in class.
  const [stepAnimDir, setStepAnimDir] = useState<'forward' | 'backward'>('forward')
  // Sprint 2026-05-21 / Auto-Use-Savings : le toggle UI "Utiliser les économies"
  // a été retiré — savings utilisées par défaut (mode P5 strict). La constante
  // reste pour passer `use_savings: true` à l'API + `useSavingsToggle: true`
  // au helper `calculateBreakdown`.
  const useSavings = true

  // Hooks for managing data
  const { addExpense, expenses: realExpenses } = useRealExpenses(context)
  const { addIncome, incomes: realIncomes } = useRealIncomes(context)
  const { expenseProgress } = useProgressData(context)
  // Solde tirelire courant — sert à plafonner la part finançable + l'aperçu RAV
  // (Sprint Exceptional-Expense-Piggy-Funding). Partage le cache TanStack avec
  // RemainingToLivePreview (même queryKey ['financial-summary', context]).
  const { financialData } = useFinancialData(context)
  const piggyBankBalance = financialData?.piggyBank ?? 0
  // Fallback pour éviter les dropdowns vides
  const { budgets } = useBudgets(context)
  const { incomes } = useIncomes(context)

  const form = useForm<AddTransactionFormInput, undefined, AddTransactionFormOutput>({
    resolver: zodResolver(addTransactionFormSchema),
    defaultValues: {
      transactionType: 'expense',
      description: '',
      amount: 0,
      expense_date: initialDate,
      is_exceptional: false,
      estimated_budget_id: null,
      amount_from_piggy_bank: 0,
    },
    mode: 'onSubmit',
  })

  // Watch reactive fields for previews + RAV validation
  const watchedType = useWatch({ control: form.control, name: 'transactionType' })
  const watchedExceptional = useWatch({ control: form.control, name: 'is_exceptional' })
  const watchedAmount = useWatch({ control: form.control, name: 'amount' })
  const watchedBudgetId = useWatch({ control: form.control, name: 'estimated_budget_id' })
  const watchedIncomeId = useWatch({ control: form.control, name: 'estimated_income_id' })
  const watchedPiggy = useWatch({ control: form.control, name: 'amount_from_piggy_bank' })

  const transactionType = (watchedType ?? 'expense') as TransactionType
  const isExceptional = Boolean(watchedExceptional)
  const previewAmount =
    typeof watchedAmount === 'number' ? watchedAmount : parseFloat(String(watchedAmount ?? ''))
  const previewSafe = isNaN(previewAmount) ? 0 : previewAmount
  const budgetId = (watchedBudgetId as string | null) ?? ''
  const incomeId = (watchedIncomeId as string | null) ?? ''

  // Sprint Exceptional-Expense-Piggy-Funding — part tirelire saisie + bornes.
  const piggyParsed =
    typeof watchedPiggy === 'number' ? watchedPiggy : parseFloat(String(watchedPiggy ?? ''))
  const piggyValue = isNaN(piggyParsed) ? 0 : piggyParsed
  // Section visible uniquement pour une dépense exceptionnelle avec une
  // tirelire non vide. Plafond finançable = min(solde tirelire, montant saisi).
  const showPiggySection = transactionType === 'expense' && isExceptional && piggyBankBalance > 0
  const maxPiggy = Math.min(piggyBankBalance, previewSafe)
  const effectivePiggy = usePiggy ? piggyValue : 0
  const ownMoneyShare = Math.max(0, previewSafe - effectivePiggy)
  const formatEUR = (v: number): string =>
    v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })

  // P5 — local savings of selected budget (for cascade absorption preview + RAV calc)
  const selectedBudget = budgets.find((b) => b.id === budgetId)
  const savingsAvailable = selectedBudget?.cumulated_savings ?? 0

  // Sprint Auto-Cascade-Piggy (2026-05-25) — l'utilisateur ne sélectionne
  // plus manuellement les budgets sources en cas de dépassement. Le serveur
  // applique automatiquement : tirelire d'abord, puis cascade proportionnelle
  // sur les économies des autres budgets. On calcule juste l'overflow ici
  // pour afficher l'encart violet informatif si > 0.
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

  // Sprint Fix-Modal-Dropdown-Align-Dashboard (2026-05-27) — utiliser
  // `budget.spent_this_month` (de l'API `/api/finance/budgets/estimated` qui
  // calcule `carryover_spent_amount + actualSpent_currentMonth`) pour que le
  // dropdown affiche le MÊME ratio "spent/estimated" que le `BudgetProgressIndicator`
  // du dashboard. Avant : `calculateRealSpentAmount` (sum local de `amount_from_budget`
  // sans carryover) → divergeait du dashboard (6200/200 vs 100/200 pour une
  // dette reportée importante). Fallback sur le calcul local si `spent_this_month`
  // n'est pas dans le payload (cas edge : budget tout neuf, POST récent).
  const budgetOptions: DropdownOption[] = budgets.map((budget) => {
    const spentDisplay = budget.spent_this_month ?? calculateRealSpentAmount(budget.id)
    return {
      id: budget.id,
      name: budget.name,
      type: 'expense' as const,
      spentAmount: spentDisplay,
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
    setStepAnimDir('forward')
    setUsePiggy(false)
    if (newType === 'expense') {
      form.reset({
        transactionType: 'expense',
        description: current.description ?? '',
        amount: current.amount as never,
        expense_date: initialDate,
        is_exceptional: false,
        estimated_budget_id: null,
        amount_from_piggy_bank: 0,
      })
      setWizardStep('select-kind')
    } else {
      form.reset({
        transactionType: 'income',
        description: current.description ?? '',
        amount: current.amount as never,
        entry_date: initialDate,
        is_exceptional: false,
        estimated_income_id: null,
      })
      setWizardStep('select-kind')
    }
  }

  /**
   * Step 2: handle regular/exceptional selection. Polymorphic on the active
   * transactionType — expense clears `estimated_budget_id`, income clears
   * `estimated_income_id` when exceptional.
   */
  const handleSelectKind = (exceptional: boolean) => {
    form.setValue('is_exceptional', exceptional)
    if (exceptional) {
      if (transactionType === 'expense') {
        form.setValue('estimated_budget_id', null)
      } else {
        form.setValue('estimated_income_id', null)
      }
    }
    // Reset l'état tirelire à chaque (ré)entrée dans les champs — l'utilisateur
    // ré-opte explicitement (Sprint Exceptional-Expense-Piggy-Funding).
    setUsePiggy(false)
    form.setValue('amount_from_piggy_bank', 0)
    setStepAnimDir('forward')
    setWizardStep('fields')
  }

  /**
   * Back navigation: returns to previous step preserving form values.
   * Now uniform across expense/income flows since both go through select-kind.
   */
  const handleBack = () => {
    setStepAnimDir('backward')
    if (wizardStep === 'fields') {
      setWizardStep('select-kind')
    } else if (wizardStep === 'select-kind') {
      setWizardStep('select-type')
    }
  }

  /**
   * Handle form submission
   */
  const onValidSubmit = async (data: AddTransactionFormOutput) => {
    setServerError(null)

    try {
      let success = false

      if (data.transactionType === 'expense') {
        // Sprint Exceptional-Expense-Piggy-Funding — part tirelire envoyée
        // uniquement pour une exceptionnelle avec le toggle actif. Clamp ≤
        // montant (le refine Zod le garantit déjà) ; guard ≤ solde tirelire
        // pour éviter un 500 (la RPC raise sinon — défense serveur conservée).
        const piggyToSend =
          data.is_exceptional && usePiggy
            ? Math.min(data.amount_from_piggy_bank ?? 0, data.amount)
            : 0
        if (piggyToSend > piggyBankBalance + 0.001) {
          setServerError('Le montant prélevé dépasse le solde de votre tirelire.')
          return
        }
        success = await addExpense({
          description: data.description,
          amount: data.amount,
          expense_date: data.expense_date,
          estimated_budget_id: data.is_exceptional
            ? undefined
            : (data.estimated_budget_id ?? undefined),
          is_for_group: context === 'group',
          use_savings: useSavings,
          amount_from_piggy_bank: piggyToSend,
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
  const piggyError = (fieldErrors as Record<string, { message?: string } | undefined>)[
    'amount_from_piggy_bank'
  ]

  // Step title for the dialog header (a11y + i18n future-proof)
  const stepTitle =
    wizardStep === 'select-type'
      ? 'Type de transaction'
      : wizardStep === 'select-kind'
        ? transactionType === 'expense'
          ? 'Type de dépense'
          : 'Type de revenu'
        : transactionType === 'expense'
          ? 'Ajouter une dépense'
          : 'Ajouter un revenu'

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent hideCloseButton className={MODAL_CONTENT_CLASSES}>
        {/* Header — iOS-like: back button (top-left) + centered title + close */}
        <div className="flex shrink-0 items-center gap-1.5 border-b border-gray-200 px-4 py-3">
          {wizardStep === 'select-type' ? (
            <div className="h-9 w-9 shrink-0" />
          ) : (
            <button
              type="button"
              onClick={handleBack}
              disabled={isSubmitting}
              aria-label="Retour à l'étape précédente"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
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
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
          )}
          <DialogTitle asChild>
            <h2 className="flex-1 text-center text-base font-semibold text-gray-900">
              {stepTitle}
            </h2>
          </DialogTitle>
          <ModalCloseX
            onClose={handleClose}
            disabled={isSubmitting}
            variant="ghost"
            className="h-9 w-9"
          />
        </div>

        {/* Step 1: select transaction type */}
        {wizardStep === 'select-type' && (
          <div
            key="step-select-type"
            className={cn(
              'min-h-0 flex-auto space-y-3 overflow-y-auto px-6 py-4',
              'animate-in fade-in duration-200',
              stepAnimDir === 'forward' ? 'slide-in-from-right-4' : 'slide-in-from-left-4',
            )}
          >
            <p className="text-sm text-gray-600">Choisissez le type de transaction à ajouter.</p>
            <div className="flex flex-col space-y-2">
              <button
                type="button"
                onClick={() => handleSelectType('expense')}
                className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-4 text-left transition-all hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-red-500"
              >
                <div className="flex items-center space-x-2">
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
                <div className="flex items-center space-x-2">
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

        {/* Step 2: select kind (budgeted/regular vs exceptional). Polymorphic
            on transactionType — same step state, different cards + intro. */}
        {wizardStep === 'select-kind' && (
          <div
            key="step-select-kind"
            className={cn(
              'min-h-0 flex-auto space-y-3 overflow-y-auto px-6 py-4',
              'animate-in fade-in duration-200',
              stepAnimDir === 'forward' ? 'slide-in-from-right-4' : 'slide-in-from-left-4',
            )}
          >
            {transactionType === 'expense' ? (
              <>
                <p className="text-sm text-gray-600">
                  La dépense est-elle rattachée à un budget existant ?
                </p>
                <div className="flex flex-col space-y-2">
                  <button
                    type="button"
                    onClick={() => handleSelectKind(false)}
                    className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 p-4 text-left transition-all hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-blue-500"
                  >
                    <div className="flex items-center space-x-2">
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
                    onClick={() => handleSelectKind(true)}
                    className="flex items-center justify-between rounded-lg border border-orange-200 bg-orange-50 p-4 text-left transition-all hover:bg-orange-100 focus-visible:outline-2 focus-visible:outline-orange-500"
                  >
                    <div className="flex items-center space-x-2">
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
              </>
            ) : (
              <>
                <p className="text-sm text-gray-600">
                  Le revenu est-il rattaché à un revenu estimé existant ?
                </p>
                <div className="flex flex-col space-y-2">
                  <button
                    type="button"
                    onClick={() => handleSelectKind(false)}
                    className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 p-4 text-left transition-all hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-blue-500"
                  >
                    <div className="flex items-center space-x-2">
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
                        <p className="font-medium text-blue-700">Régulier</p>
                        <p className="text-xs text-blue-600">Lié à un revenu estimé existant</p>
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSelectKind(true)}
                    className="flex items-center justify-between rounded-lg border border-orange-200 bg-orange-50 p-4 text-left transition-all hover:bg-orange-100 focus-visible:outline-2 focus-visible:outline-orange-500"
                  >
                    <div className="flex items-center space-x-2">
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
                        <p className="font-medium text-orange-700">Exceptionnel</p>
                        <p className="text-xs text-orange-600">
                          Hors revenu estimé (ajoute directement au RAV)
                        </p>
                      </div>
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Step 3: fields */}
        {wizardStep === 'fields' && (
          <form
            key="step-fields"
            onSubmit={form.handleSubmit(onValidSubmit, onInvalidSubmit)}
            onKeyDown={preventEnterSubmit}
            className={cn(
              'flex min-h-0 flex-auto flex-col overflow-hidden',
              'animate-in fade-in duration-200',
              stepAnimDir === 'forward' ? 'slide-in-from-right-4' : 'slide-in-from-left-4',
            )}
            noValidate
          >
            <div className="min-h-0 flex-auto space-y-4 overflow-y-auto px-6 py-4">
              {/* Summary chip: type + kind (for context) */}
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-gray-50 p-3 text-xs">
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
                <div className="space-y-1.5">
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
              <div className="space-y-1.5">
                <Label htmlFor="description" className="text-sm font-medium text-gray-900">
                  Description <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="description"
                  type="text"
                  {...form.register('description')}
                  placeholder={
                    transactionType === 'expense'
                      ? 'Ex: Achat de chaussures'
                      : 'Ex: Salaire mensuel'
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
                  ariaDescribedby={fieldErrors.amount ? 'add-transaction-amount-error' : undefined}
                />
                {fieldErrors.amount && (
                  <p id="add-transaction-amount-error" className="text-sm text-red-600">
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
                      min={dateMin}
                      max={dateMax}
                      aria-invalid={dateError ? 'true' : 'false'}
                      aria-describedby={dateError ? 'add-transaction-date-error' : undefined}
                      className="w-full pl-10"
                    />
                  ) : (
                    <Input
                      id="date"
                      type="date"
                      {...form.register('entry_date')}
                      min={dateMin}
                      max={dateMax}
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

              {/* Sprint Exceptional-Expense-Piggy-Funding (2026-05-29) — option
                  pour financer une dépense exceptionnelle avec la tirelire.
                  Visible seulement si exceptionnelle + solde tirelire > 0. Le
                  toggle révèle un champ plafonné à min(solde, montant) ; la
                  part tirelire ne pèse pas sur le RAV (cf. financial-data.ts). */}
              {showPiggySection && (
                <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-violet-900">Utiliser ma tirelire</p>
                      <p className="text-xs text-violet-700">
                        Disponible : {formatEUR(piggyBankBalance)}
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={usePiggy}
                      aria-label="Utiliser ma tirelire pour cette dépense"
                      onClick={() => {
                        setUsePiggy((prev) => {
                          const next = !prev
                          form.setValue('amount_from_piggy_bank', next ? maxPiggy : 0, {
                            shouldValidate: false,
                          })
                          return next
                        })
                      }}
                      className={cn(
                        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
                        usePiggy ? 'bg-violet-600' : 'bg-gray-300',
                      )}
                    >
                      <span
                        className={cn(
                          'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                          usePiggy ? 'translate-x-5' : 'translate-x-0.5',
                        )}
                      />
                    </button>
                  </div>

                  {usePiggy && (
                    <div className="space-y-1.5">
                      <Label htmlFor="piggy-amount" className="text-sm font-medium text-violet-900">
                        Montant pris dans la tirelire (€)
                      </Label>
                      <DecimalFormInput
                        control={form.control}
                        name="amount_from_piggy_bank"
                        id="piggy-amount"
                        placeholder="0.00"
                        className="w-full"
                        ariaInvalid={!!piggyError}
                        ariaDescribedby={piggyError ? 'add-transaction-piggy-error' : undefined}
                      />
                      <p className="text-xs text-violet-800">
                        Reste à votre charge : {formatEUR(ownMoneyShare)}
                        {piggyBankBalance < previewSafe && (
                          <> · Maximum finançable&nbsp;: {formatEUR(maxPiggy)}</>
                        )}
                      </p>
                      {piggyError && (
                        <p id="add-transaction-piggy-error" className="text-sm text-red-600">
                          {piggyError.message}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Sprint Auto-Cascade-Piggy (2026-05-25) — encart violet
                  informatif quand la dépense dépasse le budget + ses
                  économies locales. La tirelire est puisée en priorité,
                  puis les économies des autres budgets proportionnellement.
                  Pas de sélection manuelle — détail dans Impact/Après. */}
              {overflow > 0 && (
                <div className="space-y-1.5 rounded-lg border border-violet-200 bg-violet-50 p-3">
                  <p className="text-sm font-medium text-violet-900">
                    Dépassement de{' '}
                    {overflow.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                  </p>
                  <p className="text-xs text-violet-800">
                    La tirelire sera utilisée en priorité, puis les économies des autres budgets
                    proportionnellement. Le détail apparaît ci-dessous.
                  </p>
                </div>
              )}

              {/* Preview for expenses - show breakdown */}
              {previewSafe > 0 && transactionType === 'expense' && !isExceptional && budgetId && (
                <ExpenseBreakdownPreview
                  amount={previewSafe}
                  budgetId={budgetId}
                  context={context}
                  useSavings={useSavings}
                  month={recapMonth}
                  year={recapYear}
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
                  fromPiggyBank={
                    transactionType === 'expense' && isExceptional ? effectivePiggy : 0
                  }
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
