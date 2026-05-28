'use client'

import { useState } from 'react'
import { useForm, type FieldErrors, type FieldPath } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'

import { Button } from '@/components/ui/button'
import { DecimalFormInput } from '@/components/ui/DecimalFormInput'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { MODAL_CONTENT_CLASSES } from '@/components/ui/modal-content-classes'
import { preventEnterSubmit } from '@/lib/forms/prevent-enter-submit'
import { logger } from '@/lib/logger'
import { validateSalaryFormSchema, type ValidateSalaryForm } from '@/lib/schemas/income'

import { useValidateSalary, type ValidateSalaryResult } from '@/hooks/useRealIncomes'

interface SalaryValidationModalProps {
  isOpen: boolean
  incomeId: string
  /** Le montant pré-rempli — = la `amount` de la ligne salaire auto-créée
   *  à la finalisation du recap. L'utilisateur peut l'ajuster (+/-). */
  defaultAmount: number
  onClose: () => void
  /** Callback succès : reçoit le résultat du RPC (delta, exceptional, balance).
   *  Le parent peut afficher un snackbar avec le message d'équilibrage si
   *  delta != 0. */
  onSuccess?: (result: ValidateSalaryResult) => void
}

type SalaryValidationFormInput = z.input<typeof validateSalaryFormSchema>

/**
 * Sprint Salary-Auto-At-Recap-Complete (2026-06-05).
 *
 * Modal de vérification du salaire — déclenchée par long-press sur une ligne
 * `real_income_entries` avec `recap_origin_id != null && applied_to_balance_at
 * == null`. Demande "C'est bien le salaire que tu as reçu ?" avec input
 * pré-rempli + boutons Annuler/Confirmer.
 *
 *   - Annuler : ferme sans rien faire (le salaire reste non-validé).
 *   - Confirmer : POST /api/finance/income/real/validate-salary qui :
 *       (a) valide le salaire à son amount original (bank_balance += amount),
 *       (b) si delta != 0, crée + valide un revenu/dépense exceptionnel
 *           "Équilibrage salaire" en plus.
 *
 * Le salaire devient read-only à vie après validation (kebab masqué,
 * guards 409 côté serveur). L'éventuel "Équilibrage salaire" peut être
 * modifié/supprimé comme toute transaction classique.
 */
export default function SalaryValidationModal({
  isOpen,
  incomeId,
  defaultAmount,
  onClose,
  onSuccess,
}: SalaryValidationModalProps) {
  const [serverError, setServerError] = useState<string | null>(null)
  const mutation = useValidateSalary()

  const form = useForm<SalaryValidationFormInput, undefined, ValidateSalaryForm>({
    resolver: zodResolver(validateSalaryFormSchema),
    defaultValues: { realAmount: defaultAmount },
    mode: 'onSubmit',
  })

  const handleValidSubmit = async (data: ValidateSalaryForm) => {
    setServerError(null)
    try {
      const result = await mutation.mutateAsync({
        incomeId,
        realAmount: data.realAmount,
      })
      onSuccess?.(result)
      onClose()
    } catch (error) {
      logger.error('[SalaryValidationModal] validate error', error)
      const message = error instanceof Error ? error.message : 'Erreur inconnue'
      // Map known server error codes to friendly French messages.
      if (message === 'salary-already-validated') {
        setServerError('Ce salaire a déjà été validé.')
      } else if (message === 'salary-income-not-found') {
        setServerError('Ce salaire est introuvable.')
      } else if (message === 'salary-row-mismatch') {
        setServerError('Cette ligne n’est pas un salaire à valider.')
      } else {
        setServerError('Erreur lors de la validation du salaire.')
      }
    }
  }

  const handleCancel = () => {
    if (mutation.isPending) return
    form.reset({ realAmount: defaultAmount })
    setServerError(null)
    onClose()
  }

  const onInvalidSubmit = (errors: FieldErrors<SalaryValidationFormInput>) => {
    const firstErrorKey = Object.keys(errors)[0]
    if (firstErrorKey) {
      form.setFocus(firstErrorKey as FieldPath<SalaryValidationFormInput>)
    }
  }

  const amountError = form.formState.errors.realAmount
  const isSubmitting = mutation.isPending || form.formState.isSubmitting

  return (
    <Dialog open={isOpen} onOpenChange={handleCancel}>
      <DialogContent className={MODAL_CONTENT_CLASSES}>
        {/* Header */}
        <div className="shrink-0 border-b border-gray-200 px-6 py-4">
          <DialogTitle className="text-lg font-semibold text-gray-900">
            C’est bien ton vrai salaire ?
          </DialogTitle>
        </div>

        <form
          onSubmit={form.handleSubmit(handleValidSubmit, onInvalidSubmit)}
          onKeyDown={preventEnterSubmit}
          className="flex min-h-0 flex-auto flex-col overflow-hidden"
          noValidate
        >
          <div className="min-h-0 flex-auto space-y-3 overflow-y-auto px-6 py-4">
            {/* Explication */}
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
              <div className="flex items-start space-x-1.5">
                <svg
                  className="mt-0.5 h-4 w-4 shrink-0 text-blue-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <div className="text-xs leading-tight text-blue-800">
                  <p className="mb-1 font-medium">Vérifie le montant exact reçu.</p>
                  <p>
                    Si le montant diffère, on créera automatiquement un <strong>revenu</strong> ou
                    une <strong>dépense</strong> d’ajustement (« Équilibrage salaire ») pour la
                    différence.
                  </p>
                </div>
              </div>
            </div>

            {/* Champ */}
            <div>
              <Label htmlFor="realAmount" className="text-sm font-medium text-gray-700">
                Salaire reçu
              </Label>
              <div className="relative mt-1">
                <DecimalFormInput
                  control={form.control}
                  name="realAmount"
                  id="realAmount"
                  placeholder="0,00"
                  className="pr-8"
                  disabled={isSubmitting}
                  ariaInvalid={!!amountError}
                  ariaDescribedby={amountError ? 'realAmount-error' : undefined}
                />
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                  <span className="text-sm text-gray-500">€</span>
                </div>
              </div>
              {amountError && (
                <p id="realAmount-error" className="mt-1 text-xs text-red-600">
                  {amountError.message}
                </p>
              )}
            </div>

            {serverError && (
              <p role="alert" className="text-xs text-red-600">
                {serverError}
              </p>
            )}
          </div>

          {/* Boutons */}
          <div className="flex shrink-0 space-x-2 border-t border-gray-200 px-6 py-4">
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
                  <div className="mr-1.5 h-4 w-4 animate-spin rounded-full border-b-2 border-white"></div>
                  Validation…
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
