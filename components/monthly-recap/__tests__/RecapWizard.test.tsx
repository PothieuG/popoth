import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MonthlyRecapStatusResponse } from '@/hooks/useMonthlyRecap'
import type { RecapStatusKind, RecapSummary } from '@/lib/recap'

const useMonthlyRecapMock = vi.fn<
  () => {
    data: MonthlyRecapStatusResponse | undefined
    isLoading: boolean
    error: Error | null
  }
>()
const routerReplaceMock = vi.fn()

vi.mock('@/hooks/useMonthlyRecap', () => ({
  useMonthlyRecap: (...args: unknown[]) => useMonthlyRecapMock(...(args as [])),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
}))

vi.mock('@/hooks/useAuth', () => ({
  useLogoutAndRedirect: () => ({ logoutAndRedirect: vi.fn() }),
}))

import { RecapWizard } from '../RecapWizard'

function makeSummary(overrides?: Partial<RecapSummary>): RecapSummary {
  return {
    currentBalance: 1200,
    ravEstime: 800,
    ravEffectif: 750,
    totalSurplus: 195,
    totalSavings: 320,
    piggyAmount: 50,
    budgets: [],
    bilan: 100,
    bilanSign: 'positive',
    ...overrides,
  }
}

function mockStatus(status: RecapStatusKind, summary: RecapSummary | null = null) {
  useMonthlyRecapMock.mockReturnValue({
    data: { status, summary },
    isLoading: false,
    error: null,
  })
}

describe('RecapWizard', () => {
  beforeEach(() => {
    useMonthlyRecapMock.mockReset()
    routerReplaceMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders Welcome + Frieze step 1 when no recap exists', () => {
    mockStatus({ kind: 'no_recap' })
    render(<RecapWizard context="profile" />)
    expect(screen.getByText(/Étape 1 sur 5 — Bienvenue/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Bienvenue' })).toBeInTheDocument()
  })

  it('renders Summary placeholder + Frieze step 2 when in_progress at summary', () => {
    mockStatus(
      {
        kind: 'in_progress',
        recapId: 'r1',
        step: 'summary',
        startedAt: '2026-05-23T10:00:00Z',
        startedByProfileId: 'u1',
      },
      makeSummary(),
    )
    render(<RecapWizard context="profile" />)
    expect(screen.getByText(/Étape 2 sur 5 — Récap général/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Récap général' })).toBeInTheDocument()
  })

  it('renders BilanPositive when manage_bilan + bilanSign positive', () => {
    mockStatus(
      {
        kind: 'in_progress',
        recapId: 'r1',
        step: 'manage_bilan',
        startedAt: null,
        startedByProfileId: 'u1',
      },
      makeSummary({ bilanSign: 'positive', bilan: 150 }),
    )
    render(<RecapWizard context="profile" />)
    expect(screen.getByRole('heading', { name: 'Bilan positif' })).toBeInTheDocument()
  })

  it('renders BilanNegative when manage_bilan + bilanSign negative', () => {
    mockStatus(
      {
        kind: 'in_progress',
        recapId: 'r1',
        step: 'manage_bilan',
        startedAt: null,
        startedByProfileId: 'u1',
      },
      makeSummary({ bilanSign: 'negative', bilan: -75 }),
    )
    render(<RecapWizard context="profile" />)
    expect(screen.getByRole('heading', { name: 'Bilan négatif' })).toBeInTheDocument()
  })

  it('renders GroupLockScreen without the frieze when locked_by_other', () => {
    mockStatus({
      kind: 'locked_by_other',
      recapId: 'r1',
      startedByProfileId: 'u2',
      startedByName: 'Alice',
    })
    render(<RecapWizard context="group" />)
    expect(screen.getByText(/Alice est en train de réaliser le récap/)).toBeInTheDocument()
    expect(screen.queryByText(/Étape \d sur 5/)).not.toBeInTheDocument()
  })

  it('redirects to /dashboard via router.replace when status is completed (profile)', async () => {
    mockStatus({ kind: 'completed', recapId: 'r1', completedAt: '2026-05-23T11:00:00Z' })
    render(<RecapWizard context="profile" />)
    expect(screen.getByText(/Récap déjà terminé/)).toBeInTheDocument()
    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith('/dashboard')
    })
  })
})
