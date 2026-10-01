import { formatEuro } from '@/lib/format-currency'
import {
  nextMonth,
  monthName,
  ofMonth,
  salaryDelta,
  type MonthRef,
} from '@/lib/finance/salary-reception'

interface SalaryReceptionPanelProps {
  /** `current` : la paie valide la ligne « Salaire » du mois. `advance` : elle
   *  finance le mois suivant. Cf. `resolveSalaryReceptionState`. */
  mode: 'current' | 'advance'
  /** Salaire prévu (ligne en attente, ou salaire déclaré dans les paramètres). */
  expected: number
  /** Montant saisi. */
  received: number
  /** Mois en cours côté appli (mois recapé dans le wizard « Compléter le mois »). */
  currentMonth: MonthRef
}

/**
 * Sprint Salary-Reception (2026-10-02). Encart du dialogue d'ajout, option
 * « Réception du salaire » : dit ce que le montant saisi va changer (solde,
 * reste à vivre, et de quel mois) avant de valider. Remplace
 * `RemainingToLivePreview`, qui annoncerait à tort « + montant » sur le reste à
 * vivre du mois : un salaire n'y entre jamais en entier, seul l'écart avec le
 * salaire prévu compte.
 */
export default function SalaryReceptionPanel({
  mode,
  expected,
  received,
  currentMonth,
}: SalaryReceptionPanelProps) {
  const delta = salaryDelta(received, expected)
  const funded = mode === 'advance' ? nextMonth(currentMonth) : currentMonth

  return (
    <div
      data-testid="salary-reception-panel"
      className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900"
    >
      <dl className="space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <dt>Salaire prévu</dt>
          <dd className="font-semibold tabular-nums">{formatEuro(expected)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt>Écart</dt>
          <dd
            className={
              delta > 0
                ? 'font-semibold text-green-700 tabular-nums'
                : delta < 0
                  ? 'font-semibold text-red-700 tabular-nums'
                  : 'font-semibold tabular-nums'
            }
          >
            {delta > 0 ? '+' : delta < 0 ? '−' : ''}
            {formatEuro(Math.abs(delta))}
          </dd>
        </div>
      </dl>

      {mode === 'advance' ? (
        <p className="text-xs leading-snug text-blue-800">
          Votre solde est mis à jour tout de suite. Ce salaire finance {monthName(funded)} : il
          n&apos;entre pas dans le reste à vivre {ofMonth(currentMonth)}.
        </p>
      ) : (
        <p className="text-xs leading-snug text-blue-800">
          C&apos;est le salaire {ofMonth(funded)} : la ligne « Salaire » en attente sera validée et
          votre solde mis à jour.
        </p>
      )}

      {delta !== 0 && (
        <p className="text-xs leading-snug font-medium text-blue-900">
          {delta > 0
            ? mode === 'advance'
              ? `Les ${formatEuro(delta)} de plus que prévu s'ajouteront à votre reste à vivre ${ofMonth(funded)}.`
              : `Les ${formatEuro(delta)} de plus que prévu s'ajoutent tout de suite à votre reste à vivre.`
            : mode === 'advance'
              ? `Les ${formatEuro(-delta)} de moins que prévu seront retirés de votre reste à vivre ${ofMonth(funded)}.`
              : `Les ${formatEuro(-delta)} de moins que prévu sont retirés tout de suite de votre reste à vivre.`}
        </p>
      )}
    </div>
  )
}
