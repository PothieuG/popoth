'use client'

import { useState, useMemo } from 'react'
import { cn } from '@/lib/utils'

interface AddIncomeDialogProps {
  isOpen: boolean
  onClose: () => void
  onSave: (income: { name: string; estimatedAmount: number }) => void
  currentIncomesTotal: number
}

/**
 * Dialog pour ajouter un nouveau revenu estimé avec thème vert
 * Formulaire simplifié sans validation de balance complexe
 */
export default function AddIncomeDialog({ 
  isOpen, 
  onClose, 
  onSave,
  currentIncomesTotal
}: AddIncomeDialogProps) {
  const [incomeName, setIncomeName] = useState('')
  const [incomeAmount, setIncomeAmount] = useState('')
  const errors = useMemo(() => {
    const newErrors: { name?: string; amount?: string } = {}
    if (incomeName.trim() && incomeName.trim().length < 2) {
      newErrors.name = 'Le nom doit contenir au moins 2 caractères'
    }
    const amount = parseFloat(incomeAmount)
    if (incomeAmount && (isNaN(amount) || amount <= 0)) {
      newErrors.amount = 'Le montant doit être un nombre positif'
    }
    return newErrors
  }, [incomeName, incomeAmount])

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
      incomeName.trim().length >= 2 &&
      parseFloat(incomeAmount) > 0 &&
      Object.keys(errors).length === 0
    )
  }

  /**
   * Gestion de la sauvegarde
   */
  const handleSave = () => {
    if (!isFormValid()) return

    onSave({
      name: incomeName.trim(),
      estimatedAmount: parseFloat(incomeAmount)
    })

    // Reset du formulaire et fermer le dialog
    setIncomeName('')
    setIncomeAmount('')
    onClose()
  }

  /**
   * Gestion de la fermeture
   */
  const handleClose = () => {
    setIncomeName('')
    setIncomeAmount('')
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
                <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Nouveau Revenu</h3>
                  <p className="text-sm text-gray-600">Ajoutez une source de revenus</p>
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
            {/* Nom du revenu */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Nom du revenu <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={incomeName}
                onChange={(e) => setIncomeName(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ex: Salaire, Freelance, Prime..."
                className={cn(
                  "w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 transition-colors",
                  errors.name 
                    ? "border-red-300 focus:ring-red-500 focus:border-red-500" 
                    : "border-gray-300 focus:ring-green-500 focus:border-green-500"
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
                  type="text"
                  inputMode="decimal"
                  value={incomeAmount}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === '' || /^\d*[.,]?\d*$/.test(v)) {
                      setIncomeAmount(v.replace(',', '.'))
                    }
                  }}
                  onKeyPress={handleKeyPress}
                  placeholder="0.00"
                  className={cn(
                    "w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 transition-colors pr-12",
                    errors.amount 
                      ? "border-red-300 focus:ring-red-500 focus:border-red-500" 
                      : "border-gray-300 focus:ring-green-500 focus:border-green-500"
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

            {/* Aperçu du total avec nouveau revenu */}
            {incomeAmount && parseFloat(incomeAmount) > 0 && !errors.amount && (
              <div className="p-4 rounded-xl border bg-green-50 border-green-200">
                <h4 className="text-sm font-medium text-green-900 mb-2">Calcul des revenus totaux</h4>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Revenus actuels:</span>
                    <span className="font-medium text-green-700">{formatAmount(currentIncomesTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Ce nouveau revenu:</span>
                    <span className="font-medium text-green-700">{formatAmount(parseFloat(incomeAmount))}</span>
                  </div>
                  <div className="border-t border-green-200 pt-1 mt-2">
                    <div className="flex justify-between font-bold">
                      <span className="text-green-900">Total des revenus:</span>
                      <span className="text-green-700">{formatAmount(currentIncomesTotal + parseFloat(incomeAmount))}</span>
                    </div>
                  </div>
                </div>
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
                    ? "bg-green-600 text-white hover:bg-green-700"
                    : "bg-gray-300 text-gray-500 cursor-not-allowed"
                )}
              >
                Ajouter le revenu
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}