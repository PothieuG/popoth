/**
 * Sprint Abandoned-Recap-Recovery (2026-09-01) — bandeau d'annonce.
 *
 * Le montant affiché est la seule explication que l'utilisateur reçoit d'un
 * mouvement de sa tirelire : ces cas pinnent la copie et l'accord singulier /
 * pluriel, plus l'absence totale de rendu quand il n'y a rien à annoncer.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { RecoveredFundsBanner } from '../RecoveredFundsBanner'

describe('RecoveredFundsBanner', () => {
  it('renders nothing when there is nothing to announce', () => {
    const { container } = render(<RecoveredFundsBanner data={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when no period actually cost money', () => {
    // Cas « archivage silencieux » : la RPC a bien balayé, mais le FILTER a
    // vidé `periods` car aucun renflouement n'avait eu lieu.
    const { container } = render(<RecoveredFundsBanner data={{ total: 0, periods: [] }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('announces a single recovered month in the singular', () => {
    render(
      <RecoveredFundsBanner
        data={{ total: 150, periods: [{ month: 6, year: 2026, amount: 150 }] }}
      />,
    )
    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('Ton bilan de juin 2026 était resté en plan')
    expect(banner).toHaveTextContent('150,00')
    expect(banner).toHaveTextContent('remis dans ta tirelire')
  })

  it('announces several recovered months in the plural, year mentioned once', () => {
    render(
      <RecoveredFundsBanner
        data={{
          total: 230,
          periods: [
            { month: 6, year: 2026, amount: 150 },
            { month: 7, year: 2026, amount: 80 },
          ],
        }}
      />,
    )
    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('Tes bilans de juin et juillet 2026 étaient restés en plan')
    expect(banner).toHaveTextContent('230,00')
  })

  it('repeats the year when the recovered months straddle two years', () => {
    render(
      <RecoveredFundsBanner
        data={{
          total: 230,
          periods: [
            { month: 12, year: 2025, amount: 80 },
            { month: 1, year: 2026, amount: 150 },
          ],
        }}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Tes bilans de décembre 2025 et janvier 2026 étaient restés en plan',
    )
  })
})
