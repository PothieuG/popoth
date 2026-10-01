'use client'

import { useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * Sprint Recap-Manual-Refloat (2026-10-01) — montant saisissable au clavier,
 * jumeau du `RefloatSlider` (le curseur seul ne permet pas de viser un
 * centime précis sur un écran de téléphone).
 *
 * Hors édition : montant formaté fr-FR (« 1 099,45 »). Au focus : valeur
 * brute éditable (« 1099,45 »). Chaque frappe est convertie (virgule ou
 * point acceptés, 2 décimales max) puis bornée à `[0, max]` et remontée en
 * direct — le reste à renflouer bouge pendant la saisie. Au blur, le champ
 * ré-affiche la valeur bornée.
 *
 * Police 16 px obligatoire (sinon iOS Safari zoome au focus — cf. garde
 * `input { font-size: 16px }` de `app/globals.css`).
 */

const DISPLAY = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

interface RefloatAmountInputProps {
  value: number
  max: number
  onChange: (value: number) => void
  ariaLabel: string
  disabled?: boolean
  className?: string
}

export function RefloatAmountInput({
  value,
  max,
  onChange,
  ariaLabel,
  disabled = false,
  className,
}: RefloatAmountInputProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? DISPLAY.format(value)

  return (
    <div className={cn('relative w-28 shrink-0', className)}>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={ariaLabel}
        disabled={disabled}
        value={shown}
        onFocus={(e) => {
          setDraft(value > 0 ? toEditable(value) : '')
          // Sélection après le focus (sinon le relâchement du doigt la perd).
          const target = e.currentTarget
          window.requestAnimationFrame?.(() => target.select())
        }}
        onChange={(e) => {
          const next = sanitizeAmountInput(e.target.value)
          setDraft(next)
          onChange(clampAmount(parseAmountInput(next), max))
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          }
        }}
        className="h-10 w-full rounded-lg border border-gray-300 bg-white pr-7 pl-2 text-right text-base font-semibold text-gray-900 tabular-nums shadow-xs focus:border-gray-500 focus:ring-2 focus:ring-gray-200 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-gray-500"
      >
        €
      </span>
    </div>
  )
}

/** Garde chiffres + un séparateur décimal (virgule), 2 décimales max. */
export function sanitizeAmountInput(raw: string): string {
  const normalized = raw.replace(/\./g, ',').replace(/[^\d,]/g, '')
  const [intPart = '', ...rest] = normalized.split(',')
  if (rest.length === 0) return intPart
  return `${intPart},${rest.join('').slice(0, 2)}`
}

export function parseAmountInput(text: string): number {
  const n = Number.parseFloat(text.replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

export function clampAmount(value: number, max: number): number {
  return Math.round(Math.min(Math.max(0, value), Math.max(0, max)) * 100) / 100
}

function toEditable(value: number): string {
  return value.toFixed(2).replace('.', ',')
}
