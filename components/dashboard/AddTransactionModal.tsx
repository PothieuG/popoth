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
import RemainingToLivePreview from '@/components/dashboard/RemainingToLivePreview'
import { useProgressData } from '@/hooks/useProgressData'
import CustomDropdown, { type DropdownOption } from '@/components/ui/CustomDropdown'

interface AddTransactionModalProps {
  isOpen: boolean
  onClose: () => void
  context?: 'profile' | 'group'
  onTransactionAdded?: () => void
}

type TransactionType = 'expense' | 'income'

/**
 * Modal for adding new transactions (expenses or income)
 * Adaptive form based on transaction type and exceptional vs budgeted/estimated
 */
export default function AddTransactionModal({
  isOpen,
  onClose,
  context,
  onTransactionAdded
}: AddTransactionModalProps) {
  const [transactionType, setTransactionType] = useState<TransactionType>('expense')
  const [isExceptional, setIsExceptional] = useState(false)
  const [formData, setFormData] = useState({
    description: '',
    amount: '',
    date: new Date().toISOString().split('T')[0],
    budgetId: '',
    incomeId: ''
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Hooks for managing data
  const { addExpense, expenses: realExpenses } = useRealExpenses(context)
  const { addIncome, incomes: realIncomes } = useRealIncomes(context)
  const { expenseProgress, incomeProgress } = useProgressData(context)
  // Fallback pour éviter les dropdowns vides
  const { budgets } = useBudgets(context)
  const { incomes } = useIncomes(context)

  // Calculer le montant pour le preview
  const previewAmount = parseFloat(formData.amount) || 0

  // Calculer les vrais montants dépensés pour chaque budget depuis les dépenses réelles
  const calculateRealSpentAmount = (budgetId: string): number => {
    return realExpenses
      .filter(expense => expense.estimated_budget_id === budgetId)
      .reduce((sum, expense) => sum + expense.amount, 0)
  }

  // Calculer les vrais montants reçus pour chaque revenu depuis les revenus réels
  const calculateRealReceivedAmount = (incomeId: string): number => {
    return realIncomes
      .filter(income => income.estimated_income_id === incomeId)
      .reduce((sum, income) => sum + income.amount, 0)
  }

  // Préparer les options pour les dropdowns - TOUJOURS utiliser les calculs en temps réel
  const budgetOptions: DropdownOption[] = budgets.map(budget => {
    const realSpentAmount = calculateRealSpentAmount(budget.id)
    return {
      id: budget.id,
      name: budget.name,
      type: 'expense' as const,
      spentAmount: realSpentAmount, // 🔥 Calcul en temps réel depuis les dépenses réelles
      estimatedAmount: budget.estimated_amount,
      economyAmount: budget.current_savings || 0 // 🔥 Directement depuis la base
    }
  })

  const incomeOptions: DropdownOption[] = incomes.map(income => {
    const realReceivedAmount = calculateRealReceivedAmount(income.id)
    const bonusAmount = realReceivedAmount - income.estimated_amount
    return {
      id: income.id,
      name: income.name,
      type: 'income' as const,
      receivedAmount: realReceivedAmount, // 🔥 Calcul en temps réel depuis les revenus réels
      estimatedAmount: income.estimated_amount,
      bonusAmount: bonusAmount // 🔥 Calcul en temps réel du bonus
    }
  })


  /**
   * Reset form when modal opens/closes and force refresh
   */
  useEffect(() => {
    if (isOpen) {
      setFormData({
        description: '',
        amount: '',
        date: new Date().toISOString().split('T')[0],
        budgetId: '',
        incomeId: ''
      })
      setIsExceptional(false)
      setTransactionType('expense')
      setError(null)

    }
  }, [isOpen])

  /**
   * Handle form submission
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

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
        success = await addExpense({
          description: formData.description.trim(),
          amount,
          expense_date: formData.date,
          estimated_budget_id: isExceptional ? undefined : formData.budgetId,
          is_for_group: context === 'group'
        })
      } else {
        success = await addIncome({
          description: formData.description.trim(),
          amount,
          entry_date: formData.date,
          estimated_income_id: isExceptional ? undefined : formData.incomeId,
          is_for_group: context === 'group'
        })
      }

      if (success) {
        // L'invalidation automatique du cache se charge du rafraîchissement
        onTransactionAdded?.()
        onClose()
      }
    } catch (err) {
      console.error('Error adding transaction:', err)
      setError('Erreur lors de l\'ajout de la transaction')
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

  if (!isOpen) return null

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
            Ajouter une transaction
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
          {/* Transaction Type Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium text-gray-900">Type de transaction</Label>
            <div className="flex space-x-3">
              <button
                type="button"
                onClick={() => setTransactionType('expense')}
                className={cn(
                  'flex-1 p-4 rounded-lg border text-sm font-medium transition-all',
                  transactionType === 'expense'
                    ? 'bg-red-50 border-red-200 text-red-700'
                    : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                )}
              >
                <div className="flex items-center justify-center space-x-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                  </svg>
                  <span className="font-medium">Dépense</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setTransactionType('income')}
                className={cn(
                  'flex-1 p-4 rounded-lg border text-sm font-medium transition-all',
                  transactionType === 'income'
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                )}
              >
                <div className="flex items-center justify-center space-x-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 11l5-5m0 0l5 5m-5-5v12" />
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
                checked={isExceptional}
                onChange={(e) => setIsExceptional(e.target.checked)}
                className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
              />
              <Label htmlFor="exceptional" className="text-sm text-gray-700 cursor-pointer font-medium">
                {transactionType === 'expense' ? 'Dépense exceptionnelle' : 'Revenu exceptionnel'}
              </Label>
            </div>
            <p className="text-xs text-gray-500 text-center">
              {transactionType === 'expense'
                ? 'Non associée à un budget estimé'
                : 'Non associé à un revenu estimé'
              }
            </p>
          </div>

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
          {previewAmount > 0 && (
            <RemainingToLivePreview
              amount={previewAmount}
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
                  <span>Ajout...</span>
                </div>
              ) : (
                `Ajouter ${transactionType === 'expense' ? 'la dépense' : 'le revenu'}`
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}