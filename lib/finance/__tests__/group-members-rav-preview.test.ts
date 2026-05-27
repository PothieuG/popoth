/**
 * Tests purs pour `computeGroupMembersRavPreview` + `computeProjectedGroupTotal`.
 *
 * Algorithme delta-math :
 *   delta_contribution = projectedContribution − currentContribution
 *   projectedRav       = currentRav − delta_contribution
 *
 * Le `currentRav` en input est la valeur authoritative (servie par
 * `getProfileFinancialData` côté backend). Le test injecte des valeurs
 * directement, indépendamment de salary/personalBudgets.
 */

import { describe, expect, it } from 'vitest'

import {
  computeGroupMembersRavPreview,
  computeProjectedGroupTotal,
  type GroupMemberRavInput,
} from '@/lib/finance/group-members-rav-preview'

const ALICE: GroupMemberRavInput = {
  profileId: 'alice-uuid',
  firstName: 'Alice',
  salary: 2000,
  currentRav: 1600,
}
const BOB: GroupMemberRavInput = {
  profileId: 'bob-uuid',
  firstName: 'Bob',
  salary: 1000,
  currentRav: 800,
}

describe('computeProjectedGroupTotal', () => {
  it('add mode (currentItemAmount default 0)', () => {
    expect(computeProjectedGroupTotal({ currentGroupTotal: 300, newItemAmount: 150 })).toBe(450)
  })

  it('edit mode soustrait l’ancien avant d’ajouter le nouveau', () => {
    expect(
      computeProjectedGroupTotal({
        currentGroupTotal: 500,
        currentItemAmount: 200,
        newItemAmount: 350,
      }),
    ).toBe(650)
  })

  it('edit vers le bas → total projeté inférieur au courant', () => {
    expect(
      computeProjectedGroupTotal({
        currentGroupTotal: 500,
        currentItemAmount: 200,
        newItemAmount: 50,
      }),
    ).toBe(350)
  })
})

describe('computeGroupMembersRavPreview', () => {
  it('happy path 2 membres prorata salaires — delta appliqué au currentRav', () => {
    // Alice 2000 + Bob 1000 ; budget groupe courant 300, projeté 600.
    // Prorata : Alice 2/3, Bob 1/3.
    // currentContribution_Alice = 200 ; projectedContribution_Alice = 400 ; delta=200
    // projectedRav_Alice = 1600 - 200 = 1400
    // currentContribution_Bob = 100 ; projectedContribution_Bob = 200 ; delta=100
    // projectedRav_Bob = 800 - 100 = 700
    const rows = computeGroupMembersRavPreview({
      members: [ALICE, BOB],
      currentGroupTotal: 300,
      projectedGroupTotal: 600,
    })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      profileId: 'alice-uuid',
      firstName: 'Alice',
      currentRav: 1600,
      projectedRav: 1400,
      willGoNegative: false,
    })
    expect(rows[1]).toMatchObject({
      profileId: 'bob-uuid',
      firstName: 'Bob',
      currentRav: 800,
      projectedRav: 700,
      willGoNegative: false,
    })
  })

  it('split égal quand sumSalaries=0 — delta réparti à parts égales', () => {
    // 2 membres sans salaire, RAV courant 50 chacun ; total passe 0 → 200.
    // delta de contribution = (200 - 0) / 2 = 100 chacun.
    // projectedRav = 50 - 100 = -50 (négatif → warning).
    const m1: GroupMemberRavInput = { ...ALICE, salary: 0, currentRav: 50 }
    const m2: GroupMemberRavInput = { ...BOB, salary: 0, currentRav: 50 }
    const rows = computeGroupMembersRavPreview({
      members: [m1, m2],
      currentGroupTotal: 0,
      projectedGroupTotal: 200,
    })
    expect(rows[0]?.projectedRav).toBe(-50)
    expect(rows[0]?.willGoNegative).toBe(true)
    expect(rows[1]?.projectedRav).toBe(-50)
    expect(rows[1]?.willGoNegative).toBe(true)
  })

  it('membre passant largement en négatif déclenche willGoNegative', () => {
    // Alice currentRav 1600, projete = 1600 - (2/3 × 4500 - 2/3 × 300) = 1600 - 2800 = -1200
    const rows = computeGroupMembersRavPreview({
      members: [ALICE, BOB],
      currentGroupTotal: 300,
      projectedGroupTotal: 4500,
    })
    expect(rows[0]?.projectedRav).toBeCloseTo(-1200, 6)
    expect(rows[0]?.willGoNegative).toBe(true)
    // Bob : 800 - (1/3 × 4500 - 1/3 × 300) = 800 - 1400 = -600
    expect(rows[1]?.projectedRav).toBeCloseTo(-600, 6)
    expect(rows[1]?.willGoNegative).toBe(true)
  })

  it('édition vers le bas → projectedRav > currentRav, jamais de warning', () => {
    // Total 600 → 300 : delta de contribution négatif → RAV libéré.
    // Alice : 1600 - (2/3 × 300 - 2/3 × 600) = 1600 + 200 = 1800
    const rows = computeGroupMembersRavPreview({
      members: [ALICE, BOB],
      currentGroupTotal: 600,
      projectedGroupTotal: 300,
    })
    expect(rows[0]?.projectedRav).toBe(1800)
    expect(rows[0]?.willGoNegative).toBe(false)
    expect(rows[1]?.projectedRav).toBe(900)
    expect(rows[1]?.willGoNegative).toBe(false)
  })

  it('membre déjà en déficit (currentRav négatif) → projection reflète raw', () => {
    // Alice déjà à -100, ajout 300 (passe à 600) → delta = 2/3 × 300 = 200.
    // projectedRav = -100 - 200 = -300, warning évidemment.
    const aliceDeficit: GroupMemberRavInput = { ...ALICE, currentRav: -100 }
    const rows = computeGroupMembersRavPreview({
      members: [aliceDeficit, BOB],
      currentGroupTotal: 300,
      projectedGroupTotal: 600,
    })
    expect(rows[0]?.currentRav).toBe(-100)
    expect(rows[0]?.projectedRav).toBe(-300)
    expect(rows[0]?.willGoNegative).toBe(true)
  })

  it('delta nul (newItemAmount === currentItemAmount) → projectedRav === currentRav', () => {
    const rows = computeGroupMembersRavPreview({
      members: [ALICE, BOB],
      currentGroupTotal: 300,
      projectedGroupTotal: 300,
    })
    expect(rows[0]?.projectedRav).toBe(rows[0]?.currentRav)
    expect(rows[1]?.projectedRav).toBe(rows[1]?.currentRav)
    expect(rows[0]?.willGoNegative).toBe(false)
  })

  it('liste membres vide → retourne []', () => {
    expect(
      computeGroupMembersRavPreview({
        members: [],
        currentGroupTotal: 100,
        projectedGroupTotal: 200,
      }),
    ).toEqual([])
  })
})
