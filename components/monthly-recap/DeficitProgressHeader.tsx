'use client'

import { CircleCheck, PiggyBank, Target, Wallet } from 'lucide-react'
import type { ReactNode } from 'react'

import { formatEuro } from '@/lib/format-currency'
import { cn } from '@/lib/utils'

/**
 * Sprint Recap-Manual-Refloat (2026-10-01) — bandeau collant de l'écran
 * « Gestion du déficit » : le reste à renflouer reste visible en permanence,
 * y compris en faisant défiler une longue liste de budgets, et bouge en
 * direct avec les curseurs (valeurs en cours d'édition comprises).
 *
 * `top-[env(safe-area-inset-top)]` : en PWA plein écran, le bandeau se colle
 * sous l'encoche / la barre d'état au lieu de passer dessous.
 */

interface DeficitProgressHeaderProps {
  /** Déficit total du mois (|bilan|). */
  deficitTotal: number
  /** Reste à renflouer (peut être ≤ 0 une fois couvert). */
  remaining: number
  piggy: number
  budgets: number
  projects: number
}

export function DeficitProgressHeader({
  deficitTotal,
  remaining,
  piggy,
  budgets,
  projects,
}: DeficitProgressHeaderProps) {
  const covered = remaining <= 0.01
  const shown = Math.max(0, remaining)
  const pct =
    deficitTotal > 0
      ? Math.min(100, Math.max(0, ((deficitTotal - shown) / deficitTotal) * 100))
      : 100

  return (
    <div className="sticky top-[env(safe-area-inset-top)] z-20 pt-2 pb-1">
      <div
        className={cn(
          'rounded-2xl border bg-white/95 p-4 shadow-md backdrop-blur transition-colors',
          covered ? 'border-emerald-200' : 'border-red-200',
        )}
      >
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-medium tracking-wide text-gray-500 uppercase">
            {covered ? 'Déficit comblé' : 'Reste à renflouer'}
          </p>
          <p className="text-xs text-gray-500 tabular-nums">sur {formatEuro(deficitTotal)}</p>
        </div>
        <p
          aria-live="polite"
          className={cn(
            'mt-1 flex items-center gap-2 text-3xl font-bold tabular-nums',
            covered ? 'text-emerald-700' : 'text-red-700',
          )}
        >
          {covered && <CircleCheck aria-hidden="true" className="size-7" />}
          {formatEuro(shown)}
        </p>
        <div
          role="progressbar"
          aria-label="Part du déficit renflouée"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          className="mt-3 h-2 w-full overflow-hidden rounded-full bg-red-100"
        >
          <div
            className={cn(
              'h-full rounded-full transition-all duration-200',
              covered ? 'bg-emerald-500' : 'bg-red-500',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        {/* 3 colonnes fixes : la hauteur du bandeau ne bouge pas pendant
            qu'on fait glisser un curseur. */}
        <ul className="mt-3 grid grid-cols-3 gap-2 text-xs text-gray-600">
          <SourceChip icon={<PiggyBank />} label="Tirelire" amount={piggy} tone="text-violet-700" />
          <SourceChip icon={<Wallet />} label="Budgets" amount={budgets} tone="text-orange-700" />
          <SourceChip icon={<Target />} label="Projets" amount={projects} tone="text-purple-700" />
        </ul>
      </div>
    </div>
  )
}

function SourceChip({
  icon,
  label,
  amount,
  tone,
}: {
  icon: ReactNode
  label: string
  amount: number
  tone: string
}) {
  return (
    <li className="min-w-0">
      <span className="flex items-center gap-1">
        <span aria-hidden="true" className={cn('[&_svg]:size-3.5', tone)}>
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </span>
      <span
        className={cn(
          'block truncate font-semibold tabular-nums',
          amount > 0.004 ? tone : 'text-gray-400',
        )}
      >
        {formatEuro(amount)}
      </span>
    </li>
  )
}
