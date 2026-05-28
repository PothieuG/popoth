/**
 * Tests purs pour `computeGroupMembersContributionsPreview` +
 * `computeProjectedGroupIncomeTotal` (Sprint Group-Income-Cascade 2026-05-28).
 *
 * Algorithme (miroir RPC PG `calculate_group_contributions`) :
 *
 *   contribution_base = MAX(0, currentGroupBudgetTotal − projectedGroupIncomeTotal)
 *   IF Σ salaires > 0 : contribution_i = (salary_i / Σ salaires) × contribution_base
 *   ELSE              : contribution_i = contribution_base / nb_membres
 *
 * Le revenu estimé groupe REDUIT les contributions (inverse du budget). Clamp
 * à 0 si revenus_groupe > budgets_groupe (option utilisateur "surplus en
 * cagnotte"). Le `currentRav` du membre n'est PAS utilisé ici — il sert au
 * recap RAV (cf. `group-members-rav-preview.test.ts`).
 */

import { describe, expect, it } from 'vitest'

import {
  computeGroupMembersContributionsPreview,
  computeProjectedGroupIncomeTotal,
} from '@/lib/finance/group-members-contributions-preview'
import type { GroupMemberRavDetail } from '@/lib/finance'

const ALICE: GroupMemberRavDetail = {
  profileId: 'alice-uuid',
  firstName: 'Alice',
  salary: 3000,
  currentRav: 0, // not used by the contributions preview
}
const BOB: GroupMemberRavDetail = {
  profileId: 'bob-uuid',
  firstName: 'Bob',
  salary: 2000,
  currentRav: 0,
}

describe('computeProjectedGroupIncomeTotal', () => {
  it('add mode (currentItemAmount default 0)', () => {
    expect(
      computeProjectedGroupIncomeTotal({ currentGroupIncomeTotal: 200, newItemAmount: 100 }),
    ).toBe(300)
  })

  it('edit mode soustrait l’ancien avant d’ajouter le nouveau', () => {
    expect(
      computeProjectedGroupIncomeTotal({
        currentGroupIncomeTotal: 500,
        currentItemAmount: 200,
        newItemAmount: 350,
      }),
    ).toBe(650)
  })

  it('edit vers le bas → total projeté inférieur au courant', () => {
    expect(
      computeProjectedGroupIncomeTotal({
        currentGroupIncomeTotal: 500,
        currentItemAmount: 200,
        newItemAmount: 50,
      }),
    ).toBe(350)
  })
})

describe('computeGroupMembersContributionsPreview', () => {
  it('happy path 2 membres prorata salaires — ajout revenu groupe réduit les contributions', () => {
    // Budgets groupe : 1000. Salaires : Alice 3000, Bob 2000 (Σ = 5000).
    // Currentgroup income = 0 → contribution_base = 1000.
    //   Alice : 3000/5000 × 1000 = 600
    //   Bob :   2000/5000 × 1000 = 400
    // Ajout revenu groupe 300 → projected income = 300 → contribution_base = 700.
    //   Alice projeté : 3000/5000 × 700 = 420 (delta -180)
    //   Bob projeté :   2000/5000 × 700 = 280 (delta -120)
    const rows = computeGroupMembersContributionsPreview({
      members: [ALICE, BOB],
      currentGroupBudgetTotal: 1000,
      currentGroupIncomeTotal: 0,
      projectedGroupIncomeTotal: 300,
    })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      profileId: 'alice-uuid',
      currentContribution: 600,
      projectedContribution: 420,
      delta: -180,
    })
    expect(rows[1]).toMatchObject({
      profileId: 'bob-uuid',
      currentContribution: 400,
      projectedContribution: 280,
      delta: -120,
    })
  })

  it('surplus (revenus > budgets) → contributions clampées à 0', () => {
    // Budgets 1000, revenus projetés 1500 → contribution_base = max(0, 1000 − 1500) = 0.
    // Toutes contributions = 0 (surplus de 500 reste en cagnotte).
    const rows = computeGroupMembersContributionsPreview({
      members: [ALICE, BOB],
      currentGroupBudgetTotal: 1000,
      currentGroupIncomeTotal: 200,
      projectedGroupIncomeTotal: 1500,
    })
    expect(rows[0]?.projectedContribution).toBe(0)
    expect(rows[1]?.projectedContribution).toBe(0)
    // Current : contribution_base = 800, prorata 3/5 et 2/5
    expect(rows[0]?.currentContribution).toBe(480)
    expect(rows[1]?.currentContribution).toBe(320)
    // Delta négatif (réduction)
    expect(rows[0]?.delta).toBe(-480)
    expect(rows[1]?.delta).toBe(-320)
  })

  it('split égal quand Σ salaires = 0 — contribution_base partagée à parts égales', () => {
    // 2 membres sans salaire, budget 800, revenu actuel 0, projeté 200.
    // current base = 800 → split égal 400/400.
    // projected base = 600 → split égal 300/300. Delta = -100 chacun.
    const m1: GroupMemberRavDetail = { ...ALICE, salary: 0 }
    const m2: GroupMemberRavDetail = { ...BOB, salary: 0 }
    const rows = computeGroupMembersContributionsPreview({
      members: [m1, m2],
      currentGroupBudgetTotal: 800,
      currentGroupIncomeTotal: 0,
      projectedGroupIncomeTotal: 200,
    })
    expect(rows[0]?.currentContribution).toBe(400)
    expect(rows[0]?.projectedContribution).toBe(300)
    expect(rows[0]?.delta).toBe(-100)
    expect(rows[1]?.currentContribution).toBe(400)
    expect(rows[1]?.projectedContribution).toBe(300)
    expect(rows[1]?.delta).toBe(-100)
  })

  it('édition vers le bas (revenu réduit) → contributions remontent (delta positif)', () => {
    // Budgets 1000 ; revenu actuel 500 (base=500), projeté 100 (base=900) → contributions UP.
    //   Alice : 3000/5000 × 500 = 300 → 3000/5000 × 900 = 540 (delta +240)
    //   Bob :   2000/5000 × 500 = 200 → 2000/5000 × 900 = 360 (delta +160)
    const rows = computeGroupMembersContributionsPreview({
      members: [ALICE, BOB],
      currentGroupBudgetTotal: 1000,
      currentGroupIncomeTotal: 500,
      projectedGroupIncomeTotal: 100,
    })
    expect(rows[0]?.currentContribution).toBe(300)
    expect(rows[0]?.projectedContribution).toBe(540)
    expect(rows[0]?.delta).toBe(240)
    expect(rows[1]?.currentContribution).toBe(200)
    expect(rows[1]?.projectedContribution).toBe(360)
    expect(rows[1]?.delta).toBe(160)
  })

  it('delta nul (newItemAmount === currentItemAmount en édition) → projectedContribution === currentContribution', () => {
    const rows = computeGroupMembersContributionsPreview({
      members: [ALICE, BOB],
      currentGroupBudgetTotal: 1000,
      currentGroupIncomeTotal: 200,
      projectedGroupIncomeTotal: 200,
    })
    expect(rows[0]?.projectedContribution).toBe(rows[0]?.currentContribution)
    expect(rows[1]?.projectedContribution).toBe(rows[1]?.currentContribution)
    expect(rows[0]?.delta).toBe(0)
  })

  it('budget vide (B=0) → contributions toujours 0', () => {
    // contribution_base = max(0, 0 − 0) = 0 → toutes contributions à 0.
    const rows = computeGroupMembersContributionsPreview({
      members: [ALICE, BOB],
      currentGroupBudgetTotal: 0,
      currentGroupIncomeTotal: 0,
      projectedGroupIncomeTotal: 100,
    })
    expect(rows[0]?.currentContribution).toBe(0)
    expect(rows[0]?.projectedContribution).toBe(0)
  })

  it('liste membres vide → retourne []', () => {
    expect(
      computeGroupMembersContributionsPreview({
        members: [],
        currentGroupBudgetTotal: 1000,
        currentGroupIncomeTotal: 0,
        projectedGroupIncomeTotal: 200,
      }),
    ).toEqual([])
  })

  it('mélange salaires zéro + non-zéro → seuls les salariés contribuent (cas perso atypique)', () => {
    // Pattern : si la RPC PG voit total_salaries > 0 (sum des salary > 0), elle utilise prorata
    // strict. Bob (salary=0) reçoit 0/2000 × base = 0. Alice prend tout.
    // NB : pure module reproduit cette sémantique en sommant TOUS les salaires
    // (donc bob.salary=0 contribue à sumSalaries=Alice.salary=3000).
    const m1 = ALICE // salary 3000
    const m2: GroupMemberRavDetail = { ...BOB, salary: 0 }
    const rows = computeGroupMembersContributionsPreview({
      members: [m1, m2],
      currentGroupBudgetTotal: 600,
      currentGroupIncomeTotal: 0,
      projectedGroupIncomeTotal: 200,
    })
    // Σ salaries = 3000, base courante = 600, base projetée = 400.
    expect(rows[0]?.currentContribution).toBe(600) // 3000/3000 × 600
    expect(rows[0]?.projectedContribution).toBeCloseTo(400, 6) // 3000/3000 × 400
    expect(rows[1]?.currentContribution).toBe(0) // 0/3000 × 600
    expect(rows[1]?.projectedContribution).toBe(0)
  })
})
