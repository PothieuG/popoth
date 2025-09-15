'use client'

import { useState, useEffect } from 'react'

interface EstimatedIncome {
  id: string
  name: string
  estimated_amount: number
}

interface EditIncomeDialogProps {
  isOpen: boolean
  onClose: () => void
  onSave: (incomeData: { name: string; estimatedAmount: number }) => Promise<boolean>
  income: EstimatedIncome | null
  currentIncomesTotal: number
}

/**
 * Dialog d'édition d'un revenu existant
 * Permet de modifier le nom et le montant d'un revenu
 */
export default function EditIncomeDialog({
  isOpen,
  onClose,
  onSave,
  income,
  currentIncomesTotal
}: EditIncomeDialogProps) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [validationError, setValidationError] = useState('')

  // Reset form when dialog opens/closes or income changes
  useEffect(() => {
    if (isOpen && income) {
      setName(income.name)
      setAmount(income.estimated_amount.toString())
      setValidationError('')
    } else if (!isOpen) {
      setName('')
      setAmount('')
      setValidationError('')
      setIsLoading(false)
    }
  }, [isOpen, income])

  /**
   * Validation du formulaire en temps réel
   */
  const validateForm = () => {
    const nameError = !name.trim() ? 'Le nom du revenu est requis' : ''
    const amountNum = parseFloat(amount)
    const amountError = !amount || isNaN(amountNum) || amountNum <= 0
      ? 'Le montant doit être supérieur à 0€' : ''

    const firstError = nameError || amountError
    setValidationError(firstError)
    return !firstError
  }

  // Validation en temps réel
  useEffect(() => {
    if (name || amount) {
      validateForm()
    }
  }, [name, amount])

  /**
   * Soumission du formulaire
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) return

    setIsLoading(true)
    const success = await onSave({
      name: name.trim(),
      estimatedAmount: parseFloat(amount)
    })

    if (success) {
      onClose()
    }
    setIsLoading(false)
  }

  if (!isOpen || !income) return null

  const formatAmount = (amount: number): string => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2
    }).format(amount)
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl max-w-md w-full mx-4 overflow-hidden">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Modifier le revenu</h2>
                  <p className="text-sm text-gray-600">Mettez à jour les informations</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
              >
                <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {/* Nom du revenu */}
            <div>
              <label htmlFor="income-name" className="block text-sm font-medium text-gray-700 mb-1">
                Nom du revenu <span className="text-red-500">*</span>
              </label>
              <input
                id="income-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Salaire, Freelance, Loyer..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                disabled={isLoading}
              />
            </div>

            {/* Montant */}
            <div>
              <label htmlFor="income-amount" className="block text-sm font-medium text-gray-700 mb-1">
                Montant mensuel <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  id="income-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 pr-8 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  disabled={isLoading}
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <span className="text-gray-500 text-sm">€</span>
                </div>
              </div>
            </div>

            {/* Aperçu financier */}
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
              <div className="text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-600">Autres revenus:</span>
                  <span className="font-medium text-gray-900">
                    {formatAmount(currentIncomesTotal - (income?.estimated_amount || 0))}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Ce revenu:</span>
                  <span className="font-medium text-green-700">
                    {amount ? formatAmount(parseFloat(amount) || 0) : formatAmount(0)}
                  </span>
                </div>
                <hr className="border-green-200" />
                <div className="flex justify-between font-bold">
                  <span>Total des revenus:</span>
                  <span className="text-green-700">
                    {formatAmount(currentIncomesTotal - (income?.estimated_amount || 0) + (parseFloat(amount) || 0))}
                  </span>
                </div>
              </div>
            </div>

            {/* Message d'erreur */}
            {validationError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-800 text-sm font-medium">{validationError}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex space-x-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isLoading}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={isLoading || !!validationError || !name.trim() || !amount}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {isLoading ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                ) : (
                  'Sauvegarder'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}