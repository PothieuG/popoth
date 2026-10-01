/**
 * Sprint Recap-Manual-Refloat (2026-10-01) — curseur + montant saisissable
 * du renflouement manuel.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { clampAmount, parseAmountInput, sanitizeAmountInput } from '../RefloatAmountInput'
import { buildTrackBackground, RefloatSlider } from '../RefloatSlider'

describe('saisie du montant', () => {
  it('accepte virgule ou point, garde 2 décimales, retire le reste', () => {
    expect(sanitizeAmountInput('12.345')).toBe('12,34')
    expect(sanitizeAmountInput('1 099,4')).toBe('1099,4')
    expect(sanitizeAmountInput('1,2,3')).toBe('1,23')
    expect(sanitizeAmountInput('abc')).toBe('')
  })

  it('convertit en nombre (vide → 0)', () => {
    expect(parseAmountInput('1099,45')).toBe(1099.45)
    expect(parseAmountInput('')).toBe(0)
    expect(parseAmountInput(',5')).toBe(0.5)
  })

  it('borne entre 0 et le maximum', () => {
    expect(clampAmount(40, 30)).toBe(30)
    expect(clampAmount(-3, 30)).toBe(0)
    expect(clampAmount(12.346, 30)).toBe(12.35)
  })
})

describe('RefloatSlider', () => {
  it('borne la valeur à la limite atteignable', () => {
    const onChange = vi.fn()
    render(
      <RefloatSlider
        value={0}
        max={130}
        limit={50}
        segments={[
          { until: 30, tone: 'violet' },
          { until: 130, tone: 'orange' },
        ]}
        onChange={onChange}
        ariaLabel="Curseur A"
      />,
    )
    fireEvent.change(screen.getByRole('slider', { name: 'Curseur A' }), {
      target: { value: '120' },
    })
    expect(onChange).toHaveBeenCalledWith(50)
  })

  it('dessine économies (violet) puis budget (orange), grisé au-delà de la limite', () => {
    const bg = buildTrackBackground(
      [
        { until: 30, tone: 'violet' },
        { until: 130, tone: 'orange' },
      ],
      50,
      80,
      130,
    )
    // économies entièrement prises, 20 € sur le budget, atteignable jusqu'à 80, gris ensuite
    expect(bg).toBe(
      'linear-gradient(to right, #7c3aed 0.000% 23.077%, #ea580c 23.077% 38.462%, #ffedd5 38.462% 61.538%, #e5e7eb 61.538% 100.000%)',
    )
  })

  it('piste grise quand il n’y a rien à prendre', () => {
    expect(buildTrackBackground([{ until: 0, tone: 'violet' }], 0, 0, 0)).toBe('#e5e7eb')
  })
})
