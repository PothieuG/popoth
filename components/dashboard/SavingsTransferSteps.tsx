'use client'

import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { Button } from '@/components/ui/button'
import { DecimalFormInput } from '@/components/ui/DecimalFormInput'
import { InlineSpinner } from '@/components/ui/InlineSpinner'
import { Label } from '@/components/ui/label'
import { useFocusFirstError } from '@/hooks/useFocusFirstError'
import { useSavingsTransfer } from '@/hooks/useSavingsTransfer'
import {
  exceedsSavingsTransferMax,
  savingsTransferDelta,
  savingsTransferMax,
  type SavingsTransferDirection,
} from '@/lib/finance/savings-transfer'
import { formatEuro } from '@/lib/format-currency'
import { preventEnterSubmit } from '@/lib/forms/prevent-enter-submit'
import type { FinancialContext } from '@/lib/query-client'
import { makeSavingsTransferFormSchema } from '@/lib/schemas/savings'
import { cn } from '@/lib/utils'

/**
 * Part 50 (2026-10-03) — « Transfert d'économies », 3e type du dialogue
 * d'ajout. Deux étapes après le choix du type : le sens (envoi / réception),
 * puis le montant. Seul le solde disponible bouge (cf.
 * `lib/finance/savings-transfer.ts`).
 *
 * Le formulaire du montant vit ici, pas dans le `useForm` du dialogue : il n'a
 * ni description, ni date, ni rattachement, et son plafond dépend du total des
 * économies (Pattern D).
 */

const DIRECTION_COPY: Record<
  SavingsTransferDirection,
  { label: string; hint: string; effect: string; submit: string }
> = {
  send: {
    label: 'Envoi',
    hint: 'Du compte vers l’épargne · le solde baisse',
    effect:
      'L’argent part de votre compte vers votre épargne\u00a0: votre solde disponible baisse d’autant.',
    submit: 'Valider l’envoi',
  },
  receive: {
    label: 'Réception',
    hint: 'De l’épargne vers le compte · le solde augmente',
    effect:
      'L’argent revient de votre épargne sur votre compte\u00a0: votre solde disponible augmente d’autant.',
    submit: 'Valider la réception',
  },
}

/** Codes renvoyés par `POST /api/finance/savings-transfer`. */
const TRANSFER_ERROR_COPY: Record<string, string> = {
  'savings-transfer-exceeds-savings':
    'Le montant dépasse le total de vos économies. Rechargez la page si elles ont changé.',
}

const ARROW_PATH: Record<SavingsTransferDirection, string> = {
  send: 'M5 12h14m0 0l-6-6m6 6l-6 6',
  receive: 'M19 12H5m0 0l6 6m-6-6l6-6',
}

interface SavingsTransferDirectionStepProps {
  onSelect: (direction: SavingsTransferDirection) => void
  /** Classes d'animation de l'étape (sens du glissement). */
  className?: string
}

export function SavingsTransferDirectionStep({
  onSelect,
  className,
}: SavingsTransferDirectionStepProps) {
  return (
    <div className={cn('min-h-0 flex-auto space-y-3 overflow-y-auto px-6 py-4', className)}>
      <p className="text-sm text-gray-600">Dans quel sens va l’argent&nbsp;?</p>
      <div className="flex flex-col space-y-2">
        {(['send', 'receive'] as const).map((direction) => (
          <button
            key={direction}
            type="button"
            onClick={() => onSelect(direction)}
            className="flex items-center justify-between rounded-lg border border-violet-200 bg-violet-50 p-4 text-left transition-all hover:bg-violet-100 focus-visible:outline-2 focus-visible:outline-violet-500"
          >
            <div className="flex items-center space-x-2">
              <svg
                className="h-6 w-6 shrink-0 text-violet-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d={ARROW_PATH[direction]}
                />
              </svg>
              <div>
                <p className="font-medium text-violet-700">{DIRECTION_COPY[direction].label}</p>
                <p className="text-xs text-violet-600">{DIRECTION_COPY[direction].hint}</p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

interface SavingsTransferAmountStepProps {
  context: FinancialContext
  direction: SavingsTransferDirection
  /** Total des économies (budgets + tirelire) : plafond du montant. */
  totalSavings: number
  /** Solde disponible actuel, pour l'aperçu. `null` tant qu'il charge. */
  currentBalance: number | null
  onCancel: () => void
  /** Transfert enregistré : le dialogue se ferme. */
  onDone: () => void
  /** Requête en cours : le dialogue bloque retour et fermeture. */
  onBusyChange: (busy: boolean) => void
  className?: string
}

export function SavingsTransferAmountStep({
  context,
  direction,
  totalSavings,
  currentBalance,
  onCancel,
  onDone,
  onBusyChange,
  className,
}: SavingsTransferAmountStepProps) {
  const { transfer } = useSavingsTransfer(context)
  const [serverError, setServerError] = useState<string | null>(null)

  const schema = useMemo(() => makeSavingsTransferFormSchema({ totalSavings }), [totalSavings])
  type FormInput = z.input<typeof schema>
  type FormOutput = z.output<typeof schema>
  const form = useForm<FormInput, undefined, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: { amount: 0 },
    mode: 'onSubmit',
  })
  useFocusFirstError(form)

  const watchedAmount = useWatch({ control: form.control, name: 'amount' })
  const parsedAmount =
    typeof watchedAmount === 'number' ? watchedAmount : parseFloat(String(watchedAmount ?? ''))
  const previewAmount = isNaN(parsedAmount) ? 0 : parsedAmount
  const max = savingsTransferMax(totalSavings)
  // Pas de projection pour un montant refusé : le solde annoncé n'arriverait pas.
  const showsProjection =
    previewAmount > 0 && !exceedsSavingsTransferMax(previewAmount, totalSavings)
  const copy = DIRECTION_COPY[direction]
  const isSubmitting = form.formState.isSubmitting
  const amountError = form.formState.errors.amount

  const onValidSubmit = async (data: FormOutput) => {
    setServerError(null)
    onBusyChange(true)
    const outcome = await transfer({ direction, amount: data.amount })
    if (outcome.ok) {
      onDone()
      return
    }
    onBusyChange(false)
    setServerError(TRANSFER_ERROR_COPY[outcome.error] ?? 'Erreur lors du transfert d’économies.')
  }

  return (
    <form
      onSubmit={form.handleSubmit(onValidSubmit)}
      onKeyDown={preventEnterSubmit}
      className={cn('flex min-h-0 flex-auto flex-col overflow-hidden', className)}
      noValidate
    >
      <div className="min-h-0 flex-auto space-y-4 overflow-y-auto px-6 py-4">
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-gray-50 p-3 text-xs">
          <span className="rounded-full bg-violet-100 px-2 py-0.5 font-medium text-violet-700">
            Transfert d’économies
          </span>
          <span className="rounded-full bg-violet-100 px-2 py-0.5 font-medium text-violet-700">
            {copy.label}
          </span>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="savings-transfer-amount" className="text-sm font-medium text-gray-900">
            Montant (€) <span className="text-red-500">*</span>
          </Label>
          <DecimalFormInput
            control={form.control}
            name="amount"
            id="savings-transfer-amount"
            placeholder="0.00"
            className="w-full"
            disabled={isSubmitting}
            ariaInvalid={!!amountError}
            ariaDescribedby={
              amountError ? 'savings-transfer-amount-error' : 'savings-transfer-amount-hint'
            }
          />
          {amountError ? (
            <p id="savings-transfer-amount-error" className="text-sm text-red-600">
              {amountError.message}
            </p>
          ) : (
            <p id="savings-transfer-amount-hint" className="text-xs text-gray-500">
              Maximum&nbsp;: {formatEuro(max)} (total de vos économies)
            </p>
          )}
        </div>

        <div
          data-testid="savings-transfer-panel"
          className="space-y-2 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900"
        >
          {currentBalance != null && (
            <div className="flex items-baseline justify-between gap-2">
              <span>Solde disponible</span>
              <span className="text-right font-semibold tabular-nums">
                {formatEuro(currentBalance)}
                {showsProjection && (
                  <>
                    {' → '}
                    {formatEuro(currentBalance + savingsTransferDelta(direction, previewAmount))}
                  </>
                )}
              </span>
            </div>
          )}
          <p className="text-xs leading-snug text-violet-800">
            {copy.effect} Rien d’autre ne change&nbsp;: reste à vivre, budgets et économies restent
            tels quels.
          </p>
        </div>

        {serverError && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-700">{serverError}</p>
          </div>
        )}
      </div>

      <div className="flex shrink-0 space-x-2 border-t border-gray-200 px-6 py-4">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
          className="flex-1"
        >
          Annuler
        </Button>
        <Button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 bg-violet-600 hover:bg-violet-700"
        >
          {isSubmitting && <InlineSpinner className="mr-1.5" />}
          {isSubmitting ? 'Transfert...' : copy.submit}
        </Button>
      </div>
    </form>
  )
}
