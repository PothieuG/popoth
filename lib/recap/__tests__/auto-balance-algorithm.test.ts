import { describe, it, expect } from 'vitest'
import { decideAutoBalanceAllocation } from '../auto-balance-algorithm'
import type { BudgetAnalysis, ProcessAutoBalanceSnapshot } from '../auto-balance-types'

/**
 * Pure-unit tests for `decideAutoBalanceAllocation`.
 *
 * Sprint Refactor-Auto-Balance Commit 4 — non-gated (<0.5s, pattern mirror
 * lib/recap/__tests__/step1-algorithm.test.ts). Tests construct snapshots
 * directly and assert on the discriminated `AutoBalanceAlgorithmResult`.
 *
 * Coverage: 3 early-return paths + PHASE 0/1/2 individual + mixed phases +
 * determinism + edge cases.
 */

function makeBudget(overrides: Partial<BudgetAnalysis> & { id: string }): BudgetAnalysis {
  return {
    name: overrides.name ?? `Budget ${overrides.id}`,
    estimated_amount: 100,
    spent_amount: 0,
    cumulated_savings: 0,
    monthly_surplus: 0,
    monthly_deficit: 0,
    ...overrides,
  }
}

function makeSnapshot(
  overrides: Partial<ProcessAutoBalanceSnapshot> = {},
): ProcessAutoBalanceSnapshot {
  return {
    context: 'profile',
    contextId: 'profile-1',
    ownerField: 'profile_id',
    piggyBank: 0,
    budgetAnalyses: [],
    ...overrides,
  }
}

describe('decideAutoBalanceAllocation', () => {
  // ==========================================================================
  // Early-return paths (3 cases)
  // ==========================================================================
  describe('early returns', () => {
    it('returns no_deficit when budgetAnalyses has no deficit budget', () => {
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 100,
          budgetAnalyses: [
            makeBudget({ id: 'a', monthly_surplus: 100, cumulated_savings: 50 }),
          ],
        }),
      )
      expect(result.kind).toBe('no_deficit')
      if (result.kind === 'no_deficit') {
        expect(result.message).toMatch(/Aucun budget déficitaire/)
      }
    })

    it('returns no_deficit on empty budgetAnalyses', () => {
      const result = decideAutoBalanceAllocation(makeSnapshot({ piggyBank: 100 }))
      expect(result.kind).toBe('no_deficit')
    })

    it('returns no_resources when deficit exists but no piggy/savings/surplus', () => {
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 0,
          budgetAnalyses: [makeBudget({ id: 'a', monthly_deficit: 100 })],
        }),
      )
      expect(result.kind).toBe('no_resources')
      if (result.kind === 'no_resources') {
        expect(result.message).toMatch(/Aucune tirelire/)
      }
    })
  })

  // ==========================================================================
  // PHASE 0 — piggy bank distribution (8 cases)
  // ==========================================================================
  describe('PHASE 0 — piggy bank distribution', () => {
    it('full coverage: piggy=100, 1 deficit=100 → 1 transfer of 100', () => {
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 100,
          budgetAnalyses: [makeBudget({ id: 'a', monthly_deficit: 100 })],
        }),
      )
      expect(result.kind).toBe('decision')
      if (result.kind !== 'decision') return
      expect(result.decision.transfers).toHaveLength(1)
      expect(result.decision.transfers[0]).toMatchObject({
        from_budget_id: null,
        from_budget_name: 'Tirelire 🐷',
        to_budget_id: 'a',
        amount: 100,
        source: 'piggy_bank',
      })
      expect(result.decision.totalPiggyBankUsed).toBe(100)
    })

    it('partial coverage: piggy=50, 1 deficit=100 → 1 transfer of 50', () => {
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 50,
          budgetAnalyses: [makeBudget({ id: 'a', monthly_deficit: 100 })],
        }),
      )
      expect(result.kind).toBe('decision')
      if (result.kind !== 'decision') return
      expect(result.decision.transfers).toHaveLength(1)
      expect(result.decision.transfers[0]?.amount).toBe(50)
      expect(result.decision.totalPiggyBankUsed).toBe(50)
    })

    it('piggy=200, 2 equal deficits → 2 transfers of 100 each', () => {
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 200,
          budgetAnalyses: [
            makeBudget({ id: 'a', monthly_deficit: 100 }),
            makeBudget({ id: 'b', monthly_deficit: 100 }),
          ],
        }),
      )
      expect(result.kind).toBe('decision')
      if (result.kind !== 'decision') return
      expect(result.decision.transfers).toHaveLength(2)
      expect(result.decision.totalPiggyBankUsed).toBe(200)
      for (const t of result.decision.transfers) {
        expect(t.source).toBe('piggy_bank')
        expect(t.amount).toBe(100)
      }
    })

    it('piggy=200, 2 unequal deficits (150 + 50) → proportional 150/50', () => {
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 200,
          budgetAnalyses: [
            makeBudget({ id: 'a', monthly_deficit: 150 }),
            makeBudget({ id: 'b', monthly_deficit: 50 }),
          ],
        }),
      )
      expect(result.kind).toBe('decision')
      if (result.kind !== 'decision') return
      const a = result.decision.transfers.find((t) => t.to_budget_id === 'a')!
      const b = result.decision.transfers.find((t) => t.to_budget_id === 'b')!
      expect(a.amount).toBe(150)
      expect(b.amount).toBe(50)
      expect(result.decision.totalPiggyBankUsed).toBe(200)
    })

    it('piggy=100, 2 unequal deficits (150 + 50) → 75/25 (insufficient piggy)', () => {
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 100,
          budgetAnalyses: [
            makeBudget({ id: 'a', monthly_deficit: 150 }),
            makeBudget({ id: 'b', monthly_deficit: 50 }),
          ],
        }),
      )
      expect(result.kind).toBe('decision')
      if (result.kind !== 'decision') return
      const a = result.decision.transfers.find((t) => t.to_budget_id === 'a')!
      const b = result.decision.transfers.find((t) => t.to_budget_id === 'b')!
      expect(a.amount).toBe(75)
      expect(b.amount).toBe(25)
      expect(result.decision.totalPiggyBankUsed).toBe(100)
    })

    it('amountToDistribute is min(piggy, totalDeficit) when piggy excess', () => {
      // piggy=300, deficit=100 → only 100 distributed, 200 remains in piggy
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 300,
          budgetAnalyses: [makeBudget({ id: 'a', monthly_deficit: 100 })],
        }),
      )
      expect(result.kind).toBe('decision')
      if (result.kind !== 'decision') return
      expect(result.decision.totalPiggyBankUsed).toBe(100)
      expect(result.decision.transfers[0]?.amount).toBe(100)
      expect(result.decision.totalPiggyBank).toBe(300) // snapshot pass-through
    })

    it('PHASE 0 only: returns success with 0 PHASE 1+2 usage', () => {
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 50,
          budgetAnalyses: [makeBudget({ id: 'a', monthly_deficit: 100 })],
        }),
      )
      expect(result.kind).toBe('decision')
      if (result.kind !== 'decision') return
      expect(result.decision.transfers).toHaveLength(1)
      expect(result.decision.totalPiggyBankUsed).toBe(50)
      expect(result.decision.totalSavingsUsed).toBe(0)
      expect(result.decision.totalSurplusUsed).toBe(0)
    })

    it('proportional distribution to 3 equal deficits: piggy=99, each deficit=33', () => {
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 99,
          budgetAnalyses: [
            makeBudget({ id: 'a', monthly_deficit: 33 }),
            makeBudget({ id: 'b', monthly_deficit: 33 }),
            makeBudget({ id: 'c', monthly_deficit: 33 }),
          ],
        }),
      )
      expect(result.kind).toBe('decision')
      if (result.kind !== 'decision') return
      // amountToDistribute = min(99, 99) = 99, each gets 99 * (33/99) = 33
      expect(result.decision.transfers).toHaveLength(3)
      for (const t of result.decision.transfers) {
        expect(t.amount).toBe(33)
      }
      expect(result.decision.totalPiggyBankUsed).toBe(99)
    })
  })

  // ==========================================================================
  // PHASE 1 — savings transfer (8 cases)
  // ==========================================================================
  describe('PHASE 1 — savings transfer', () => {
    it('1 savings + 1 deficit equal → 1 transfer covering full deficit', () => {
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 0,
          budgetAnalyses: [
            makeBudget({ id: 'a', cumulated_savings: 100 }),
            makeBudget({ id: 'b', monthly_deficit: 100 }),
          ],
        }),
      )
      expect(result.kind).toBe('decision')
      if (result.kind !== 'decision') return
      expect(result.decision.transfers).toHaveLength(1)
      expect(result.decision.transfers[0]).toMatchObject({
        from_budget_id: 'a',
        to_budget_id: 'b',
        amount: 100,
        source: 'savings',
      })
      expect(result.decision.totalSavingsUsed).toBe(100)
    })

    it('multiple savings + 1 deficit proportional', () => {
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 0,
          budgetAnalyses: [
            makeBudget({ id: 'a', cumulated_savings: 100 }),
            makeBudget({ id: 'b', cumulated_savings: 50 }),
            makeBudget({ id: 'c', monthly_deficit: 150 }),
          ],
        }),
      )
      expect(result.kind).toBe('decision')
      if (result.kind !== 'decision') return
      expect(result.decision.transfers).toHaveLength(2)
      const ac = result.decision.transfers.find((t) => t.from_budget_id === 'a')!
      const bc = result.decision.transfers.find((t) => t.from_budget_id === 'b')!
      // For C (proportion=1): amount=min(150, 150*1)=150
      //   A→C = 100/150 * 150 = 100
      //   B→C = 50/150 * 150 = 50
      expect(ac.amount).toBe(100)
      expect(bc.amount).toBe(50)
      expect(result.decision.totalSavingsUsed).toBe(150)
    })

    it('1 savings + multiple deficits proportional', () => {
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 0,
          budgetAnalyses: [
            makeBudget({ id: 'a', cumulated_savings: 100 }),
            makeBudget({ id: 'b', monthly_deficit: 60 }),
            makeBudget({ id: 'c', monthly_deficit: 40 }),
          ],
        }),
      )
      expect(result.kind).toBe('decision')
      if (result.kind !== 'decision') return
      const ab = result.decision.transfers.find((t) => t.to_budget_id === 'b')!
      const ac = result.decision.transfers.find((t) => t.to_budget_id === 'c')!
      // For B (proportion=60/100=0.6): amount=min(60, 100*0.6)=60. A→B = 100/100*60 = 60.
      // For C (proportion=40/100=0.4): amount=min(40, 100*0.4)=40. A→C = 40.
      expect(ab.amount).toBe(60)
      expect(ac.amount).toBe(40)
      expect(result.decision.totalSavingsUsed).toBe(100)
    })

    it('self-transfer skip: budget A with both savings and deficit, no other budget', () => {
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 0,
          budgetAnalyses: [
            makeBudget({ id: 'a', cumulated_savings: 100, monthly_deficit: 50 }),
          ],
        }),
      )
      // A is the only budget; A→A is skipped. 0 transfers from PHASE 1.
      // PHASE 2 not fired (no surplus). Falls through to no_transfers.
      expect(result.kind).toBe('no_transfers')
    })

    it('savings insufficient: 1 savings=50, 1 deficit=100 → covers 50', () => {
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 0,
          budgetAnalyses: [
            makeBudget({ id: 'a', cumulated_savings: 50 }),
            makeBudget({ id: 'b', monthly_deficit: 100 }),
          ],
        }),
      )
      expect(result.kind).toBe('decision')
      if (result.kind !== 'decision') return
      expect(result.decision.transfers).toHaveLength(1)
      expect(result.decision.transfers[0]?.amount).toBe(50)
      expect(result.decision.totalSavingsUsed).toBe(50)
    })

    it('multiple savings + multiple deficits 4 transfers', () => {
      // A.savings=100, B.savings=50, C.deficit=90, D.deficit=60
      // Total savings=150, total deficit=150
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 0,
          budgetAnalyses: [
            makeBudget({ id: 'a', cumulated_savings: 100 }),
            makeBudget({ id: 'b', cumulated_savings: 50 }),
            makeBudget({ id: 'c', monthly_deficit: 90 }),
            makeBudget({ id: 'd', monthly_deficit: 60 }),
          ],
        }),
      )
      expect(result.kind).toBe('decision')
      if (result.kind !== 'decision') return
      expect(result.decision.transfers).toHaveLength(4)
      // For C (proportion=90/150=0.6): amount=min(90, 150*0.6)=90. A→C=60, B→C=30.
      // For D (proportion=60/150=0.4): amount=min(60, 150*0.4)=60. A→D=40, B→D=20.
      const ac = result.decision.transfers.find(
        (t) => t.from_budget_id === 'a' && t.to_budget_id === 'c',
      )!
      const bc = result.decision.transfers.find(
        (t) => t.from_budget_id === 'b' && t.to_budget_id === 'c',
      )!
      const ad = result.decision.transfers.find(
        (t) => t.from_budget_id === 'a' && t.to_budget_id === 'd',
      )!
      const bd = result.decision.transfers.find(
        (t) => t.from_budget_id === 'b' && t.to_budget_id === 'd',
      )!
      expect(ac.amount).toBe(60)
      expect(bc.amount).toBe(30)
      expect(ad.amount).toBe(40)
      expect(bd.amount).toBe(20)
      expect(result.decision.totalSavingsUsed).toBe(150)
    })

    it('rounding: contributionAmount = 0 due to tiny amount is skipped', () => {
      // A.savings=0.001, B.deficit=0.005
      // amount=min(0.005, 0.001*1)=0.001, contribution=round(0.001*100)/100 = 0 → skip
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 0,
          budgetAnalyses: [
            makeBudget({ id: 'a', cumulated_savings: 0.001 }),
            makeBudget({ id: 'b', monthly_deficit: 0.005 }),
          ],
        }),
      )
      expect(result.kind).toBe('no_transfers')
    })

    it('post-PHASE-0: piggy partial + savings completes', () => {
      // piggy=50, A.savings=100, B.deficit=200
      // PHASE 0: piggy→B=50. PHASE 1: remaining=150. amount=min(150,100*1)=100. A→B=100.
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 50,
          budgetAnalyses: [
            makeBudget({ id: 'a', cumulated_savings: 100 }),
            makeBudget({ id: 'b', monthly_deficit: 200 }),
          ],
        }),
      )
      expect(result.kind).toBe('decision')
      if (result.kind !== 'decision') return
      expect(result.decision.transfers).toHaveLength(2)
      expect(result.decision.totalPiggyBankUsed).toBe(50)
      expect(result.decision.totalSavingsUsed).toBe(100)
    })
  })

  // ==========================================================================
  // PHASE 2 — surplus distribution (8 cases)
  // ==========================================================================
  describe('PHASE 2 — surplus distribution', () => {
    it('1 surplus + 1 deficit equal → 1 transfer covering full deficit', () => {
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 0,
          budgetAnalyses: [
            makeBudget({ id: 'a', monthly_surplus: 100 }),
            makeBudget({ id: 'b', monthly_deficit: 100 }),
          ],
        }),
      )
      expect(result.kind).toBe('decision')
      if (result.kind !== 'decision') return
      expect(result.decision.transfers).toHaveLength(1)
      expect(result.decision.transfers[0]).toMatchObject({
        from_budget_id: 'a',
        to_budget_id: 'b',
        amount: 100,
        source: 'surplus',
      })
      expect(result.decision.totalSurplusUsed).toBe(100)
    })

    it('multiple surplus + 1 deficit proportional', () => {
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 0,
          budgetAnalyses: [
            makeBudget({ id: 'a', monthly_surplus: 150 }),
            makeBudget({ id: 'b', monthly_surplus: 50 }),
            makeBudget({ id: 'c', monthly_deficit: 100 }),
          ],
        }),
      )
      expect(result.kind).toBe('decision')
      if (result.kind !== 'decision') return
      expect(result.decision.transfers).toHaveLength(2)
      const ac = result.decision.transfers.find((t) => t.from_budget_id === 'a')!
      const bc = result.decision.transfers.find((t) => t.from_budget_id === 'b')!
      // For C (proportion=1): amount=min(100, 200*1)=100. A→C=150/200*100=75. B→C=50/200*100=25.
      expect(ac.amount).toBe(75)
      expect(bc.amount).toBe(25)
      expect(result.decision.totalSurplusUsed).toBe(100)
    })

    it('1 surplus + multiple deficits proportional', () => {
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 0,
          budgetAnalyses: [
            makeBudget({ id: 'a', monthly_surplus: 100 }),
            makeBudget({ id: 'b', monthly_deficit: 60 }),
            makeBudget({ id: 'c', monthly_deficit: 40 }),
          ],
        }),
      )
      expect(result.kind).toBe('decision')
      if (result.kind !== 'decision') return
      const ab = result.decision.transfers.find((t) => t.to_budget_id === 'b')!
      const ac = result.decision.transfers.find((t) => t.to_budget_id === 'c')!
      expect(ab.amount).toBe(60)
      expect(ac.amount).toBe(40)
      expect(result.decision.totalSurplusUsed).toBe(100)
    })

    it('self-transfer skip: budget A with both surplus and deficit, no other budget', () => {
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 0,
          budgetAnalyses: [
            makeBudget({ id: 'a', monthly_surplus: 100, monthly_deficit: 50 }),
          ],
        }),
      )
      expect(result.kind).toBe('no_transfers')
    })

    it('surplus insufficient: 1 surplus=50, 1 deficit=100 → covers 50', () => {
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 0,
          budgetAnalyses: [
            makeBudget({ id: 'a', monthly_surplus: 50 }),
            makeBudget({ id: 'b', monthly_deficit: 100 }),
          ],
        }),
      )
      expect(result.kind).toBe('decision')
      if (result.kind !== 'decision') return
      expect(result.decision.transfers).toHaveLength(1)
      expect(result.decision.transfers[0]?.amount).toBe(50)
      expect(result.decision.totalSurplusUsed).toBe(50)
    })

    it('PHASE 2 skipped when PHASE 0 covers everything', () => {
      // piggy=200, A.surplus=100, B.deficit=200
      // PHASE 0 fully covers; PHASE 2 gating skips.
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 200,
          budgetAnalyses: [
            makeBudget({ id: 'a', monthly_surplus: 100 }),
            makeBudget({ id: 'b', monthly_deficit: 200 }),
          ],
        }),
      )
      expect(result.kind).toBe('decision')
      if (result.kind !== 'decision') return
      expect(result.decision.totalPiggyBankUsed).toBe(200)
      expect(result.decision.totalSurplusUsed).toBe(0)
      expect(result.decision.transfers).toHaveLength(1)
      expect(result.decision.transfers[0]?.source).toBe('piggy_bank')
    })

    it('PHASE 1+2: savings cover part, surplus covers rest', () => {
      // A.savings=50, B.surplus=100, C.deficit=150
      // PHASE 1: A→C=50 (savings). PHASE 2: B→C=100 (surplus, remaining=100).
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 0,
          budgetAnalyses: [
            makeBudget({ id: 'a', cumulated_savings: 50 }),
            makeBudget({ id: 'b', monthly_surplus: 100 }),
            makeBudget({ id: 'c', monthly_deficit: 150 }),
          ],
        }),
      )
      expect(result.kind).toBe('decision')
      if (result.kind !== 'decision') return
      const savingsT = result.decision.transfers.find((t) => t.source === 'savings')!
      const surplusT = result.decision.transfers.find((t) => t.source === 'surplus')!
      expect(savingsT.amount).toBe(50)
      expect(surplusT.amount).toBe(100)
      expect(result.decision.totalSavingsUsed).toBe(50)
      expect(result.decision.totalSurplusUsed).toBe(100)
    })

    it('rounding: contributionAmount = 0 due to tiny amount is skipped', () => {
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 0,
          budgetAnalyses: [
            makeBudget({ id: 'a', monthly_surplus: 0.001 }),
            makeBudget({ id: 'b', monthly_deficit: 0.005 }),
          ],
        }),
      )
      expect(result.kind).toBe('no_transfers')
    })
  })

  // ==========================================================================
  // Mixed phases (5 cases)
  // ==========================================================================
  describe('mixed phases', () => {
    it('all 3 phases fire (CAS 4 caract mirror): piggy=50, savings=100, surplus=150, deficit=300', () => {
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 50,
          budgetAnalyses: [
            makeBudget({ id: 'a', cumulated_savings: 100 }),
            makeBudget({ id: 'b', monthly_surplus: 150 }),
            makeBudget({ id: 'c', monthly_deficit: 300 }),
          ],
        }),
      )
      expect(result.kind).toBe('decision')
      if (result.kind !== 'decision') return
      expect(result.decision.transfers).toHaveLength(3)
      const piggyT = result.decision.transfers.find((t) => t.source === 'piggy_bank')!
      const savingsT = result.decision.transfers.find((t) => t.source === 'savings')!
      const surplusT = result.decision.transfers.find((t) => t.source === 'surplus')!
      expect(piggyT.amount).toBe(50)
      expect(savingsT.amount).toBe(100)
      expect(surplusT.amount).toBe(150)
      expect(result.decision.totalPiggyBankUsed).toBe(50)
      expect(result.decision.totalSavingsUsed).toBe(100)
      expect(result.decision.totalSurplusUsed).toBe(150)
    })

    it('partial coverage all 3 phases: piggy=10, savings=20, surplus=30, deficit=100', () => {
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 10,
          budgetAnalyses: [
            makeBudget({ id: 'a', cumulated_savings: 20 }),
            makeBudget({ id: 'b', monthly_surplus: 30 }),
            makeBudget({ id: 'c', monthly_deficit: 100 }),
          ],
        }),
      )
      expect(result.kind).toBe('decision')
      if (result.kind !== 'decision') return
      // PHASE 0: piggy→C=10 (totalPiggyBankUsed=10)
      // PHASE 1: remaining=90. amount=min(90, 20*1)=20. A→C=20.
      // PHASE 2: per-budget remaining=100-10-20=70. amount=min(70, 30*1)=30. B→C=30.
      // Total: 60. Deficit not fully covered (40 remaining).
      expect(result.decision.totalPiggyBankUsed).toBe(10)
      expect(result.decision.totalSavingsUsed).toBe(20)
      expect(result.decision.totalSurplusUsed).toBe(30)
    })

    it('PHASE 0 only (no savings/surplus): piggy=200, deficit=200', () => {
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 200,
          budgetAnalyses: [makeBudget({ id: 'a', monthly_deficit: 200 })],
        }),
      )
      expect(result.kind).toBe('decision')
      if (result.kind !== 'decision') return
      expect(result.decision.totalPiggyBankUsed).toBe(200)
      expect(result.decision.totalSavingsUsed).toBe(0)
      expect(result.decision.totalSurplusUsed).toBe(0)
    })

    it('PHASE 1 only (no piggy, no surplus): savings=200, deficit=200', () => {
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 0,
          budgetAnalyses: [
            makeBudget({ id: 'a', cumulated_savings: 200 }),
            makeBudget({ id: 'b', monthly_deficit: 200 }),
          ],
        }),
      )
      expect(result.kind).toBe('decision')
      if (result.kind !== 'decision') return
      expect(result.decision.totalPiggyBankUsed).toBe(0)
      expect(result.decision.totalSavingsUsed).toBe(200)
      expect(result.decision.totalSurplusUsed).toBe(0)
    })

    it('PHASE 2 only (no piggy, no savings): surplus=200, deficit=200', () => {
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 0,
          budgetAnalyses: [
            makeBudget({ id: 'a', monthly_surplus: 200 }),
            makeBudget({ id: 'b', monthly_deficit: 200 }),
          ],
        }),
      )
      expect(result.kind).toBe('decision')
      if (result.kind !== 'decision') return
      expect(result.decision.totalPiggyBankUsed).toBe(0)
      expect(result.decision.totalSavingsUsed).toBe(0)
      expect(result.decision.totalSurplusUsed).toBe(200)
    })
  })

  // ==========================================================================
  // Determinism + edge cases (5 cases)
  // ==========================================================================
  describe('determinism + edge cases', () => {
    it('same snapshot twice → byte-identical decision', () => {
      const snapshot = makeSnapshot({
        piggyBank: 100,
        budgetAnalyses: [
          makeBudget({ id: 'a', cumulated_savings: 50 }),
          makeBudget({ id: 'b', monthly_surplus: 75 }),
          makeBudget({ id: 'c', monthly_deficit: 200 }),
        ],
      })
      const r1 = decideAutoBalanceAllocation(snapshot)
      const r2 = decideAutoBalanceAllocation(snapshot)
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2))
    })

    it('shuffled budget order → same output (sort by id ASC)', () => {
      const budgets = [
        makeBudget({ id: 'a', cumulated_savings: 50 }),
        makeBudget({ id: 'b', monthly_surplus: 75 }),
        makeBudget({ id: 'c', monthly_deficit: 200 }),
      ]
      const r1 = decideAutoBalanceAllocation(
        makeSnapshot({ piggyBank: 100, budgetAnalyses: budgets }),
      )
      const r2 = decideAutoBalanceAllocation(
        makeSnapshot({ piggyBank: 100, budgetAnalyses: [...budgets].reverse() }),
      )
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2))
    })

    it('does not mutate input snapshot', () => {
      const snapshot = makeSnapshot({
        piggyBank: 100,
        budgetAnalyses: [
          makeBudget({ id: 'a', cumulated_savings: 50 }),
          makeBudget({ id: 'b', monthly_deficit: 100 }),
        ],
      })
      const before = JSON.stringify(snapshot)
      decideAutoBalanceAllocation(snapshot)
      expect(JSON.stringify(snapshot)).toBe(before)
    })

    it('negative cumulated_savings is ignored (filter > 0)', () => {
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 0,
          budgetAnalyses: [
            makeBudget({ id: 'a', cumulated_savings: -50 }),
            makeBudget({ id: 'b', cumulated_savings: 100 }),
            makeBudget({ id: 'c', monthly_deficit: 100 }),
          ],
        }),
      )
      expect(result.kind).toBe('decision')
      if (result.kind !== 'decision') return
      // Only B contributes; A's negative savings ignored
      expect(result.decision.transfers).toHaveLength(1)
      expect(result.decision.transfers[0]?.from_budget_id).toBe('b')
      expect(result.decision.totalSavingsUsed).toBe(100)
    })

    it('operations log matches transfers count + step types', () => {
      const result = decideAutoBalanceAllocation(
        makeSnapshot({
          piggyBank: 50,
          budgetAnalyses: [
            makeBudget({ id: 'a', cumulated_savings: 100 }),
            makeBudget({ id: 'b', monthly_surplus: 150 }),
            makeBudget({ id: 'c', monthly_deficit: 300 }),
          ],
        }),
      )
      expect(result.kind).toBe('decision')
      if (result.kind !== 'decision') return
      // 3 transfers (1 per phase) → 3 operations
      expect(result.decision.operations).toHaveLength(3)
      expect(result.decision.operations.map((o) => o.step).sort()).toEqual([
        '0.piggy_distribute',
        '1.savings_transfer',
        '2.surplus_transfer',
      ])
    })
  })
})
