'use client'

import { useState } from 'react'
import { useForm, type FieldErrors, type FieldPath } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DecimalFormInput } from '@/components/ui/DecimalFormInput'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import {
  createGroupFormSchema,
  type CreateGroupForm as CreateGroupFormOutput,
} from '@/lib/schemas/groups'

interface CreateGroupFormProps {
  onSubmit: (name: string, budget: number) => Promise<boolean>
  onCancel: () => void
}

// z.coerce.number() schemas have distinct input/output — input accepts
// string|number, output is always number. useForm needs both shapes.
type CreateGroupFormInput = z.input<typeof createGroupFormSchema>

/**
 * Form component for creating a new group.
 *
 * Uses react-hook-form + zodResolver(createGroupFormSchema). Decimal field
 * `monthly_budget_estimate` via Controller dual-type pattern (Sprint
 * Zod-Rollout v3). Server-side errors flow via `serverError` state,
 * independent of `form.formState.errors`.
 */
export default function CreateGroupForm({ onSubmit, onCancel }: CreateGroupFormProps) {
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<CreateGroupFormInput, undefined, CreateGroupFormOutput>({
    resolver: zodResolver(createGroupFormSchema),
    defaultValues: { name: '', monthly_budget_estimate: 0 },
    mode: 'onSubmit',
  })

  const onValidSubmit = async (data: CreateGroupFormOutput) => {
    setServerError(null)
    try {
      const success = await onSubmit(data.name, data.monthly_budget_estimate)
      if (success) {
        form.reset({ name: '', monthly_budget_estimate: 0 })
      }
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Erreur lors de la création')
    }
  }

  const onInvalidSubmit = (errors: FieldErrors<CreateGroupFormInput>) => {
    const firstErrorKey = Object.keys(errors)[0]
    if (firstErrorKey) {
      form.setFocus(firstErrorKey as FieldPath<CreateGroupFormInput>)
    }
  }

  const fieldErrors = form.formState.errors
  const isSubmitting = form.formState.isSubmitting

  return (
    <Card className="border-blue-200 bg-blue-50 p-4">
      <form
        onSubmit={form.handleSubmit(onValidSubmit, onInvalidSubmit)}
        className="space-y-4"
        noValidate
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Group Name */}
          <div className="space-y-2">
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

          {/* Monthly Budget */}
          <div className="space-y-2">
            <Label htmlFor="monthlyBudget" className="text-sm font-medium text-gray-700">
              Budget mensuel estimé (€) *
            </Label>
            <DecimalFormInput
              control={form.control}
              name="monthly_budget_estimate"
              id="monthlyBudget"
              placeholder="Ex: 2500"
              className="w-full"
              disabled={isSubmitting}
              ariaInvalid={!!fieldErrors.monthly_budget_estimate}
              ariaDescribedby={
                fieldErrors.monthly_budget_estimate ? 'group-budget-error' : undefined
              }
            />
            {fieldErrors.monthly_budget_estimate && (
              <p id="group-budget-error" className="text-sm text-red-600">
                {fieldErrors.monthly_budget_estimate.message}
              </p>
            )}
          </div>
        </div>

        {/* Server-side error */}
        {serverError && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-600">{serverError}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end space-x-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Annuler
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting}
            className="bg-gradient-to-r from-blue-600 to-purple-600 text-white"
          >
            {isSubmitting ? 'Création...' : 'Créer le groupe'}
          </Button>
        </div>

        {/* Helper Text */}
        <div className="text-xs text-gray-500">
          * Champs obligatoires. Le budget est utilisé pour les statistiques et peut être modifié
          plus tard.
        </div>
      </form>
    </Card>
  )
}
