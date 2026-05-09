'use client'

import { useState, useEffect, useMemo } from 'react'
import { cn } from '@/lib/utils'

interface EstimatedBudget {
  id: string
  name: string
  estimated_amount: number
}

interface EditBudgetDialogProps {
  isOpen: boolean
  onClose: () => void
  onSave: (budgetData: { name: string; estimatedAmount: number }) => Promise<boolean>
  budget: EstimatedBudget | null
  currentBudgetsTotal: number
  totalEstimatedIncome: number
}

/**
 * Dialog d'édition d'un budget existant
 * Permet de modifier le nom et le montant d'un budget
 */
export default function EditBudgetDialog({
  isOpen,
  onClose,
  onSave,
  budget,
  currentBudgetsTotal,
  totalEstimatedIncome,
}: EditBudgetDialogProps) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // Reset form when dialog opens/closes or budget changes
  useEffect(() => {
    if (isOpen && budget) {
      setName(budget.name)
      setAmount(budget.estimated_amount.toString())
    } else if (!isOpen) {
      setName('')
      setAmount('')
      setIsLoading(false)
    }
  }, [isOpen, budget])

  const validationError = useMemo(() => {
    if (!name && !amount) return ''
    const nameError = !name.trim() ? 'Le nom du budget est requis' : ''
    const amountNum = parseFloat(amount)
    const amountError =
      !amount || isNaN(amountNum) || amountNum <= 0 ? 'Le montant doit être supérieur à 0€' : ''
    const budgetDifference = amountNum - (budget?.estimated_amount || 0)
    const newBudgetsTotal = currentBudgetsTotal + budgetDifference
    const newBalance = totalEstimatedIncome - newBudgetsTotal
    const balanceError =
      newBalance < 0
        ? `Cette modification créerait un déficit de ${Math.abs(newBalance).toFixed(2)}€`
        : ''
    return nameError || amountError || balanceError
  }, [name, amount, currentBudgetsTotal, totalEstimatedIncome, budget])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (validationError) return

    setIsLoading(true)
    const success = await onSave({
      name: name.trim(),
      estimatedAmount: parseFloat(amount),
    })

    if (success) {
      onClose()
    }
    setIsLoading(false)
  }

  if (!isOpen || !budget) return null

  const formatAmount = (amount: number): string => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
    }).format(amount)
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
        <div className="mx-4 w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl">
          {/* Header */}
          <div className="border-b border-gray-200 px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-100">
                  <svg
                    className="h-4 w-4 text-orange-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Modifier le budget</h2>
                  <p className="text-sm text-gray-600">Mettez à jour les informations</p>
                </div>
              </div>
              <button
                onClick={onClose}
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
          <form onSubmit={handleSubmit} className="space-y-4 p-6">
            {/* Nom du budget */}
            <div>
              <label htmlFor="budget-name" className="mb-1 block text-sm font-medium text-gray-700">
                Nom du budget <span className="text-red-500">*</span>
              </label>
              <input
                id="budget-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Alimentation, Transport..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                disabled={isLoading}
              />
            </div>

            {/* Montant */}
            <div>
              <label
                htmlFor="budget-amount"
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                Montant mensuel <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  id="budget-amount"
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === '' || /^\d*[.,]?\d*$/.test(v)) {
                      setAmount(v.replace(',', '.'))
                    }
                  }}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-8 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  disabled={isLoading}
                />
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                  <span className="text-sm text-gray-500">€</span>
                </div>
              </div>
            </div>

            {/* Aperçu financier */}
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Revenus estimés:</span>
                  <span className="font-medium text-gray-900">
                    {formatAmount(totalEstimatedIncome)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Autres budgets:</span>
                  <span className="font-medium text-gray-900">
                    {formatAmount(currentBudgetsTotal - (budget?.estimated_amount || 0))}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Ce budget:</span>
                  <span className="font-medium text-orange-700">
                    {amount ? formatAmount(parseFloat(amount) || 0) : formatAmount(0)}
                  </span>
                </div>
                <hr className="border-orange-200" />
                <div className="flex justify-between font-bold">
                  <span>Reste disponible:</span>
                  <span
                    className={cn(
                      totalEstimatedIncome -
                        currentBudgetsTotal +
                        (budget?.estimated_amount || 0) -
                        (parseFloat(amount) || 0) >=
                        0
                        ? 'text-green-700'
                        : 'text-red-700',
                    )}
                  >
                    {formatAmount(
                      totalEstimatedIncome -
                        currentBudgetsTotal +
                        (budget?.estimated_amount || 0) -
                        (parseFloat(amount) || 0),
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* Message d'erreur */}
            {validationError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-sm font-medium text-red-800">{validationError}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex space-x-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isLoading}
                className="flex-1 rounded-lg bg-gray-100 px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={isLoading || !!validationError || !name.trim() || !amount}
                className="flex flex-1 items-center justify-center rounded-lg bg-orange-600 px-4 py-2 font-medium text-white transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white"></div>
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
