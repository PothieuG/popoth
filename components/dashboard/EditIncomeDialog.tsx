'use client'

import { useMemo, useState } from 'react'

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
  currentIncomesTotal,
}: EditIncomeDialogProps) {
  const [name, setName] = useState(() => income?.name ?? '')
  const [amount, setAmount] = useState(() => income?.estimated_amount?.toString() ?? '')
  const [isLoading, setIsLoading] = useState(false)

  const validationError = useMemo(() => {
    if (!name && !amount) return ''
    const nameError = !name.trim() ? 'Le nom du revenu est requis' : ''
    const amountNum = parseFloat(amount)
    const amountError =
      !amount || isNaN(amountNum) || amountNum <= 0 ? 'Le montant doit être supérieur à 0€' : ''
    return nameError || amountError
  }, [name, amount])

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

  if (!isOpen || !income) return null

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
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100">
                  <svg
                    className="h-4 w-4 text-green-600"
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
                  <h2 className="text-lg font-bold text-gray-900">Modifier le revenu</h2>
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
            {/* Nom du revenu */}
            <div>
              <label htmlFor="income-name" className="mb-1 block text-sm font-medium text-gray-700">
                Nom du revenu <span className="text-red-500">*</span>
              </label>
              <input
                id="income-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Salaire, Freelance, Loyer..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500"
                disabled={isLoading}
              />
            </div>

            {/* Montant */}
            <div>
              <label
                htmlFor="income-amount"
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                Montant mensuel <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  id="income-amount"
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
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-8 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500"
                  disabled={isLoading}
                />
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                  <span className="text-sm text-gray-500">€</span>
                </div>
              </div>
            </div>

            {/* Aperçu financier */}
            <div className="rounded-lg border border-green-200 bg-green-50 p-3">
              <div className="space-y-1 text-sm">
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
                    {formatAmount(
                      currentIncomesTotal -
                        (income?.estimated_amount || 0) +
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
                className="flex flex-1 items-center justify-center rounded-lg bg-green-600 px-4 py-2 font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
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
