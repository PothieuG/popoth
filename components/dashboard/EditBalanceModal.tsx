'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { DecimalFormInput } from '@/components/ui/DecimalFormInput'
import { Label } from '@/components/ui/label'
import { editBalanceFormSchema, type EditBalanceForm } from '@/lib/schemas/bank-balance'
import { logger } from '@/lib/logger'

interface EditBalanceModalProps {
  isOpen: boolean
  currentBalance: number
  onSubmit: (newBalance: number) => void | Promise<void>
  onCancel: () => void
}

// z.coerce.number() schemas have a distinct input/output : input accepts
// string|number, output is always number. useForm needs both shapes.
type EditBalanceFormInput = z.input<typeof editBalanceFormSchema>

/**
 * Modal pour éditer le solde disponible avec explications
 * Permet de corriger le solde initial ou en cas d'erreur
 */
export default function EditBalanceModal({
  isOpen,
  currentBalance,
  onSubmit,
  onCancel,
}: EditBalanceModalProps) {
  const [serverError, setServerError] = useState<string | null>(null)
  const form = useForm<EditBalanceFormInput, undefined, EditBalanceForm>({
    resolver: zodResolver(editBalanceFormSchema),
    defaultValues: { balance: currentBalance },
    mode: 'onSubmit',
  })

  const handleValidSubmit = async (data: EditBalanceForm) => {
    setServerError(null)
    try {
      await onSubmit(data.balance)
    } catch (error) {
      logger.error('Erreur lors de la mise à jour du solde:', error)
      setServerError('Erreur lors de la mise à jour du solde')
    }
  }

  const handleCancel = () => {
    form.reset({ balance: currentBalance })
    setServerError(null)
    onCancel()
  }

  const balanceError = form.formState.errors.balance
  const isSubmitting = form.formState.isSubmitting

  return (
    <Dialog open={isOpen} onOpenChange={handleCancel}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-gray-900">
            Modifier le solde disponible
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(handleValidSubmit)} className="space-y-4" noValidate>
          {/* Explication */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
            <div className="flex items-start space-x-2">
              <svg
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div className="text-xs leading-tight text-blue-800">
                <p className="mb-1 font-medium">À quoi sert cette modification ?</p>
                <p className="mb-1">
                  Cette édition permet de <strong>corriger</strong> ou{' '}
                  <strong>créer un solde initial</strong> lors de la première utilisation.
                </p>
                <p className="text-blue-700">
                  ⚠️ Ce montant doit refléter votre solde bancaire réel.
                </p>
              </div>
            </div>
          </div>

          {/* Champ de saisie */}
          <div>
            <Label htmlFor="balance" className="text-sm font-medium text-gray-700">
              Nouveau solde disponible
            </Label>
            <div className="relative mt-1">
              <DecimalFormInput
                control={form.control}
                name="balance"
                id="balance"
                placeholder="0.00"
                className="pr-8"
                disabled={isSubmitting}
                allowNegative
                ariaInvalid={!!balanceError}
              />
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                <span className="text-sm text-gray-500">€</span>
              </div>
            </div>
            {balanceError && <p className="mt-1 text-xs text-red-600">{balanceError.message}</p>}
          </div>

          {serverError && (
            <p role="alert" className="text-xs text-red-600">
              {serverError}
            </p>
          )}

          {/* Boutons d'action */}
          <div className="flex space-x-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              className="flex-1"
              disabled={isSubmitting}
            >
              Annuler
            </Button>
            <Button type="submit" className="flex-1" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <div className="mr-2 h-4 w-4 animate-spin rounded-full border-b-2 border-white"></div>
                  Sauvegarde...
                </>
              ) : (
                'Confirmer'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
