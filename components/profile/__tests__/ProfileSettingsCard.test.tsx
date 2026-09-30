import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ProfileData } from '@/app/api/profile/route'

// Sprint Salary-Edit-Gating (2026-05-25) — RTL coverage for the salary
// read-only gating in Paramètres. Le hook useSalaryEditability détermine si
// l'input est désactivé + si le helper "Modifiable à la fin de ton recap…"
// s'affiche. Les autres champs (prénom, nom, avatar) restent éditables.

const baseProfile: ProfileData = {
  id: 'profile-1',
  first_name: 'Jean',
  last_name: 'Dupont',
  salary: 1500,
  group_id: null,
  group_name: null,
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const updateProfileMock = vi.fn<(updates: Record<string, unknown>) => Promise<boolean>>(
  async () => true,
)

// Mutables par test (réinitialisés dans chaque beforeEach) : les suites
// "contribution" branchent un groupe, les suites "salary gating" restent solo.
const profileState: { value: ProfileData } = { value: baseProfile }
const groupState: {
  hasGroup: boolean
  contributions: { profile_id: string; salary: number }[]
  groupInfo: { monthly_budget_estimate: number; monthly_income_estimate: number } | null
} = { hasGroup: false, contributions: [], groupInfo: null }

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({
    profile: profileState.value,
    isLoading: false,
    isFetching: false,
    updateProfile: updateProfileMock,
  }),
}))

vi.mock('@/hooks/useGroups', () => ({
  useGroups: () => ({
    currentGroup: null,
    hasGroup: groupState.hasGroup,
  }),
}))

vi.mock('@/hooks/useGroupContributions', () => ({
  useGroupContributions: () => ({
    contributions: groupState.contributions,
    groupInfo: groupState.groupInfo,
  }),
}))

const salaryEditabilityMock = vi.fn()

vi.mock('@/hooks/useSalaryEditability', () => ({
  useSalaryEditability: () => salaryEditabilityMock(),
}))

vi.mock('@/components/ui/AvatarUpload', () => ({
  default: () => <div data-testid="avatar-upload-stub" />,
}))

async function renderCard() {
  const { default: ProfileSettingsCard } = await import('../ProfileSettingsCard')
  return render(<ProfileSettingsCard />)
}

describe('ProfileSettingsCard — salary gating (Sprint Salary-Edit-Gating)', () => {
  beforeEach(() => {
    updateProfileMock.mockClear()
    salaryEditabilityMock.mockReset()
    profileState.value = baseProfile
    groupState.hasGroup = false
    groupState.contributions = []
    groupState.groupInfo = null
  })

  it('disables salary input + shows lock helper when planner is not empty', async () => {
    salaryEditabilityMock.mockReturnValue({
      editable: false,
      reason: 'planner-not-empty',
      isLoading: false,
      isFetching: false,
      error: null,
    })
    const user = userEvent.setup()
    await renderCard()

    await user.click(screen.getByRole('button', { name: /modifier/i }))

    const salaryInput = screen.getByLabelText(/salaire/i)
    expect(salaryInput).toBeDisabled()
    expect(salaryInput).toHaveAttribute('aria-describedby', 'salary-locked-hint')

    const hint = screen.getByText(/Modifiable à la fin de ton recap mensuel/i)
    expect(hint).toBeInTheDocument()
    expect(hint.closest('p')).toHaveAttribute('id', 'salary-locked-hint')
  })

  it('enables salary input + hides lock helper when planner is empty', async () => {
    salaryEditabilityMock.mockReturnValue({
      editable: true,
      reason: null,
      isLoading: false,
      isFetching: false,
      error: null,
    })
    const user = userEvent.setup()
    await renderCard()

    await user.click(screen.getByRole('button', { name: /modifier/i }))

    const salaryInput = screen.getByLabelText(/salaire/i)
    expect(salaryInput).not.toBeDisabled()
    expect(salaryInput).not.toHaveAttribute('aria-describedby', 'salary-locked-hint')

    expect(screen.queryByText(/Modifiable à la fin de ton recap mensuel/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Requis pour la contribution au groupe/i)).toBeInTheDocument()
  })

  it('disables salary input + disables Save button while editability is loading', async () => {
    salaryEditabilityMock.mockReturnValue({
      editable: false,
      reason: null,
      isLoading: true,
      isFetching: true,
      error: null,
    })
    const user = userEvent.setup()
    await renderCard()

    await user.click(screen.getByRole('button', { name: /modifier/i }))

    expect(screen.getByLabelText(/salaire/i)).toBeDisabled()
    expect(screen.getByRole('button', { name: /enregistrer/i })).toBeDisabled()
    // Helper text NOT shown during loading (avoid flicker)
    expect(screen.queryByText(/Modifiable à la fin de ton recap mensuel/i)).not.toBeInTheDocument()
  })

  it('omits salary from update payload when locked but allows first_name edit', async () => {
    salaryEditabilityMock.mockReturnValue({
      editable: false,
      reason: 'planner-not-empty',
      isLoading: false,
      isFetching: false,
      error: null,
    })
    const user = userEvent.setup()
    await renderCard()

    await user.click(screen.getByRole('button', { name: /modifier/i }))

    const firstNameInput = screen.getByLabelText('Prénom')
    await user.clear(firstNameInput)
    await user.type(firstNameInput, 'Marie')

    await user.click(screen.getByRole('button', { name: /enregistrer/i }))

    expect(updateProfileMock).toHaveBeenCalledTimes(1)
    const payload = updateProfileMock.mock.calls[0]?.[0] ?? {}
    expect(payload).toHaveProperty('first_name', 'Marie')
    expect(payload).not.toHaveProperty('salary')
  })

  it('includes salary in update payload when editable', async () => {
    salaryEditabilityMock.mockReturnValue({
      editable: true,
      reason: null,
      isLoading: false,
      isFetching: false,
      error: null,
    })
    const user = userEvent.setup()
    await renderCard()

    await user.click(screen.getByRole('button', { name: /modifier/i }))

    const salaryInput = screen.getByLabelText(/salaire/i)
    await user.clear(salaryInput)
    await user.type(salaryInput, '2000')

    await user.click(screen.getByRole('button', { name: /enregistrer/i }))

    expect(updateProfileMock).toHaveBeenCalledTimes(1)
    const payload = updateProfileMock.mock.calls[0]?.[0] ?? {}
    expect(payload).toHaveProperty('salary', 2000)
  })
})

// Les revenus estimés du groupe (ex. CAF) sont retirés du budget avant la
// répartition, comme dans la RPC `calculate_group_contributions`. Avant le fix,
// la carte recalculait sur le budget brut : elle affichait 1 743 € au lieu des
// 1 682 € réellement dus (cas prod du 2026-09-30, budget 4 335,43 €, CAF 152 €).
describe('ProfileSettingsCard — contribution nette des revenus du groupe', () => {
  beforeEach(() => {
    updateProfileMock.mockClear()
    salaryEditabilityMock.mockReset()
    salaryEditabilityMock.mockReturnValue({
      editable: true,
      reason: null,
      isLoading: false,
      isFetching: false,
      error: null,
    })
    profileState.value = {
      ...baseProfile,
      salary: 1850,
      group_id: 'group-1',
      group_name: 'Famille',
    }
    groupState.hasGroup = true
    groupState.contributions = [
      { profile_id: 'profile-2', salary: 2752.08 },
      { profile_id: 'profile-1', salary: 1850 },
    ]
    groupState.groupInfo = { monthly_budget_estimate: 4335.43, monthly_income_estimate: 152 }
  })

  it('affiche la contribution calculée sur le reste à financer, et sa part de ce reste', async () => {
    await renderCard()

    // (1850 / 4602.08) × (4335.43 − 152) = 1681.71 €
    expect(screen.getByText(/1\s*682\s*€/)).toBeInTheDocument()
    expect(screen.queryByText(/1\s*743\s*€/)).not.toBeInTheDocument()
    expect(screen.getByText(/90,9\s*%\s*salaire/)).toBeInTheDocument()
    // 1681.71 / 4183.43 = 40,2 % (et non 38,8 % du budget brut)
    expect(screen.getByText(/40,2\s*%\s*du reste à financer/)).toBeInTheDocument()
  })

  it('valide le salaire saisi contre la contribution nette, pas le budget brut', async () => {
    // Groupe solo : budget 2 000 €, revenus 600 € → 1 400 € à financer.
    profileState.value = { ...baseProfile, salary: 1500 }
    groupState.contributions = [{ profile_id: 'profile-1', salary: 1500 }]
    groupState.groupInfo = { monthly_budget_estimate: 2000, monthly_income_estimate: 600 }
    const user = userEvent.setup()
    await renderCard()

    await user.click(screen.getByRole('button', { name: /modifier/i }))
    const salaryInput = screen.getByLabelText(/salaire/i)
    await user.clear(salaryInput)
    await user.type(salaryInput, '1300')

    // Sur le budget brut, le message citerait 2 000 €. Le salaire est dans le
    // motif : chaque frappe relance la validation (« 1 », « 13 »…), on attend
    // celle de la valeur complète.
    expect(
      await screen.findByText(
        /contribution calculée \(1\s*400\s*€\) dépasse votre salaire \(1\s*300\s*€\)/,
      ),
    ).toBeInTheDocument()
    // Budget max suggéré = salaires + revenus du groupe = 1 300 + 600.
    expect(screen.getByText(/réduire le budget à 1\s*900\s*€ maximum/)).toBeInTheDocument()
  })
})
