'use client'

import { useForm, useWatch, type FieldErrors, type FieldPath } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { cn } from '@/lib/utils'
import { DecimalFormInput } from '@/components/ui/DecimalFormInput'
import { createIncomeFormSchema, type CreateIncomeForm } from '@/lib/schemas/income'

interface AddIncomeDialogProps {
  isOpen: boolean
  onClose: () => void
  onSave: (income: { name: string; estimatedAmount: number }) => void
  currentIncomesTotal: number
}

// z.coerce.number() schemas have a distinct input/output — see EditBalanceModal.
type CreateIncomeFormInput = z.input<typeof createIncomeFormSchema>

/**
 * Dialog pour ajouter un nouveau revenu estimé avec thème vert
 *
 * Uses react-hook-form + zodResolver(createIncomeFormSchema). Decimal field
 * `estimatedAmount` via Controller dual-type pattern (Sprint Zod-Rollout v3).
 */
export default function AddIncomeDialog({
  isOpen,
  onClose,
  onSave,
  currentIncomesTotal,
}: AddIncomeDialogProps) {
  const form = useForm<CreateIncomeFormInput, undefined, CreateIncomeForm>({
    resolver: zodResolver(createIncomeFormSchema),
    defaultValues: { name: '', estimatedAmount: 0 },
    mode: 'onSubmit',
  })

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

  const onValidSubmit = (data: CreateIncomeForm) => {
    onSave({ name: data.name, estimatedAmount: data.estimatedAmount })
    form.reset({ name: '', estimatedAmount: 0 })
    onClose()
  }

  const handleClose = () => {
    form.reset({ name: '', estimatedAmount: 0 })
    onClose()
  }

  const onInvalidSubmit = (errors: FieldErrors<CreateIncomeFormInput>) => {
    const firstErrorKey = Object.keys(errors)[0]
    if (firstErrorKey) {
      form.setFocus(firstErrorKey as FieldPath<CreateIncomeFormInput>)
    }
  }

  const watchedAmount = useWatch({ control: form.control, name: 'estimatedAmount' })
  const previewAmount =
    typeof watchedAmount === 'number' ? watchedAmount : parseFloat(String(watchedAmount ?? ''))
  const showPreview = !isNaN(previewAmount) && previewAmount > 0

  const fieldErrors = form.formState.errors
  const isSubmitting = form.formState.isSubmitting

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
          <form
            onSubmit={form.handleSubmit(onValidSubmit, onInvalidSubmit)}
            className="space-y-4 p-6"
            noValidate
          >
            {/* Nom du revenu */}
            <div>
              <label
                htmlFor="add-income-name"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Nom du revenu <span className="text-red-500">*</span>
              </label>
              <input
                id="add-income-name"
                type="text"
                {...form.register('name')}
                placeholder="Ex: Salaire, Freelance, Prime..."
                aria-invalid={fieldErrors.name ? 'true' : 'false'}
                aria-describedby={fieldErrors.name ? 'add-income-name-error' : undefined}
                className={cn(
                  'w-full rounded-xl border px-4 py-3 transition-colors focus:outline-none focus:ring-2',
                  fieldErrors.name
                    ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                    : 'border-gray-300 focus:border-green-500 focus:ring-green-500',
                )}
              />
              {fieldErrors.name && (
                <p
                  id="add-income-name-error"
                  className="mt-1 flex items-center text-sm text-red-600"
                >
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
                  {fieldErrors.name.message}
                </p>
              )}
            </div>

            {/* Montant estimé */}
            <div>
              <label
                htmlFor="add-income-amount"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Montant estimé mensuel <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <DecimalFormInput
                  control={form.control}
                  name="estimatedAmount"
                  id="add-income-amount"
                  placeholder="0.00"
                  ariaInvalid={!!fieldErrors.estimatedAmount}
                  ariaDescribedby={
                    fieldErrors.estimatedAmount ? 'add-income-amount-error' : undefined
                  }
                  className={cn(
                    'h-auto rounded-xl px-4 py-3 pr-12 transition-colors focus-visible:outline-none focus-visible:ring-2',
                    fieldErrors.estimatedAmount
                      ? 'border-red-300 focus-visible:border-red-500 focus-visible:ring-red-500'
                      : 'border-gray-300 focus-visible:border-green-500 focus-visible:ring-green-500',
                  )}
                />
                <span className="absolute right-4 top-3.5 text-sm font-medium text-gray-500">
                  €
                </span>
              </div>
              {fieldErrors.estimatedAmount && (
                <p
                  id="add-income-amount-error"
                  className="mt-1 flex items-center text-sm text-red-600"
                >
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
                  {fieldErrors.estimatedAmount.message}
                </p>
              )}
            </div>

            {/* Aperçu du total avec nouveau revenu */}
            {showPreview && (
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
                      {formatAmount(previewAmount)}
                    </span>
                  </div>
                  <div className="mt-2 border-t border-green-200 pt-1">
                    <div className="flex justify-between font-bold">
                      <span className="text-green-900">Total des revenus:</span>
                      <span className="text-green-700">
                        {formatAmount(currentIncomesTotal + previewAmount)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="-mx-6 -mb-6 mt-6 rounded-b-2xl border-t border-gray-200 bg-gray-50 px-6 py-4">
              <div className="flex space-x-3">
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 rounded-xl border border-gray-300 bg-white px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  disabled={isSubmitting}
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 rounded-xl bg-green-600 px-4 py-2 font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Ajouter le revenu
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
