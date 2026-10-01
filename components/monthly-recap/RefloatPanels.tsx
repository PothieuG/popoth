'use client'

import { WandSparkles } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { formatEuro } from '@/lib/format-currency'
import { budgetRefloatCapacity, round2, splitBudgetRefloat } from '@/lib/recap/refloat-plan'
import { cn } from '@/lib/utils'

import { RefloatAmountInput } from './RefloatAmountInput'
import { RefloatSlider, type RefloatSliderSegment } from './RefloatSlider'

/**
 * Sprint Recap-Manual-Refloat (2026-10-01) — corps des 3 sections de l'écran
 * « Gestion du déficit ». Composants contrôlés : la valeur en cours
 * d'édition vit dans `BilanNegativeStep`, qui recalcule le reste à renflouer
 * à chaque mouvement. Chaque ligne est bornée à
 * `min(sa limite, sa valeur + reste à renflouer)` : on ne peut pas renflouer
 * plus que le déficit.
 */

/** Plafond atteignable d'une ligne : sa limite propre, ou moins si le reste à
 *  renflouer ne permet pas d'aller plus loin. */
export function lineLimit(capacity: number, value: number, remaining: number): number {
  return round2(Math.min(capacity, value + Math.max(0, remaining)))
}

function Line({
  title,
  label,
  value,
  capacity,
  limit,
  segments,
  onChange,
  details,
}: {
  title: string
  /** Libellé affiché (défaut : `title`, qui sert aussi aux libellés accessibles). */
  label?: ReactNode
  value: number
  capacity: number
  limit: number
  segments: readonly RefloatSliderSegment[]
  onChange: (value: number) => void
  details: ReactNode
}) {
  const canFill = limit - value > 0.004
  return (
    <li className="py-3 first:pt-1 last:pb-1">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900" title={title}>
          {label ?? title}
        </p>
        <RefloatAmountInput
          value={value}
          max={limit}
          onChange={onChange}
          ariaLabel={`Montant pris dans ${title}`}
          disabled={capacity <= 0}
        />
      </div>
      <RefloatSlider
        value={value}
        max={capacity}
        limit={limit}
        segments={segments}
        onChange={onChange}
        ariaLabel={`Curseur ${title}`}
        disabled={capacity <= 0}
      />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-xs leading-relaxed text-gray-600">{details}</div>
        {canFill && (
          <button
            type="button"
            onClick={() => onChange(limit)}
            className="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium text-gray-700 underline-offset-2 hover:underline"
          >
            Compléter
          </button>
        )}
      </div>
    </li>
  )
}

function Arrow({ from, to, className }: { from: number; to: number; className?: string }) {
  const changed = Math.abs(from - to) > 0.004
  return (
    <span className="tabular-nums">
      {formatEuro(from)}
      {changed && (
        <>
          {' '}
          <span aria-hidden="true">→</span>{' '}
          <span className={cn('font-semibold', className)}>{formatEuro(to)}</span>
        </>
      )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Tirelire
// ---------------------------------------------------------------------------

export function PiggyRefloatPanel({
  piggyAmount,
  value,
  remaining,
  onChange,
}: {
  piggyAmount: number
  value: number
  /** Reste à renflouer en tenant compte de `value`. */
  remaining: number
  onChange: (value: number) => void
}) {
  const limit = lineLimit(piggyAmount, value, remaining)
  return (
    <div className="space-y-2">
      <p className="text-xs leading-relaxed text-gray-600">
        Choisis combien prendre dans ta tirelire. Elle ne sera débitée qu&apos;à la fin du récap.
      </p>
      <ul>
        <Line
          title="Tirelire"
          label="À prendre dans la tirelire"
          value={value}
          capacity={piggyAmount}
          limit={limit}
          segments={[{ until: piggyAmount, tone: 'violet' }]}
          onChange={onChange}
          details={
            <>
              Il restera{' '}
              <Arrow from={piggyAmount} to={piggyAmount - value} className="text-violet-800" />
            </>
          }
        />
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export interface BudgetRefloatRow {
  budgetId: string
  name: string
  savings: number
  estimatedAmount: number
}

export function BudgetsRefloatPanel({
  rows,
  values,
  remaining,
  nextMonthName,
  onChange,
  onAutoDistribute,
  onReset,
}: {
  rows: readonly BudgetRefloatRow[]
  values: Record<string, number>
  remaining: number
  /** « octobre » — mois dont le budget est amputé. */
  nextMonthName: string
  onChange: (budgetId: string, value: number) => void
  onAutoDistribute: () => void
  onReset: () => void
}) {
  const hasValues = Object.values(values).some((v) => v > 0.004)
  const canDistribute =
    remaining > 0.004 &&
    rows.some(
      (r) =>
        budgetRefloatCapacity({ cumulatedSavings: r.savings, estimatedAmount: r.estimatedAmount }) -
          (values[r.budgetId] ?? 0) >
        0.004,
    )

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-gray-600">
        Pour chaque budget, on prend d&apos;abord dans ses{' '}
        <span className="font-medium text-violet-700">économies</span>, puis dans son{' '}
        <span className="font-medium text-orange-700">budget {deMonth(nextMonthName)}</span>.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-orange-300 bg-orange-50 text-orange-900 hover:bg-orange-100"
          onClick={onAutoDistribute}
          disabled={!canDistribute}
        >
          <WandSparkles aria-hidden="true" />
          Répartir le reste automatiquement
        </Button>
        {hasValues && (
          <Button type="button" variant="ghost" size="sm" onClick={onReset}>
            Tout remettre à 0
          </Button>
        )}
      </div>
      <ul className="divide-y divide-gray-100">
        {rows.map((row) => {
          const value = values[row.budgetId] ?? 0
          const capacity = budgetRefloatCapacity({
            cumulatedSavings: row.savings,
            estimatedAmount: row.estimatedAmount,
          })
          const split = splitBudgetRefloat(value, row.savings)
          const savings = Math.max(0, row.savings)
          return (
            <Line
              key={row.budgetId}
              title={row.name}
              value={value}
              capacity={capacity}
              limit={lineLimit(capacity, value, remaining)}
              segments={[
                { until: savings, tone: 'violet' },
                { until: capacity, tone: 'orange' },
              ]}
              onChange={(v) => onChange(row.budgetId, v)}
              details={
                <>
                  {/* Ligne « Économies » masquée quand il n'y en a pas : une
                      ligne de moins par budget, la liste reste compacte. */}
                  {savings > 0.004 && (
                    <>
                      <span className="text-violet-700">Économies</span>{' '}
                      <Arrow
                        from={savings}
                        to={savings - split.fromSavings}
                        className="text-violet-800"
                      />
                      <br />
                    </>
                  )}
                  <span className="text-orange-700">Budget {nextMonthName}</span>{' '}
                  <Arrow
                    from={row.estimatedAmount}
                    to={row.estimatedAmount - split.fromBudget}
                    className="text-orange-800"
                  />
                </>
              }
            />
          )
        })}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Projets
// ---------------------------------------------------------------------------

export interface ProjectRefloatRow {
  id: string
  name: string
  monthlyAllocation: number
  pendingDelayFraction: number
}

export function ProjectsRefloatPanel({
  rows,
  values,
  remaining,
  recapMonthName,
  onChange,
}: {
  rows: readonly ProjectRefloatRow[]
  values: Record<string, number>
  remaining: number
  /** « septembre » — mois dont la mensualité est réduite. */
  recapMonthName: string
  onChange: (projectId: string, value: number) => void
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs leading-relaxed text-gray-600">
        Tu peux renoncer à tout ou partie de la mensualité {deMonth(recapMonthName)} d&apos;un
        projet. L&apos;argent déjà mis de côté n&apos;est pas touché, mais l&apos;échéance du projet
        recule d&apos;autant.
      </p>
      <ul className="divide-y divide-gray-100">
        {rows.map((row) => {
          const value = values[row.id] ?? 0
          const capacity = Math.max(0, row.monthlyAllocation)
          const monthsShift =
            capacity > 0 ? Math.floor(row.pendingDelayFraction + value / capacity) : 0
          return (
            <Line
              key={row.id}
              title={row.name}
              value={value}
              capacity={capacity}
              limit={lineLimit(capacity, value, remaining)}
              segments={[{ until: capacity, tone: 'purple' }]}
              onChange={(v) => onChange(row.id, v)}
              details={
                <>
                  <span className="text-purple-700">Mensualité</span>{' '}
                  <Arrow from={capacity} to={capacity - value} className="text-purple-800" />
                  {monthsShift >= 1 && (
                    <>
                      <br />
                      Échéance repoussée de {monthsShift} mois
                    </>
                  )}
                </>
              }
            />
          )
        })}
      </ul>
    </div>
  )
}

/** « d'octobre », « de novembre » — élision devant voyelle (avril, août, octobre). */
export function deMonth(monthName: string): string {
  return /^[aeiouyàâéèêëîïôöûüh]/i.test(monthName) ? `d'${monthName}` : `de ${monthName}`
}
