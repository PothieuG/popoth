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

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({
    profile: baseProfile,
    isLoading: false,
    isFetching: false,
    updateProfile: updateProfileMock,
  }),
}))

vi.mock('@/hooks/useGroups', () => ({
  useGroups: () => ({
    currentGroup: null,
    hasGroup: false,
  }),
}))

vi.mock('@/hooks/useGroupContributions', () => ({
  useGroupContributions: () => ({
    contributions: [],
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
