import { formatEuro } from '@/lib/format-currency'
import {
  monthName,
  ofMonth,
  salaryDelta,
  type MonthRef,
  type SalaryMonthOption,
} from '@/lib/finance/salary-reception'

interface SalaryReceptionPanelProps {
  /** Mois que la paie finance, tel que choisi dans le formulaire. */
  option: SalaryMonthOption
  /** Montant saisi. */
  received: number
  /** Mois ouvert (mois du jour, ou mois recapé dans « Compléter le mois »). */
  openMonth: MonthRef
}

/**
 * Sprint Salary-Reception (2026-10-02). Encart du dialogue d'ajout, option
 * « Réception du salaire » : dit ce que le montant saisi va changer (solde,
 * reste à vivre, et de quel mois) avant de valider. Remplace
 * `RemainingToLivePreview`, qui annoncerait à tort « + montant » sur le reste à
 * vivre du mois : un salaire n'y entre jamais en entier, seul l'écart avec le
 * salaire prévu compte — tout de suite si la paie finance le mois ouvert, à la
 * fin du récap si elle finance le mois suivant.
 */
export default function SalaryReceptionPanel({
  option,
  received,
  openMonth,
}: SalaryReceptionPanelProps) {
  if (option.status.kind === 'received') return null

  const expected = option.status.expected
  const delta = salaryDelta(received, expected)
  const funded = option.month

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

      {!option.isOpenMonth ? (
        <p className="text-xs leading-snug text-blue-800">
          Votre solde est mis à jour tout de suite. Ce salaire finance {monthName(funded)} : il
          n&apos;entre pas dans le reste à vivre {ofMonth(openMonth)}.
        </p>
      ) : option.status.kind === 'awaiting' ? (
        <p className="text-xs leading-snug text-blue-800">
          C&apos;est le salaire {ofMonth(funded)} : la ligne « Salaire » en attente sera validée et
          votre solde mis à jour.
        </p>
      ) : (
        <p className="text-xs leading-snug text-blue-800">
          C&apos;est le salaire {ofMonth(funded)} : votre solde est mis à jour tout de suite. Le
          reste à vivre le compte déjà, seul l&apos;écart le fait bouger.
        </p>
      )}

      {delta !== 0 && (
        <p className="text-xs leading-snug font-medium text-blue-900">
          {delta > 0
            ? option.isOpenMonth
              ? `Les ${formatEuro(delta)} de plus que prévu s'ajoutent tout de suite à votre reste à vivre.`
              : `Les ${formatEuro(delta)} de plus que prévu s'ajouteront à votre reste à vivre ${ofMonth(funded)}.`
            : option.isOpenMonth
              ? `Les ${formatEuro(-delta)} de moins que prévu sont retirés tout de suite de votre reste à vivre.`
              : `Les ${formatEuro(-delta)} de moins que prévu seront retirés de votre reste à vivre ${ofMonth(funded)}.`}
        </p>
      )}
    </div>
  )
}
