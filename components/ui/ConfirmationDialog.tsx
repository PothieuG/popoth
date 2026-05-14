'use client'

import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

interface ConfirmationDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning' | 'info'
  loading?: boolean
}

/**
 * Dialog de confirmation réutilisable
 * Utilisé pour confirmer des actions importantes comme la suppression.
 *
 * Migrated to Radix Dialog (Sprint Zod-Rollout v8) for focus trap + Esc-to-close +
 * return-focus + role=dialog + aria-modal. No custom close X (compact design with
 * Cancel + Confirm buttons at footer) — `hideCloseButton={true}` to preserve
 * the original look without Radix's default top-right X.
 */
export default function ConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirmer',
  cancelText = 'Annuler',
  variant = 'danger',
  loading = false,
}: ConfirmationDialogProps) {
  const handleOpenChange = (open: boolean) => {
    if (!open && !loading) {
      onClose()
    }
  }

  const variantStyles = {
    danger: {
      icon: 'text-red-600',
      confirmButton: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
    },
    warning: {
      icon: 'text-yellow-600',
      confirmButton: 'bg-yellow-600 hover:bg-yellow-700 focus:ring-yellow-500',
    },
    info: {
      icon: 'text-blue-600',
      confirmButton: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500',
    },
  }

  const styles = variantStyles[variant]

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        hideCloseButton
        className="overflow-hidden rounded-2xl border-0 p-0 shadow-xl sm:max-w-md sm:rounded-2xl"
      >
        {/* Header avec icône */}
        <div className="p-6 text-center">
          <div
            className={cn(
              'mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full',
              variant === 'danger'
                ? 'bg-red-100'
                : variant === 'warning'
                  ? 'bg-yellow-100'
                  : 'bg-blue-100',
            )}
          >
            {variant === 'danger' && (
              <svg
                className={cn('h-6 w-6', styles.icon)}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            )}
            {variant === 'warning' && (
              <svg
                className={cn('h-6 w-6', styles.icon)}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            )}
            {variant === 'info' && (
              <svg
                className={cn('h-6 w-6', styles.icon)}
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
            )}
          </div>

          <DialogTitle asChild>
            <h3 className="mb-2 text-lg font-bold text-gray-900">{title}</h3>
          </DialogTitle>
          <DialogDescription asChild>
            <p className="text-sm text-gray-600">{message}</p>
          </DialogDescription>
        </div>

        {/* Actions */}
        <div className="flex space-x-3 px-6 pb-6">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 rounded-lg bg-gray-100 px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              'flex flex-1 items-center justify-center rounded-lg px-4 py-2 font-medium text-white transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-50',
              styles.confirmButton,
            )}
          >
            {loading ? (
              <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white"></div>
            ) : (
              confirmText
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
