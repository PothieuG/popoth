import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { BilanBlock } from '../BilanBlock'

describe('BilanBlock', () => {
  it('renders positive variant with savings message', () => {
    const { container } = render(<BilanBlock bilan={150} bilanSign="positive" />)

    expect(screen.getByText(/Bilan du mois/)).toBeInTheDocument()
    expect(screen.getByText(/Vous allez pouvoir ajouter .+ à votre tirelire/)).toBeInTheDocument()
    // 150 € formatted with 2 decimals appears twice (badge + message)
    expect(screen.getAllByText(/150,00/).length).toBeGreaterThanOrEqual(2)

    const block = container.firstElementChild as HTMLElement
    expect(block.className).toMatch(/bg-green-50/)
    expect(block.className).toMatch(/border-green-200/)
  })

  it('renders negative variant with rebalance message', () => {
    const { container } = render(<BilanBlock bilan={-75.42} bilanSign="negative" />)

    expect(screen.getByText(/L'objectif est de revenir à l'équilibre/)).toBeInTheDocument()
    // Negative amount displayed once in the badge only (message is generic)
    expect(screen.getByText(/-75,42/)).toBeInTheDocument()

    const block = container.firstElementChild as HTMLElement
    expect(block.className).toMatch(/bg-red-50/)
    expect(block.className).toMatch(/border-red-200/)
  })

  it('renders zero variant with neutral message', () => {
    const { container } = render(<BilanBlock bilan={0} bilanSign="zero" />)

    expect(screen.getByText(/Le mois est équilibré/)).toBeInTheDocument()
    expect(screen.getByText(/0,00/)).toBeInTheDocument()

    const block = container.firstElementChild as HTMLElement
    expect(block.className).toMatch(/bg-gray-50/)
    expect(block.className).toMatch(/border-gray-200/)
  })
})
