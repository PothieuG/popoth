'use client'

import { useForm, useWatch, type FieldErrors, type FieldPath } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DecimalFormInput } from '@/components/ui/DecimalFormInput'
import { ModalCloseX } from '@/components/ui/modal-close-x'
import { updateIncomeFormSchema, type UpdateIncomeForm } from '@/lib/schemas/income'

interface EstimatedIncome {
  id: string
  name: string
  estimated_amount: number
}

interface EditIncomeDialogProps {
  isOpen?: boolean
  onClose: () => void
  onSave: (incomeData: { name: string; estimatedAmount: number }) => Promise<boolean>
  income: EstimatedIncome | null
  currentIncomesTotal: number
}

type UpdateIncomeFormInput = z.input<typeof updateIncomeFormSchema>

/**
 * Dialog d'édition d'un revenu existant.
 *
 * Migrated to Radix Dialog (Sprint Zod-Rollout v8) for focus trap + Esc-to-close +
 * return-focus + role=dialog + aria-modal. Custom close X preserved via
 * `hideCloseButton={true}` on DialogContent.
 *
 * Uses react-hook-form + zodResolver(updateIncomeFormSchema). Edit mode:
 * defaultValues init from the `income` prop (parent must use
 * `key={income.id}` if the target can change). Decimal field via
 * Controller dual-type pattern (Sprint Zod-Rollout v3).
 *
 * `isOpen` defaults to `true` to preserve the legacy parent pattern
 * `{isOpen && income && <Modal />}` until parents migrate to passing
 * isOpen explicitly (Commit 5 PlanningDrawer migration).
 */
export default function EditIncomeDialog({
  isOpen = true,
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

  const handleOpenChange = (open: boolean) => {
    if (!open && !isSubmitting) {
      onClose()
    }
  }

  if (!income) return null

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        hideCloseButton
        className="overflow-hidden rounded-2xl border-0 p-0 shadow-xl sm:max-w-md sm:rounded-2xl"
      >
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
                  aria-hidden="true"
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
                <DialogTitle asChild>
                  <h2 className="text-lg font-bold text-gray-900">Modifier le revenu</h2>
                </DialogTitle>
                <p className="text-sm text-gray-600">Mettez à jour les informations</p>
              </div>
            </div>
            <ModalCloseX onClose={onClose} variant="circle" />
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
            <label htmlFor="income-amount" className="mb-1 block text-sm font-medium text-gray-700">
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
      </DialogContent>
    </Dialog>
  )
}
