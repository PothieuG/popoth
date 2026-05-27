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
import { makeBudgetClientSchema } from '@/lib/schemas/budget'
import {
  computeGroupMembersRavPreview,
  computeProjectedGroupTotal,
} from '@/lib/finance/group-members-rav-preview'
import type { GroupMemberRavDetail } from '@/lib/finance'
import GroupMembersRavRecap from './GroupMembersRavRecap'

interface AddBudgetDialogProps {
  isOpen: boolean
  onClose: () => void
  onSave: (budget: { name: string; estimatedAmount: number }) => void
  currentBudgetsTotal: number
  totalEstimatedIncome: number
  /**
   * Sprint Group-RAV-Recap — en contexte groupe, passe :
   *   - context='group'
   *   - groupMembersRav (depuis FinancialData.meta)
   *   - currentGroupTotal = totalBudgets + totalMonthlyAllocations (le total
   *     qui pilote actuellement la cascade calculate_group_contributions)
   *   - strictRav=false → omet le refine RAV (warning autorisé)
   * En perso, ne pas passer ces props (defaults conservent le comportement).
   */
  context?: 'profile' | 'group'
  groupMembersRav?: GroupMemberRavDetail[]
  currentGroupTotal?: number
  strictRav?: boolean
}

/**
 * Dialog pour ajouter un nouveau budget avec validation en temps réel
 *
 * Migrated to Radix Dialog (Sprint Zod-Rollout v8) for focus trap + Esc-to-close +
 * return-focus + role=dialog + aria-modal. Custom close X preserved via
 * `hideCloseButton={true}` on DialogContent.
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
  context,
  groupMembersRav,
  currentGroupTotal,
  strictRav = true,
}: AddBudgetDialogProps) {
  const schema = useMemo(
    () => makeBudgetClientSchema({ currentBudgetsTotal, totalEstimatedIncome, strictRav }),
    [currentBudgetsTotal, totalEstimatedIncome, strictRav],
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

  // Sprint Group-RAV-Recap — projection RAV par membre (groupe uniquement).
  // Le budget ajouté entre dans `groups.monthly_budget_estimate` qui pilote
  // la répartition des contributions ; on simule ici cette répartition pure
  // côté client pour ne pas attendre la cascade post-submit.
  const isGroupContext = context === 'group'
  const groupRavRows = useMemo(() => {
    if (!isGroupContext || !groupMembersRav || groupMembersRav.length === 0) return []
    const projectedGroupTotal = computeProjectedGroupTotal({
      currentGroupTotal: currentGroupTotal ?? 0,
      newItemAmount: previewSafe,
    })
    return computeGroupMembersRavPreview({
      members: groupMembersRav,
      currentGroupTotal: currentGroupTotal ?? 0,
      projectedGroupTotal,
    })
  }, [isGroupContext, groupMembersRav, currentGroupTotal, previewSafe])

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
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-600">
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
                  <h3 className="text-lg font-bold text-gray-900">Nouveau Budget</h3>
                </DialogTitle>
                <p className="text-sm text-gray-600">Ajoutez une catégorie de dépense</p>
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
            {/* Nom du budget */}
            <div>
              <label
                htmlFor="add-budget-name"
                className="mb-1.5 block text-sm font-medium text-gray-700"
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
                  'h-auto rounded-xl px-4 py-3 transition-colors focus-visible:ring-2 focus-visible:outline-hidden',
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
                className="mb-1.5 block text-sm font-medium text-gray-700"
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
                    'h-auto rounded-xl px-4 py-3 pr-12 transition-colors focus-visible:ring-2 focus-visible:outline-hidden',
                    fieldErrors.estimatedAmount
                      ? 'border-red-300 focus-visible:border-red-500 focus-visible:ring-red-500'
                      : 'border-gray-300 focus-visible:border-orange-500 focus-visible:ring-orange-500',
                  )}
                />
                <span className="absolute top-3.5 right-4 text-sm font-medium text-gray-500">
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

            {/* Recap — en groupe : RAV projeté par membre (Sprint Group-RAV-Recap).
                En perso : balance globale (panel uniformisé Sprint
                Recap-Compact-And-Uniform 2026-05-22). */}
            {isGroupContext ? (
              <GroupMembersRavRecap rows={groupRavRows} showPreview={showPreview} />
            ) : (
              showPreview && (
                <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
                  <div className="space-y-3">
                    <p className="text-sm font-medium text-gray-700">Calcul de la balance :</p>
                    <div className="space-y-1 text-sm">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-gray-700">Revenus estimés totaux</span>
                        <span className="shrink-0 font-semibold text-gray-900">
                          {formatAmount(totalEstimatedIncome)}
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-gray-700">Budgets actuels</span>
                        <span className="shrink-0 font-semibold text-gray-900">
                          {formatAmount(currentBudgetsTotal)}
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-gray-700">Ce nouveau budget</span>
                        <span className="shrink-0 font-semibold text-gray-900">
                          {formatAmount(previewSafe)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <div className="h-px flex-1 bg-blue-200" />
                      <span className="text-xs font-medium tracking-wide text-gray-500 uppercase">
                        Résultat
                      </span>
                      <div className="h-px flex-1 bg-blue-200" />
                    </div>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="font-medium text-gray-700">Balance résultante</span>
                      <span
                        className={cn(
                          'shrink-0 font-bold',
                          willBeNegative ? 'text-red-600' : 'text-gray-900',
                        )}
                      >
                        {formatAmount(resultingBalance)}
                      </span>
                    </div>
                  </div>
                </div>
              )
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
                className="flex flex-1 items-center justify-center rounded-xl bg-orange-600 px-4 py-2 font-medium text-white transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting && <InlineSpinner className="mr-1.5" />}
                {isSubmitting ? 'Ajout...' : 'Ajouter le budget'}
              </button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
