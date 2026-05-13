'use client'

import { useMemo } from 'react'
import { useForm, useWatch, type FieldErrors, type FieldPath } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { DecimalFormInput } from '@/components/ui/DecimalFormInput'
import { makeBudgetClientSchema } from '@/lib/schemas/budget'

interface AddBudgetDialogProps {
  isOpen: boolean
  onClose: () => void
  onSave: (budget: { name: string; estimatedAmount: number }) => void
  currentBudgetsTotal: number
  totalEstimatedIncome: number
}

/**
 * Dialog pour ajouter un nouveau budget avec validation en temps réel
 *
 * Uses react-hook-form + zodResolver(makeBudgetClientSchema(...)). The
 * factory refine gates the balance check (newTotal <= totalEstimatedIncome)
 * — schema rebuilt on prop change via useMemo (Sprint Zod-Rollout v3).
 *
 * useWatch for the live preview avoids the form.watch react-compiler
 * incompatibility warning.
 */
export default function AddBudgetDialog({
  isOpen,
  onClose,
  onSave,
  currentBudgetsTotal,
  totalEstimatedIncome,
}: AddBudgetDialogProps) {
  const schema = useMemo(
    () => makeBudgetClientSchema({ currentBudgetsTotal, totalEstimatedIncome }),
    [currentBudgetsTotal, totalEstimatedIncome],
  )
  type FormInput = z.input<typeof schema>
  type FormOutput = z.output<typeof schema>

  const form = useForm<FormInput, undefined, FormOutput>({
    resolver: zodResolver(schema),
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

  const onValidSubmit = (data: FormOutput) => {
    onSave({ name: data.name, estimatedAmount: data.estimatedAmount })
    form.reset({ name: '', estimatedAmount: 0 })
    onClose()
  }

  const handleClose = () => {
    form.reset({ name: '', estimatedAmount: 0 })
    onClose()
  }

  const onInvalidSubmit = (errors: FieldErrors<FormInput>) => {
    const firstErrorKey = Object.keys(errors)[0]
    if (firstErrorKey) {
      form.setFocus(firstErrorKey as FieldPath<FormInput>)
    }
  }

  const watchedAmount = useWatch({ control: form.control, name: 'estimatedAmount' })
  const previewAmount =
    typeof watchedAmount === 'number' ? watchedAmount : parseFloat(String(watchedAmount ?? ''))
  const previewSafe = isNaN(previewAmount) ? 0 : previewAmount
  const newBudgetsTotal = currentBudgetsTotal + previewSafe
  const resultingBalance = totalEstimatedIncome - newBudgetsTotal
  const willBeNegative = resultingBalance < 0
  const showPreview = previewSafe > 0

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
          <form
            onSubmit={form.handleSubmit(onValidSubmit, onInvalidSubmit)}
            className="space-y-4 p-6"
            noValidate
          >
            {/* Nom du budget */}
            <div>
              <label
                htmlFor="add-budget-name"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Nom du budget <span className="text-red-500">*</span>
              </label>
              <Input
                id="add-budget-name"
                type="text"
                {...form.register('name')}
                placeholder="Ex: Alimentation, Transport, Loisirs..."
                disabled={isSubmitting}
                aria-invalid={fieldErrors.name ? 'true' : 'false'}
                aria-describedby={fieldErrors.name ? 'add-budget-name-error' : undefined}
                className={cn(
                  'h-auto rounded-xl px-4 py-3 transition-colors focus-visible:outline-none focus-visible:ring-2',
                  fieldErrors.name
                    ? 'border-red-300 focus-visible:border-red-500 focus-visible:ring-red-500'
                    : 'border-gray-300 focus-visible:border-orange-500 focus-visible:ring-orange-500',
                )}
              />
              {fieldErrors.name && (
                <p
                  id="add-budget-name-error"
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
                htmlFor="add-budget-amount"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Montant estimé mensuel <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <DecimalFormInput
                  control={form.control}
                  name="estimatedAmount"
                  id="add-budget-amount"
                  placeholder="0.00"
                  ariaInvalid={!!fieldErrors.estimatedAmount}
                  ariaDescribedby={
                    fieldErrors.estimatedAmount ? 'add-budget-amount-error' : undefined
                  }
                  className={cn(
                    'h-auto rounded-xl px-4 py-3 pr-12 transition-colors focus-visible:outline-none focus-visible:ring-2',
                    fieldErrors.estimatedAmount
                      ? 'border-red-300 focus-visible:border-red-500 focus-visible:ring-red-500'
                      : 'border-gray-300 focus-visible:border-orange-500 focus-visible:ring-orange-500',
                  )}
                />
                <span className="absolute right-4 top-3.5 text-sm font-medium text-gray-500">
                  €
                </span>
              </div>
              {fieldErrors.estimatedAmount && (
                <p
                  id="add-budget-amount-error"
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

            {/* Calcul en temps réel */}
            {showPreview && (
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
                    <span className="font-medium text-orange-700">{formatAmount(previewSafe)}</span>
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
                  className="flex-1 rounded-xl bg-orange-600 px-4 py-2 font-medium text-white transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Ajouter le budget
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
