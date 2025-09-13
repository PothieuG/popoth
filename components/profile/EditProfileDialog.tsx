'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, User } from 'lucide-react'
import { ProfileData } from '@/app/api/profile/route'

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
 */
export default function EditProfileDialog({ 
  isOpen, 
  onClose,
  profile,
  onSubmit, 
  onError 
}: EditProfileDialogProps) {
  const [firstName, setFirstName] = useState(profile.first_name)
  const [lastName, setLastName] = useState(profile.last_name)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errors, setErrors] = useState<{
    firstName?: string
    lastName?: string
    general?: string
  }>({})

  /**
   * Valide les champs du formulaire
   */
  const validateForm = () => {
    const newErrors: typeof errors = {}

    if (!firstName.trim()) {
      newErrors.firstName = 'Le prénom est requis'
    } else if (firstName.trim().length < 2) {
      newErrors.firstName = 'Le prénom doit contenir au moins 2 caractères'
    }

    if (!lastName.trim()) {
      newErrors.lastName = 'Le nom est requis'
    } else if (lastName.trim().length < 2) {
      newErrors.lastName = 'Le nom doit contenir au moins 2 caractères'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  /**
   * Gère la soumission du formulaire
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm()) {
      return
    }

    setIsSubmitting(true)
    setErrors({})

    try {
      const success = await onSubmit(firstName.trim(), lastName.trim())
      
      if (success) {
        onClose()
      } else {
        setErrors({ general: 'Erreur lors de la mise à jour du profil' })
        onError?.('Erreur lors de la mise à jour du profil')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erreur inconnue'
      setErrors({ general: errorMessage })
      onError?.(errorMessage)
    } finally {
      setIsSubmitting(false)
    }
  }

  /**
   * Gère la fermeture de la dialog
   */
  const handleClose = () => {
    if (!isSubmitting) {
      // Réinitialiser les valeurs aux valeurs originales
      setFirstName(profile.first_name)
      setLastName(profile.last_name)
      setErrors({})
      onClose()
    }
  }

  /**
   * Vérifie s'il y a des changements
   */
  const hasChanges = firstName.trim() !== profile.first_name || lastName.trim() !== profile.last_name

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md mx-4" aria-describedby="edit-profile-dialog-description">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-semibold">
            <User className="h-6 w-6 text-blue-600" />
            Modifier le profil
          </DialogTitle>
          <DialogDescription id="edit-profile-dialog-description" className="text-gray-600">
            Modifiez votre prénom et votre nom de famille.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Prénom */}
          <div className="space-y-2">
            <Label htmlFor="editFirstName" className="text-sm font-medium">
              Prénom *
            </Label>
            <Input
              id="editFirstName"
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Votre prénom"
              disabled={isSubmitting}
              className={errors.firstName ? 'border-red-500 focus:ring-red-500' : ''}
            />
            {errors.firstName && (
              <p className="text-sm text-red-600">{errors.firstName}</p>
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
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Votre nom de famille"
              disabled={isSubmitting}
              className={errors.lastName ? 'border-red-500 focus:ring-red-500' : ''}
            />
            {errors.lastName && (
              <p className="text-sm text-red-600">{errors.lastName}</p>
            )}
          </div>

          {/* Erreur générale */}
          {errors.general && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-700">{errors.general}</p>
            </div>
          )}

          {/* Boutons d'action */}
          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !hasChanges}
              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
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

        <p className="text-xs text-gray-500 mt-4">
          * Champs obligatoires
        </p>
      </DialogContent>
    </Dialog>
  )
}