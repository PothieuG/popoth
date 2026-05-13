'use client'

import { useForm, useWatch, type FieldErrors, type FieldPath } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { DecimalFormInput } from '@/components/ui/DecimalFormInput'
import { updateIncomeFormSchema, type UpdateIncomeForm } from '@/lib/schemas/income'

interface EstimatedIncome {
  id: string
  name: string
  estimated_amount: number
}

interface EditIncomeDialogProps {
  onClose: () => void
  onSave: (incomeData: { name: string; estimatedAmount: number }) => Promise<boolean>
  income: EstimatedIncome | null
  currentIncomesTotal: number
}

type UpdateIncomeFormInput = z.input<typeof updateIncomeFormSchema>

/**
 * Dialog d'édition d'un revenu existant.
 *
 * Uses react-hook-form + zodResolver(updateIncomeFormSchema). Edit mode:
 * defaultValues init from the `income` prop (parent must use
 * `key={income.id}` if the target can change). Decimal field via
 * Controller dual-type pattern (Sprint Zod-Rollout v3).
 */
export default function EditIncomeDialog({
  onClose,
  onSave,
  income,
  currentIncomesTotal,
}: EditIncomeDialogProps) {
  const form = useForm<UpdateIncomeFormInput, undefined, UpdateIncomeForm>({
    resolver: zodResolver(updateIncomeFormSchema),
    defaultValues: {
      name: income?.name ?? '',
      estimatedAmount: income?.estimated_amount ?? 0,
    },
    mode: 'onSubmit',
  })

  const onValidSubmit = async (data: UpdateIncomeForm) => {
    const success = await onSave({
      name: data.name,
      estimatedAmount: data.estimatedAmount,
    })

    if (success) {
      onClose()
    }
  }

  const onInvalidSubmit = (errors: FieldErrors<UpdateIncomeFormInput>) => {
    const firstErrorKey = Object.keys(errors)[0]
    if (firstErrorKey) {
      form.setFocus(firstErrorKey as FieldPath<UpdateIncomeFormInput>)
    }
  }

  const formatAmount = (amount: number): string => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
    }).format(amount)
  }

  const watchedAmount = useWatch({ control: form.control, name: 'estimatedAmount' })
  const previewAmount =
    typeof watchedAmount === 'number' ? watchedAmount : parseFloat(String(watchedAmount ?? ''))
  const previewSafe = isNaN(previewAmount) ? 0 : previewAmount

  const fieldErrors = form.formState.errors
  const isSubmitting = form.formState.isSubmitting

  if (!income) return null

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
                type="button"
                onClick={onClose}
                aria-label="Fermer"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 transition-colors hover:bg-gray-200"
              >
                <svg
                  className="h-4 w-4 text-gray-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
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
              <label htmlFor="income-name" className="mb-1 block text-sm font-medium text-gray-700">
                Nom du revenu <span className="text-red-500">*</span>
              </label>
              <input
                id="income-name"
                type="text"
                {...form.register('name')}
                placeholder="Ex: Salaire, Freelance, Loyer..."
                aria-invalid={fieldErrors.name ? 'true' : 'false'}
                aria-describedby={fieldErrors.name ? 'edit-income-name-error' : undefined}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500"
                disabled={isSubmitting}
              />
              {fieldErrors.name && (
                <p id="edit-income-name-error" className="mt-1 text-sm text-red-600">
                  {fieldErrors.name.message}
                </p>
              )}
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
                <DecimalFormInput
                  control={form.control}
                  name="estimatedAmount"
                  id="income-amount"
                  placeholder="0.00"
                  ariaInvalid={!!fieldErrors.estimatedAmount}
                  ariaDescribedby={
                    fieldErrors.estimatedAmount ? 'edit-income-amount-error' : undefined
                  }
                  className="h-auto rounded-lg border-gray-300 px-3 py-2 pr-8 focus-visible:border-green-500 focus-visible:ring-2 focus-visible:ring-green-500"
                  disabled={isSubmitting}
                />
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                  <span className="text-sm text-gray-500">€</span>
                </div>
              </div>
              {fieldErrors.estimatedAmount && (
                <p id="edit-income-amount-error" className="mt-1 text-sm text-red-600">
                  {fieldErrors.estimatedAmount.message}
                </p>
              )}
            </div>

            {/* Aperçu financier */}
            <div className="rounded-lg border border-green-200 bg-green-50 p-3">
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Autres revenus:</span>
                  <span className="font-medium text-gray-900">
                    {formatAmount(currentIncomesTotal - income.estimated_amount)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Ce revenu:</span>
                  <span className="font-medium text-green-700">{formatAmount(previewSafe)}</span>
                </div>
                <hr className="border-green-200" />
                <div className="flex justify-between font-bold">
                  <span>Total des revenus:</span>
                  <span className="text-green-700">
                    {formatAmount(currentIncomesTotal - income.estimated_amount + previewSafe)}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex space-x-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1 rounded-lg bg-gray-100 px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex flex-1 items-center justify-center rounded-lg bg-green-600 px-4 py-2 font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? (
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
