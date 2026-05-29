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
import { updateIncomeFormSchema, type UpdateIncomeForm } from '@/lib/schemas/income'
import {
  computeGroupMembersContributionsPreview,
  computeProjectedGroupIncomeTotal,
} from '@/lib/finance/group-members-contributions-preview'
import type { GroupMemberRavDetail } from '@/lib/finance'
import GroupMembersContributionsRecap from './GroupMembersContributionsRecap'
import RavProjectionRecap from './RavProjectionRecap'

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
  /**
   * RAV courant (authoritative) du profil — affiché « actuel → projeté » dans
   * l'encart `RavProjectionRecap`. Ignoré en contexte groupe.
   */
  currentRav?: number
  /**
   * Sprint Group-Income-Cascade — props miroir AddIncomeDialog en contexte
   * groupe. `currentGroupIncomeTotal` inclut déjà `income.estimated_amount` ;
   * la delta-math soustrait `income.estimated_amount` avant d'ajouter le
   * nouveau `previewSafe` pour la projection.
   */
  context?: 'profile' | 'group'
  groupMembersRav?: GroupMemberRavDetail[]
  currentGroupBudgetTotal?: number
  currentGroupIncomeTotal?: number
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
  currentRav,
  context,
  groupMembersRav,
  currentGroupBudgetTotal,
  currentGroupIncomeTotal,
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

  const watchedAmount = useWatch({ control: form.control, name: 'estimatedAmount' })
  const previewAmount =
    typeof watchedAmount === 'number' ? watchedAmount : parseFloat(String(watchedAmount ?? ''))
  const previewSafe = isNaN(previewAmount) ? 0 : previewAmount
  // Reste à vivre projeté : delta = nouveau − actuel ; un revenu augmente le RAV.
  const projectedRav = (currentRav ?? 0) + (previewSafe - (income?.estimated_amount ?? 0))

  // Sprint Group-Income-Cascade — projection en mode édition : on soustrait
  // le montant actuel du revenu (`income.estimated_amount`) avant d'ajouter
  // le nouveau (`previewSafe`) pour éviter le double-comptage dans
  // `currentGroupIncomeTotal` qui l'inclut déjà.
  const isGroupContext = context === 'group'
  const groupContribRows = useMemo(() => {
    if (!isGroupContext || !groupMembersRav || groupMembersRav.length === 0 || !income) return []
    const projectedGroupIncomeTotal = computeProjectedGroupIncomeTotal({
      currentGroupIncomeTotal: currentGroupIncomeTotal ?? 0,
      currentItemAmount: income.estimated_amount,
      newItemAmount: previewSafe,
    })
    return computeGroupMembersContributionsPreview({
      members: groupMembersRav,
      currentGroupBudgetTotal: currentGroupBudgetTotal ?? 0,
      currentGroupIncomeTotal: currentGroupIncomeTotal ?? 0,
      projectedGroupIncomeTotal,
    })
  }, [
    isGroupContext,
    groupMembersRav,
    currentGroupBudgetTotal,
    currentGroupIncomeTotal,
    income,
    previewSafe,
  ])
  const projectedGroupSurplus =
    isGroupContext && income
      ? Math.max(
          0,
          computeProjectedGroupIncomeTotal({
            currentGroupIncomeTotal: currentGroupIncomeTotal ?? 0,
            currentItemAmount: income.estimated_amount,
            newItemAmount: previewSafe,
          }) - (currentGroupBudgetTotal ?? 0),
        )
      : 0

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
      <DialogContent hideCloseButton className={MODAL_CONTENT_CLASSES}>
        {/* Header */}
        <div className="shrink-0 border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
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
          onKeyDown={preventEnterSubmit}
          className="flex min-h-0 flex-auto flex-col overflow-hidden"
          noValidate
        >
          <div className="min-h-0 flex-auto space-y-3 overflow-y-auto px-6 py-4">
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
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-green-500 focus:ring-2 focus:ring-green-500 focus:outline-hidden"
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

            {/* Recap — en groupe : contributions + RAV projetés par membre.
                En perso : reste à vivre estimé actuel → projeté (vert/rouge).
                Sprint Group-Income-Cascade. */}
            {isGroupContext ? (
              <GroupMembersContributionsRecap
                rows={groupContribRows}
                showPreview
                projectedGroupSurplus={projectedGroupSurplus}
              />
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
                className="flex flex-1 items-center justify-center rounded-lg bg-green-600 px-4 py-2 font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
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
