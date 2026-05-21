import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ModalCloseX } from '../modal-close-x'

describe('ModalCloseX', () => {
  it('renders circle variant with rounded-full + bg-gray-100 + h-8 w-8', () => {
    render(<ModalCloseX onClose={() => {}} variant="circle" />)
    const button = screen.getByRole('button', { name: 'Fermer' })
    expect(button.className).toMatch(/rounded-full/)
    expect(button.className).toMatch(/bg-gray-100/)
    expect(button.className).toMatch(/h-8/)
    expect(button.className).toMatch(/w-8/)
    // SVG default size matches pre-v10 raw button render
    const svg = button.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('class')).toBe('h-4 w-4 text-gray-600')
  })

  it('renders ghost variant with rounded-md (no bg-gray-100, different from circle)', () => {
    render(<ModalCloseX onClose={() => {}} variant="ghost" />)
    const button = screen.getByRole('button', { name: 'Fermer' })
    expect(button.className).toMatch(/rounded-md/)
    expect(button.className).not.toMatch(/rounded-full/)
    expect(button.className).not.toMatch(/bg-gray-100/)
    expect(button.className).toMatch(/hover:bg-accent/)
  })

  it('fires onClose on click but NOT when disabled', () => {
    const onClose = vi.fn()
    const { rerender } = render(<ModalCloseX onClose={onClose} variant="circle" />)
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    rerender(<ModalCloseX onClose={onClose} variant="circle" disabled />)
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }))
    // Native disabled attribute prevents click event; onClose stays at 1
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('overrides SVG class via svgClassName prop (for h-10 w-10 button + h-5 w-5 svg case)', () => {
    render(
      <ModalCloseX
        onClose={() => {}}
        variant="circle"
        className="h-10 w-10"
        svgClassName="h-5 w-5 text-gray-600"
      />,
    )
    const button = screen.getByRole('button', { name: 'Fermer' })
    expect(button.className).toMatch(/h-10/)
    expect(button.className).toMatch(/w-10/)
    const svg = button.querySelector('svg')
    expect(svg?.getAttribute('class')).toBe('h-5 w-5 text-gray-600')
  })
})
