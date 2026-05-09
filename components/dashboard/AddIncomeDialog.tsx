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
  currentIncomesTotal,
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
      minimumFractionDigits: 2,
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
      estimatedAmount: parseFloat(incomeAmount),
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
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-600">
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
                  <h3 className="text-lg font-bold text-gray-900">Nouveau Revenu</h3>
                  <p className="text-sm text-gray-600">Ajoutez une source de revenus</p>
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
            {/* Nom du revenu */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Nom du revenu <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={incomeName}
                onChange={(e) => setIncomeName(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ex: Salaire, Freelance, Prime..."
                className={cn(
                  'w-full rounded-xl border px-4 py-3 transition-colors focus:outline-none focus:ring-2',
                  errors.name
                    ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                    : 'border-gray-300 focus:border-green-500 focus:ring-green-500',
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
                    'w-full rounded-xl border px-4 py-3 pr-12 transition-colors focus:outline-none focus:ring-2',
                    errors.amount
                      ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                      : 'border-gray-300 focus:border-green-500 focus:ring-green-500',
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

            {/* Aperçu du total avec nouveau revenu */}
            {incomeAmount && parseFloat(incomeAmount) > 0 && !errors.amount && (
              <div className="rounded-xl border border-green-200 bg-green-50 p-4">
                <h4 className="mb-2 text-sm font-medium text-green-900">
                  Calcul des revenus totaux
                </h4>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Revenus actuels:</span>
                    <span className="font-medium text-green-700">
                      {formatAmount(currentIncomesTotal)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Ce nouveau revenu:</span>
                    <span className="font-medium text-green-700">
                      {formatAmount(parseFloat(incomeAmount))}
                    </span>
                  </div>
                  <div className="mt-2 border-t border-green-200 pt-1">
                    <div className="flex justify-between font-bold">
                      <span className="text-green-900">Total des revenus:</span>
                      <span className="text-green-700">
                        {formatAmount(currentIncomesTotal + parseFloat(incomeAmount))}
                      </span>
                    </div>
                  </div>
                </div>
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
                    ? 'bg-green-600 text-white hover:bg-green-700'
                    : 'cursor-not-allowed bg-gray-300 text-gray-500',
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
