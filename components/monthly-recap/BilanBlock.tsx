'use client'

import { formatEuro } from '@/lib/format-currency'
import type { RecapSummary } from '@/lib/recap'
import { cn } from '@/lib/utils'

const VARIANTS = {
  positive: {
    container: 'border-green-200 bg-green-50 text-green-700',
    badge: 'text-green-700',
  },
  negative: {
    container: 'border-red-200 bg-red-50 text-red-700',
    badge: 'text-red-700',
  },
  zero: {
    container: 'border-gray-200 bg-gray-50 text-gray-700',
    badge: 'text-gray-700',
  },
} as const

export function BilanBlock({
  bilan,
  bilanSign,
}: {
  bilan: number
  bilanSign: RecapSummary['bilanSign']
}) {
  const styles = VARIANTS[bilanSign]
  return (
    <div className={cn('rounded-2xl border p-4', styles.container)}>
      <p className="mb-2 text-xs font-medium tracking-wide uppercase">Bilan du mois</p>
      <p className={cn('mb-3 text-2xl font-bold', styles.badge)}>{formatEuro(bilan)}</p>
      {bilanSign === 'positive' && (
        <p className="text-sm">Vous allez pouvoir ajouter {formatEuro(bilan)} à votre tirelire.</p>
      )}
      {bilanSign === 'negative' && (
        <p className="text-sm">L&apos;objectif est de revenir à l&apos;équilibre (bilan = 0).</p>
      )}
      {bilanSign === 'zero' && (
        <p className="text-sm">Le mois est équilibré. Passez à l&apos;étape suivante.</p>
      )}
    </div>
  )
}
