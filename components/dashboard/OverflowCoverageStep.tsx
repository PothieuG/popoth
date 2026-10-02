'use client'

import { PiggyBank, WandSparkles } from 'lucide-react'
import type { ReactNode } from 'react'

import { Arrow, Line, lineLimit } from '@/components/monthly-recap/RefloatPanels'
import { Button } from '@/components/ui/button'
import {
  applyCoverageToPreview,
  ravDeltaOf,
  type ExpenseBreakdownPreviewData,
} from '@/hooks/useExpenseBreakdownPreview'
import {
  autoCoverOverflow,
  coverageTotal,
  EMPTY_COVERAGE,
  type OverflowCoverage,
} from '@/lib/expense-breakdown'
import { formatEuro } from '@/lib/format-currency'
import { cn } from '@/lib/utils'

/**
 * Sprint Expense-Overflow-Coverage (2026-10-02) — étape « Couvrir le
 * dépassement » de la modale d'ajout de dépense, affichée quand la dépense
 * dépasse le budget ET ses économies, et qu'il existe des réserves.
 *
 * Deux choix : imputer le dépassement au reste à vivre (présélectionné :
 * aucune réserve n'est prise sans action), ou puiser dans ses réserves avec
 * un curseur par source (tirelire, économies des autres budgets — mêmes
 * curseurs que le renflouement du récap). La couverture peut être partielle :
 * ce qui n'est pas couvert va sur le reste à vivre. Composant contrôlé : le
 * mode et la couverture vivent dans `AddTransactionModal` (rien n'est écrit
 * avant « Ajouter la dépense »).
 */

export type CoverageMode = 'rav' | 'reserves'

interface OverflowCoverageStepProps {
  /** Aperçu SANS couverture renvoyé par la route preview-breakdown. */
  breakdown: ExpenseBreakdownPreviewData
  /** Reste à vivre avant la dépense (`null` si pas encore chargé). */
  currentRav: number | null
  mode: CoverageMode
  onModeChange: (mode: CoverageMode) => void
  coverage: OverflowCoverage
  onCoverageChange: (coverage: OverflowCoverage) => void
  disabled?: boolean
}

export function OverflowCoverageStep({
  breakdown,
  currentRav,
  mode,
  onModeChange,
  coverage,
  onCoverageChange,
  disabled = false,
}: OverflowCoverageStepProps) {
  const overflow = breakdown.overflow
  const piggyAvailable = Math.max(0, breakdown.piggy_bank_before)
  const budgets = breakdown.other_budgets_savings
  const totalReserves = piggyAvailable + budgets.reduce((sum, b) => sum + b.available, 0)

  const effective = mode === 'reserves' ? coverage : EMPTY_COVERAGE
  const covered = coverageTotal(effective)
  const uncovered = Math.max(0, Math.round((overflow - covered) * 100) / 100)
  const remainingToCover = overflow - coverageTotal(coverage)
  const ravAfter =
    currentRav != null
      ? currentRav - ravDeltaOf(applyCoverageToPreview(breakdown, effective))
      : null
  const coveredPct = overflow > 0 ? Math.min(100, (covered / overflow) * 100) : 0

  const budgetValue = (budgetId: string): number =>
    coverage.budgets.find((b) => b.budget_id === budgetId)?.amount ?? 0

  const setBudgetValue = (budgetId: string, value: number) => {
    const others = coverage.budgets.filter((b) => b.budget_id !== budgetId)
    onCoverageChange({
      piggy: coverage.piggy,
      // Ordre d'affichage conservé ; un montant nul retire la source.
      budgets: budgets
        .map((b) =>
          b.budget_id === budgetId
            ? { budget_id: budgetId, amount: value }
            : (others.find((o) => o.budget_id === b.budget_id) ?? null),
        )
        .filter((b): b is { budget_id: string; amount: number } => !!b && b.amount > 0),
    })
  }

  const canAutoDistribute =
    remainingToCover > 0.004 && totalReserves - coverageTotal(coverage) > 0.004

  return (
    <div className="space-y-4">
      {/* Bandeau collant : dépassement, part couverte, part sur le reste à
          vivre. 3 colonnes fixes, la hauteur ne bouge pas pendant le glissement.
          Décalage = marge haute du corps de la modale (`py-4`, + 1 px contre
          l'arrondi) : le collage se fait au bord du cadre et le fond blanc
          masque la liste qui défile. */}
      <div className="sticky -top-[calc(1rem+1px)] z-10 -mx-6 -mt-4 bg-white px-6 pt-4 pb-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
          <dl className="grid grid-cols-3 gap-2 text-center">
            <SummaryCell label="Dépassement" amount={overflow} className="text-gray-900" />
            <SummaryCell
              label="Couvert"
              amount={covered}
              className={covered > 0.004 ? 'text-violet-700' : 'text-gray-400'}
            />
            <SummaryCell
              label="Reste à vivre"
              amount={uncovered}
              signed
              className={uncovered > 0.004 ? 'text-blue-700' : 'text-gray-400'}
            />
          </dl>
          <div
            role="progressbar"
            aria-label="Part du dépassement couverte par vos réserves"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(coveredPct)}
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-blue-100"
          >
            <div
              className="h-full rounded-full bg-violet-500 transition-all duration-200"
              style={{ width: `${coveredPct}%` }}
            />
          </div>
          {currentRav != null && ravAfter != null && (
            <p aria-live="polite" className="mt-2 text-center text-xs text-gray-600">
              Reste à vivre : <Arrow from={currentRav} to={ravAfter} className="text-blue-800" />
            </p>
          )}
        </div>
      </div>

      <div role="radiogroup" aria-label="Comment couvrir le dépassement" className="space-y-2">
        <ChoiceCard
          checked={mode === 'rav'}
          disabled={disabled}
          onSelect={() => onModeChange('rav')}
          title="Imputer au reste à vivre"
          description={
            <>
              Le budget « {breakdown.budget_name} » passe en déficit de {formatEuro(overflow)}.
              Aucune réserve n&apos;est touchée.
            </>
          }
          tone="blue"
        />
        <ChoiceCard
          checked={mode === 'reserves'}
          disabled={disabled}
          onSelect={() => onModeChange('reserves')}
          title="Puiser dans mes réserves"
          description={
            <>
              Tirelire et économies de vos autres budgets : {formatEuro(totalReserves)} disponibles.
            </>
          }
          tone="violet"
        />
      </div>

      {mode === 'reserves' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-violet-300 bg-violet-50 text-violet-900 hover:bg-violet-100"
              onClick={() =>
                onCoverageChange(
                  autoCoverOverflow(
                    overflow,
                    piggyAvailable,
                    budgets.map((b) => ({ budget_id: b.budget_id, available: b.available })),
                  ),
                )
              }
              disabled={disabled || !canAutoDistribute}
            >
              <WandSparkles aria-hidden="true" />
              Répartir automatiquement
            </Button>
            {coverageTotal(coverage) > 0.004 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onCoverageChange(EMPTY_COVERAGE)}
                disabled={disabled}
              >
                Tout remettre à 0
              </Button>
            )}
          </div>

          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 px-3">
            {piggyAvailable > 0 && (
              <Line
                title="Tirelire"
                label={
                  <span className="flex items-center gap-1.5">
                    <PiggyBank aria-hidden="true" className="size-4 text-violet-600" />
                    Tirelire
                  </span>
                }
                value={coverage.piggy}
                capacity={piggyAvailable}
                limit={lineLimit(piggyAvailable, coverage.piggy, remainingToCover)}
                segments={[{ until: piggyAvailable, tone: 'violet' }]}
                onChange={(value) => onCoverageChange({ ...coverage, piggy: value })}
                details={
                  <>
                    Il restera{' '}
                    <Arrow
                      from={piggyAvailable}
                      to={piggyAvailable - coverage.piggy}
                      className="text-violet-800"
                    />
                  </>
                }
              />
            )}
            {budgets.map((budget) => {
              const value = budgetValue(budget.budget_id)
              return (
                <Line
                  key={budget.budget_id}
                  title={`Économies « ${budget.budget_name} »`}
                  value={value}
                  capacity={budget.available}
                  limit={lineLimit(budget.available, value, remainingToCover)}
                  segments={[{ until: budget.available, tone: 'violet' }]}
                  onChange={(next) => setBudgetValue(budget.budget_id, next)}
                  details={
                    <>
                      Il restera{' '}
                      <Arrow
                        from={budget.available}
                        to={budget.available - value}
                        className="text-violet-800"
                      />
                    </>
                  }
                />
              )
            })}
          </ul>

          {uncovered > 0.004 && (
            <p className="text-xs leading-relaxed text-gray-600">
              Les {formatEuro(uncovered)} non couverts seront imputés au reste à vivre.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function SummaryCell({
  label,
  amount,
  className,
  signed = false,
}: {
  label: string
  amount: number
  className: string
  /** Montant retiré (affiché « −X ») quand il n'est pas nul. */
  signed?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] font-medium tracking-wide text-gray-500 uppercase">
        {label}
      </dt>
      <dd className={cn('truncate text-base font-bold tabular-nums', className)}>
        {signed && amount > 0.004 ? `−${formatEuro(amount)}` : formatEuro(amount)}
      </dd>
    </div>
  )
}

const CHOICE_TONES = {
  blue: { selected: 'border-blue-600 bg-blue-50', dot: 'border-blue-600 bg-blue-600' },
  violet: { selected: 'border-violet-600 bg-violet-50', dot: 'border-violet-600 bg-violet-600' },
} as const

function ChoiceCard({
  checked,
  disabled,
  onSelect,
  title,
  description,
  tone,
}: {
  checked: boolean
  disabled: boolean
  onSelect: () => void
  title: string
  description: ReactNode
  tone: keyof typeof CHOICE_TONES
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-60',
        checked ? CHOICE_TONES[tone].selected : 'border-gray-200 bg-white hover:bg-gray-50',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2',
          checked ? CHOICE_TONES[tone].dot : 'border-gray-300 bg-white',
        )}
      >
        {checked && <span className="size-1.5 rounded-full bg-white" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-gray-900">{title}</span>
        <span className="block text-xs leading-snug text-gray-600">{description}</span>
      </span>
    </button>
  )
}
