'use client'

import { useState, useCallback, useMemo } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, User } from 'lucide-react'

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
 */
export default function FirstTimeProfileDialog({ 
  isOpen, 
  onSubmit, 
  onError 
}: FirstTimeProfileDialogProps) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errors, setErrors] = useState<{
    firstName?: string
    lastName?: string
    general?: string
  }>({})

  /**
   * Valide les champs du formulaire
   */
  const validateForm = useCallback(() => {
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
  }, [firstName, lastName])

  /**
   * Gère la soumission du formulaire
   */
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm()) {
      return
    }

    setIsSubmitting(true)
    setErrors({})

    try {
      const success = await onSubmit(firstName.trim(), lastName.trim())
      
      if (!success) {
        setErrors({ general: 'Erreur lors de la création du profil' })
        onError?.('Erreur lors de la création du profil')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erreur inconnue'
      setErrors({ general: errorMessage })
      onError?.(errorMessage)
    } finally {
      setIsSubmitting(false)
    }
  }, [validateForm, onSubmit, firstName, lastName, onError])

  /**
   * Réinitialise le formulaire
   */
  const resetForm = useCallback(() => {
    setFirstName('')
    setLastName('')
    setErrors({})
    setIsSubmitting(false)
  }, [])

  // Memoized CSS classes to prevent forced reflows
  const firstNameInputClasses = useMemo(() => 
    errors.firstName ? 'border-red-500 focus:ring-red-500' : '', 
    [errors.firstName]
  )
  
  const lastNameInputClasses = useMemo(() => 
    errors.lastName ? 'border-red-500 focus:ring-red-500' : '', 
    [errors.lastName]
  )

  return (
    <Dialog open={isOpen} modal={true}>
      <DialogContent 
        className="sm:max-w-md mx-4" 
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
            Pour terminer la configuration de votre compte, veuillez entrer votre prénom et votre nom.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Prénom */}
          <div className="space-y-2">
            <Label htmlFor="firstName" className="text-sm font-medium">
              Prénom *
            </Label>
            <Input
              id="firstName"
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Votre prénom"
              disabled={isSubmitting}
              className={firstNameInputClasses}
            />
            {errors.firstName && (
              <p className="text-sm text-red-600">{errors.firstName}</p>
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
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Votre nom de famille"
              disabled={isSubmitting}
              className={lastNameInputClasses}
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

          {/* Bouton de soumission */}
          <div className="flex justify-end pt-4">
            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full sm:w-auto bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
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

        <p className="text-xs text-gray-500 mt-4">
          * Champs obligatoires
        </p>
      </DialogContent>
    </Dialog>
  )
}