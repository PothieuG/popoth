'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { GroupData } from '@/app/api/groups/route'

interface DeleteGroupModalProps {
  group: GroupData
  isOpen: boolean
  onClose: () => void
  onConfirm: (groupId: string) => Promise<boolean>
}

/**
 * Secure modal for group deletion with confirmation
 * Requires user to type "Delete [group_name]" to confirm
 */
export default function DeleteGroupModal({ group, isOpen, onClose, onConfirm }: DeleteGroupModalProps) {
  const [confirmText, setConfirmText] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const expectedText = `Delete ${group.name}`
  const isConfirmValid = confirmText === expectedText

  /**
   * Handles the deletion confirmation
   */
  const handleConfirm = async () => {
    if (!isConfirmValid) {
      setError('Le texte de confirmation ne correspond pas')
      return
    }

    setIsDeleting(true)
    setError(null)

    try {
      const success = await onConfirm(group.id)
      if (success) {
        onClose()
        // Reset state
        setConfirmText('')
        setError(null)
      } else {
        setError('Erreur lors de la suppression du groupe')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setIsDeleting(false)
    }
  }

  /**
   * Handles modal close with reset
   */
  const handleClose = () => {
    setConfirmText('')
    setError(null)
    onClose()
  }

  if (!isOpen) return null

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4"
        onClick={handleClose}
      >
        {/* Modal Content */}
        <Card 
          className="w-full max-w-md bg-white shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-6">
            {/* Header */}
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-red-600">
                Supprimer le groupe
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClose}
                className="p-1"
                disabled={isDeleting}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </Button>
            </div>

            {/* Warning Content */}
            <div className="space-y-4 mb-6">
              <div className="flex items-start space-x-3 p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex-shrink-0">
                  <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.98-.833-2.75 0L4.064 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-red-800">
                    Attention ! Cette action est irréversible
                  </h3>
                  <div className="mt-2 text-sm text-red-700">
                    <p>La suppression du groupe entraînera :</p>
                    <ul className="list-disc list-inside mt-1 space-y-1">
                      <li>La suppression définitive du groupe "<strong>{group.name}</strong>"</li>
                      <li>La suppression de tous les membres du groupe</li>
                      <li>La perte de toutes les données associées</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm text-gray-600">
                  Le groupe contient actuellement <strong>{group.member_count || 1} membre(s)</strong> avec un budget estimé de <strong>{group.monthly_budget_estimate.toFixed(2)} €/mois</strong>.
                </p>
              </div>
            </div>

            {/* Confirmation Input */}
            <div className="space-y-4 mb-6">
              <div>
                <Label htmlFor="confirmDelete" className="text-sm font-medium text-gray-700">
                  Pour confirmer la suppression, tapez exactement :
                </Label>
                <div className="mt-1 p-2 bg-gray-100 border rounded text-sm font-mono text-gray-800">
                  Delete {group.name}
                </div>
              </div>
              
              <Input
                id="confirmDelete"
                type="text"
                value={confirmText}
                onChange={(e) => {
                  setConfirmText(e.target.value)
                  if (error) setError(null)
                }}
                placeholder="Tapez le texte de confirmation ici..."
                className={`w-full ${isConfirmValid ? 'border-green-300 bg-green-50' : 'border-gray-300'}`}
                disabled={isDeleting}
              />
              
              {confirmText && !isConfirmValid && (
                <p className="text-xs text-red-500">
                  Le texte ne correspond pas. Vérifiez l'orthographe et les majuscules.
                </p>
              )}
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end space-x-3">
              <Button
                variant="outline"
                onClick={handleClose}
                disabled={isDeleting}
              >
                Annuler
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={!isConfirmValid || isDeleting}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {isDeleting ? (
                  <div className="flex items-center space-x-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                    <span>Suppression...</span>
                  </div>
                ) : (
                  'Supprimer définitivement'
                )}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </>
  )
}