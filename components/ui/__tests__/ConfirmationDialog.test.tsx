import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ConfirmationDialog from '../ConfirmationDialog'

// Sprint Delete-Budget-Savings-Transfer — covers the new `details?: ReactNode`
// prop. The prop is optional and backward-compatible (no `details` → renders
// exactly like pre-Sprint). When provided, it surfaces under the main
// `<DialogDescription>` so consumers can highlight specific information
// (e.g. amount transferred to piggy bank in purple).

describe('<ConfirmationDialog details prop>', () => {
  const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    title: 'Supprimer le budget',
    message: 'Êtes-vous sûr ?',
  }

  it('without details: renders only message, no extra description block', () => {
    render(<ConfirmationDialog {...baseProps} />)
    expect(screen.getByText('Êtes-vous sûr ?')).toBeInTheDocument()
    // No purple-themed extra block in the DOM.
    expect(screen.queryByText(/transféré dans la tirelire/i)).not.toBeInTheDocument()
  })

  it('with details ReactNode: renders details under message with purple highlight', () => {
    render(
      <ConfirmationDialog
        {...baseProps}
        details={
          <p>
            <span className="font-semibold text-purple-600">47,50&nbsp;€</span> d&apos;économies
            sera transféré dans la tirelire.
          </p>
        }
      />,
    )
    expect(screen.getByText('Êtes-vous sûr ?')).toBeInTheDocument()
    // The purple-highlighted amount is rendered as a child of details.
    const purpleSpan = screen.getByText(/47,50/)
    expect(purpleSpan.className).toMatch(/text-purple-600/)
    expect(purpleSpan.className).toMatch(/font-semibold/)
    // Surrounding details text present.
    expect(
      screen.getByText(/d['']économies sera transféré dans la tirelire\./i),
    ).toBeInTheDocument()
  })

  it('details is rendered alongside dynamic confirmText "Supprimer et transférer"', () => {
    render(
      <ConfirmationDialog
        {...baseProps}
        confirmText="Supprimer et transférer"
        details={<p>Test détails</p>}
      />,
    )
    const confirmBtn = screen.getByRole('button', { name: 'Supprimer et transférer' })
    expect(confirmBtn).toBeInTheDocument()
    expect(screen.getByText('Test détails')).toBeInTheDocument()
  })
})
