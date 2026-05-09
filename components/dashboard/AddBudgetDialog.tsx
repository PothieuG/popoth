'use client'

import { useState, useMemo } from 'react'
import { cn } from '@/lib/utils'

interface AddBudgetDialogProps {
  isOpen: boolean
  onClose: () => void
  onSave: (budget: { name: string; estimatedAmount: number }) => void
  currentBudgetsTotal: number
  totalEstimatedIncome: number
}

/**
 * Dialog pour ajouter un nouveau budget avec validation en temps réel
 * Empêche la création si le total des budgets dépasse les revenus estimés
 */
export default function AddBudgetDialog({
  isOpen,
  onClose,
  onSave,
  currentBudgetsTotal,
  totalEstimatedIncome,
}: AddBudgetDialogProps) {
  const [budgetName, setBudgetName] = useState('')
  const [budgetAmount, setBudgetAmount] = useState('')
  /**
   * Formate un montant en euros
   */
  const formatAmount = (amount: number): string => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
    }).format(amount)
  }

  const newBudgetsTotal = currentBudgetsTotal + (parseFloat(budgetAmount) || 0)
  const resultingBalance = totalEstimatedIncome - newBudgetsTotal
  const willBeNegative = resultingBalance < 0

  const errors = useMemo(() => {
    const newErrors: { name?: string; amount?: string; balance?: string } = {}
    if (budgetName.trim() && budgetName.trim().length < 2) {
      newErrors.name = 'Le nom doit contenir au moins 2 caractères'
    }
    const amount = parseFloat(budgetAmount)
    if (budgetAmount && (isNaN(amount) || amount <= 0)) {
      newErrors.amount = 'Le montant doit être un nombre positif'
    }
    if (budgetAmount && amount > 0 && willBeNegative) {
      newErrors.balance = `Impossible d'ajouter ce budget : votre reste à vivre (sans économies) deviendrait négatif de ${formatAmount(Math.abs(resultingBalance))}. Réduisez le montant ou ajoutez des revenus.`
    }
    return newErrors
  }, [budgetName, budgetAmount, resultingBalance, willBeNegative])

  /**
   * Vérifie si le formulaire est valide pour la sauvegarde
   */
  const isFormValid = () => {
    return (
      budgetName.trim().length >= 2 &&
      parseFloat(budgetAmount) > 0 &&
      !willBeNegative &&
      Object.keys(errors).length === 0
    )
  }

  /**
   * Gestion de la sauvegarde
   */
  const handleSave = () => {
    if (!isFormValid()) {
      return
    }

    const budgetData = {
      name: budgetName.trim(),
      estimatedAmount: parseFloat(budgetAmount),
    }

    onSave(budgetData)

    // Reset du formulaire et fermer le dialog
    setBudgetName('')
    setBudgetAmount('')
    onClose()
  }

  /**
   * Gestion de la fermeture
   */
  const handleClose = () => {
    setBudgetName('')
    setBudgetAmount('')
    onClose()
  }

  /**
   * Gestion de la soumission par Enter
   */
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && isFormValid()) {
      handleSave()
    }
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
        onClick={handleClose}
      >
        {/* Dialog */}
        <div
          className="w-full max-w-md scale-100 transform rounded-2xl bg-white shadow-2xl transition-all duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="border-b border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-600">
                  <svg
                    className="h-4 w-4 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                    />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Nouveau Budget</h3>
                  <p className="text-sm text-gray-600">Ajoutez une catégorie de dépense</p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 transition-colors hover:bg-gray-200"
              >
                <svg
                  className="h-4 w-4 text-gray-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Form */}
          <div className="space-y-4 p-6">
            {/* Nom du budget */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Nom du budget <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={budgetName}
                onChange={(e) => setBudgetName(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ex: Alimentation, Transport, Loisirs..."
                className={cn(
                  'w-full rounded-xl border px-4 py-3 transition-colors focus:outline-none focus:ring-2',
                  errors.name
                    ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                    : 'border-gray-300 focus:border-orange-500 focus:ring-orange-500',
                )}
              />
              {errors.name && (
                <p className="mt-1 flex items-center text-sm text-red-600">
                  <svg
                    className="mr-1 h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  {errors.name}
                </p>
              )}
            </div>

            {/* Montant estimé */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Montant estimé mensuel <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  value={budgetAmount}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === '' || /^\d*[.,]?\d*$/.test(v)) {
                      setBudgetAmount(v.replace(',', '.'))
                    }
                  }}
                  onKeyPress={handleKeyPress}
                  placeholder="0.00"
                  className={cn(
                    'w-full rounded-xl border px-4 py-3 pr-12 transition-colors focus:outline-none focus:ring-2',
                    errors.amount
                      ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                      : 'border-gray-300 focus:border-orange-500 focus:ring-orange-500',
                  )}
                />
                <span className="absolute right-4 top-3.5 text-sm font-medium text-gray-500">
                  €
                </span>
              </div>
              {errors.amount && (
                <p className="mt-1 flex items-center text-sm text-red-600">
                  <svg
                    className="mr-1 h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  {errors.amount}
                </p>
              )}
            </div>

            {/* Calcul en temps réel */}
            {budgetAmount && parseFloat(budgetAmount) > 0 && (
              <div
                className={cn(
                  'rounded-xl border p-4',
                  willBeNegative ? 'border-red-200 bg-red-50' : 'border-orange-200 bg-orange-50',
                )}
              >
                <h4
                  className={cn(
                    'mb-2 font-semibold',
                    willBeNegative ? 'text-red-900' : 'text-orange-900',
                  )}
                >
                  Calcul de la balance
                </h4>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Revenus estimés totaux:</span>
                    <span className="font-medium text-green-700">
                      {formatAmount(totalEstimatedIncome)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Budgets actuels:</span>
                    <span className="font-medium text-orange-700">
                      {formatAmount(currentBudgetsTotal)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Ce nouveau budget:</span>
                    <span className="font-medium text-orange-700">
                      {formatAmount(parseFloat(budgetAmount))}
                    </span>
                  </div>
                  <div className="mt-2 border-t border-gray-300 pt-1">
                    <div className="flex justify-between font-bold">
                      <span className={willBeNegative ? 'text-red-900' : 'text-gray-900'}>
                        Balance résultante:
                      </span>
                      <span
                        className={cn(
                          'font-bold',
                          willBeNegative
                            ? 'text-red-700'
                            : resultingBalance > 0
                              ? 'text-green-700'
                              : 'text-gray-700',
                        )}
                      >
                        {formatAmount(resultingBalance)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Message d'erreur de balance */}
            {errors.balance && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="flex items-start text-sm font-medium text-red-800">
                  <svg
                    className="mr-2 mt-0.5 h-5 w-5 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span>
                    {errors.balance}
                    <br />
                    <span className="mt-1 block text-xs text-red-600">
                      Ajustez le montant ou ajoutez des revenus pour équilibrer votre budget.
                    </span>
                  </span>
                </p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="rounded-b-2xl border-t border-gray-200 bg-gray-50 px-6 py-4">
            <div className="flex space-x-3">
              <button
                onClick={handleClose}
                className="flex-1 rounded-xl border border-gray-300 bg-white px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                onClick={handleSave}
                disabled={!isFormValid()}
                className={cn(
                  'flex-1 rounded-xl px-4 py-2 font-medium transition-colors',
                  isFormValid()
                    ? 'bg-orange-600 text-white hover:bg-orange-700'
                    : 'cursor-not-allowed bg-gray-300 text-gray-500',
                )}
              >
                Ajouter le budget
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
