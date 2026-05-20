'use client'

import { useState } from 'react'
import { useForm, type FieldErrors, type FieldPath } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { InlineSpinner } from '@/components/ui/InlineSpinner'
import {
  createGroupFormSchema,
  type CreateGroupForm as CreateGroupFormOutput,
} from '@/lib/schemas/groups'

interface CreateGroupFormProps {
  onSubmit: (name: string) => Promise<boolean>
  onCancel: () => void
}

/**
 * Form component for creating a new group.
 *
 * Sprint Group-Budget-Auto-Sync (2026-05-19) — the manual "Budget mensuel"
 * input is gone. `groups.monthly_budget_estimate` is now auto-synced from
 * `SUM(estimated_budgets WHERE group_id = X)` by the DB trigger
 * `estimated_budgets_sync_group_budget`. The group starts at budget 0 and
 * inflates as items are added to it.
 */
export default function CreateGroupForm({ onSubmit, onCancel }: CreateGroupFormProps) {
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<CreateGroupFormOutput>({
    resolver: zodResolver(createGroupFormSchema),
    defaultValues: { name: '' },
    mode: 'onSubmit',
  })

  const onValidSubmit = async (data: CreateGroupFormOutput) => {
    setServerError(null)
    try {
      const success = await onSubmit(data.name)
      if (success) {
        form.reset({ name: '' })
      }
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Erreur lors de la création')
    }
  }

  const onInvalidSubmit = (errors: FieldErrors<CreateGroupFormOutput>) => {
    const firstErrorKey = Object.keys(errors)[0]
    if (firstErrorKey) {
      form.setFocus(firstErrorKey as FieldPath<CreateGroupFormOutput>)
    }
  }

  const fieldErrors = form.formState.errors
  const isSubmitting = form.formState.isSubmitting

  return (
    <Card className="border-blue-200 bg-blue-50 p-4">
      <form
        onSubmit={form.handleSubmit(onValidSubmit, onInvalidSubmit)}
        className="space-y-3"
        noValidate
      >
        {/* Group Name */}
        <div className="space-y-1.5">
          <Label htmlFor="groupName" className="text-sm font-medium text-gray-700">
            Nom du groupe *
          </Label>
          <Input
            id="groupName"
            type="text"
            {...form.register('name')}
            placeholder="Ex: Famille Dupont"
            className="w-full"
            disabled={isSubmitting}
            maxLength={100}
            aria-invalid={fieldErrors.name ? 'true' : 'false'}
            aria-describedby={fieldErrors.name ? 'group-name-error' : undefined}
          />
          {fieldErrors.name && (
            <p id="group-name-error" className="text-sm text-red-600">
              {fieldErrors.name.message}
            </p>
          )}
        </div>

        {/* Server-side error */}
        {serverError && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-600">{serverError}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end space-x-1.5">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Annuler
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting}
            className="bg-linear-to-r from-blue-600 to-purple-600 text-white"
          >
            {isSubmitting && <InlineSpinner className="mr-1.5" />}
            {isSubmitting ? 'Création...' : 'Créer le groupe'}
          </Button>
        </div>

        {/* Helper Text */}
        <div className="text-xs text-gray-500">
          * Champs obligatoires. Le budget du groupe se met à jour automatiquement à mesure que vous
          créez des items de budget.
        </div>
      </form>
    </Card>
  )
}
