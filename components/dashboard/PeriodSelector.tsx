'use client'

import { cn } from '@/lib/utils'
import type { Period } from '@/lib/finance/period'

interface PeriodSelectorProps {
  value: Period
  onChange: (next: Period) => void
  className?: string
}

const OPTIONS: Array<{ value: Period; label: string }> = [
  { value: 'month', label: 'Mois' },
  { value: 'week', label: 'Semaine' },
  { value: 'day', label: 'Jour' },
]

/**
 * Segmented-control style period selector (Sprint P1).
 *
 * Renders 3 mutually-exclusive options (Mois / Semaine / Jour) as a
 * radiogroup with `role="radiogroup"` + `role="radio"` + `aria-checked`
 * for proper a11y. Click anywhere in the group cycles the selection.
 *
 * Consumer typically wires this to `usePeriodParam()` so the choice is
 * persisted in the URL `?period=` query string.
 */
export function PeriodSelector({ value, onChange, className }: PeriodSelectorProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Période d'affichage"
      className={cn(
        'inline-flex h-9 items-center rounded-md border border-gray-200 bg-gray-50 p-0.5',
        className,
      )}
    >
      {OPTIONS.map((opt) => {
        const isChecked = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isChecked}
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-sm px-3 py-1 text-sm font-medium transition-colors',
              'focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-hidden',
              isChecked
                ? 'bg-white text-gray-900 shadow-xs'
                : 'text-gray-600 hover:text-gray-900',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
