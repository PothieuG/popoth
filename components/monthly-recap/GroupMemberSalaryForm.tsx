'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { DecimalFormInput } from '@/components/ui/DecimalFormInput'
import { useGroupContributions } from '@/hooks/useGroupContributions'
import { cn } from '@/lib/utils'

/**
 * Sprint 14 — subform consumed by `SalaryUpdateStep` when the wizard runs in
 * `context === 'group'`. Reads each member + current salary from the
 * existing `useGroupContributions` hook (queryKey `['group-contributions']`,
 * auto-invalidated by mutations) — no new endpoint required. `GET
 * /api/groups/[id]/members` exists but does NOT expose salary, so we cannot
 * use it here.
 *
 * The Zod schema accepts every non-negative finite float per row ; we never
 * trust the client list — server-side `update-salaries` re-fetches member
 * IDs via `fetchGroupMemberIds(groupId)` and rejects any unknown profileId
 * with 400 `invalid_target`.
 */
const groupFormSchema = z.object({
  members: z
    .array(
      z.object({
        profileId: z.string().uuid(),
        salary: z.coerce.number().nonnegative().finite(),
      }),
    )
    .min(1),
})

type GroupFormInput = z.input<typeof groupFormSchema>
type GroupFormOutput = z.output<typeof groupFormSchema>

interface MemberLine {
  profileId: string
  displayName: string
  initialSalary: number
}

interface FormContentProps {
  members: ReadonlyArray<MemberLine>
  isSubmitting: boolean
  onSubmit: (data: ReadonlyArray<{ profileId: string; salary: number }>) => void
}

function FormContent({ members, isSubmitting, onSubmit }: FormContentProps) {
  const form = useForm<GroupFormInput, undefined, GroupFormOutput>({
    resolver: zodResolver(groupFormSchema),
    defaultValues: {
      members: members.map((m) => ({ profileId: m.profileId, salary: m.initialSalary })),
    },
  })
  const { errors } = form.formState

  return (
    <form
      onSubmit={form.handleSubmit((data) => onSubmit(data.members))}
      className="space-y-4"
      noValidate
    >
      {members.map((m, idx) => {
        const fieldId = `member-salary-${m.profileId}`
        const errorId = `${fieldId}-error`
        const memberErrors = errors.members?.[idx]
        const hasError = !!memberErrors?.salary

        return (
          <div key={m.profileId}>
            <label htmlFor={fieldId} className="mb-1.5 block text-sm font-medium text-gray-700">
              {m.displayName}
            </label>
            <div className="relative">
              <DecimalFormInput
                control={form.control}
                name={`members.${idx}.salary`}
                id={fieldId}
                placeholder="0.00"
                ariaInvalid={hasError}
                ariaDescribedby={hasError ? errorId : undefined}
                className={cn(
                  'h-auto rounded-xl px-4 py-3 pr-12',
                  hasError ? 'border-red-300' : 'border-gray-300',
                )}
              />
              <span className="absolute top-3.5 right-4 text-sm font-medium text-gray-500">€</span>
            </div>
            {hasError && (
              <p id={errorId} role="alert" className="mt-1 text-sm text-red-600">
                Le salaire doit être un nombre positif.
              </p>
            )}
          </div>
        )
      })}

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? 'Mise à jour…' : 'Mettre à jour'}
      </Button>
    </form>
  )
}

interface GroupMemberSalaryFormProps {
  isSubmitting: boolean
  onSubmit: (data: ReadonlyArray<{ profileId: string; salary: number }>) => void
}

export function GroupMemberSalaryForm({ isSubmitting, onSubmit }: GroupMemberSalaryFormProps) {
  const { contributions, isLoading, error } = useGroupContributions()

  if (isLoading) {
    return (
      <div role="status" aria-live="polite" className="space-y-3">
        <div className="h-4 w-32 animate-pulse rounded bg-gray-200" />
        <div className="h-12 w-full animate-pulse rounded bg-gray-200" />
        <div className="h-4 w-32 animate-pulse rounded bg-gray-200" />
        <div className="h-12 w-full animate-pulse rounded bg-gray-200" />
      </div>
    )
  }

  if (error) {
    return (
      <p role="alert" className="text-sm text-red-700">
        Impossible de charger les membres du groupe. {error}
      </p>
    )
  }

  if (contributions.length === 0) {
    return <p className="text-sm text-gray-700">Aucun membre dans le groupe.</p>
  }

  const members: MemberLine[] = contributions.map((c) => {
    const first = c.profile?.first_name?.trim() ?? ''
    const last = c.profile?.last_name?.trim() ?? ''
    const display = `${first} ${last}`.trim()
    return {
      profileId: c.profile_id,
      displayName: display.length > 0 ? display : 'Membre',
      initialSalary: c.salary,
    }
  })

  return <FormContent members={members} isSubmitting={isSubmitting} onSubmit={onSubmit} />
}
