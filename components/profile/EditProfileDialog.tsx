'use client'

import { useState } from 'react'
import { useForm, type FieldErrors, type FieldPath } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, User } from 'lucide-react'
import type { ProfileData } from '@/app/api/profile/route'
import { profileNameFormFieldsSchema, type ProfileNameFormFields } from '@/lib/schemas/profile'

interface EditProfileDialogProps {
  /** Indique si la dialog est ouverte */
  isOpen: boolean
  /** Fonction appelée pour fermer la dialog */
  onClose: () => void
  /** Données du profil actuel */
  profile: ProfileData
  /** Fonction appelée lors de la soumission des données */
  onSubmit: (firstName: string, lastName: string) => Promise<boolean>
  /** Fonction appelée en cas d'erreur */
  onError?: (error: string) => void
}

/**
 * Dialog pour modifier le profil utilisateur existant
 * Permet à l'utilisateur de modifier son prénom et son nom de famille
 *
 * Uses react-hook-form + zodResolver(profileNameFormFieldsSchema). Edit
 * mode: defaultValues init from `profile` prop (parent must use
 * `key={profile.id}` if the target can change at runtime). hasChanges
 * derived from `form.formState.isDirty` (Sprint Zod-Rollout v3).
 */
export default function EditProfileDialog({
  isOpen,
  onClose,
  profile,
  onSubmit,
  onError,
}: EditProfileDialogProps) {
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<ProfileNameFormFields>({
    resolver: zodResolver(profileNameFormFieldsSchema),
    defaultValues: { first_name: profile.first_name, last_name: profile.last_name },
    mode: 'onSubmit',
  })

  const onValidSubmit = async ({ first_name, last_name }: ProfileNameFormFields) => {
    setServerError(null)
    try {
      const success = await onSubmit(first_name, last_name)

      if (success) {
        onClose()
      } else {
        setServerError('Erreur lors de la mise à jour du profil')
        onError?.('Erreur lors de la mise à jour du profil')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erreur inconnue'
      setServerError(errorMessage)
      onError?.(errorMessage)
    }
  }

  const handleClose = () => {
    if (!form.formState.isSubmitting) {
      form.reset({ first_name: profile.first_name, last_name: profile.last_name })
      setServerError(null)
      onClose()
    }
  }

  const onInvalidSubmit = (errors: FieldErrors<ProfileNameFormFields>) => {
    const firstErrorKey = Object.keys(errors)[0]
    if (firstErrorKey) {
      form.setFocus(firstErrorKey as FieldPath<ProfileNameFormFields>)
    }
  }

  const fieldErrors = form.formState.errors
  const isSubmitting = form.formState.isSubmitting
  const hasChanges = form.formState.isDirty

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent
        className="mx-4 sm:max-w-md"
        aria-describedby="edit-profile-dialog-description"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-semibold">
            <User className="h-6 w-6 text-blue-600" />
            Modifier le profil
          </DialogTitle>
          <DialogDescription id="edit-profile-dialog-description" className="text-gray-600">
            Modifiez votre prénom et votre nom de famille.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit(onValidSubmit, onInvalidSubmit)}
          className="space-y-4"
          noValidate
        >
          {/* Prénom */}
          <div className="space-y-2">
            <Label htmlFor="editFirstName" className="text-sm font-medium">
              Prénom *
            </Label>
            <Input
              id="editFirstName"
              type="text"
              {...form.register('first_name')}
              placeholder="Votre prénom"
              disabled={isSubmitting}
              aria-invalid={fieldErrors.first_name ? 'true' : 'false'}
              aria-describedby={fieldErrors.first_name ? 'edit-first-name-error' : undefined}
              className={fieldErrors.first_name ? 'border-red-500 focus:ring-red-500' : ''}
            />
            {fieldErrors.first_name && (
              <p id="edit-first-name-error" className="text-sm text-red-600">
                {fieldErrors.first_name.message}
              </p>
            )}
          </div>

          {/* Nom */}
          <div className="space-y-2">
            <Label htmlFor="editLastName" className="text-sm font-medium">
              Nom *
            </Label>
            <Input
              id="editLastName"
              type="text"
              {...form.register('last_name')}
              placeholder="Votre nom de famille"
              disabled={isSubmitting}
              aria-invalid={fieldErrors.last_name ? 'true' : 'false'}
              aria-describedby={fieldErrors.last_name ? 'edit-last-name-error' : undefined}
              className={fieldErrors.last_name ? 'border-red-500 focus:ring-red-500' : ''}
            />
            {fieldErrors.last_name && (
              <p id="edit-last-name-error" className="text-sm text-red-600">
                {fieldErrors.last_name.message}
              </p>
            )}
          </div>

          {/* Erreur générale */}
          {serverError && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3">
              <p className="text-sm text-red-700">{serverError}</p>
            </div>
          )}

          {/* Boutons d'action */}
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !hasChanges}
              className="bg-linear-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Mise à jour...
                </>
              ) : (
                'Sauvegarder'
              )}
            </Button>
          </div>
        </form>

        <p className="mt-4 text-xs text-gray-500">* Champs obligatoires</p>
      </DialogContent>
    </Dialog>
  )
}
