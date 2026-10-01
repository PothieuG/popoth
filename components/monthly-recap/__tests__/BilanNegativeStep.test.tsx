/**
 * Sprint Recap-Manual-Refloat (2026-10-01) — écran « Gestion du déficit »
 * (renflouement manuel). Remplace les tests de l'ancienne cascade
 * automatique (sprint 13 + Projets-Épargne 09).
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RecapProgress } from '@/hooks/useMonthlyRecap'
import type { RecapSummary } from '@/lib/recap'

const prepareMock = vi.fn()
const saveMock = vi.fn()
const advanceMock = vi.fn()
let prepareState: { isError: boolean; error: Error | null } = { isError: false, error: null }

vi.mock('@/hooks/useMonthlyRecap', () => ({
  usePrepareDeficit: () => ({
    mutate: prepareMock,
    isPending: false,
    isError: prepareState.isError,
    error: prepareState.error,
  }),
  useSaveRefloatPlan: () => ({ mutateAsync: saveMock, isPending: false }),
  useAdvanceStep: () => ({ mutateAsync: advanceMock, isPending: false }),
}))

import { BilanNegativeStep } from '../steps/BilanNegativeStep'

function makeSummary(overrides: Partial<RecapSummary> = {}): RecapSummary {
  return {
    currentBalance: 1500,
    ravEstime: 800,
    ravEffectif: -100,
    totalSurplus: 0,
    totalSavings: 75,
    piggyAmount: 50,
    bilan: -100,
    bilanSign: 'negative',
    budgets: [
      {
        budgetId: 'b1',
        budgetName: 'Courses',
        estimatedAmount: 400,
        spentThisMonth: 350,
        cumulatedSavings: 75,
        carryoverSpentAmount: 0,
        surplus: 0,
        deficit: 0,
      },
      {
        budgetId: 'b2',
        budgetName: 'Loisirs',
        estimatedAmount: 100,
        spentThisMonth: 200,
        cumulatedSavings: 0,
        carryoverSpentAmount: 0,
        surplus: 0,
        deficit: 100,
      },
    ],
    savingsProjects: [],
    ...overrides,
  }
}

function makeRecap(overrides: Partial<RecapProgress> = {}): RecapProgress {
  return {
    id: 'r1',
    currentStep: 'manage_bilan',
    refloatedFromPiggy: 0,
    refloatedFromSavings: 0,
    snapshotData: null,
    piggyTransfersData: null,
    projectSnapshotData: null,
    recoveryData: null,
    surplusSavingsData: {},
    plannedPiggyRefloat: 0,
    plannedSavingsRefloat: null,
    ...overrides,
  }
}

function renderStep(summary = makeSummary(), recap = makeRecap()) {
  return render(
    <BilanNegativeStep context="profile" summary={summary} recap={recap} recapMonth={9} />,
  )
}

/** Montant affiché dans le bandeau collant (« Reste à renflouer »). */
function stickyAmount(): string {
  const progress = screen.getByRole('progressbar', { name: 'Part du déficit renflouée' })
  const card = progress.parentElement!
  return card.textContent ?? ''
}

beforeEach(() => {
  prepareMock.mockReset()
  saveMock.mockReset()
  advanceMock.mockReset()
  prepareState = { isError: false, error: null }
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('BilanNegativeStep — préparation (surplus → économies)', () => {
  it('lance la préparation une seule fois et affiche un chargement tant qu’elle n’est pas faite', () => {
    const { rerender } = renderStep(makeSummary(), makeRecap({ surplusSavingsData: null }))
    expect(prepareMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/On range le surplus de tes budgets/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Tirelire/ })).not.toBeInTheDocument()

    rerender(
      <BilanNegativeStep
        context="profile"
        summary={makeSummary()}
        recap={makeRecap({ surplusSavingsData: null })}
        recapMonth={9}
      />,
    )
    expect(prepareMock).toHaveBeenCalledTimes(1)
  })

  it('propose de réessayer quand la préparation échoue', async () => {
    prepareState = { isError: true, error: new Error('no_active_recap') }
    renderStep(makeSummary(), makeRecap({ surplusSavingsData: null }))

    expect(screen.getByRole('alert')).toHaveTextContent('Aucun récap actif')
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(prepareMock).toHaveBeenCalledTimes(2)
  })

  it('ne relance pas la préparation quand le surplus est déjà versé, et l’annonce', () => {
    renderStep(makeSummary(), makeRecap({ surplusSavingsData: { b1: 75 } }))
    expect(prepareMock).not.toHaveBeenCalled()
    expect(screen.getByText(/a été rangé dans leurs économies/)).toHaveTextContent('75,00')
  })
})

describe('BilanNegativeStep — affichage', () => {
  it('affiche le titre, le reste à renflouer et les 3 sources', () => {
    renderStep()

    expect(screen.getByRole('heading', { name: 'Gestion du déficit' })).toBeInTheDocument()
    expect(stickyAmount()).toMatch(/Reste à renflouer/)
    expect(stickyAmount()).toMatch(/100,00/)
    expect(screen.getByRole('button', { name: /Tirelire.*Disponible : 50,00/ })).toBeEnabled()
    // Budgets : 75 + 400 + 0 + 100 = 575 disponibles dont 75 d'économies
    expect(screen.getByRole('button', { name: /Budgets.*575,00.*75,00/ })).toBeEnabled()
    // Aucun projet : section inactive
    expect(screen.getByRole('button', { name: /Projets d’épargne.*Aucun projet/ })).toBeDisabled()
  })

  it('signale ce que l’ancienne cascade avait déjà débité', () => {
    renderStep(makeSummary(), makeRecap({ refloatedFromPiggy: 20 }))
    expect(screen.getByText(/Déjà renfloué avant la mise à jour/)).toHaveTextContent('20,00')
    expect(stickyAmount()).toMatch(/80,00/)
  })
})

describe('BilanNegativeStep — tirelire', () => {
  it('le curseur met à jour le reste à renflouer en direct, Valider enregistre', async () => {
    saveMock.mockResolvedValue({ plan: {}, deficitRemaining: 70 })
    renderStep()

    await userEvent.click(screen.getByRole('button', { name: /Tirelire/ }))
    fireEvent.change(screen.getByRole('slider', { name: 'Curseur Tirelire' }), {
      target: { value: '30' },
    })

    expect(stickyAmount()).toMatch(/70,00/)
    await userEvent.click(screen.getByRole('button', { name: 'Valider' }))
    expect(saveMock).toHaveBeenCalledWith({ source: 'piggy', amount: 30 })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Choix enregistré'))
  })

  it('le montant saisi est borné à ce qu’il reste à renflouer', async () => {
    saveMock.mockResolvedValue({ plan: {}, deficitRemaining: 0 })
    renderStep(makeSummary({ bilan: -30 }))

    await userEvent.click(screen.getByRole('button', { name: /Tirelire/ }))
    const input = screen.getByRole('textbox', { name: 'Montant pris dans Tirelire' })
    await userEvent.click(input)
    await userEvent.type(input, '40')

    expect(stickyAmount()).toMatch(/Déficit comblé/)
    await userEvent.click(screen.getByRole('button', { name: 'Valider' }))
    expect(saveMock).toHaveBeenCalledWith({ source: 'piggy', amount: 30 })
  })

  it('Annuler abandonne la saisie', async () => {
    renderStep()

    await userEvent.click(screen.getByRole('button', { name: /Tirelire/ }))
    fireEvent.change(screen.getByRole('slider', { name: 'Curseur Tirelire' }), {
      target: { value: '30' },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Annuler' }))

    expect(saveMock).not.toHaveBeenCalled()
    expect(stickyAmount()).toMatch(/100,00/)
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })

  it('bloque les autres sections tant qu’il y a des changements non validés', async () => {
    renderStep()

    await userEvent.click(screen.getByRole('button', { name: /Tirelire/ }))
    expect(screen.getByRole('button', { name: /Budgets/ })).toBeEnabled()

    fireEvent.change(screen.getByRole('slider', { name: 'Curseur Tirelire' }), {
      target: { value: '10' },
    })
    expect(screen.getByRole('button', { name: /Budgets/ })).toBeDisabled()
    expect(screen.getByText('Valide ou annule tes changements pour continuer.')).toBeInTheDocument()
  })

  it('affiche le message d’erreur métier quand l’enregistrement échoue', async () => {
    saveMock.mockRejectedValue(new Error('overflow'))
    renderStep()

    await userEvent.click(screen.getByRole('button', { name: /Tirelire/ }))
    fireEvent.change(screen.getByRole('slider', { name: 'Curseur Tirelire' }), {
      target: { value: '10' },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Valider' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('dépasse ce qu’il reste à renflouer'),
    )
  })
})

describe('BilanNegativeStep — budgets', () => {
  it('affiche économies puis budget d’octobre par ligne, en direct', async () => {
    renderStep()
    await userEvent.click(screen.getByRole('button', { name: /Budgets/ }))

    fireEvent.change(screen.getByRole('slider', { name: 'Curseur Courses' }), {
      target: { value: '90' },
    })
    const line = screen.getByRole('slider', { name: 'Curseur Courses' }).closest('li')!
    // 90 = 75 d'économies + 15 sur le budget d'octobre
    expect(within(line).getByText(/Économies/).parentElement).toHaveTextContent(/75,00.*0,00/)
    expect(within(line).getByText(/Budget octobre/).parentElement).toHaveTextContent(
      /400,00.*385,00/,
    )
    expect(stickyAmount()).toMatch(/10,00/)
  })

  it('« Répartir le reste automatiquement » : économies d’abord, puis budgets au prorata', async () => {
    saveMock.mockResolvedValue({ plan: {}, deficitRemaining: 0 })
    renderStep()
    await userEvent.click(screen.getByRole('button', { name: /Budgets/ }))

    await userEvent.click(screen.getByRole('button', { name: /Répartir le reste automatiquement/ }))
    expect(stickyAmount()).toMatch(/Déficit comblé/)

    await userEvent.click(screen.getByRole('button', { name: 'Valider' }))
    // 75 d'économies (Courses) puis 25 réparti 400:100 sur les budgets → 20 / 5
    expect(saveMock).toHaveBeenCalledWith({
      source: 'budgets',
      allocations: { b1: 95, b2: 5 },
    })
  })

  it('ré-ouvre la section avec les montants déjà enregistrés (économies + budget)', async () => {
    renderStep(
      makeSummary(),
      makeRecap({ plannedSavingsRefloat: { b1: 75 }, snapshotData: { b1: 5 } }),
    )
    expect(screen.getByRole('button', { name: /Budgets/ })).toHaveTextContent('−80,00')

    await userEvent.click(screen.getByRole('button', { name: /Budgets/ }))
    expect(screen.getByRole('textbox', { name: 'Montant pris dans Courses' })).toHaveValue('80,00')
  })
})

describe('BilanNegativeStep — projets', () => {
  it('borne chaque projet à sa mensualité et annonce le recul d’échéance', async () => {
    saveMock.mockResolvedValue({ plan: {}, deficitRemaining: 50 })
    renderStep(
      makeSummary({
        savingsProjects: [
          {
            id: 'p1',
            name: 'Vacances',
            monthlyAllocation: 50,
            amountSaved: 100,
            targetAmount: 1000,
            deadlineDate: '2027-06-01',
            monthsRemaining: 9,
            pendingDelayFraction: 0,
          },
        ],
      }),
    )

    await userEvent.click(screen.getByRole('button', { name: /Projets d’épargne/ }))
    fireEvent.change(screen.getByRole('slider', { name: 'Curseur Vacances' }), {
      target: { value: '50' },
    })
    expect(screen.getByText(/Échéance repoussée de 1 mois/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Valider' }))
    expect(saveMock).toHaveBeenCalledWith({ source: 'projects', allocations: { p1: 50 } })
  })
})

describe('BilanNegativeStep — Continuer', () => {
  it('reste inactif tant qu’il reste un déficit et de quoi le combler', () => {
    renderStep()
    expect(screen.getByRole('button', { name: 'Continuer' })).toBeDisabled()
    expect(screen.getByText(/à renflouer avant de continuer/)).toHaveTextContent('100,00')
  })

  it('s’active quand le plan enregistré couvre le déficit et fait avancer le récap', async () => {
    advanceMock.mockResolvedValue({})
    renderStep(makeSummary(), makeRecap({ plannedPiggyRefloat: 50, snapshotData: { b2: 50 } }))

    expect(stickyAmount()).toMatch(/Déficit comblé/)
    await userEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    expect(advanceMock).toHaveBeenCalledWith({ fromStep: 'manage_bilan', toStep: 'salary_update' })
  })

  it('« Continuer sans tout renflouer » quand plus aucune source ne peut rien donner', async () => {
    advanceMock.mockResolvedValue({})
    renderStep(
      makeSummary({
        piggyAmount: 0,
        totalSavings: 0,
        budgets: [
          {
            budgetId: 'b1',
            budgetName: 'Courses',
            estimatedAmount: 0,
            spentThisMonth: 0,
            cumulatedSavings: 0,
            carryoverSpentAmount: 0,
            surplus: 0,
            deficit: 0,
          },
        ],
      }),
    )

    expect(screen.getByText(/ne pourront pas être renfloués/)).toHaveTextContent('100,00')
    await userEvent.click(screen.getByRole('button', { name: 'Continuer sans tout renflouer' }))
    expect(advanceMock).toHaveBeenCalledTimes(1)
  })

  it('ignore invalid_step (le récap a déjà avancé) mais affiche les autres erreurs', async () => {
    advanceMock.mockRejectedValueOnce(new Error('invalid_step'))
    const { unmount } = renderStep(
      makeSummary(),
      makeRecap({ plannedPiggyRefloat: 50, snapshotData: { b2: 50 } }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    unmount()

    advanceMock.mockRejectedValueOnce(new Error('deficit_not_covered'))
    renderStep(makeSummary(), makeRecap({ plannedPiggyRefloat: 50, snapshotData: { b2: 50 } }))
    await userEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Il reste un montant à renflouer'),
    )
  })
})
