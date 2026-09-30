import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ProfileData } from '@/app/api/profile/route'
import type { GroupContributionData } from '@/app/api/groups/contributions/route'
import GroupInfoNavbar from '../GroupInfoNavbar'

// Miroir d'UserInfoNavbar : le % entre parenthèses porte sur le reste à
// financer (budget − revenus du groupe), pas sur le budget brut.

const profile: ProfileData = {
  id: 'profile-1',
  first_name: 'Gilles',
  last_name: 'P',
  salary: 2752.08,
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
  salary: 2752.08,
  contribution_amount: 2501.72,
  contribution_percentage: 90.9,
  calculated_at: null,
}

describe('GroupInfoNavbar — part du reste à financer', () => {
  it('affiche la part du reste à financer entre parenthèses', () => {
    // 2501.72 / 4183.43 = 59,8 % → 60 % (sur le budget brut 4 335,43 : 58 %)
    render(
      <GroupInfoNavbar
        profile={profile}
        members={[]}
        userContribution={contribution}
        amountToFund={4183.43}
      />,
    )

    const share = screen.getByText('60%')
    expect(share.parentElement).toHaveAttribute('title', expect.stringMatching(/reste à financer/))
    expect(screen.queryByText('58%')).not.toBeInTheDocument()
  })
})
