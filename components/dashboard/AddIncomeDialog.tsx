'use client'

import { useMemo } from 'react'
import { useForm, useWatch, type FieldErrors, type FieldPath } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { MODAL_CONTENT_CLASSES } from '@/components/ui/modal-content-classes'
import { Input } from '@/components/ui/input'
import { DecimalFormInput } from '@/components/ui/DecimalFormInput'
import { ModalCloseX } from '@/components/ui/modal-close-x'
import { InlineSpinner } from '@/components/ui/InlineSpinner'
import { preventEnterSubmit } from '@/lib/forms/prevent-enter-submit'
import { createIncomeFormSchema, type CreateIncomeForm } from '@/lib/schemas/income'
import {
  computeGroupMembersContributionsPreview,
  computeProjectedGroupIncomeTotal,
} from '@/lib/finance/group-members-contributions-preview'
import type { GroupMemberRavDetail } from '@/lib/finance'
import GroupMembersContributionsRecap from './GroupMembersContributionsRecap'
import RavProjectionRecap from './RavProjectionRecap'

interface AddIncomeDialogProps {
  isOpen: boolean
  onClose: () => void
  onSave: (income: { name: string; estimatedAmount: number }) => void
  /**
   * RAV courant (authoritative) du profil — affiché « actuel → projeté » dans
   * l'encart `RavProjectionRecap`. Ignoré en contexte groupe.
   */
  currentRav?: number
  /**
   * Sprint Group-Income-Cascade — en contexte groupe, passe `context='group'`
   * + `groupMembersRav` (depuis FinancialData.meta) + `currentGroupBudgetTotal`
   * (SUM des budgets + projets groupe, qui pilote `monthly_budget_estimate`)
   * + `currentGroupIncomeTotal` (SUM des revenus estimés groupe). Le
   * `<GroupMembersContributionsRecap>` remplace alors le panel preview perso.
   */
  context?: 'profile' | 'group'
  groupMembersRav?: GroupMemberRavDetail[]
  currentGroupBudgetTotal?: number
  currentGroupIncomeTotal?: number
}

// z.coerce.number() schemas have a distinct input/output — see EditBalanceModal.
type CreateIncomeFormInput = z.input<typeof createIncomeFormSchema>

/**
 * Dialog pour ajouter un nouveau revenu estimé avec thème vert
 *
 * Migrated to Radix Dialog (Sprint Zod-Rollout v8) for focus trap + Esc-to-close +
 * return-focus + role=dialog + aria-modal. Custom close X preserved via
 * `hideCloseButton={true}` on DialogContent.
 *
 * Uses react-hook-form + zodResolver(createIncomeFormSchema). Decimal field
 * `estimatedAmount` via Controller dual-type pattern (Sprint Zod-Rollout v3).
 */
export default function AddIncomeDialog({
  isOpen,
  onClose,
  onSave,
  currentRav,
  context,
  groupMembersRav,
  currentGroupBudgetTotal,
  currentGroupIncomeTotal,
}: AddIncomeDialogProps) {
  const form = useForm<CreateIncomeFormInput, undefined, CreateIncomeForm>({
    resolver: zodResolver(createIncomeFormSchema),
    defaultValues: { name: '', estimatedAmount: 0 },
    mode: 'onSubmit',
  })

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
  const previewSafe = isNaN(previewAmount) ? 0 : previewAmount
  const showPreview = previewSafe > 0
  // Reste à vivre projeté : un revenu estimé augmente le RAV (delta-math). Un
  // revenu fraîchement ajouté n'a pas de réel ⇒ +montant plein (cf.
  // income-compensation.ts).
  const projectedRav = (currentRav ?? 0) + previewSafe

  // Sprint Group-Income-Cascade — projection des contributions par membre.
  // Calcule en pur côté client le nouveau `contribution_base = max(0,
  // budgets_groupe − revenus_groupe_projetés)` et la répartition prorata des
  // salaires, exactement comme la RPC `calculate_group_contributions`.
  const isGroupContext = context === 'group'
  const groupContribRows = useMemo(() => {
    if (!isGroupContext || !groupMembersRav || groupMembersRav.length === 0) return []
    const projectedGroupIncomeTotal = computeProjectedGroupIncomeTotal({
      currentGroupIncomeTotal: currentGroupIncomeTotal ?? 0,
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
    previewSafe,
  ])
  const projectedGroupSurplus = isGroupContext
    ? Math.max(
        0,
        computeProjectedGroupIncomeTotal({
          currentGroupIncomeTotal: currentGroupIncomeTotal ?? 0,
          newItemAmount: previewSafe,
        }) - (currentGroupBudgetTotal ?? 0),
      )
    : 0

  const fieldErrors = form.formState.errors
  const isSubmitting = form.formState.isSubmitting

  const handleOpenChange = (open: boolean) => {
    if (!open && !isSubmitting) {
      handleClose()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent hideCloseButton className={MODAL_CONTENT_CLASSES}>
        {/* Header */}
        <div className="shrink-0 border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-600">
                <svg
                  className="h-4 w-4 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
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
                <DialogTitle asChild>
                  <h3 className="text-lg font-bold text-gray-900">Nouveau Revenu</h3>
                </DialogTitle>
                <p className="text-sm text-gray-600">Ajoutez une source de revenus</p>
              </div>
            </div>
            <ModalCloseX onClose={handleClose} variant="circle" />
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
              <label
                htmlFor="add-income-name"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                Nom du revenu <span className="text-red-500">*</span>
              </label>
              <Input
                id="add-income-name"
                type="text"
                {...form.register('name')}
                placeholder="Ex: Salaire, Freelance, Prime..."
                disabled={isSubmitting}
                aria-invalid={fieldErrors.name ? 'true' : 'false'}
                aria-describedby={fieldErrors.name ? 'add-income-name-error' : undefined}
                className={cn(
                  'h-auto rounded-xl px-4 py-3 transition-colors focus-visible:ring-2 focus-visible:outline-hidden',
                  fieldErrors.name
                    ? 'border-red-300 focus-visible:border-red-500 focus-visible:ring-red-500'
                    : 'border-gray-300 focus-visible:border-green-500 focus-visible:ring-green-500',
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
                className="mb-1.5 block text-sm font-medium text-gray-700"
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
                    'h-auto rounded-xl px-4 py-3 pr-12 transition-colors focus-visible:ring-2 focus-visible:outline-hidden',
                    fieldErrors.estimatedAmount
                      ? 'border-red-300 focus-visible:border-red-500 focus-visible:ring-red-500'
                      : 'border-gray-300 focus-visible:border-green-500 focus-visible:ring-green-500',
                  )}
                />
                <span className="absolute top-3.5 right-4 text-sm font-medium text-gray-500">
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

            {/* Recap — en groupe : contributions + RAV projetés par membre
                (Sprint Group-Income-Cascade). En perso : reste à vivre estimé
                actuel → projeté (vert/rouge — le revenu fait monter le RAV). */}
            {isGroupContext ? (
              <GroupMembersContributionsRecap
                rows={groupContribRows}
                showPreview={showPreview}
                projectedGroupSurplus={projectedGroupSurplus}
              />
            ) : (
              <RavProjectionRecap
                currentRav={currentRav ?? 0}
                projectedRav={projectedRav}
                showPreview={showPreview}
              />
            )}
          </div>

          {/* Actions */}
          <div className="shrink-0 border-t border-gray-200 px-6 py-4">
            <div className="flex space-x-2">
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
                className="flex flex-1 items-center justify-center rounded-xl bg-green-600 px-4 py-2 font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting && <InlineSpinner className="mr-1.5" />}
                {isSubmitting ? 'Ajout...' : 'Ajouter le revenu'}
              </button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
