'use client'

import { useState, useEffect } from 'react'
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
  totalEstimatedIncome 
}: AddBudgetDialogProps) {
  const [budgetName, setBudgetName] = useState('')
  const [budgetAmount, setBudgetAmount] = useState('')
  const [errors, setErrors] = useState<{ name?: string; amount?: string; balance?: string }>({})

  /**
   * Calcule le nouveau total des budgets avec le montant en cours de saisie
   */
  const newBudgetsTotal = currentBudgetsTotal + (parseFloat(budgetAmount) || 0)
  
  /**
   * Calcule la balance résultante (revenus - budgets totaux)
   */
  const resultingBalance = totalEstimatedIncome - newBudgetsTotal
  
  /**
   * Vérifie si la balance sera négative
   */
  const willBeNegative = resultingBalance < 0

  /**
   * Validation en temps réel
   */
  useEffect(() => {
    const newErrors: typeof errors = {}

    // Validation du nom
    if (budgetName.trim() && budgetName.trim().length < 2) {
      newErrors.name = 'Le nom doit contenir au moins 2 caractères'
    }

    // Validation du montant
    const amount = parseFloat(budgetAmount)
    if (budgetAmount && (isNaN(amount) || amount <= 0)) {
      newErrors.amount = 'Le montant doit être un nombre positif'
    }

    // Validation de la balance
    if (budgetAmount && amount > 0 && willBeNegative) {
      newErrors.balance = `Ce budget créerait une balance négative de ${formatAmount(Math.abs(resultingBalance))}`
    }

    setErrors(newErrors)
  }, [budgetName, budgetAmount, resultingBalance, willBeNegative])

  /**
   * Formate un montant en euros
   */
  const formatAmount = (amount: number): string => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2
    }).format(amount)
  }

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
      estimatedAmount: parseFloat(budgetAmount)
    }

    onSave(budgetData)

    // Reset du formulaire pour permettre l'ajout d'un autre budget
    setBudgetName('')
    setBudgetAmount('')
    setErrors({})
    // Ne pas fermer le dialog automatiquement
  }

  /**
   * Gestion de la fermeture
   */
  const handleClose = () => {
    setBudgetName('')
    setBudgetAmount('')
    setErrors({})
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
        className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
        onClick={handleClose}
      >
        {/* Dialog */}
        <div 
          className="bg-white rounded-2xl shadow-2xl w-full max-w-md transform transition-all duration-200 scale-100"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-full bg-orange-600 flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Nouveau Budget</h3>
                  <p className="text-sm text-gray-600">Ajoutez une catégorie de dépense</p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
              >
                <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Form */}
          <div className="p-6 space-y-4">
            {/* Nom du budget */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Nom du budget <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={budgetName}
                onChange={(e) => setBudgetName(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ex: Alimentation, Transport, Loisirs..."
                className={cn(
                  "w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 transition-colors",
                  errors.name 
                    ? "border-red-300 focus:ring-red-500 focus:border-red-500" 
                    : "border-gray-300 focus:ring-orange-500 focus:border-orange-500"
                )}
              />
              {errors.name && (
                <p className="text-red-600 text-sm mt-1 flex items-center">
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {errors.name}
                </p>
              )}
            </div>

            {/* Montant estimé */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Montant estimé mensuel <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={budgetAmount}
                  onChange={(e) => setBudgetAmount(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  className={cn(
                    "w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 transition-colors pr-12",
                    errors.amount 
                      ? "border-red-300 focus:ring-red-500 focus:border-red-500" 
                      : "border-gray-300 focus:ring-orange-500 focus:border-orange-500"
                  )}
                />
                <span className="absolute right-4 top-3.5 text-gray-500 text-sm font-medium">€</span>
              </div>
              {errors.amount && (
                <p className="text-red-600 text-sm mt-1 flex items-center">
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {errors.amount}
                </p>
              )}
            </div>

            {/* Calcul en temps réel */}
            {budgetAmount && parseFloat(budgetAmount) > 0 && (
              <div className={cn(
                "p-4 rounded-xl border",
                willBeNegative 
                  ? "bg-red-50 border-red-200" 
                  : "bg-orange-50 border-orange-200"
              )}>
                <h4 className={cn(
                  "font-semibold mb-2",
                  willBeNegative ? "text-red-900" : "text-orange-900"
                )}>
                  Calcul de la balance
                </h4>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Revenus estimés totaux:</span>
                    <span className="font-medium text-green-700">{formatAmount(totalEstimatedIncome)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Budgets actuels:</span>
                    <span className="font-medium text-orange-700">{formatAmount(currentBudgetsTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Ce nouveau budget:</span>
                    <span className="font-medium text-orange-700">{formatAmount(parseFloat(budgetAmount))}</span>
                  </div>
                  <div className="border-t border-gray-300 pt-1 mt-2">
                    <div className="flex justify-between font-bold">
                      <span className={willBeNegative ? "text-red-900" : "text-gray-900"}>Balance résultante:</span>
                      <span className={cn(
                        "font-bold",
                        willBeNegative ? "text-red-700" : resultingBalance > 0 ? "text-green-700" : "text-gray-700"
                      )}>
                        {formatAmount(resultingBalance)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Message d'erreur de balance */}
            {errors.balance && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
                <p className="text-red-800 text-sm font-medium flex items-start">
                  <svg className="w-5 h-5 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>
                    {errors.balance}
                    <br />
                    <span className="text-red-600 text-xs mt-1 block">
                      Ajustez le montant ou ajoutez des revenus pour équilibrer votre budget.
                    </span>
                  </span>
                </p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 rounded-b-2xl">
            <div className="flex space-x-3">
              <button
                onClick={handleClose}
                className="flex-1 px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-xl font-medium hover:bg-gray-50 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleSave}
                disabled={!isFormValid()}
                className={cn(
                  "flex-1 px-4 py-2 rounded-xl font-medium transition-colors",
                  isFormValid()
                    ? "bg-orange-600 text-white hover:bg-orange-700"
                    : "bg-gray-300 text-gray-500 cursor-not-allowed"
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