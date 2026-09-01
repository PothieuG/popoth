'use client'

import { formatEuro } from '@/lib/format-currency'
import type { RecapRecoveryData } from '@/lib/recap'

/**
 * Sprint Abandoned-Recap-Recovery (2026-09-01).
 *
 * Annonce ce que l'ouverture de ce récap a remis dans la tirelire en balayant
 * les bilans restés en plan sur des mois passés. Sans ce bandeau, l'utilisateur
 * verrait sa tirelire remonter sans explication (décision produit 2026-09-01 :
 * message visible dès qu'il y a de l'argent rendu).
 *
 * Bandeau EN FLUX, pas `fixed` : il doit rester lisible pendant toute la durée
 * du wizard, alors que le snackbar `fixed bottom-4 z-[60]` du repo est réservé
 * au feedback transitoire post-mutation (auto-dismiss 3 s).
 *
 * Palette violette = tirelire / économies dans la charte Popoth. Surtout PAS
 * d'ambre/jaune (proscrit : conflit visuel avec l'orange des budgets).
 *
 * Rien à afficher quand `data` est `null` — `parseRecoveryData` renvoie déjà
 * `null` pour le cas « bilan abandonné mais à 0 € » (archivage silencieux).
 */
export function RecoveredFundsBanner({ data }: { data: RecapRecoveryData | null }) {
  if (!data || data.periods.length === 0) return null

  const label = formatPeriodList(data.periods)
  const plural = data.periods.length > 1

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-2xl border border-violet-200 bg-violet-50 p-4 text-left text-violet-800"
    >
      <p className="mb-1 text-xs font-medium tracking-wide uppercase">Argent récupéré</p>
      <p className="text-sm">
        {plural ? 'Tes bilans de ' : 'Ton bilan de '}
        <span className="font-semibold">{label}</span>
        {plural ? ' étaient restés en plan.' : ' était resté en plan.'} Les{' '}
        <span className="font-semibold">{formatEuro(data.total)}</span> qui en avaient été prélevés
        ont été remis dans ta tirelire.
      </p>
    </div>
  )
}

const MONTH_FORMATTER = new Intl.DateTimeFormat('fr-FR', { month: 'long' })

/** `juin 2026` · `juin et juillet 2026` · `juin, juillet et août 2026`. */
function formatPeriodList(periods: RecapRecoveryData['periods']): string {
  const first = periods[0]
  if (!first) return ''

  // Année répétée uniquement quand elles diffèrent — « juin et juillet 2026 »
  // se lit mieux que « juin 2026 et juillet 2026 ».
  const sameYear = periods.every((p) => p.year === first.year)

  const parts = periods.map((p) => {
    // Jour 1 à midi : évite tout glissement de mois lié au fuseau.
    const monthName = MONTH_FORMATTER.format(new Date(p.year, p.month - 1, 1, 12))
    return sameYear ? monthName : `${monthName} ${p.year}`
  })

  const head = parts.slice(0, -1)
  const tail = parts[parts.length - 1] ?? ''
  const joined = head.length === 0 ? tail : `${head.join(', ')} et ${tail}`

  return sameYear ? `${joined} ${first.year}` : joined
}
