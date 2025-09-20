'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { useBudgets } from '@/hooks/useBudgets'
import { useIncomes } from '@/hooks/useIncomes'
import { useRealExpenses } from '@/hooks/useRealExpenses'
import { useRealIncomes } from '@/hooks/useRealIncomes'
import { RealExpense } from '@/hooks/useRealExpenses'
import { RealIncome } from '@/hooks/useRealIncomes'
import RemainingToLivePreview from '@/components/dashboard/RemainingToLivePreview'
import { useProgressData } from '@/hooks/useProgressData'
import CustomDropdown, { type DropdownOption } from '@/components/ui/CustomDropdown'

interface EditTransactionModalProps {
  isOpen: boolean
  onClose: () => void
  transaction: RealExpense | RealIncome | null
  transactionType: 'expense' | 'income'
  context?: 'profile' | 'group'
  onTransactionUpdated?: () => void
}

/**
 * Modal for editing existing transactions (expenses or income)
 * Pre-fills form with existing transaction data
 */
export default function EditTransactionModal({
  isOpen,
  onClose,
  transaction,
  transactionType,
  context,
  onTransactionUpdated
}: EditTransactionModalProps) {
  const [formData, setFormData] = useState({
    description: '',
    amount: '',
    date: '',
    budgetId: '',
    incomeId: ''
  })
  const [isExceptional, setIsExceptional] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Hooks for managing data
  const { budgets, refreshBudgets } = useBudgets(context)
  const { incomes, refreshIncomes } = useIncomes(context)
  const { updateExpense } = useRealExpenses(context)
  const { updateIncome } = useRealIncomes(context)
  const { expenseProgress, incomeProgress } = useProgressData(context)

  // Calculer le montant pour le preview
  const previewAmount = parseFloat(formData.amount) || 0

  // Préparer les options pour les dropdowns
  const budgetOptions: DropdownOption[] = budgets.map(budget => {
    const progress = expenseProgress[budget.id]
    return {
      id: budget.id,
      name: budget.name,
      type: 'expense' as const,
      spentAmount: progress?.spentAmount || 0,
      estimatedAmount: budget.estimated_amount,
      economyAmount: progress?.economyAmount || Math.max(0, budget.estimated_amount - (progress?.spentAmount || 0))
    }
  })

  const incomeOptions: DropdownOption[] = incomes.map(income => {
    const progress = incomeProgress[income.id]
    return {
      id: income.id,
      name: income.name,
      type: 'income' as const,
      receivedAmount: progress?.receivedAmount || 0,
      estimatedAmount: income.estimated_amount,
      bonusAmount: progress?.bonusAmount || ((progress?.receivedAmount || 0) - income.estimated_amount)
    }
  })

  // Vérifier si c'est une transaction exceptionnelle originale
  const isOriginallyExceptional = transaction?.is_exceptional || false

  /**
   * Load transaction data into form when modal opens or transaction changes
   */
  useEffect(() => {
    if (isOpen && transaction) {
      // Get the date field based on transaction type
      const dateField = transactionType === 'expense'
        ? (transaction as RealExpense).expense_date
        : (transaction as RealIncome).entry_date

      setFormData({
        description: transaction.description || '',
        amount: transaction.amount.toString(),
        date: dateField,
        budgetId: transactionType === 'expense'
          ? (transaction as RealExpense).estimated_budget_id || ''
          : '',
        incomeId: transactionType === 'income'
          ? (transaction as RealIncome).estimated_income_id || ''
          : ''
      })
      setIsExceptional(transaction.is_exceptional || false)
      setError(null)

      // Refresh budgets/incomes to ensure we have latest data
      refreshBudgets()
      refreshIncomes()
    }
  }, [isOpen, transaction, transactionType, refreshBudgets, refreshIncomes])

  /**
   * Handle form submission
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!transaction) return

    // Validation
    if (!formData.description.trim()) {
      setError('La description est requise')
      return
    }

    const amount = parseFloat(formData.amount)
    if (isNaN(amount) || amount <= 0) {
      setError('Le montant doit être un nombre positif')
      return
    }

    if (!isExceptional) {
      if (transactionType === 'expense' && !formData.budgetId) {
        setError('Veuillez sélectionner un budget')
        return
      }
      if (transactionType === 'income' && !formData.incomeId) {
        setError('Veuillez sélectionner un revenu estimé')
        return
      }
    }

    setIsSubmitting(true)

    try {
      let success = false

      if (transactionType === 'expense') {
        success = await updateExpense({
          id: transaction.id,
          description: formData.description.trim(),
          amount,
          expense_date: formData.date,
          estimated_budget_id: isExceptional ? undefined : formData.budgetId
        })
      } else {
        success = await updateIncome({
          id: transaction.id,
          description: formData.description.trim(),
          amount,
          entry_date: formData.date,
          estimated_income_id: isExceptional ? undefined : formData.incomeId
        })
      }

      if (success) {
        onTransactionUpdated?.()
        onClose()
      }
    } catch (err) {
      console.error('Error updating transaction:', err)
      setError('Erreur lors de la mise à jour de la transaction')
    } finally {
      setIsSubmitting(false)
    }
  }

  /**
   * Handle modal close
   */
  const handleClose = () => {
    if (!isSubmitting) {
      onClose()
    }
  }

  if (!isOpen || !transaction) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 bg-white rounded-xl shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            Modifier {transactionType === 'expense' ? 'la dépense' : 'le revenu'}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            disabled={isSubmitting}
            className="p-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </Button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Exceptional Checkbox - Only show for originally exceptional transactions */}
          {isOriginallyExceptional && (
            <div className="flex flex-col items-center space-y-3">
              <div className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  id="exceptional"
                  checked={isExceptional}
                  disabled={true} // Always readonly for originally exceptional
                  className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded opacity-50 cursor-not-allowed"
                />
                <Label
                  htmlFor="exceptional"
                  className="text-sm text-gray-700 font-medium cursor-not-allowed opacity-50"
                >
                  {transactionType === 'expense' ? 'Dépense exceptionnelle' : 'Revenu exceptionnel'}
                </Label>
              </div>
              <p className="text-xs text-gray-500 text-center">
                Transaction originalement exceptionnelle (non modifiable)
              </p>
            </div>
          )}

          {/* Budget/Income Selection - Only shown if not exceptional */}
          {!isExceptional && (
            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-900">
                {transactionType === 'expense' ? 'Budget associé' : 'Revenu estimé associé'}
                <span className="text-red-500 ml-1">*</span>
              </Label>
              <CustomDropdown
                options={transactionType === 'expense' ? budgetOptions : incomeOptions}
                value={transactionType === 'expense' ? formData.budgetId : formData.incomeId}
                onChange={(value) => setFormData(prev => ({
                  ...prev,
                  [transactionType === 'expense' ? 'budgetId' : 'incomeId']: value
                }))}
                placeholder={transactionType === 'expense' ? 'Sélectionner un budget' : 'Sélectionner un revenu estimé'}
                required={!isExceptional}
              />
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
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder={transactionType === 'expense' ? 'Ex: Achat de chaussures' : 'Ex: Salaire mensuel'}
              required
              className="w-full"
            />
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <Label htmlFor="amount" className="text-sm font-medium text-gray-900">
              Montant (€) <span className="text-red-500">*</span>
            </Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              min="0.01"
              value={formData.amount}
              onChange={(e) => setFormData(prev => ({ ...prev, amount: e.target.value }))}
              placeholder="0.00"
              required
              className="w-full"
            />
          </div>

          {/* Date */}
          <div className="space-y-2">
            <Label htmlFor="date" className="text-sm font-medium text-gray-900">
              Date <span className="text-red-500">*</span>
            </Label>
            <div className="relative">
              <Input
                id="date"
                type="date"
                value={formData.date}
                onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
                required
                className="w-full pl-10"
              />
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            </div>
          </div>

          {/* Remaining to Live Preview */}
          {previewAmount > 0 && previewAmount !== transaction?.amount && (
            <RemainingToLivePreview
              amount={previewAmount - (transaction?.amount || 0)} // Différence seulement
              type={transactionType}
              isExceptional={isExceptional}
              selectedId={transactionType === 'expense' ? formData.budgetId : formData.incomeId}
              context={context}
            />
          )}

          {/* Error Display */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-700">{error}</p>
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
              disabled={isSubmitting}
              className={cn(
                'flex-1',
                transactionType === 'expense'
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-green-600 hover:bg-green-700'
              )}
            >
              {isSubmitting ? (
                <div className="flex items-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>Modification...</span>
                </div>
              ) : (
                `Modifier ${transactionType === 'expense' ? 'la dépense' : 'le revenu'}`
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}