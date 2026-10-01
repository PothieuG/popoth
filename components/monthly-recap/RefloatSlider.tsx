'use client'

import type { ChangeEvent } from 'react'

import { formatEuro } from '@/lib/format-currency'
import { cn } from '@/lib/utils'

/**
 * Sprint Recap-Manual-Refloat (2026-10-01) — curseur du renflouement manuel.
 *
 * `<input type="range">` natif (accessible clavier + lecteur d'écran, geste
 * tactile fluide sur iOS/Android) dont on masque la piste pour dessiner la
 * nôtre derrière : elle est découpée en `segments` colorés (ex. budget :
 * violet = économies, puis orange = budget du mois suivant) et grisée
 * au-delà de `limit` — la zone que le reste à renflouer ne permet plus
 * d'atteindre. La valeur est bornée à `limit` à chaque mouvement.
 *
 * La piste dessinée est rentrée de la moitié du pouce (`inset-x-3` pour un
 * pouce de 24 px) : le centre du pouce natif parcourt exactement cette
 * largeur, donc les couleurs restent alignées sous le doigt.
 */

export type RefloatTone = 'violet' | 'orange' | 'purple'

const FILLED: Record<RefloatTone, string> = {
  violet: '#7c3aed', // violet-600
  orange: '#ea580c', // orange-600
  purple: '#9333ea', // purple-600
}

const EMPTY: Record<RefloatTone, string> = {
  violet: '#ede9fe', // violet-100
  orange: '#ffedd5', // orange-100
  purple: '#f3e8ff', // purple-100
}

const UNREACHABLE = '#e5e7eb' // gray-200

const THUMB: Record<RefloatTone, string> = {
  violet:
    '[&::-webkit-slider-thumb]:bg-violet-600 [&::-moz-range-thumb]:bg-violet-600 focus-visible:[&::-webkit-slider-thumb]:ring-violet-300 focus-visible:[&::-moz-range-thumb]:ring-violet-300',
  orange:
    '[&::-webkit-slider-thumb]:bg-orange-600 [&::-moz-range-thumb]:bg-orange-600 focus-visible:[&::-webkit-slider-thumb]:ring-orange-300 focus-visible:[&::-moz-range-thumb]:ring-orange-300',
  purple:
    '[&::-webkit-slider-thumb]:bg-purple-600 [&::-moz-range-thumb]:bg-purple-600 focus-visible:[&::-webkit-slider-thumb]:ring-purple-300 focus-visible:[&::-moz-range-thumb]:ring-purple-300',
}

export interface RefloatSliderSegment {
  /** Borne haute du segment, en euros (le dernier segment doit valoir `max`). */
  until: number
  tone: RefloatTone
}

interface RefloatSliderProps {
  value: number
  max: number
  /** Valeur maximale atteignable (≤ max) : au-delà, la piste est grisée. */
  limit: number
  segments: readonly RefloatSliderSegment[]
  onChange: (value: number) => void
  ariaLabel: string
  disabled?: boolean
}

export function RefloatSlider({
  value,
  max,
  limit,
  segments,
  onChange,
  ariaLabel,
  disabled = false,
}: RefloatSliderProps) {
  const safeMax = Math.max(0, max)
  const reachable = Math.min(Math.max(0, limit), safeMax)
  const current = Math.min(Math.max(0, value), safeMax)
  const thumbTone = toneAt(segments, current)

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = Number(e.target.value)
    if (!Number.isFinite(raw)) return
    onChange(round2(Math.min(Math.max(0, raw), reachable)))
  }

  return (
    <div className={cn('relative h-8', disabled && 'opacity-50')}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-3 top-1/2 h-2.5 -translate-y-1/2 rounded-full"
        style={{ background: buildTrackBackground(segments, current, reachable, safeMax) }}
      />
      <input
        type="range"
        min={0}
        max={safeMax}
        step={0.01}
        value={current}
        onChange={handleChange}
        disabled={disabled || safeMax <= 0}
        aria-label={ariaLabel}
        aria-valuetext={formatEuro(current)}
        className={cn(
          'relative h-8 w-full cursor-pointer appearance-none bg-transparent focus-visible:outline-none disabled:cursor-not-allowed',
          '[&::-webkit-slider-runnable-track]:h-8 [&::-webkit-slider-runnable-track]:bg-transparent',
          '[&::-webkit-slider-thumb]:mt-1 [&::-webkit-slider-thumb]:size-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-[3px] [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:transition-colors',
          '[&::-moz-range-track]:bg-transparent',
          '[&::-moz-range-thumb]:size-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-[3px] [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-md',
          'focus-visible:[&::-moz-range-thumb]:ring-4 focus-visible:[&::-webkit-slider-thumb]:ring-4',
          THUMB[thumbTone],
        )}
      />
    </div>
  )
}

/** Couleur du segment dans lequel se trouve la valeur (le pouce change de
 *  couleur quand on passe des économies au budget). */
function toneAt(segments: readonly RefloatSliderSegment[], value: number): RefloatTone {
  let start = 0
  for (const segment of segments) {
    // Segment vide (ex. budget sans économies) : jamais la couleur du pouce.
    if (segment.until > start && value <= segment.until + 0.001) return segment.tone
    start = Math.max(start, segment.until)
  }
  return segments[segments.length - 1]?.tone ?? 'violet'
}

/**
 * Dégradé à arrêts francs : pour chaque segment, partie remplie (jusqu'à
 * `value`), partie vide atteignable (jusqu'à `limit`), partie grisée.
 * Exporté pour les tests.
 */
export function buildTrackBackground(
  segments: readonly RefloatSliderSegment[],
  value: number,
  limit: number,
  max: number,
): string {
  if (max <= 0) return UNREACHABLE
  const pct = (n: number) => `${((Math.min(Math.max(0, n), max) / max) * 100).toFixed(3)}%`
  const stops: string[] = []
  let start = 0
  for (const segment of segments) {
    const end = Math.min(segment.until, max)
    if (end <= start) continue
    const bands: Array<[number, number, string]> = [
      [start, Math.min(end, value), FILLED[segment.tone]],
      [Math.max(start, value), Math.min(end, limit), EMPTY[segment.tone]],
      [Math.max(start, value, limit), end, UNREACHABLE],
    ]
    for (const [from, to, color] of bands) {
      if (to > from) stops.push(`${color} ${pct(from)} ${pct(to)}`)
    }
    start = end
  }
  if (stops.length === 0) return UNREACHABLE
  return `linear-gradient(to right, ${stops.join(', ')})`
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
