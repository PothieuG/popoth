import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import EditProjectDialog from '../EditProjectDialog'
import { expectEscClose } from '../../__tests__/a11y-helpers'
import type { SavingsProject } from '@/hooks/useProjects'

// Sprint Projets-Épargne 06 — RTL coverage pour la modal EDIT projet.
// Mirror `AddProjectDialog.test.tsx` + cas spécifiques edit : pré-remplissage,
// delta-math RAV, prise en compte de `amount_saved`, et reset via `key`.

type SaveArg = {
  name: string
  targetAmount: number
  monthlyAllocation: number
  deadlineDate: string
}
const makeSaveMock = () => vi.fn<(arg: SaveArg) => Promise<boolean>>(async () => true)

function buildProject(overrides: Partial<SavingsProject> = {}): SavingsProject {
  return {
    id: 'project-1',
    profile_id: 'user-1',
    group_id: null,
    name: 'Voyage Japon',
    target_amount: 7000,
    monthly_allocation: 195,
    // Deadline lointaine pour que `monthsBetween` retourne une grande durée
    // initiale — évite les flakiness liés à `new Date()` près d'un fin de mois.
    deadline_date: '2030-01-01',
    amount_saved: 4084,
    pending_delay_fraction: 0,
    created_at: '2026-05-26T10:00:00Z',
    updated_at: '2026-05-26T10:00:00Z',
    ...overrides,
  }
}

describe('EditProjectDialog', () => {
  it('pré-remplissage — nom + target + mode A par défaut + note "Déjà épargné"', () => {
    render(
      <EditProjectDialog
        isOpen
        onClose={vi.fn()}
        onSave={makeSaveMock()}
        project={buildProject()}
        currentAllocatedTotal={695}
        totalEstimatedIncome={3000}
      />,
    )

    const nameInput = screen.getByLabelText(/nom du projet/i) as HTMLInputElement
    expect(nameInput.value).toBe('Voyage Japon')

    const targetInput = screen.getByLabelText(/montant total visé/i) as HTMLInputElement
    expect(targetInput.value).toMatch(/7000/)

    // Note "Déjà épargné" affichée parce qu'amount_saved > 0
    expect(screen.getByText(/déjà épargné/i)).toBeInTheDocument()
    expect(screen.getByText(/reste à atteindre/i)).toBeInTheDocument()

    // Mode A par défaut : input durée visible
    expect(screen.getByLabelText(/durée \(mois\)/i)).toBeInTheDocument()
  })

  it('refine RAV avec delta — augmenter le mensuel dans la marge libérée est OK', async () => {
    const onSave = makeSaveMock()
    const user = userEvent.setup()
    render(
      <EditProjectDialog
        isOpen
        onClose={vi.fn()}
        onSave={onSave}
        project={buildProject({ monthly_allocation: 195 })}
        // budgets+projets = 1000 dont 195 du projet ⇒ "other" = 805. Income
        // = 2000 ⇒ marge dispo = 1195. Edit le mensuel à 500 reste sous le
        // plafond (805 + 500 = 1305 ≤ 2000 → refine 1 passe).
        currentAllocatedTotal={1000}
        totalEstimatedIncome={2000}
      />,
    )

    // Mode B pour piloter le mensuel directement.
    await user.click(screen.getByRole('radio', { name: /définir le mensuel/i }))
    const monthlyInput = screen.getByLabelText(/montant mensuel/i)
    await user.clear(monthlyInput)
    await user.type(monthlyInput, '500')

    await user.click(screen.getByRole('button', { name: /sauvegarder/i }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1)
    })
    const arg = onSave.mock.calls[0]?.[0]
    expect(arg?.monthlyAllocation).toBe(500)
    expect(arg?.name).toBe('Voyage Japon')
    expect(arg?.targetAmount).toBe(7000)
  })

  it('refine RAV — bloque si le mensuel post-edit crève la marge', async () => {
    const onSave = makeSaveMock()
    const user = userEvent.setup()
    render(
      <EditProjectDialog
        isOpen
        onClose={vi.fn()}
        onSave={onSave}
        project={buildProject({ monthly_allocation: 195 })}
        // Pre-other = 805 (mêmes settings que test précédent). Edit le mensuel
        // à 1500 → newTotal = 805 + 1500 = 2305 > 2000 → refine 1 fail.
        currentAllocatedTotal={1000}
        totalEstimatedIncome={2000}
      />,
    )

    await user.click(screen.getByRole('radio', { name: /définir le mensuel/i }))
    const monthlyInput = screen.getByLabelText(/montant mensuel/i)
    await user.clear(monthlyInput)
    await user.type(monthlyInput, '1500')

    await user.click(screen.getByRole('button', { name: /sauvegarder/i }))

    expect(await screen.findByText(/le reste à vivre deviendrait négatif/i)).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('mensuel dérivé prend en compte amount_saved (target − saved, pas target)', async () => {
    const onSave = makeSaveMock()
    const user = userEvent.setup()
    render(
      <EditProjectDialog
        isOpen
        onClose={vi.fn()}
        onSave={onSave}
        // amount_saved = 3000 sur target 12000 → remaining = 9000.
        // Durée = 30 mois → mensuel dérivé = ceil(9000 × 100 / 30) / 100 = 300.
        // (Si on ignorait amount_saved on aurait ceil(12000/30) = 400.)
        project={buildProject({
          target_amount: 12000,
          amount_saved: 3000,
          monthly_allocation: 400,
        })}
        currentAllocatedTotal={400}
        totalEstimatedIncome={5000}
      />,
    )

    // Mode A par défaut. Force durée=30.
    const durationInput = screen.getByLabelText(/durée \(mois\)/i)
    await user.clear(durationInput)
    await user.type(durationInput, '30')

    await user.click(screen.getByRole('button', { name: /sauvegarder/i }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1)
    })
    const arg = onSave.mock.calls[0]?.[0]
    expect(arg?.monthlyAllocation).toBe(300)
  })

  it('key reset — remount sur project.id différent re-init defaultValues', async () => {
    const onSave = makeSaveMock()

    const projectA = buildProject({ id: 'A', name: 'Voyage Japon', target_amount: 7000 })
    const projectB = buildProject({ id: 'B', name: 'Achat voiture', target_amount: 15000 })

    const { rerender } = render(
      <EditProjectDialog
        key={projectA.id}
        isOpen
        onClose={vi.fn()}
        onSave={onSave}
        project={projectA}
        currentAllocatedTotal={500}
        totalEstimatedIncome={3000}
      />,
    )
    expect((screen.getByLabelText(/nom du projet/i) as HTMLInputElement).value).toBe('Voyage Japon')

    // Remount via key change. RHF defaultValues sont read-once au mount →
    // sans key, le re-render avec une nouvelle prop `project` n'aurait pas
    // re-initialisé les inputs ; avec key, le composant est remount-clean.
    rerender(
      <EditProjectDialog
        key={projectB.id}
        isOpen
        onClose={vi.fn()}
        onSave={onSave}
        project={projectB}
        currentAllocatedTotal={500}
        totalEstimatedIncome={3000}
      />,
    )

    await waitFor(() => {
      expect((screen.getByLabelText(/nom du projet/i) as HTMLInputElement).value).toBe(
        'Achat voiture',
      )
    })
  })

  it('a11y — Esc keydown ferme la modal (focus trap natif Radix)', async () => {
    const onClose = vi.fn()
    await expectEscClose(
      <EditProjectDialog
        isOpen
        onClose={onClose}
        onSave={makeSaveMock()}
        project={buildProject()}
        currentAllocatedTotal={500}
        totalEstimatedIncome={3000}
      />,
      onClose,
      'Modifier le projet',
    )
  })

  it('a11y — axe ne rapporte aucune violation critique', async () => {
    const { container } = render(
      <EditProjectDialog
        isOpen
        onClose={vi.fn()}
        onSave={makeSaveMock()}
        project={buildProject()}
        currentAllocatedTotal={500}
        totalEstimatedIncome={3000}
      />,
    )
    const results = await axe(container)
    expect(results.violations).toEqual([])
  })
})
