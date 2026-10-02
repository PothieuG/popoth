'use client'

import { useState } from 'react'
import { useForm, useWatch, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { MODAL_CONTENT_CLASSES } from '@/components/ui/modal-content-classes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DecimalFormInput } from '@/components/ui/DecimalFormInput'
import { ModalCloseX } from '@/components/ui/modal-close-x'
import { useFocusFirstError } from '@/hooks/useFocusFirstError'
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
import {
  OverflowCoverageStep,
  type CoverageMode,
} from '@/components/dashboard/OverflowCoverageStep'
import SalaryReceptionPanel from '@/components/dashboard/SalaryReceptionPanel'
import { needsCoverageStep, useExpenseBreakdownPreview } from '@/hooks/useExpenseBreakdownPreview'
import { now, todayIso } from '@/lib/clock'
import { coverageTotal, EMPTY_COVERAGE, type OverflowCoverage } from '@/lib/expense-breakdown'
import {
  defaultSalaryMonthOption,
  monthName,
  ofMonth,
  salaryMonthOptions,
  toSalaryMonth,
  type MonthRef,
  type SalaryMonthOption,
} from '@/lib/finance/salary-reception'
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
 * - `'cover-overflow'` (Sprint Expense-Overflow-Coverage) : dépense budgétée
 *   qui dépasse le budget + ses économies, avec des réserves disponibles —
 *   choix entre reste à vivre et réserves (curseurs).
 *
 * Form state is preserved via the single `useForm` at the top — step
 * transitions only swap the render.
 */
type WizardStep = 'select-type' | 'select-kind' | 'fields' | 'cover-overflow'

/** Copie des erreurs de `addExpense` (codes renvoyés par l'API). */
const EXPENSE_ERROR_COPY: Record<string, string> = {
  'overflow-coverage-outdated':
    'Les montants disponibles ont changé entre-temps. La répartition a été remise à zéro : vérifiez-la puis validez à nouveau.',
}

const NO_SALARY_OPTIONS: SalaryMonthOption[] = []

/** Codes renvoyés par `POST /api/finance/income/real/receive-salary`. */
const SALARY_ERROR_COPY: Record<string, string> = {
  'salary-already-received': 'Le salaire de ce mois est déjà enregistré.',
  'no-salary-declared': 'Renseignez d’abord votre salaire dans les paramètres.',
  'invalid-salary-month': 'Ce mois ne peut pas être choisi. Rechargez la page.',
}

/** Montant attendu pour un mois encore à recevoir (`0` s'il est déjà réglé). */
const expectedFor = (option: SalaryMonthOption | null): number =>
  option && option.status.kind !== 'received' ? option.status.expected : 0

const capitalize = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1)

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
  // Sprint Salary-Reception (2026-10-02) — 3e nature de revenu, espace perso
  // uniquement. Le formulaire reste celui d'un revenu (montant + date) ; la
  // description et le rattachement sont imposés, et l'envoi part vers
  // `receiveSalary` au lieu de `addIncome`.
  const [isSalaryKind, setIsSalaryKind] = useState(false)
  // Mois financé choisi à la main (`AAAA-MM-01`). `null` = suivre la
  // proposition de l'appli, qui dépend de la date de réception saisie.
  const [pickedSalaryMonth, setPickedSalaryMonth] = useState<string | null>(null)
  // Animation direction for the step transition (Sprint Modal-Polish 2026-05-21).
  // `forward` = slide-in-from-right, `backward` = slide-in-from-left. Set before
  // `setWizardStep` so the new step renders with the matching animate-in class.
  const [stepAnimDir, setStepAnimDir] = useState<'forward' | 'backward'>('forward')
  // Sprint 2026-05-21 / Auto-Use-Savings : le toggle UI "Utiliser les économies"
  // a été retiré — savings utilisées par défaut (mode P5 strict). La constante
  // reste pour passer `use_savings: true` à l'API et à l'aperçu.
  const useSavings = true
  // Sprint Expense-Overflow-Coverage (2026-10-02) — étape « Couvrir le
  // dépassement ». Par défaut le dépassement va sur le reste à vivre : aucune
  // réserve n'est prise sans action. La couverture est liée au couple
  // budget + montant pour lequel elle a été saisie (`coverageKey`) : revenir
  // changer l'un des deux la remet à zéro.
  const [coverMode, setCoverMode] = useState<CoverageMode>('rav')
  const [coverage, setCoverage] = useState<OverflowCoverage>(EMPTY_COVERAGE)
  const [coverageKey, setCoverageKey] = useState<string | null>(null)

  // Wizard récap « Compléter le mois » : les montants affichés (dépensé par
  // budget, reste à vivre) portent sur le mois RECAPÉ, pas sur le mois courant
  // (vide en début de mois). Absent sur les dashboards.
  const recapWindow =
    recapMonth != null && recapYear != null ? { month: recapMonth, year: recapYear } : undefined

  // Hooks for managing data
  const { addExpense, expenses: realExpenses } = useRealExpenses(context)
  const { addIncome, receiveSalary, incomes: realIncomes } = useRealIncomes(context)
  // Solde tirelire courant — sert à plafonner la part finançable + l'aperçu RAV
  // (Sprint Exceptional-Expense-Piggy-Funding). Partage le cache TanStack avec
  // RemainingToLivePreview (même queryKey, fenêtre du récap comprise).
  const { financialData } = useFinancialData(context, recapWindow)
  const piggyBankBalance = financialData?.piggyBank ?? 0
  // Fallback pour éviter les dropdowns vides. Dans le wizard récap, le
  // dépensé (`spent_this_month`) doit être celui du mois RECAPÉ : sans la
  // fenêtre, le menu « Budget associé » affichait celui du mois courant (vide
  // en début de mois), p.ex. 0,00 €/66,43 € pour un budget entamé en septembre.
  const { budgets } = useBudgets(context, recapWindow)
  const { incomes } = useIncomes(context)

  // Sprint Salary-Reception — une paie finance soit le mois ouvert (payé le 3),
  // soit le suivant (payé le 28) : l'appli propose, l'utilisateur tranche. Un
  // groupe n'a pas de salaire : l'option n'existe qu'en perso. Salaire déclaré
  // = ligne virtuelle « Salaire » du reste à vivre (`meta.readOnlyIncomes`).
  const declaredSalary =
    financialData?.meta?.readOnlyIncomes?.find((income) => income.kind === 'salary')?.amount ?? 0
  // Mois ouvert : le mois recapé dans le wizard « Compléter le mois », sinon le
  // mois du jour. Même règle côté serveur (`resolveOpenMonth`).
  const openMonth: MonthRef = recapWindow ?? {
    month: now().getMonth() + 1,
    year: now().getFullYear(),
  }
  const salaryOptions =
    context === 'group'
      ? NO_SALARY_OPTIONS
      : salaryMonthOptions(realIncomes, declaredSalary, openMonth)
  const hasSelectableSalaryMonth = salaryOptions.some((option) => option.status.kind !== 'received')

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
  const watchedEntryDate = useWatch({ control: form.control, name: 'entry_date' })

  // Mois financé retenu : le choix explicite s'il est encore possible, sinon la
  // proposition (ligne en attente → ce mois ; sinon jusqu'au 15 → mois ouvert,
  // après → mois suivant). Le jour vient de la date de réception saisie.
  const receptionDay = Number(String(watchedEntryDate ?? initialDate).slice(8, 10)) || 1
  const selectedSalaryOption: SalaryMonthOption | null =
    salaryOptions.find(
      (option) =>
        toSalaryMonth(option.month) === pickedSalaryMonth && option.status.kind !== 'received',
    ) ?? defaultSalaryMonthOption(salaryOptions, receptionDay)

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

  // Sprint Expense-Overflow-Coverage — dépassement et réserves lus sur la
  // route d'aperçu (fenêtre du récap comprise, même cache que
  // `ExpenseBreakdownPreview`). Encart « Dépassement » + libellé du bouton ;
  // la décision d'afficher l'étape relit la route à l'envoi (`fetchFresh`).
  const isBudgetedExpense = transactionType === 'expense' && !isExceptional && !!budgetId
  const { data: preview, fetchFresh: fetchFreshPreview } = useExpenseBreakdownPreview(
    {
      amount: isBudgetedExpense ? previewSafe : 0,
      budgetId,
      context,
      useSavings,
      month: recapMonth,
      year: recapYear,
    },
    { keepPrevious: true },
  )
  const livePreview = isBudgetedExpense && previewSafe > 0 ? (preview ?? null) : null
  const overflow = livePreview?.overflow ?? 0
  const showsCoverageStep = livePreview != null && needsCoverageStep(livePreview)

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
    setIsSalaryKind(false)
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
    // Retour depuis « Réception du salaire » : on ne laisse pas traîner la
    // description et le montant imposés sur un revenu ordinaire.
    if (isSalaryKind) {
      form.setValue('description', '')
      form.setValue('amount', 0 as never)
      setIsSalaryKind(false)
    }
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
   * Step 2 (revenu, espace perso) : « Réception du salaire ». Le montant est
   * pré-rempli avec le salaire prévu pour le mois proposé — l'utilisateur
   * corrige s'il a reçu plus ou moins. `is_exceptional` / `description` ne
   * servent qu'à satisfaire le schéma du formulaire : l'envoi part vers
   * `receiveSalary`, qui les ignore.
   */
  const handleSelectSalary = () => {
    setIsSalaryKind(true)
    setPickedSalaryMonth(null)
    form.setValue('is_exceptional', true)
    form.setValue('estimated_income_id', null)
    form.setValue('description', 'Salaire')
    form.setValue('amount', expectedFor(selectedSalaryOption) as never)
    setStepAnimDir('forward')
    setWizardStep('fields')
  }

  /**
   * Choix du mois financé. Si le montant est encore celui proposé (non
   * retouché), il suit le salaire attendu du nouveau mois — une ligne en
   * attente peut porter un autre montant que le salaire déclaré du jour.
   */
  const handlePickSalaryMonth = (option: SalaryMonthOption) => {
    if (option.status.kind === 'received') return
    const amountUntouched = previewSafe === expectedFor(selectedSalaryOption)
    setPickedSalaryMonth(toSalaryMonth(option.month))
    if (amountUntouched) {
      form.setValue('amount', expectedFor(option) as never)
    }
  }

  /**
   * Back navigation: returns to previous step preserving form values.
   * Now uniform across expense/income flows since both go through select-kind.
   */
  const handleBack = () => {
    setStepAnimDir('backward')
    setServerError(null)
    if (wizardStep === 'cover-overflow') {
      setWizardStep('fields')
    } else if (wizardStep === 'fields') {
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

        // Sprint Expense-Overflow-Coverage — dépense budgétée : depuis les
        // champs, on relit l'aperçu pour le montant exact envoyé. Dépassement
        // + réserves disponibles → étape « Couvrir le dépassement » au lieu
        // d'ajouter tout de suite.
        const budgetedId = data.is_exceptional ? null : (data.estimated_budget_id ?? null)
        if (budgetedId && wizardStep === 'fields') {
          const fresh = await fetchFreshPreview({
            amount: data.amount,
            budgetId: budgetedId,
            context,
            useSavings,
            month: recapMonth,
            year: recapYear,
          })
          if (needsCoverageStep(fresh)) {
            const key = `${budgetedId}|${data.amount}`
            if (key !== coverageKey) {
              setCoverMode('rav')
              setCoverage(EMPTY_COVERAGE)
              setCoverageKey(key)
            }
            setStepAnimDir('forward')
            setWizardStep('cover-overflow')
            return
          }
        }
        const overflowCoverage =
          budgetedId &&
          wizardStep === 'cover-overflow' &&
          coverMode === 'reserves' &&
          coverageTotal(coverage) > 0
            ? coverage
            : undefined

        const outcome = await addExpense({
          description: data.description,
          amount: data.amount,
          expense_date: data.expense_date,
          estimated_budget_id: data.is_exceptional
            ? undefined
            : (data.estimated_budget_id ?? undefined),
          is_for_group: context === 'group',
          use_savings: useSavings,
          amount_from_piggy_bank: piggyToSend,
          overflow_coverage: overflowCoverage,
          // Sprint Fix-Recap-AddPath-Month — mêmes bornes que celles passées à
          // `ExpenseBreakdownPreview` ci-dessous, sinon l'aperçu et l'écriture
          // calculent la répartition sur deux mois différents. `undefined` hors
          // wizard récap (Dashboard) → fallback today côté serveur.
          month: recapMonth,
          year: recapYear,
        })
        if (!outcome.ok) {
          if (outcome.error === 'overflow-coverage-outdated' && budgetedId) {
            // Réserves ou budget modifiés entre-temps (autre dépense, autre
            // membre du groupe) : montants relus, répartition remise à zéro.
            setCoverage(EMPTY_COVERAGE)
            await fetchFreshPreview({
              amount: data.amount,
              budgetId: budgetedId,
              context,
              useSavings,
              month: recapMonth,
              year: recapYear,
            }).catch(() => undefined)
          }
          setServerError(
            EXPENSE_ERROR_COPY[outcome.error] ?? "Erreur lors de l'ajout de la dépense.",
          )
          return
        }
        success = true
      } else if (isSalaryKind) {
        if (!selectedSalaryOption) {
          setServerError(SALARY_ERROR_COPY['salary-already-received'] ?? null)
          return
        }
        const outcome = await receiveSalary({
          amount: data.amount,
          salary_month: toSalaryMonth(selectedSalaryOption.month).slice(0, 7),
          entry_date: data.entry_date,
        })
        if (!outcome.ok) {
          setServerError(
            SALARY_ERROR_COPY[outcome.error] ?? "Erreur lors de l'enregistrement du salaire.",
          )
          return
        }
        success = true
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

  // Focus sur le premier champ en erreur après une soumission invalide (les
  // champs sont désactivés pendant isSubmitting : cf. useFocusFirstError).
  // Union discriminée : les clés d'erreur diffèrent entre dépense et revenu,
  // le hook caste la clé et RHF résout la ref de la branche active.
  useFocusFirstError(form)

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
        : wizardStep === 'cover-overflow'
          ? 'Couvrir le dépassement'
          : transactionType === 'expense'
            ? 'Ajouter une dépense'
            : isSalaryKind
              ? 'Réception du salaire'
              : 'Ajouter un revenu'

  // Pied commun aux étapes « champs » et « couvrir le dépassement ».
  const renderActions = (submitLabel: string) => (
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
            <span>{submitLabel === 'Suivant' ? 'Calcul...' : 'Ajout...'}</span>
          </div>
        ) : (
          submitLabel
        )}
      </Button>
    </div>
  )

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

                  {/* Sprint Salary-Reception (2026-10-02) — espace perso avec
                      un salaire déclaré. Désactivée (avec la raison) quand les
                      deux mois qu'une paie peut financer sont déjà réglés. */}
                  {salaryOptions.length > 0 && (
                    <button
                      type="button"
                      onClick={handleSelectSalary}
                      disabled={!hasSelectableSalaryMonth}
                      className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-4 text-left transition-all hover:bg-green-100 focus-visible:outline-2 focus-visible:outline-green-500 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:hover:bg-gray-50"
                    >
                      <div className="flex items-center space-x-2">
                        <svg
                          className={cn(
                            'h-6 w-6 shrink-0',
                            hasSelectableSalaryMonth ? 'text-green-600' : 'text-gray-400',
                          )}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
                          />
                        </svg>
                        <div>
                          <p
                            className={cn(
                              'font-medium',
                              hasSelectableSalaryMonth ? 'text-green-700' : 'text-gray-500',
                            )}
                          >
                            Réception du salaire
                          </p>
                          <p
                            className={cn(
                              'text-xs',
                              hasSelectableSalaryMonth ? 'text-green-600' : 'text-gray-500',
                            )}
                          >
                            {hasSelectableSalaryMonth
                              ? 'Votre paie : met le solde à jour, sans gonfler le RAV'
                              : `Salaires ${salaryOptions.map((option) => ofMonth(option.month)).join(' et ')} déjà enregistrés`}
                          </p>
                        </div>
                      </div>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Step 3: fields */}
        {wizardStep === 'fields' && (
          <form
            key="step-fields"
            onSubmit={form.handleSubmit(onValidSubmit)}
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
                {isSalaryKind && (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-700">
                    Salaire
                  </span>
                )}
              </div>

              {/* Réception du salaire : quel mois cette paie finance-t-elle ?
                  Payé le 3 → le mois en cours ; payé le 28 → le mois suivant.
                  L'appli propose (cf. `defaultSalaryMonthOption`), l'utilisateur
                  tranche. Un mois déjà réglé reste visible, grisé, avec la raison. */}
              {isSalaryKind && salaryOptions.length > 0 && (
                <div className="space-y-1.5">
                  <p id="salary-month-label" className="text-sm font-medium text-gray-900">
                    Ce salaire finance
                  </p>
                  <div
                    role="radiogroup"
                    aria-labelledby="salary-month-label"
                    className="grid grid-cols-2 gap-2"
                  >
                    {salaryOptions.map((option) => {
                      const isSelected = option === selectedSalaryOption
                      const isReceived = option.status.kind === 'received'
                      return (
                        <button
                          key={toSalaryMonth(option.month)}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          disabled={isReceived || isSubmitting}
                          onClick={() => handlePickSalaryMonth(option)}
                          className={cn(
                            'rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-green-500',
                            isSelected
                              ? 'border-green-600 bg-green-50'
                              : 'border-gray-200 bg-white hover:bg-gray-50',
                            isReceived && 'cursor-not-allowed bg-gray-50 hover:bg-gray-50',
                          )}
                        >
                          <span
                            className={cn(
                              'block text-sm font-medium',
                              isReceived
                                ? 'text-gray-500'
                                : isSelected
                                  ? 'text-green-800'
                                  : 'text-gray-900',
                            )}
                          >
                            {capitalize(monthName(option.month))}
                          </span>
                          <span className="block text-xs text-gray-500">
                            {isReceived
                              ? 'Déjà reçu'
                              : option.isOpenMonth
                                ? 'Mois en cours'
                                : 'Mois prochain'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

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

              {/* Description — imposée (« Salaire ») pour une réception de salaire */}
              {!isSalaryKind && (
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
              )}

              {/* Amount */}
              <div className="space-y-1.5">
                <Label htmlFor="amount" className="text-sm font-medium text-gray-900">
                  {isSalaryKind ? 'Montant reçu (€)' : 'Montant (€)'}{' '}
                  <span className="text-red-500">*</span>
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

              {/* Sprint Expense-Overflow-Coverage (2026-10-02) — encart violet
                  quand la dépense dépasse le budget + ses économies. Plus de
                  ponction automatique : le choix (reste à vivre ou réserves)
                  se fait à l'étape suivante, ou le dépassement va directement
                  sur le reste à vivre s'il n'y a aucune réserve. */}
              {overflow > 0 && (
                <div className="space-y-1.5 rounded-lg border border-violet-200 bg-violet-50 p-3">
                  <p className="text-sm font-medium text-violet-900">
                    Dépassement de {formatEUR(overflow)}
                  </p>
                  <p className="text-xs text-violet-800">
                    {showsCoverageStep
                      ? 'À l’étape suivante, choisissez : l’imputer au reste à vivre ou puiser dans vos réserves (tirelire, économies de vos autres budgets).'
                      : 'Aucune réserve disponible : il sera imputé au reste à vivre.'}
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

              {/* Réception du salaire : ce que le montant saisi va changer */}
              {isSalaryKind && selectedSalaryOption && (
                <SalaryReceptionPanel
                  option={selectedSalaryOption}
                  received={previewSafe}
                  openMonth={openMonth}
                />
              )}

              {/* Preview for incomes or exceptional expenses - show remaining to live */}
              {previewSafe > 0 &&
                !isSalaryKind &&
                (transactionType === 'income' || isExceptional) && (
                  <RemainingToLivePreview
                    amount={previewSafe}
                    type={transactionType}
                    isExceptional={isExceptional}
                    selectedId={transactionType === 'expense' ? budgetId : incomeId}
                    context={context}
                    fromPiggyBank={
                      transactionType === 'expense' && isExceptional ? effectivePiggy : 0
                    }
                    month={recapMonth}
                    year={recapYear}
                  />
                )}

              {/* Server-side error */}
              {serverError && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="text-sm text-red-700">{serverError}</p>
                </div>
              )}
            </div>

            {renderActions(
              isSalaryKind
                ? 'Enregistrer le salaire'
                : transactionType === 'expense'
                  ? showsCoverageStep
                    ? 'Suivant'
                    : 'Ajouter la dépense'
                  : 'Ajouter le revenu',
            )}
          </form>
        )}

        {/* Step 4 (Sprint Expense-Overflow-Coverage) : couvrir le dépassement */}
        {wizardStep === 'cover-overflow' && (
          <form
            key="step-cover-overflow"
            onSubmit={form.handleSubmit(onValidSubmit)}
            onKeyDown={preventEnterSubmit}
            className={cn(
              'flex min-h-0 flex-auto flex-col overflow-hidden',
              'animate-in fade-in duration-200',
              stepAnimDir === 'forward' ? 'slide-in-from-right-4' : 'slide-in-from-left-4',
            )}
            noValidate
          >
            <div className="min-h-0 flex-auto space-y-4 overflow-y-auto px-6 py-4">
              {livePreview ? (
                <>
                  <OverflowCoverageStep
                    breakdown={livePreview}
                    currentRav={financialData?.remainingToLive ?? null}
                    mode={coverMode}
                    onModeChange={setCoverMode}
                    coverage={coverage}
                    onCoverageChange={setCoverage}
                    disabled={isSubmitting}
                  />
                  <ExpenseBreakdownPreview
                    amount={previewSafe}
                    budgetId={budgetId}
                    context={context}
                    useSavings={useSavings}
                    month={recapMonth}
                    year={recapYear}
                    coverage={coverMode === 'reserves' ? coverage : undefined}
                  />
                </>
              ) : (
                <div className="animate-pulse space-y-2 rounded-lg border border-gray-200 p-4">
                  <div className="h-4 w-3/4 rounded bg-gray-100" />
                  <div className="h-4 w-1/2 rounded bg-gray-100" />
                </div>
              )}

              {serverError && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="text-sm text-red-700">{serverError}</p>
                </div>
              )}
            </div>

            {renderActions('Ajouter la dépense')}
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
