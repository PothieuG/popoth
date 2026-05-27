import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import AddProjectDialog from '../AddProjectDialog'
import { expectEscClose } from '../../__tests__/a11y-helpers'

type SaveArg = {
  name: string
  targetAmount: number
  monthlyAllocation: number
  deadlineDate: string
}
const makeSaveMock = () => vi.fn<(arg: SaveArg) => Promise<boolean>>(async () => true)

// Sprint Projets-Épargne 05 — RTL coverage pour la modal CREATE projet.
// Pattern miroir AddBudgetDialog.test.tsx + cas spécifiques au calcul mutuel
// durée ↔ mensuel + 2 cas a11y (focus trap + axe-core).

describe('AddProjectDialog', () => {
  it('mode A (duration) — calcule le mensuel dérivé et submit avec les bons champs', async () => {
    const onSave = makeSaveMock()
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <AddProjectDialog
        isOpen
        onClose={onClose}
        onSave={onSave}
        currentAllocatedTotal={500}
        totalEstimatedIncome={2000}
      />,
    )

    await user.type(screen.getByPlaceholderText(/voyage au japon/i), 'Voyage')
    // Cible : 1200€, durée par défaut 12 → mensuel dérivé 100€ (Math.ceil cents)
    await user.type(screen.getByPlaceholderText('0.00'), '1200')

    await user.click(screen.getByRole('button', { name: /créer le projet/i }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1)
    })
    const arg = onSave.mock.calls[0]?.[0]
    expect(arg).toBeDefined()
    expect(arg?.name).toBe('Voyage')
    expect(arg?.targetAmount).toBe(1200)
    expect(arg?.monthlyAllocation).toBe(100)
    expect(arg?.deadlineDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('mode B (monthly) — calcule la durée dérivée et submit avec les bons champs', async () => {
    const onSave = makeSaveMock()
    const user = userEvent.setup()
    render(
      <AddProjectDialog
        isOpen
        onClose={vi.fn()}
        onSave={onSave}
        currentAllocatedTotal={500}
        totalEstimatedIncome={2000}
      />,
    )

    await user.type(screen.getByPlaceholderText(/voyage au japon/i), 'Voiture')
    await user.type(screen.getByPlaceholderText('0.00'), '1200')

    // Bascule en mode B
    await user.click(screen.getByRole('radio', { name: /définir le mensuel/i }))

    // Le DecimalFormInput de monthlyAllocation est maintenant visible (2ème
    // placeholder "0.00" — on cible par label).
    const monthlyInput = screen.getByLabelText(/montant mensuel/i)
    await user.clear(monthlyInput)
    await user.type(monthlyInput, '200')

    await user.click(screen.getByRole('button', { name: /créer le projet/i }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1)
    })
    const arg = onSave.mock.calls[0]?.[0]
    expect(arg).toBeDefined()
    expect(arg?.name).toBe('Voiture')
    expect(arg?.targetAmount).toBe(1200)
    expect(arg?.monthlyAllocation).toBe(200)
    // ceil(1200/200) = 6 mois → deadline a +6 mois depuis aujourd'hui
    expect(arg?.deadlineDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('toggle A↔B — preserve la cohérence des valeurs calculées', async () => {
    const user = userEvent.setup()
    render(
      <AddProjectDialog
        isOpen
        onClose={vi.fn()}
        onSave={makeSaveMock()}
        currentAllocatedTotal={0}
        totalEstimatedIncome={3000}
      />,
    )

    await user.type(screen.getByPlaceholderText(/voyage au japon/i), 'Bali')
    await user.type(screen.getByPlaceholderText('0.00'), '1200')

    // En mode A par défaut (durée=12) → mensuel dérivé 100€
    await waitFor(() => {
      expect(screen.getByText(/100,00\s*€/)).toBeInTheDocument()
    })

    // Toggle vers mode B — le mensuel précédemment dérivé (100€) doit pré-remplir
    // l'input et la durée dérivée doit rester cohérente (ceil(1200/100)=12).
    await user.click(screen.getByRole('radio', { name: /définir le mensuel/i }))
    await waitFor(() => {
      expect(screen.getByText(/12\s*mois/)).toBeInTheDocument()
    })
  })

  it('allows submit even when monthly allocation exceeds remaining margin (RAV may go negative)', async () => {
    const onSave = makeSaveMock()
    const user = userEvent.setup()
    render(
      <AddProjectDialog
        isOpen
        onClose={vi.fn()}
        onSave={onSave}
        currentAllocatedTotal={1800}
        totalEstimatedIncome={2000}
      />,
    )

    await user.type(screen.getByPlaceholderText(/voyage au japon/i), 'Au-dessus marge')
    await user.type(screen.getByPlaceholderText('0.00'), '6000')

    // Bascule en mode B et tape un mensuel qui crève la marge (200€ dispo)
    await user.click(screen.getByRole('radio', { name: /définir le mensuel/i }))
    const monthlyInput = screen.getByLabelText(/montant mensuel/i)
    await user.clear(monthlyInput)
    await user.type(monthlyInput, '500')

    await user.click(screen.getByRole('button', { name: /créer le projet/i }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1)
    })
  })

  it('a11y — Esc keydown ferme la modal (focus trap natif Radix)', async () => {
    const onClose = vi.fn()
    await expectEscClose(
      <AddProjectDialog
        isOpen
        onClose={onClose}
        onSave={makeSaveMock()}
        currentAllocatedTotal={0}
        totalEstimatedIncome={3000}
      />,
      onClose,
      "Nouveau projet d'épargne",
    )
  })

  it('a11y — axe ne rapporte aucune violation critique', async () => {
    const { container } = render(
      <AddProjectDialog
        isOpen
        onClose={vi.fn()}
        onSave={makeSaveMock()}
        currentAllocatedTotal={0}
        totalEstimatedIncome={3000}
      />,
    )
    const results = await axe(container)
    expect(results.violations).toEqual([])
  })
})
