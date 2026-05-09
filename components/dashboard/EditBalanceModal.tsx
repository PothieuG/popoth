'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface EditBalanceModalProps {
  isOpen: boolean
  currentBalance: number
  onSubmit: (newBalance: number) => void
  onCancel: () => void
}

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
  const [balance, setBalance] = useState(currentBalance.toString())
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      const newBalance = parseFloat(balance)
      if (isNaN(newBalance)) {
        throw new Error('Montant invalide')
      }

      await onSubmit(newBalance)
    } catch (error) {
      console.error('Erreur lors de la mise à jour du solde:', error)
      // Afficher l'erreur à l'utilisateur si nécessaire
    } finally {
      setIsLoading(false)
    }
  }

  const handleCancel = () => {
    setBalance(currentBalance.toString())
    onCancel()
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleCancel}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-gray-900">
            Modifier le solde disponible
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
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
              <Input
                id="balance"
                type="text"
                inputMode="decimal"
                value={balance}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === '' || /^-?\d*[.,]?\d*$/.test(v)) {
                    setBalance(v.replace(',', '.'))
                  }
                }}
                placeholder="0.00"
                className="pr-8"
                disabled={isLoading}
                required
              />
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                <span className="text-sm text-gray-500">€</span>
              </div>
            </div>
          </div>

          {/* Boutons d'action */}
          <div className="flex space-x-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              className="flex-1"
              disabled={isLoading}
            >
              Annuler
            </Button>
            <Button type="submit" className="flex-1" disabled={isLoading}>
              {isLoading ? (
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
