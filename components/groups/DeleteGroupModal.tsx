'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ModalCloseX } from '@/components/ui/modal-close-x'
import type { GroupData } from '@/app/api/groups/route'

interface DeleteGroupModalProps {
  group: GroupData
  isOpen: boolean
  onClose: () => void
  onConfirm: (groupId: string) => Promise<boolean>
}

/**
 * Secure modal for group deletion with confirmation.
 * Requires user to type "Delete [group_name]" to confirm.
 *
 * Migrated to Radix Dialog (Sprint Zod-Rollout v8) for focus trap + Esc-to-close +
 * return-focus + role=dialog + aria-modal. Custom close X preserved via
 * `hideCloseButton={true}` on DialogContent.
 */
export default function DeleteGroupModal({
  group,
  isOpen,
  onClose,
  onConfirm,
}: DeleteGroupModalProps) {
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

  const handleOpenChange = (open: boolean) => {
    if (!open && !isDeleting) {
      handleClose()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        hideCloseButton
        className="overflow-hidden border-0 bg-white p-0 shadow-xl sm:max-w-md"
      >
        <div className="p-6">
          {/* Header */}
          <div className="mb-6 flex items-center justify-between">
            <DialogTitle asChild>
              <h2 className="text-xl font-semibold text-red-600">Supprimer le groupe</h2>
            </DialogTitle>
            <ModalCloseX
              onClose={handleClose}
              disabled={isDeleting}
              variant="ghost"
              className="p-1"
            />
          </div>

          {/* Warning Content */}
          <div className="mb-6 space-y-4">
            <div className="flex items-start space-x-3 rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="shrink-0">
                <svg
                  className="h-6 w-6 text-red-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.98-.833-2.75 0L4.064 16.5c-.77.833.192 2.5 1.732 2.5z"
                  />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-medium text-red-800">
                  Attention ! Cette action est irréversible
                </h3>
                <div className="mt-2 text-sm text-red-700">
                  <p>La suppression du groupe entraînera :</p>
                  <ul className="mt-1 list-inside list-disc space-y-1">
                    <li>
                      La suppression définitive du groupe &quot;<strong>{group.name}</strong>
                      &quot;
                    </li>
                    <li>La suppression de tous les membres du groupe</li>
                    <li>La perte de toutes les données associées</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm text-gray-600">
                Le groupe contient actuellement <strong>{group.member_count || 1} membre(s)</strong>{' '}
                avec un budget estimé de{' '}
                <strong>{group.monthly_budget_estimate.toFixed(2)} €/mois</strong>.
              </p>
            </div>
          </div>

          {/* Confirmation Input */}
          <div className="mb-6 space-y-4">
            <div>
              <Label htmlFor="confirmDelete" className="text-sm font-medium text-gray-700">
                Pour confirmer la suppression, tapez exactement :
              </Label>
              <div className="mt-1 rounded border bg-gray-100 p-2 font-mono text-sm text-gray-800">
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
                Le texte ne correspond pas. Vérifiez l&apos;orthographe et les majuscules.
              </p>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3">
            <Button variant="outline" onClick={handleClose} disabled={isDeleting}>
              Annuler
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={!isConfirmValid || isDeleting}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {isDeleting ? (
                <div className="flex items-center space-x-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                  <span>Suppression...</span>
                </div>
              ) : (
                'Supprimer définitivement'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
