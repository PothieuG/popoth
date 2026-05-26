'use client'

import { useEffect, useMemo, useState } from 'react'
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
import { makeProjectClientSchema } from '@/lib/schemas/projects'
import {
  computeDeadlineFromDuration,
  formatDeadline,
  monthsBetween,
} from '@/lib/finance/projects-meta'
import type { SavingsProject } from '@/hooks/useProjects'

interface EditProjectDialogProps {
  isOpen?: boolean
  onClose: () => void
  onSave: (project: {
    name: string
    targetAmount: number
    monthlyAllocation: number
    deadlineDate: string
  }) => Promise<boolean>
  project: SavingsProject
  /**
   * Somme des allocations déjà planifiées (budgets + projets, ce projet inclus).
   * Le schéma applique le delta `currentAllocatedTotal − currentProjectAllocation +
   * d.monthlyAllocation` pour éviter de double-compter l'allocation existante
   * (cf. `makeProjectClientSchema` refine 1).
   */
  currentAllocatedTotal: number
  totalEstimatedIncome: number
}

type Mode = 'duration' | 'monthly'

/**
 * Dialog d'édition d'un projet d'épargne (Sprint Projets-Épargne 06).
 *
 * Mirror exact d'`AddProjectDialog` (mode A durée pilote / mode B mensuel
 * pilote, toggle + calcul mutuel live) avec 4 ajustements EDIT-spécifiques :
 *
 *  1. **Pré-rempli** depuis `project.{name, target_amount, monthly_allocation,
 *     deadline_date}`. La durée initiale est dérivée via `monthsBetween(today,
 *     project.deadline_date)` clamped à `≥ 1` pour ne pas afficher "0 mois".
 *  2. **`amountSaved` passé au schéma** : le refine 2 utilise `target −
 *     amountSaved` (le projet doit être atteignable sur le reliquat). En
 *     écho, le calcul du mensuel dérivé en mode A utilise aussi `(target −
 *     amountSaved)` — sinon on afficherait "Tu épargneras N €/mois" ignorant
 *     l'argent déjà capitalisé.
 *  3. **`currentProjectAllocation` passé au schéma** : refine 1 calcule
 *     `newTotal = currentAllocatedTotal − currentProjectAllocation +
 *     d.monthlyAllocation` (delta-math) pour ne pas faire échouer un edit
 *     qui ne change que la durée par exemple.
 *  4. **Marge présentationnelle ajustée** : `totalEstimatedIncome −
 *     (currentAllocatedTotal − currentProjectAllocation)` — affiche ce que
 *     l'edit pourrait libérer.
 *
 * Parent : wrapper `{isEditProjectOpen && editingProject && <Modal />}` +
 * `key={editingProject.id}` pour remount lazy quand on switch de cible.
 */
export default function EditProjectDialog({
  isOpen = true,
  onClose,
  onSave,
  project,
  currentAllocatedTotal,
  totalEstimatedIncome,
}: EditProjectDialogProps) {
  const amountSaved = Number(project.amount_saved) || 0
  const currentProjectAllocation = Number(project.monthly_allocation) || 0

  const schema = useMemo(
    () =>
      makeProjectClientSchema({
        currentAllocatedTotal,
        totalEstimatedIncome,
        currentProjectAllocation,
        amountSaved,
      }),
    [currentAllocatedTotal, totalEstimatedIncome, currentProjectAllocation, amountSaved],
  )
  type FormInput = z.input<typeof schema>
  type FormOutput = z.output<typeof schema>

  // Lazy init de la durée par défaut. `monthsBetween` clamp à 0 si la
  // deadline est passée ou ce mois ; on défaut à 1 pour que mode A reste
  // utilisable. Le refine 2 bloquera le submit si remaining > 0 + months ≤ 0.
  const initialDuration = useMemo(() => {
    const m = monthsBetween(new Date(), project.deadline_date)
    return m > 0 ? m : 1
  }, [project.deadline_date])

  const form = useForm<FormInput, undefined, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: project.name,
      targetAmount: Number(project.target_amount) || 0,
      monthlyAllocation: currentProjectAllocation,
      deadlineDate: project.deadline_date,
    },
    mode: 'onSubmit',
  })

  const [mode, setMode] = useState<Mode>('duration')
  const [durationInputA, setDurationInputA] = useState<number>(initialDuration)

  const formatAmount = (amount: number): string =>
    new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
    }).format(amount)

  const watchedTarget = useWatch({ control: form.control, name: 'targetAmount' })
  const watchedMonthly = useWatch({ control: form.control, name: 'monthlyAllocation' })
  const targetParsed =
    typeof watchedTarget === 'number' ? watchedTarget : parseFloat(String(watchedTarget ?? ''))
  const monthlyParsed =
    typeof watchedMonthly === 'number' ? watchedMonthly : parseFloat(String(watchedMonthly ?? ''))
  const targetSafe = isNaN(targetParsed) ? 0 : targetParsed
  const monthlySafe = isNaN(monthlyParsed) ? 0 : monthlyParsed

  const margeDispo = totalEstimatedIncome - (currentAllocatedTotal - currentProjectAllocation)
  const remaining = Math.max(0, targetSafe - amountSaved)

  // Mode B : durée purement dérivée du couple (remaining, monthly).
  const derivedDurationFromMonthly = useMemo(() => {
    if (monthlySafe <= 0 || remaining <= 0) return null
    return Math.ceil(remaining / monthlySafe)
  }, [monthlySafe, remaining])

  const effectiveDuration = mode === 'duration' ? durationInputA : derivedDurationFromMonthly

  // Mode A — durée pilote : dérive le mensuel via `form.setValue`. Arrondi
  // supérieur au centime pour garantir `monthly × duration ≥ remaining`
  // (refine 2). Si remaining ≤ 0, mensuel = 0.
  useEffect(() => {
    if (mode !== 'duration') return
    if (durationInputA <= 0) return
    if (remaining <= 0) {
      form.setValue('monthlyAllocation', 0, { shouldValidate: false })
      return
    }
    const derivedMonthly = Math.ceil((remaining * 100) / durationInputA) / 100
    form.setValue('monthlyAllocation', derivedMonthly, { shouldValidate: false })
  }, [mode, durationInputA, remaining, form])

  // Sync `deadlineDate` dans les deux modes — uniquement via form.setValue.
  useEffect(() => {
    if (effectiveDuration === null || effectiveDuration <= 0) return
    form.setValue('deadlineDate', computeDeadlineFromDuration(effectiveDuration), {
      shouldValidate: false,
    })
  }, [effectiveDuration, form])

  const handleToggleDuration = () => {
    if (mode !== 'duration' && derivedDurationFromMonthly !== null) {
      setDurationInputA(derivedDurationFromMonthly)
    }
    setMode('duration')
  }
  const handleToggleMonthly = () => setMode('monthly')

  const onValidSubmit = async (data: FormOutput) => {
    const success = await onSave({
      name: data.name,
      targetAmount: data.targetAmount,
      monthlyAllocation: data.monthlyAllocation,
      deadlineDate: data.deadlineDate,
    })
    if (success) {
      onClose()
    }
  }

  const onInvalidSubmit = (errors: FieldErrors<FormInput>) => {
    const firstErrorKey = Object.keys(errors)[0]
    if (!firstErrorKey) return
    // En mode A, le DecimalFormInput de monthlyAllocation n'est pas monté
    // → setFocus tomberait dans le vide. Redirige vers l'input duration.
    if (firstErrorKey === 'monthlyAllocation' && mode === 'duration') {
      document.getElementById('edit-project-duration')?.focus()
      return
    }
    form.setFocus(firstErrorKey as FieldPath<FormInput>)
  }

  const fieldErrors = form.formState.errors
  const isSubmitting = form.formState.isSubmitting

  const handleOpenChange = (open: boolean) => {
    if (!open && !isSubmitting) {
      onClose()
    }
  }

  const derivedMonthlyForDisplay =
    mode === 'duration' && durationInputA > 0 && remaining > 0
      ? Math.ceil((remaining * 100) / durationInputA) / 100
      : null
  const derivedDurationForDisplay = mode === 'monthly' ? derivedDurationFromMonthly : null
  const computedDeadlineForDisplay =
    effectiveDuration !== null && effectiveDuration > 0
      ? formatDeadline(computeDeadlineFromDuration(effectiveDuration))
      : null

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent hideCloseButton className={MODAL_CONTENT_CLASSES}>
        {/* Header */}
        <div className="shrink-0 border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-100">
                <svg
                  className="h-4 w-4 text-purple-600"
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
                  <h2 className="text-lg font-bold text-gray-900">Modifier le projet</h2>
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
            {/* Nom du projet */}
            <div>
              <label
                htmlFor="edit-project-name"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                Nom du projet <span className="text-red-500">*</span>
              </label>
              <Input
                id="edit-project-name"
                type="text"
                {...form.register('name')}
                placeholder="Ex: Voyage au Japon, Achat voiture..."
                disabled={isSubmitting}
                aria-invalid={fieldErrors.name ? 'true' : 'false'}
                aria-describedby={fieldErrors.name ? 'edit-project-name-error' : undefined}
                className={cn(
                  'h-auto rounded-xl px-4 py-3 transition-colors focus-visible:ring-2 focus-visible:outline-hidden',
                  fieldErrors.name
                    ? 'border-red-300 focus-visible:border-red-500 focus-visible:ring-red-500'
                    : 'border-gray-300 focus-visible:border-purple-500 focus-visible:ring-purple-500',
                )}
              />
              {fieldErrors.name && (
                <p
                  id="edit-project-name-error"
                  className="mt-1 flex items-center text-sm text-red-600"
                >
                  {fieldErrors.name.message}
                </p>
              )}
            </div>

            {/* Montant total visé */}
            <div>
              <label
                htmlFor="edit-project-target"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                Montant total visé <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <DecimalFormInput
                  control={form.control}
                  name="targetAmount"
                  id="edit-project-target"
                  placeholder="0.00"
                  ariaInvalid={!!fieldErrors.targetAmount}
                  ariaDescribedby={
                    fieldErrors.targetAmount ? 'edit-project-target-error' : undefined
                  }
                  className={cn(
                    'h-auto rounded-xl px-4 py-3 pr-12 transition-colors focus-visible:ring-2 focus-visible:outline-hidden',
                    fieldErrors.targetAmount
                      ? 'border-red-300 focus-visible:border-red-500 focus-visible:ring-red-500'
                      : 'border-gray-300 focus-visible:border-purple-500 focus-visible:ring-purple-500',
                  )}
                />
                <span className="absolute top-3.5 right-4 text-sm font-medium text-gray-500">
                  €
                </span>
              </div>
              {amountSaved > 0 && (
                <p className="mt-1.5 text-xs text-gray-500">
                  Déjà épargné :{' '}
                  <span className="font-semibold text-purple-700">{formatAmount(amountSaved)}</span>{' '}
                  · Reste à atteindre :{' '}
                  <span className="font-semibold text-purple-700">{formatAmount(remaining)}</span>
                </p>
              )}
              {fieldErrors.targetAmount && (
                <p id="edit-project-target-error" className="mt-1 text-sm text-red-600">
                  {fieldErrors.targetAmount.message}
                </p>
              )}
            </div>

            {/* Toggle Mode A / Mode B */}
            <div
              role="radiogroup"
              aria-label="Mode de saisie alternative"
              className="rounded-lg border border-gray-200 bg-gray-50 p-1"
            >
              <div className="flex gap-1">
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === 'duration'}
                  onClick={handleToggleDuration}
                  className={cn(
                    'flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    mode === 'duration'
                      ? 'bg-white text-purple-700 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900',
                  )}
                >
                  Définir la durée
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === 'monthly'}
                  onClick={handleToggleMonthly}
                  className={cn(
                    'flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    mode === 'monthly'
                      ? 'bg-white text-purple-700 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900',
                  )}
                >
                  Définir le mensuel
                </button>
              </div>
            </div>

            {/* Mode A : input durée + aperçu mensuel dérivé */}
            {mode === 'duration' && (
              <div>
                <label
                  htmlFor="edit-project-duration"
                  className="mb-1.5 block text-sm font-medium text-gray-700"
                >
                  Durée (mois) <span className="text-red-500">*</span>
                </label>
                <Input
                  id="edit-project-duration"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={360}
                  value={durationInputA === 0 ? '' : durationInputA}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10)
                    setDurationInputA(isNaN(v) ? 0 : v)
                  }}
                  disabled={isSubmitting}
                  aria-invalid={fieldErrors.monthlyAllocation ? 'true' : 'false'}
                  aria-describedby={
                    fieldErrors.monthlyAllocation ? 'edit-project-monthly-error' : undefined
                  }
                  className={cn(
                    'h-auto rounded-xl px-4 py-3 transition-colors focus-visible:ring-2 focus-visible:outline-hidden',
                    fieldErrors.monthlyAllocation
                      ? 'border-red-300 focus-visible:border-red-500 focus-visible:ring-red-500'
                      : 'border-gray-300 focus-visible:border-purple-500 focus-visible:ring-purple-500',
                  )}
                />
                {derivedMonthlyForDisplay !== null && computedDeadlineForDisplay && (
                  <p className="mt-1.5 text-sm text-gray-600">
                    Tu épargneras{' '}
                    <span className="font-semibold text-purple-700">
                      {formatAmount(derivedMonthlyForDisplay)}
                    </span>{' '}
                    par mois → échéance{' '}
                    <span className="font-semibold text-purple-700">
                      {computedDeadlineForDisplay}
                    </span>
                  </p>
                )}
              </div>
            )}

            {/* Mode B : input mensuel + aperçu durée dérivée */}
            {mode === 'monthly' && (
              <div>
                <label
                  htmlFor="edit-project-monthly"
                  className="mb-1.5 block text-sm font-medium text-gray-700"
                >
                  Montant mensuel <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <DecimalFormInput
                    control={form.control}
                    name="monthlyAllocation"
                    id="edit-project-monthly"
                    placeholder="0.00"
                    ariaInvalid={!!fieldErrors.monthlyAllocation}
                    ariaDescribedby={
                      fieldErrors.monthlyAllocation ? 'edit-project-monthly-error' : undefined
                    }
                    className={cn(
                      'h-auto rounded-xl px-4 py-3 pr-12 transition-colors focus-visible:ring-2 focus-visible:outline-hidden',
                      fieldErrors.monthlyAllocation
                        ? 'border-red-300 focus-visible:border-red-500 focus-visible:ring-red-500'
                        : 'border-gray-300 focus-visible:border-purple-500 focus-visible:ring-purple-500',
                    )}
                  />
                  <span className="absolute top-3.5 right-4 text-sm font-medium text-gray-500">
                    €
                  </span>
                </div>
                {derivedDurationForDisplay !== null && computedDeadlineForDisplay && (
                  <p className="mt-1.5 text-sm text-gray-600">
                    Durée :{' '}
                    <span className="font-semibold text-purple-700">
                      {derivedDurationForDisplay} mois
                    </span>{' '}
                    → échéance{' '}
                    <span className="font-semibold text-purple-700">
                      {computedDeadlineForDisplay}
                    </span>
                  </p>
                )}
              </div>
            )}

            {/* Erreur monthly (visible quel que soit le mode) */}
            {fieldErrors.monthlyAllocation && (
              <p id="edit-project-monthly-error" className="text-sm text-red-600">
                {fieldErrors.monthlyAllocation.message}
              </p>
            )}

            {/* Marge disponible — toujours visible */}
            <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium text-gray-700">Marge disponible</span>
                <span
                  className={cn('font-bold', margeDispo < 0 ? 'text-red-600' : 'text-gray-900')}
                >
                  {formatAmount(margeDispo)} / mois
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Revenus estimés − autres budgets &amp; projets (hors celui-ci)
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="shrink-0 border-t border-gray-200 px-6 py-4">
            <div className="flex space-x-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1 rounded-xl border border-gray-300 bg-white px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex flex-1 items-center justify-center rounded-xl bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting && <InlineSpinner className="mr-1.5" />}
                {isSubmitting ? 'Sauvegarde...' : 'Sauvegarder'}
              </button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
