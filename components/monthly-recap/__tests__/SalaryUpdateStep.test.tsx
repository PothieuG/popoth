import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RecapSummary } from '@/lib/recap'

const advanceMock = vi.fn()
const updateMock = vi.fn()
let advancePending = false
let updatePending = false

vi.mock('@/hooks/useMonthlyRecap', () => ({
  useAdvanceStep: () => ({ mutateAsync: advanceMock, isPending: advancePending }),
  useUpdateSalaries: () => ({ mutateAsync: updateMock, isPending: updatePending }),
}))

let mockProfile: { id: string; salary: number } | null = {
  id: '11111111-1111-4111-8111-111111111111',
  salary: 2200,
}
vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ profile: mockProfile }),
}))

const mockContributions: Array<{
  profile_id: string
  salary: number
  profile: { first_name: string; last_name: string } | null
}> = [
  {
    profile_id: '11111111-1111-4111-8111-111111111111',
    salary: 2200,
    profile: { first_name: 'Alice', last_name: 'Martin' },
  },
  {
    profile_id: '22222222-2222-4222-8222-222222222222',
    salary: 1800,
    profile: { first_name: 'Bob', last_name: 'Durand' },
  },
]
let mockContribLoading = false
vi.mock('@/hooks/useGroupContributions', () => ({
  useGroupContributions: () => ({
    contributions: mockContributions,
    isLoading: mockContribLoading,
    error: null,
  }),
}))

import { SalaryUpdateStep } from '../steps/SalaryUpdateStep'

function makeSummary(): RecapSummary {
  return {
    currentBalance: 1500,
    ravEstime: 800,
    ravEffectif: 950,
    totalSurplus: 100,
    totalSavings: 75,
    piggyAmount: 50,
    bilan: 150,
    bilanSign: 'positive',
    budgets: [],
    savingsProjects: [],
  }
}

beforeEach(() => {
  advanceMock.mockReset()
  updateMock.mockReset()
  advancePending = false
  updatePending = false
  mockProfile = { id: '11111111-1111-4111-8111-111111111111', salary: 2200 }
  mockContribLoading = false
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('SalaryUpdateStep', () => {
  it('renders the profile question with Oui/Non buttons (context=profile)', () => {
    const onSalaryUpdated = vi.fn()
    render(
      <SalaryUpdateStep
        context="profile"
        summary={makeSummary()}
        onSalaryUpdated={onSalaryUpdated}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Mise à jour du salaire' })).toBeInTheDocument()
    expect(screen.getByText('Voulez-vous mettre à jour le salaire ?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Oui' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Non' })).toBeInTheDocument()
  })

  it('renders the group question (context=group)', () => {
    const onSalaryUpdated = vi.fn()
    render(
      <SalaryUpdateStep
        context="group"
        summary={makeSummary()}
        onSalaryUpdated={onSalaryUpdated}
      />,
    )

    expect(
      screen.getByText('Voulez-vous mettre à jour un des salaires des membres du groupe ?'),
    ).toBeInTheDocument()
  })

  it('clicking "Non" advances the wizard to final_recap without calling onSalaryUpdated', async () => {
    const user = userEvent.setup()
    const onSalaryUpdated = vi.fn()
    advanceMock.mockResolvedValueOnce({})

    render(
      <SalaryUpdateStep
        context="profile"
        summary={makeSummary()}
        onSalaryUpdated={onSalaryUpdated}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Non' }))

    await waitFor(() => {
      expect(advanceMock).toHaveBeenCalledTimes(1)
    })
    expect(advanceMock).toHaveBeenCalledWith({
      fromStep: 'salary_update',
      toStep: 'final_recap',
    })
    expect(updateMock).not.toHaveBeenCalled()
    expect(onSalaryUpdated).not.toHaveBeenCalled()
  })

  it('clicking "Oui" in profile context surfaces the prefilled salary input', async () => {
    const user = userEvent.setup()
    const onSalaryUpdated = vi.fn()

    render(
      <SalaryUpdateStep
        context="profile"
        summary={makeSummary()}
        onSalaryUpdated={onSalaryUpdated}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Oui' }))

    const input = screen.getByLabelText('Mon salaire') as HTMLInputElement
    expect(input).toBeInTheDocument()
    expect(input.value).toBe('2200')
    expect(screen.getByRole('button', { name: 'Mettre à jour' })).toBeInTheDocument()
  })

  it('submitting the profile form POSTs the new salary and fires onSalaryUpdated', async () => {
    const user = userEvent.setup()
    const onSalaryUpdated = vi.fn()
    updateMock.mockResolvedValueOnce({
      updated: 1,
      nextStep: 'final_recap',
      contributionsRecalculated: false,
    })

    render(
      <SalaryUpdateStep
        context="profile"
        summary={makeSummary()}
        onSalaryUpdated={onSalaryUpdated}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Oui' }))
    const input = screen.getByLabelText('Mon salaire')
    await user.clear(input)
    await user.type(input, '2450')
    await user.click(screen.getByRole('button', { name: 'Mettre à jour' }))

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1)
    })
    expect(updateMock).toHaveBeenCalledWith({
      salaries: [{ profileId: '11111111-1111-4111-8111-111111111111', salary: 2450 }],
    })
    expect(onSalaryUpdated).toHaveBeenCalledTimes(1)
  })

  it('clicking "Oui" in group context renders the group member subform', async () => {
    const user = userEvent.setup()
    const onSalaryUpdated = vi.fn()

    render(
      <SalaryUpdateStep
        context="group"
        summary={makeSummary()}
        onSalaryUpdated={onSalaryUpdated}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Oui' }))

    expect(screen.getByLabelText('Alice Martin')).toBeInTheDocument()
    expect(screen.getByLabelText('Bob Durand')).toBeInTheDocument()
  })

  it('shows a skeleton when profile context but profile not yet loaded', async () => {
    const user = userEvent.setup()
    mockProfile = null
    const onSalaryUpdated = vi.fn()

    render(
      <SalaryUpdateStep
        context="profile"
        summary={makeSummary()}
        onSalaryUpdated={onSalaryUpdated}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Oui' }))

    // Skeleton (role=status) replaces the form input
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByLabelText('Mon salaire')).not.toBeInTheDocument()
  })

  it('surfaces a role="alert" with mapped copy when update mutation rejects with invalid_target', async () => {
    const user = userEvent.setup()
    const onSalaryUpdated = vi.fn()
    updateMock.mockRejectedValueOnce(new Error('invalid_target'))

    render(
      <SalaryUpdateStep
        context="profile"
        summary={makeSummary()}
        onSalaryUpdated={onSalaryUpdated}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Oui' }))
    await user.click(screen.getByRole('button', { name: 'Mettre à jour' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/profils ciblés/)
    })
    expect(onSalaryUpdated).not.toHaveBeenCalled()
  })

  it('disables both buttons while the advance mutation is pending (Non click)', () => {
    advancePending = true
    const onSalaryUpdated = vi.fn()

    render(
      <SalaryUpdateStep
        context="profile"
        summary={makeSummary()}
        onSalaryUpdated={onSalaryUpdated}
      />,
    )

    expect(screen.getByRole('button', { name: 'Chargement…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Oui' })).toBeDisabled()
  })

  it('shows "Mise à jour…" + disables submit while the update mutation is pending', async () => {
    const user = userEvent.setup()
    const onSalaryUpdated = vi.fn()

    const { rerender } = render(
      <SalaryUpdateStep
        context="profile"
        summary={makeSummary()}
        onSalaryUpdated={onSalaryUpdated}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Oui' }))
    expect(screen.getByRole('button', { name: 'Mettre à jour' })).toBeInTheDocument()

    // Flip the module-level pending flag and re-render the same instance so
    // useUpdateSalaries() reads the new value while preserving the
    // `decided='yes'` state.
    updatePending = true
    rerender(
      <SalaryUpdateStep
        context="profile"
        summary={makeSummary()}
        onSalaryUpdated={onSalaryUpdated}
      />,
    )

    const pendingBtn = screen.getByRole('button', { name: 'Mise à jour…' })
    expect(pendingBtn).toBeDisabled()
  })
})
