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
import { profileNameFormFieldsSchema, type ProfileNameFormFields } from '@/lib/schemas/profile'

interface FirstTimeProfileDialogProps {
  /** Indique si la dialog est ouverte */
  isOpen: boolean
  /** Fonction appelée lors de la soumission des données */
  onSubmit: (firstName: string, lastName: string) => Promise<boolean>
  /** Fonction appelée en cas d'erreur */
  onError?: (error: string) => void
}

/**
 * Dialog affichée lors de la première connexion pour collecter les informations du profil
 * Permet à l'utilisateur d'entrer son prénom et son nom de famille
 *
 * Uses react-hook-form + zodResolver(profileNameFormFieldsSchema). Per-field
 * errors inline (Sprint Zod-Rollout v3). Modal non-dismissible preserved.
 */
export default function FirstTimeProfileDialog({
  isOpen,
  onSubmit,
  onError,
}: FirstTimeProfileDialogProps) {
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<ProfileNameFormFields>({
    resolver: zodResolver(profileNameFormFieldsSchema),
    defaultValues: { first_name: '', last_name: '' },
    mode: 'onSubmit',
  })

  const onValidSubmit = async ({ first_name, last_name }: ProfileNameFormFields) => {
    setServerError(null)
    try {
      const success = await onSubmit(first_name, last_name)

      if (!success) {
        setServerError('Erreur lors de la création du profil')
        onError?.('Erreur lors de la création du profil')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erreur inconnue'
      setServerError(errorMessage)
      onError?.(errorMessage)
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

  return (
    <Dialog open={isOpen} modal={true}>
      <DialogContent
        className="mx-4 sm:max-w-md"
        aria-describedby="profile-dialog-description"
        hideCloseButton={true}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-semibold">
            <User className="h-6 w-6 text-blue-600" />
            Bienvenue !
          </DialogTitle>
          <DialogDescription id="profile-dialog-description" className="text-gray-600">
            Pour terminer la configuration de votre compte, veuillez entrer votre prénom et votre
            nom.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit(onValidSubmit, onInvalidSubmit)}
          className="space-y-4"
          noValidate
        >
          {/* Prénom */}
          <div className="space-y-2">
            <Label htmlFor="firstName" className="text-sm font-medium">
              Prénom *
            </Label>
            <Input
              id="firstName"
              type="text"
              {...form.register('first_name')}
              placeholder="Votre prénom"
              disabled={isSubmitting}
              aria-invalid={fieldErrors.first_name ? 'true' : 'false'}
              aria-describedby={fieldErrors.first_name ? 'first-name-error' : undefined}
              className={fieldErrors.first_name ? 'border-red-500 focus:ring-red-500' : ''}
            />
            {fieldErrors.first_name && (
              <p id="first-name-error" className="text-sm text-red-600">
                {fieldErrors.first_name.message}
              </p>
            )}
          </div>

          {/* Nom */}
          <div className="space-y-2">
            <Label htmlFor="lastName" className="text-sm font-medium">
              Nom *
            </Label>
            <Input
              id="lastName"
              type="text"
              {...form.register('last_name')}
              placeholder="Votre nom de famille"
              disabled={isSubmitting}
              aria-invalid={fieldErrors.last_name ? 'true' : 'false'}
              aria-describedby={fieldErrors.last_name ? 'last-name-error' : undefined}
              className={fieldErrors.last_name ? 'border-red-500 focus:ring-red-500' : ''}
            />
            {fieldErrors.last_name && (
              <p id="last-name-error" className="text-sm text-red-600">
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

          {/* Bouton de soumission */}
          <div className="flex justify-end pt-4">
            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-linear-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 sm:w-auto"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Création en cours...
                </>
              ) : (
                'Terminer la configuration'
              )}
            </Button>
          </div>
        </form>

        <p className="mt-4 text-xs text-gray-500">* Champs obligatoires</p>
      </DialogContent>
    </Dialog>
  )
}
