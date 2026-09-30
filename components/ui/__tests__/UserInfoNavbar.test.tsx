import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ProfileData } from '@/app/api/profile/route'
import type { GroupContributionData } from '@/app/api/groups/contributions/route'
import UserInfoNavbar from '../UserInfoNavbar'

// Le % de l'en-tête perso porte sur le reste à financer (budget − revenus du
// groupe) : les parts des membres totalisent 100 %. Sur le budget brut, un
// groupe avec une CAF affichait 58 % + 39 % (cas prod 2026-09-30).

const profile: ProfileData = {
  id: 'profile-1',
  first_name: 'Bérengère',
  last_name: 'P',
  salary: 1850,
  group_id: 'group-1',
  group_name: 'Famille',
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const contribution: GroupContributionData = {
  id: 'c1',
  profile_id: 'profile-1',
  group_id: 'group-1',
  salary: 1850,
  contribution_amount: 1681.71,
  contribution_percentage: 90.9,
  calculated_at: null,
}

describe('UserInfoNavbar — part du reste à financer', () => {
  it('affiche la part du reste à financer, pas la part du budget brut', () => {
    // 1681.71 / (4335.43 − 152) = 40,2 % → 40 % (sur le budget brut : 39 %)
    render(
      <UserInfoNavbar profile={profile} userContribution={contribution} amountToFund={4183.43} />,
    )

    const share = screen.getByText(/du\s+reste à financer/)
    expect(share).toHaveTextContent(/^40%\s+du\s+reste à financer$/)
    expect(share).toHaveAttribute('title', expect.stringMatching(/revenus/))
    expect(screen.getByText(/de votre\s+salaire/)).toHaveTextContent(/^91%/)
  })

  it('masque la part quand il ne reste rien à financer', () => {
    render(<UserInfoNavbar profile={profile} userContribution={contribution} amountToFund={0} />)

    expect(screen.queryByText(/reste à financer/)).not.toBeInTheDocument()
    expect(screen.getByText(/de votre\s+salaire/)).toBeInTheDocument()
  })
})
