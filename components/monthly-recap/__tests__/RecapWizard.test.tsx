import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MonthlyRecapStatusResponse, RecapProgress } from '@/hooks/useMonthlyRecap'
import type { RecapContext, RecapStatusKind, RecapSummary } from '@/lib/recap'

const routerReplaceMock = vi.fn()
const mockResponses: Record<RecapContext, MonthlyRecapStatusResponse | undefined> = {
  profile: undefined,
  group: undefined,
}
let mockProfile: { id: string; group_id: string | null; group_name: string | null } | null = null

vi.mock('@/hooks/useMonthlyRecap', () => ({
  useMonthlyRecap: (context: RecapContext, options?: { enabled?: boolean }) => ({
    data: options?.enabled === false ? undefined : mockResponses[context],
    isLoading: false,
    error: null,
  }),
  useStartRecap: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAdvanceStep: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTransferSurplusesToPiggy: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTransformRemainingSurplusesToSavings: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRefloatFromPiggy: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRefloatFromSavings: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSaveBudgetSnapshot: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateSalaries: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCompleteRecap: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
}))

vi.mock('@/hooks/useAuth', () => ({
  useLogoutAndRedirect: () => ({ logoutAndRedirect: vi.fn() }),
}))

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ profile: mockProfile }),
}))

vi.mock('@/hooks/useGroupContributions', () => ({
  useGroupContributions: () => ({ contributions: [], isLoading: false, error: null }),
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

// Sprint Complete-Month-Step (2026-05-29) — défauts arbitraires pour
// `recapYear`/`recapMonth` introduits par le status endpoint. La majorité
// des tests RecapWizard ne dépendent pas de la valeur exacte (seul
// CompleteMonthStep les consomme directement, et il n'est pas testé ici).
const DEFAULT_RECAP_YEAR = 2026
const DEFAULT_RECAP_MONTH = 5

function mockStatus(
  status: RecapStatusKind,
  summary: RecapSummary | null = null,
  recap: RecapProgress | null = null,
) {
  // Default: mirror to BOTH contexts so existing tests that render with
  // context="group" while calling mockStatus(...) keep working. The
  // `redirects to /monthly-recap?context=group` test overrides
  // mockResponses.group via mockGroupStatus AFTER calling mockStatus.
  mockResponses.profile = {
    status,
    summary,
    recap,
    recapYear: DEFAULT_RECAP_YEAR,
    recapMonth: DEFAULT_RECAP_MONTH,
  }
  mockResponses.group = {
    status,
    summary,
    recap,
    recapYear: DEFAULT_RECAP_YEAR,
    recapMonth: DEFAULT_RECAP_MONTH,
  }
}

function mockGroupStatus(
  status: RecapStatusKind,
  summary: RecapSummary | null = null,
  recap: RecapProgress | null = null,
) {
  mockResponses.group = {
    status,
    summary,
    recap,
    recapYear: DEFAULT_RECAP_YEAR,
    recapMonth: DEFAULT_RECAP_MONTH,
  }
}

describe('RecapWizard', () => {
  beforeEach(() => {
    mockResponses.profile = undefined
    mockResponses.group = undefined
    mockProfile = null
    routerReplaceMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders Welcome + Frieze step 1/6 when no recap exists', () => {
    mockStatus({ kind: 'no_recap' })
    render(<RecapWizard context="profile" />)
    expect(screen.getByText(/Étape 1 sur 6 — Bienvenue/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Bienvenue' })).toBeInTheDocument()
  })

  it('renders Summary + Frieze step 3/6 when in_progress at summary (sprint Complete-Month-Step shifted summary from 2 to 3)', () => {
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
    expect(screen.getByText(/Étape 3 sur 6 — Récap général/)).toBeInTheDocument()
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
    expect(screen.getByRole('heading', { name: 'Gestion du bilan positif' })).toBeInTheDocument()
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
      {
        id: 'r1',
        currentStep: 'manage_bilan',
        refloatedFromPiggy: 0,
        refloatedFromSavings: 0,
        snapshotData: null,
        piggyTransfersData: null,
      },
    )
    render(<RecapWizard context="profile" />)
    expect(screen.getByRole('heading', { name: 'Gestion du déficit' })).toBeInTheDocument()
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
    expect(screen.queryByText(/Étape \d sur 6/)).not.toBeInTheDocument()
  })

  it('redirects to /dashboard via router.replace when status is completed (profile)', async () => {
    mockStatus({ kind: 'completed', recapId: 'r1', completedAt: '2026-05-23T11:00:00Z' })
    render(<RecapWizard context="profile" />)
    // Sprint 14 follow-up — centered spinner + "Redirection vers le dashboard…"
    // replaced the previous "Récap déjà terminé, redirection…" text.
    expect(screen.getByText(/Redirection vers le dashboard/)).toBeInTheDocument()
    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith('/dashboard')
    })
  })

  it('redirects to /monthly-recap?context=group when profile recap completed AND group recap pending', async () => {
    mockProfile = {
      id: 'u1',
      group_id: 'g1',
      group_name: 'Famille Martin',
    }
    mockStatus({ kind: 'completed', recapId: 'r1', completedAt: '2026-05-23T11:00:00Z' })
    mockGroupStatus({ kind: 'no_recap' })
    render(<RecapWizard context="profile" />)
    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith('/monthly-recap?context=group')
    })
    expect(routerReplaceMock).not.toHaveBeenCalledWith('/dashboard')
  })

  it('redirects to /dashboard when profile recap completed AND group recap also completed', async () => {
    mockProfile = {
      id: 'u1',
      group_id: 'g1',
      group_name: 'Famille Martin',
    }
    mockStatus({ kind: 'completed', recapId: 'r1', completedAt: '2026-05-23T11:00:00Z' })
    mockGroupStatus({ kind: 'completed', recapId: 'rG', completedAt: '2026-05-22T08:00:00Z' })
    render(<RecapWizard context="profile" />)
    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith('/dashboard')
    })
  })

  it('redirects to /group-dashboard when group recap completed (group context)', async () => {
    mockStatus({ kind: 'completed', recapId: 'rG', completedAt: '2026-05-23T11:00:00Z' })
    render(<RecapWizard context="group" />)
    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith('/group-dashboard')
    })
  })
})
