'use client'

import { useMemo } from 'react'
import { useForm, useWatch, type FieldErrors, type FieldPath } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { MODAL_CONTENT_CLASSES } from '@/components/ui/modal-content-classes'
import { DecimalFormInput } from '@/components/ui/DecimalFormInput'
import { ModalCloseX } from '@/components/ui/modal-close-x'
import { preventEnterSubmit } from '@/lib/forms/prevent-enter-submit'
import { makeBudgetClientSchema } from '@/lib/schemas/budget'
import {
  computeGroupMembersRavPreview,
  computeProjectedGroupTotal,
} from '@/lib/finance/group-members-rav-preview'
import type { GroupMemberRavDetail } from '@/lib/finance'
import GroupMembersRavRecap from './GroupMembersRavRecap'
import RavProjectionRecap from './RavProjectionRecap'

interface EstimatedBudget {
  id: string
  name: string
  estimated_amount: number
}

interface EditBudgetDialogProps {
  isOpen?: boolean
  onClose: () => void
  onSave: (budgetData: { name: string; estimatedAmount: number }) => Promise<boolean>
  budget: EstimatedBudget | null
  /**
   * RAV courant (authoritative) du profil — affiché « actuel → projeté » dans
   * l'encart `RavProjectionRecap`. Ignoré en contexte groupe.
   */
  currentRav?: number
  /** Sprint Group-RAV-Recap — voir AddBudgetDialog. */
  context?: 'profile' | 'group'
  groupMembersRav?: GroupMemberRavDetail[]
  currentGroupTotal?: number
}

/**
 * Dialog d'édition d'un budget existant.
 *
 * Migrated to Radix Dialog (Sprint Zod-Rollout v8) for focus trap + Esc-to-close +
 * return-focus + role=dialog + aria-modal. Custom close X preserved via
 * `hideCloseButton={true}` on DialogContent.
 *
 * Uses react-hook-form + zodResolver(makeBudgetClientSchema()). RAV negative
 * is allowed — only name + amount shape are validated. Edit mode :
 * defaultValues init from `budget` prop ; parent must use
 * `key={budget.id}` to remount on target change.
 *
 * `isOpen` defaults to `true` to preserve the legacy parent pattern
 * `{isOpen && budget && <Modal />}` until parents migrate to passing
 * isOpen explicitly (Commit 5 PlanningDrawer migration).
 */
export default function EditBudgetDialog({
  isOpen = true,
  onClose,
  onSave,
  budget,
  currentRav,
  context,
  groupMembersRav,
  currentGroupTotal,
}: EditBudgetDialogProps) {
  const currentBudgetAmount = budget?.estimated_amount ?? 0
  const schema = useMemo(() => makeBudgetClientSchema(), [])
  type FormInput = z.input<typeof schema>
  type FormOutput = z.output<typeof schema>

  const form = useForm<FormInput, undefined, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: budget?.name ?? '',
      estimatedAmount: budget?.estimated_amount ?? 0,
    },
    mode: 'onSubmit',
  })

  const onValidSubmit = async (data: FormOutput) => {
    const success = await onSave({
      name: data.name,
      estimatedAmount: data.estimatedAmount,
    })

    if (success) {
      onClose()
    }
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
  // Reste à vivre projeté : delta = nouveau − actuel (le budget consomme le RAV).
  const projectedRav = (currentRav ?? 0) - (previewSafe - currentBudgetAmount)

  // Sprint Group-RAV-Recap — projection RAV par membre (groupe uniquement).
  // En édition : delta = newAmount - currentBudgetAmount.
  const isGroupContext = context === 'group'
  const groupRavRows = useMemo(() => {
    if (!isGroupContext || !groupMembersRav || groupMembersRav.length === 0) return []
    const projectedGroupTotal = computeProjectedGroupTotal({
      currentGroupTotal: currentGroupTotal ?? 0,
      currentItemAmount: currentBudgetAmount,
      newItemAmount: previewSafe,
    })
    return computeGroupMembersRavPreview({
      members: groupMembersRav,
      currentGroupTotal: currentGroupTotal ?? 0,
      projectedGroupTotal,
    })
  }, [isGroupContext, groupMembersRav, currentGroupTotal, currentBudgetAmount, previewSafe])

  const fieldErrors = form.formState.errors
  const isSubmitting = form.formState.isSubmitting

  const handleOpenChange = (open: boolean) => {
    if (!open && !isSubmitting) {
      onClose()
    }
  }

  if (!budget) return null

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent hideCloseButton className={MODAL_CONTENT_CLASSES}>
        {/* Header */}
        <div className="shrink-0 border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-100">
                <svg
                  className="h-4 w-4 text-orange-600"
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
                  <h2 className="text-lg font-bold text-gray-900">Modifier le budget</h2>
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
          onKeyDown={preventEnterSubmit}
          className="flex min-h-0 flex-auto flex-col overflow-hidden"
          noValidate
        >
          <div className="min-h-0 flex-auto space-y-3 overflow-y-auto px-6 py-4">
            {/* Nom du budget */}
            <div>
              <label htmlFor="budget-name" className="mb-1 block text-sm font-medium text-gray-700">
                Nom du budget <span className="text-red-500">*</span>
              </label>
              <input
                id="budget-name"
                type="text"
                {...form.register('name')}
                placeholder="Ex: Alimentation, Transport..."
                aria-invalid={fieldErrors.name ? 'true' : 'false'}
                aria-describedby={fieldErrors.name ? 'edit-budget-name-error' : undefined}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-orange-500 focus:ring-2 focus:ring-orange-500 focus:outline-hidden"
                disabled={isSubmitting}
              />
              {fieldErrors.name && (
                <p id="edit-budget-name-error" className="mt-1 text-sm text-red-600">
                  {fieldErrors.name.message}
                </p>
              )}
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
                <DecimalFormInput
                  control={form.control}
                  name="estimatedAmount"
                  id="budget-amount"
                  placeholder="0.00"
                  ariaInvalid={!!fieldErrors.estimatedAmount}
                  ariaDescribedby={
                    fieldErrors.estimatedAmount ? 'edit-budget-amount-error' : undefined
                  }
                  className="h-auto rounded-lg border-gray-300 px-3 py-2 pr-8 focus-visible:border-orange-500 focus-visible:ring-2 focus-visible:ring-orange-500"
                  disabled={isSubmitting}
                />
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                  <span className="text-sm text-gray-500">€</span>
                </div>
              </div>
              {fieldErrors.estimatedAmount && (
                <p id="edit-budget-amount-error" className="mt-1 text-sm text-red-600">
                  {fieldErrors.estimatedAmount.message}
                </p>
              )}
            </div>

            {/* Aperçu — en groupe : RAV projeté par membre (Sprint Group-RAV-Recap).
                En perso : reste à vivre estimé actuel → projeté (vert/rouge). */}
            {isGroupContext ? (
              <GroupMembersRavRecap rows={groupRavRows} showPreview={true} />
            ) : (
              <RavProjectionRecap
                currentRav={currentRav ?? 0}
                projectedRav={projectedRav}
                showPreview={true}
              />
            )}
          </div>

          {/* Actions */}
          <div className="shrink-0 border-t border-gray-200 px-6 py-4">
            <div className="flex space-x-2">
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
                className="flex flex-1 items-center justify-center rounded-lg bg-orange-600 px-4 py-2 font-medium text-white transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white"></div>
                ) : (
                  'Sauvegarder'
                )}
              </button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
