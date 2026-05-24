'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { DecimalFormInput } from '@/components/ui/DecimalFormInput'
import { useAdvanceStep, useUpdateSalaries } from '@/hooks/useMonthlyRecap'
import { useProfile } from '@/hooks/useProfile'
import { cn } from '@/lib/utils'
import type { RecapContext, RecapSummary } from '@/lib/recap'

import { GroupMemberSalaryForm } from '../GroupMemberSalaryForm'

const ERROR_COPY: Record<string, string> = {
  invalid_step: "Cette étape n'est plus accessible. Recharge la page.",
  not_initiator: "Tu n'es pas l'initiateur du récap.",
  no_active_recap: 'Aucun récap actif. Recharge la page.',
  invalid_target: "Un des profils ciblés n'appartient pas au groupe.",
  stale_step: "L'étape a évolué côté serveur. Rafraîchis.",
}

function pickErrorCopy(code: string): string {
  return ERROR_COPY[code] ?? 'Une erreur est survenue. Réessaie dans un instant.'
}

const profileFormSchema = z.object({
  salary: z.coerce.number().nonnegative().finite(),
})

type ProfileFormInput = z.input<typeof profileFormSchema>
type ProfileFormOutput = z.output<typeof profileFormSchema>

interface SalaryUpdateStepProps {
  context: RecapContext
  /** Kept for the wizard uniform contract — not consumed by this step. */
  summary: RecapSummary
  /** Fires on a successful update-salaries POST (NOT on "Non"). The wizard
   *  lifts this flag and forwards it to `FinalRecapStep` so screen 5 shows
   *  the "Salaire mis à jour" line. */
  onSalaryUpdated: () => void
}

/**
 * Sprint 14 — Écran 4 du wizard Monthly Recap V3. Question Oui/Non + form
 * salaire (profile) ou form members salaries (group).
 *
 * - "Non" → POST /api/monthly-recap/advance-step `{ salary_update → final_recap }`.
 *   Le serveur ne touche pas aux salaires, le wizard ré-fetch et bascule sur
 *   `FinalRecapStep`. `onSalaryUpdated` n'est PAS appelé.
 * - "Oui" + profile → 1 input pré-rempli avec `useProfile().profile.salary`.
 *   Submit → POST /api/monthly-recap/update-salaries `{ salaries: [{...}] }`.
 *   Le serveur UPDATE `profiles.salary` ET auto-advance le step (pas
 *   d'advance-step explicite après update).
 * - "Oui" + group → `<GroupMemberSalaryForm>` qui fetch les contributions
 *   du groupe (queryKey `['group-contributions']`) et pose N inputs
 *   (1/membre). Submit → même POST update-salaries (N tuples). Le serveur
 *   re-invoque `calculate_group_contributions` après UPDATEs et
 *   auto-advance le step.
 *
 * Le bouton "retour" n'est volontairement PAS exposé : impossible de
 * revenir aux écrans précédents (spec §2.5).
 */
export function SalaryUpdateStep({ context, onSalaryUpdated }: SalaryUpdateStepProps) {
  const [decided, setDecided] = useState<'yes' | 'no' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { profile } = useProfile()
  const advanceMutation = useAdvanceStep(context)
  const updateMutation = useUpdateSalaries(context)

  const isBusy = advanceMutation.isPending || updateMutation.isPending

  const handleSkip = async () => {
    setError(null)
    setDecided('no')
    try {
      await advanceMutation.mutateAsync({ fromStep: 'salary_update', toStep: 'final_recap' })
    } catch (e) {
      const code = e instanceof Error ? e.message : 'unknown'
      setError(pickErrorCopy(code))
    }
  }

  const handleSubmitSalaries = async (
    salaries: ReadonlyArray<{ profileId: string; salary: number }>,
  ) => {
    setError(null)
    try {
      await updateMutation.mutateAsync({ salaries })
      onSalaryUpdated()
    } catch (e) {
      const code = e instanceof Error ? e.message : 'unknown'
      setError(pickErrorCopy(code))
    }
  }

  const question =
    context === 'profile'
      ? 'Voulez-vous mettre à jour le salaire ?'
      : 'Voulez-vous mettre à jour un des salaires des membres du groupe ?'

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Mise à jour du salaire</h1>
      <p className="text-sm text-gray-700">{question}</p>

      {decided === null && (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            onClick={handleSkip}
            disabled={isBusy}
          >
            {advanceMutation.isPending ? 'Chargement…' : 'Non'}
          </Button>
          <Button
            type="button"
            className="flex-1"
            onClick={() => setDecided('yes')}
            disabled={isBusy}
          >
            Oui
          </Button>
        </div>
      )}

      {decided === 'yes' && context === 'profile' && profile && (
        <ProfileSalaryForm
          profileId={profile.id}
          initialSalary={profile.salary ?? 0}
          isSubmitting={updateMutation.isPending}
          onSubmit={handleSubmitSalaries}
        />
      )}
      {decided === 'yes' && context === 'profile' && !profile && (
        <div role="status" aria-live="polite" className="space-y-3">
          <div className="h-4 w-32 animate-pulse rounded bg-gray-200" />
          <div className="h-12 w-full animate-pulse rounded bg-gray-200" />
        </div>
      )}

      {decided === 'yes' && context === 'group' && (
        <GroupMemberSalaryForm
          isSubmitting={updateMutation.isPending}
          onSubmit={handleSubmitSalaries}
        />
      )}

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}

interface ProfileSalaryFormProps {
  profileId: string
  initialSalary: number
  isSubmitting: boolean
  onSubmit: (data: ReadonlyArray<{ profileId: string; salary: number }>) => void
}

function ProfileSalaryForm({
  profileId,
  initialSalary,
  isSubmitting,
  onSubmit,
}: ProfileSalaryFormProps) {
  const form = useForm<ProfileFormInput, undefined, ProfileFormOutput>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: { salary: initialSalary },
  })
  const hasError = !!form.formState.errors.salary

  const handleSubmit = form.handleSubmit((data) => {
    onSubmit([{ profileId, salary: data.salary }])
  })

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="profile-salary" className="mb-1.5 block text-sm font-medium text-gray-700">
          Mon salaire
        </label>
        <div className="relative">
          <DecimalFormInput
            control={form.control}
            name="salary"
            id="profile-salary"
            placeholder="0.00"
            ariaInvalid={hasError}
            ariaDescribedby={hasError ? 'profile-salary-error' : undefined}
            className={cn(
              'h-auto rounded-xl bg-white px-4 py-3 pr-12',
              hasError ? 'border-red-300' : 'border-gray-300',
            )}
          />
          <span className="absolute top-3.5 right-4 text-sm font-medium text-gray-500">€</span>
        </div>
        {hasError && (
          <p id="profile-salary-error" role="alert" className="mt-1 text-sm text-red-600">
            Le salaire doit être un nombre positif.
          </p>
        )}
      </div>
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? 'Mise à jour…' : 'Mettre à jour'}
      </Button>
    </form>
  )
}
