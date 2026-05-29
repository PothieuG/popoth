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
import { computeDeadlineFromDuration, formatDeadline } from '@/lib/finance/projects-meta'
import {
  computeGroupMembersRavPreview,
  computeProjectedGroupTotal,
} from '@/lib/finance/group-members-rav-preview'
import type { GroupMemberRavDetail } from '@/lib/finance'
import GroupMembersRavRecap from './GroupMembersRavRecap'
import RavProjectionRecap from './RavProjectionRecap'

interface AddProjectDialogProps {
  isOpen: boolean
  onClose: () => void
  onSave: (project: {
    name: string
    targetAmount: number
    monthlyAllocation: number
    deadlineDate: string
  }) => Promise<boolean>
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

type Mode = 'duration' | 'monthly'

const DEFAULT_DURATION_MONTHS = 12

/**
 * Dialog pour créer un projet d'épargne (Sprint Projets-Épargne 05).
 *
 * Deux modes de saisie qui se calculent mutuellement à partir du montant total :
 *
 *  - **Mode A "Définir la durée"** : l'utilisateur entre une durée (mois) →
 *    le montant mensuel est dérivé `ceil(target / duration)` en arrondi
 *    supérieur au centime (sinon refine 2 du schéma — `monthly × months >=
 *    remaining` — pourrait échouer à cause de la perte de fraction).
 *  - **Mode B "Définir le mensuel"** : l'utilisateur entre un montant
 *    mensuel → la durée est dérivée `ceil(target / monthly)` et la date
 *    butoir suit `computeDeadlineFromDuration`.
 *
 * Toggle entre les modes preserve l'autre valeur calculée (cohérence
 * bidirectionnelle). Le champ `deadlineDate` n'est jamais exposé à l'UI ;
 * il est synchronisé via `setValue` à chaque changement de durée pour que
 * le schéma puisse exécuter ses 2 refines.
 *
 * Pattern §A dual-type (`useForm<FormInput, undefined, FormOutput>`) +
 * factory schema mémoïsé sur les 2 props parents — identique à
 * `AddBudgetDialog`.
 */
export default function AddProjectDialog({
  isOpen,
  onClose,
  onSave,
  currentRav,
  context,
  groupMembersRav,
  currentGroupTotal,
}: AddProjectDialogProps) {
  const schema = useMemo(() => makeProjectClientSchema(), [])
  type FormInput = z.input<typeof schema>
  type FormOutput = z.output<typeof schema>

  const defaultDeadline = useMemo(() => computeDeadlineFromDuration(DEFAULT_DURATION_MONTHS), [])

  const form = useForm<FormInput, undefined, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      targetAmount: 0,
      monthlyAllocation: 0,
      deadlineDate: defaultDeadline,
    },
    mode: 'onSubmit',
  })

  const [mode, setMode] = useState<Mode>('duration')
  // `durationInputA` est l'état d'édition utilisateur de l'input "Durée (mois)"
  // — utilisé UNIQUEMENT en mode='duration'. En mode='monthly', la durée est
  // dérivée (useMemo `derivedDurationFromMonthly`) — on ne re-écrit pas un
  // setState pour éviter le pattern "setState dans useEffect" (cascade
  // renders). Le seed du toggle se fait dans le handler `handleToggleDuration`.
  const [durationInputA, setDurationInputA] = useState<number>(DEFAULT_DURATION_MONTHS)

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

  // Reste à vivre projeté : un projet (allocation mensuelle) consomme le RAV
  // comme un budget virtuel (delta-math, cf. group-members-rav-preview.ts).
  const projectedRav = (currentRav ?? 0) - monthlySafe

  // Sprint Group-RAV-Recap — projection RAV par membre (groupe uniquement).
  // Le projet ajouté entre dans `groups.monthly_budget_estimate` (trigger
  // sync_group_budget_on_project_change) qui pilote la répartition des
  // contributions ; on simule cette répartition pure côté client. `monthlySafe`
  // suit toujours la valeur courante du champ (mis à jour via form.setValue
  // en mode 'duration', saisi en mode 'monthly').
  const isGroupContext = context === 'group'
  const groupRavRows = useMemo(() => {
    if (!isGroupContext || !groupMembersRav || groupMembersRav.length === 0) return []
    const projectedGroupTotal = computeProjectedGroupTotal({
      currentGroupTotal: currentGroupTotal ?? 0,
      newItemAmount: monthlySafe,
    })
    return computeGroupMembersRavPreview({
      members: groupMembersRav,
      currentGroupTotal: currentGroupTotal ?? 0,
      projectedGroupTotal,
    })
  }, [isGroupContext, groupMembersRav, currentGroupTotal, monthlySafe])

  // En mode='monthly' la durée est purement dérivée du couple (target, monthly).
  // `null` = couple incomplet, on n'affiche pas et on ne sync pas le deadline.
  const derivedDurationFromMonthly = useMemo(() => {
    if (monthlySafe <= 0 || targetSafe <= 0) return null
    return Math.ceil(targetSafe / monthlySafe)
  }, [monthlySafe, targetSafe])

  // Durée effective utilisée pour sync `deadlineDate` et l'aperçu UI.
  const effectiveDuration = mode === 'duration' ? durationInputA : derivedDurationFromMonthly

  // Mode A — durée pilote : on dérive le mensuel via `form.setValue`. `setValue`
  // de RHF passe par un store interne, pas par React setState → pas de
  // cascading renders. Arrondi supérieur au centime pour garantir
  // `monthly × duration >= target` (refine 2 du schéma).
  useEffect(() => {
    if (mode !== 'duration') return
    if (durationInputA <= 0 || targetSafe <= 0) return
    const derivedMonthly = Math.ceil((targetSafe * 100) / durationInputA) / 100
    form.setValue('monthlyAllocation', derivedMonthly, { shouldValidate: false })
  }, [mode, durationInputA, targetSafe, form])

  // Sync `deadlineDate` dans les deux modes — uniquement via form.setValue.
  useEffect(() => {
    if (effectiveDuration === null || effectiveDuration <= 0) return
    form.setValue('deadlineDate', computeDeadlineFromDuration(effectiveDuration), {
      shouldValidate: false,
    })
  }, [effectiveDuration, form])

  // Sur toggle vers mode='duration', seed l'input local avec la durée
  // précédemment dérivée (cohérence bidirectionnelle de la toggle).
  const handleToggleDuration = () => {
    if (mode !== 'duration' && derivedDurationFromMonthly !== null) {
      setDurationInputA(derivedDurationFromMonthly)
    }
    setMode('duration')
  }
  const handleToggleMonthly = () => setMode('monthly')

  const handleClose = () => {
    form.reset({
      name: '',
      targetAmount: 0,
      monthlyAllocation: 0,
      deadlineDate: defaultDeadline,
    })
    setMode('duration')
    setDurationInputA(DEFAULT_DURATION_MONTHS)
    onClose()
  }

  const onValidSubmit = async (data: FormOutput) => {
    const success = await onSave({
      name: data.name,
      targetAmount: data.targetAmount,
      monthlyAllocation: data.monthlyAllocation,
      deadlineDate: data.deadlineDate,
    })
    if (success) {
      handleClose()
    }
  }

  const onInvalidSubmit = (errors: FieldErrors<FormInput>) => {
    const firstErrorKey = Object.keys(errors)[0]
    if (!firstErrorKey) return
    // En mode A, le DecimalFormInput de monthlyAllocation n'est pas monté →
    // setFocus tomberait dans le vide. Redirige vers l'input duration (qui
    // est la source contrôlable de l'erreur dérivée).
    if (firstErrorKey === 'monthlyAllocation' && mode === 'duration') {
      document.getElementById('add-project-duration')?.focus()
      return
    }
    form.setFocus(firstErrorKey as FieldPath<FormInput>)
  }

  const fieldErrors = form.formState.errors
  const isSubmitting = form.formState.isSubmitting

  const handleOpenChange = (open: boolean) => {
    if (!open && !isSubmitting) {
      handleClose()
    }
  }

  // Valeurs dérivées pour l'affichage. `null` signifie "pas encore prêt à
  // afficher" (input incomplet) — on masque l'aperçu plutôt que d'écrire NaN.
  const derivedMonthlyForDisplay =
    mode === 'duration' && durationInputA > 0 && targetSafe > 0
      ? Math.ceil((targetSafe * 100) / durationInputA) / 100
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
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-600">
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
                    d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
                  />
                </svg>
              </div>
              <div>
                <DialogTitle asChild>
                  <h3 className="text-lg font-bold text-gray-900">Nouveau projet d&apos;épargne</h3>
                </DialogTitle>
                <p className="text-sm text-gray-600">Définissez un objectif sur une durée</p>
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
            {/* Nom du projet */}
            <div>
              <label
                htmlFor="add-project-name"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                Nom du projet <span className="text-red-500">*</span>
              </label>
              <Input
                id="add-project-name"
                type="text"
                {...form.register('name')}
                placeholder="Ex: Voyage au Japon, Achat voiture..."
                disabled={isSubmitting}
                aria-invalid={fieldErrors.name ? 'true' : 'false'}
                aria-describedby={fieldErrors.name ? 'add-project-name-error' : undefined}
                className={cn(
                  'h-auto rounded-xl px-4 py-3 transition-colors focus-visible:ring-2 focus-visible:outline-hidden',
                  fieldErrors.name
                    ? 'border-red-300 focus-visible:border-red-500 focus-visible:ring-red-500'
                    : 'border-gray-300 focus-visible:border-purple-500 focus-visible:ring-purple-500',
                )}
              />
              {fieldErrors.name && (
                <p
                  id="add-project-name-error"
                  className="mt-1 flex items-center text-sm text-red-600"
                >
                  {fieldErrors.name.message}
                </p>
              )}
            </div>

            {/* Montant total visé */}
            <div>
              <label
                htmlFor="add-project-target"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                Montant total visé <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <DecimalFormInput
                  control={form.control}
                  name="targetAmount"
                  id="add-project-target"
                  placeholder="0.00"
                  ariaInvalid={!!fieldErrors.targetAmount}
                  ariaDescribedby={
                    fieldErrors.targetAmount ? 'add-project-target-error' : undefined
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
              {fieldErrors.targetAmount && (
                <p id="add-project-target-error" className="mt-1 text-sm text-red-600">
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
                  htmlFor="add-project-duration"
                  className="mb-1.5 block text-sm font-medium text-gray-700"
                >
                  Durée (mois) <span className="text-red-500">*</span>
                </label>
                <Input
                  id="add-project-duration"
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
                    fieldErrors.monthlyAllocation ? 'add-project-monthly-error' : undefined
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
                  htmlFor="add-project-monthly"
                  className="mb-1.5 block text-sm font-medium text-gray-700"
                >
                  Montant mensuel <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <DecimalFormInput
                    control={form.control}
                    name="monthlyAllocation"
                    id="add-project-monthly"
                    placeholder="0.00"
                    ariaInvalid={!!fieldErrors.monthlyAllocation}
                    ariaDescribedby={
                      fieldErrors.monthlyAllocation ? 'add-project-monthly-error' : undefined
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
              <p id="add-project-monthly-error" className="text-sm text-red-600">
                {fieldErrors.monthlyAllocation.message}
              </p>
            )}

            {/* Recap — en groupe : RAV projeté par membre (Sprint Group-RAV-Recap).
                En perso : reste à vivre estimé actuel → projeté (vert/rouge). */}
            {isGroupContext ? (
              <GroupMembersRavRecap rows={groupRavRows} showPreview={monthlySafe > 0} />
            ) : (
              <RavProjectionRecap
                currentRav={currentRav ?? 0}
                projectedRav={projectedRav}
                showPreview={monthlySafe > 0}
              />
            )}
          </div>

          {/* Footer */}
          <div className="shrink-0 border-t border-gray-200 px-6 py-4">
            <div className="flex space-x-2">
              <button
                type="button"
                onClick={handleClose}
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
                {isSubmitting ? 'Création...' : 'Créer le projet'}
              </button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
