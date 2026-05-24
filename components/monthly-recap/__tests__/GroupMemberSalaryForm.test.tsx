import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface MockContrib {
  profile_id: string
  salary: number
  profile: { first_name: string; last_name: string } | null
}

let mockContributions: MockContrib[] = []
let mockIsLoading = false
let mockError: string | null = null

vi.mock('@/hooks/useGroupContributions', () => ({
  useGroupContributions: () => ({
    contributions: mockContributions,
    isLoading: mockIsLoading,
    error: mockError,
  }),
}))

import { GroupMemberSalaryForm } from '../GroupMemberSalaryForm'

beforeEach(() => {
  mockContributions = [
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
  mockIsLoading = false
  mockError = null
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('GroupMemberSalaryForm', () => {
  it('shows a skeleton while contributions are loading', () => {
    mockIsLoading = true
    const onSubmit = vi.fn()
    render(<GroupMemberSalaryForm isSubmitting={false} onSubmit={onSubmit} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Alice/)).not.toBeInTheDocument()
  })

  it('shows an error alert when the hook surfaces an error', () => {
    mockError = 'Erreur réseau'
    const onSubmit = vi.fn()
    render(<GroupMemberSalaryForm isSubmitting={false} onSubmit={onSubmit} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/Erreur réseau/)
  })

  it('renders N labeled inputs prefilled with each member salary', () => {
    const onSubmit = vi.fn()
    render(<GroupMemberSalaryForm isSubmitting={false} onSubmit={onSubmit} />)

    const alice = screen.getByLabelText('Alice Martin') as HTMLInputElement
    const bob = screen.getByLabelText('Bob Durand') as HTMLInputElement
    expect(alice.value).toBe('2200')
    expect(bob.value).toBe('1800')
  })

  it('falls back to "Membre" label when the profile FK join returned null', () => {
    mockContributions = [
      {
        profile_id: '11111111-1111-4111-8111-111111111111',
        salary: 1500,
        profile: null,
      },
    ]
    const onSubmit = vi.fn()
    render(<GroupMemberSalaryForm isSubmitting={false} onSubmit={onSubmit} />)
    expect(screen.getByLabelText('Membre')).toBeInTheDocument()
  })

  it('submits the array of { profileId, salary } tuples with the latest values', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<GroupMemberSalaryForm isSubmitting={false} onSubmit={onSubmit} />)

    const alice = screen.getByLabelText('Alice Martin')
    await user.clear(alice)
    await user.type(alice, '2350')
    await user.click(screen.getByRole('button', { name: 'Mettre à jour' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    expect(onSubmit).toHaveBeenCalledWith([
      { profileId: '11111111-1111-4111-8111-111111111111', salary: 2350 },
      { profileId: '22222222-2222-4222-8222-222222222222', salary: 1800 },
    ])
  })

  it('disables the submit button with "Mise à jour…" copy while the parent is submitting', () => {
    const onSubmit = vi.fn()
    render(<GroupMemberSalaryForm isSubmitting={true} onSubmit={onSubmit} />)
    const btn = screen.getByRole('button', { name: 'Mise à jour…' })
    expect(btn).toBeDisabled()
  })
})
