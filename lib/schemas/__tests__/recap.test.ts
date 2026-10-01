import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  advanceStepBodySchema,
  completeRecapBodySchema,
  prepareDeficitBodySchema,
  recapStepSchema,
  saveRefloatPlanBodySchema,
  startRecapBodySchema,
  statusQuerySchema,
  transferSurplusesBodySchema,
  updateSalariesBodySchema,
} from '@/lib/schemas/recap'

const uuid = () => randomUUID()

describe('startRecapBodySchema', () => {
  it('accepts context=profile', () => {
    expect(startRecapBodySchema.safeParse({ context: 'profile' }).success).toBe(true)
  })

  it('accepts context=group', () => {
    expect(startRecapBodySchema.safeParse({ context: 'group' }).success).toBe(true)
  })

  it('rejects missing context', () => {
    expect(startRecapBodySchema.safeParse({}).success).toBe(false)
  })

  it('rejects invalid context enum value', () => {
    expect(startRecapBodySchema.safeParse({ context: 'household' }).success).toBe(false)
  })

  it('rejects non-string context', () => {
    expect(startRecapBodySchema.safeParse({ context: 42 }).success).toBe(false)
  })
})

describe('transferSurplusesBodySchema', () => {
  it('accepts a single-element budgetIds list', () => {
    expect(
      transferSurplusesBodySchema.safeParse({ context: 'profile', budgetIds: [uuid()] }).success,
    ).toBe(true)
  })

  it('accepts multiple uuids', () => {
    expect(
      transferSurplusesBodySchema.safeParse({
        context: 'group',
        budgetIds: [uuid(), uuid(), uuid()],
      }).success,
    ).toBe(true)
  })

  it('rejects empty budgetIds (min(1))', () => {
    expect(
      transferSurplusesBodySchema.safeParse({ context: 'profile', budgetIds: [] }).success,
    ).toBe(false)
  })

  it('rejects non-uuid string in budgetIds', () => {
    expect(
      transferSurplusesBodySchema.safeParse({ context: 'profile', budgetIds: ['not-uuid'] })
        .success,
    ).toBe(false)
  })

  it('rejects missing context', () => {
    expect(transferSurplusesBodySchema.safeParse({ budgetIds: [uuid()] }).success).toBe(false)
  })
})

describe('prepareDeficitBodySchema', () => {
  it('accepts context alone', () => {
    expect(prepareDeficitBodySchema.safeParse({ context: 'profile' }).success).toBe(true)
    expect(prepareDeficitBodySchema.safeParse({ context: 'group' }).success).toBe(true)
  })

  it('rejects missing or invalid context', () => {
    expect(prepareDeficitBodySchema.safeParse({}).success).toBe(false)
    expect(prepareDeficitBodySchema.safeParse({ context: 'household' }).success).toBe(false)
  })
})

describe('saveRefloatPlanBodySchema', () => {
  // Sprint Recap-Manual-Refloat (2026-10-01) — une source par appel.
  it('accepts a piggy amount, 0 included (remise à zéro)', () => {
    expect(
      saveRefloatPlanBodySchema.safeParse({ context: 'profile', source: 'piggy', amount: 120.5 })
        .success,
    ).toBe(true)
    expect(
      saveRefloatPlanBodySchema.safeParse({ context: 'profile', source: 'piggy', amount: 0 })
        .success,
    ).toBe(true)
  })

  it('rejects a negative, 3-decimal or non-finite piggy amount', () => {
    for (const amount of [-1, 10.123, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        saveRefloatPlanBodySchema.safeParse({ context: 'profile', source: 'piggy', amount })
          .success,
      ).toBe(false)
    }
  })

  it('accepts budgets / projects allocations keyed by uuid', () => {
    expect(
      saveRefloatPlanBodySchema.safeParse({
        context: 'group',
        source: 'budgets',
        allocations: { [uuid()]: 50, [uuid()]: 0 },
      }).success,
    ).toBe(true)
    expect(
      saveRefloatPlanBodySchema.safeParse({
        context: 'profile',
        source: 'projects',
        allocations: {},
      }).success,
    ).toBe(true)
  })

  it('rejects non-uuid keys and negative amounts in allocations', () => {
    expect(
      saveRefloatPlanBodySchema.safeParse({
        context: 'profile',
        source: 'budgets',
        allocations: { 'not-a-uuid': 10 },
      }).success,
    ).toBe(false)
    expect(
      saveRefloatPlanBodySchema.safeParse({
        context: 'profile',
        source: 'projects',
        allocations: { [uuid()]: -5 },
      }).success,
    ).toBe(false)
  })

  it('rejects an unknown source or a payload of the wrong shape for the source', () => {
    expect(
      saveRefloatPlanBodySchema.safeParse({ context: 'profile', source: 'savings', amount: 10 })
        .success,
    ).toBe(false)
    expect(
      saveRefloatPlanBodySchema.safeParse({ context: 'profile', source: 'budgets', amount: 10 })
        .success,
    ).toBe(false)
  })
})

describe('updateSalariesBodySchema', () => {
  it('accepts one salary entry', () => {
    expect(
      updateSalariesBodySchema.safeParse({
        context: 'group',
        salaries: [{ profileId: uuid(), salary: 2500 }],
      }).success,
    ).toBe(true)
  })

  it('accepts a salary of zero', () => {
    expect(
      updateSalariesBodySchema.safeParse({
        context: 'group',
        salaries: [{ profileId: uuid(), salary: 0 }],
      }).success,
    ).toBe(true)
  })

  it('rejects empty salaries array', () => {
    expect(updateSalariesBodySchema.safeParse({ context: 'group', salaries: [] }).success).toBe(
      false,
    )
  })

  it('rejects negative salary', () => {
    expect(
      updateSalariesBodySchema.safeParse({
        context: 'group',
        salaries: [{ profileId: uuid(), salary: -100 }],
      }).success,
    ).toBe(false)
  })

  it('rejects non-uuid profileId', () => {
    expect(
      updateSalariesBodySchema.safeParse({
        context: 'group',
        salaries: [{ profileId: 'bob', salary: 1000 }],
      }).success,
    ).toBe(false)
  })

  it('rejects 3-decimal salary', () => {
    expect(
      updateSalariesBodySchema.safeParse({
        context: 'group',
        salaries: [{ profileId: uuid(), salary: 1000.555 }],
      }).success,
    ).toBe(false)
  })
})

describe('completeRecapBodySchema', () => {
  it('accepts context=profile', () => {
    expect(completeRecapBodySchema.safeParse({ context: 'profile' }).success).toBe(true)
  })

  it('accepts context=group', () => {
    expect(completeRecapBodySchema.safeParse({ context: 'group' }).success).toBe(true)
  })

  it('rejects missing context', () => {
    expect(completeRecapBodySchema.safeParse({}).success).toBe(false)
  })

  it('rejects invalid context value', () => {
    expect(completeRecapBodySchema.safeParse({ context: 'family' }).success).toBe(false)
  })

  it('rejects null context', () => {
    expect(completeRecapBodySchema.safeParse({ context: null }).success).toBe(false)
  })
})

describe('statusQuerySchema', () => {
  it('accepts context=profile', () => {
    expect(statusQuerySchema.safeParse({ context: 'profile' }).success).toBe(true)
  })

  it('accepts context=group', () => {
    expect(statusQuerySchema.safeParse({ context: 'group' }).success).toBe(true)
  })

  it('rejects missing context (required)', () => {
    expect(statusQuerySchema.safeParse({}).success).toBe(false)
  })

  it('rejects invalid context enum', () => {
    expect(statusQuerySchema.safeParse({ context: 'PROFILE' }).success).toBe(false)
  })

  it('rejects array context', () => {
    expect(statusQuerySchema.safeParse({ context: ['profile'] }).success).toBe(false)
  })
})

describe('recapStepSchema', () => {
  it('accepts the 7 RecapStep values', () => {
    for (const step of [
      'welcome',
      'complete_month',
      'summary',
      'manage_bilan',
      'salary_update',
      'final_recap',
      'completed',
    ]) {
      expect(recapStepSchema.safeParse(step).success).toBe(true)
    }
  })

  it('rejects unknown step strings', () => {
    expect(recapStepSchema.safeParse('start').success).toBe(false)
    expect(recapStepSchema.safeParse('').success).toBe(false)
  })
})

describe('advanceStepBodySchema', () => {
  it('accepts welcome → complete_month (profile, sprint Complete-Month-Step)', () => {
    expect(
      advanceStepBodySchema.safeParse({
        context: 'profile',
        fromStep: 'welcome',
        toStep: 'complete_month',
      }).success,
    ).toBe(true)
  })

  it('accepts complete_month → summary (group, sprint Complete-Month-Step)', () => {
    expect(
      advanceStepBodySchema.safeParse({
        context: 'group',
        fromStep: 'complete_month',
        toStep: 'summary',
      }).success,
    ).toBe(true)
  })

  it('accepts welcome → summary (long-range forward skip)', () => {
    expect(
      advanceStepBodySchema.safeParse({
        context: 'profile',
        fromStep: 'welcome',
        toStep: 'summary',
      }).success,
    ).toBe(true)
  })

  it('accepts summary → manage_bilan (group)', () => {
    expect(
      advanceStepBodySchema.safeParse({
        context: 'group',
        fromStep: 'summary',
        toStep: 'manage_bilan',
      }).success,
    ).toBe(true)
  })

  it('rejects missing context', () => {
    expect(
      advanceStepBodySchema.safeParse({ fromStep: 'welcome', toStep: 'summary' }).success,
    ).toBe(false)
  })

  it('rejects unknown fromStep enum value', () => {
    expect(
      advanceStepBodySchema.safeParse({
        context: 'profile',
        fromStep: 'intro',
        toStep: 'summary',
      }).success,
    ).toBe(false)
  })

  it('rejects unknown toStep enum value', () => {
    expect(
      advanceStepBodySchema.safeParse({
        context: 'profile',
        fromStep: 'welcome',
        toStep: 'unknown',
      }).success,
    ).toBe(false)
  })

  it('rejects missing toStep', () => {
    expect(
      advanceStepBodySchema.safeParse({ context: 'profile', fromStep: 'welcome' }).success,
    ).toBe(false)
  })
})
